from datetime import datetime, timezone
from typing import List, Optional
from urllib.parse import quote

from fastapi import FastAPI, Depends, HTTPException, Request, Response, status, BackgroundTasks, Query, Form, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, get_db, run_migrations, SessionLocal
from .constants import (
    CATEGORIES, LOCATIONS, CATEGORY_ROUTING, SUPER_ADMIN_EMAILS,
    PRINCIPAL_BY_LOCATION, MANAGING_DIRECTOR, STORES_PROCUREMENT_CONTACT, category_label,
)
from . import models, schemas, crud, auth, email_service


def _backfill_routing():
    """Tickets logged before per-category routing existed (or before a category was
    added to CATEGORY_ROUTING) end up with an empty responsible_to/cc after the
    location/routing migration - which would leave them un-closeable, since nobody
    matches an empty list. Fill them in from the current routing table, one-time,
    idempotent (only touches rows still empty).
    """
    db = SessionLocal()
    try:
        # JSON-column equality checks are dialect-finicky (Postgres vs SQLite), so
        # filter in Python instead - ticket volumes here are small.
        changed = False
        for ticket in db.query(models.Ticket).all():
            if ticket.responsible_to:
                continue
            routing = CATEGORY_ROUTING.get(ticket.category, {}).get(ticket.location)
            if routing:
                ticket.responsible_to = routing["to"]
                ticket.responsible_cc = routing["cc"]
                changed = True
        if changed:
            db.commit()
    finally:
        db.close()


Base.metadata.create_all(bind=engine)
run_migrations()
_backfill_routing()

app = FastAPI(
    title="Harvest Ticket Tracker API",
    description="Lightweight ticket tracker for staff-reported issues",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_IMAGES = 3
# 2MB/image keeps even 100+ tickets (300+ images worst case) well within a typical
# free-tier Postgres allocation - client-side compression targets far below this,
# so this is a hard ceiling, not the expected size.
MAX_IMAGE_BYTES = 2 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}


def _whatsapp_share_link(text: str) -> str:
    """Opens WhatsApp with the message pre-filled but no contact pre-selected."""
    return f"https://api.whatsapp.com/send?text={quote(text)}"


def _principal_location(email: str) -> Optional[str]:
    email_l = email.lower()
    for loc, p in PRINCIPAL_BY_LOCATION.items():
        if p["email"].lower() == email_l:
            return loc
    return None


def _home_location(email: str) -> Optional[str]:
    """Campus a user is locked to (currently: Principals only). Everyone else is
    considered 'Both' and keeps the manual campus toggle in the UI."""
    return _principal_location(email)


def _is_known_responsible_contact(email: str) -> bool:
    """True if this email is ever a routing target (to/cc) for any category/location,
    or the Stores procurement contact - used to put 'assigned' ahead of 'mine' for
    people who mainly use the tracker to triage tickets routed to them, not to report."""
    email_l = email.lower()
    if email_l == STORES_PROCUREMENT_CONTACT["email"].lower():
        return True
    for by_location in CATEGORY_ROUTING.values():
        for routing in by_location.values():
            if email_l in {c["email"].lower() for c in routing.get("to", [])}:
                return True
            if email_l in {c["email"].lower() for c in routing.get("cc", [])}:
                return True
    return False


def _user_views(email: str) -> List[str]:
    email_l = email.lower()
    views = ["assigned", "mine"] if _is_known_responsible_contact(email) else ["mine", "assigned"]
    if _principal_location(email) is not None:
        views.append("location")
    if email_l in {e.lower() for e in SUPER_ADMIN_EMAILS}:
        views.append("all")
    return views


def _can_act(ticket: models.Ticket, email: str) -> bool:
    email_l = email.lower()
    return email_l in {c["email"].lower() for c in (ticket.responsible_to or [])}


def _can_record_order(ticket: models.Ticket, email: str) -> bool:
    return ticket.category == "Stores" and email.lower() == STORES_PROCUREMENT_CONTACT["email"].lower()


