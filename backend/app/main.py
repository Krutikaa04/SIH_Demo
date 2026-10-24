"""Wire API routers, background SLA updates and the built single-page UI."""
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import db, events, extras, sla
from .routers import admin, alerts, cases, dashboard, intel_views, institutions, meta, overlaps, rooms
from .routers import events as event_routes

DIST = db.ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app):
    events.bind_loop(asyncio.get_running_loop())

    def _tick():
        conn = db.connect()
        try:
            sla.tick(conn)
        finally:
            conn.close()

    async def _engine():
        while True:
            await asyncio.sleep(30)
            try:
                if db.is_seeded():
                    await asyncio.to_thread(_tick)
            except Exception as e:
                print("[sla] tick failed:", e)

    task = asyncio.create_task(_engine())
    yield
    task.cancel()



app = FastAPI(title="AICTE Integrated Complaint Monitoring", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
                   allow_methods=["*"], allow_headers=["*"])

# Document subroutes must precede the greedy case ID route; the SPA fallback stays last.
app.include_router(extras.router)
for domain in (meta, cases, institutions, dashboard, overlaps, intel_views, rooms, alerts, admin, event_routes):
    app.include_router(domain.router)


if (DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")


@app.get("/{full_path:path}")
def spa(full_path: str):
    if full_path.startswith("api/"):
        raise HTTPException(404)
    f = (DIST / full_path)
    if full_path and f.is_file() and DIST in f.resolve().parents:
        return FileResponse(f)
    index = DIST / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return {"message": "UI not built yet. Run: cd frontend && npm install && npm run build"}
