import pandas as pd
import numpy as np
from datetime import date, timedelta
from typing import Optional, Tuple
from app.utils.logger import logger

class DataPreprocessor:
    """
    Cleans, aligns, and standardizes historical daily sales data for time-series ML modeling.
    """

    @staticmethod
    def prepare_daily_series(
        df: pd.DataFrame,
        fill_missing_dates: bool = True,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> pd.DataFrame:
        """
        Creates a continuous daily time series for each (product_id, warehouse_id) pair.
        Missing sales dates are filled with 0.0 sales.
        Chronological ordering is strictly enforced.
        """
        if df.empty:
            logger.warning("DataPreprocessor received an empty DataFrame.")
            return pd.DataFrame(columns=["date", "product_id", "warehouse_id", "daily_sales"])

        df = df.copy()
        df["date"] = pd.to_datetime(df["date"]).dt.date
        df["daily_sales"] = pd.to_numeric(df["daily_sales"], errors="coerce").fillna(0.0)
        df["daily_sales"] = df["daily_sales"].clip(lower=0.0)

        # Process each group
        processed_groups = []
        groups = df.groupby(["product_id", "warehouse_id"])

        for (p_id, w_id), group in groups:
            group = group.drop_duplicates(subset=["date"]).sort_values("date")

            if fill_missing_dates:
                g_start = start_date or group["date"].min()
                g_end = end_date or max(group["date"].max(), date.today())

                if g_start > g_end:
                    g_start = group["date"].min()

                full_idx = pd.date_range(start=g_start, end=g_end, freq="D").date
                full_df = pd.DataFrame({"date": full_idx})
                full_df["product_id"] = p_id
                full_df["warehouse_id"] = w_id

                merged = pd.merge(full_df, group[["date", "daily_sales"]], on="date", how="left")
                merged["daily_sales"] = merged["daily_sales"].fillna(0.0)
                processed_groups.append(merged)
            else:
                processed_groups.append(group)

        if not processed_groups:
            return pd.DataFrame(columns=["date", "product_id", "warehouse_id", "daily_sales"])

        result = pd.concat(processed_groups, ignore_index=True)
        result.sort_values(by=["product_id", "warehouse_id", "date"], inplace=True)
        result.reset_index(drop=True, inplace=True)
        return result

    @staticmethod
    def aggregate_across_warehouses(df: pd.DataFrame) -> pd.DataFrame:
        """
        Aggregates daily sales across all warehouses for global product-level forecasting.
        """
        if df.empty:
            return df

        df = df.copy()
        agg = df.groupby(["date", "product_id"])["daily_sales"].sum().reset_index()
        agg["warehouse_id"] = "ALL"
        agg.sort_values(by=["product_id", "date"], inplace=True)
        agg.reset_index(drop=True, inplace=True)
        return agg

