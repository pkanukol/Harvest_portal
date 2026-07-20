import datetime
from sqlalchemy import Column, Integer, Float, String, DateTime, Text, ForeignKey, JSON, LargeBinary
from sqlalchemy.orm import relationship
from .database import Base


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, nullable=False)
    location = Column(String, nullable=False)  # "Kodathi" | "Attibele"
    description = Column(Text, nullable=False)

    reporter_name = Column(String, nullable=False)
    reporter_email = Column(String, nullable=False, index=True)

    # Snapshotted at creation time from CATEGORY_ROUTING, so a later routing change
    # doesn't alter who could act on an already-open ticket. Each entry is
    # {"name": str, "email": str}. Anyone in responsible_to can close/approve;
    # responsible_cc is notified only.
    responsible_to = Column(JSON, nullable=False, default=list)
    responsible_cc = Column(JSON, nullable=False, default=list)

    # Stores (inventory requisition) only - null for every other category.
    item_name = Column(String, nullable=True)
    approx_cost = Column(Float, nullable=True)
    quantity = Column(Integer, nullable=True)
    specifications = Column(Text, nullable=True)
    order_by_date = Column(String, nullable=True)  # ISO date string (YYYY-MM-DD)

    # Order Details, filled in by the procurement contact once Approved - null until then.
    order_date = Column(String, nullable=True)  # ISO date string (YYYY-MM-DD)
    vendor_name = Column(String, nullable=True)
    order_actual_cost = Column(Float, nullable=True)
    delivery_date = Column(String, nullable=True)  # ISO date string (YYYY-MM-DD)
    tracking_details = Column(Text, nullable=True)

    # "Open" | "Closed" | "Approved" | "Rejected" | "Ordered" (the latter three are Stores-only)
    status = Column(String, nullable=False, default="Open")
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    closed_at = Column(DateTime, nullable=True)

    closed_by_name = Column(String, nullable=True)
    closed_by_email = Column(String, nullable=True)
    resolution_remark = Column(Text, nullable=True)
    approval_level = Column(String, nullable=True)  # "Principal" | "MD" - Stores only

    images = relationship("TicketImage", back_populates="ticket", cascade="all, delete-orphan")
    comments = relationship("TicketComment", back_populates="ticket", cascade="all, delete-orphan",
                             order_by="TicketComment.created_at")


class TicketComment(Base):
    """A chat-style message thread on a ticket - lets the assignee ask the reporter
    for more detail (or the reporter reply) without needing a new ticket status.
    Anyone who can view the ticket (reporter, responsible parties, principal,
    super-admin) can post; each new message emails everyone else on the ticket."""
    __tablename__ = "ticket_comments"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False, index=True)
    author_name = Column(String, nullable=False)
    author_email = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)

    ticket = relationship("Ticket", back_populates="comments")


class TicketImage(Base):
    """Stored directly in the DB (not on local disk) so images survive Render
    redeploys - the disk is ephemeral there, the Postgres database isn't. Purged
    (row deleted) once the parent ticket reaches a terminal state that no longer
    needs the photo (see crud.purge_ticket_images) - the ticket record itself,
    and everything else about it, stays as permanent history.
    """
    __tablename__ = "ticket_images"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    content_type = Column(String, nullable=False)  # "image/jpeg" | "image/png"
    image_data = Column(LargeBinary, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)

    ticket = relationship("Ticket", back_populates="images")
