from typing import Dict, Any, List, Optional
from app.core.database import get_db

def _check_sales_permission(user_context: dict) -> bool:
    role = user_context.get("role", "EMPLOYEE")
    return role in ["SUPER_ADMIN", "ADMIN", "SALES_MANAGER"]

def get_sales_orders(user_context: dict, status: Optional[str] = None, limit: int = 20) -> Dict[str, Any]:
    """Retrieves customer sales orders, optionally filtered by status (PENDING, CONFIRMED, SHIPPED, DELIVERED)."""
    if not _check_sales_permission(user_context):
        return {
            "title": "Sales Orders",
            "summary": "Access Denied: You do not have authorization to view commercial sales records.",
            "data": [],
        }

    db = get_db()
    query = {}
    if status and status.upper() != "ALL":
        query["status"] = status.upper()

    orders = list(db.salesorders.find(query).sort("createdAt", -1).limit(min(limit, 50)))
    if not orders:
        return {"title": "Sales Orders", "summary": "No sales orders found matching criteria.", "data": []}

    cust_ids = list(set(o["customer"] for o in orders if "customer" in o))
    customers = {str(c["_id"]): c.get("customerName", "Client") for c in db.customers.find({"_id": {"$in": cust_ids}}, {"customerName": 1})}

    rows = []
    for so in orders:
        so_num = so.get("salesOrderNumber") or "SO-REF"
        c_name = customers.get(str(so.get("customer")), "Customer")
        amt = float(so.get("totalAmount", 0))
        st = so.get("status", "PENDING")
        order_date = so.get("orderDate").strftime("%Y-%m-%d") if so.get("orderDate") else "—"
        delivery_date = so.get("deliveryDate").strftime("%Y-%m-%d") if so.get("deliveryDate") else "—"

        rows.append({
            "Sales Order": so_num,
            "Customer": c_name,
            "Order Date": order_date,
            "Delivery Target": delivery_date,
            "Total Value": f"${amt:,.2f}",
            "Status": st,
        })

    return {
        "title": f"Commercial Sales Orders ({len(rows)} Records)",
        "summary": f"Listing latest **{len(rows)}** sales orders.",
        "data": rows,
    }

def get_sales_summary(user_context: dict) -> Dict[str, Any]:
    """Summarizes overall sales revenue, order volumes, and order fulfillment rates."""
    if not _check_sales_permission(user_context):
        return {
            "title": "Sales Revenue Summary",
            "summary": "Access Denied: You do not have authorization to view sales metrics.",
            "data": [],
        }

    db = get_db()
    pipeline = [
        {
            "$group": {
                "_id": None,
                "grossRevenue": {"$sum": {"$cond": [{"$ne": ["$status", "CANCELLED"]}, "$totalAmount", 0]}},
                "totalOrders": {"$sum": 1},
                "fulfilledOrders": {"$sum": {"$cond": [{"$in": ["$status", ["DELIVERED", "FULFILLED", "SHIPPED"]]}, 1, 0]}},
                "pendingOrders": {"$sum": {"$cond": [{"$in": ["$status", ["PENDING", "CONFIRMED", "PROCESSING", "RESERVED"]]}, 1, 0]}},
                "cancelledOrders": {"$sum": {"$cond": [{"$eq": ["$status", "CANCELLED"]}, 1, 0]}},
            }
        }
    ]

    res = list(db.salesorders.aggregate(pipeline))
    stats = res[0] if res else {"grossRevenue": 0, "totalOrders": 0, "fulfilledOrders": 0, "pendingOrders": 0, "cancelledOrders": 0}

    return {
        "title": "Commercial Sales Revenue & Volume",
        "summary": (
            f"Gross registered sales revenue across active orders: **${float(stats.get('grossRevenue', 0)):,.2f}** "
            f"across **{stats.get('totalOrders', 0)}** customer sales orders."
        ),
        "data": {
            "Total Sales Revenue": f"${float(stats.get('grossRevenue', 0)):,.2f}",
            "Total Commercial Orders": stats.get("totalOrders", 0),
            "Fulfilled / Shipped": stats.get("fulfilledOrders", 0),
            "Pending Fulfillment": stats.get("pendingOrders", 0),
            "Cancelled Orders": stats.get("cancelledOrders", 0),
        }
    }

def get_top_selling_products(user_context: dict, limit: int = 10) -> Dict[str, Any]:
    """Identifies top products ranked by ordered quantity and generated sales revenue."""
    if not _check_sales_permission(user_context):
        return {
            "title": "Top Selling Products",
            "summary": "Access Denied: You do not have authorization to view product sales metrics.",
            "data": [],
        }

    db = get_db()
    pipeline = [
        {"$match": {"status": {"$ne": "CANCELLED"}}},
        {"$unwind": "$items"},
        {
            "$group": {
                "_id": "$items.product",
                "unitsSold": {"$sum": "$items.quantity"},
                "totalRevenue": {"$sum": {"$ifNull": ["$items.totalPrice", {"$multiply": ["$items.quantity", "$items.unitPrice"]}]}},
                "orderFrequency": {"$sum": 1},
            }
        },
        {"$sort": {"unitsSold": -1}},
        {"$limit": min(limit, 25)}
    ]

    agg = list(db.salesorders.aggregate(pipeline))
    prod_ids = [a["_id"] for a in agg if a["_id"]]
    products = {str(p["_id"]): p for p in db.products.find({"_id": {"$in": prod_ids}}, {"productName": 1, "sku": 1, "unitPrice": 1})}

    rows = []
    for idx, a in enumerate(agg, 1):
        p = products.get(str(a["_id"]), {})
        rows.append({
            "Rank": f"#{idx}",
            "Product": p.get("productName", "Product"),
            "SKU": p.get("sku", "—"),
            "Units Ordered": a.get("unitsSold", 0),
            "Revenue": f"${float(a.get('totalRevenue', 0)):,.2f}",
            "Order Occurrences": a.get("orderFrequency", 0),
        })

    return {
        "title": "Top Selling Products & Demand Velocity",
        "summary": f"Ranked top **{len(rows)}** products by cumulative order volume.",
        "data": rows,
    }

