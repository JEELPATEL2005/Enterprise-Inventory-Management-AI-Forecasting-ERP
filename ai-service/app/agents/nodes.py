import re
from typing import Dict, Any, List
from app.agents.state import AgentState
from app.agents.router_service import route_and_plan
from app.tools import inventory_tools, purchase_tools, sales_tools, logistics_tools, finance_tools
from app.rag import retriever
from app.services.llm_service import get_llm, generate_fallback_synthesis

INJECTION_PATTERNS = [
    r"ignore\s+(all\s+)?(previous|prior)\s+instructions",
    r"you\s+are\s+now\s+in\s+developer\s+mode",
    r"drop\s+(table|database|collection)",
    r"truncate\s+table",
    r"db\..*\.remove",
    r"db\..*\.delete",
    r"system\s+prompt\s+override",
]

MUTATION_PATTERNS = [
    r"approve\s+(this\s+)?purchase\s+order",
    r"delete\s+(this\s+)?(product|item|record|inventory|order|user)",
    r"delete\s+all\s+(products|items|records|inventory|orders|users)",
    r"update\s+(the\s+)?quantity",
    r"change\s+(the\s+)?price",
    r"dispatch\s+(this\s+)?shipment",
    r"mark\s+as\s+delivered",
    r"insert\s+into",
]

# Mapping of canonical tool names to their implementation functions
TOOL_REGISTRY = {
    # 1. Inventory Tools
    "get_inventory_summary": lambda ctx, args: inventory_tools.get_inventory_summary(ctx),
    "get_low_stock_products": lambda ctx, args: inventory_tools.get_low_stock_products(ctx, limit=args.get("limit", 50)),
    "get_product_stock": lambda ctx, args: inventory_tools.get_product_stock(
        ctx, args.get("product_name_or_sku") or args.get("search_term") or ""
    ),
    "get_warehouse_inventory": lambda ctx, args: inventory_tools.get_warehouse_inventory(ctx),
    "get_stock_movement_history": lambda ctx, args: inventory_tools.get_stock_movement_history(ctx, limit=args.get("limit", 20)),

    # 2. Purchase Tools
    "get_purchase_orders": lambda ctx, args: purchase_tools.get_purchase_orders(
        ctx, status=args.get("status"), limit=args.get("limit", 20)
    ),
    "get_pending_purchase_orders": lambda ctx, args: purchase_tools.get_pending_purchase_orders(ctx),
    "get_supplier_performance": lambda ctx, args: purchase_tools.get_supplier_performance(ctx),
    "get_purchase_summary": lambda ctx, args: purchase_tools.get_purchase_summary(ctx),

    # 3. Sales Tools
    "get_sales_orders": lambda ctx, args: sales_tools.get_sales_orders(
        ctx, status=args.get("status"), limit=args.get("limit", 20)
    ),
    "get_sales_summary": lambda ctx, args: sales_tools.get_sales_summary(ctx),
    "get_top_selling_products": lambda ctx, args: sales_tools.get_top_selling_products(ctx, limit=args.get("limit", 10)),

    # 4. Logistics & Fleet Tools
    "get_shipments": lambda ctx, args: logistics_tools.get_shipments(
        ctx, status=args.get("status"), limit=args.get("limit", 20)
    ),
    "get_delayed_shipments": lambda ctx, args: logistics_tools.get_delayed_shipments(ctx),
    "get_delivery_performance": lambda ctx, args: logistics_tools.get_delivery_performance(ctx),
    "get_fleet_and_vehicles": lambda ctx, args: logistics_tools.get_fleet_and_vehicles(ctx),

    # 5. Finance Tools
    "get_expense_summary": lambda ctx, args: finance_tools.get_expense_summary(ctx),
    "get_outstanding_invoices": lambda ctx, args: finance_tools.get_outstanding_invoices(ctx, limit=args.get("limit", 20)),
}

def guardrail_node(state: AgentState) -> AgentState:
    """Evaluates input query for prompt injections and enforces read-only boundaries."""
    query = state.user_query.lower()

    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, query):
            state.is_safe = False
            state.safety_message = "Your request was flagged by the ERP Security Guardrail as potentially unsafe."
            state.response_text = state.safety_message
            return state

    for pattern in MUTATION_PATTERNS:
        if re.search(pattern, query):
            state.is_safe = False
            state.safety_message = (
                "The InventoryPro AI Assistant operates in **Strict Read-Only Mode**. "
                "AI is prohibited from executing transactional mutations (approving orders, modifying inventory, "
                "or dispatching shipments). Please perform operational actions via the respective ERP modules."
            )
            state.response_text = state.safety_message
            return state

    return state

def router_node(state: AgentState) -> AgentState:
    """
    Intelligently classifies user query into functional domains, selects specific tools
    with extracted parameters, and determines if RAG document retrieval is needed.
    """
    if not state.is_safe:
        return state

    decision = route_and_plan(state.user_query, state.user_context)
    state.intent = decision.get("intent", "GENERAL")
    state.planned_tools = decision.get("planned_tools", [])
    state.need_rag = decision.get("need_rag", False)
    state.rag_query = decision.get("rag_query", state.user_query)

    return state

