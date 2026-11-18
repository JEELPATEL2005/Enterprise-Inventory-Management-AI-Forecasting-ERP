import os
import sys
import subprocess
from pathlib import Path

# Locate project virtual environment (checks ai-service/venv or ml-service/venv)
ROOT_DIR = Path(__file__).resolve().parent.parent
AI_VENV_PYTHON = ROOT_DIR / "ai-service" / "venv" / "Scripts" / "python.exe"
LOCAL_VENV_PYTHON = ROOT_DIR / "ml-service" / "venv" / "Scripts" / "python.exe"

target_python = None
if AI_VENV_PYTHON.exists():
    target_python = AI_VENV_PYTHON
elif LOCAL_VENV_PYTHON.exists():
    target_python = LOCAL_VENV_PYTHON

# If we are not currently running within the verified venv, re-spawn
if target_python and sys.executable.lower() != str(target_python).lower():
    print(f"[Inventory ML Service] Switching to environment: {target_python}")
    result = subprocess.run([str(target_python), __file__] + sys.argv[1:])
    sys.exit(result.returncode)

if __name__ == "__main__":
    import uvicorn
    from app.config import HOST, PORT

    print(f"Starting Inventory ML Service on http://{HOST}:{PORT}")
    uvicorn.run("app.main:app", host=HOST, port=PORT, reload=False)

