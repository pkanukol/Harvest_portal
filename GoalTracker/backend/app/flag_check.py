"""The flag-check pass: computes the two flag rules (see crud.compute_flags)
for every org member and emails anyone newly flagged, or still flagged and not
notified in the last FLAG_RENOTIFY_DAYS days, via Resend.

Two entry points share `run_flag_check` so both behave identically:
  - the daily Render cron service `harvest-goaltracker-flagcheck`
    (`python -m app.flag_check`), and
  - POST /api/admin/flag-check, the manual "Email everyone flagged" button on
    the leadership Goals overview - the affordable stand-in for the cron,
    which is a paid-tier-only Render service.
"""
import asyncio
import datetime
import logging

from sqlalchemy.orm import Session

from .database import SessionLocal, engine, Base
from .config import settings
from . import crud, email_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("goal_tracker.flag_check")

FLAG_LABEL = {
    "mid_term_missing": "Role goal not set",
    "annual_missing": "Organisation goal not set",
}


# Emails go out concurrently - a sequential pass over the full 139-person
# roster measured ~48s locally (one ~0.35s Resend round-trip each), which is
# too close to Render's proxy timeout for a request the UI waits on. Bounded
# so a single click never opens 100+ sockets at once.
_SEND_CONCURRENCY = 8


async def run_flag_check(db: Session) -> dict:
    """One full pass. Returns a summary the API can hand straight back to the
    UI; the cron just logs it. Safe to call repeatedly - the FLAG_RENOTIFY_DAYS
    check below is what stops a second click from re-emailing the same people.
    """
    users = crud.get_all_org_users(db)
    logger.info("Checking flags for %d org members", len(users))
    period_key = crud.current_academic_year_key()

    # Phase 1 (DB only): work out who needs an email.
    pending = []
    skipped_recent = 0
    for user in users:
        flags = crud.compute_flags(db, user.email)
        for flag_type, is_flagged in (
            ("mid_term_missing", flags.mid_term_missing),
            ("annual_missing", flags.annual_missing),
        ):
            if not is_flagged:
                continue
            last = crud.get_last_notified(db, user.email, flag_type, period_key)
            if last and (datetime.datetime.utcnow() - last.last_notified_at) < datetime.timedelta(days=settings.FLAG_RENOTIFY_DAYS):
                skipped_recent += 1
                continue
            pending.append((user, flag_type))

    # Phase 2 (network): send them concurrently.
    semaphore = asyncio.Semaphore(_SEND_CONCURRENCY)

    async def send(user, flag_type):
        async with semaphore:
            return await email_service.send_goal_flag_reminder(user.email, user.name, flag_type)

    outcomes = await asyncio.gather(
        *(send(user, flag_type) for user, flag_type in pending),
        return_exceptions=True,
    )

    # Phase 3 (DB only): record what actually went out. Kept out of the
    # concurrent phase - the Session above is not safe to share across tasks.
    sent = 0
    failed = 0
    recipients = []
    for (user, flag_type), ok in zip(pending, outcomes):
        if isinstance(ok, BaseException):
            logger.error("Reminder to %s (%s) raised: %s", user.email, flag_type, ok)
            failed += 1
            continue
        if not ok:
            failed += 1
            continue
        crud.record_notification(db, user.email, flag_type, period_key)
        sent += 1
        recipients.append({
            "email": user.email,
            "name": user.name,
            "flag_type": flag_type,
            "flag_label": FLAG_LABEL.get(flag_type, flag_type),
        })

    logger.info(
        "Flag check done: %d sent, %d skipped (notified within %d days), %d failed",
        sent, skipped_recent, settings.FLAG_RENOTIFY_DAYS, failed,
    )
    return {
        "checked": len(users),
        "sent": sent,
        "skipped_recent": skipped_recent,
        "failed": failed,
        "renotify_days": settings.FLAG_RENOTIFY_DAYS,
        "recipients": recipients,
    }


async def run() -> None:
    """Cron entry point."""
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        await run_flag_check(db)
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(run())
