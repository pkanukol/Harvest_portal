import logging
import time
from typing import List, Optional
import httpx
from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, get_db
from . import models, schemas, crud, auth, flag_check

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("goal_tracker")

Base.metadata.create_all(bind=engine)

app = FastAPI(title="GoalTracker API", version="2.0.0")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.time()
    logger.info("-> %s %s", request.method, request.url.path)
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("!! %s %s failed after %.2fs", request.method, request.url.path, time.time() - start)
        raise
    logger.info("<- %s %s %s (%.2fs)", request.method, request.url.path, response.status_code, time.time() - start)
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Auth / SSO ──────────────────────────────────────────────────────────────

def _mint_sso_response(user: models.User, impersonated_by: Optional[str] = None) -> dict:
    is_admin = auth.role_is_leadership(user.role) or auth.designation_is_leadership(user.designation)
    can_manage_reviewers = user.email.strip().lower() == settings.REVIEWER_ASSIGNMENTS_ADMIN_EMAIL.lower()
    can_view_observations = auth.designation_can_view_observations(user.designation)
    # Org-wide overview is narrower than is_admin: the MD, the branch
    # principals, and the owner - not every leadership designation.
    can_view_overview = auth.designation_can_view_overview(user.designation) or can_manage_reviewers
    claims = {
        "sub": user.email, "name": user.name, "designation": user.designation,
        "is_admin": is_admin, "can_manage_reviewers": can_manage_reviewers,
        "can_view_observations": can_view_observations,
        "can_view_overview": can_view_overview,
    }
    # Carried in the token, not just the response, so a switched session stays
    # identifiable across reloads and the client cannot drop the marker.
    if impersonated_by:
        claims["impersonated_by"] = impersonated_by
    token = auth.create_access_token(data=claims)
    act_as_allowed = (settings.ACT_AS_ADMIN_EMAIL or "").strip().lower()
    return {
        "access_token": token, "token_type": "bearer",
        "name": user.name, "email": user.email, "designation": user.designation,
        "is_admin": is_admin, "can_manage_reviewers": can_manage_reviewers,
        "can_view_observations": can_view_observations, "location": user.location,
        "can_view_overview": can_view_overview,
        "impersonated_by": impersonated_by,
        # Lets the UI show the switcher only to the one person who can use it,
        # and hide it inside an already-switched session.
        "can_act_as": bool(act_as_allowed) and user.email.strip().lower() == act_as_allowed and not impersonated_by,
    }


