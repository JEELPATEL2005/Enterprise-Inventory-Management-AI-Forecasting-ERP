from typing import Dict, Any, List, Optional
from bson import ObjectId
from app.core.database import get_db

def _scope_warehouse_query(query: dict, user_context: dict) -> dict:
    """Enforces warehouse access restriction based on user role and assigned warehouses."""
    role = user_context.get("role", "EMPLOYEE")
    assigned = user_context.get("assigned_warehouses", [])
    if role not in ["SUPER_ADMIN", "ADMIN", "PURCHASE_MANAGER", "SALES_MANAGER"]:
        if assigned:
            oids = [ObjectId(w) for w in assigned if ObjectId.is_valid(w)]
            query["warehouse"] = {"$in": oids}
        else:
            # If a warehouse manager has no assigned warehouse, restrict to empty
            query["warehouse"] = None
    return query

def get_inventory_summary(user_context: dict) -> Dict[str, Any]:
    """Retrieves overall inventory statistics, total SKUs, total physical stock, and reserved stock."""
    db = get_db()
    query = _scope_warehouse_query({}, user_context)

    pipeline = [
        {"$match": query},
        {
            "$group": {
                "_id": None,
                "totalPhysicalQuantity": {"$sum": "$quantity"},
                "totalReservedStock": {"$sum": "$reservedStock"},
                "totalDamagedStock": {"$sum": "$damagedStock"},
                "totalRepairStock": {"$sum": "$repairStock"},
                "skuCount": {"$sum": 1},
            }
        }
    ]

    res = list(db.inventories.aggregate(pipeline))
    stats = res[0] if res else {
        "totalPhysicalQuantity": 0,
        "totalReservedStock": 0,
        "totalDamagedStock": 0,
        "totalRepairStock": 0,
        "skuCount": 0,
    }

    available = max(0, stats.get("totalPhysicalQuantity", 0) - stats.get("totalReservedStock", 0))

    return {
        "title": "Inventory Overview & Summary",
        "summary": (
            f"Currently managing **{stats.get('skuCount', 0)}** active product placements across facilities. "
            f"Physical Stock: **{stats.get('totalPhysicalQuantity', 0):,} units** "
            f"(Available: **{available:,}**, Reserved: **{stats.get('totalReservedStock', 0):,}**, "
            f"Damaged: **{stats.get('totalDamagedStock', 0):,}**)."
        ),
        "data": {
            "Total Physical Stock": stats.get("totalPhysicalQuantity", 0),
            "Available to Promise (ATP)": available,
            "Reserved for Sales Orders": stats.get("totalReservedStock", 0),
            "Quarantined Damaged": stats.get("totalDamagedStock", 0),
            "Repair Bay Stock": stats.get("totalRepairStock", 0),
            "Tracked SKUs": stats.get("skuCount", 0),
        }
    }

def get_low_stock_products(user_context: dict, limit: int = 50) -> Dict[str, Any]:
    """Identifies products whose available stock is at or below their reorder threshold."""
    db = get_db()
    query = _scope_warehouse_query({}, user_context)

    # Join inventories with products and warehouses
    pipeline = [
        {"$match": query},
        {
            "$lookup": {
                "from": "products",
                "localField": "product",
                "foreignField": "_id",
                "as": "productDoc"
            }
        },
        {"$unwind": "$productDoc"},
        {
            "$lookup": {
                "from": "warehouses",
                "localField": "warehouse",
                "foreignField": "_id",
                "as": "warehouseDoc"
            }
        },
        {"$unwind": "$warehouseDoc"},
        {
            "$project": {
                "productName": "$productDoc.productName",
                "sku": "$productDoc.sku",
                "warehouse": "$warehouseDoc.warehouseName",
                "quantity": "$quantity",
                "reserved": "$reservedStock",
                "available": {"$subtract": ["$quantity", {"$ifNull": ["$reservedStock", 0]}]},
                "reorderPoint": {
                    "$ifNull": [
                        "$reorderPoint",
                        {"$ifNull": ["$productDoc.safetyStock", 10]}
                    ]
                },
                "unit": "$productDoc.unit",
            }
        },
        {
            "$match": {
                "$expr": {"$lte": ["$available", "$reorderPoint"]}
            }
        },
        {"$sort": {"available": 1}},
        {"$limit": min(limit, 100)}
    ]

    items = list(db.inventories.aggregate(pipeline))
    formatted = []
    for it in items:
        avail = it.get("available", 0)
        reorder = it.get("reorderPoint", 0)
        formatted.append({
            "SKU": it.get("sku", "—"),
            "Product": it.get("productName", "—"),
            "Warehouse": it.get("warehouse", "—"),
            "Available Stock": f"{avail} {it.get('unit', 'PCS')}",
            "Reorder Level": reorder,
            "Deficit": max(0, reorder - avail),
            "Urgency": "CRITICAL (0 STOCK)" if avail <= 0 else "LOW STOCK",
        })

    return {
        "title": "Low Stock & Reorder Alert List",
        "summary": f"Found **{len(formatted)}** inventory items currently below minimum safety thresholds.",
        "data": formatted,
    }

