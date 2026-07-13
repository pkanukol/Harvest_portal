import datetime
from typing import Optional
from sqlalchemy.orm import Session
from sqlalchemy import or_

from . import models
from .constants import TICKET_ATTENTION_HOURS


def compute_effective_status(ticket: models.Ticket) -> str:
    if ticket.status == "Closed":
        return "Closed"
    age = datetime.datetime.utcnow() - ticket.created_at
    if age > datetime.timedelta(hours=TICKET_ATTENTION_HOURS):
        return "Needs immediate attention"
    return "Open"


def ticket_number(ticket: models.Ticket) -> str:
    return f"TKT-{ticket.id:05d}"


def create_ticket(db: Session, category: str, description: str,
                   reporter_name: str, reporter_email: str,
                   responsible_name: str, responsible_email: str) -> models.Ticket:
    ticket = models.Ticket(
        category=category,
        description=description,
        reporter_name=reporter_name,
        reporter_email=reporter_email,
        responsible_name=responsible_name,
        responsible_email=responsible_email,
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


def close_ticket(db: Session, ticket: models.Ticket, remark: str,
                  closed_by_name: str, closed_by_email: str) -> models.Ticket:
    ticket.status = "Closed"
    ticket.closed_at = datetime.datetime.utcnow()
    ticket.resolution_remark = remark
    ticket.closed_by_name = closed_by_name
    ticket.closed_by_email = closed_by_email
    db.commit()
    db.refresh(ticket)
    return ticket


def list_tickets(db: Session, category: Optional[str] = None,
                  status_filter: Optional[str] = None,
                  reporter: Optional[str] = None,
                  date_from: Optional[datetime.datetime] = None,
                  date_to: Optional[datetime.datetime] = None,
                  sort: str = "desc"):
    query = db.query(models.Ticket)
    if category:
        query = query.filter(models.Ticket.category == category)
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

    if status_filter:
        tickets = [t for t in tickets if compute_effective_status(t) == status_filter]

    return tickets
