"""
WS /ws — clients connect here for live event pushes (type: "event").

Kept receive-loop minimal: the frontend's "Pause Live Feed" is a
client-side concern (stop applying incoming messages to the table),
not a server concept — the server doesn't need to know a client is
paused. We just need *some* await on recv to detect disconnects,
since the socket only errors out on send if we don't also try to
read from it.
"""

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.ws_manager import manager

router = APIRouter()


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await manager.connect(ws)
    try:
        while True:
            await ws.receive_text()  # clients don't need to send anything meaningful; just detects disconnect
    except WebSocketDisconnect:
        await manager.disconnect(ws)
