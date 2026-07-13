from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class TicketImageOut(BaseModel):
    id: int
    image_path: str

    class Config:
        from_attributes = True


class TicketOut(BaseModel):
    id: int
    ticket_number: str
    category: str
    description: str
    reporter_name: str
    reporter_email: str
    responsible_name: str
    responsible_email: str
    status: str
    effective_status: str
    created_at: datetime
    closed_at: Optional[datetime] = None
    closed_by_name: Optional[str] = None
    resolution_remark: Optional[str] = None
    images: List[TicketImageOut] = []
    ticket_url: str = ""
    responsible_whatsapp: str = ""
    share_whatsapp: str = ""

    class Config:
        from_attributes = True


class TicketCreate(BaseModel):
    category: str
    description: str
    image_links: List[str] = []


class TicketClose(BaseModel):
    remark: str


class SsoRequest(BaseModel):
    supabase_token: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str
    name: str
    email: str
