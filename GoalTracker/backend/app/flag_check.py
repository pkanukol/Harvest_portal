"""Standalone script (not an HTTP endpoint) invoked daily by the Render cron
service `harvest-goaltracker-flagcheck`: `python -m app.flag_check`.

Computes the two flag rules (see crud.compute_flags) for every org member
and emails anyone newly flagged, or still flagged and not notified in the
last FLAG_RENOTIFY_DAYS days, via Resend.
"""
import asyncio
import datetime
import logging

from .database import SessionLocal, engine, Base
from .config import settings
from . import crud, email_service

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("goal_tracker.flag_check")


async def run() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    sent = 0
    try:
        users = crud.get_all_org_users(db)
        logger.info("Checking flags for %d org members", len(users))

        for user in users:
            flags = crud.compute_flags(db, user.email)
            period_key = crud.current_academic_year_key()
            checks = [
                ("mid_term_missing", flags.mid_term_missing, period_key),
                ("annual_missing", flags.annual_missing, period_key),
            ]
            for flag_type, is_flagged, period_key in checks:
                if not is_flagged:
                    continue
                last = crud.get_last_notified(db, user.email, flag_type, period_key)
                if last and (datetime.datetime.utcnow() - last.last_notified_at) < datetime.timedelta(days=settings.FLAG_RENOTIFY_DAYS):
                    continue
                ok = await email_service.send_goal_flag_reminder(user.email, user.name, flag_type)
                if ok:
                    crud.record_notification(db, user.email, flag_type, period_key)
                    sent += 1

        logger.info("Sent %d flag reminder email(s)", sent)
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(run())
