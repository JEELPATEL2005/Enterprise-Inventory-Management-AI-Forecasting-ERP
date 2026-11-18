import os
from typing import Optional, List, Any
from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import BaseMessage, AIMessage
from app.config import settings

def get_llm() -> Optional[BaseChatModel]:
    """
    Returns an instance of LangChain ChatGoogleGenerativeAI if GEMINI_API_KEY is configured.
    Returns None if not configured, allowing fallback synthesis.
    """
    api_key = settings.GEMINI_API_KEY or os.getenv("GEMINI_API_KEY")
    if not api_key:
        return None

    try:
        from langchain_google_genai import ChatGoogleGenerativeAI
        return ChatGoogleGenerativeAI(
            model=settings.LLM_MODEL,
            google_api_key=api_key,
            temperature=0.2,
            max_output_tokens=2048,
        )
    except Exception as e:
        print(f"[LLMService] Failed to initialize Gemini LLM: {e}")
        return None

def generate_fallback_synthesis(
    query: str,
    tool_results: List[dict],
    rag_results: List[dict],
    user_role: str,
) -> str:
    """
    Synthesizes a clean, grounded markdown response directly from real ERP database
    records and RAG documents when the external LLM API key is not configured.
    """
    output_parts = []

    # If RAG results exist
    if rag_results:
        output_parts.append("### 📄 Relevant Company Documentation & SOPs")
        for idx, doc in enumerate(rag_results, 1):
            source = doc.get("source", "Document")
            text = doc.get("content", "")[:300].strip()
            output_parts.append(f"**[{idx}] Source: `{source}`**\n> {text}...\n")

    # If ERP Tool results exist
    if tool_results:
        for res in tool_results:
            title = res.get("title", "ERP Query Results")
            summary = res.get("summary", "")
            disclaimer = res.get("disclaimer")
            data = res.get("data", [])

            output_parts.append(f"### 📊 {title}")
            if summary:
                output_parts.append(f"{summary}\n")

            if disclaimer:
                output_parts.append(f"> ℹ️ **Notice:** {disclaimer}\n")

            if isinstance(data, list) and len(data) > 0 and isinstance(data[0], dict):
                # Format list of dicts as markdown table
                headers = list(data[0].keys())
                header_row = "| " + " | ".join(headers) + " |"
                sep_row = "| " + " | ".join(["---"] * len(headers)) + " |"
                data_rows = []
                for row in data[:25]:  # Limit rows in chat display
                    row_vals = [str(row.get(h, "—")).replace("\n", " ") for h in headers]
                    data_rows.append("| " + " | ".join(row_vals) + " |")

                output_parts.append("\n".join([header_row, sep_row] + data_rows))
                if len(data) > 25:
                    output_parts.append(f"\n*(Showing 25 of {len(data)} total records)*")
                output_parts.append("")
            elif isinstance(data, dict):
                for k, v in data.items():
                    output_parts.append(f"* **{k.replace('_', ' ').title()}:** {v}")
                output_parts.append("")
            elif not data:
                output_parts.append("No matching records found in the database for this query.\n")

    if not output_parts:
        return (
            "I analyzed your request, but found no matching records in the authorized ERP database.\n\n"
            "You can ask about:\n"
            "- **Inventory:** low stock items, stock balances, movements.\n"
            "- **Procurement:** pending purchase orders, supplier spend.\n"
            "- **Sales:** commercial orders, top products, customer invoices.\n"
            "- **Logistics:** active dispatches, scheduled delivery dates (Note: live GPS coordinates are not supported)."
        )

    return "\n\n".join(output_parts)

