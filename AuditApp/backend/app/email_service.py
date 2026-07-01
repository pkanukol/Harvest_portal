import asyncio
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from email.utils import formataddr
import logging
from .config import settings

logger = logging.getLogger(__name__)

def _send_smtp_blocking(to_email: str, subject: str, body_text: str, body_html: str,
                        from_display: str = "", reply_to: str = "") -> bool:
    sender = formataddr((from_display or "Harvest AuditApp", settings.SMTP_FROM_EMAIL))
    print(f"\n{'='*60}", flush=True)
    print(f"EMAIL TRIGGERED", flush=True)
    print(f"  From    : {sender}", flush=True)
    print(f"  To      : {to_email}", flush=True)
    if reply_to:
        print(f"  Reply-To: {reply_to}", flush=True)
    print(f"  Subject : {subject}", flush=True)
    print(f"{'='*60}\n", flush=True)

    if not settings.SMTP_USERNAME or not settings.SMTP_PASSWORD or not settings.SMTP_FROM_EMAIL:
        print("  WARNING: SMTP credentials not configured - email simulated only.", flush=True)
        print(f"  Body preview:\n{body_text[:300]}\n", flush=True)
        return True
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = sender
        msg["To"] = to_email
        if reply_to:
            msg["Reply-To"] = reply_to
        msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))
        if settings.SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(settings.SMTP_HOST, settings.SMTP_PORT)
        else:
            server = smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT)
            server.starttls()
        server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
        server.sendmail(settings.SMTP_FROM_EMAIL, to_email, msg.as_string())
        server.quit()
        print(f"  SUCCESS: Email sent to {to_email}\n", flush=True)
        logger.info(f"Email sent to {to_email}")
        return True
    except Exception as e:
        print(f"  SMTP ERROR: {e}\n", flush=True)
        logger.error(f"Failed to send email to {to_email}: {e}")
        return False


async def send_smtp_email(to_email: str, subject: str, body_text: str, body_html: str,
                          from_display: str = "", reply_to: str = ""):
    return await asyncio.to_thread(_send_smtp_blocking, to_email, subject, body_text, body_html,
                                   from_display, reply_to)

async def send_audit_notification(teacher_email: str, teacher_name: str, auditor_name: str, auditor_email: str, school: str, grade: str, app_url: str):
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
    return await send_smtp_email(teacher_email, subject, body_text, body_html,
                                 from_display=f"{auditor_name} via Harvest AuditApp",
                                 reply_to=auditor_email)

async def send_remarks_notification(auditor_email: str, auditor_name: str, teacher_name: str, teacher_email: str, school: str, grade: str, app_url: str):
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
    return await send_smtp_email(auditor_email, subject, body_text, body_html,
                                 from_display=f"{teacher_name} via Harvest AuditApp",
                                 reply_to=teacher_email)
