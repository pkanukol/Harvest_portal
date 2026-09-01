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



# ─── Goal state, shared by the overview and the HR report ────────────────────
# Ranked most-actionable first: a person with an unacknowledged goal and a
# settled one needs chasing about the first, so that is what their row shows.
GOAL_STATE_RANK = {
    "needs_acknowledgment": 0,
    "awaiting_review": 1,
    "approved": 2,
    "complete": 3,
    "struck_off": 4,
    "not_set": 5,
}


def goal_state(goal: models.Goal) -> str:
    """One goal's position in the review workflow.

    Read the latest review action rather than trusting `status`: a struck-off
    goal keeps status "struck_off_pending_ack" even after the owner has
    acknowledged it, because that status is also what allows them to delete
    it. Only owner_ack_at says whether the owner has actually responded.
    """
    latest = goal.review_actions[0] if goal.review_actions else None
    if goal.status in ("modified_pending_ack", "struck_off_pending_ack"):
        if latest and not latest.owner_ack_at:
            return "needs_acknowledgment"
        # Acknowledged. A struck-off goal is finished with - it is not
        # outstanding work, and must not be counted as overdue.
        if goal.status == "struck_off_pending_ack":
            return "struck_off"
        return "approved"
    if not latest:
        return "awaiting_review"
    if goal.is_completed:
        return "complete"
    return "approved"


def goals_awaiting_review(db: Session, reviewer_email: str,
                          today: Optional[datetime.date] = None) -> int:
    """How many goals are actually sitting in this reviewer's queue.

    Counts GOALS the reviewer has not acted on, not the people assigned to
    them: someone with five reviewees who have all been reviewed has nothing
    to do, and a count of 5 would say otherwise. Goals waiting on the OWNER to
    acknowledge are excluded - those are not the reviewer's move.
    """
    people = {u.email.lower() for u in get_reviewees(db, reviewer_email)}
    if not people:
        return 0
    period_key = current_academic_year_key(today or datetime.date.today())
    goals = (
        db.query(models.Goal)
        .options(selectinload(models.Goal.review_actions))
        .filter(models.Goal.period_key == period_key, models.Goal.status != "deleted")
        .all()
    )
    return sum(1 for g in goals
               if g.owner_email.lower() in people and goal_state(g) == "awaiting_review")


def state_is_live(state: str) -> bool:
    """Whether a goal in this state is still real, outstanding work."""
    return state not in ("struck_off", "not_set", "complete")

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
        # Every goal in the slot, not just the first - and via goal_state, so
        # an acknowledged strike-off stops reading as "pending" forever.
        states = [goal_state(g) for g in gs]
        best = min(states, key=lambda st: GOAL_STATE_RANK.get(st, 9))
        if best in ("needs_acknowledgment", "awaiting_review"):
            status = "pending"
        elif best == "struck_off":
            # Struck off and acknowledged: nothing stands, so the slot is
            # empty again rather than permanently "pending".
            status = "not_set"
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


def plan_step_dates(count: int, target: Optional[datetime.date],
                    start: Optional[datetime.date] = None) -> List[Optional[datetime.date]]:
    """Spread `count` steps between today and the goal's target date, evenly,
    with the last step landing ON the target date - so finishing the plan and
    hitting the goal date are the same event.

    Returns Nones when there is no target date (steps still become tasks, just
    undated). A target that is today or already past gives every step today's
    date rather than the target's: a step cannot have been due before the goal
    existed, and the soonest a thing can now be done is today. The goal itself
    still reports as overdue - that is what the risk badge is for.
    """
    if count <= 0:
        return []
    if not target:
        return [None] * count
    start = start or datetime.date.today()
    span = (target - start).days
    if span <= 0:
        return [start] * count
    # Step i of n lands at start + span*(i+1)/n; the last is exactly target.
    return [start + datetime.timedelta(days=round(span * (i + 1) / count)) for i in range(count)]


