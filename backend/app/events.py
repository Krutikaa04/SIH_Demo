"""Tiny in-process SSE broadcaster. publish() is safe to call from sync (threadpool) code."""
import asyncio
import json

_subs: set = set()
_loop = None


def bind_loop(loop):
    global _loop
    _loop = loop


def subscribe():
    q = asyncio.Queue(maxsize=200)
    _subs.add(q)
    return q


def unsubscribe(q):
    _subs.discard(q)


def publish(event, data=None):
    msg = {"event": event, "data": json.dumps(data or {})}
    if _loop is None:
        return
    for q in list(_subs):
        try:
            _loop.call_soon_threadsafe(q.put_nowait, msg)
        except Exception:
            pass
