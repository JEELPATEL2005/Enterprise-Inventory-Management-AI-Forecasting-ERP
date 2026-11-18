import uuid
from datetime import datetime
from typing import List, Dict, Any, Optional
from app.core.database import get_db

def get_or_create_conversation(thread_id: Optional[str], user_id: str, title: Optional[str] = None) -> str:
    """Retrieves an existing conversation or creates a new one tied to the authenticated user."""
    db = get_db()
    if thread_id:
        existing = db.ai_conversations.find_one({"thread_id": thread_id, "user_id": user_id})
        if existing:
            return thread_id

    new_id = thread_id or f"conv_{uuid.uuid4().hex[:12]}"
    db.ai_conversations.insert_one({
        "thread_id": new_id,
        "user_id": user_id,
        "title": title or "New Conversation",
        "messages": [],
        "created_at": datetime.now(),
        "updated_at": datetime.now(),
    })
    return new_id

def append_message(
    thread_id: str,
    user_id: str,
    role: str,
    content: str,
    tools_used: Optional[List[str]] = None,
    citations: Optional[List[str]] = None,
) -> None:
    """Appends a new turn to the conversation history."""
    db = get_db()
    msg = {
        "role": role,
        "content": content,
        "timestamp": datetime.now(),
        "tools_used": tools_used or [],
        "citations": citations or [],
    }

    # If first message, generate title from content
    conv = db.ai_conversations.find_one({"thread_id": thread_id, "user_id": user_id})
    update_data = {
        "$push": {"messages": msg},
        "$set": {"updated_at": datetime.now()},
    }
    if conv and (not conv.get("title") or conv.get("title") == "New Conversation") and role == "user":
        clean_title = content.strip().replace("\n", " ")[:40]
        update_data["$set"]["title"] = clean_title + ("..." if len(content) > 40 else "")

    db.ai_conversations.update_one(
        {"thread_id": thread_id, "user_id": user_id},
        update_data,
        upsert=True,
    )

def get_conversation_history(thread_id: str, user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    """Fetches recent conversation turns for context memory."""
    db = get_db()
    conv = db.ai_conversations.find_one({"thread_id": thread_id, "user_id": user_id})
    if not conv:
        return []
    messages = conv.get("messages", [])
    return messages[-limit:]

def list_user_conversations(user_id: str) -> List[Dict[str, Any]]:
    """Returns list of all conversation threads for the user."""
    db = get_db()
    cursor = db.ai_conversations.find(
        {"user_id": user_id},
        {"thread_id": 1, "title": 1, "created_at": 1, "updated_at": 1, "messages": {"$slice": -1}}
    ).sort("updated_at", -1).limit(30)

    results = []
    for c in cursor:
        last_msg = c.get("messages", [{}])[0].get("content", "") if c.get("messages") else ""
        results.append({
            "thread_id": c.get("thread_id"),
            "title": c.get("title") or "Conversation",
            "last_message": last_msg[:60] + ("..." if len(last_msg) > 60 else ""),
            "updated_at": c.get("updated_at").isoformat() if c.get("updated_at") else "",
        })
    return results

def delete_user_conversation(thread_id: str, user_id: str) -> bool:
    """Deletes a conversation thread owned by the user."""
    db = get_db()
    res = db.ai_conversations.delete_one({"thread_id": thread_id, "user_id": user_id})
    return res.deleted_count > 0

