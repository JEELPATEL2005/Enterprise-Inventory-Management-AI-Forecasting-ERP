from typing import Dict, Any, List, Optional
from datetime import datetime, timezone
from bson import ObjectId
from app.core.database import get_db

GPS_DISCLAIMER = (
    "Live GPS vehicle tracking is not supported by this ERP. "
    "All transit milestones, dispatch dates, and delivery estimates are based on latest recorded dispatch logs."
)

def get_shipments(user_context: dict, status: Optional[str] = None, limit: int = 25) -> Dict[str, Any]:
    """Retrieves recorded logistics delivery dispatches, status, and assigned couriers."""
    db = get_db()
    query = {}
    if status and status.upper() != "ALL":
        query["status"] = status.upper()

    deliveries = list(db.deliveries.find(query).sort("createdAt", -1).limit(min(limit, 50)))
    if not deliveries:
        return {
            "title": "Logistics Shipments",
            "summary": "No shipment dispatch records found matching criteria.",
            "disclaimer": GPS_DISCLAIMER,
            "data": [],
        }

    emp_ids = list(set(d["assignedEmployee"] for d in deliveries if "assignedEmployee" in d and d["assignedEmployee"]))
    cust_ids = list(set(d["customer"] for d in deliveries if "customer" in d and d["customer"]))
    wh_ids = list(set(d["warehouse"] for d in deliveries if "warehouse" in d and d["warehouse"]))

    employees = {str(e["_id"]): e.get("name", "Driver") for e in db.employees.find({"_id": {"$in": emp_ids}}, {"name": 1})}
    customers = {str(c["_id"]): c.get("customerName", "Client") for c in db.customers.find({"_id": {"$in": cust_ids}}, {"customerName": 1})}
    warehouses = {str(w["_id"]): w.get("warehouseName", "Facility") for w in db.warehouses.find({"_id": {"$in": wh_ids}}, {"warehouseName": 1})}

    rows = []
    for d in deliveries:
        num = d.get("deliveryNumber") or f"DEL-{str(d['_id'])[-6:].upper()}"
        driver = employees.get(str(d.get("assignedEmployee")), "Unassigned")
        consignee = customers.get(str(d.get("customer")), "Customer")
        origin = warehouses.get(str(d.get("warehouse")), "Main Hub")
        st = d.get("status", "PENDING")
        dispatched_at = d.get("dispatchedAt").strftime("%Y-%m-%d %H:%M") if d.get("dispatchedAt") else "Pending Dispatch"

        rows.append({
            "Shipment Waybill": num,
            "Consignee": consignee,
            "Origin Hub": origin,
            "Assigned Driver": driver,
            "Recorded Status": st,
            "Dispatched At": dispatched_at,
            "Destination Address": d.get("deliveryAddress", "—"),
        })

    return {
        "title": f"Logistics Consignment Manifest ({len(rows)} Shipments)",
        "summary": f"Retrieved **{len(rows)}** shipment dispatches from recorded warehouse manifests.",
        "disclaimer": GPS_DISCLAIMER,
        "data": rows,
    }

def get_delayed_shipments(user_context: dict) -> Dict[str, Any]:
    """
    Identifies shipments that are potentially delayed by comparing the Sales Order
    targeted delivery date against current time for undelivered dispatches.
    """
    db = get_db()
    # Find active undelivered dispatches
    undelivered_statuses = ["PENDING", "ASSIGNED", "READY_FOR_DISPATCH", "IN_TRANSIT"]
    deliveries = list(db.deliveries.find({"status": {"$in": undelivered_statuses}}).sort("createdAt", -1).limit(50))

    if not deliveries:
        return {
            "title": "Delayed Shipments Analysis",
            "summary": "No active in-transit shipments found in the system.",
            "disclaimer": GPS_DISCLAIMER,
            "data": [],
        }

    so_ids = [d["salesOrder"] for d in deliveries if "salesOrder" in d and d["salesOrder"]]
    sales_orders = {str(s["_id"]): s for s in db.salesorders.find({"_id": {"$in": so_ids}})}

    emp_ids = list(set(d["assignedEmployee"] for d in deliveries if "assignedEmployee" in d and d["assignedEmployee"]))
    cust_ids = list(set(d["customer"] for d in deliveries if "customer" in d and d["customer"]))

    employees = {str(e["_id"]): e.get("name", "Driver") for e in db.employees.find({"_id": {"$in": emp_ids}}, {"name": 1})}
    customers = {str(c["_id"]): c.get("customerName", "Client") for c in db.customers.find({"_id": {"$in": cust_ids}}, {"customerName": 1})}

    now = datetime.now()
    delayed_rows = []

    for d in deliveries:
        so = sales_orders.get(str(d.get("salesOrder")), {})
        target_date = so.get("deliveryDate")
        if target_date and isinstance(target_date, datetime):
            # If target date has passed and status is not DELIVERED
            # Normalize to naive for comparison if needed
            target_naive = target_date.replace(tzinfo=None) if target_date.tzinfo else target_date
            now_naive = now.replace(tzinfo=None) if now.tzinfo else now

            if target_naive < now_naive:
                days_delayed = (now_naive - target_naive).days
                num = d.get("deliveryNumber") or f"DEL-{str(d['_id'])[-6:].upper()}"
                driver = employees.get(str(d.get("assignedEmployee")), "Unassigned")
                cust = customers.get(str(d.get("customer")), "Customer")

                delayed_rows.append({
                    "Shipment ID": num,
                    "Destination": d.get("deliveryAddress", "—"),
                    "Customer": cust,
                    "Assigned Driver": driver,
                    "Target Date": target_date.strftime("%Y-%m-%d"),
                    "Current Status": d.get("status", "IN_TRANSIT"),
                    "Delay Duration": f"{days_delayed} days overdue" if days_delayed > 0 else "Overdue today",
                })

    if not delayed_rows:
        return {
            "title": "Delayed Shipments Schedule",
            "summary": "All active in-transit shipments are currently within their scheduled delivery target dates.",
            "disclaimer": GPS_DISCLAIMER,
            "data": [],
        }

    return {
        "title": f"Overdue & Delayed Shipments ({len(delayed_rows)} Detected)",
        "summary": (
            f"Detected **{len(delayed_rows)}** shipments whose scheduled delivery target dates have passed "
            f"while remaining undelivered in the latest recorded status."
        ),
        "disclaimer": GPS_DISCLAIMER,
        "data": delayed_rows,
    }

