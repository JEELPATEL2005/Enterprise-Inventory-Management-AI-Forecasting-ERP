import re
import json
from typing import Dict, Any, List, Optional
from app.services.llm_service import get_llm

AVAILABLE_TOOLS = {
    # 1. Inventory Tools
    "get_inventory_summary": {
        "domain": "INVENTORY",
        "desc": "High-level inventory summary: physical quantity, Available to Promise (ATP), reserved stock, damaged stock, tracked SKUs.",
        "params": {}
    },
    "get_low_stock_products": {
        "domain": "INVENTORY",
        "desc": "Items where available stock is below or at reorder level / minimum safety threshold, or zero stock.",
        "params": {}
    },
    "get_product_stock": {
        "domain": "INVENTORY",
        "desc": "Specific stock level, SKU, and unit price for a given product name or SKU code.",
        "params": {"product_name_or_sku": "str"}
    },
    "get_warehouse_inventory": {
        "domain": "INVENTORY",
        "desc": "Stock distribution and bin storage breakdown grouped by warehouse facility.",
        "params": {}
    },
    "get_stock_movement_history": {
        "domain": "INVENTORY",
        "desc": "Recent ledger of stock movements (INBOUND intake, OUTBOUND dispatches, TRANSFERS, ADJUSTMENTS).",
        "params": {"limit": "int"}
    },

    # 2. Purchase Tools
    "get_purchase_orders": {
        "domain": "PURCHASE",
        "desc": "Recent purchase orders list, optionally filtered by status (PENDING, APPROVED, ORDERED, RECEIVED).",
        "params": {"status": "str", "limit": "int"}
    },
    "get_pending_purchase_orders": {
        "domain": "PURCHASE",
        "desc": "Purchase orders awaiting internal sign-off approval, vendor acceptance, or blocked.",
        "params": {}
    },
    "get_supplier_performance": {
        "domain": "PURCHASE",
        "desc": "Vendor purchase volume rankings, top suppliers by spending, total order values.",
        "params": {}
    },
    "get_purchase_summary": {
        "domain": "PURCHASE",
        "desc": "Procurement monthly spend analytics and total order statistics.",
        "params": {}
    },

    # 3. Sales Tools
    "get_sales_orders": {
        "domain": "SALES",
        "desc": "Commercial sales orders list, optionally filtered by status (CONFIRMED, SHIPPED, DELIVERED).",
        "params": {"status": "str", "limit": "int"}
    },
    "get_sales_summary": {
        "domain": "SALES",
        "desc": "Commercial sales revenue, gross volume, and completed order totals.",
        "params": {}
    },
    "get_top_selling_products": {
        "domain": "SALES",
        "desc": "Bestselling products ranked by sales order quantities sold.",
        "params": {"limit": "int"}
    },

    # 4. Logistics & Fleet Tools
    "get_shipments": {
        "domain": "LOGISTICS",
        "desc": "Recent shipment dispatch list and milestone status updates.",
        "params": {"status": "str", "limit": "int"}
    },
    "get_delayed_shipments": {
        "domain": "LOGISTICS",
        "desc": "In-transit shipments where scheduled target delivery date has passed without delivery confirmation.",
        "params": {}
    },
    "get_delivery_performance": {
        "domain": "LOGISTICS",
        "desc": "On-time delivery fulfillment rate and total completed shipments metrics.",
        "params": {}
    },
    "get_fleet_and_vehicles": {
        "domain": "LOGISTICS",
        "desc": "Assigned drivers for logistics dispatches and clarifies ERP lacks vehicle hardware GPS telematics.",
        "params": {}
    },

    # 5. Finance Tools
    "get_expense_summary": {
        "domain": "FINANCE",
        "desc": "Financial summary: total inventory asset valuation (Stock * UnitPrice), procurement spend, unpaid invoices.",
        "params": {}
    },
    "get_outstanding_invoices": {
        "domain": "FINANCE",
        "desc": "Unpaid, partial, or overdue customer sales invoices with pending balances.",
        "params": {"limit": "int"}
    },
}

