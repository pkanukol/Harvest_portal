import logging
from typing import List
import httpx
from .config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


async def _send_resend(to: List[str], subject: str, body_text: str, body_html: str,
                        cc: List[str] = None, reply_to: str = "") -> bool:
    from_addr = f"Harvest Ticket Tracker <{settings.RESEND_FROM_EMAIL}>"

    print(f"\n{'='*60}", flush=True)
    print("EMAIL TRIGGERED (Resend)", flush=True)
    print(f"  From   : {from_addr}", flush=True)
    print(f"  To     : {', '.join(to)}", flush=True)
    if cc:
        print(f"  Cc     : {', '.join(cc)}", flush=True)
    print(f"  Subject: {subject}", flush=True)
    print(f"{'='*60}\n", flush=True)

    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        print("  WARNING: Resend credentials not configured — email simulated only.", flush=True)
        print(f"  Body preview:\n{body_text[:300]}\n", flush=True)
        return True

    payload = {
        "from": from_addr,
        "to": to,
        "subject": subject,
        "text": body_text,
        "html": body_html,
    }
    if cc:
        payload["cc"] = cc
    if reply_to:
        payload["reply_to"] = reply_to

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}",
                         "Content-Type": "application/json"},
                json=payload,
            )
        if resp.status_code in (200, 201):
            print(f"  SUCCESS: Email sent to {', '.join(to)}\n", flush=True)
            return True
        print(f"  RESEND ERROR {resp.status_code}: {resp.text}\n", flush=True)
        logger.error(f"Resend error {resp.status_code} for {to}: {resp.text}")
        return False
    except Exception as e:
        print(f"  EMAIL ERROR: {e}\n", flush=True)
        logger.error(f"Failed to send email to {to}: {e}")
        return False


def _ticket_card_html(ticket_number: str, category: str, description: str, ticket_url: str) -> str:
    return f"""
    <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;border:1px solid #dbe4ee;border-radius:12px;overflow:hidden;">
        <div style="background:#1a2740;padding:18px 22px;">
            <div style="font-size:17px;font-weight:bold;color:#7fc7ff;">Harvest International School</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px;">Ticket Tracker</div>
        </div>
        <div style="padding:22px;">
            <div style="background:#f2f6fb;border-left:4px solid #29ABE2;border-radius:0 8px 8px 0;padding:12px 16px;margin:0 0 16px;">
                <div style="font-size:11px;font-weight:bold;color:#1a6ea3;text-transform:uppercase;margin-bottom:6px;">{ticket_number} &middot; {category}</div>
                <div style="font-size:13px;color:#333;line-height:1.6;white-space:pre-wrap;">{description}</div>
            </div>
            <div style="text-align:center;margin-bottom:18px;">
                <a href="{ticket_url}" style="display:inline-block;padding:11px 26px;background:linear-gradient(135deg,#29ABE2,#1a8abf);color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:bold;">Open Ticket &rarr;</a>
            </div>
        </div>
        <div style="background:#f2f6fb;padding:10px 22px;font-size:10px;color:#888;text-align:center;border-top:1px solid #dbe4ee;">Harvest International School &mdash; Ticket Tracker</div>
    </div>
    """


async def send_new_ticket_notifications(ticket_number: str, category: str, description: str,
                                         reporter_name: str, reporter_email: str,
                                         responsible_to: list, responsible_cc: list,
                                         ticket_url: str):
    card = _ticket_card_html(ticket_number, category, description, ticket_url)

    await _send_resend(
        [reporter_email],
        f"{ticket_number} logged | {category}",
        f"Dear {reporter_name},\n\nYour ticket {ticket_number} ({category}) has been logged.\n\n{description}\n\nTrack it here: {ticket_url}\n\nRegards,\nHarvest International School",
        f"<p>Dear <strong>{reporter_name}</strong>,</p><p>Your ticket has been logged.</p>{card}",
    )

    to_emails = [c["email"] for c in responsible_to]
    cc_emails = [c["email"] for c in responsible_cc]
    to_names = ", ".join(c["name"] for c in responsible_to) or "Team"
    await _send_resend(
        to_emails,
        f"New ticket {ticket_number} | {category}",
        f"Dear {to_names},\n\nA new ticket {ticket_number} ({category}) was logged by {reporter_name} ({reporter_email}).\n\n{description}\n\nView it here: {ticket_url}\n\nRegards,\nHarvest International School",
        f"<p>Dear <strong>{to_names}</strong>,</p><p>A new ticket was logged by <strong>{reporter_name}</strong> ({reporter_email}).</p>{card}",
        cc=cc_emails,
        reply_to=reporter_email,
    )


async def send_ticket_resolved_notification(ticket_number: str, category: str, status_label: str,
                                             reporter_name: str, reporter_email: str,
                                             actor_name: str, remark: str, ticket_url: str):
    card = _ticket_card_html(ticket_number, category, f"Remark: {remark}", ticket_url)
    await _send_resend(
        [reporter_email],
        f"{ticket_number} {status_label} | {category}",
        f"Dear {reporter_name},\n\nYour ticket {ticket_number} ({category}) has been {status_label} by {actor_name}.\n\nRemark: {remark}\n\nView it here: {ticket_url}\n\nRegards,\nHarvest International School",
        f"<p>Dear <strong>{reporter_name}</strong>,</p><p>Your ticket has been <strong>{status_label}</strong> by <strong>{actor_name}</strong>.</p>{card}",
    )


async def send_ticket_comment_notification(ticket_number: str, category: str,
                                            author_name: str, message: str,
                                            recipients: list, ticket_url: str):
    card = _ticket_card_html(ticket_number, category, message, ticket_url)
    await _send_resend(
        recipients,
        f"New message on {ticket_number} | {category}",
        f"{author_name} wrote on ticket {ticket_number} ({category}):\n\n{message}\n\nReply here: {ticket_url}\n\nRegards,\nHarvest International School",
        f"<p><strong>{author_name}</strong> wrote on this ticket:</p>{card}",
    )


async def send_order_placed_notification(ticket_number: str, category: str,
                                          reporter_name: str, reporter_email: str,
                                          vendor_name: str, order_date: str,
                                          delivery_date: str, ticket_url: str):
    delivery_line = f" Expected delivery: {delivery_date}." if delivery_date else ""
    detail = f"Ordered from {vendor_name} on {order_date}.{delivery_line}"
    card = _ticket_card_html(ticket_number, category, detail, ticket_url)
    await _send_resend(
        [reporter_email],
        f"{ticket_number} ordered | {category}",
        f"Dear {reporter_name},\n\nYour requisition {ticket_number} ({category}) has been ordered.\n\n{detail}\n\nView it here: {ticket_url}\n\nRegards,\nHarvest International School",
        f"<p>Dear <strong>{reporter_name}</strong>,</p><p>Your requisition has been ordered.</p>{card}",
    )
