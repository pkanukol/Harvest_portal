import datetime
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import or_

from . import models
from .constants import TICKET_ATTENTION_HOURS, STORES_PROCUREMENT_CONTACT

TERMINAL_STATUSES = {"Closed", "Approved", "Rejected", "Ordered"}


def compute_effective_status(ticket: models.Ticket) -> str:
    if ticket.status in TERMINAL_STATUSES:
        return ticket.status
    age = datetime.datetime.utcnow() - ticket.created_at
    if age > datetime.timedelta(hours=TICKET_ATTENTION_HOURS):
        return "Needs immediate attention"
    return "Open"


def ticket_number(ticket: models.Ticket) -> str:
    return f"TKT-{ticket.id:05d}"


def create_ticket(db: Session, category: str, location: str, description: str,
                   reporter_name: str, reporter_email: str,
                   responsible_to: List[dict], responsible_cc: List[dict],
                   item_name: Optional[str] = None, approx_cost: Optional[float] = None,
                   quantity: Optional[int] = None, specifications: Optional[str] = None,
                   order_by_date: Optional[str] = None) -> models.Ticket:
    ticket = models.Ticket(
        category=category,
        location=location,
        description=description,
        reporter_name=reporter_name,
        reporter_email=reporter_email,
        responsible_to=responsible_to,
        responsible_cc=responsible_cc,
        item_name=item_name,
        approx_cost=approx_cost,
        quantity=quantity,
        specifications=specifications,
        order_by_date=order_by_date,
        status="Open",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)
    return ticket


def add_ticket_image(db: Session, ticket_id: int, image_path: str) -> models.TicketImage:
    image = models.TicketImage(ticket_id=ticket_id, image_path=image_path)
    db.add(image)
    db.commit()
    db.refresh(image)
    return image


def get_ticket(db: Session, ticket_id: int) -> Optional[models.Ticket]:
    return db.query(models.Ticket).filter(models.Ticket.id == ticket_id).first()


def resolve_ticket(db: Session, ticket: models.Ticket, new_status: str, remark: str,
                    actor_name: str, actor_email: str,
                    approval_level: Optional[str] = None) -> models.Ticket:
    ticket.status = new_status
    ticket.closed_at = datetime.datetime.utcnow()
    ticket.resolution_remark = remark
    ticket.closed_by_name = actor_name
    ticket.closed_by_email = actor_email
    if approval_level:
        ticket.approval_level = approval_level
    db.commit()
    db.refresh(ticket)
    return ticket


def record_order_details(db: Session, ticket: models.Ticket, order_date: str, vendor_name: str,
                          actual_cost: float, delivery_date: Optional[str],
                          tracking_details: Optional[str]) -> models.Ticket:
    ticket.order_date = order_date
    ticket.vendor_name = vendor_name
    ticket.order_actual_cost = actual_cost
    ticket.delivery_date = delivery_date
    ticket.tracking_details = tracking_details
    if ticket.status == "Approved":
        ticket.status = "Ordered"
    db.commit()
    db.refresh(ticket)
    return ticket


def list_tickets(db: Session, category: Optional[str] = None,
                  location: Optional[str] = None,
                  status_filter: Optional[str] = None,
                  reporter: Optional[str] = None,
                  date_from: Optional[datetime.datetime] = None,
                  date_to: Optional[datetime.datetime] = None,
                  sort: str = "desc",
                  restrict_location: Optional[str] = None,
                  restrict_reporter_email: Optional[str] = None,
                  restrict_assigned_email: Optional[str] = None):
    query = db.query(models.Ticket)

    # Base visibility restriction (server-derived, not user-choosable beyond this).
    if restrict_location:
        query = query.filter(models.Ticket.location == restrict_location)
    if restrict_reporter_email:
        query = query.filter(models.Ticket.reporter_email.ilike(restrict_reporter_email))

    if category:
        query = query.filter(models.Ticket.category == category)
    if location:
        query = query.filter(models.Ticket.location == location)
    if reporter:
        like = f"%{reporter}%"
        query = query.filter(
            or_(models.Ticket.reporter_name.ilike(like), models.Ticket.reporter_email.ilike(like))
        )
    if date_from:
        query = query.filter(models.Ticket.created_at >= date_from)
    if date_to:
        query = query.filter(models.Ticket.created_at <= date_to)

    query = query.order_by(
        models.Ticket.created_at.desc() if sort != "asc" else models.Ticket.created_at.asc()
    )
    tickets = query.all()

    if restrict_assigned_email:
        email = restrict_assigned_email.lower()
        procurement_email = STORES_PROCUREMENT_CONTACT["email"].lower()
        tickets = [
            t for t in tickets
            if email in {c["email"].lower() for c in (t.responsible_to or [])}
            or email in {c["email"].lower() for c in (t.responsible_cc or [])}
            or (email == procurement_email and t.category == "Stores")
        ]

    if status_filter:
        tickets = [t for t in tickets if compute_effective_status(t) == status_filter]

    return tickets