def extract_product_search_term(query: str) -> str:
    """Extracts the cleanest product name or SKU candidate from conversational queries."""
    q = query.strip()
    
    # Strip common leading conversational patterns
    patterns_to_strip = [
        r"^(can you\s+)?(please\s+)?(tell me\s+)?(what is\s+|what's\s+)?(the\s+)?(current\s+)?(stock|quantity|inventory|count|units?|balance)\s+(of|for)\s+",
        r"^(can you\s+)?(please\s+)?(check|find|lookup|show|search(\s+for)?|get)\s+(the\s+)?(stock|inventory|quantity|units?)\s+(of|for)?\s*",
        r"^(how many|how much)\s+(units? of\s+)?",
        r"^(do we have\s+(any\s+)?|are there\s+(any\s+)?)",
        r"^(find product|check product|lookup product)\s+",
        r"^(is there\s+(any\s+)?)",
    ]
    
    cleaned = q
    for pat in patterns_to_strip:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE)
    
    # Strip common trailing filler patterns
    trailing_patterns = [
        r"\s+(left\s+)?(in stock|in the warehouse|in inventory|available to promise|available|on hand|in storage)\??$",
        r"\s+(do we have|are available|are left|remain(ing)?)\??$",
        r"[\?\.\!]+$"
    ]
    for pat in trailing_patterns:
        cleaned = re.sub(pat, "", cleaned, flags=re.IGNORECASE)
        
    cleaned = cleaned.strip(" '\"")
    return cleaned if len(cleaned) >= 2 else ""

