from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime


class Contact(BaseModel):
    name: str
    email: str

    class Config:
        from_attributes = True


class TicketImageOut(BaseModel):
    id: int
    image_url: str

    class Config:
        from_attributes = True


class TicketOut(BaseModel):
    id: int
    ticket_number: str
    category: str
    location: str
    description: str
    reporter_name: str
    reporter_email: str
    responsible_to: List[Contact] = []
    responsible_cc: List[Contact] = []
    item_name: Optional[str] = None
    approx_cost: Optional[float] = None
    quantity: Optional[int] = None
    specifications: Optional[str] = None
    order_by_date: Optional[str] = None
    status: str
    effective_status: str
    created_at: datetime
    closed_at: Optional[datetime] = None
    closed_by_name: Optional[str] = None
    resolution_remark: Optional[str] = None
    approval_level: Optional[str] = None
    order_date: Optional[str] = None
    vendor_name: Optional[str] = None
    order_actual_cost: Optional[float] = None
    delivery_date: Optional[str] = None
    tracking_details: Optional[str] = None
    images: List[TicketImageOut] = []
    ticket_url: str = ""
    share_whatsapp: str = ""
    can_act: bool = False  # true if the requesting user may close/approve/reject this ticket
    can_record_order: bool = False  # true if the requesting user may fill in Order Details

    class Config:
        from_attributes = True


class TicketDecision(BaseModel):
    remark: str


class OrderDetails(BaseModel):
    order_date: str
    vendor_name: str
    actual_cost: float
    delivery_date: Optional[str] = None
    tracking_details: Optional[str] = None


class SsoRequest(BaseModel):
    supabase_token: str


class TokenOut(BaseModel):
    access_token: str
    token_type: str
    name: str
    email: str
    views: List[str] = []