def _can_view_ticket(ticket: models.Ticket, email: str) -> bool:
    email_l = email.lower()
    if email_l in {e.lower() for e in SUPER_ADMIN_EMAILS}:
        return True
    if _principal_location(email) == ticket.location:
        return True
    if email_l == ticket.reporter_email.lower():
        return True
    if email_l in {c["email"].lower() for c in (ticket.responsible_to or [])}:
        return True
    if email_l in {c["email"].lower() for c in (ticket.responsible_cc or [])}:
        return True
    if _can_record_order(ticket, email):
        return True
    return False


def _comment_notify_recipients(ticket: models.Ticket, author_email: str) -> List[str]:
    """Everyone associated with the ticket - reporter plus responsible to/cc - except
    whoever just posted the comment, so a reply always reaches "the other side"
    regardless of whether the assignee or the reporter wrote it."""
    author_l = author_email.lower()
    emails = {ticket.reporter_email}
    emails.update(c["email"] for c in (ticket.responsible_to or []))
    emails.update(c["email"] for c in (ticket.responsible_cc or []))
    return [e for e in emails if e.lower() != author_l]


def _approval_level_for(email: str) -> str:
    if _principal_location(email) is not None:
        return "Principal"
    if email.lower() == MANAGING_DIRECTOR["email"].lower():
        return "MD"
    return "Responsible"


def _to_ticket_out(ticket: models.Ticket, current_user: auth.CurrentUser) -> schemas.TicketOut:
    ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
    wa_text = f"Ticket {crud.ticket_number(ticket)} ({ticket.category}): {ticket.description[:120]} — {ticket_url}"
    return schemas.TicketOut(
        id=ticket.id,
        ticket_number=crud.ticket_number(ticket),
        category=ticket.category,
        location=ticket.location,
        description=ticket.description,
        reporter_name=ticket.reporter_name,
        reporter_email=ticket.reporter_email,
        responsible_to=ticket.responsible_to or [],
        responsible_cc=ticket.responsible_cc or [],
        item_name=ticket.item_name,
        approx_cost=ticket.approx_cost,
        quantity=ticket.quantity,
        specifications=ticket.specifications,
        order_by_date=ticket.order_by_date,
        status=ticket.status,
        effective_status=crud.compute_effective_status(ticket),
        # created_at/closed_at are stored as naive UTC - stamp them as UTC-aware here so
        # the JSON payload carries an explicit offset and the browser converts to local
        # time instead of treating the raw UTC value as if it were already local.
        created_at=ticket.created_at.replace(tzinfo=timezone.utc),
        closed_at=ticket.closed_at.replace(tzinfo=timezone.utc) if ticket.closed_at else None,
        closed_by_name=ticket.closed_by_name,
        resolution_remark=ticket.resolution_remark,
        approval_level=ticket.approval_level,
        order_date=ticket.order_date,
        vendor_name=ticket.vendor_name,
        order_actual_cost=ticket.order_actual_cost,
        delivery_date=ticket.delivery_date,
        tracking_details=ticket.tracking_details,
        images=[schemas.TicketImageOut(id=img.id, image_url=f"/api/tickets/{ticket.id}/images/{img.id}") for img in ticket.images],
        ticket_url=ticket_url,
        share_whatsapp=_whatsapp_share_link(wa_text),
        can_act=_can_act(ticket, current_user.email),
        can_record_order=_can_record_order(ticket, current_user.email),
    )


# --- AUTH ---