def rule_based_classify_and_plan(query: str, user_context: dict) -> Dict[str, Any]:
    """
    High-precision deterministic rule & NLP classifier that routes queries to
    the exact tool(s) or RAG vector search with extracted arguments.
    """
    q = query.lower().strip()
    
    # ------------------------------------------------------------------------
    # 1. Procedural / How-To / Policy Question Detection (RAG Primary)
    # ------------------------------------------------------------------------
    is_procedural = bool(re.search(
        r"\b(how\s+(do|can|to|should|would)\s+(i|we|one|a\s+user|staff)|"
        r"what\s+is\s+the\s+(procedure|process|policy|sop|guideline|rule|protocol|standard)|"
        r"steps\s+to|instructions?\s+(on|for)|who\s+is\s+(authorized|allowed)\s+to|"
        r"policy\s+on|guidelines?\s+for|handbook|quarantine\s+bay\s+rule|rma\s+intake)\b",
        q
    ))
    
    has_policy_keyword = any(k in q for k in [
        "policy", "procedure", "sop", "guideline", "manual", "handbook",
        "standard operating procedure", "protocol", "compliance", "terms of agreement"
    ])
    
    # Explicit data request words that indicate user wants real numbers rather than just text
    has_live_data_verbs = bool(re.search(
        r"\b(show|list|how many|what is the count|what is the total|which products|which shipments|"
        r"which orders|find all|get records|unpaid invoices|delayed)\b",
        q
    ))

    # If it is purely a procedural/how-to query or mentions policy without requesting live rows:
    if (is_procedural or has_policy_keyword) and not has_live_data_verbs:
        return {
            "intent": "RAG",
            "planned_tools": [],
            "need_rag": True,
            "rag_query": query,
        }

    planned_tools: List[Dict[str, Any]] = []
    intents: List[str] = []
    need_rag = False
    rag_query = ""

    # If it's a hybrid query (e.g. asking for policy AND live counts)
    if is_procedural or has_policy_keyword:
        need_rag = True
        rag_query = query
        intents.append("RAG")

    # ------------------------------------------------------------------------
    # 2. Inventory Tools Matching
    # ------------------------------------------------------------------------
    is_low_stock = bool(re.search(
        r"\b(low\s+stock|reorder\s*(level|point)?|below\s+(minimum|safety|reorder|threshold)|"
        r"out\s+of\s+stock|zero\s+stock|depleted|running\s+out|need(s)?\s+(restock|replenish)|"
        r"restocking|critical\s+stock|insufficient\s+stock|stock\s+alert|threshold)\b",
        q
    ))
    is_warehouse_dist = bool(re.search(
        r"\b(warehouse\s+(stock|inventory|capacity|facilities|list)|bin\s+storage|"
        r"storage\s+facility|which\s+warehouse\s+has|per\s+warehouse)\b",
        q
    ))
    is_movement = bool(re.search(
        r"\b(stock\s+movement|movement\s+ledger|transfer\s+history|stock\s+adjustments?|"
        r"audit\s+ledger|intake\s+history|stock\s+in\s+history|stock\s+out\s+history)\b",
        q
    ))
    is_specific_product = bool(re.search(
        r"\b(stock\s+of|quantity\s+of|units?\s+of|how\s+many|do\s+we\s+have|are\s+there\s+any|"
        r"check\s+stock|available\s+stock\s+of|product\s+stock|count\s+of)\b",
        q
    )) and not is_low_stock and not is_warehouse_dist

    if is_low_stock:
        planned_tools.append({"name": "get_low_stock_products", "args": {}})
        intents.append("INVENTORY")
    elif is_warehouse_dist:
        planned_tools.append({"name": "get_warehouse_inventory", "args": {}})
        intents.append("INVENTORY")
    elif is_movement:
        planned_tools.append({"name": "get_stock_movement_history", "args": {"limit": 20}})
        intents.append("INVENTORY")
    elif is_specific_product:
        term = extract_product_search_term(query)
        if term:
            planned_tools.append({"name": "get_product_stock", "args": {"product_name_or_sku": term}})
            intents.append("INVENTORY")
        else:
            planned_tools.append({"name": "get_inventory_summary", "args": {}})
            intents.append("INVENTORY")
    elif any(k in q for k in ["inventory", "physical stock", "total stock", "sku count", "atp", "available to promise"]):
        planned_tools.append({"name": "get_inventory_summary", "args": {}})
        intents.append("INVENTORY")

    # ------------------------------------------------------------------------
    # 3. Purchase Tools Matching
    # ------------------------------------------------------------------------
    is_pending_po = bool(re.search(
        r"\b(pending\s+(po|purchase|orders?)|awaiting\s+approval|needs?\s+approval|"
        r"unapproved|unconfirmed|waiting\s+for\s+sign-?off|draft\s+po|blocked\s+po)\b",
        q
    ))
    is_supplier_perf = bool(re.search(
        r"\b(top\s+(suppliers?|vendors?)|supplier\s+performance|highest\s+(purchase\s+)?volume|"
        r"vendor\s+spend|who\s+do\s+we\s+buy\s+from|vendor\s+analytics|supplier\s+ranking)\b",
        q
    ))
    is_purchase_summary = bool(re.search(
        r"\b(purchase\s+summary|procurement\s+(spend|summary|analytics)|total\s+purchase|"
        r"monthly\s+procurement|po\s+spend)\b",
        q
    ))
    is_general_po = bool(re.search(
        r"\b(purchase\s+orders?|list\s+pos?|recent\s+pos?|show\s+pos?|procurement\s+orders?)\b",
        q
    ))

    if is_pending_po:
        planned_tools.append({"name": "get_pending_purchase_orders", "args": {}})
        intents.append("PURCHASE")
    elif is_supplier_perf:
        planned_tools.append({"name": "get_supplier_performance", "args": {}})
        intents.append("PURCHASE")
    elif is_purchase_summary:
        planned_tools.append({"name": "get_purchase_summary", "args": {}})
        intents.append("PURCHASE")
    elif is_general_po:
        planned_tools.append({"name": "get_purchase_orders", "args": {"limit": 20}})
        intents.append("PURCHASE")

    # ------------------------------------------------------------------------
    # 4. Sales Tools Matching
    # ------------------------------------------------------------------------
    is_top_selling = bool(re.search(
        r"\b(top\s+selling|best\s*sellers?|most\s+popular\s+products?|fastest\s+moving|highest\s+sales|bestselling)\b",
        q
    ))
    is_sales_summary = bool(re.search(
        r"\b(sales\s+summary|total\s+sales|sales\s+revenue|revenue\s+this\s+month|commercial\s+revenue|gross\s+revenue|total\s+revenue)\b",
        q
    ))
    is_general_so = bool(re.search(
        r"\b(sales\s+orders?|commercial\s+orders?|recent\s+sales|customer\s+orders?)\b",
        q
    ))

    if is_top_selling:
        planned_tools.append({"name": "get_top_selling_products", "args": {"limit": 10}})
        intents.append("SALES")
    elif is_sales_summary:
        planned_tools.append({"name": "get_sales_summary", "args": {}})
        intents.append("SALES")
    elif is_general_so:
        planned_tools.append({"name": "get_sales_orders", "args": {"limit": 20}})
        intents.append("SALES")

    # ------------------------------------------------------------------------
    # 5. Logistics & Fleet Tools Matching
    # ------------------------------------------------------------------------
    is_delayed_shipment = bool(re.search(
        r"\b(delayed|overdue|late\s+shipments?|behind\s+schedule|missed\s+delivery|"
        r"past\s+delivery\s+date|undelivered\s+shipments?|delayed\s+delivery)\b",
        q
    ))
    is_delivery_perf = bool(re.search(
        r"\b(delivery\s+performance|on-?time\s+(rate|delivery|performance)|fulfillment\s+rate|logistics\s+sla)\b",
        q
    ))
    is_fleet = bool(re.search(
        r"\b(fleet|vehicles?|trucks?|vans?|odometer|vehicle\s+maintenance|drivers?|assigned\s+drivers?|driver\s+trips?|active\s+trips?)\b",
        q
    ))
    is_general_shipment = bool(re.search(
        r"\b(shipments?|deliveries|dispatches|in\s+transit|logistics\s+tracking)\b",
        q
    ))

    if is_delayed_shipment:
        planned_tools.append({"name": "get_delayed_shipments", "args": {}})
        intents.append("LOGISTICS")
    elif is_delivery_perf:
        planned_tools.append({"name": "get_delivery_performance", "args": {}})
        intents.append("LOGISTICS")
    elif is_fleet:
        planned_tools.append({"name": "get_fleet_and_vehicles", "args": {}})
        intents.append("LOGISTICS")
    elif is_general_shipment:
        planned_tools.append({"name": "get_shipments", "args": {"limit": 20}})
        intents.append("LOGISTICS")

    # ------------------------------------------------------------------------
    # 6. Finance Tools Matching
    # ------------------------------------------------------------------------
    is_invoices = bool(re.search(
        r"\b(unpaid\s+invoices?|outstanding\s+invoices?|overdue\s+invoices?|"
        r"pending\s+invoices?|receivables|uncollected|customer\s+balance|pending\s+bills?)\b",
        q
    ))
    is_valuation_expenses = bool(re.search(
        r"\b(inventory\s+valuation|asset\s+valuation|stock\s+value|worth\s+of\s+inventory|"
        r"expense\s+summary|operational\s+expenses?|total\s+expenses?)\b",
        q
    ))

    if is_invoices:
        planned_tools.append({"name": "get_outstanding_invoices", "args": {"limit": 20}})
        intents.append("FINANCE")
    elif is_valuation_expenses:
        planned_tools.append({"name": "get_expense_summary", "args": {}})
        intents.append("FINANCE")

    # Deduplicate tools
    unique_tools = []
    seen = set()
    for t in planned_tools:
        key = (t["name"], json.dumps(t["args"], sort_keys=True))
        if key not in seen:
            seen.add(key)
            unique_tools.append(t)

    distinct_intents = list(set(intents))
    if len(distinct_intents) == 1:
        final_intent = distinct_intents[0]
    elif len(distinct_intents) > 1:
        final_intent = "MIXED"
    elif need_rag:
        final_intent = "RAG"
    else:
        final_intent = "GENERAL"

    return {
        "intent": final_intent,
        "planned_tools": unique_tools,
        "need_rag": need_rag,
        "rag_query": rag_query if rag_query else (query if need_rag else ""),
    }