@app.post("/api/auth/sso", response_model=schemas.SSOResponse)
async def sso_login(req: schemas.SSORequest, db: Session = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {req.supabase_token}", "apikey": settings.SUPABASE_ANON_KEY},
            timeout=10,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid SSO token")

    supabase_user = resp.json()
    email = (supabase_user.get("email") or "").strip()
    if not email.lower().endswith("@harvestinternationalschool.in"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Please sign in with your Harvest International School Google account to continue.")

    user = crud.get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Your account is not registered in the system yet. Please contact your administrator to get access.")

    # Anyone with a teacher/sme/auditor account can use GoalTracker - no
    # subject requirement (goal-setting doesn't need one). role='auditor'
    # covers every leadership/admin designation in the real data.
    if (user.role or "").strip().lower() not in ("teacher", "sme", "auditor"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account type isn't supported by GoalTracker yet. Please contact your administrator.")

    return _mint_sso_response(user)


@app.post("/api/dev/login", response_model=schemas.SSOResponse)
def dev_login(req: schemas.DevLoginRequest, db: Session = Depends(get_db)):
    """Local-testing-only shortcut that mints a token for a seeded email
    without a real Supabase/Google login - lets the frontend's dev "test as"
    panel log in with one click instead of the dev_login.py-then-paste-into-
    console workflow. Two independent gates, not just a hidden UI button:
    (1) DATABASE_URL must be SQLite (never the real Supabase Postgres
    project) - structurally incapable of working once pointed at production;
    (2) only an email in DEV_LOGIN_ALLOWED_EMAILS may ever be minted this
    way, regardless of what email a request asks for."""
    if not settings.DATABASE_URL.startswith("sqlite"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    allowed = {e.lower() for e in settings.DEV_LOGIN_ALLOWED_EMAILS}
    if req.email.strip().lower() not in allowed:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    user = crud.get_user_by_email(db, req.email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No seeded user with email {req.email!r}")
    return _mint_sso_response(user)


# ─── My goals ────────────────────────────────────────────────────────────────

@app.get("/api/goals", response_model=schemas.GoalsResponse)
def get_my_goals(db: Session = Depends(get_db), current_user: auth.CurrentUser = Depends(auth.get_current_user)):
    goals = crud.list_goals(db, current_user.email)
    flags = crud.compute_flags(db, current_user.email)
    return {"goals": goals, "flags": flags, "period_key": crud.current_academic_year_key()}


@app.post("/api/goals", response_model=schemas.GoalOut)
def create_goal(
    req: schemas.GoalCreate,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return crud.create_goal(db, current_user.email, req)


def _require_own_goal(db: Session, goal_id: int, email: str) -> models.Goal:
    goal = crud.get_goal(db, goal_id)
    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    if goal.owner_email.lower() != email.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your goal")
    return goal


@app.patch("/api/goals/{goal_id}", response_model=schemas.GoalOut)
def edit_goal(
    goal_id: int,
    req: schemas.GoalEdit,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    goal = _require_own_goal(db, goal_id, current_user.email)
    if goal.status != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This goal can't be edited while a review is pending your acknowledgment")
    return crud.edit_goal(db, goal, req)


@app.patch("/api/goals/{goal_id}/completion", response_model=schemas.GoalOut)
def update_goal_completion(
    goal_id: int,
    req: schemas.GoalCompletionUpdate,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    goal = _require_own_goal(db, goal_id, current_user.email)
    return crud.set_goal_completion(db, goal, req.is_completed)


@app.delete("/api/goals/{goal_id}")
def delete_goal(
    goal_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    goal = _require_own_goal(db, goal_id, current_user.email)
    block_reason = crud.goal_delete_block_reason(goal)
    if block_reason:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=block_reason)
    crud.soft_delete_goal(db, goal)
    return {"success": True}


@app.post("/api/goals/{goal_id}/logs", response_model=schemas.GoalLogOut)
def add_goal_log(
    goal_id: int,
    req: schemas.GoalLogCreate,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    goal = _require_own_goal(db, goal_id, current_user.email)
    return crud.add_goal_log(db, goal, req)


# ─── Review / acknowledge ───────────────────────────────────────────────────

@app.post("/api/goals/{goal_id}/review", response_model=schemas.ReviewActionOut)
def review_goal(
    goal_id: int,
    req: schemas.ReviewRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    goal = crud.get_goal(db, goal_id)
    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    reviewer_email = crud.get_reviewer_for(db, goal.owner_email)
    if not reviewer_email or reviewer_email.lower() != current_user.email.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You aren't the assigned reviewer for this person")
    if goal.status != "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This goal already has a review pending acknowledgment")
    try:
        return crud.review_goal(db, goal, current_user.email, req)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/goals/{goal_id}/review/{action_id}/owner-ack", response_model=schemas.ReviewActionOut)
def owner_ack(
    goal_id: int,
    action_id: int,
    req: schemas.AckRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    goal = _require_own_goal(db, goal_id, current_user.email)
    action = crud.get_review_action(db, action_id)
    if not action or action.goal_id != goal.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review action not found")
    if action.owner_ack_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already acknowledged")
    return crud.owner_acknowledge(db, goal, action, current_user.email)


# ─── Team: reviewees ────────────────────────────────────────────────────────

@app.get("/api/team", response_model=schemas.TeamResponse)
def get_team(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    reviewees = crud.get_reviewees(db, current_user.email)
    period_key = crud.current_academic_year_key()
    reviewee_out = [
        {
            "email": u.email, "name": u.name, "designation": u.designation, "role": u.role, "subject": u.subject,
            "mid_term_status": crud.goal_slot_status(db, u.email, "mid_term", period_key),
            "annual_status": crud.goal_slot_status(db, u.email, "annual", period_key),
            "mid_term_progress": crud.goal_progress(db, u.email, "mid_term", period_key),
            "annual_progress": crud.goal_progress(db, u.email, "annual", period_key),
        }
        for u in reviewees
    ]
    return {"reviewees": reviewee_out}


@app.get("/api/team/{email}/goals", response_model=schemas.GoalsResponse)
def get_member_goals(
    email: str,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    reviewer_email = crud.get_reviewer_for(db, email)
    is_their_reviewer = bool(reviewer_email) and reviewer_email.lower() == current_user.email.lower()
    can_view = is_their_reviewer or current_user.is_admin
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this person's goals")

    goals = crud.list_goals(db, email)
    flags = crud.compute_flags(db, email)
    return {"goals": goals, "flags": flags, "period_key": crud.current_academic_year_key()}


# ─── Leadership overview: org-wide goal status heatmap ─────────────────────

@app.get("/api/admin/goals-overview", response_model=schemas.GoalsOverviewResponse)
def get_goals_overview(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_overview_access),
):
    period_key = crud.current_academic_year_key()
    people = []
    mid_term_counts = {"not_set": 0, "pending": 0, "approved": 0}
    annual_counts = {"not_set": 0, "pending": 0, "approved": 0}
    for u in crud.get_all_org_users(db):
        mid_term_status = crud.goal_slot_status(db, u.email, "mid_term", period_key)
        annual_status = crud.goal_slot_status(db, u.email, "annual", period_key)
        mid_term_counts[mid_term_status] += 1
        annual_counts[annual_status] += 1
        observation_average = None
        if u.role == "teacher" and current_user.can_view_observations:
            observation_average = crud.get_observation_average(crud.get_observations_for_teacher(db, u.email))
        people.append({
            "email": u.email, "name": u.name, "designation": u.designation, "role": u.role, "subject": u.subject,
            "location": u.location,
            "mid_term_status": mid_term_status, "annual_status": annual_status,
            "mid_term_progress": crud.goal_progress(db, u.email, "mid_term", period_key),
            "annual_progress": crud.goal_progress(db, u.email, "annual", period_key),
            "observation_average": observation_average,
        })
    return {"people": people, "mid_term_summary": mid_term_counts, "annual_summary": annual_counts}


@app.get("/api/admin/people", response_model=List[schemas.OrgPersonOut])
def list_org_people(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_owner),
):
    """Flat roster for the "view as" picker. One query, no per-person work -
    goals-overview was being used for this and costs several queries per
    person (status, progress, observation averages), which made just opening
    the picker slow."""
    return crud.get_all_org_users(db)


@app.post("/api/admin/act-as/{email}", response_model=schemas.SSOResponse)
def act_as(
    email: str,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_act_as_admin),
):
    """Switch into another person's account to verify their whole flow works -
    what they see AND what they can do.

    Unlike /api/admin/view-as (read-only), this mints a real write-capable
    token, so anything done during the session is recorded as the person being
    acted as. That is what makes the test faithful and why it is restricted to
    the single email in settings.ACT_AS_ADMIN_EMAIL rather than to leadership
    as a group. Chaining is refused in require_act_as_admin, every switch is
    logged with both emails, and the minted token carries `impersonated_by`.
    """
    user = crud.get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such person")
    if user.email.strip().lower() == current_user.email.strip().lower():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That is already you")
    logger.warning("ACT-AS: %s switched into %s", current_user.email, user.email)
    return _mint_sso_response(user, impersonated_by=current_user.email)


@app.get("/api/admin/view-as/{email}", response_model=schemas.ViewAsResponse)
def view_as(
    email: str,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_owner),
):
    """Leadership preview of one person's whole dashboard - goals and tasks -
    resolved against THEIR visibility, so it answers "is the flow right for
    this role" rather than just "what goals do they have".

    Read-only by construction: it returns data and mints no token, so every
    write still runs as the real caller. The UI must not offer edit controls
    here - acting on someone else's behalf is not what this is for.
    """
    user = crud.get_user_by_email(db, email)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such person")

    # Mirrors the claims _mint_sso_response would put in their token, so the
    # preview shows the same buttons their own header would.
    is_admin = auth.role_is_leadership(user.role) or auth.designation_is_leadership(user.designation)

    roots = crud.list_visible_tasks(db, user.email)
    _annotate_tasks(db, roots, user.email)
    period_key = crud.current_academic_year_key()

    return {
        "person": {
            "email": user.email,
            "name": user.name,
            "designation": user.designation,
            "is_admin": is_admin,
            "can_manage_reviewers": user.email.strip().lower() == settings.REVIEWER_ASSIGNMENTS_ADMIN_EMAIL.lower(),
            "can_view_observations": auth.designation_can_view_observations(user.designation),
            "reviewee_count": len(crud.get_reviewees(db, user.email)),
        },
        "goals": crud.list_goals(db, user.email),
        "flags": crud.compute_flags(db, user.email),
        "period_key": period_key,
        "tasks": roots,
        "reviewees": [
            {
                "email": u.email, "name": u.name, "designation": u.designation, "role": u.role, "subject": u.subject,
                "mid_term_status": crud.goal_slot_status(db, u.email, "mid_term", period_key),
                "annual_status": crud.goal_slot_status(db, u.email, "annual", period_key),
                "mid_term_progress": crud.goal_progress(db, u.email, "mid_term", period_key),
                "annual_progress": crud.goal_progress(db, u.email, "annual", period_key),
            }
            for u in crud.get_reviewees(db, user.email)
        ],
    }


@app.post("/api/admin/flag-check", response_model=schemas.FlagCheckResultOut)
async def run_flag_check_now(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_owner),
):
    """Manual trigger for the flag-reminder emails, from the leadership Goals
    overview - the same pass the daily cron runs (paid-tier only on Render, so
    this button is the affordable path).

    Refuses to run without Resend credentials rather than falling through to
    email_service's "simulated" mode: that mode returns success, which would
    record notifications and then suppress the real emails for the whole
    FLAG_RENOTIFY_DAYS window. Harmless in the cron's logs, actively
    misleading behind a button that reports how many emails it sent.
    """
    if not settings.RESEND_API_KEY or not settings.RESEND_FROM_EMAIL:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email is not configured on the server (RESEND_API_KEY / RESEND_FROM_EMAIL). No reminders were sent.",
        )
    result = await flag_check.run_flag_check(db)
    logger.info("Manual flag-check run by %s: %s", current_user.email, result)
    return result


# ─── Classroom observations (read-only, owned by AuditApp) ─────────────────

@app.get("/api/observations/{email}", response_model=schemas.ObservationsResponse)
def get_observations(
    email: str,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_observation_access),
):
    observations = crud.get_observations_for_teacher(db, email)
    auditor_ids = {o.auditor_id for o in observations}
    auditors = db.query(models.User).filter(models.User.id.in_(auditor_ids)).all() if auditor_ids else []
    names_by_id = {a.id: a.name for a in auditors}
    for o in observations:
        o.auditor_name = names_by_id.get(o.auditor_id)
    return {"average_score": crud.get_observation_average(observations), "observations": observations}


# ─── Tasks (freely assignable to anyone, not just reviewees) ───────────────

def _annotate_tasks(db: Session, tasks: List[models.Task], viewer_email: str) -> None:
    goal_ids = set()

    def _collect(ts):
        for t in ts:
            if t.goal_id:
                goal_ids.add(t.goal_id)
            _collect(t.subtasks)

    _collect(tasks)
    titles_by_id = {}
    if goal_ids:
        titles_by_id = {g.id: g.title for g in db.query(models.Goal).filter(models.Goal.id.in_(goal_ids)).all()}

    def _annotate(ts):
        for t in ts:
            t.can_edit = t.created_by_email.lower() == viewer_email.lower() or t.assignee_email.lower() == viewer_email.lower()
            t.goal_title = titles_by_id.get(t.goal_id)
            _annotate(t.subtasks)

    _annotate(tasks)


@app.get("/api/tasks", response_model=List[schemas.TaskOut])
def get_tasks(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    roots = crud.list_visible_tasks(db, current_user.email)
    _annotate_tasks(db, roots, current_user.email)
    return roots


def _require_task_access(db: Session, task_id: int, email: str) -> models.Task:
    task = crud.get_task(db, task_id)
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")
    if not crud.can_view_task(db, task, email):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this task")
    return task


def _require_task_edit(db: Session, task_id: int, email: str) -> models.Task:
    task = _require_task_access(db, task_id, email)
    if task.created_by_email.lower() != email.lower() and task.assignee_email.lower() != email.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the creator or assignee can edit this task")
    return task


@app.post("/api/tasks", response_model=schemas.TaskOut)
def create_task(
    req: schemas.TaskCreate,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    if req.parent_id:
        _require_task_access(db, req.parent_id, current_user.email)
    task = crud.create_task(db, current_user.email, current_user.name, req)
    _annotate_tasks(db, [task], current_user.email)
    return task


@app.patch("/api/tasks/{task_id}", response_model=schemas.TaskOut)
def edit_task(
    task_id: int,
    req: schemas.TaskEdit,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    task = _require_task_edit(db, task_id, current_user.email)
    task = crud.edit_task(db, task, req)
    _annotate_tasks(db, [task], current_user.email)
    return task


@app.patch("/api/tasks/{task_id}/completion", response_model=schemas.TaskOut)
def update_task_completion(
    task_id: int,
    req: schemas.TaskCompletionUpdate,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    task = _require_task_edit(db, task_id, current_user.email)
    task = crud.set_task_completion(db, task, req.is_completed)
    _annotate_tasks(db, [task], current_user.email)
    return task


@app.delete("/api/tasks/{task_id}")
def delete_task(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    task = _require_task_edit(db, task_id, current_user.email)
    crud.delete_task(db, task)
    return {"success": True}


@app.post("/api/tasks/{task_id}/postpone-week", response_model=schemas.TaskOut)
def postpone_task_week(
    task_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    task = _require_task_edit(db, task_id, current_user.email)
    task = crud.postpone_task_week(db, task)
    _annotate_tasks(db, [task], current_user.email)
    return task


@app.post("/api/tasks/{task_id}/notes", response_model=schemas.TaskNoteOut)
def add_task_note(
    task_id: int,
    req: schemas.TaskNoteCreate,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    task = _require_task_edit(db, task_id, current_user.email)
    if not req.note.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Note can't be empty")
    return crud.add_task_note(db, task.id, current_user.email, current_user.name, req.note.strip())


@app.get("/api/tasks/goal-options", response_model=List[schemas.GoalOptionOut])
def get_goal_options(
    email: str,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """Lightweight goal list (id/title/cadence only) for the task-linking
    picker - lets a task creator link to a goal belonging to whoever they're
    assigning the task to, not just their own. Same visibility rule as
    viewing that person's goals elsewhere: themselves, their reviewer, or
    admin - never open to an unrelated colleague."""
    can_view = email.lower() == current_user.email.lower()
    if not can_view:
        reviewer_email = crud.get_reviewer_for(db, email)
        can_view = bool(reviewer_email) and reviewer_email.lower() == current_user.email.lower()
    if not can_view:
        can_view = current_user.is_admin
    if not can_view:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this person's goals")
    return crud.list_goals(db, email)


@app.get("/api/goals/{goal_id}/tasks", response_model=List[schemas.TaskOut])
def get_goal_tasks(
    goal_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    goal = crud.get_goal(db, goal_id)
    if not goal:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal not found")
    if not crud.can_view_goal(db, current_user.email, goal, current_user.is_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this goal")
    roots = crud.get_tasks_for_goal(db, goal_id)
    _annotate_tasks(db, roots, current_user.email)
    return roots


@app.get("/api/staff/search", response_model=List[schemas.StaffMemberOut])
async def search_staff(
    q: str = "",
    location: Optional[str] = None,
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return await crud.search_staff(q, location)


# ─── Admin: reviewer assignments ────────────────────────────────────────────

@app.get("/api/admin/reviewer-assignments", response_model=schemas.ReviewerAssignmentsResponse)
def get_reviewer_assignments(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_reviewer_admin),
):
    all_users = crud.get_all_org_users(db)
    names_by_email = {u.email.lower(): u.name for u in all_users}

    # A Principal doesn't manage MD/DLP Manager/IT/APM/Chairman - hide those
    # rows entirely, and their own teachers' assignments are handled by
    # SME/Curriculum Head, not the Principal, so those rows are shown
    # read-only rather than editable. Every other admin designation still
    # sees/edits everyone (not asked for anything narrower yet).
    is_principal = (current_user.designation or "").strip().lower() == "principal"
    visible_users = all_users
    if is_principal:
        visible_users = [
            u for u in all_users
            if (u.designation or "").strip().lower() not in crud.PRINCIPAL_HIDDEN_DESIGNATIONS
        ]

    assignments = crud.list_all_assignments(db)
    people = []
    for u in visible_users:
        a = assignments.get(u.email.lower())
        reviewer_email = a.reviewer_email if a else None
        can_edit = not (is_principal and (u.role or "").strip().lower() == "teacher")
        people.append({
            "person_email": u.email, "person_name": u.name, "designation": u.designation,
            "reviewer_email": reviewer_email, "reviewer_name": names_by_email.get((reviewer_email or "").lower()),
            "can_edit": can_edit,
        })
    directory = [{"email": u.email, "name": u.name, "designation": u.designation} for u in visible_users]
    return {"people": people, "directory": directory}


@app.put("/api/admin/reviewer-assignments", response_model=schemas.ReviewerAssignmentOut)
def put_reviewer_assignment(
    req: schemas.ReviewerAssignmentIn,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_reviewer_admin),
):
    person = crud.get_user_by_email(db, req.person_email)
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found")
    row = crud.upsert_assignment(db, person.email, req.reviewer_email, current_user.email)
    return {
        "person_email": person.email, "person_name": person.name, "designation": person.designation,
        "reviewer_email": row.reviewer_email,
    }