def tools_executor_node(state: AgentState) -> AgentState:
    """Executes safe parameterized tools scheduled by the router according to user permissions."""
    if not state.is_safe:
        return state

    ctx = state.user_context
    executed_any = False

    # 1. Execute all tools selected by the intelligent router
    for item in state.planned_tools:
        tool_name = item.get("name")
        tool_args = item.get("args", {})
        handler = TOOL_REGISTRY.get(tool_name)
        if handler and tool_name not in state.tools_executed:
            try:
                res = handler(ctx, tool_args)
                if res:
                    state.tool_results.append(res)
                    state.tools_executed.append(tool_name)
                    executed_any = True
            except Exception as e:
                print(f"[ToolsExecutor] Error executing {tool_name}: {e}")

    # 2. Domain fallback: If intent was identified but no specific subtool matched, run safe summary
    if not executed_any and state.intent in ["INVENTORY", "PURCHASE", "SALES", "LOGISTICS", "FINANCE"]:
        fallback_tool = {
            "INVENTORY": "get_inventory_summary",
            "PURCHASE": "get_purchase_orders",
            "SALES": "get_sales_orders",
            "LOGISTICS": "get_shipments",
            "FINANCE": "get_expense_summary",
        }.get(state.intent)

        if fallback_tool and fallback_tool not in state.tools_executed:
            handler = TOOL_REGISTRY.get(fallback_tool)
            if handler:
                try:
                    res = handler(ctx, {})
                    if res:
                        state.tool_results.append(res)
                        state.tools_executed.append(fallback_tool)
                except Exception as e:
                    print(f"[ToolsExecutor] Fallback error for {fallback_tool}: {e}")

    return state

def rag_retrieval_node(state: AgentState) -> AgentState:
    """Queries vector database for semantic match in company policies, SOPs, and agreements."""
    if not state.is_safe:
        return state

    # Trigger RAG if explicitly flagged, or if intent is RAG/MIXED,
    # or if query is general and no operational tools executed.
    should_query_rag = (
        state.need_rag
        or state.intent in ["RAG", "MIXED"]
        or (state.intent == "GENERAL" and not state.tools_executed)
    )

    if should_query_rag:
        role = state.user_context.get("role", "EMPLOYEE")
        query_text = state.rag_query if state.rag_query else state.user_query
        docs = retriever.retrieve_relevant_documents(query_text, user_role=role, n_results=3)
        if docs:
            state.rag_results.extend(docs)
            for d in docs:
                if d.get("source") and d["source"] not in state.citations:
                    state.citations.append(d["source"])

    return state

def response_synthesis_node(state: AgentState) -> AgentState:
    """Generates the grounded conversational answer using LLM or structured synthesis."""
    if not state.is_safe:
        return state

    llm = get_llm()
    if llm is None:
        # Fallback to direct factual synthesis
        state.response_text = generate_fallback_synthesis(
            query=state.user_query,
            tool_results=state.tool_results,
            rag_results=state.rag_results,
            user_role=state.user_context.get("role", "EMPLOYEE"),
        )
        return state

    # When Gemini LLM is active
    try:
        from langchain_core.messages import SystemMessage, HumanMessage

        system_prompt = (
            "You are the official InventoryPro ERP AI Assistant. You assist employees across Inventory, Warehouse, "
            "Purchase, Sales, Logistics, and Finance.\n\n"
            "RULES:\n"
            "1. Ground your answers STRICTLY in the provided ERP database query results and RAG document excerpts.\n"
            "2. Never hallucinate or invent records, order numbers, quantities, or prices.\n"
            "3. If requested data is not present in the results, explicitly inform the user that the data is not tracked or available.\n"
            "4. For logistics, live GPS vehicle tracking is NOT available in this ERP. State this clearly when asked about real-time locations.\n"
            "5. Format data clearly using GitHub-style markdown tables and bullet points.\n"
            f"User Context: Name={state.user_context.get('name')}, Role={state.user_context.get('role')}."
        )

        content_builder = [f"User Question: {state.user_query}\n\n"]

        if state.tool_results:
            content_builder.append("### ERP Operational Database Results:\n")
            for res in state.tool_results:
                content_builder.append(f"Query: {res.get('title')}\nSummary: {res.get('summary')}\nData: {res.get('data')}\n")

        if state.rag_results:
            content_builder.append("\n### RAG Retrieved Document Excerpts:\n")
            for d in state.rag_results:
                content_builder.append(f"Source: {d.get('source')}\nExcerpt: {d.get('content')}\n")

        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content="".join(content_builder))
        ]

        resp = llm.invoke(messages)
        state.response_text = resp.content if hasattr(resp, "content") else str(resp)
    except Exception as e:
        print(f"[Agent] LLM invocation error: {e}")
        state.response_text = generate_fallback_synthesis(
            query=state.user_query,
            tool_results=state.tool_results,
            rag_results=state.rag_results,
            user_role=state.user_context.get("role", "EMPLOYEE"),
        )

    return state
