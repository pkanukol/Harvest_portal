import datetime
from typing import List, Optional
from sqlalchemy.orm import Session
from .config import settings
from . import models, schemas


# ─── Academic year / period helpers ──────────────────────────────────────────
# No shared academic-year infrastructure exists to reuse (Timetable's
# `academic_years` table is a per-campus manually-toggled flag with no date
# range). Reusing AuditApp's informal June-1 rollover convention instead
# (AuditApp/backend/app/crud.py:310-311) as a computed label, not a table.

def _academic_start_year(today: datetime.date) -> int:
    start = (settings.ACADEMIC_YEAR_START_MONTH, settings.ACADEMIC_YEAR_START_DAY)
    if (today.month, today.day) >= start:
        return today.year
    return today.year - 1


def current_academic_year_key(today: Optional[datetime.date] = None) -> str:
    today = today or datetime.date.today()
    start_year = _academic_start_year(today)
    return f"{start_year}-{(start_year + 1) % 100:02d}"


def _mid_term_cutoff_date(start_year: int) -> datetime.date:
    cutoff_year = start_year
    if (settings.MID_TERM_CUTOFF_MONTH, settings.MID_TERM_CUTOFF_DAY) < (settings.ACADEMIC_YEAR_START_MONTH, settings.ACADEMIC_YEAR_START_DAY):
        cutoff_year = start_year + 1
    return datetime.date(cutoff_year, settings.MID_TERM_CUTOFF_MONTH, settings.MID_TERM_CUTOFF_DAY)


def is_mid_term_cutoff_passed(today: Optional[datetime.date] = None) -> bool:
    today = today or datetime.date.today()
    return today >= _mid_term_cutoff_date(_academic_start_year(today))


# ─── Shared users (read-only) ────────────────────────────────────────────────

def get_user_by_email(db: Session, email: str) -> Optional[models.User]:
    return db.query(models.User).filter(models.User.email.ilike(email)).first()


def get_all_org_users(db: Session) -> List[models.User]:
    """Everyone with an account who can use GoalTracker at all - teacher, sme,
    or any leadership/admin account (role='auditor' is the shared bucket for
    every non-teaching designation in the real data, including ones outside
    the initially-named roles like IT Manager)."""
    return (
        db.query(models.User)
        .filter(models.User.role.in_(["teacher", "sme", "auditor"]))
        .order_by(models.User.name)
        .all()
    )


# ─── Reviewer / acknowledger assignments ────────────────────────────────────

def get_assignment(db: Session, email: str) -> Optional[models.ReviewerAssignment]:
    return db.query(models.ReviewerAssignment).filter(models.ReviewerAssignment.person_email.ilike(email)).first()


def get_reviewer_for(db: Session, email: str) -> Optional[str]:
    a = get_assignment(db, email)
    return a.reviewer_email if a else None


def get_acknowledger_for(db: Session, email: str) -> Optional[str]:
    """Who acknowledges `email`'s review actions when they act as a reviewer
    for someone else (not who reviews their own goals)."""
    a = get_assignment(db, email)
    return a.acknowledger_email if a else None


def get_reviewees(db: Session, reviewer_email: str) -> List[models.User]:
    person_emails = [
        a.person_email
        for a in db.query(models.ReviewerAssignment)
        .filter(models.ReviewerAssignment.reviewer_email.ilike(reviewer_email))
        .all()
    ]
    if not person_emails:
        return []
    users = db.query(models.User).filter(models.User.email.in_(person_emails)).all()
    by_email = {u.email.lower(): u for u in users}
    return [by_email[e.lower()] for e in person_emails if e.lower() in by_email]


def get_pending_acknowledgments(db: Session, acknowledger_email: str) -> List[models.GoalReviewAction]:
    pending = (
        db.query(models.GoalReviewAction)
        .filter(models.GoalReviewAction.upper_ack_at.is_(None))
        .all()
    )
    return [a for a in pending if (get_acknowledger_for(db, a.reviewed_by) or "").lower() == acknowledger_email.lower()]


def list_all_assignments(db: Session) -> dict:
    return {a.person_email.lower(): a for a in db.query(models.ReviewerAssignment).all()}


def upsert_assignment(
    db: Session, person_email: str, reviewer_email: Optional[str], acknowledger_email: Optional[str], updated_by: str
) -> models.ReviewerAssignment:
    row = get_assignment(db, person_email)
    if not row:
        row = models.ReviewerAssignment(person_email=person_email)
        db.add(row)
    row.reviewer_email = reviewer_email or None
    row.acknowledger_email = acknowledger_email or None
    row.updated_by = updated_by
    row.updated_at = datetime.datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


# ─── Flags ───────────────────────────────────────────────────────────────────

def _has_goal(db: Session, owner_email: str, cadence: str, period_key: str) -> bool:
    return (
        db.query(models.Goal)
        .filter(
            models.Goal.owner_email.ilike(owner_email),
            models.Goal.cadence == cadence,
            models.Goal.period_key == period_key,
            models.Goal.status != "deleted",
        )
        .first()
        is not None
    )


def compute_flags(db: Session, owner_email: str, today: Optional[datetime.date] = None) -> schemas.FlagsOut:
    today = today or datetime.date.today()
    period_key = current_academic_year_key(today)
    mid_term_set = _has_goal(db, owner_email, "mid_term", period_key)
    annual_set = _has_goal(db, owner_email, "annual", period_key)
    mid_term_missing = is_mid_term_cutoff_passed(today) and not mid_term_set
    annual_missing = not annual_set
    return schemas.FlagsOut(
        mid_term_missing=mid_term_missing, annual_missing=annual_missing,
        mid_term_set=mid_term_set, annual_set=annual_set,
    )


