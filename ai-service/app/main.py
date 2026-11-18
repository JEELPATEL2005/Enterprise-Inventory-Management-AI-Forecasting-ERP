import os
import shutil
from typing import Optional, List
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from app.config import settings
from app.core.auth import verify_internal_service, AuthenticatedUser
from app.core.database import get_db, get_chroma_client
from app.agents.state import AgentState
from app.agents.graph import erp_agent_graph
from app.memory import conversation_store
from app.rag import ingestion

app = FastAPI(
    title="InventoryPro Agentic AI Service",
    description="Production-grade LangGraph and RAG intelligence for InventoryPro ERP",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- Request / Response Models -----------------

class ChatRequest(BaseModel):
    query: str
    thread_id: Optional[str] = None

class ChatResponse(BaseModel):
    thread_id: str
    response: str
    intent: str
    tools_executed: List[str]
    citations: List[str]

# ----------------- Health Check -----------------

@app.get("/health")
def health_check():
    mongo_ok = False
    try:
        db = get_db()
        db.command("ping")
        mongo_ok = True
    except Exception as e:
        print(f"[Health] MongoDB connection check failed: {e}")

    chroma_ok = False
    chroma_count = 0
    try:
        coll = ingestion.get_document_collection()
        chroma_count = coll.count()
        chroma_ok = True
    except Exception as e:
        print(f"[Health] ChromaDB check failed: {e}")

    return {
        "status": "healthy" if mongo_ok else "degraded",
        "service": "InventoryPro Agentic AI Assistant",
        "mongodb_connected": mongo_ok,
        "chromadb_connected": chroma_ok,
        "indexed_chunks": chroma_count,
        "llm_provider": "gemini" if settings.GEMINI_API_KEY else "fallback-grounded-synthesis",
    }

# ----------------- AI Chat Endpoint -----------------

@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(
    req: ChatRequest,
    user: AuthenticatedUser = Depends(verify_internal_service),
):
    if not req.query or not req.query.strip():
        raise HTTPException(status_code=400, detail="Query cannot be empty.")

    # Get or create thread
    thread_id = conversation_store.get_or_create_conversation(req.thread_id, user.id)

    # Fetch recent conversation turns
    recent_history = conversation_store.get_conversation_history(thread_id, user.id, limit=6)

    # Prepare LangGraph initial state
    initial_state = AgentState(
        user_query=req.query.strip(),
        user_context={
            "id": user.id,
            "name": user.name,
            "email": user.email,
            "role": user.role,
            "assigned_warehouses": user.assigned_warehouses,
        },
        thread_id=thread_id,
        history=recent_history,
    )

    # Execute LangGraph orchestration
    final_state = erp_agent_graph.invoke(initial_state)

    resp_text = final_state.get("response_text", "Unable to process query.")
    intent = final_state.get("intent", "GENERAL")
    tools = final_state.get("tools_executed", [])
    citations = final_state.get("citations", [])

    # Record turn into persistent MongoDB conversation memory
    conversation_store.append_message(
        thread_id=thread_id,
        user_id=user.id,
        role="user",
        content=req.query,
    )
    conversation_store.append_message(
        thread_id=thread_id,
        user_id=user.id,
        role="assistant",
        content=resp_text,
        tools_used=tools,
        citations=citations,
    )

    return ChatResponse(
        thread_id=thread_id,
        response=resp_text,
        intent=intent,
        tools_executed=tools,
        citations=citations,
    )

# ----------------- Conversation Memory Endpoints -----------------

@app.get("/api/conversations")
async def list_conversations(user: AuthenticatedUser = Depends(verify_internal_service)):
    return {"success": True, "data": conversation_store.list_user_conversations(user.id)}

@app.get("/api/conversations/{thread_id}")
async def get_conversation(thread_id: str, user: AuthenticatedUser = Depends(verify_internal_service)):
    history = conversation_store.get_conversation_history(thread_id, user.id, limit=50)
    return {"success": True, "thread_id": thread_id, "messages": history}

@app.delete("/api/conversations/{thread_id}")
async def delete_conversation(thread_id: str, user: AuthenticatedUser = Depends(verify_internal_service)):
    ok = conversation_store.delete_user_conversation(thread_id, user.id)
    return {"success": ok}

# ----------------- RAG Document Endpoints -----------------

@app.post("/api/documents/upload")
async def upload_document(
    file: UploadFile = File(...),
    allowed_roles: Optional[str] = Form("ALL"),
    user: AuthenticatedUser = Depends(verify_internal_service),
):
    # Only Admin or Managers can upload company SOPs
    if user.role not in [
        "SUPER_ADMIN",
        "ADMIN",
        "PURCHASE_MANAGER",
        "WAREHOUSE_MANAGER",
        "SALES_MANAGER",
        "CENTRAL_WAREHOUSE_OPERATIONS_MANAGER",
    ]:
        raise HTTPException(status_code=403, detail="You do not have permission to upload company documents.")

    clean_filename = os.path.basename(file.filename or "uploaded_document")
    file_ext = os.path.splitext(clean_filename)[1].lower()
    if file_ext not in [".pdf", ".docx", ".doc", ".txt", ".md", ".csv"]:
        raise HTTPException(status_code=400, detail="Invalid format. Supported: .pdf, .docx, .txt, .md, .csv")

    save_path = os.path.join(settings.UPLOAD_DIR, f"{user.id}_{clean_filename}")
    with open(save_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    roles_list = [r.strip().upper() for r in (allowed_roles or "ALL").split(",") if r.strip()]

    try:
        result = ingestion.ingest_document(
            file_path=save_path,
            filename=clean_filename,
            uploader_id=user.id,
            allowed_roles=roles_list if roles_list else ["ALL"],
        )
        return {"success": True, "data": result}
    except Exception as e:
        if os.path.exists(save_path):
            os.remove(save_path)
        raise HTTPException(status_code=500, detail=f"Document indexing failed: {str(e)}")

@app.get("/api/documents")
async def list_documents(user: AuthenticatedUser = Depends(verify_internal_service)):
    docs = ingestion.list_documents()
    return {"success": True, "data": docs}

@app.delete("/api/documents/{document_id}")
async def delete_document(document_id: str, user: AuthenticatedUser = Depends(verify_internal_service)):
    if user.role not in ["SUPER_ADMIN", "ADMIN"]:
        raise HTTPException(status_code=403, detail="Super Admin authorization required to delete company SOPs.")
    ingestion.delete_document(document_id)
    return {"success": True, "message": "Document removed from vector knowledgebase."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)

