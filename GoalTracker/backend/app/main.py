import logging
import time
import httpx
from fastapi import FastAPI, Depends, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, get_db
from . import models, schemas, crud, auth

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

    is_admin = auth.role_is_leadership(user.role) or auth.designation_is_leadership(user.designation)

    token = auth.create_access_token(data={
        "sub": user.email, "name": user.name, "designation": user.designation, "is_admin": is_admin,
    })
    return {
        "access_token": token, "token_type": "bearer",
        "name": user.name, "email": user.email, "designation": user.designation,
        "is_admin": is_admin, "location": user.location,
    }


# ─── My goals ────────────────────────────────────────────────────────────────

@app.get("/api/goals", response_model=schemas.GoalsResponse)
def get_my_goals(db: Session = Depends(get_db), current_user: auth.CurrentUser = Depends(auth.get_current_user)):
    goals = crud.list_goals(db, current_user.email)
    flags = crud.compute_flags(db, current_user.email)
    return {"goals": goals, "flags": flags}


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


@app.delete("/api/goals/{goal_id}")
def delete_goal(
    goal_id: int,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    goal = _require_own_goal(db, goal_id, current_user.email)
    if not crud.can_delete_goal(goal):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="This goal can only be deleted after it's been struck off and you've acknowledged it")
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


@app.post("/api/goals/{goal_id}/review/{action_id}/upper-ack", response_model=schemas.ReviewActionOut)
def upper_ack(
    goal_id: int,
    action_id: int,
    req: schemas.AckRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    action = crud.get_review_action(db, action_id)
    if not action or action.goal_id != goal_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review action not found")
    expected_acknowledger = crud.get_acknowledger_for(db, action.reviewed_by)
    if not expected_acknowledger or expected_acknowledger.lower() != current_user.email.lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You aren't the assigned acknowledger for this review")
    if action.upper_ack_at:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Already acknowledged")
    return crud.upper_acknowledge(db, action, current_user.email, req.notes)


# ─── Team: reviewees + pending acknowledgments ──────────────────────────────

@app.get("/api/team", response_model=schemas.TeamResponse)
def get_team(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    reviewees = crud.get_reviewees(db, current_user.email)
    reviewee_out = [
        {"email": u.email, "name": u.name, "designation": u.designation, "flags": crud.compute_flags(db, u.email)}
        for u in reviewees
    ]

    pending_actions = crud.get_pending_acknowledgments(db, current_user.email)
    pending_out = []
    for action in pending_actions:
        goal = crud.get_goal(db, action.goal_id)
        if not goal:
            continue
        owner = crud.get_user_by_email(db, goal.owner_email)
        reviewer = crud.get_user_by_email(db, action.reviewed_by)
        pending_out.append({
            "goal": goal,
            "action": action,
            "owner_email": goal.owner_email,
            "owner_name": owner.name if owner else goal.owner_email,
            "reviewed_by_name": reviewer.name if reviewer else action.reviewed_by,
        })

    return {"reviewees": reviewee_out, "pending_acknowledgments": pending_out}


@app.get("/api/team/{email}/goals", response_model=schemas.GoalsResponse)
def get_member_goals(
    email: str,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    reviewer_email = crud.get_reviewer_for(db, email)
    is_their_reviewer = bool(reviewer_email) and reviewer_email.lower() == current_user.email.lower()
    if not (is_their_reviewer or current_user.is_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this person's goals")
    goals = crud.list_goals(db, email)
    flags = crud.compute_flags(db, email)
    return {"goals": goals, "flags": flags}


# ─── Admin: reviewer/acknowledger assignments ───────────────────────────────

@app.get("/api/admin/reviewer-assignments", response_model=schemas.ReviewerAssignmentsResponse)
def get_reviewer_assignments(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_admin),
):
    users = crud.get_all_org_users(db)
    assignments = crud.list_all_assignments(db)
    people = []
    for u in users:
        a = assignments.get(u.email.lower())
        people.append({
            "person_email": u.email, "person_name": u.name, "designation": u.designation,
            "reviewer_email": a.reviewer_email if a else None,
            "acknowledger_email": a.acknowledger_email if a else None,
        })
    directory = [{"email": u.email, "name": u.name, "designation": u.designation} for u in users]
    return {"people": people, "directory": directory}


@app.put("/api/admin/reviewer-assignments", response_model=schemas.ReviewerAssignmentOut)
def put_reviewer_assignment(
    req: schemas.ReviewerAssignmentIn,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_admin),
):
    person = crud.get_user_by_email(db, req.person_email)
    if not person:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Person not found")
    row = crud.upsert_assignment(db, person.email, req.reviewer_email, req.acknowledger_email, current_user.email)
    return {
        "person_email": person.email, "person_name": person.name, "designation": person.designation,
        "reviewer_email": row.reviewer_email, "acknowledger_email": row.acknowledger_email,
    }
