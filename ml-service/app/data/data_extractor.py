from datetime import datetime
from typing import Dict, List, Optional, Any
from bson import ObjectId
import pandas as pd
from app.database import get_collection
from app.utils.logger import logger

class DataExtractor:
    """
    Extracts sales, inventory, product, and receipt data from MongoDB.
    Grounded in actual dispatched stock movements and fulfilled sales.
    """

    @staticmethod
    def extract_dispatched_sales(
        product_id: Optional[str] = None,
        warehouse_id: Optional[str] = None
    ) -> pd.DataFrame:
        """
        Extract historical actual dispatched sales from MongoDB.
        Primary source: StockMovement collection with type='STOCK_OUT' and referenceType='SALE'.
        Cross-referenced with SalesOrder status (excluding DRAFT, CANCELLED).
        """
        logger.info(f"Extracting dispatched sales: product_id={product_id}, warehouse_id={warehouse_id}")
        stock_mov_coll = get_collection("stockmovements")
        sales_order_coll = get_collection("salesorders")

        # 1. Fetch valid non-cancelled sales order IDs to avoid counting cancelled dispatches
        invalid_orders = sales_order_coll.find(
            {"status": {"$in": ["DRAFT", "CANCELLED"]}},
            {"_id": 1}
        )
        invalid_order_ids = {str(o["_id"]) for o in invalid_orders}

        # 2. Build match query for StockMovements
        query: Dict[str, Any] = {
            "type": "STOCK_OUT",
            "referenceType": "SALE"
        }

        if product_id:
            try:
                query["product"] = ObjectId(product_id)
            except Exception:
                query["product"] = product_id

        if warehouse_id:
            try:
                query["warehouse"] = ObjectId(warehouse_id)
            except Exception:
                query["warehouse"] = warehouse_id

        cursor = stock_mov_coll.find(query).sort("createdAt", 1)
        records = []

        for doc in cursor:
            # Check if referenceId points to an invalid or cancelled order
            ref_id_str = str(doc.get("referenceId", ""))
            if ref_id_str in invalid_order_ids:
                continue

            p_id = str(doc.get("product"))
            w_id = str(doc.get("warehouse"))
            qty = float(doc.get("quantity", 0))
            created_at = doc.get("createdAt")

            if not created_at or qty <= 0:
                continue

            if isinstance(created_at, str):
                try:
                    dt = pd.to_datetime(created_at).date()
                except Exception:
                    continue
            else:
                dt = created_at.date()

            records.append({
                "date": dt,
                "product_id": p_id,
                "warehouse_id": w_id,
                "quantity": qty
            })

        # Fallback/supplement: Check SalesOrders with FULFILLED/SHIPPED/DELIVERED status
        # if StockMovement had no records (e.g. legacy orders)
        if not records:
            logger.info("StockMovements empty for query; checking fulfilled SalesOrders directly...")
            so_query: Dict[str, Any] = {
                "status": {"$in": ["FULFILLED", "SHIPPED", "DELIVERED"]}
            }
            if warehouse_id:
                try:
                    so_query["warehouse"] = ObjectId(warehouse_id)
                except Exception:
                    so_query["warehouse"] = warehouse_id

            so_cursor = sales_order_coll.find(so_query).sort("createdAt", 1)
            for order in so_cursor:
                order_date = order.get("createdAt")
                if not order_date:
                    continue
                o_dt = order_date.date() if hasattr(order_date, "date") else pd.to_datetime(order_date).date()
                o_w_id = str(order.get("warehouse", "UNKNOWN"))

                items = order.get("items", [])
                for item in items:
                    item_p_id = str(item.get("product"))
                    if product_id and item_p_id != str(product_id):
                        continue
                    item_qty = float(item.get("quantity", 0))
                    if item_qty > 0:
                        records.append({
                            "date": o_dt,
                            "product_id": item_p_id,
                            "warehouse_id": o_w_id,
                            "quantity": item_qty
                        })

        df = pd.DataFrame(records)
        if df.empty:
            logger.warning("No sales records found for specified query.")
            return pd.DataFrame(columns=["date", "product_id", "warehouse_id", "daily_sales"])

        # Aggregate multiple dispatches within the same day for product-warehouse pair
        df_daily = df.groupby(["date", "product_id", "warehouse_id"])["quantity"].sum().reset_index()
        df_daily.rename(columns={"quantity": "daily_sales"}, inplace=True)
        df_daily.sort_values(by=["product_id", "warehouse_id", "date"], inplace=True)
        return df_daily

    @staticmethod
    def get_product_details(product_id: str) -> Optional[Dict[str, Any]]:
        """Fetch metadata for a given product."""
        coll = get_collection("products")
        try:
            doc = coll.find_one({"_id": ObjectId(product_id)})
        except Exception:
            doc = coll.find_one({"_id": product_id})

        if not doc:
            return None

        return {
            "product_id": str(doc["_id"]),
            "product_name": doc.get("productName", "Unknown Product"),
            "sku": doc.get("sku", ""),
            "category": str(doc.get("category", "")),
            "lead_time_days": int(doc.get("leadTimeDays", 7)),
            "safety_stock": float(doc.get("safetyStock", 0)),
            "unit_price": float(doc.get("unitPrice", 0)),
            "unit": doc.get("unit", "units")
        }

    @staticmethod
    def get_warehouse_details(warehouse_id: Optional[str]) -> Optional[Dict[str, Any]]:
        """Fetch metadata for a given warehouse."""
        if not warehouse_id:
            return None
        coll = get_collection("warehouses")
        try:
            doc = coll.find_one({"_id": ObjectId(warehouse_id)})
        except Exception:
            doc = coll.find_one({"_id": warehouse_id})

        if not doc:
            return None

        return {
            "warehouse_id": str(doc["_id"]),
            "warehouse_name": doc.get("warehouseName", "Unknown Warehouse"),
            "location": doc.get("location", "")
        }

    @staticmethod
    def get_inventory_status(product_id: str, warehouse_id: Optional[str] = None) -> Dict[str, float]:
        """
        Fetch current inventory numbers:
        Physical on-hand quantity, reservedStock, availableStock = quantity - reservedStock.
        """
        inv_coll = get_collection("inventories")
        query: Dict[str, Any] = {}
        try:
            query["product"] = ObjectId(product_id)
        except Exception:
            query["product"] = product_id

        if warehouse_id:
            try:
                query["warehouse"] = ObjectId(warehouse_id)
            except Exception:
                query["warehouse"] = warehouse_id

        docs = list(inv_coll.find(query))
        total_quantity = sum(float(d.get("quantity", 0)) for d in docs)
        total_reserved = sum(float(d.get("reservedStock", 0)) for d in docs)
        available = max(0.0, total_quantity - total_reserved)

        return {
            "current_physical_stock": total_quantity,
            "reserved_stock": total_reserved,
            "available_stock": available
        }

    @staticmethod
    def get_confirmed_incoming_stock(product_id: str, warehouse_id: Optional[str] = None) -> float:
        """
        Calculate confirmed incoming supply from Goods Receipts (accepted quantities).
        Only physically accepted quantities are counted.
        """
        grn_coll = get_collection("goodsreceipts")
        query: Dict[str, Any] = {}
        if warehouse_id:
            try:
                query["warehouse"] = ObjectId(warehouse_id)
            except Exception:
                query["warehouse"] = warehouse_id

        cursor = grn_coll.find(query)
        total_accepted = 0.0
        for grn in cursor:
            items = grn.get("items", [])
            for it in items:
                it_pid = str(it.get("product"))
                if it_pid == str(product_id):
                    total_accepted += float(it.get("acceptedQuantity", 0))

        return total_accepted

