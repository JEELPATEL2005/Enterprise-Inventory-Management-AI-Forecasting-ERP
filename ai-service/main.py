import sys
import os
import subprocess

# Auto-detect Python interpreter with dependencies installed
try:
    import uvicorn
    import fastapi
    import chromadb
    import pymongo
except ModuleNotFoundError:
    venv_py = os.path.join(os.path.dirname(os.path.abspath(__file__)), "venv", "Scripts", "python.exe")
    py313 = r"C:\Users\Jeel Patel\AppData\Local\Programs\Python\Python313\python.exe"

    selected_py = None
    # Prefer virtual environment if its dependencies are ready, else use configured Python 3.13
    if os.path.exists(venv_py) and venv_py.lower() != sys.executable.lower():
        # Check if venv has core dependencies ready
        check_proc = subprocess.run([venv_py, "-c", "import uvicorn, chromadb, pymongo"], capture_output=True)
        if check_proc.returncode == 0:
            selected_py = venv_py

    if not selected_py and os.path.exists(py313) and py313.lower() != sys.executable.lower():
        check_proc = subprocess.run([py313, "-c", "import uvicorn, chromadb, pymongo"], capture_output=True)
        if check_proc.returncode == 0:
            selected_py = py313

    if selected_py:
        print(f"[InventoryPro AI] Switched to verified environment: {selected_py}")
        try:
            sys.exit(subprocess.call([selected_py, os.path.abspath(__file__)] + sys.argv[1:]))
        except KeyboardInterrupt:
            sys.exit(0)
    else:
        raise

# Ensure the ai-service directory is on sys.path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.config import settings

if __name__ == "__main__":
    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
