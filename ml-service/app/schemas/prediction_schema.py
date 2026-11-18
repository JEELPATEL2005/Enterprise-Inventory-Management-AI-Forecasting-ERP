from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field

class TrainRequest(BaseModel):
    product_id: Optional[str] = Field(None, description="Optional specific product ID to train. If None, trains all eligible products.")
    warehouse_id: Optional[str] = Field(None, description="Optional specific warehouse ID to train. If None, trains warehouse-specific and global models.")
    force_retrain: bool = Field(False, description="Whether to overwrite existing models even if recently trained.")

class TrainResponse(BaseModel):
    status: str
    message: str
    models_trained: int
    details: Dict[str, Any] = {}

class PredictRequest(BaseModel):
    product_id: str = Field(..., description="Target product ID to forecast demand for.")
    warehouse_id: Optional[str] = Field(None, description="Optional warehouse ID. If omitted, forecasts total demand across all warehouses.")
    horizon_days: int = Field(7, description="Forecast horizon in days (7, 15, or 30).")

class DailyForecast(BaseModel):
    date: str
    day_index: int
    predicted_quantity: float

class HistoricalSalesPoint(BaseModel):
    date: str
    actual_quantity: float

class EvaluationMetrics(BaseModel):
    mae: Optional[float] = None
    rmse: Optional[float] = None
    wape: Optional[float] = None
    baseline_mae: Optional[float] = None
    baseline_rmse: Optional[float] = None
    baseline_wape: Optional[float] = None
    samples_count: Optional[int] = None

class InventorySnapshot(BaseModel):
    current_physical_stock: float = 0.0
    reserved_stock: float = 0.0
    available_stock: float = 0.0
    confirmed_incoming_stock: float = 0.0
    lead_time_days: int = 7
    safety_stock: float = 0.0
    expected_future_stock: float = 0.0
    reorder_point: float = 0.0
    suggested_reorder_quantity: float = 0.0
    is_reorder_recommended: bool = False

class PredictResponse(BaseModel):
    product_id: str
    product_name: str
    sku: Optional[str] = None
    warehouse_id: Optional[str] = None
    warehouse_name: Optional[str] = None
    horizon_days: int
    forecast_date: str
    total_predicted_demand: float
    average_daily_demand: float
    daily_forecasts: List[DailyForecast]
    historical_sales_data: List[HistoricalSalesPoint]
    model_type: str
    model_version: str
    metrics: EvaluationMetrics
    inventory_snapshot: InventorySnapshot
    status: str
    notes: str

class MetricsResponse(BaseModel):
    models: Dict[str, Any]
    total_models: int
    last_trained: Optional[str] = None
    system_health: str

