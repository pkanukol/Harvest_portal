import logging
import time
import httpx
from fastapi import FastAPI, Depends, HTTPException, Request, status, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, get_db, run_migrations
from . import models, schemas, crud, auth

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("curriculum_tracker")

Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(title="Curriculum Tracker API", version="1.0.0")


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

    user = db.query(models.User).filter(models.User.email.ilike(email)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Your account is not registered in the system yet. Please contact your administrator to get access.")

    is_sme = auth.role_is_sme(user.role, user.designation)
    # role='auditor' is the shared marker for every real leadership account
    # (APM, Principal, Vice Principal, Curriculum Head, Managing Director,
    # Coordinator) in the shared users table — checked first since designation
    # wording alone was found to miss real accounts (the bug just fixed in the
    # Apps Script version of this app).
    is_leadership = not is_sme and (auth.role_is_leadership(user.role) or auth.designation_is_leadership(user.designation))

    if not user.subject and not is_leadership:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This app is for subject teachers and Subject Matter Experts for POW and TBS discussions. If you believe this is a mistake, please contact your administrator.",
        )

    app_role = "SME" if is_sme else ("Leadership" if is_leadership else "Teacher")

    token = auth.create_access_token(data={
        "sub": user.email, "role": app_role, "name": user.name,
        "designation": user.designation, "subject": user.subject,
    })
    return {
        "access_token": token, "token_type": "bearer", "role": app_role,
        "name": user.name, "email": user.email, "designation": user.designation,
        "subject": user.subject, "location": user.location,
    }


# ─── Planner topics ──────────────────────────────────────────────────────────

@app.get("/api/planner/topics", response_model=list[schemas.PlannerTopicOut])
def get_planner_topics(
    subject: str = Query(...),
    grade: str = Query(...),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return crud.get_planner_rows(db, subject, int(grade))


# ─── POW cards (dashboard) ───────────────────────────────────────────────────

@app.get("/api/pow/cards", response_model=schemas.PowCardsResponse)
def get_pow_cards(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return crud.get_pow_cards(db, current_user.email, current_user.role)


@app.get("/api/pow/{pow_id}")
def get_pow(
    pow_id: int,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.get_current_user),
):
    pow_entry = crud.get_pow(db, pow_id)
    if not pow_entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="POW not found")
    review = pow_entry.review
    return {
        "pow": {
            "id": pow_entry.id, "teacher_email": pow_entry.teacher_email, "subject": pow_entry.subject,
            "grade": pow_entry.grade, "week_start": pow_entry.week_start.isoformat(), "week_end": pow_entry.week_end.isoformat(),
            "topic": pow_entry.topic, "subtopic": pow_entry.subtopic, "lp_session_num": pow_entry.lp_session_num,
            "cw": pow_entry.cw, "binder": pow_entry.binder, "activity": pow_entry.activity, "homework": pow_entry.homework,
            "cct_topic_yn": pow_entry.cct_topic_yn, "cct_topic_text": pow_entry.cct_topic_text,
            "cct_dashboard_updated": pow_entry.cct_dashboard_updated,
            "impl_a": pow_entry.impl_a, "impl_b": pow_entry.impl_b, "impl_c": pow_entry.impl_c,
            "impl_d": pow_entry.impl_d, "impl_e": pow_entry.impl_e, "impl_f": pow_entry.impl_f,
            "correction_done": pow_entry.correction_done, "instructions": pow_entry.instructions,
            "teacher_remarks": pow_entry.teacher_remarks, "status": pow_entry.status, "tbs_mom": pow_entry.tbs_mom,
        },
        "review": ({
            "sme_email": review.sme_email, "cct_discussed": review.cct_discussed,
            "approved_closed": review.approved_closed, "remarks": review.remarks,
            "sme_name": review.sme_name, "confirmed_date": review.confirmed_date.isoformat() if review.confirmed_date else None,
        } if review else None),
    }


@app.post("/api/pow")
def create_pow(
    req: schemas.PowCreateRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_teacher),
):
    dup = crud.find_duplicate_pow(db, req.subject, req.grade, req.week_start, req.topic, req.subtopic or "")
    if dup:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A POW already exists for this week, subject, grade, topic and sub-topic.")
    pow_entry = crud.create_pow(db, current_user.email, req)
    return {"success": True, "id": pow_entry.id}


@app.patch("/api/pow/{pow_id}/implementation")
def update_pow_implementation(
    pow_id: int,
    req: schemas.PowImplementationRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_teacher),
):
    pow_entry = crud.get_pow(db, pow_id)
    if not pow_entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="POW not found")
    # Shared-by-subject visibility (see crud.get_pow_cards) means any teacher of
    # this POW's subject may fill in their own section (A-F), not just whoever
    # created it — so the check here is subject-scoped, not creator-scoped.
    if (current_user.subject or "").lower() != (pow_entry.subject or "").lower():
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You can only edit POWs for your own subject")
    crud.update_pow_implementation(db, pow_entry, req)
    return {"success": True, "final_save": req.final_save}


@app.put("/api/pow/{pow_id}/review")
def save_sme_review(
    pow_id: int,
    req: schemas.SmeReviewRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_sme),
):
    pow_entry = crud.get_pow(db, pow_id)
    if not pow_entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="POW not found")
    try:
        crud.save_sme_review(db, pow_entry, current_user.email, req)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"success": True}


# ─── Progress check ──────────────────────────────────────────────────────────

@app.get("/api/progress/summary")
def get_progress_summary(
    subject: str = Query(...),
    grade: str = Query(...),
    teacher_email: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    # Leadership/SME omit teacher_email (see whole-school/mapped-teacher view);
    # a plain Teacher can only ever query their own email.
    effective_email = teacher_email or None
    if current_user.role == "Teacher":
        effective_email = current_user.email
    return crud.get_progress_summary(db, subject, int(grade), effective_email)


@app.get("/api/progress/chart")
def get_progress_chart(
    subject: str = Query(...),
    grade: str = Query(...),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return crud.get_progress_chart(db, subject, int(grade))
