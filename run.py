"""One command to run the demo:  python run.py

Seeds the database on first run, then serves the API and the built UI on http://localhost:8000
"""
import sys
import threading
import time
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))

PORT = 8000


def main():
    from app import db, seed

    if "--reseed" in sys.argv or not db.is_seeded():
        print("Seeding demo database (60 institutions, ~300 cases)...")
        conn = db.connect()
        seed.seed(conn)
        conn.close()
        print("Seed complete.")
    if not (ROOT / "frontend" / "dist" / "index.html").exists():
     print("ERROR: Built frontend is missing.")
     print("For development: install Node.js, then run npm ci && npm run build inside frontend/.")
     print("For the offline demo: use the built bundle downloaded from GitHub Releases.")
     return

    import uvicorn

    if "--no-browser" not in sys.argv:
        threading.Thread(target=lambda: (time.sleep(1.5), webbrowser.open(f"http://127.0.0.1:{PORT}")),
                         daemon=True).start()
    print(f"\n  AICTE Complaint Monitoring dashboard -> http://127.0.0.1:{PORT}\n  Press Ctrl+C to stop.\n")
    uvicorn.run("app.main:app", host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
