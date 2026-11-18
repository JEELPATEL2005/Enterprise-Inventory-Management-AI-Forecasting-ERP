from typing import Dict, Any, List, Optional
from datetime import datetime
from app.core.database import get_db

def _check_purchase_permission(user_context: dict) -> bool:
    role = user_context.get("role", "EMPLOYEE")
    return role in ["SUPER_ADMIN", "ADMIN", "PURCHASE_MANAGER"]

def get_purchase_orders(user_context: dict, status: Optional[str] = None, limit: int = 20) -> Dict[str, Any]:
    """Retrieves purchase orders, optionally filtered by status (PENDING, APPROVED, ORDERED, RECEIVED, CANCELLED)."""
    if not _check_purchase_permission(user_context):
        return {
            "title": "Purchase Orders",
            "summary": "Access Denied: Your current role lacks permission to access procurement and purchase order records. This module is restricted to Purchase Managers and Administrators.",
            "data": [],
        }

    db = get_db()
    query = {}
    if status and status.upper() != "ALL":
        query["status"] = status.upper()

    pos = list(db.purchaseorders.find(query).sort("createdAt", -1).limit(min(limit, 50)))
    if not pos:
        return {"title": "Purchase Orders", "summary": "No purchase orders found matching criteria.", "data": []}

    vendor_ids = list(set(p["vendor"] for p in pos if "vendor" in p))
    vendors = {str(v["_id"]): v.get("vendorName", "Vendor") for v in db.vendors.find({"_id": {"$in": vendor_ids}}, {"vendorName": 1})}

    rows = []
    for po in pos:
        po_num = po.get("purchaseOrderNumber") or po.get("poNumber") or "PO-REF"
        v_name = vendors.get(str(po.get("vendor")), "Supplier")
        amt = float(po.get("totalAmount", 0))
        st = po.get("status", "PENDING")
        approval = po.get("internalApprovalStatus", "PENDING")
        acceptance = po.get("vendorAcceptanceStatus", "NOT_SENT")
        date_str = po.get("orderDate").strftime("%Y-%m-%d") if po.get("orderDate") else "—"

        rows.append({
            "PO Number": po_num,
            "Supplier": v_name,
            "Date": date_str,
            "Total Amount": f"${amt:,.2f}",
            "Status": st,
            "Internal Approval": approval,
            "Vendor Response": acceptance,
        })

    return {
        "title": f"Purchase Orders ({len(rows)} Records)",
        "summary": f"Listing latest **{len(rows)}** procurement orders.",
        "data": rows,
    }

def get_pending_purchase_orders(user_context: dict) -> Dict[str, Any]:
    """Finds all Purchase Orders currently awaiting internal approval or supplier confirmation."""
    if not _check_purchase_permission(user_context):
        return {
            "title": "Pending Purchase Orders",
            "summary": "Access Denied: Your current role lacks permission to access procurement and purchase order records. This module is restricted to Purchase Managers and Administrators.",
            "data": [],
        }

    db = get_db()
    query = {
        "$or": [
            {"internalApprovalStatus": "PENDING"},
            {"status": "PENDING"},
            {"vendorAcceptanceStatus": "PENDING"},
        ],
        "status": {"$ne": "CANCELLED"}
    }

    pos = list(db.purchaseorders.find(query).sort("createdAt", -1).limit(30))
    if not pos:
        return {
            "title": "Pending Purchase Orders",
            "summary": "Great news: There are currently no purchase orders awaiting approval or vendor confirmation.",
            "data": [],
        }

    vendor_ids = list(set(p["vendor"] for p in pos if "vendor" in p))
    vendors = {str(v["_id"]): v.get("vendorName", "Vendor") for v in db.vendors.find({"_id": {"$in": vendor_ids}}, {"vendorName": 1})}

    rows = []
    for po in pos:
        po_num = po.get("purchaseOrderNumber") or po.get("poNumber")
        v_name = vendors.get(str(po.get("vendor")), "Supplier")
        rows.append({
            "PO Number": po_num,
            "Supplier": v_name,
            "Total": f"${float(po.get('totalAmount', 0)):,.2f}",
            "Internal Approval": po.get("internalApprovalStatus", "PENDING"),
            "Supplier Acceptance": po.get("vendorAcceptanceStatus", "NOT_SENT"),
            "Email Status": po.get("emailDeliveryStatus", "NOT_SENT"),
            "Action Needed": "Requires Approval" if po.get("internalApprovalStatus") == "PENDING" else "Awaiting Supplier Response",
        })

    return {
        "title": "Pending Purchase Orders Pipeline",
        "summary": f"There are **{len(rows)}** purchase orders currently blocked or awaiting sign-off.",
        "data": rows,
    }

