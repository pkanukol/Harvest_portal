import datetime
from typing import List, Optional
import httpx
from sqlalchemy.orm import Session, selectinload
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


_ROLE_GROUP_RANK = {"sme": 0, "auditor": 1, "teacher": 2}


def get_all_org_users(db: Session) -> List[models.User]:
    """Everyone with an account who can use GoalTracker at all - teacher, sme,
    or any leadership/admin account (role='auditor' is the shared bucket for
    every non-teaching designation in the real data, including ones outside
    the initially-named roles like IT Manager). Grouped SME first, then every
    other admin/leadership designation, then teachers last - within each
    group, alphabetical by name."""
    users = db.query(models.User).filter(models.User.role.in_(["teacher", "sme", "auditor"])).all()
    return sorted(users, key=lambda u: (_ROLE_GROUP_RANK.get((u.role or "").strip().lower(), 99), u.name))


# Designations a Principal should not see/manage in the reviewer-assignment
# admin screen - Managing Director and the roles that report directly to MD
# (DLP Manager, APM) or sit outside the academic chain entirely (IT), plus
# Chairman at the very top. Principal-specific scoping only; every other
# admin designation still sees everyone (not asked for anything narrower yet).
PRINCIPAL_HIDDEN_DESIGNATIONS = {
    "chairman", "managing director", "dlp manager", "it manager", "information technology", "apm",
}


# ─── Reviewer assignments ────────────────────────────────────────────────────

def get_assignment(db: Session, email: str) -> Optional[models.ReviewerAssignment]:
    return db.query(models.ReviewerAssignment).filter(models.ReviewerAssignment.person_email.ilike(email)).first()


def get_reviewer_for(db: Session, email: str) -> Optional[str]:
    a = get_assignment(db, email)
    return a.reviewer_email if a else None


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


def list_all_assignments(db: Session) -> dict:
    return {a.person_email.lower(): a for a in db.query(models.ReviewerAssignment).all()}


def upsert_assignment(
    db: Session, person_email: str, reviewer_email: Optional[str], updated_by: str
) -> models.ReviewerAssignment:
    row = get_assignment(db, person_email)
    if not row:
        row = models.ReviewerAssignment(person_email=person_email)
        db.add(row)
    row.reviewer_email = reviewer_email or None
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


def goal_slot_status(db: Session, owner_email: str, cadence: str, period_key: str) -> str:
    """Collapses a goal's existence + review state into one of three values
    for the reviewer-facing team table: 'not_set' (no live goal), 'pending'
    (a goal exists but something is still outstanding - never reviewed, or
    reviewed but not yet acknowledged by the owner), 'approved' (reviewed
    and resolved, nothing outstanding)."""
    goal = (
        db.query(models.Goal)
        .filter(
            models.Goal.owner_email.ilike(owner_email),
            models.Goal.cadence == cadence,
            models.Goal.period_key == period_key,
            models.Goal.status != "deleted",
        )
        .first()
    )
    if not goal:
        return "not_set"
    latest = goal.review_actions[0] if goal.review_actions else None
    if not latest:
        return "pending"  # created, nobody has reviewed it yet
    if goal.status in ("modified_pending_ack", "struck_off_pending_ack"):
        return "pending"  # owner hasn't acknowledged the review yet
    return "approved"


def goal_progress(db: Session, owner_email: str, cadence: str, period_key: str) -> dict:
    """Goals set vs. marked complete for one cadence/period, across both
    categories - drives the completed/total progress bars. Deliberately
    separate from goal_slot_status: that tracks review sign-off, this tracks
    whether the goal was actually achieved."""
    goals = (
        db.query(models.Goal)
        .filter(
            models.Goal.owner_email.ilike(owner_email),
            models.Goal.cadence == cadence,
            models.Goal.period_key == period_key,
            models.Goal.status != "deleted",
        )
        .all()
    )
    return {"completed": sum(1 for g in goals if g.is_completed), "total": len(goals)}


def overview_goal_map(db: Session, period_key: str) -> dict:
    """Status + progress for EVERY person and cadence in one pass.

    goal_slot_status/goal_progress are per-person, so the org-wide overview
    was running four queries per person plus a lazy load of each goal's
    review actions - 700+ round trips for 139 people, which is slow locally
    and painful against Supabase where every one is a network hop. This does
    the same work with two queries and a group-by in Python.

    Returns {(owner_email_lower, cadence): {"status", "completed", "total"}}.
    """
    goals = (
        db.query(models.Goal)
        .options(selectinload(models.Goal.review_actions))
        .filter(models.Goal.period_key == period_key, models.Goal.status != "deleted")
        .order_by(models.Goal.id)
        .all()
    )
    grouped: dict = {}
    for g in goals:
        grouped.setdefault((g.owner_email.lower(), g.cadence), []).append(g)

    out = {}
    for key, gs in grouped.items():
        # Same rule as goal_slot_status, applied to the first goal in the
        # slot (that function used .first() with no ordering; ordering by id
        # here at least makes it deterministic).
        first = gs[0]
        if not first.review_actions:
            status = "pending"          # created, nobody has reviewed it yet
        elif first.status in ("modified_pending_ack", "struck_off_pending_ack"):
            status = "pending"          # owner hasn't acknowledged the review
        else:
            status = "approved"
        out[key] = {
            "status": status,
            "completed": sum(1 for g in gs if g.is_completed),
            "total": len(gs),
        }
    return out


