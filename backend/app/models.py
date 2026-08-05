from pydantic import BaseModel
from typing import Optional


class Event(BaseModel):
    id: int
    timestamp: str
    event_type: str
    process_name: Optional[str] = None
    parent_process: Optional[str] = None
    pid: Optional[int] = None
    user: Optional[str] = None
    severity: str
    details: Optional[str] = None  # raw JSON string; frontend parses

    class Config:
        from_attributes = True


class EventList(BaseModel):
    total: int
    skip: int
    limit: int
    items: list[Event]