def get_supplier_performance(user_context: dict) -> Dict[str, Any]:
    """Summarizes vendor procurement volumes, order counts, and vendor active status."""
    if not _check_purchase_permission(user_context):
        return {
            "title": "Supplier Performance",
            "summary": "Access Denied: You do not have authorization to view supplier data.",
            "data": [],
        }

    db = get_db()
    pipeline = [
        {"$match": {"status": {"$ne": "CANCELLED"}}},
        {
            "$group": {
                "_id": "$vendor",
                "totalSpend": {"$sum": "$totalAmount"},
                "orderCount": {"$sum": 1},
                "fulfilledCount": {
                    "$sum": {"$cond": [{"$eq": ["$status", "RECEIVED"]}, 1, 0]}
                }
            }
        },
        {"$sort": {"totalSpend": -1}},
        {"$limit": 15}
    ]

    agg = list(db.purchaseorders.aggregate(pipeline))
    vendor_ids = [a["_id"] for a in agg if a["_id"]]
    vendors = {str(v["_id"]): v for v in db.vendors.find({"_id": {"$in": vendor_ids}})}

    rows = []
    for a in agg:
        v = vendors.get(str(a["_id"]), {})
        tot = float(a.get("totalSpend", 0))
        orders = a.get("orderCount", 0)
        fulfilled = a.get("fulfilledCount", 0)
        fulfillment_rate = f"{(fulfilled / orders * 100):.0f}%" if orders > 0 else "0%"

        rows.append({
            "Supplier": v.get("vendorName", "Vendor"),
            "Contact Email": v.get("email", "—"),
            "Status": v.get("status", "ACTIVE"),
            "Total Orders": orders,
            "Completed GRNs": fulfilled,
            "Fulfillment Rate": fulfillment_rate,
            "Total Procurement Spend": f"${tot:,.2f}",
        })

    return {
        "title": "Supplier Spend & Fulfillment Performance",
        "summary": f"Analyzed top **{len(rows)}** suppliers by order spend.",
        "data": rows,
    }

def get_purchase_summary(user_context: dict) -> Dict[str, Any]:
    """Generates overall procurement volume, total spend, and GRN receiving stats."""
    if not _check_purchase_permission(user_context):
        return {
            "title": "Procurement Summary",
            "summary": "Access Denied: You do not have authorization to view procurement metrics.",
            "data": [],
        }

    db = get_db()
    pipeline = [
        {
            "$group": {
                "_id": None,
                "totalSpend": {"$sum": {"$cond": [{"$ne": ["$status", "CANCELLED"]}, "$totalAmount", 0]}},
                "totalOrders": {"$sum": 1},
                "approvedCount": {"$sum": {"$cond": [{"$eq": ["$status", "APPROVED"]}, 1, 0]}},
                "receivedCount": {"$sum": {"$cond": [{"$eq": ["$status", "RECEIVED"]}, 1, 0]}},
                "cancelledCount": {"$sum": {"$cond": [{"$eq": ["$status", "CANCELLED"]}, 1, 0]}},
            }
        }
    ]

    res = list(db.purchaseorders.aggregate(pipeline))
    stats = res[0] if res else {"totalSpend": 0, "totalOrders": 0, "approvedCount": 0, "receivedCount": 0, "cancelledCount": 0}

    return {
        "title": "Procurement Overview & Spend Summary",
        "summary": (
            f"Total historic procurement spend across active orders: **${float(stats.get('totalSpend', 0)):,.2f}** "
            f"across **{stats.get('totalOrders', 0)}** purchase orders."
        ),
        "data": {
            "Total Procurement Spend": f"${float(stats.get('totalSpend', 0)):,.2f}",
            "Total Purchase Orders": stats.get("totalOrders", 0),
            "Fully Received Orders": stats.get("receivedCount", 0),
            "Active Approved Orders": stats.get("approvedCount", 0),
            "Cancelled Orders": stats.get("cancelledCount", 0),
        }
    }

