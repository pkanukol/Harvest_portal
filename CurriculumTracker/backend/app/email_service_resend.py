"""POW notifications via Resend — same pattern as AuditApp's
email_service_resend.py (shared Resend account, one HTTP call per recipient).

With RESEND_API_KEY unset the send is SIMULATED: the recipient list and body
are printed to the log and the call reports success. That keeps local
development and any misconfigured deploy from failing a POW save just because
email isn't wired up — a notification must never cost a teacher their work.
"""
import logging
import httpx

from .config import settings

logger = logging.getLogger("curriculum_tracker")

RESEND_URL = "https://api.resend.com/emails"


async def _send_resend(to_email: str, subject: str, body_text: str, body_html: str,
                       from_display: str = "Harvest Curriculum Tracker") -> bool:
    from_addr = f"{from_display} <{settings.RESEND_FROM_EMAIL}>"

    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        logger.warning("EMAIL SIMULATED (no Resend credentials) -> %s | %s", to_email, subject)
        return True

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.post(
                RESEND_URL,
                headers={"Authorization": f"Bearer {settings.RESEND_API_KEY}",
                         "Content-Type": "application/json"},
                json={"from": from_addr, "to": [to_email], "subject": subject,
                      "text": body_text, "html": body_html},
            )
        if resp.status_code in (200, 201):
            logger.info("Email sent to %s (%s)", to_email, subject)
            return True
        logger.error("Resend error %s for %s: %s", resp.status_code, to_email, resp.text)
        return False
    except Exception as exc:
        logger.error("Failed to send email to %s: %s", to_email, exc)
        return False


def _rows_html(pairs) -> str:
    return "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#64748b">{k}</td>'
        f'<td style="padding:4px 0;font-weight:600">{v}</td></tr>'
        for k, v in pairs if v
    )


async def send_pow_notification(recipients: list, teacher_name: str, action: str,
                                subject: str, grade: str, week: str, topic: str,
                                subtopic: str, sessions: str, status_label: str,
                                note: str = "", extra_pairs: list = None):
    """One email per recipient.

    Only two moments send anything, confirmed with the APM on 2026-09-15: a POW
    being CREATED (to the SME who must approve it, and to the other teachers of
    that subject and grade as an intimation), and its TBS MOM being filled in
    (to the SME, who then records remarks and closes it). Nothing goes out for
    an edit, an approval or the teacher's final save - an inbox full of
    "updated" is an inbox nobody reads.

    `note` is the one line saying what the reader is being asked to do.
    """
    if not recipients:
        logger.info("No POW notification recipients for %s — nothing sent", teacher_name)
        return

    heading = f"POW {action}: {teacher_name} — {subject} Grade {grade}"
    pairs = [
        ("Teacher", teacher_name), ("Subject", subject), ("Grade", grade),
        ("Week", week), ("Chapter", topic), ("Topic / Sub topic", subtopic),
        ("Sessions this week", sessions), ("Status", status_label),
    ] + list(extra_pairs or [])
    text = f"{heading}\n\n" + (f"{note}\n\n" if note else "") + \
           "\n".join(f"{k}: {v}" for k, v in pairs if v) + \
           f"\n\nOpen the Curriculum Tracker: {settings.APP_URL}\n"
    html = (
        f'<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;font-size:14px;color:#0f172a">'
        f'<p style="font-size:15px;font-weight:700;color:#1d4ed8">{heading}</p>'
        + (f'<p style="margin:0 0 12px">{note}</p>' if note else "")
        + f'<table style="border-collapse:collapse;font-size:13px">{_rows_html(pairs)}</table>'
        f'<p style="margin-top:16px"><a href="{settings.APP_URL}" '
        f'style="background:#1d4ed8;color:#fff;padding:8px 16px;border-radius:6px;'
        f'text-decoration:none;font-size:13px">Open Curriculum Tracker</a></p>'
        f'<p style="color:#94a3b8;font-size:11px">Automated notification from Harvest Curriculum Tracker.</p>'
        f'</div>'
    )

    for person in recipients:
        await _send_resend(person["email"], heading, text, html)
