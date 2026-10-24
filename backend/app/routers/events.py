"""Events API routes."""
import asyncio
from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from .. import events

router = APIRouter()


@router.get("/api/events")
async def sse():
    q = events.subscribe()

    async def gen():
        yield "retry: 2000\n\n"
        try:
            while True:
                try:
                    m = await asyncio.wait_for(q.get(), 15)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: {m['event']}\ndata: {m['data']}\n\n"
        finally:
            events.unsubscribe(q)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})

