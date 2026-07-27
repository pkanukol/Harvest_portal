import logging
import httpx
from .config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


async def _send_resend(to_email: str, subject: str, body_text: str, body_html: str) -> bool:
    from_addr = f"Harvest GoalTracker <{settings.RESEND_FROM_EMAIL}>"

    print(f"\n{'='*60}", flush=True)
    print("EMAIL TRIGGERED (Resend)", flush=True)
    print(f"  From   : {from_addr}", flush=True)
    print(f"  To     : {to_email}", flush=True)
    print(f"  Subject: {subject}", flush=True)
    print(f"{'='*60}\n", flush=True)

    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        print("  WARNING: Resend credentials not configured - email simulated only.", flush=True)
        print(f"  Body preview:\n{body_text[:300]}\n", flush=True)
        return True

    payload = {"from": from_addr, "to": [to_email], "subject": subject, "text": body_text, "html": body_html}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}", "Content-Type": "application/json"},
                json=payload,
            )
        if resp.status_code in (200, 201):
            print(f"  SUCCESS: Email sent to {to_email}\n", flush=True)
            logger.info("Email sent to %s", to_email)
            return True
        print(f"  RESEND ERROR {resp.status_code}: {resp.text}\n", flush=True)
        logger.error("Resend error %s for %s: %s", resp.status_code, to_email, resp.text)
        return False
    except Exception as e:
        print(f"  EMAIL ERROR: {e}\n", flush=True)
        logger.error("Failed to send email to %s: %s", to_email, e)
        return False


FLAG_COPY = {
    "mid_term_missing": (
        "You haven't set your Mid Term goal(s) yet",
        "you haven't set your Mid Term SMART goal(s)",
    ),
    "annual_missing": (
        "You haven't set an Annual goal yet",
        "you haven't set an Annual SMART goal",
    ),
}


async def send_goal_flag_reminder(to_email: str, to_name: str, flag_type: str) -> bool:
    subject_line, body_reason = FLAG_COPY[flag_type]
    subject = f"GoalTracker reminder | {subject_line}"

    body_text = (
        f"Dear {to_name or 'there'},\n\n"
        f"This is a reminder that {body_reason}.\n\n"
        f"Please log in to GoalTracker to set it as soon as possible.\n\n"
        f"{settings.APP_URL}\n\nRegards,\nHarvest International School"
    )

    body_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;border:1px solid #d4e4d4;border-radius:12px;overflow:hidden;">
        <div style="background:#1a3a1a;padding:18px 22px;">
            <div style="font-size:17px;font-weight:bold;color:#7fff7f;">Harvest International School</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px;">GoalTracker</div>
        </div>
        <div style="padding:22px;">
            <p style="margin:0 0 14px;font-size:14px;color:#1a2a1a;">Dear <strong>{to_name or 'there'}</strong>,</p>
            <p style="margin:0 0 14px;font-size:13px;color:#333;line-height:1.6;">This is a reminder that <strong>{body_reason}</strong>.</p>
            <div style="text-align:center;margin-bottom:18px;">
                <a href="{settings.APP_URL}" style="display:inline-block;padding:11px 26px;background:linear-gradient(135deg,#2D6A2D,#4a8c4a);color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:bold;">Set my goals</a>
            </div>
        </div>
        <div style="background:#f0f7f0;padding:10px 22px;font-size:10px;color:#888;text-align:center;border-top:1px solid #d4e4d4;">Harvest International School</div>
    </div>
    """
    return await _send_resend(to_email, subject, body_text, body_html)