# ─── Goals ───────────────────────────────────────────────────────────────────

def list_goals(db: Session, owner_email: str) -> List[models.Goal]:
    return (
        db.query(models.Goal)
        .filter(models.Goal.owner_email.ilike(owner_email), models.Goal.status != "deleted")
        .order_by(models.Goal.created_at.desc())
        .all()
    )


def create_goal(db: Session, owner_email: str, req: schemas.GoalCreate) -> models.Goal:
    goal = models.Goal(
        owner_email=owner_email,
        cadence=req.cadence,
        category=req.category,
        period_key=current_academic_year_key(),
        title=req.title,
        specific_text=req.specific_text,
        measurable_text=req.measurable_text,
        achievable_text=req.achievable_text,
        relevant_text=req.relevant_text,
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


def get_goal(db: Session, goal_id: int) -> Optional[models.Goal]:
    return db.query(models.Goal).filter(models.Goal.id == goal_id).first()


def edit_goal(db: Session, goal: models.Goal, req: schemas.GoalEdit) -> models.Goal:
    goal.title = req.title
    goal.specific_text = req.specific_text
    goal.measurable_text = req.measurable_text
    goal.achievable_text = req.achievable_text
    goal.relevant_text = req.relevant_text
    db.commit()
    db.refresh(goal)
    return goal


def add_goal_log(db: Session, goal: models.Goal, req: schemas.GoalLogCreate) -> models.GoalLog:
    log = models.GoalLog(
        goal_id=goal.id,
        log_date=req.log_date or datetime.date.today(),
        notes=req.notes,
    )
    db.add(log)
    db.commit()
    db.refresh(log)
    return log


# ─── Review / acknowledge workflow ──────────────────────────────────────────

_GOAL_FIELDS = ["title", "specific_text", "measurable_text", "achievable_text", "relevant_text"]


def review_goal(db: Session, goal: models.Goal, reviewer_email: str, req: schemas.ReviewRequest) -> models.GoalReviewAction:
    if req.action_type not in ("approved", "modified", "struck_off"):
        raise ValueError("Invalid action_type")
    if req.action_type in ("modified", "struck_off") and not (req.reason or "").strip():
        raise ValueError("A reason is required to modify or strike off a goal")
    if req.action_type == "modified" and not req.edit:
        raise ValueError("edit fields are required to modify a goal")

    snapshot_before = None
    if req.action_type == "modified":
        snapshot_before = {f: getattr(goal, f) for f in _GOAL_FIELDS}
        for f in _GOAL_FIELDS:
            setattr(goal, f, getattr(req.edit, f))
        goal.status = "modified_pending_ack"
    elif req.action_type == "struck_off":
        goal.status = "struck_off_pending_ack"
    # 'approved' leaves goal.status untouched (stays active)

    action = models.GoalReviewAction(
        goal_id=goal.id,
        action_type=req.action_type,
        reason=req.reason,
        snapshot_before=snapshot_before,
        reviewed_by=reviewer_email,
    )
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


def get_review_action(db: Session, action_id: int) -> Optional[models.GoalReviewAction]:
    return db.query(models.GoalReviewAction).filter(models.GoalReviewAction.id == action_id).first()


def owner_acknowledge(db: Session, goal: models.Goal, action: models.GoalReviewAction, owner_email: str) -> models.GoalReviewAction:
    action.owner_ack_by = owner_email
    action.owner_ack_at = datetime.datetime.utcnow()
    if goal.status == "modified_pending_ack":
        goal.status = "active"
    db.commit()
    db.refresh(action)
    return action


def upper_acknowledge(db: Session, action: models.GoalReviewAction, acknowledger_email: str, notes: Optional[str]) -> models.GoalReviewAction:
    action.upper_ack_by = acknowledger_email
    action.upper_ack_at = datetime.datetime.utcnow()
    action.upper_ack_notes = notes
    db.commit()
    db.refresh(action)
    return action


def can_delete_goal(goal: models.Goal) -> bool:
    if goal.status != "struck_off_pending_ack":
        return False
    latest = goal.review_actions[0] if goal.review_actions else None
    return bool(latest and latest.action_type == "struck_off" and latest.owner_ack_at)


def soft_delete_goal(db: Session, goal: models.Goal) -> None:
    goal.status = "deleted"
    db.commit()


# ─── Flag notification throttling (used by flag_check.py) ──────────────────

def get_last_notified(db: Session, owner_email: str, flag_type: str, period_key: str):
    return (
        db.query(models.GoalFlagNotification)
        .filter(
            models.GoalFlagNotification.owner_email.ilike(owner_email),
            models.GoalFlagNotification.flag_type == flag_type,
            models.GoalFlagNotification.period_key == period_key,
        )
        .first()
    )


def record_notification(db: Session, owner_email: str, flag_type: str, period_key: str) -> None:
    existing = get_last_notified(db, owner_email, flag_type, period_key)
    now = datetime.datetime.utcnow()
    if existing:
        existing.last_notified_at = now
    else:
        db.add(models.GoalFlagNotification(
            owner_email=owner_email, flag_type=flag_type, period_key=period_key, last_notified_at=now,
        ))
    db.commit()
