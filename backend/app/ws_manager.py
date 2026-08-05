"""
Minimal WS connection registry. No message queue, no per-client state
beyond the socket itself — Phase 1 only needs "push new event to every
connected client," so anything heavier (Redis pub/sub, per-client
filters) would be premature for a single-machine tool.
"""

from fastapi import WebSocket
import asyncio


class ConnectionManager:
    def __init__(self):
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, ws: WebSocket):
        await ws.accept()
        async with self._lock:
            self._connections.add(ws)

    async def disconnect(self, ws: WebSocket):
        async with self._lock:
            self._connections.discard(ws)

    async def broadcast(self, message: dict):
        # Copy the set before iterating — a client can disconnect mid-
        # broadcast, and mutating a set while iterating it raises.
        async with self._lock:
            targets = list(self._connections)

        dead = []
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)

        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)


manager = ConnectionManager()
