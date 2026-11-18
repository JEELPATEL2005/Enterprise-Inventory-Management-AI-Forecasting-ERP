import pandas as pd
import numpy as np
from typing import List, Tuple
from app.utils.logger import logger

FEATURE_COLUMNS = [
    "day_of_week",
    "day_of_month",
    "month",
    "is_weekend",
    "lag_1",
    "lag_7",
    "lag_14",
    "lag_30",
    "rolling_mean_7",
    "rolling_mean_14",
    "rolling_mean_30"
]

class FeatureEngineer:
    """
    Constructs time-series features: calendar flags, historical lags, and rolling statistics.
    Strictly prevents future data leakage.
    """

    @staticmethod
    def add_calendar_features(df: pd.DataFrame) -> pd.DataFrame:
        """Add calendar-based features derived from date."""
        df = df.copy()
        dates = pd.to_datetime(df["date"])
        df["day_of_week"] = dates.dt.dayofweek
        df["day_of_month"] = dates.dt.day
        df["month"] = dates.dt.month
        df["is_weekend"] = df["day_of_week"].apply(lambda d: 1 if d in [5, 6] else 0)
        return df

    @staticmethod
    def add_lag_and_rolling_features(df: pd.DataFrame, drop_na: bool = True) -> pd.DataFrame:
        """
        Creates lag and rolling mean features per product-warehouse series.
        Applies shift(1) before rolling to guarantee ZERO data leakage from target day t.
        """
        df = df.copy()
        df.sort_values(by=["product_id", "warehouse_id", "date"], inplace=True)

        dfs = []
        for (p_id, w_id), group in df.groupby(["product_id", "warehouse_id"]):
            group = group.copy().sort_values("date").reset_index(drop=True)

            # Lag features (sales at t-1, t-7, t-14, t-30)
            group["lag_1"] = group["daily_sales"].shift(1)
            group["lag_7"] = group["daily_sales"].shift(7)
            group["lag_14"] = group["daily_sales"].shift(14)
            group["lag_30"] = group["daily_sales"].shift(30)

            # Rolling means: strictly shift(1) first to avoid leaking day t sales
            shifted_sales = group["daily_sales"].shift(1)
            group["rolling_mean_7"] = shifted_sales.rolling(window=7, min_periods=1).mean()
            group["rolling_mean_14"] = shifted_sales.rolling(window=14, min_periods=1).mean()
            group["rolling_mean_30"] = shifted_sales.rolling(window=30, min_periods=1).mean()

            # Backfill initial lags if dataset is smaller or at start, but drop_na controls strict training set
            if not drop_na:
                group["lag_1"] = group["lag_1"].bfill().fillna(0.0)
                group["lag_7"] = group["lag_7"].bfill().fillna(0.0)
                group["lag_14"] = group["lag_14"].bfill().fillna(0.0)
                group["lag_30"] = group["lag_30"].bfill().fillna(0.0)
                group["rolling_mean_7"] = group["rolling_mean_7"].fillna(0.0)
                group["rolling_mean_14"] = group["rolling_mean_14"].fillna(0.0)
                group["rolling_mean_30"] = group["rolling_mean_30"].fillna(0.0)

            dfs.append(group)

        if not dfs:
            return df

        combined = pd.concat(dfs, ignore_index=True)
        if drop_na:
            # Drop rows with NaN in any feature column for clean model training
            combined.dropna(subset=FEATURE_COLUMNS, inplace=True)
            combined.reset_index(drop=True, inplace=True)

        return combined

    @classmethod
    def transform_pipeline(cls, df: pd.DataFrame, drop_na: bool = True) -> pd.DataFrame:
        """Full end-to-end feature extraction pipeline."""
        df = cls.add_calendar_features(df)
        df = cls.add_lag_and_rolling_features(df, drop_na=drop_na)
        return df

