import logging
import httpx
from .config import settings

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


async def _send_resend(to_email: str, subject: str, body_text: str, body_html: str,
                       from_display: str = "", reply_to: str = "") -> bool:
    from_addr = f"{from_display or 'Harvest AuditApp'} <{settings.RESEND_FROM_EMAIL}>"

    print(f"\n{'='*60}", flush=True)
    print(f"EMAIL TRIGGERED (Resend)", flush=True)
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
            logger.info(f"Email sent to {to_email}")
            return True
        else:
            print(f"  RESEND ERROR {resp.status_code}: {resp.text}\n", flush=True)
            logger.error(f"Resend error {resp.status_code} for {to_email}: {resp.text}")
            return False
    except Exception as e:
        print(f"  EMAIL ERROR: {e}\n", flush=True)
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


async def send_audit_notification(teacher_email: str, teacher_name: str, auditor_name: str,
                                  auditor_email: str, school: str, grade: str, app_url: str):
    subject = f"{school} | Audit Report of {grade or 'your class'}"

    body_text = (
        f"Dear {teacher_name or 'Teacher'},\n\n"
        f"Your classroom observation report has been reviewed and finalised by {auditor_name or 'your auditor'}.\n\n"
        f"Details:\n  Location : {school}\n  Class    : {grade or 'N/A'}\n\n"
        f"Please log in to view your full report, AI-generated feedback and domain scores.\n\n"
        f"{app_url}\n\nRegards,\nHarvest International School\nAcademic Quality Team"
    )

    body_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;border:1px solid #d4e4d4;border-radius:12px;overflow:hidden;">
        <div style="background:#1a3a1a;padding:18px 22px;">
            <div style="font-size:17px;font-weight:bold;color:#7fff7f;">Harvest International School</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px;">Academic Quality &amp; Observation Programme</div>
        </div>
        <div style="padding:22px;">
            <p style="margin:0 0 14px;font-size:14px;color:#1a2a1a;">Dear <strong>{teacher_name or 'Teacher'}</strong>,</p>
            <p style="margin:0 0 14px;font-size:13px;color:#333;line-height:1.6;">Your classroom observation report has been <strong>reviewed and finalised</strong> by <strong>{auditor_name or 'your auditor'}</strong>.</p>
            <div style="background:#f0f7f0;border-left:4px solid #2D6A2D;border-radius:0 8px 8px 0;padding:12px 16px;margin:0 0 16px;">
                <div style="font-size:11px;font-weight:bold;color:#2D6A2D;text-transform:uppercase;margin-bottom:6px;">Observation Details</div>
                <div style="font-size:13px;color:#333;line-height:1.8;">&#128205; <strong>Location:</strong> {school}<br>&#127979; <strong>Class:</strong> {grade or 'N/A'}</div>
            </div>
            <div style="text-align:center;margin-bottom:18px;">
                <a href="{app_url}" style="display:inline-block;padding:11px 26px;background:linear-gradient(135deg,#2D6A2D,#4a8c4a);color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:bold;">&#128202; View My Report</a>
            </div>
            <p style="margin:0;font-size:11px;color:#888;">If you have questions, please contact your school coordinator.</p>
        </div>
        <div style="background:#f0f7f0;padding:10px 22px;font-size:10px;color:#888;text-align:center;border-top:1px solid #d4e4d4;">Harvest International School &mdash; Academic Quality Team</div>
    </div>
    """
    return await _send_resend(teacher_email, subject, body_text, body_html,
                              from_display=f"{auditor_name} via Harvest AuditApp",
                              reply_to=auditor_email)


async def send_remarks_notification(auditor_email: str, auditor_name: str, teacher_name: str,
                                    teacher_email: str, school: str, grade: str, app_url: str):
    subject = f"Audit Response | Remarks submitted by {teacher_name or 'Teacher'}"

    body_text = (
        f"Dear {auditor_name or 'Auditor'},\n\n"
        f"The teacher {teacher_name or 'Teacher'} has submitted remarks for your classroom observation.\n\n"
        f"Observation Details:\n  Location : {school}\n  Class    : {grade or 'N/A'}\n\n"
        f"Please log in to review the remarks.\n\n"
        f"{app_url}\n\nRegards,\nHarvest International School\nAcademic Quality Team"
    )

    body_html = f"""
    <div style="font-family:Arial,sans-serif;max-width:540px;margin:0 auto;border:1px solid #d4e4d4;border-radius:12px;overflow:hidden;">
        <div style="background:#1a3a1a;padding:18px 22px;">
            <div style="font-size:17px;font-weight:bold;color:#7fff7f;">Harvest International School</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.55);margin-top:2px;">Academic Quality &amp; Observation Programme</div>
        </div>
        <div style="padding:22px;">
            <p style="margin:0 0 14px;font-size:14px;color:#1a2a1a;">Dear <strong>{auditor_name or 'Auditor'}</strong>,</p>
            <p style="margin:0 0 14px;font-size:13px;color:#333;line-height:1.6;">The teacher <strong>{teacher_name or 'Teacher'}</strong> has submitted remarks for your classroom observation report.</p>
            <div style="background:#f0f7f0;border-left:4px solid #2D6A2D;border-radius:0 8px 8px 0;padding:12px 16px;margin:0 0 16px;">
                <div style="font-size:11px;font-weight:bold;color:#2D6A2D;text-transform:uppercase;margin-bottom:6px;">Observation Details</div>
                <div style="font-size:13px;color:#333;line-height:1.8;">&#128205; <strong>Location:</strong> {school}<br>&#127979; <strong>Class:</strong> {grade or 'N/A'}</div>
            </div>
            <div style="text-align:center;margin-bottom:18px;">
                <a href="{app_url}" style="display:inline-block;padding:11px 26px;background:linear-gradient(135deg,#2D6A2D,#4a8c4a);color:#fff;text-decoration:none;border-radius:8px;font-size:13px;font-weight:bold;">&#128202; Open Dashboard</a>
            </div>
            <p style="margin:0;font-size:11px;color:#888;">This is an automated notification system.</p>
        </div>
        <div style="background:#f0f7f0;padding:10px 22px;font-size:10px;color:#888;text-align:center;border-top:1px solid #d4e4d4;">Harvest International School &mdash; Academic Quality Team</div>
    </div>
    """
    return await _send_resend(auditor_email, subject, body_text, body_html,
                              from_display=f"{teacher_name} via Harvest AuditApp",
                              reply_to=teacher_email)
