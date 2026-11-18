import os
from pathlib import Path
from pydantic_settings import BaseSettings
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

class Settings(BaseSettings):
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))
    MONGO_URI: str = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/inventory")
    INTERNAL_SERVICE_KEY: str = os.getenv("INTERNAL_SERVICE_KEY", "erp-ai-internal-secret-key-359")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-1.5-flash")
    CHROMA_PERSIST_DIR: str = str(BASE_DIR / "chromadb_data")
    UPLOAD_DIR: str = str(BASE_DIR / "uploads")

    class Config:
        case_sensitive = True

settings = Settings()

# Ensure runtime directories exist
os.makedirs(settings.CHROMA_PERSIST_DIR, exist_ok=True)
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)

