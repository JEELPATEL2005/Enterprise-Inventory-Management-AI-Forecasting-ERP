from typing import Dict, Any, List, Optional
from app.core.database import get_db

def _check_finance_permission(user_context: dict) -> bool:
    role = user_context.get("role", "EMPLOYEE")
    return role in ["SUPER_ADMIN", "ADMIN", "SALES_MANAGER", "PURCHASE_MANAGER"]

def get_expense_summary(user_context: dict) -> Dict[str, Any]:
    """
    Summarizes company cash flow, procurement expenditures, invoice revenues,
    unpaid balances, and stock inventory valuation.
    """
    if not _check_finance_permission(user_context):
        return {
            "title": "Financial Summary",
            "summary": "Access Denied: You do not have authorization to view financial records.",
            "data": [],
        }

    db = get_db()

    # 1. Procurement spend (Outflow)
    po_pipeline = [
        {"$match": {"status": {"$ne": "CANCELLED"}}},
        {"$group": {"_id": None, "totalProcurement": {"$sum": "$totalAmount"}}}
    ]
    po_res = list(db.purchaseorders.aggregate(po_pipeline))
    procurement_spend = float(po_res[0]["totalProcurement"]) if po_res else 0.0

    # 2. Sales billing & revenue (Inflow)
    inv_pipeline = [
        {"$match": {"status": {"$ne": "VOID"}}},
        {
            "$group": {
                "_id": None,
                "grossBilled": {"$sum": "$totalAmount"},
                "totalPaid": {"$sum": "$amountPaid"},
                "totalDue": {"$sum": {"$subtract": ["$totalAmount", "$amountPaid"]}},
            }
        }
    ]
    inv_res = list(db.invoices.aggregate(inv_pipeline))
    inv_stats = inv_res[0] if inv_res else {"grossBilled": 0.0, "totalPaid": 0.0, "totalDue": 0.0}

    # 3. Stock asset valuation
    stock_pipeline = [
        {
            "$lookup": {
                "from": "products",
                "localField": "product",
                "foreignField": "_id",
                "as": "prod"
            }
        },
        {"$unwind": "$prod"},
        {
            "$group": {
                "_id": None,
                "totalValuation": {
                    "$sum": {"$multiply": ["$quantity", {"$ifNull": ["$prod.unitPrice", 0]}]}
                }
            }
        }
    ]
    stock_res = list(db.inventories.aggregate(stock_pipeline))
    stock_valuation = float(stock_res[0]["totalValuation"]) if stock_res else 0.0

    return {
        "title": "Commercial Financial & Spend Position",
        "summary": (
            f"**ERP Financial Snapshot:** Gross Invoiced Sales: **${float(inv_stats.get('grossBilled', 0)):,.2f}** "
            f"(Collected: **${float(inv_stats.get('totalPaid', 0)):,.2f}**, Outstanding: **${float(inv_stats.get('totalDue', 0)):,.2f}**). "
            f"Procurement Expenditures: **${procurement_spend:,.2f}**. "
            f"Physical Stock Capital Asset Valuation: **${stock_valuation:,.2f}**.\n\n"
            f"> ℹ️ **Notice:** General operational expenses (building rent, vehicle fuel, utilities) are not tracked "
            f"as standalone ledger entries in this ERP schema."
        ),
        "data": {
            "Gross Invoiced Revenue": f"${float(inv_stats.get('grossBilled', 0)):,.2f}",
            "Collected Cash Receipts": f"${float(inv_stats.get('totalPaid', 0)):,.2f}",
            "Outstanding Accounts Receivable": f"${float(inv_stats.get('totalDue', 0)):,.2f}",
            "Procurement Purchase Spend": f"${procurement_spend:,.2f}",
            "Physical Inventory Asset Value": f"${stock_valuation:,.2f}",
        }
    }

def get_outstanding_invoices(user_context: dict, limit: int = 20) -> Dict[str, Any]:
    """Retrieves unpaid and partially paid customer sales invoices."""
    if not _check_finance_permission(user_context):
        return {
            "title": "Outstanding Invoices",
            "summary": "Access Denied: You do not have authorization to view customer invoices.",
            "data": [],
        }

    db = get_db()
    query = {"status": {"$in": ["UNPAID", "PARTIALLY_PAID", "OVERDUE"]}}
    invoices = list(db.invoices.find(query).sort("invoiceDate", -1).limit(min(limit, 50)))

    if not invoices:
        return {
            "title": "Outstanding Invoices",
            "summary": "All customer invoices are currently marked fully settled (PAID).",
            "data": [],
        }

    cust_ids = list(set(i["customer"] for i in invoices if "customer" in i and i["customer"]))
    customers = {str(c["_id"]): c.get("customerName", "Client") for c in db.customers.find({"_id": {"$in": cust_ids}}, {"customerName": 1})}

    rows = []
    for inv in invoices:
        tot = float(inv.get("totalAmount", 0))
        paid = float(inv.get("amountPaid", 0))
        due = max(0.0, tot - paid)
        c_name = customers.get(str(inv.get("customer")), "Customer")
        dt_str = inv.get("invoiceDate").strftime("%Y-%m-%d") if inv.get("invoiceDate") else "—"

        rows.append({
            "Invoice #": inv.get("invoiceNumber", "INV-REF"),
            "Customer": c_name,
            "Date": dt_str,
            "Total Amount": f"${tot:,.2f}",
            "Amount Paid": f"${paid:,.2f}",
            "Balance Due": f"${due:,.2f}",
            "Status": inv.get("status", "UNPAID"),
        })

    return {
        "title": f"Outstanding Customer Invoices ({len(rows)} Records)",
        "summary": f"Found **{len(rows)}** invoices with outstanding receivables due.",
        "data": rows,
    }

