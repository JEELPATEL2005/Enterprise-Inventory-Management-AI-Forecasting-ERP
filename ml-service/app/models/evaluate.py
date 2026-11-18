import numpy as np
from typing import Dict, Any, Optional
from app.utils.logger import logger

def calculate_mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(y_true - y_pred)))

def calculate_rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))

def calculate_wape(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    sum_actual = np.sum(y_true)
    if sum_actual == 0:
        return 0.0 if np.sum(np.abs(y_true - y_pred)) == 0 else 100.0
    return float((np.sum(np.abs(y_true - y_pred)) / sum_actual) * 100.0)

def evaluate_predictions(y_true: np.ndarray, y_pred: np.ndarray) -> Dict[str, float]:
    """Computes MAE, RMSE, and WAPE between ground truth and predicted arrays."""
    y_true = np.array(y_true, dtype=float)
    y_pred = np.clip(np.array(y_pred, dtype=float), 0.0, None)

    if len(y_true) == 0:
        return {"mae": 0.0, "rmse": 0.0, "wape": 0.0}

    return {
        "mae": round(calculate_mae(y_true, y_pred), 4),
        "rmse": round(calculate_rmse(y_true, y_pred), 4),
        "wape": round(calculate_wape(y_true, y_pred), 2)
    }

def evaluate_moving_average_baseline(
    series: np.ndarray,
    window: int = 7,
    test_size: int = 14
) -> Dict[str, float]:
    """
    Computes baseline metrics using a simple moving average over recent historical sales.
    """
    if len(series) < test_size + window:
        return {"baseline_mae": 0.0, "baseline_rmse": 0.0, "baseline_wape": 0.0}

    test_actuals = series[-test_size:]
    train_series = list(series[:-test_size])

    baseline_preds = []
    for actual in test_actuals:
        # moving average of last `window` values in train_series
        window_vals = train_series[-window:]
        pred = float(np.mean(window_vals)) if window_vals else 0.0
        baseline_preds.append(max(0.0, pred))
        train_series.append(actual)

    eval_res = evaluate_predictions(test_actuals, np.array(baseline_preds))
    return {
        "baseline_mae": eval_res["mae"],
        "baseline_rmse": eval_res["rmse"],
        "baseline_wape": eval_res["wape"]
    }