def get_delivery_performance(user_context: dict) -> Dict[str, Any]:
    """Calculates fulfillment SLA, successful delivery count, and delivery exceptions."""
    db = get_db()
    pipeline = [
        {
            "$group": {
                "_id": None,
                "totalDispatches": {"$sum": 1},
                "delivered": {"$sum": {"$cond": [{"$eq": ["$status", "DELIVERED"]}, 1, 0]}},
                "inTransit": {"$sum": {"$cond": [{"$eq": ["$status", "IN_TRANSIT"]}, 1, 0]}},
                "failed": {"$sum": {"$cond": [{"$eq": ["$status", "FAILED"]}, 1, 0]}},
                "cancelled": {"$sum": {"$cond": [{"$eq": ["$status", "CANCELLED"]}, 1, 0]}},
            }
        }
    ]

    res = list(db.deliveries.aggregate(pipeline))
    stats = res[0] if res else {"totalDispatches": 0, "delivered": 0, "inTransit": 0, "failed": 0, "cancelled": 0}

    total = stats.get("totalDispatches", 0)
    deliv = stats.get("delivered", 0)
    sla = f"{(deliv / total * 100):.1f}%" if total > 0 else "N/A"

    return {
        "title": "Logistics Dispatch SLA & Performance",
        "summary": (
            f"Overall delivery fulfillment SLA stands at **{sla}** "
            f"({deliv:,} delivered out of {total:,} total recorded dispatches)."
        ),
        "disclaimer": GPS_DISCLAIMER,
        "data": {
            "Total Recorded Dispatches": total,
            "Successfully Delivered": deliv,
            "Currently In Transit": stats.get("inTransit", 0),
            "Failed Delivery Exceptions": stats.get("failed", 0),
            "Cancelled Dispatches": stats.get("cancelled", 0),
            "Fulfillment SLA Rate": sla,
        }
    }

def get_fleet_and_vehicles(user_context: dict) -> Dict[str, Any]:
    """
    Answers fleet & vehicle queries. Explicitly informs the user that dedicated vehicle
    records/telematics are not modeled, but returns drivers assigned to active deliveries.
    """
    db = get_db()
    # Check if there is any Vehicle collection
    collections = db.list_collection_names()
    has_vehicle_coll = "vehicles" in collections or "fleets" in collections

    active_dispatches = list(db.deliveries.find({"status": "IN_TRANSIT"}, {"assignedEmployee": 1, "deliveryNumber": 1}))
    emp_ids = [d["assignedEmployee"] for d in active_dispatches if "assignedEmployee" in d and d["assignedEmployee"]]
    drivers = list(db.employees.find({"_id": {"$in": emp_ids}}, {"name": 1, "phone": 1, "email": 1}))

    driver_rows = []
    for d in drivers:
        driver_rows.append({
            "Driver Name": d.get("name", "Driver"),
            "Contact Phone": d.get("phone", "—"),
            "Email": d.get("email", "—"),
            "Active Assignment": "On Active Dispatch Trip",
        })

    return {
        "title": "Fleet Assets & Driver Assignments",
        "summary": (
            "**ERP Architecture Limitation:** This InventoryPro instance currently manages logistics dispatching "
            "through assigned drivers (`Employee` records), rather than dedicated vehicle assets (e.g. license plates, "
            "odometers, maintenance logs, or fuel records). Below are drivers currently assigned to active trips."
        ),
        "disclaimer": GPS_DISCLAIMER,
        "data": driver_rows if driver_rows else "No drivers currently assigned to active IN_TRANSIT trips.",
    }