def overview_slot(goal_map: dict, email: str, cadence: str) -> dict:
    """One person's slot out of overview_goal_map, defaulting to 'not set'."""
    return goal_map.get((email.lower(), cadence)) or {"status": "not_set", "completed": 0, "total": 0}


def observation_average_map(db: Session) -> dict:
    """{user_id: average score} for every teacher in one query - the overview
    was fetching every observation row per teacher, one teacher at a time."""
    rows = (
        db.query(models.Observation.teacher_id, models.Observation.overall_score)
        .filter(models.Observation.is_draft.is_(False))
        .all()
    )
    totals: dict = {}
    for teacher_id, score in rows:
        if score is None:
            continue
        acc = totals.setdefault(teacher_id, [0.0, 0])
        acc[0] += score
        acc[1] += 1
    return {tid: round(total / count, 1) for tid, (total, count) in totals.items() if count}


def set_goal_completion(db: Session, goal: models.Goal, is_completed: bool) -> models.Goal:
    goal.is_completed = is_completed
    goal.completed_at = datetime.datetime.utcnow() if is_completed else None
    db.commit()
    db.refresh(goal)
    return goal


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
    if req.action_type == "struck_off" and not (req.reason or "").strip():
        raise ValueError("A reason is required to strike off a goal")
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


def goal_delete_block_reason(goal: models.Goal) -> Optional[str]:
    """None means the goal can be deleted. Otherwise, a message explaining
    the SPECIFIC reason it can't be - deletion is only allowed for a goal
    that's never been reviewed at all, or one that was struck off and
    acknowledged; every other state has a different, more accurate reason
    than a single generic message could cover."""
    latest = goal.review_actions[0] if goal.review_actions else None

    if goal.status == "active" and not latest:
        return None  # never reviewed - nothing to protect, freely removable
    if goal.status == "active" and latest:
        return "This goal was approved by your reviewer, so it can't be deleted - approved goals are permanently kept as part of the review record. There's no action you can take to unlock deletion; if it genuinely needs to go, ask your reviewer to strike it off instead of leaving it approved."
    if goal.status == "modified_pending_ack":
        return "Your reviewer modified this goal and it's awaiting your acknowledgment. Acknowledge the change first - a goal pending acknowledgment can't be deleted."
    if goal.status == "struck_off_pending_ack":
        if latest and latest.action_type == "struck_off" and latest.owner_ack_at:
            return None  # struck off and acknowledged - deletable
        return "Your reviewer struck off this goal. Acknowledge the strike-off first (see the reason shown above) - once acknowledged, you'll be able to delete it."
    if goal.status == "deleted":
        return "This goal has already been deleted."
    return "This goal can't be deleted right now."


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


# ─── Classroom observations (read-only, owned by AuditApp) ─────────────────

def get_observations_for_teacher(db: Session, teacher_email: str) -> List[models.Observation]:
    teacher = get_user_by_email(db, teacher_email)
    if not teacher:
        return []
    return (
        db.query(models.Observation)
        .filter(models.Observation.teacher_id == teacher.id, models.Observation.is_draft.is_(False))
        .order_by(models.Observation.date_time.desc())
        .all()
    )


def get_observation_average(observations: List[models.Observation]) -> Optional[float]:
    if not observations:
        return None
    return round(sum(o.overall_score for o in observations) / len(observations), 1)


# ─── Tasks ───────────────────────────────────────────────────────────────────

def get_upward_chain(db: Session, email: str) -> List[str]:
    """Walks reviewer_email links upward from `email` (excluding `email`
    itself) until there's no more reviewer or a cycle is hit - the full
    stack of people above this person in the review chain, used for task
    visibility (see can_view_task)."""
    seen = set()
    chain = []
    current = email
    while True:
        reviewer = get_reviewer_for(db, current)
        if not reviewer or reviewer.lower() in seen or reviewer.lower() == current.lower():
            break
        seen.add(reviewer.lower())
        chain.append(reviewer)
        current = reviewer
    return chain


def can_view_task(db: Session, task: models.Task, viewer_email: str) -> bool:
    viewer = viewer_email.lower()
    if task.created_by_email.lower() == viewer or task.assignee_email.lower() == viewer:
        return True
    return viewer in {e.lower() for e in get_upward_chain(db, task.assignee_email)}