@app.post("/api/auth/sso", response_model=schemas.TokenOut)
async def sso_login(request: Request):
    import httpx
    body = await request.json()
    supabase_token = body.get("supabase_token", "")
    if not supabase_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing token")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {supabase_token}",
                "apikey": settings.SUPABASE_ANON_KEY,
            },
            timeout=10,
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid SSO token")

    supabase_user = resp.json()
    email = (supabase_user.get("email") or "").strip().lower()
    if not email.endswith("@harvestinternationalschool.in"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized domain")

    user_metadata = supabase_user.get("user_metadata") or {}
    name = user_metadata.get("full_name") or user_metadata.get("name") or email.split("@")[0]

    access_token = auth.create_access_token(data={"sub": email, "name": name})
    return schemas.TokenOut(
        access_token=access_token, token_type="bearer", name=name, email=email,
        views=_user_views(email),
        home_location=_home_location(email),
    )


# --- META ---

@app.get("/api/categories")
async def get_categories():
    return CATEGORIES


@app.get("/api/locations")
async def get_locations():
    return LOCATIONS


@app.get("/api/routing")
async def get_routing(location: str = Query(...)):
    """For the ticket form's "who will this be sent to" note - a friendly display
    label plus the actual to/cc recipients, per category, resolved for one location."""
    if location not in LOCATIONS:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unknown location")
    return {
        category: {
            "label": category_label(category, location),
            "to": by_location[location]["to"],
            "cc": by_location[location]["cc"],
        }
        for category, by_location in CATEGORY_ROUTING.items()
    }


# --- TICKETS ---

@app.post("/api/tickets", response_model=schemas.TicketOut, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    background_tasks: BackgroundTasks,
    category: str = Form(...),
    location: str = Form(...),
    description: str = Form(""),
    item_name: Optional[str] = Form(None),
    approx_cost: Optional[float] = Form(None),
    quantity: Optional[int] = Form(None),
    specifications: Optional[str] = Form(None),
    order_by_date: Optional[str] = Form(None),
    images: List[UploadFile] = File(default=[]),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    if location not in LOCATIONS:
        raise HTTPException(status_code=400, detail="Invalid location")

    # Validate + read every image before creating anything, so a rejected image
    # doesn't leave behind a ticket with only some of its attachments saved.
    uploads = [u for u in images if u.filename]
    if len(uploads) > MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_IMAGES} images allowed")
    image_payloads = []
    for upload in uploads:
        if upload.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(status_code=400, detail=f"'{upload.filename}' must be a JPG or PNG image")
        data = await upload.read()
        if len(data) > MAX_IMAGE_BYTES:
            raise HTTPException(status_code=400, detail=f"'{upload.filename}' is too large - each image must be under {MAX_IMAGE_BYTES // (1024 * 1024)}MB")
        image_payloads.append((upload.content_type, data))

    if category == "Stores":
        if not (item_name or "").strip():
            raise HTTPException(status_code=400, detail="Item name is required")
        if not quantity or quantity <= 0:
            raise HTTPException(status_code=400, detail="Quantity must be a positive number")
        if approx_cost is None or approx_cost < 0:
            raise HTTPException(status_code=400, detail="Approximate cost is required")
        if not (order_by_date or "").strip():
            raise HTTPException(status_code=400, detail="Order-by date is required")
        full_description = f"{quantity} x {item_name.strip()} — approx cost ₹{approx_cost:.2f} each, needed by {order_by_date}"
        if specifications and specifications.strip():
            full_description += f"\nSpecifications: {specifications.strip()}"
    else:
        if not description.strip():
            raise HTTPException(status_code=400, detail="Description is required")
        full_description = description.strip()

    routing = CATEGORY_ROUTING[category][location]

    ticket = crud.create_ticket(
        db, category=category, location=location, description=full_description,
        reporter_name=current_user.name, reporter_email=current_user.email,
        responsible_to=routing["to"], responsible_cc=routing["cc"],
        item_name=item_name, approx_cost=approx_cost, quantity=quantity,
        specifications=specifications, order_by_date=order_by_date,
    )

    for content_type, data in image_payloads:
        crud.add_ticket_image(db, ticket.id, content_type, data)

    db.refresh(ticket)
    ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
    background_tasks.add_task(
        email_service.send_new_ticket_notifications,
        ticket_number=crud.ticket_number(ticket), category=ticket.category, description=ticket.description,
        reporter_name=ticket.reporter_name, reporter_email=ticket.reporter_email,
        responsible_to=ticket.responsible_to, responsible_cc=ticket.responsible_cc,
        ticket_url=ticket_url,
    )

    return _to_ticket_out(ticket, current_user)


@app.get("/api/tickets", response_model=List[schemas.TicketOut])
async def list_tickets(
    view: str = Query("mine"),
    category: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    reporter: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    sort: str = Query("desc"),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    allowed_views = _user_views(current_user.email)
    if view not in allowed_views:
        raise HTTPException(status_code=403, detail=f"You don't have access to the '{view}' view")

    restrict_location = None
    restrict_reporter_email = None
    restrict_assigned_email = None
    if view == "mine":
        restrict_reporter_email = current_user.email
    elif view == "assigned":
        restrict_assigned_email = current_user.email
    elif view == "location":
        restrict_location = _principal_location(current_user.email)
    # view == "all" -> no base restriction

    tickets = crud.list_tickets(
        db, category=category, location=location, status_filter=status_filter, reporter=reporter,
        date_from=date_from, date_to=date_to, sort=sort,
        restrict_location=restrict_location, restrict_reporter_email=restrict_reporter_email,
        restrict_assigned_email=restrict_assigned_email,
    )
    return [_to_ticket_out(t, current_user) for t in tickets]


@app.get("/api/tickets/{ticket_id}", response_model=schemas.TicketOut)
async def get_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not _can_view_ticket(ticket, current_user.email):
        raise HTTPException(status_code=403, detail="You don't have access to this ticket")
    return _to_ticket_out(ticket, current_user)


@app.get("/api/tickets/{ticket_id}/images/{image_id}")
async def get_ticket_image(
    ticket_id: int,
    image_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user_flexible),
):
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not _can_view_ticket(ticket, current_user.email):
        raise HTTPException(status_code=403, detail="You don't have access to this ticket")
    image = crud.get_ticket_image(db, ticket_id, image_id)
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    return Response(content=image.image_data, media_type=image.content_type)


def _to_comment_out(comment: models.TicketComment) -> schemas.TicketCommentOut:
    return schemas.TicketCommentOut(
        id=comment.id, author_name=comment.author_name, author_email=comment.author_email,
        message=comment.message, created_at=comment.created_at.replace(tzinfo=timezone.utc),
    )


@app.get("/api/tickets/{ticket_id}/comments", response_model=List[schemas.TicketCommentOut])
async def list_comments(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not _can_view_ticket(ticket, current_user.email):
        raise HTTPException(status_code=403, detail="You don't have access to this ticket")
    return [_to_comment_out(c) for c in ticket.comments]


@app.post("/api/tickets/{ticket_id}/comments", response_model=schemas.TicketCommentOut, status_code=status.HTTP_201_CREATED)
async def add_comment(
    ticket_id: int,
    body: schemas.TicketCommentIn,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not _can_view_ticket(ticket, current_user.email):
        raise HTTPException(status_code=403, detail="You don't have access to this ticket")
    if not body.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    comment = crud.add_comment(db, ticket_id, current_user.name, current_user.email, body.message.strip())

    recipients = _comment_notify_recipients(ticket, current_user.email)
    if recipients:
        ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
        background_tasks.add_task(
            email_service.send_ticket_comment_notification,
            ticket_number=crud.ticket_number(ticket), category=ticket.category,
            author_name=current_user.name, message=comment.message,
            recipients=recipients, ticket_url=ticket_url,
        )

    return _to_comment_out(comment)


@app.post("/api/tickets/{ticket_id}/close", response_model=schemas.TicketOut)
async def close_ticket(
    ticket_id: int,
    body: schemas.TicketDecision,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.category == "Stores":
        raise HTTPException(status_code=400, detail="Stores requisitions are approved or rejected, not closed")
    if not _can_act(ticket, current_user.email):
        raise HTTPException(status_code=403, detail="Only the responsible person can close this ticket")
    if ticket.status in crud.TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail="Ticket is already closed")
    if not body.remark.strip():
        raise HTTPException(status_code=400, detail="A closing remark is required")

    ticket = crud.resolve_ticket(db, ticket, "Closed", body.remark.strip(), current_user.name, current_user.email)
    crud.purge_ticket_images(db, ticket)

    ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
    background_tasks.add_task(
        email_service.send_ticket_resolved_notification,
        ticket_number=crud.ticket_number(ticket), category=ticket.category, status_label="closed",
        reporter_name=ticket.reporter_name, reporter_email=ticket.reporter_email,
        actor_name=current_user.name, remark=ticket.resolution_remark, ticket_url=ticket_url,
    )

    return _to_ticket_out(ticket, current_user)


async def _decide_stores_ticket(
    ticket_id: int, body: schemas.TicketDecision, new_status: str,
    background_tasks: BackgroundTasks, db: Session, current_user: auth.CurrentUser,
) -> schemas.TicketOut:
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.category != "Stores":
        raise HTTPException(status_code=400, detail="Only Stores requisitions use approve/reject")
    if not _can_act(ticket, current_user.email):
        raise HTTPException(status_code=403, detail="You are not an approver for this requisition")
    if ticket.status in crud.TERMINAL_STATUSES:
        raise HTTPException(status_code=400, detail="This requisition has already been decided")
    if not body.remark.strip():
        raise HTTPException(status_code=400, detail="A remark is required")

    level = _approval_level_for(current_user.email)
    ticket = crud.resolve_ticket(
        db, ticket, new_status, body.remark.strip(), current_user.name, current_user.email,
        approval_level=level,
    )
    if new_status == "Rejected":
        crud.purge_ticket_images(db, ticket)

    ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
    background_tasks.add_task(
        email_service.send_ticket_resolved_notification,
        ticket_number=crud.ticket_number(ticket), category=ticket.category,
        status_label=new_status.lower(),
        reporter_name=ticket.reporter_name, reporter_email=ticket.reporter_email,
        actor_name=current_user.name, remark=ticket.resolution_remark, ticket_url=ticket_url,
    )

    return _to_ticket_out(ticket, current_user)


@app.post("/api/tickets/{ticket_id}/approve", response_model=schemas.TicketOut)
async def approve_ticket(
    ticket_id: int,
    body: schemas.TicketDecision,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return await _decide_stores_ticket(ticket_id, body, "Approved", background_tasks, db, current_user)


@app.post("/api/tickets/{ticket_id}/reject", response_model=schemas.TicketOut)
async def reject_ticket(
    ticket_id: int,
    body: schemas.TicketDecision,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return await _decide_stores_ticket(ticket_id, body, "Rejected", background_tasks, db, current_user)


@app.post("/api/tickets/{ticket_id}/order-details", response_model=schemas.TicketOut)
async def record_order_details(
    ticket_id: int,
    body: schemas.OrderDetails,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not _can_record_order(ticket, current_user.email):
        raise HTTPException(status_code=403, detail="Only the procurement contact can record order details")
    if ticket.status not in ("Approved", "Ordered"):
        raise HTTPException(status_code=400, detail="Order details can only be recorded for an approved requisition")
    if not body.order_date.strip() or not body.vendor_name.strip():
        raise HTTPException(status_code=400, detail="Order date and vendor name are required")

    was_first_time = ticket.status == "Approved"
    ticket = crud.record_order_details(
        db, ticket, order_date=body.order_date.strip(), vendor_name=body.vendor_name.strip(),
        actual_cost=body.actual_cost, delivery_date=(body.delivery_date or "").strip() or None,
        tracking_details=(body.tracking_details or "").strip() or None,
    )

    if was_first_time:
        crud.purge_ticket_images(db, ticket)
        ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
        background_tasks.add_task(
            email_service.send_order_placed_notification,
            ticket_number=crud.ticket_number(ticket), category=ticket.category,
            reporter_name=ticket.reporter_name, reporter_email=ticket.reporter_email,
            vendor_name=ticket.vendor_name, order_date=ticket.order_date,
            delivery_date=ticket.delivery_date, ticket_url=ticket_url,
        )

    return _to_ticket_out(ticket, current_user)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
