from langgraph.graph import StateGraph, END
from app.agents.state import AgentState
from app.agents.nodes import (
    guardrail_node,
    router_node,
    tools_executor_node,
    rag_retrieval_node,
    response_synthesis_node,
)

def build_erp_graph():
    """Builds and compiles the production LangGraph state graph for InventoryPro ERP."""
    workflow = StateGraph(AgentState)

    # Add processing nodes
    workflow.add_node("guardrail", guardrail_node)
    workflow.add_node("router", router_node)
    workflow.add_node("tools_executor", tools_executor_node)
    workflow.add_node("rag_retrieval", rag_retrieval_node)
    workflow.add_node("response_synthesis", response_synthesis_node)

    # Set Entry point
    workflow.set_entry_point("guardrail")

    # Conditional branching from guardrail
    def check_guardrail_status(state: AgentState) -> str:
        if not state.is_safe:
            return "end"
        return "continue"

    workflow.add_conditional_edges(
        "guardrail",
        check_guardrail_status,
        {
            "end": END,
            "continue": "router",
        },
    )

    # Linear progression through tools, RAG, and response synthesis
    workflow.add_edge("router", "tools_executor")
    workflow.add_edge("tools_executor", "rag_retrieval")
    workflow.add_edge("rag_retrieval", "response_synthesis")
    workflow.add_edge("response_synthesis", END)

    return workflow.compile()

# Singleton compiled graph instance
erp_agent_graph = build_erp_graph()

