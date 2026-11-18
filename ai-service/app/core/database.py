from typing import Optional
from pymongo import MongoClient
from pymongo.database import Database
import chromadb
from app.config import settings

_mongo_client: Optional[MongoClient] = None
_chroma_client: Optional[chromadb.ClientAPI] = None

def get_mongo_client() -> MongoClient:
    global _mongo_client
    if _mongo_client is None:
        _mongo_client = MongoClient(settings.MONGO_URI, serverSelectionTimeoutMS=5000)
    return _mongo_client

def get_db() -> Database:
    client = get_mongo_client()
    # If the URI specifies a database name, use it; otherwise default to "inventory"
    try:
        db = client.get_default_database()
        if db is not None and db.name:
            return db
    except Exception:
        pass
    return client["inventory"]

def get_chroma_client() -> chromadb.ClientAPI:
    global _chroma_client
    if _chroma_client is None:
        _chroma_client = chromadb.PersistentClient(path=settings.CHROMA_PERSIST_DIR)
    return _chroma_client

def get_document_collection() -> chromadb.Collection:
    chroma = get_chroma_client()
    return chroma.get_or_create_collection(
        name="erp_documents",
        metadata={"description": "Company SOPs, vendor agreements, and policies"},
    )

def close_connections():
    global _mongo_client
    if _mongo_client:
        try:
            _mongo_client.close()
        except Exception:
            pass
        _mongo_client = None

