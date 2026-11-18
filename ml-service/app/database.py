from pymongo import MongoClient
from app.config import MONGO_URI
from app.utils.logger import logger

_client = None

def get_db():
    global _client
    if _client is None:
        try:
            logger.info(f"Connecting to MongoDB at {MONGO_URI}")
            _client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
            # Verify connection
            _client.admin.command('ping')
            logger.info("MongoDB connection successful")
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
            raise e

    # Extract db name from URI or default to 'inventory'
    db_name = "inventory"
    if "/" in MONGO_URI.rsplit("?", 1)[0]:
        candidate = MONGO_URI.rsplit("?", 1)[0].split("/")[-1]
        if candidate:
            db_name = candidate

    return _client[db_name]

def get_collection(name: str):
    db = get_db()
    return db[name]

