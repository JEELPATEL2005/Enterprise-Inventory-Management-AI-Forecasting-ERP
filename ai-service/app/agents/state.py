from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field

class AgentState(BaseModel):
    user_query: str
    user_context: Dict[str, Any] = Field(default_factory=dict)
    thread_id: str = ""
    history: List[Dict[str, Any]] = Field(default_factory=list)
    intent: str = "GENERAL"
    tool_results: List[Dict[str, Any]] = Field(default_factory=list)
    rag_results: List[Dict[str, Any]] = Field(default_factory=list)
    tools_executed: List[str] = Field(default_factory=list)
    planned_tools: List[Dict[str, Any]] = Field(default_factory=list)
    need_rag: bool = False
    rag_query: str = ""
    citations: List[str] = Field(default_factory=list)
    is_safe: bool = True
    safety_message: Optional[str] = None
    response_text: str = ""