def get_task(db: Session, task_id: int) -> Optional[models.Task]:
    return db.query(models.Task).filter(models.Task.id == task_id).first()


def create_task(db: Session, created_by_email: str, created_by_name: str, req: schemas.TaskCreate) -> models.Task:
    task = models.Task(
        parent_id=req.parent_id,
        goal_id=req.goal_id,
        title=req.title,
        description=req.description,
        created_by_email=created_by_email,
        created_by_name=created_by_name,
        assignee_email=req.assignee_email,
        assignee_name=req.assignee_name,
        due_at=req.due_at,
    )
    db.add(task)
    db.commit()
    db.refresh(task)
    return task


def edit_task(db: Session, task: models.Task, req: schemas.TaskEdit) -> models.Task:
    task.title = req.title
    task.description = req.description
    task.assignee_email = req.assignee_email
    task.assignee_name = req.assignee_name
    task.due_at = req.due_at
    task.goal_id = req.goal_id
    db.commit()
    db.refresh(task)
    return task


def set_task_completion(db: Session, task: models.Task, is_completed: bool) -> models.Task:
    task.is_completed = is_completed
    task.completed_at = datetime.datetime.utcnow() if is_completed else None
    db.commit()
    db.refresh(task)
    return task


def delete_task(db: Session, task: models.Task) -> None:
    db.delete(task)  # cascades to the whole subtree - see Task.subtasks relationship
    db.commit()


def postpone_task_week(db: Session, task: models.Task) -> models.Task:
    """Moves a task's due date one week later - if it never had a due date,
    anchors it to a week from today instead so it lands somewhere sensible."""
    base = task.due_at or datetime.datetime.utcnow()
    task.due_at = base + datetime.timedelta(days=7)
    task.postpone_count += 1
    db.commit()
    db.refresh(task)
    return task


def add_task_note(db: Session, task_id: int, author_email: str, author_name: str, note: str) -> models.TaskNote:
    row = models.TaskNote(task_id=task_id, author_email=author_email, author_name=author_name, note=note)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def _find_root(task: models.Task) -> models.Task:
    node = task
    while node.parent is not None:
        node = node.parent
    return node


def list_visible_tasks(db: Session, viewer_email: str) -> List[models.Task]:
    """Every task tree the viewer can see, as top-level roots: a tree is
    included if the viewer can see ANY node within it (its root, or any
    subtask at any depth) - so someone assigned only a deeply-nested subtask
    still finds the whole tree, with every subtask visible once they're in
    it (mirrors how opening a Goal shows its full history rather than
    hiding parts of it)."""
    all_tasks = db.query(models.Task).all()
    visible_root_ids = {
        _find_root(t).id for t in all_tasks if can_view_task(db, t, viewer_email)
    }
    roots = [t for t in all_tasks if t.id in visible_root_ids and t.parent_id is None]
    roots.sort(key=lambda t: t.created_at, reverse=True)
    return roots


def get_tasks_for_goal(db: Session, goal_id: int) -> List[models.Task]:
    """Every task tree that has at least one node linked to this goal,
    returned as full top-level roots - same "show the whole tree for
    context" rule as list_visible_tasks, just keyed off goal_id instead of
    viewer permission."""
    all_tasks = db.query(models.Task).all()
    root_ids = {_find_root(t).id for t in all_tasks if t.goal_id == goal_id}
    roots = [t for t in all_tasks if t.id in root_ids and t.parent_id is None]
    roots.sort(key=lambda t: t.created_at, reverse=True)
    return roots


def can_view_goal(db: Session, viewer_email: str, goal: models.Goal, viewer_is_admin: bool) -> bool:
    if goal.owner_email.lower() == viewer_email.lower():
        return True
    reviewer_email = get_reviewer_for(db, goal.owner_email)
    if reviewer_email and reviewer_email.lower() == viewer_email.lower():
        return True
    return viewer_is_admin


# ─── Staff directory (staff_roles - a SEPARATE Supabase project, read-only) ─

async def search_staff(query: str, location: Optional[str] = None) -> List[dict]:
    params = {
        "select": "email,name,designation,branches",
        "active": "eq.true",
        "order": "name",
        "limit": "30",
    }
    if query.strip():
        params["name"] = f"ilike.*{query.strip()}*"
    if location:
        # Staff explicitly at this branch, OR staff with no branch set at all
        # (leadership like MD/APM aren't tied to one campus).
        params["or"] = f"(branches.cs.{{{location}}},branches.eq.{{}})"
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.STAFF_SUPABASE_URL}/rest/v1/staff_roles",
            params=params,
            headers={
                "apikey": settings.STAFF_SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {settings.STAFF_SUPABASE_ANON_KEY}",
            },
            timeout=10,
        )
    resp.raise_for_status()
    return resp.json()
