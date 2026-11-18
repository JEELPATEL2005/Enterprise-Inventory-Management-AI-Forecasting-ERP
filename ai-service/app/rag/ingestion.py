import os
import uuid
from datetime import datetime
from typing import Dict, Any, List
from pathlib import Path
from langchain_text_splitters import RecursiveCharacterTextSplitter
from app.core.database import get_document_collection
from app.config import settings

def extract_text_from_file(file_path: str) -> str:
    """Extracts raw text from PDF, DOCX, or TXT file."""
    ext = Path(file_path).suffix.lower()
    text = ""

    if ext == ".pdf":
        from pypdf import PdfReader
        reader = PdfReader(file_path)
        for page in reader.pages:
            t = page.extract_text()
            if t:
                text += t + "\n"

    elif ext in [".docx", ".doc"]:
        import docx
        doc = docx.Document(file_path)
        for p in doc.paragraphs:
            if p.text:
                text += p.text + "\n"

    elif ext in [".txt", ".md", ".csv"]:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            text = f.read()

    else:
        raise ValueError(f"Unsupported file format: {ext}. Supported formats: .pdf, .docx, .txt, .md, .csv")

    return text.strip()

def ingest_document(
    file_path: str,
    filename: str,
    uploader_id: str,
    allowed_roles: List[str] = None,
) -> Dict[str, Any]:
    """
    Parses, chunks, and indexes a company document into the ChromaDB vector store.
    """
    text = extract_text_from_file(file_path)
    if not text:
        raise ValueError(
            "Could not extract any readable text from the document. "
            "Please ensure the file contains readable/selectable text."
        )

    # Split into manageable semantically coherent chunks
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=700,
        chunk_overlap=100,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    chunks = text_splitter.split_text(text)
    if not chunks:
        raise ValueError("Document was empty after chunking.")

    collection = get_document_collection()
    doc_id = str(uuid.uuid4())
    now_iso = datetime.now().isoformat()
    roles_str = ",".join(allowed_roles or ["ALL"])

    ids = [f"{doc_id}_{i}" for i in range(len(chunks))]
    metadatas = [
        {
            "document_id": doc_id,
            "filename": filename,
            "chunk_index": i,
            "total_chunks": len(chunks),
            "uploader_id": uploader_id,
            "allowed_roles": roles_str,
            "uploaded_at": now_iso,
        }
        for i in range(len(chunks))
    ]

    # ChromaDB built-in default embedding or custom
    collection.add(
        ids=ids,
        documents=chunks,
        metadatas=metadatas,
    )

    return {
        "success": True,
        "document_id": doc_id,
        "filename": filename,
        "chunks_indexed": len(chunks),
        "chunks_created": len(chunks),
        "uploaded_at": now_iso,
    }

def delete_document(document_id: str) -> bool:
    """Removes all indexed chunks for a given document from the vector store."""
    collection = get_document_collection()
    collection.delete(where={"document_id": document_id})
    return True

def list_documents() -> List[Dict[str, Any]]:
    """Lists unique ingested documents stored in the ChromaDB vector collection."""
    collection = get_document_collection()
    # Fetch sample metadata
    results = collection.get(include=["metadatas"])
    metadatas = results.get("metadatas", [])

    unique_docs = {}
    for meta in metadatas:
        doc_id = meta.get("document_id")
        if doc_id and doc_id not in unique_docs:
            unique_docs[doc_id] = {
                "document_id": doc_id,
                "filename": meta.get("filename", "Unknown Document"),
                "total_chunks": meta.get("total_chunks", 1),
                "uploaded_at": meta.get("uploaded_at", ""),
                "allowed_roles": meta.get("allowed_roles", "ALL").split(","),
            }

    return list(unique_docs.values())