def get_product_stock(user_context: dict, product_name_or_sku: str) -> Dict[str, Any]:
    """Finds current stock across warehouses for a specific product name or SKU code."""
    db = get_db()
    if not product_name_or_sku or not product_name_or_sku.strip():
        return {"title": "Product Stock Lookup", "summary": "Please provide a valid product name or SKU.", "data": []}

    term = product_name_or_sku.strip()
    # Find matching products
    prod_filter = {
        "$or": [
            {"sku": {"$regex": term, "$options": "i"}},
            {"productName": {"$regex": term, "$options": "i"}},
        ]
    }
    products = list(db.products.find(prod_filter, {"_id": 1, "productName": 1, "sku": 1, "unitPrice": 1, "unit": 1}).limit(10))
    if not products:
        return {
            "title": f"Stock for '{term}'",
            "summary": f"No product matching '{term}' was found in the catalog.",
            "data": [],
        }

    prod_ids = [p["_id"] for p in products]
    inv_query = _scope_warehouse_query({"product": {"$in": prod_ids}}, user_context)

    inventories = list(db.inventories.find(inv_query))
    # Fetch warehouses map
    wh_ids = list(set(inv["warehouse"] for inv in inventories if "warehouse" in inv))
    warehouses = {str(w["_id"]): w.get("warehouseName", "Unknown") for w in db.warehouses.find({"_id": {"$in": wh_ids}})}
    prod_map = {str(p["_id"]): p for p in products}

    results = []
    for inv in inventories:
        p = prod_map.get(str(inv["product"]), {})
        qty = inv.get("quantity", 0)
        reserved = inv.get("reservedStock", 0)
        avail = max(0, qty - reserved)
        results.append({
            "SKU": p.get("sku", "—"),
            "Product": p.get("productName", "—"),
            "Warehouse": warehouses.get(str(inv["warehouse"]), "Facility"),
            "Physical Quantity": qty,
            "Reserved": reserved,
            "Available to Promise": avail,
            "Unit Price": f"${p.get('unitPrice', 0):.2f}",
        })

    return {
        "title": f"Stock Lookup: '{term}'",
        "summary": f"Found **{len(results)}** facility placements for product query '{term}'.",
        "data": results,
    }

def get_warehouse_inventory(user_context: dict, warehouse_name: Optional[str] = None) -> Dict[str, Any]:
    """Retrieves stock breakdown grouped by warehouse facility."""
    db = get_db()
    wh_query = {"status": "ACTIVE"}
    if warehouse_name:
        wh_query["warehouseName"] = {"$regex": warehouse_name.strip(), "$options": "i"}

    role = user_context.get("role", "EMPLOYEE")
    assigned = user_context.get("assigned_warehouses", [])
    if role not in ["SUPER_ADMIN", "ADMIN", "PURCHASE_MANAGER", "SALES_MANAGER"] and assigned:
        wh_query["_id"] = {"$in": [ObjectId(w) for w in assigned if ObjectId.is_valid(w)]}

    warehouses = list(db.warehouses.find(wh_query, {"_id": 1, "warehouseName": 1, "location": 1, "capacity": 1}))
    if not warehouses:
        return {"title": "Warehouse Facility Inventory", "summary": "No authorized warehouses found.", "data": []}

    wh_ids = [w["_id"] for w in warehouses]
    pipeline = [
        {"$match": {"warehouse": {"$in": wh_ids}}},
        {
            "$group": {
                "_id": "$warehouse",
                "totalQuantity": {"$sum": "$quantity"},
                "totalReserved": {"$sum": "$reservedStock"},
                "totalDamaged": {"$sum": "$damagedStock"},
                "skuCount": {"$sum": 1},
            }
        }
    ]

    agg_results = {str(r["_id"]): r for r in db.inventories.aggregate(pipeline)}

    data = []
    for wh in warehouses:
        w_id = str(wh["_id"])
        stats = agg_results.get(w_id, {})
        cap = wh.get("capacity", 10000)
        tot = stats.get("totalQuantity", 0)
        utilization = f"{(tot / cap * 100):.1f}%" if cap > 0 else "0%"
        data.append({
            "Warehouse": wh.get("warehouseName", "—"),
            "Location": wh.get("location", "—"),
            "Total Units": tot,
            "Available Units": max(0, tot - stats.get("totalReserved", 0)),
            "Capacity": f"{cap:,} units",
            "Utilization": utilization,
            "SKU Types": stats.get("skuCount", 0),
        })

    return {
        "title": "Facility Storage & Capacity Utilization",
        "summary": f"Reporting on **{len(data)}** warehouse storage facilities.",
        "data": data,
    }

def get_stock_movement_history(user_context: dict, limit: int = 20) -> Dict[str, Any]:
    """Retrieves recent stock ledger transactions (intake, dispatch, transfers, adjustments)."""
    db = get_db()
    query = _scope_warehouse_query({}, user_context)

    movements = list(db.stockmovements.find(query).sort("createdAt", -1).limit(min(limit, 50)))
    if not movements:
        return {"title": "Recent Stock Movements", "summary": "No recorded stock movements found.", "data": []}

    prod_ids = list(set(m["product"] for m in movements if "product" in m))
    wh_ids = list(set(m["warehouse"] for m in movements if "warehouse" in m))

    prod_map = {str(p["_id"]): p for p in db.products.find({"_id": {"$in": prod_ids}}, {"productName": 1, "sku": 1})}
    wh_map = {str(w["_id"]): w.get("warehouseName", "—") for w in db.warehouses.find({"_id": {"$in": wh_ids}}, {"warehouseName": 1})}

    rows = []
    for m in movements:
        p = prod_map.get(str(m.get("product")), {})
        rows.append({
            "Timestamp": m.get("createdAt").strftime("%Y-%m-%d %H:%M") if m.get("createdAt") else "—",
            "Type": m.get("type", "—"),
            "Product": p.get("productName", "—"),
            "SKU": p.get("sku", "—"),
            "Qty": m.get("quantity", 0),
            "Warehouse": wh_map.get(str(m.get("warehouse")), "—"),
            "Reference": m.get("referenceType", "—"),
        })

    return {
        "title": "Stock Movement Ledger History",
        "summary": f"Displaying latest **{len(rows)}** verified physical inventory adjustments.",
        "data": rows,
    }

