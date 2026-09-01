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


def _stale_cutoff(now: datetime.datetime) -> datetime.datetime:
    return now - datetime.timedelta(days=settings.STALE_ACTION_DAYS)


def collect_stalled(db: Session) -> dict:
    """Who needs chasing, and about what.

    An overdue goal or task only counts once nothing has happened to it for
    STALE_ACTION_DAYS - somebody who edited it this morning is dealing with
    it, and emailing them would be noise.
    """
    from . import models
    now = datetime.datetime.utcnow()
    today = now.date()
    cutoff = _stale_cutoff(now)

    goals_by_owner = {}
    goals = (
        db.query(models.Goal)
        .filter(
            models.Goal.status != "deleted",
            models.Goal.is_completed.is_(False),
            models.Goal.target_date.isnot(None),
        )
        .all()
    )
    for g in goals:
        if g.target_date >= today:
            continue                                   # not overdue yet
        touched = g.updated_at or g.created_at
        if touched and touched > cutoff:
            continue                                   # worked on recently
        goals_by_owner.setdefault(g.owner_email.lower(), []).append({
            "title": g.title,
            "target_date": g.target_date.strftime("%d %b %Y"),
            "days_since_action": (now - touched).days if touched else "?",
        })

    tasks_by_assignee = {}
    tasks = (
        db.query(models.Task)
        .filter(models.Task.is_completed.is_(False), models.Task.due_at.isnot(None))
        .all()
    )
    goal_titles = {g.id: g.title for g in goals}
    for t in tasks:
        if t.due_at.date() >= today:
            continue
        touched = t.updated_at or t.created_at
        if touched and touched > cutoff:
            continue
        tasks_by_assignee.setdefault(t.assignee_email.lower(), []).append({
            "title": t.title,
            "due": t.due_at.strftime("%d %b %Y"),
            "days_late": (today - t.due_at.date()).days,
            "goal_title": goal_titles.get(t.goal_id),
        })

    return {"goals": goals_by_owner, "tasks": tasks_by_assignee}


async def stalled_reminders(db: Session) -> dict:
    """Email people whose overdue goals or tasks have stopped moving."""
    stalled = collect_stalled(db)
    users = {u.email.lower(): u for u in crud.get_all_org_users(db)}
    period_key = crud.current_academic_year_key()
    now = datetime.datetime.utcnow()
    window = datetime.timedelta(days=settings.REMINDER_RENOTIFY_DAYS)

    sent = {"goal_overdue": 0, "tasks_pending": 0}
    skipped = 0

    async def maybe_send(email, flag_type, sender, payload):
        nonlocal skipped
        user = users.get(email)
        if not user:
            return
        last = crud.get_last_notified(db, user.email, flag_type, period_key)
        if last and (now - last.last_notified_at) < window:
            skipped += 1
            return
        if await sender(user.email, user.name, payload):
            crud.record_notification(db, user.email, flag_type, period_key)
            sent[flag_type] += 1

    for email, items in stalled["goals"].items():
        await maybe_send(email, "goal_overdue", email_service.send_overdue_goal_warning, items)
    for email, items in stalled["tasks"].items():
        await maybe_send(email, "tasks_pending", email_service.send_pending_tasks_reminder, items)

    logger.info("Stalled reminders: %s sent, %d skipped (already chased within %d days)",
                sent, skipped, settings.REMINDER_RENOTIFY_DAYS)
    return {
        "overdue_goal_emails": sent["goal_overdue"],
        "pending_task_emails": sent["tasks_pending"],
        "skipped_recently_chased": skipped,
        "people_with_stalled_goals": len(stalled["goals"]),
        "people_with_stalled_tasks": len(stalled["tasks"]),
    }


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

    stalled = await stalled_reminders(db)

    logger.info(
        "Flag check done: %d sent, %d skipped (notified within %d days), %d failed",
        sent, skipped_recent, settings.FLAG_RENOTIFY_DAYS, failed,
    )
    return {
        **stalled,
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
