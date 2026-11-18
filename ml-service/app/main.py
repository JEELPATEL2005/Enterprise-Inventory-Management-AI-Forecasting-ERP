import os
from datetime import datetime
import json
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import FastAPI, HTTPException, Header, Depends, status
from fastapi.middleware.cors import CORSMiddleware

from app.config import PORT, HOST, INTERNAL_SERVICE_KEY, MODEL_DIR
from app.database import get_db
from app.models.train_model import ModelTrainer
from app.models.predict import DemandPredictor
from app.schemas.prediction_schema import (
    TrainRequest,
    TrainResponse,
    PredictRequest,
    PredictResponse,
    MetricsResponse
)
from app.utils.logger import logger

app = FastAPI(
    title="Inventory Demand Forecasting ML Service",
    description="XGBoost-based daily demand forecasting engine with recursive multi-step forecasting.",
    version="1.0.0"
)

# Enable CORS for local dev / microservice communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def verify_internal_auth(x_internal_key: Optional[str] = Header(None)):
    """
    Optional authentication layer for internal service-to-service communication.
    """
    allowed_keys = {
        INTERNAL_SERVICE_KEY,
        "erp-ai-internal-secret-key-359",
        "inventory_internal_ml_secret_key_2026"
    }
    if x_internal_key and x_internal_key not in allowed_keys:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid internal service key."
        )
    return True

@app.get("/api/ml/health")
def health_check():
    """Service health and database connectivity check."""
    db_connected = False
    try:
        db = get_db()
        db.command("ping")
        db_connected = True
    except Exception as e:
        logger.warning(f"Health check db ping failed: {e}")

    model_files = list(MODEL_DIR.glob("*.joblib"))

    return {
        "status": "healthy" if db_connected else "degraded",
        "service": "inventory-ml-forecasting",
        "version": "1.0.0",
        "database_connected": db_connected,
        "available_models_count": len(model_files),
        "timestamp": datetime.utcnow().isoformat()
    }

@app.post("/api/ml/train", response_model=TrainResponse)
def train_model(payload: TrainRequest, _auth: bool = Depends(verify_internal_auth)):
    """
    Train XGBoost demand forecast models.
    Can train for a specific product/warehouse, or all active products.
    """
    try:
        logger.info(f"Received train request: product_id={payload.product_id}, warehouse_id={payload.warehouse_id}")

        if payload.product_id:
            res = ModelTrainer.train_single_series(
                product_id=payload.product_id,
                warehouse_id=payload.warehouse_id,
                force_retrain=payload.force_retrain
            )
            is_trained = res.get("status") == "TRAINED"
            return TrainResponse(
                status=res.get("status", "COMPLETED"),
                message=res.get("message", "Training process finished."),
                models_trained=1 if is_trained else 0,
                details=res
            )
        else:
            res = ModelTrainer.train_all_active_products(force_retrain=payload.force_retrain)
            return TrainResponse(
                status=res.get("status", "COMPLETED"),
                message=f"Trained {res.get('models_trained', 0)} model(s).",
                models_trained=res.get("models_trained", 0),
                details=res.get("details", {})
            )
    except Exception as e:
        logger.error(f"Error training models: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/ml/predict", response_model=PredictResponse)
def predict_demand(payload: PredictRequest, _auth: bool = Depends(verify_internal_auth)):
    """
    Generate 7, 15, or 30-day demand forecast for a product and optional warehouse.
    """
    if payload.horizon_days not in [7, 15, 30]:
        raise HTTPException(
            status_code=400,
            detail="Horizon days must be one of [7, 15, 30]."
        )

    try:
        forecast = DemandPredictor.predict(
            product_id=payload.product_id,
            warehouse_id=payload.warehouse_id,
            horizon_days=payload.horizon_days
        )
        return forecast
    except ValueError as ve:
        raise HTTPException(status_code=404, detail=str(ve))
    except Exception as e:
        logger.error(f"Error predicting demand: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/ml/metrics")
def get_model_metrics(_auth: bool = Depends(verify_internal_auth)):
    """
    Inspect evaluation metrics for all saved models.
    """
    meta_files = list(MODEL_DIR.glob("*_meta.json"))
    models_info = {}
    last_trained = None

    for mf in meta_files:
        try:
            with open(mf, "r") as f:
                data = json.load(f)
                key = f"{data.get('product_id')}_{data.get('warehouse_id')}"
                models_info[key] = data
                t_at = data.get("trained_at")
                if t_at and (last_trained is None or t_at > last_trained):
                    last_trained = t_at
        except Exception as e:
            logger.warning(f"Could not read metadata from {mf}: {e}")

    return {
        "total_models": len(models_info),
        "last_trained": last_trained,
        "models": models_info,
        "system_health": "operational"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=True)
