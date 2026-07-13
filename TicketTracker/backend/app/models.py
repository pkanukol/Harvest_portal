import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base


class Ticket(Base):
    __tablename__ = "tickets"

    id = Column(Integer, primary_key=True, index=True)
    category = Column(String, nullable=False)
    description = Column(Text, nullable=False)

    reporter_name = Column(String, nullable=False)
    reporter_email = Column(String, nullable=False, index=True)

    # Snapshotted at creation time from the category->responsible map, so a later
    # change to that map doesn't alter who could close an already-open ticket.
    responsible_name = Column(String, nullable=False)
    responsible_email = Column(String, nullable=False, index=True)

    status = Column(String, nullable=False, default="Open")  # "Open" | "Closed"
    created_at = Column(DateTime, default=datetime.datetime.utcnow, index=True)
    closed_at = Column(DateTime, nullable=True)

    closed_by_name = Column(String, nullable=True)
    closed_by_email = Column(String, nullable=True)
    resolution_remark = Column(Text, nullable=True)

    images = relationship("TicketImage", back_populates="ticket", cascade="all, delete-orphan")


class TicketImage(Base):
    __tablename__ = "ticket_images"

    id = Column(Integer, primary_key=True, index=True)
    ticket_id = Column(Integer, ForeignKey("tickets.id"), nullable=False)
    image_path = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)

    ticket = relationship("Ticket", back_populates="images")
