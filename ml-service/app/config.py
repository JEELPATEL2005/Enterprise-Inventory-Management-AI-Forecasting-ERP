import os
from pathlib import Path
from dotenv import load_dotenv

# Load from current directory .env or parent
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

PORT = int(os.getenv("PORT", "8001"))
HOST = os.getenv("HOST", "127.0.0.1")
MONGO_URI = os.getenv("MONGO_URI", "mongodb://127.0.0.1:27017/inventory")
INTERNAL_SERVICE_KEY = os.getenv("INTERNAL_SERVICE_KEY", "inventory_internal_ml_secret_key_2026")
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")

# Model storage directory
BASE_DIR = Path(__file__).resolve().parent.parent
MODEL_DIR = BASE_DIR / "saved_models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

