"""Small, dependency-free request hardening for the demo FastAPI application."""
import json
import os
import threading
import time
from collections import defaultdict, deque


def setting_int(name, default, minimum=1):
    try:
        return max(minimum, int(os.getenv(name, default)))
    except (TypeError, ValueError):
        return default


MAX_JSON_BYTES = setting_int("AICTE_MAX_JSON_BYTES", 4 * 1024 * 1024)
MAX_REMARKS = setting_int("AICTE_MAX_REMARKS", 2000)


def validate_remarks(value, label="Remarks"):
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    if len(value) > MAX_REMARKS:
        raise ValueError(f"{label} must not exceed {MAX_REMARKS} characters")
    return value.strip()


class WriteLimiter:
    """Sliding-minute counter keyed by client IP and claimed role; injectable monotonic clock."""
    def __init__(self, limit=60, clock=None):
        self.limit = limit
        self.clock = clock or time.monotonic
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key):
        now = self.clock()
        with self._lock:
            q = self._hits[key]
            while q and now - q[0] >= 60:
                q.popleft()
            if len(q) >= self.limit:
                return max(1, int(61 - (now - q[0])))
            q.append(now)
        return 0

    def retry_after(self, key):
        with self._lock:
            q = self._hits.get(key)
            return max(1, int(61 - (self.clock() - q[0]))) if q else 1

    def clear(self):
        with self._lock:
            self._hits.clear()


limiter = WriteLimiter(setting_int("AICTE_WRITE_RATE_PER_MIN", 60))

# Scripts can disable throttling in a controlled local smoke run with AICTE_RATE_LIMIT_ENABLED=0.
def rate_enabled():
    return os.getenv("AICTE_RATE_LIMIT_ENABLED", "1").lower() not in ("0", "false", "off")


CSP = ("default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; "
       "form-action 'self'; img-src 'self' data: blob:; font-src 'self' data:; "
       "style-src 'self' 'unsafe-inline'; script-src 'self'; "
       "connect-src 'self' http://127.0.0.1:8000 http://localhost:5173 ws://localhost:5173 ws://127.0.0.1:5173")
SECURITY_HEADERS = (
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"content-security-policy", CSP.encode("ascii")),
)


class SecurityMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        method = scope["method"].upper()
        path = scope.get("path", "")
        client = scope.get("client")
        ip = client[0] if client else "unknown"
        role = headers.get(b"x-role", b"SENIOR").decode("utf-8", "replace")[:64]

        async def secured_send(message):
            if message["type"] == "http.response.start":
                h = message.setdefault("headers", [])
                for k, v in SECURITY_HEADERS:
                    if not any(existing.lower() == k for existing, _ in h):
                        h.append((k, v))
            await send(message)

        async def reject(status, detail, extra=None):
            payload = json.dumps({"detail": detail}).encode("utf-8")
            extra = extra or []
            await secured_send({"type": "http.response.start", "status": status,
                                "headers": [(b"content-type", b"application/json"),
                                            (b"content-length", str(len(payload)).encode())] + extra})
            await secured_send({"type": "http.response.body", "body": payload})

        if method in ("POST", "PUT", "PATCH", "DELETE") and path.startswith("/api/") and path != "/api/complaints/preview":
            if rate_enabled() and limiter.check((ip, role)):
                retry = limiter.retry_after((ip, role))
                return await reject(429, "Write rate limit exceeded; retry later", [(b"retry-after", str(retry).encode())])

        # Buffer only JSON writes, stopping before exceeding the configured cap.
        if method in ("POST", "PUT", "PATCH") and path.startswith("/api/") and \
                (b"application/json" in headers.get(b"content-type", b"").lower() or
                 headers.get(b"content-type", b"") == b""):
            limit = setting_int("AICTE_MAX_JSON_BYTES", MAX_JSON_BYTES)
            try:
                if int(headers.get(b"content-length", b"0")) > limit:
                    return await reject(413, f"JSON request body exceeds {limit} bytes")
            except ValueError:
                pass
            chunks = []
            total = 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                if message["type"] != "http.request":
                    continue
                part = message.get("body", b"")
                total += len(part)
                if total > limit:
                    return await reject(413, f"JSON request body exceeds {limit} bytes")
                chunks.append(part)
                if not message.get("more_body", False):
                    break
            body = b"".join(chunks)
            served = False

            async def replay():
                nonlocal served
                if not served:
                    served = True
                    return {"type": "http.request", "body": body, "more_body": False}
                # Await downstream cancellation/disconnect, instead of spinning.
                return await receive()
            receive = replay
        await self.app(scope, receive, secured_send)