def llm_classify_and_plan(query: str, user_context: dict) -> Optional[Dict[str, Any]]:
    """
    Uses Gemini LLM to semantically understand complex, multi-faceted queries
    and output a structured JSON plan with exact tool calls and parameters.
    """
    llm = get_llm()
    if llm is None:
        return None

    try:
        from langchain_core.messages import SystemMessage, HumanMessage

        tools_brief = "\n".join([f"- {name}: {info['desc']}" for name, info in AVAILABLE_TOOLS.items()])

        system_prompt = (
            "You are the Intelligent Router & Query Planner for InventoryPro ERP.\n"
            "Analyze the user's inquiry and output ONLY a valid JSON object specifying which tools to execute and whether RAG document retrieval is needed.\n\n"
            f"AVAILABLE TOOLS:\n{tools_brief}\n\n"
            "DECISION CRITERIA:\n"
            "1. Procedural / How-To / Policy Questions (e.g. 'How do I create a PO?', 'Return policy', 'Quarantine rules'):\n"
            "   -> set need_rag = true, rag_query = cleaned search string. Do NOT call data tools unless live records are also requested.\n"
            "2. Data / Operational Questions (e.g. 'Low stock items', 'Pending POs', 'Delayed shipments', 'Dell laptop stock'):\n"
            "   -> select matching tools from the list above with appropriate args.\n"
            "3. Multi-part / Mixed Queries:\n"
            "   -> select both tools and set need_rag = true.\n\n"
            "OUTPUT FORMAT (STRICT JSON ONLY):\n"
            "{\n"
            '  "intent": "INVENTORY" | "PURCHASE" | "SALES" | "LOGISTICS" | "FINANCE" | "RAG" | "MIXED" | "GENERAL",\n'
            '  "planned_tools": [\n'
            '     {"name": "tool_name", "args": {"param": "val"}}\n'
            "  ],\n"
            '  "need_rag": true | false,\n'
            '  "rag_query": "search query for documents or empty string"\n'
            "}"
        )

        resp = llm.invoke([
            SystemMessage(content=system_prompt),
            HumanMessage(content=f"User Query: {query}\nUser Role: {user_context.get('role', 'EMPLOYEE')}")
        ])

        raw = resp.content if hasattr(resp, "content") else str(resp)
        # Clean markdown code block wraps if present
        clean_json = re.sub(r"^```(?:json)?\s*", "", raw.strip(), flags=re.MULTILINE)
        clean_json = re.sub(r"\s*```$", "", clean_json.strip(), flags=re.MULTILINE)

        parsed = json.loads(clean_json)
        # Validate structure
        if "planned_tools" in parsed and "intent" in parsed:
            # Filter planned_tools to only recognized tools
            valid_tools = []
            for t in parsed.get("planned_tools", []):
                if isinstance(t, dict) and t.get("name") in AVAILABLE_TOOLS:
                    valid_tools.append({
                        "name": t["name"],
                        "args": t.get("args", {})
                    })
            parsed["planned_tools"] = valid_tools
            return parsed
    except Exception as e:
        print(f"[RouterService] LLM planning fallback triggered: {e}")
        return None

    return None

def route_and_plan(query: str, user_context: dict) -> Dict[str, Any]:
    """
    Unified entrypoint for intelligent routing.
    Attempts LLM semantic planning first; falls back seamlessly to rule-based NLP engine.
    """
    # 1. Try LLM semantic planning
    plan = llm_classify_and_plan(query, user_context)
    if plan and (plan.get("planned_tools") or plan.get("need_rag")):
        return plan

    # 2. High-precision deterministic fallback
    return rule_based_classify_and_plan(query, user_context)