def create_goal(db: Session, owner_email: str, owner_name: str, req: schemas.GoalCreate) -> models.Goal:
    # Teachers' academic year ends in April, so their term dates differ.
    _owner_teacher = is_teacher(db, owner_email)
    goal = models.Goal(
        owner_email=owner_email,
        cadence=req.cadence,
        period_key=current_academic_year_key(),
        title=req.title,
        specific_text=req.specific_text,
        measurable_text=req.measurable_text,
        achievable_text=req.achievable_text,
        relevant_text=req.relevant_text,
        target_date=req.target_date,
        period=(req.period if req.period in GOAL_PERIODS else "year"),
        instance_key=period_instance_key(req.period or "year", teacher=_owner_teacher),
    )
    # A monthly or termly goal without a date gets the end of its own period:
    # that is what "monthly" means, and it keeps the overdue warnings honest.
    if not goal.target_date and goal.period in ("month", "term"):
        goal.target_date = period_end_date(goal.period, teacher=_owner_teacher)
    db.add(goal)
    db.commit()
    db.refresh(goal)

    # The plan is only a proposal until the reviewer approves it, so it is
    # stored on the goal rather than scheduled. materialise_plan() turns it
    # into tasks at the moment of approval - see review_goal.
    steps = [s.strip() for s in (req.steps or []) if s and s.strip()]
    if steps:
        goal.plan_steps = steps
        db.commit()
        db.refresh(goal)
    return goal


def materialise_plan(db: Session, goal: models.Goal, owner_name: str = "") -> int:
    """Turn an approved goal's stored plan into tasks. Returns how many.

    Dates run from TODAY (the approval date), not from when the goal was
    written - a plan approved three weeks late should not arrive with three
    weeks of its schedule already spent. The last step still lands on the
    goal's target date.

    Clears plan_steps afterwards, so re-approving or approving a goal whose
    tasks have since been edited can never duplicate the plan.
    """
    steps = [s for s in (goal.plan_steps or []) if s and s.strip()]
    if not steps:
        return 0
    owner = db.query(models.User).filter(models.User.email.ilike(goal.owner_email)).first()
    name = owner.name if owner else (owner_name or goal.owner_email)
    for step, due in zip(steps, plan_step_dates(len(steps), goal.target_date)):
        db.add(models.Task(
            goal_id=goal.id,
            title=step,
            created_by_email=goal.owner_email,
            created_by_name=name,
            assignee_email=goal.owner_email,
            assignee_name=name,
            # End of the working day, so a task due "today" is not already
            # overdue the moment it is created.
            due_at=datetime.datetime.combine(due, datetime.time(17, 30)) if due else None,
        ))
    goal.plan_steps = None
    db.commit()
    db.refresh(goal)
    return len(steps)


def sync_goal_completion_from_tasks(db: Session, goal_id: Optional[int]) -> None:
    """Close a goal once every task linked to it is done - and re-open it if
    one is reopened. The goal's completion used to be a manual checkbox with a
    "shall I tick this for you?" prompt; deriving it means the goal cannot sit
    open with all its work finished, or closed with work outstanding.

    Only ever acts on goals that HAVE linked tasks: a goal with no plan keeps
    its manual completion flag untouched.
    """
    if not goal_id:
        return
    goal = db.query(models.Goal).filter(models.Goal.id == goal_id).first()
    if not goal or goal.status == "deleted":
        return
    linked = db.query(models.Task).filter(models.Task.goal_id == goal_id).all()
    if not linked:
        return
    all_done = all(t.is_completed for t in linked)
    if all_done and not goal.is_completed:
        goal.is_completed = True
        goal.completed_at = datetime.datetime.utcnow()
        db.commit()
    elif not all_done and goal.is_completed:
        goal.is_completed = False
        goal.completed_at = None
        db.commit()


def annotate_goal_risk(db: Session, goals: List[models.Goal]) -> None:
    """Attach `risk` and `plan_overruns_target` to goals for the response.

    A week's notice is the point: "overdue" after the fact is a post-mortem,
    whereas "due_soon" plus a plan whose last task already sits past the
    target date is something the owner can still act on.
    """
    today = datetime.date.today()
    goal_ids = [g.id for g in goals]
    latest_task_due = {}
    if goal_ids:
        rows = (
            db.query(models.Task.goal_id, models.Task.due_at)
            .filter(models.Task.goal_id.in_(goal_ids), models.Task.is_completed.is_(False))
            .all()
        )
        for gid, due_at in rows:
            if not due_at:
                continue
            d = due_at.date()
            if gid not in latest_task_due or d > latest_task_due[gid]:
                latest_task_due[gid] = d

    for g in goals:
        if g.is_completed or not g.target_date:
            g.risk = "on_track"
        elif g.target_date < today:
            g.risk = "overdue"
        elif (g.target_date - today).days <= 7:
            g.risk = "due_soon"
        else:
            g.risk = "on_track"
        g.period_label = period_label(g.period, g.instance_key)
        last_due = latest_task_due.get(g.id)
        g.plan_overruns_target = bool(
            g.target_date and last_due and last_due > g.target_date and not g.is_completed
        )


