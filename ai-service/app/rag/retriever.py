from typing import List, Dict, Any
from app.core.database import get_document_collection

def retrieve_relevant_documents(
    query: str,
    user_role: str = "EMPLOYEE",
    n_results: int = 4,
) -> List[Dict[str, Any]]:
    """
    Performs semantic vector search against indexed company documents in ChromaDB,
    filtering for role-based document access.
    """
    collection = get_document_collection()
    if collection.count() == 0:
        return []

    try:
        results = collection.query(
            query_texts=[query],
            n_results=min(n_results, collection.count()),
            include=["documents", "metadatas", "distances"],
        )
    except Exception as e:
        print(f"[RAG] Chroma query error: {e}")
        return []

    docs = results.get("documents", [[]])[0]
    metadatas = results.get("metadatas", [[]])[0]
    distances = results.get("distances", [[]])[0]

    retrieved = []
    for doc_text, meta, dist in zip(docs, metadatas, distances):
        allowed_roles = meta.get("allowed_roles", "ALL").split(",")
        # Check authorization
        if "ALL" in allowed_roles or user_role in ["SUPER_ADMIN", "ADMIN"] or user_role in allowed_roles:
            retrieved.append({
                "content": doc_text,
                "source": meta.get("filename", "Company Document"),
                "document_id": meta.get("document_id"),
                "chunk_index": meta.get("chunk_index"),
                "distance": float(dist) if dist is not None else 0.0,
            })

    return retrieved

