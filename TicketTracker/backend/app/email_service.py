import logging
import httpx
from .config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


async def _send_resend(to_email: str, subject: str, body_text: str, body_html: str,
                        reply_to: str = "") -> bool:
    from_addr = f"Harvest Ticket Tracker <{settings.RESEND_FROM_EMAIL}>"

    print(f"\n{'='*60}", flush=True)
    print("EMAIL TRIGGERED (Resend)", flush=True)
    print(f"  From   : {from_addr}", flush=True)
    print(f"  To     : {to_email}", flush=True)
    print(f"  Subject: {subject}", flush=True)
    print(f"{'='*60}\n", flush=True)

    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        print("  WARNING: Resend credentials not configured — email simulated only.", flush=True)
        print(f"  Body preview:\n{body_text[:300]}\n", flush=True)
        return True

    payload = {
        "from": from_addr,
        "to": [to_email],
        "subject": subject,
        "text": body_text,
        "html": body_html,
    }
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
            print(f"  SUCCESS: Email sent to {to_email}\n", flush=True)
            return True
        print(f"  RESEND ERROR {resp.status_code}: {resp.text}\n", flush=True)
        logger.error(f"Resend error {resp.status_code} for {to_email}: {resp.text}")
        return False
    except Exception as e:
        print(f"  EMAIL ERROR: {e}\n", flush=True)
        logger.error(f"Failed to send email to {to_email}: {e}")
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
                <div style="font-size:13px;color:#333;line-height:1.6;">{description}</div>
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
                                         responsible_name: str, responsible_email: str,
                                         ticket_url: str):
    card = _ticket_card_html(ticket_number, category, description, ticket_url)

    await _send_resend(
        reporter_email,
        f"{ticket_number} logged | {category}",
        f"Dear {reporter_name},\n\nYour ticket {ticket_number} ({category}) has been logged.\n\n{description}\n\nTrack it here: {ticket_url}\n\nRegards,\nHarvest International School",
        f"<p>Dear <strong>{reporter_name}</strong>,</p><p>Your ticket has been logged.</p>{card}",
    )

    await _send_resend(
        responsible_email,
        f"New ticket {ticket_number} | {category}",
        f"Dear {responsible_name},\n\nA new ticket {ticket_number} ({category}) was logged by {reporter_name} ({reporter_email}).\n\n{description}\n\nView it here: {ticket_url}\n\nRegards,\nHarvest International School",
        f"<p>Dear <strong>{responsible_name}</strong>,</p><p>A new ticket was logged by <strong>{reporter_name}</strong> ({reporter_email}).</p>{card}",
        reply_to=reporter_email,
    )


async def send_ticket_closed_notification(ticket_number: str, category: str,
                                           reporter_name: str, reporter_email: str,
                                           closed_by_name: str, remark: str, ticket_url: str):
    card = _ticket_card_html(ticket_number, category, f"Resolution: {remark}", ticket_url)
    await _send_resend(
        reporter_email,
        f"{ticket_number} closed | {category}",
        f"Dear {reporter_name},\n\nYour ticket {ticket_number} ({category}) has been closed by {closed_by_name}.\n\nRemark: {remark}\n\nView it here: {ticket_url}\n\nRegards,\nHarvest International School",
        f"<p>Dear <strong>{reporter_name}</strong>,</p><p>Your ticket has been closed by <strong>{closed_by_name}</strong>.</p>{card}",
    )