def get_goal(db: Session, goal_id: int) -> Optional[models.Goal]:
    return db.query(models.Goal).filter(models.Goal.id == goal_id).first()


def edit_goal(db: Session, goal: models.Goal, req: schemas.GoalEdit) -> models.Goal:
    goal.title = req.title
    goal.specific_text = req.specific_text
    goal.measurable_text = req.measurable_text
    goal.achievable_text = req.achievable_text
    goal.relevant_text = req.relevant_text
    goal.target_date = req.target_date
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
        raise ValueError("A comment is required to strike off a goal")
    if req.action_type == "modified" and not (req.reason or "").strip():
        raise ValueError("A comment is required when modifying a goal")
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

    if req.action_type == "approved":
        # Approval is the point at which the plan becomes real work.
        materialise_plan(db, goal)

    action = models.GoalReviewAction(
        goal_id=goal.id,
        action_type=req.action_type,
        reason=(req.reason or "").strip() or None,
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


def _delete_task_tree(db: Session, task: models.Task) -> int:
    """Delete a task and everything under it. Subtasks have no DB-level
    cascade, so removing only the parent would strand the children."""
    removed = 0
    for child in list(task.subtasks or []):
        removed += _delete_task_tree(db, child)
    db.query(models.TaskNote).filter(models.TaskNote.task_id == task.id).delete(synchronize_session=False)
    db.delete(task)
    return removed + 1


def soft_delete_goal(db: Session, goal: models.Goal) -> int:
    """Hide the goal and clear the plan that belonged to it.

    The goal itself stays as a soft-deleted row (the review record refers to
    it), but its tasks are removed outright: they only existed as steps of
    this goal, and leaving them behind puts orphaned work in people's task
    lists with no goal to explain it. Returns how many tasks went with it.
    """
    tasks = db.query(models.Task).filter(models.Task.goal_id == goal.id).all()
    # Only whole trees rooted on this goal - a subtask whose parent belongs to
    # another goal is that goal's business, so it is unlinked, not deleted.
    removed = 0
    for t in tasks:
        if t.parent_id and not any(p.id == t.parent_id for p in tasks):
            t.goal_id = None
            continue
        if t.parent_id:
            continue  # reached via its parent's tree below
        removed += _delete_task_tree(db, t)
    goal.status = "deleted"
    db.commit()
    return removed


def count_goal_tasks(db: Session, goal_id: int) -> int:
    return db.query(models.Task).filter(models.Task.goal_id == goal_id).count()


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



# ─── Goal periods: month / term / year ───────────────────────────────────────
# A goal's `period` says how long it runs and therefore whether it comes back.
# Term 1 is June-October and Term 2 November-May (settings.TERM_*_START_MONTH),
# so Term 2 spans the new year and every term calculation is done against the
# ACADEMIC year rather than the calendar one.

GOAL_PERIODS = ("month", "term", "year")


def _month_end(d: datetime.date) -> datetime.date:
    first_next = datetime.date(d.year + (d.month == 12), (d.month % 12) + 1, 1)
    return first_next - datetime.timedelta(days=1)


def is_teacher(db: Session, email: str) -> bool:
    u = get_user_by_email(db, email)
    return bool(u) and (u.role or "").strip().lower() == "teacher"


def current_term(today: Optional[datetime.date] = None, teacher: bool = False) -> tuple:
    """(term_number, start_date, end_date) for the term containing `today`.

    Term 1 is June-October for everyone. Term 2 starts in November and ends in
    MAY, except for teachers, whose academic year finishes in APRIL - so their
    Term 2 is a month shorter and a termly goal must not be dated past it.
    """
    today = today or datetime.date.today()
    t1, t2 = settings.TERM_1_START_MONTH, settings.TERM_2_START_MONTH
    end_month = settings.TERM_2_END_MONTH_TEACHER if teacher else settings.TERM_2_END_MONTH
    if t1 <= today.month < t2:
        return 1, datetime.date(today.year, t1, 1), datetime.date(today.year, t2, 1) - datetime.timedelta(days=1)
    # Term 2 crosses into the next calendar year.
    start_year = today.year if today.month >= t2 else today.year - 1
    return 2, datetime.date(start_year, t2, 1), _month_end(datetime.date(start_year + 1, end_month, 1))


def period_instance_key(period: str, today: Optional[datetime.date] = None,
                        teacher: bool = False) -> Optional[str]:
    """A stable label for the month/term a goal copy belongs to, used to ask
    "does this month's copy already exist?". None for year goals - period_key
    (the academic year) already identifies those."""
    today = today or datetime.date.today()
    if period == "month":
        return "%04d-%02d" % (today.year, today.month)
    if period == "term":
        term, _, _ = current_term(today, teacher)
        return "%s-T%d" % (current_academic_year_key(today), term)
    return None


def period_end_date(period: str, today: Optional[datetime.date] = None,
                    teacher: bool = False) -> Optional[datetime.date]:
    """The last day of the current month/term - the default target date when
    someone tags a goal monthly or termly without picking one.

    Never returns a date in the past. A teacher setting a termly goal in May
    is past their April year-end, so the term end has already gone; falling
    back to the month end gives them something they can actually work to.
    """
    today = today or datetime.date.today()
    if period == "month":
        return _month_end(today)
    if period == "term":
        end = current_term(today, teacher)[2]
        return end if end >= today else _month_end(today)
    return None


def period_label(period: str, instance_key: Optional[str]) -> str:
    """Human label for a goal's period, e.g. "August 2026" or "Term 1"."""
    if period == "month" and instance_key:
        try:
            y, m = instance_key.split("-")
            return datetime.date(int(y), int(m), 1).strftime("%B %Y")
        except (ValueError, TypeError):
            return "Monthly"
    if period == "term" and instance_key:
        return "Term " + instance_key.rsplit("T", 1)[-1]
    return {"month": "Monthly", "term": "Termly"}.get(period, "This year")


def goal_repeat_suggestions(db: Session, owner_email: str,
                            today: Optional[datetime.date] = None) -> List[dict]:
    """Month/term goals whose period has rolled over and which have no copy
    for the current period yet - offered to the owner to add or ignore.

    Nothing is created here. A goal reappears as a prompt precisely because
    the owner may well not want it again this month, and auto-creating would
    quietly fill their list and their reviewer's queue.
    """
    today = today or datetime.date.today()
    teacher = is_teacher(db, owner_email)
    goals = (
        db.query(models.Goal)
        .filter(
            models.Goal.owner_email.ilike(owner_email),
            models.Goal.period.in_(("month", "term")),
            models.Goal.status != "deleted",
        )
        .all()
    )
    if not goals:
        return []

    dismissed = {
        (d.root_goal_id, d.instance_key)
        for d in db.query(models.GoalRepeatDismissal)
        .filter(models.GoalRepeatDismissal.owner_email.ilike(owner_email))
        .all()
    }

    # Group by chain, so a goal repeated five times suggests once, not five times.
    chains = {}
    for g in goals:
        root = g.repeat_source_id or g.id
        chains.setdefault(root, []).append(g)

    out = []
    for root, members in chains.items():
        period = members[0].period
        wanted = period_instance_key(period, today, teacher)
        if any(m.instance_key == wanted for m in members):
            continue                      # this period's copy already exists
        if (root, wanted) in dismissed:
            continue                      # owner said no for this period
        latest = max(members, key=lambda m: m.id)
        out.append({
            "goal_id": latest.id,
            "root_goal_id": root,
            "title": latest.title,
            "cadence": latest.cadence,
            "period": period,
            "instance_key": wanted,
            "period_label": period_label(period, wanted),
            "suggested_target_date": period_end_date(period, today, teacher),
        })
    return out


def repeat_goal(db: Session, goal: models.Goal,
                today: Optional[datetime.date] = None) -> models.Goal:
    """Copy a month/term goal into the current period, plan included.

    The copy starts unapproved with its plan pending, exactly like a new
    goal: last month's approval was for last month's work.
    """
    today = today or datetime.date.today()
    teacher = is_teacher(db, goal.owner_email)
    root = goal.repeat_source_id or goal.id
    copy = models.Goal(
        owner_email=goal.owner_email,
        cadence=goal.cadence,
        period_key=current_academic_year_key(today),
        title=goal.title,
        specific_text=goal.specific_text,
        measurable_text=goal.measurable_text,
        achievable_text=goal.achievable_text,
        relevant_text=goal.relevant_text,
        period=goal.period,
        instance_key=period_instance_key(goal.period, today, teacher),
        repeat_source_id=root,
        target_date=period_end_date(goal.period, today, teacher),
        # Carry the plan forward as a proposal, from the original if this
        # chain's plan has already been turned into tasks.
        plan_steps=goal.plan_steps or _plan_of_chain(db, root),
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


def _plan_of_chain(db: Session, root_id: int) -> Optional[list]:
    """The step titles used by the chain's earlier copy, so a repeat starts
    with the same plan even though the previous plan became tasks."""
    earlier = (
        db.query(models.Goal)
        .filter((models.Goal.id == root_id) | (models.Goal.repeat_source_id == root_id))
        .order_by(models.Goal.id.desc())
        .all()
    )
    for g in earlier:
        if g.plan_steps:
            return list(g.plan_steps)
        tasks = (
            db.query(models.Task)
            .filter(models.Task.goal_id == g.id, models.Task.parent_id.is_(None))
            .order_by(models.Task.id)
            .all()
        )
        if tasks:
            return [t.title for t in tasks]
    return None


def dismiss_repeat(db: Session, owner_email: str, root_goal_id: int, instance_key: str) -> None:
    exists = (
        db.query(models.GoalRepeatDismissal)
        .filter(
            models.GoalRepeatDismissal.owner_email.ilike(owner_email),
            models.GoalRepeatDismissal.root_goal_id == root_goal_id,
            models.GoalRepeatDismissal.instance_key == instance_key,
        )
        .first()
    )
    if not exists:
        db.add(models.GoalRepeatDismissal(
            owner_email=owner_email, root_goal_id=root_goal_id, instance_key=instance_key))
        db.commit()


# ─── HR report ───────────────────────────────────────────────────────────────

def hr_report(db: Session, today: Optional[datetime.date] = None) -> dict:
    """One row per person: whether each goal is set, where it is in the review
    chain, and how their tasks are going.

    Deliberately built from four bulk queries rather than per-person lookups -
    this is the widest read in the app (139 people x 2 goals x N tasks) and the
    per-person version of it took ~700 round trips.
    """
    today = today or datetime.date.today()
    period_key = current_academic_year_key(today)
    users = get_all_org_users(db)

    goals = (
        db.query(models.Goal)
        .options(selectinload(models.Goal.review_actions))
        .filter(models.Goal.period_key == period_key, models.Goal.status != "deleted")
        .all()
    )
    by_owner: dict = {}
    for g in goals:
        by_owner.setdefault(g.owner_email.lower(), []).append(g)

    tasks = db.query(models.Task).all()
    tasks_by_assignee: dict = {}
    for t in tasks:
        tasks_by_assignee.setdefault(t.assignee_email.lower(), []).append(t)

    reviewers = {a.person_email.lower(): a.reviewer_email for a in db.query(models.ReviewerAssignment).all()}
    names = {u.email.lower(): u.name for u in users}

    rows = []
    totals = {
        "people": 0, "no_goals": 0, "awaiting_review": 0, "needs_acknowledgment": 0,
        "approved": 0, "struck_off": 0, "overdue_goals": 0, "overdue_tasks": 0, "open_tasks": 0,
    }

    for u in users:
        mine = by_owner.get(u.email.lower(), [])
        mytasks = tasks_by_assignee.get(u.email.lower(), [])
        open_tasks = [t for t in mytasks if not t.is_completed]
        overdue_tasks = [t for t in open_tasks if t.due_at and t.due_at.date() < today]

        def slot(cadence):
            gs = [x for x in mine if x.cadence == cadence]
            if not gs:
                return {"state": "not_set", "title": None, "target_date": None,
                        "period_label": None, "overdue": False, "goal_count": 0}
            # Show the goal that most needs attention, not whichever happened
            # to be created first.
            ranked = sorted(gs, key=lambda g: GOAL_STATE_RANK.get(goal_state(g), 9))
            g = ranked[0]
            state = goal_state(g)
            return {
                "state": state,
                "title": g.title,
                "target_date": g.target_date,
                "period_label": period_label(getattr(g, "period", "year"), getattr(g, "instance_key", None)),
                # A struck-off or completed goal is not outstanding work, so it
                # is never overdue however far past its date it sits.
                "overdue": bool(g.target_date and g.target_date < today and state_is_live(state)),
                "goal_count": len(gs),
            }

        role_slot, org_slot = slot("mid_term"), slot("annual")
        rows.append({
            "email": u.email, "name": u.name, "designation": u.designation,
            "role": u.role, "location": u.location,
            "reviewer_name": names.get((reviewers.get(u.email.lower()) or "").lower()),
            "role_goal": role_slot, "org_goal": org_slot,
            "open_tasks": len(open_tasks),
            "overdue_tasks": len(overdue_tasks),
            "completed_tasks": len(mytasks) - len(open_tasks),
        })

        totals["people"] += 1
        if role_slot["state"] in ("not_set", "struck_off") and org_slot["state"] in ("not_set", "struck_off"):
            totals["no_goals"] += 1
        for sl in (role_slot, org_slot):
            if sl["state"] == "awaiting_review":
                totals["awaiting_review"] += 1
            elif sl["state"] == "needs_acknowledgment":
                totals["needs_acknowledgment"] += 1
            elif sl["state"] in ("approved", "complete"):
                totals["approved"] += 1
            elif sl["state"] == "struck_off":
                totals["struck_off"] += 1
            if sl["overdue"]:
                totals["overdue_goals"] += 1
        totals["open_tasks"] += len(open_tasks)
        totals["overdue_tasks"] += len(overdue_tasks)

    rows.sort(key=lambda r: ((r["role_goal"]["state"] != "not_set" and r["org_goal"]["state"] != "not_set"), r["name"]))
    return {"generated_on": today, "period_key": period_key, "totals": totals, "people": rows}

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

class StaffDirectoryUnavailable(RuntimeError):
    """Raised when staff_roles returns nothing at all - which means lost access,
    not an empty search. See the probe in search_staff."""


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
    # PostgREST reports a lost GRANT as 401 with Postgres code 42501
    # ("permission denied for table"), which is a configuration problem on the
    # shared project, not a bad request from here - and is the OTHER way this
    # keeps breaking, alongside a lost RLS policy (handled below).
    if resp.status_code in (401, 403):
        body = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {}
        if body.get("code") == "42501" or "permission denied" in (body.get("message") or "").lower():
            raise StaffDirectoryUnavailable(
                "The staff directory can't be read right now - its access grant has been "
                "reset again. Re-run the staff_roles GRANT/RLS policy in the shared "
                "Supabase project."
            )
    resp.raise_for_status()
    rows = resp.json()
    if rows:
        return rows

    # Zero rows is ambiguous: either nobody matches, or the anon role has lost
    # its grant/policy on staff_roles again (PostgREST answers 200 with [] when
    # RLS filters everything out - no error to catch). Re-probe with no filters
    # at all: if even that is empty, the directory is unreachable rather than
    # unmatched, and the caller should say so instead of "No match".
    async with httpx.AsyncClient() as client:
        probe = await client.get(
            f"{settings.STAFF_SUPABASE_URL}/rest/v1/staff_roles",
            params={"select": "email", "limit": "1"},
            headers={
                "apikey": settings.STAFF_SUPABASE_ANON_KEY,
                "Authorization": f"Bearer {settings.STAFF_SUPABASE_ANON_KEY}",
            },
            timeout=10,
        )
    if probe.status_code == 200 and not probe.json():
        raise StaffDirectoryUnavailable(
            "The staff directory can't be read right now. Its access policy may need "
            "re-applying (staff_roles GRANT/RLS in the shared Supabase project)."
        )
    return rows
