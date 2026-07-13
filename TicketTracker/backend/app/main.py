from datetime import datetime
from typing import List, Optional
from urllib.parse import quote, urlparse

from fastapi import FastAPI, Depends, HTTPException, Request, status, BackgroundTasks, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, get_db
from .constants import CATEGORIES, CATEGORY_RESPONSIBLE
from . import models, schemas, crud, auth, email_service

Base.metadata.create_all(bind=engine)

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


def _whatsapp_link(phone: str, text: str) -> str:
    if not phone:
        return ""
    digits = "".join(c for c in phone if c.isdigit() or c == "+")
    return f"https://wa.me/{digits.lstrip('+')}?text={quote(text)}"


def _whatsapp_share_link(text: str) -> str:
    """Opens WhatsApp with the message pre-filled but no contact pre-selected."""
    return f"https://api.whatsapp.com/send?text={quote(text)}"


def _to_ticket_out(ticket: models.Ticket) -> schemas.TicketOut:
    ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
    responsible = CATEGORY_RESPONSIBLE.get(ticket.category, {})
    wa_text = f"Ticket {crud.ticket_number(ticket)} ({ticket.category}): {ticket.description[:120]} — {ticket_url}"
    return schemas.TicketOut(
        id=ticket.id,
        ticket_number=crud.ticket_number(ticket),
        category=ticket.category,
        description=ticket.description,
        reporter_name=ticket.reporter_name,
        reporter_email=ticket.reporter_email,
        responsible_name=ticket.responsible_name,
        responsible_email=ticket.responsible_email,
        status=ticket.status,
        effective_status=crud.compute_effective_status(ticket),
        created_at=ticket.created_at,
        closed_at=ticket.closed_at,
        closed_by_name=ticket.closed_by_name,
        resolution_remark=ticket.resolution_remark,
        images=[schemas.TicketImageOut(id=img.id, image_path=img.image_path) for img in ticket.images],
        ticket_url=ticket_url,
        responsible_whatsapp=_whatsapp_link(responsible.get("whatsapp", ""), wa_text),
        share_whatsapp=_whatsapp_share_link(wa_text),
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
    return schemas.TokenOut(access_token=access_token, token_type="bearer", name=name, email=email)


# --- TICKETS ---

@app.get("/api/categories")
async def get_categories():
    return CATEGORIES


def _validate_image_link(link: str) -> str:
    link = link.strip()
    parsed = urlparse(link)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(status_code=400, detail=f"'{link}' doesn't look like a valid link")
    return link


@app.post("/api/tickets", response_model=schemas.TicketOut, status_code=status.HTTP_201_CREATED)
async def create_ticket(
    body: schemas.TicketCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    if body.category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="Invalid category")
    if not body.description.strip():
        raise HTTPException(status_code=400, detail="Description is required")
    if len(body.image_links) > MAX_IMAGES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_IMAGES} images allowed")

    responsible = CATEGORY_RESPONSIBLE[body.category]

    ticket = crud.create_ticket(
        db, category=body.category, description=body.description.strip(),
        reporter_name=current_user.name, reporter_email=current_user.email,
        responsible_name=responsible["name"], responsible_email=responsible["email"],
    )

    for link in body.image_links:
        if not link.strip():
            continue
        crud.add_ticket_image(db, ticket.id, _validate_image_link(link))

    db.refresh(ticket)
    ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
    background_tasks.add_task(
        email_service.send_new_ticket_notifications,
        ticket_number=crud.ticket_number(ticket), category=ticket.category, description=ticket.description,
        reporter_name=ticket.reporter_name, reporter_email=ticket.reporter_email,
        responsible_name=ticket.responsible_name, responsible_email=ticket.responsible_email,
        ticket_url=ticket_url,
    )

    return _to_ticket_out(ticket)


@app.get("/api/tickets", response_model=List[schemas.TicketOut])
async def list_tickets(
    category: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    reporter: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    sort: str = Query("desc"),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    tickets = crud.list_tickets(
        db, category=category, status_filter=status_filter, reporter=reporter,
        date_from=date_from, date_to=date_to, sort=sort,
    )
    return [_to_ticket_out(t) for t in tickets]


@app.get("/api/tickets/{ticket_id}", response_model=schemas.TicketOut)
async def get_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _to_ticket_out(ticket)


@app.post("/api/tickets/{ticket_id}/close", response_model=schemas.TicketOut)
async def close_ticket(
    ticket_id: int,
    body: schemas.TicketClose,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    ticket = crud.get_ticket(db, ticket_id)
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.responsible_email.lower() != current_user.email.lower():
        raise HTTPException(status_code=403, detail="Only the responsible person can close this ticket")
    if ticket.status == "Closed":
        raise HTTPException(status_code=400, detail="Ticket is already closed")
    if not body.remark.strip():
        raise HTTPException(status_code=400, detail="A closing remark is required")

    ticket = crud.close_ticket(db, ticket, body.remark.strip(), current_user.name, current_user.email)

    ticket_url = f"{settings.APP_URL}/?ticket={ticket.id}"
    background_tasks.add_task(
        email_service.send_ticket_closed_notification,
        ticket_number=crud.ticket_number(ticket), category=ticket.category,
        reporter_name=ticket.reporter_name, reporter_email=ticket.reporter_email,
        closed_by_name=current_user.name, remark=ticket.resolution_remark, ticket_url=ticket_url,
    )

    return _to_ticket_out(ticket)


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
