import json
import os
from datetime import date, datetime, timedelta
from typing import Dict, Any, List, Optional
import joblib
import numpy as np
import pandas as pd
from bson import ObjectId

from app.config import MODEL_DIR
from app.data.data_extractor import DataExtractor
from app.data.preprocessing import DataPreprocessor
from app.data.feature_engineering import FEATURE_COLUMNS
from app.database import get_collection
from app.models.train_model import ModelTrainer
from app.schemas.prediction_schema import (
    PredictResponse,
    DailyForecast,
    HistoricalSalesPoint,
    EvaluationMetrics,
    InventorySnapshot
)
from app.utils.logger import logger

class DemandPredictor:
    """
    Executes multi-step recursive demand forecasting using trained XGBoost models.
    Applies non-negative constraints, handles sparse history with fallbacks,
    computes reorder points and future stock levels, and records predictions to MongoDB.
    """

    @classmethod
    def predict(
        cls,
        product_id: str,
        warehouse_id: Optional[str] = None,
        horizon_days: int = 7,
        user_id: Optional[str] = None
    ) -> PredictResponse:
        logger.info(f"Predict request: product_id={product_id}, warehouse_id={warehouse_id}, horizon={horizon_days}")

        # 1. Fetch Product Metadata
        product = DataExtractor.get_product_details(product_id)
        if not product:
            raise ValueError(f"Product with ID '{product_id}' was not found in the database.")

        warehouse = DataExtractor.get_warehouse_details(warehouse_id)
        warehouse_name = warehouse["warehouse_name"] if warehouse else "All Warehouses"

        # 2. Extract historical sales data
        raw_sales = DataExtractor.extract_dispatched_sales(product_id=product_id, warehouse_id=warehouse_id)
        if not warehouse_id and not raw_sales.empty:
            df_series = DataPreprocessor.aggregate_across_warehouses(raw_sales)
        else:
            df_series = raw_sales

        df_prepared = DataPreprocessor.prepare_daily_series(df_series) if not df_series.empty else pd.DataFrame()

        # Build historical sales points for the frontend charts (last 30-60 days)
        recent_history: List[HistoricalSalesPoint] = []
        if not df_prepared.empty:
            recent_slice = df_prepared.tail(45)
            for _, r in recent_slice.iterrows():
                recent_history.append(
                    HistoricalSalesPoint(
                        date=str(r["date"]),
                        actual_quantity=round(float(r["daily_sales"]), 1)
                    )
                )

        # 3. Model Discovery or Auto-training
        model_path, meta_path = ModelTrainer.get_model_filename(product_id, warehouse_id)

        # If specific warehouse model doesn't exist, check for global model
        if not model_path.exists() and warehouse_id:
            global_model_path, global_meta_path = ModelTrainer.get_model_filename(product_id, None)
            if global_model_path.exists():
                model_path, meta_path = global_model_path, global_meta_path

        # If still no model, try training one
        if not model_path.exists():
            logger.info(f"Model not found for {product_id}. Attempting training...")
            train_res = ModelTrainer.train_single_series(product_id, warehouse_id)
            if train_res.get("status") != "TRAINED":
                # Check global
                train_res_global = ModelTrainer.train_single_series(product_id, None)
                if train_res_global.get("status") == "TRAINED":
                    model_path, meta_path = ModelTrainer.get_model_filename(product_id, None)

        # 4. Check if we have a trained XGBoost model or must use Fallback
        use_xgboost = model_path.exists() and meta_path.exists()

        daily_forecasts: List[DailyForecast] = []
        model_type = "XGBoost"
        model_version = "1.0.0"
        metrics = EvaluationMetrics()
        status = "SUCCESS"
        notes = "Forecast generated via recursive multi-step XGBoost Regressor."

        # Anchor date: use max date from history or today
        if not df_prepared.empty:
            anchor_date = df_prepared["date"].max()
        else:
            anchor_date = date.today()

        if use_xgboost:
            try:
                model = joblib.load(model_path)
                with open(meta_path, "r") as f:
                    meta = json.load(f)

                saved_metrics = meta.get("metrics", {})
                metrics = EvaluationMetrics(
                    mae=saved_metrics.get("mae"),
                    rmse=saved_metrics.get("rmse"),
                    wape=saved_metrics.get("wape"),
                    baseline_mae=saved_metrics.get("baseline_mae"),
                    baseline_rmse=saved_metrics.get("baseline_rmse"),
                    baseline_wape=saved_metrics.get("baseline_wape"),
                    samples_count=saved_metrics.get("samples_count")
                )

                # Recursive Multi-Step Forecasting
                # Maintain a rolling simulation history containing dates and sales
                sim_history = df_prepared[["date", "daily_sales"]].copy()

                for step in range(1, horizon_days + 1):
                    target_date = anchor_date + timedelta(days=step)
                    target_dt = pd.to_datetime(target_date)

                    # Calendar features
                    day_of_week = target_dt.dayofweek
                    day_of_month = target_dt.day
                    month = target_dt.month
                    is_weekend = 1 if day_of_week in [5, 6] else 0

                    # Calculate lags from sim_history
                    # Lags: t-1, t-7, t-14, t-30
                    sales_series = sim_history["daily_sales"].values
                    lag_1 = float(sales_series[-1]) if len(sales_series) >= 1 else 0.0
                    lag_7 = float(sales_series[-7]) if len(sales_series) >= 7 else lag_1
                    lag_14 = float(sales_series[-14]) if len(sales_series) >= 14 else lag_7
                    lag_30 = float(sales_series[-30]) if len(sales_series) >= 30 else lag_14

                    # Rolling means strictly up to t-1
                    r7 = float(np.mean(sales_series[-7:])) if len(sales_series) >= 7 else float(np.mean(sales_series))
                    r14 = float(np.mean(sales_series[-14:])) if len(sales_series) >= 14 else r7
                    r30 = float(np.mean(sales_series[-30:])) if len(sales_series) >= 30 else r14

                    # Feature vector DataFrame
                    features = pd.DataFrame([{
                        "day_of_week": day_of_week,
                        "day_of_month": day_of_month,
                        "month": month,
                        "is_weekend": is_weekend,
                        "lag_1": lag_1,
                        "lag_7": lag_7,
                        "lag_14": lag_14,
                        "lag_30": lag_30,
                        "rolling_mean_7": r7,
                        "rolling_mean_14": r14,
                        "rolling_mean_30": r30
                    }])[FEATURE_COLUMNS]

                    # Predict next day demand
                    raw_pred = model.predict(features)[0]
                    # Non-negative constraint
                    pred_qty = max(0.0, round(float(raw_pred), 1))

                    daily_forecasts.append(
                        DailyForecast(
                            date=target_date.strftime("%Y-%m-%d"),
                            day_index=step,
                            predicted_quantity=pred_qty
                        )
                    )

                    # Append to simulation history for subsequent recursive steps
                    new_row = pd.DataFrame([{"date": target_date, "daily_sales": pred_qty}])
                    sim_history = pd.concat([sim_history, new_row], ignore_index=True)

            except Exception as e:
                logger.error(f"Error during XGBoost inference: {e}. Falling back to baseline.", exc_info=True)
                use_xgboost = False

        if not use_xgboost:
            # Fallback to moving average / historical baseline
            model_type = "MovingAverageBaseline"
            status = "FALLBACK_INSUFFICIENT_HISTORY"
            notes = "Insufficient historical observations (< 35 days) for reliable XGBoost training. Applied Moving Average baseline fallback."

            if not df_prepared.empty and (df_prepared["daily_sales"] > 0).any():
                recent_sales = df_prepared.tail(14)["daily_sales"].values
                avg_val = float(np.mean(recent_sales)) if len(recent_sales) > 0 else 0.0
            else:
                avg_val = 0.0

            daily_avg = max(0.0, round(avg_val, 1))

            for step in range(1, horizon_days + 1):
                target_date = anchor_date + timedelta(days=step)
                daily_forecasts.append(
                    DailyForecast(
                        date=target_date.strftime("%Y-%m-%d"),
                        day_index=step,
                        predicted_quantity=daily_avg
                    )
                )

        total_predicted = round(sum(d.predicted_quantity for d in daily_forecasts), 1)
        avg_daily = round(total_predicted / max(1, horizon_days), 2)

        # 5. Inventory & Reorder Calculations
        inv_status = DataExtractor.get_inventory_status(product_id, warehouse_id)
        current_physical = inv_status["current_physical_stock"]
        reserved_stock = inv_status["reserved_stock"]
        available_stock = inv_status["available_stock"]

        confirmed_incoming = DataExtractor.get_confirmed_incoming_stock(product_id, warehouse_id)

        lead_time = product["lead_time_days"]
        safety_stock = product["safety_stock"]

        # Expected future stock = Current On-Hand + Confirmed Incoming - Predicted Demand - Reserved
        expected_future = max(0.0, round(current_physical + confirmed_incoming - total_predicted - reserved_stock, 1))

        # Reorder Point = (Average Daily Demand * Lead Time) + Safety Stock
        reorder_point = round((avg_daily * lead_time) + safety_stock, 1)

        # Reorder recommendation logic
        # If available stock + incoming is below reorder point, recommend order
        effective_stock = available_stock + confirmed_incoming
        is_reorder_recommended = effective_stock <= reorder_point

        if is_reorder_recommended:
            # Recommend ordering enough to cover lead time demand + safety buffer
            target_stock = round((reorder_point * 1.5), 1)
            suggested_reorder_qty = max(0.0, round(target_stock - effective_stock, 1))
        else:
            suggested_reorder_qty = 0.0

        inventory_snapshot = InventorySnapshot(
            current_physical_stock=current_physical,
            reserved_stock=reserved_stock,
            available_stock=available_stock,
            confirmed_incoming_stock=confirmed_incoming,
            lead_time_days=lead_time,
            safety_stock=safety_stock,
            expected_future_stock=expected_future,
            reorder_point=reorder_point,
            suggested_reorder_quantity=suggested_reorder_qty,
            is_reorder_recommended=is_reorder_recommended
        )

        # 6. Persist Forecast in MongoDB
        try:
            forecast_coll = get_collection("forecasthistories")
            record_doc = {
                "product": ObjectId(product_id),
                "warehouse": ObjectId(warehouse_id) if warehouse_id else None,
                "horizonDays": horizon_days,
                "forecastDate": datetime.utcnow(),
                "predictedDemand": total_predicted,
                "dailyForecasts": [d.model_dump() for d in daily_forecasts],
                "historicalSalesData": [h.model_dump() for h in recent_history],
                "modelDetails": {
                    "modelType": model_type,
                    "modelVersion": model_version,
                    "featuresUsed": FEATURE_COLUMNS if use_xgboost else [],
                    "metrics": metrics.model_dump()
                },
                "inventorySnapshot": inventory_snapshot.model_dump(),
                "generatedBy": ObjectId(user_id) if user_id else None,
                "status": status,
                "notes": notes,
                "createdAt": datetime.utcnow(),
                "updatedAt": datetime.utcnow()
            }
            forecast_coll.insert_one(record_doc)
            logger.info("Persisted forecast prediction record to MongoDB.")
        except Exception as e:
            logger.warning(f"Failed to persist forecast to MongoDB: {e}")

        return PredictResponse(
            product_id=product_id,
            product_name=product["product_name"],
            sku=product.get("sku"),
            warehouse_id=warehouse_id,
            warehouse_name=warehouse_name,
            horizon_days=horizon_days,
            forecast_date=datetime.utcnow().strftime("%Y-%m-%d"),
            total_predicted_demand=total_predicted,
            average_daily_demand=avg_daily,
            daily_forecasts=daily_forecasts,
            historical_sales_data=recent_history,
            model_type=model_type,
            model_version=model_version,
            metrics=metrics,
            inventory_snapshot=inventory_snapshot,
            status=status,
            notes=notes
        )

