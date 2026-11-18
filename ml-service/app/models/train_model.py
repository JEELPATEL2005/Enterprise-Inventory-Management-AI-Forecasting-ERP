import json
import os
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, Tuple
import joblib
import numpy as np
import pandas as pd
from xgboost import XGBRegressor

from app.config import MODEL_DIR
from app.data.data_extractor import DataExtractor
from app.data.preprocessing import DataPreprocessor
from app.data.feature_engineering import FeatureEngineer, FEATURE_COLUMNS
from app.models.evaluate import evaluate_predictions, evaluate_moving_average_baseline
from app.utils.logger import logger

class ModelTrainer:
    """
    Handles chronological train/validation/test splitting, XGBoost model training,
    baseline comparisons (MAE, RMSE, WAPE), and model persistence.
    """

    @staticmethod
    def get_model_filename(product_id: str, warehouse_id: Optional[str] = None) -> Tuple[Path, Path]:
        w_suffix = warehouse_id if warehouse_id else "ALL"
        base_name = f"model_{product_id}_{w_suffix}"
        model_path = MODEL_DIR / f"{base_name}.joblib"
        meta_path = MODEL_DIR / f"{base_name}_meta.json"
        return model_path, meta_path

    @classmethod
    def train_single_series(
        cls,
        product_id: str,
        warehouse_id: Optional[str] = None,
        force_retrain: bool = False
    ) -> Dict[str, Any]:
        """
        Trains an XGBoost regressor for a single product and warehouse (or all warehouses).
        """
        logger.info(f"Training request for product={product_id}, warehouse={warehouse_id}")
        model_path, meta_path = cls.get_model_filename(product_id, warehouse_id)

        # 1. Extract raw dispatched sales
        df_raw = DataExtractor.extract_dispatched_sales(product_id=product_id, warehouse_id=warehouse_id)
        if df_raw.empty:
            logger.warning(f"No sales data found for product={product_id}, warehouse={warehouse_id}")
            return {
                "status": "NO_DATA",
                "message": "No sales records found in MongoDB for this product/warehouse combination.",
                "product_id": product_id,
                "warehouse_id": warehouse_id
            }

        # 2. Aggregation if global
        if not warehouse_id:
            df_prepared = DataPreprocessor.aggregate_across_warehouses(df_raw)
        else:
            df_prepared = df_raw

        # 3. Continuous daily sequence alignment
        df_series = DataPreprocessor.prepare_daily_series(df_prepared)

        # Check data sufficiency
        total_days = len(df_series)
        non_zero_days = int((df_series["daily_sales"] > 0).sum())

        logger.info(f"Series summary: {total_days} total days, {non_zero_days} non-zero sales days")

        if total_days < 35 or non_zero_days < 5:
            logger.warning(f"Insufficient historical data ({total_days} days, {non_zero_days} active sales). Need at least 35 days.")
            return {
                "status": "INSUFFICIENT_DATA",
                "message": f"Product has only {total_days} days of history ({non_zero_days} active sales). Minimum 35 days required for lag features.",
                "product_id": product_id,
                "warehouse_id": warehouse_id,
                "total_days": total_days,
                "non_zero_days": non_zero_days
            }

        # 4. Feature engineering
        df_features = FeatureEngineer.transform_pipeline(df_series, drop_na=True)
        if len(df_features) < 10:
            logger.warning("Too few records after feature engineering window drop.")
            return {
                "status": "INSUFFICIENT_DATA",
                "message": "Insufficient data points after 30-day lag feature calculation.",
                "product_id": product_id,
                "warehouse_id": warehouse_id
            }

        # 5. Chronological Train-Test Split (Strictly temporal: 80% train, 20% test)
        n = len(df_features)
        test_size = max(5, int(n * 0.2))
        train_size = n - test_size

        train_df = df_features.iloc[:train_size].copy()
        test_df = df_features.iloc[train_size:].copy()

        X_train = train_df[FEATURE_COLUMNS]
        y_train = train_df["daily_sales"].values

        X_test = test_df[FEATURE_COLUMNS]
        y_test = test_df["daily_sales"].values

        logger.info(f"Dataset split: train={len(X_train)} samples, test={len(X_test)} samples")

        # 6. Fit XGBoost Regressor
        model = XGBRegressor(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.85,
            colsample_bytree=0.85,
            random_state=42,
            objective="reg:squarederror",
            n_jobs=1
        )
        model.fit(X_train, y_train)

        # 7. Evaluate on chronological test set
        y_pred = np.clip(model.predict(X_test), 0.0, None)
        metrics = evaluate_predictions(y_test, y_pred)

        # 8. Compute moving average baseline on same test segment
        baseline_metrics = evaluate_moving_average_baseline(
            df_features["daily_sales"].values,
            window=7,
            test_size=test_size
        )

        metrics.update(baseline_metrics)
        metrics["samples_count"] = n
        metrics["train_samples"] = train_size
        metrics["test_samples"] = test_size

        is_xgboost_better = metrics["rmse"] <= metrics.get("baseline_rmse", float("inf"))

        # 9. Retrain on full dataset for future production forecasting
        full_model = XGBRegressor(
            n_estimators=100,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.85,
            colsample_bytree=0.85,
            random_state=42,
            objective="reg:squarederror",
            n_jobs=1
        )
        full_model.fit(df_features[FEATURE_COLUMNS], df_features["daily_sales"].values)

        # 10. Persist Model and Metadata
        joblib.dump(full_model, model_path)

        metadata = {
            "product_id": product_id,
            "warehouse_id": warehouse_id if warehouse_id else "ALL",
            "model_version": "1.0.0",
            "trained_at": datetime.utcnow().isoformat(),
            "features_used": FEATURE_COLUMNS,
            "metrics": metrics,
            "is_xgboost_better": is_xgboost_better,
            "comparison": {
                "xgboost_rmse": metrics["rmse"],
                "baseline_rmse": metrics.get("baseline_rmse"),
                "xgboost_mae": metrics["mae"],
                "baseline_mae": metrics.get("baseline_mae"),
                "xgboost_wape": metrics["wape"],
                "baseline_wape": metrics.get("baseline_wape")
            }
        }

        with open(meta_path, "w") as f:
            json.dump(metadata, f, indent=2)

        logger.info(f"Model successfully saved to {model_path}. Evaluation: RMSE={metrics['rmse']}, Baseline RMSE={metrics['baseline_rmse']}")

        return {
            "status": "TRAINED",
            "message": "Model trained and evaluated successfully.",
            "product_id": product_id,
            "warehouse_id": warehouse_id,
            "metrics": metrics,
            "is_xgboost_better": is_xgboost_better
        }

    @classmethod
    def train_all_active_products(cls, force_retrain: bool = False) -> Dict[str, Any]:
        """
        Discovers all products with sales records and trains models for each.
        """
        raw_df = DataExtractor.extract_dispatched_sales()
        if raw_df.empty:
            return {"status": "NO_DATA", "models_trained": 0, "details": {}}

        unique_products = raw_df["product_id"].unique()
        trained_count = 0
        details = {}

        for p_id in unique_products:
            # Train global model for product
            res_global = cls.train_single_series(product_id=p_id, warehouse_id=None, force_retrain=force_retrain)
            details[f"{p_id}_ALL"] = res_global
            if res_global.get("status") == "TRAINED":
                trained_count += 1

            # Train warehouse-specific models for product
            p_df = raw_df[raw_df["product_id"] == p_id]
            for w_id in p_df["warehouse_id"].unique():
                res_w = cls.train_single_series(product_id=p_id, warehouse_id=w_id, force_retrain=force_retrain)
                details[f"{p_id}_{w_id}"] = res_w
                if res_w.get("status") == "TRAINED":
                    trained_count += 1

        return {
            "status": "SUCCESS",
            "models_trained": trained_count,
            "total_candidates": len(details),
            "details": details
        }

