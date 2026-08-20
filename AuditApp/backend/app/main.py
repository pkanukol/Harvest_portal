import asyncio
import os
import shutil
import uuid
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, Request, status, BackgroundTasks, File, UploadFile, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session, joinedload

from .config import settings
from .database import engine, Base, get_db, run_migrations
from . import models, schemas, crud, auth, ai_service
from . import email_service_resend as email_service

Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(
    title="Teachers Audit Application API",
    description="Python FastAPI backend with SQLite database connectivity for school teacher audits",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")


# --- AUTHENTICATION ROUTES ---

@app.post("/api/auth/register", response_model=schemas.UserOut, status_code=status.HTTP_201_CREATED)
async def register_user(user: schemas.UserCreate, db: Session = Depends(get_db)):
    if crud.get_user_by_email(db, user.email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    return crud.create_user(db, user)


@app.post("/api/auth/sso", response_model=schemas.Token)
async def sso_login(request: Request, db: Session = Depends(get_db)):
    import httpx
    body = await request.json()
    supabase_token = body.get("supabase_token", "")
    if not supabase_token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Missing token")

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {supabase_token}",
                "apikey": settings.SUPABASE_ANON_KEY,
            },
            timeout=10,
        )

    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid SSO token")

    supabase_user = resp.json()
    email = supabase_user.get("email", "")
    if not email.lower().endswith("@harvestinternationalschool.in"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized domain")

    user = db.query(models.User).filter(models.User.email.ilike(email)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in system")

    access_token = auth.create_access_token(data={"sub": user.email, "role": user.role})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role,
        "name": user.name,
        "email": user.email,
        "designation": user.designation,
        "location": user.location,
        "id": user.id,
    }


@app.post("/api/auth/login", response_model=schemas.Token)
async def login_user(req: schemas.LoginRequest, db: Session = Depends(get_db)):
    user = crud.get_user_by_email(db, req.email)
    if not user or not auth.verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    access_token = auth.create_access_token(data={"sub": user.email, "role": user.role})
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "role": user.role,
        "name": user.name,
        "email": user.email,
        "designation": user.designation,
        "location": user.location,
        "id": user.id,
    }


# --- USER ROUTES ---

@app.get("/api/users/me", response_model=schemas.UserOut)
async def read_current_user(current_user: models.User = Depends(auth.get_current_user)):
    return current_user


# "SPA" is the sentinel `subject` value the frontend passes to load coaches for the SPA
# (Sports/Performing Arts) observation form — it means "any specialist/co-curricular
# subject", matched against this curated set, not a literal subject called "SPA".
# STEM and PE are "dual-form" subjects: they're in SPA_SUBJECTS (so they show in the SPA
# form) but NOT in SPA_ONLY_SUBJECTS (so they ALSO show in the classroom form) — this lets a
# teacher who both coaches (SPA) and teaches the class (PE) appear in both forms via one account.
SPA_SUBJECTS = crud.SPA_ONLY_SUBJECTS | {"STEM", "PE"}


@app.get("/api/users/teachers", response_model=List[schemas.UserOut])
async def get_teachers(
    location: Optional[str] = Query(None),
    subject: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    from sqlalchemy import or_, and_

    is_spa_lookup = subject is not None and subject.upper() == "SPA"
    if is_spa_lookup:
        # Looking up SPA coaches: don't exclude SPA-only-subject teachers here.
        teacher_clause = models.User.role == "teacher"
    else:
        not_spa_only = or_(models.User.subject.is_(None), models.User.subject.notin_(crud.SPA_ONLY_SUBJECTS))
        teacher_clause = and_(models.User.role == "teacher", not_spa_only)

    if current_user.role == "auditor":
        query = db.query(models.User).filter(
            or_(
                teacher_clause,
                crud.sme_observable_clause(),
                crud.auditor_teaches_clause(),
            )
        )
    elif current_user.role == "sme":
        assigned_ids = db.query(models.TeacherSME.teacher_id).filter(
            models.TeacherSME.sme_id == current_user.id
        ).subquery()
        query = db.query(models.User).filter(
            models.User.id.in_(assigned_ids),
            or_(
                teacher_clause,
                crud.auditor_teaches_clause(),
            ),
        )
    else:
        raise HTTPException(status_code=403, detail="Unauthorized role")

    if location:
        query = query.filter(
            or_(models.User.location == location, models.User.location == "Both")
        )
    if is_spa_lookup:
        query = query.filter(models.User.subject.in_(SPA_SUBJECTS))
    elif subject:
        query = query.filter(models.User.subject.ilike(subject))
    return query.order_by(models.User.name).all()


# --- OBSERVATION ROUTES ---

# The six rubric parameters that make up the overall score. All must be filled (>= 1) before
# an observation can be finalised or its AI feedback generated. p34 (Technology) is excluded —
# it may legitimately be 0 = "Not Applicable" for a class that used no technology.
DOMAIN_SCORE_FIELDS = ("p11", "p12", "p21", "p31", "p32", "p33")


def _domain_scores_complete(obs) -> bool:
    return all((getattr(obs, f) or 0) >= 1 for f in DOMAIN_SCORE_FIELDS)


def _ai_feedback_payload(obs, auditor: models.User) -> dict:
    return {
        "overall_score": obs.overall_score, "rating": obs.rating,
        "teacher_name": obs.teacher.name, "subject": obs.subject,
        "grade": obs.grade, "school": obs.school,
        "auditor_name": auditor.name, "auditor_designation": auditor.designation,
        "p11": obs.p11, "p12": obs.p12, "p21": obs.p21,
        "p31": obs.p31, "p32": obs.p32, "p33": obs.p33, "p34": obs.p34,
        "infrastructure_issues": obs.infrastructure_issues,
        "other_issues": obs.other_issues,
    }


@app.post("/api/observations", response_model=schemas.ObservationOut)
async def submit_observation(
    obs_in: schemas.ObservationCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    teacher = crud.get_user_by_id(db, obs_in.teacher_id)
    if not teacher or not crud.is_classroom_observable(teacher, db):
        raise HTTPException(status_code=400, detail="Invalid teacher selected")

    # AI feedback is no longer generated automatically here — the auditor triggers it
    # explicitly (once scores are final) via POST /api/observations/{id}/generate-feedback.
    obs = crud.create_observation(db, obs_in, current_user.id)
    if not obs:
        raise HTTPException(status_code=500, detail="Failed to create observation")
    return obs


@app.post("/api/observations/{id}/generate-feedback", response_model=schemas.ObservationOut)
async def generate_observation_feedback(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs = crud.get_observation_by_id(db, id)
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    if obs.auditor_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only generate feedback for audits done by you")
    if not obs.is_draft:
        raise HTTPException(status_code=400, detail="Cannot regenerate feedback for a finalised observation")
    if not _domain_scores_complete(obs):
        raise HTTPException(status_code=400, detail="Please fill all domain scores before generating feedback")

    feedback = await ai_service.generate_ai_feedback(_ai_feedback_payload(obs, current_user))
    obs.ai_feedback = feedback
    db.commit()
    db.refresh(obs)
    return obs


@app.put("/api/observations/{id}/draft", response_model=schemas.ObservationOut)
async def update_draft(
    id: int,
    update: schemas.ObservationDraftUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs = crud.get_observation_by_id(db, id)
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    if obs.auditor_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit audits done by you")
    if not obs.is_draft:
        raise HTTPException(status_code=400, detail="Cannot edit a finalised observation")
    return crud.update_observation_draft(db, id, update)


@app.post("/api/observations/{id}/finalise", response_model=schemas.ObservationOut)
async def finalise_observation(
    id: int,
    body: schemas.ObservationFinalise,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs = crud.get_observation_by_id(db, id)
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    if obs.auditor_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only finalise audits done by you")
    if not obs.is_draft:
        raise HTTPException(status_code=400, detail="Observation is already finalised")
    if not _domain_scores_complete(obs):
        raise HTTPException(status_code=400, detail="All domain scores must be filled before finalising this observation")

    finalised_obs = crud.finalise_observation(db, id, body.witness_name, body.witness_designation)

    background_tasks.add_task(
        email_service.send_audit_notification,
        teacher_email=finalised_obs.teacher.email,
        teacher_name=finalised_obs.teacher.name,
        auditor_name=finalised_obs.auditor.name,
        auditor_email=finalised_obs.auditor.email,
        school=finalised_obs.school,
        grade=f"{finalised_obs.grade} {finalised_obs.section}",
        app_url=settings.APP_URL,
    )
    finalised_obs.email_sent = True
    db.commit()
    return finalised_obs


@app.delete("/api/observations/{id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_observation_route(
    id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs = crud.get_observation_by_id(db, id)
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    if obs.auditor_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only delete audits done by you")
    if not obs.is_draft:
        raise HTTPException(status_code=400, detail="Only draft observations can be deleted")
    crud.delete_observation(db, id)
    return None


@app.post("/api/observations/{id}/remarks", response_model=schemas.ObservationOut)
async def save_remarks(
    id: int,
    remarks_in: schemas.ObservationTeacherRemarks,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # Authorize by "are you the observed teacher on this record" (teacher_id), not by role —
    # a teaching SME/coordinator is observed as a teacher and must be able to add remarks too.
    obs = crud.get_observation_by_id(db, id)
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    if obs.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only write remarks for your own observations")
    if obs.is_draft:
        raise HTTPException(status_code=400, detail="Cannot add remarks to a draft observation")

    updated_obs = crud.save_teacher_remarks(db, id, remarks_in)

    background_tasks.add_task(
        email_service.send_remarks_notification,
        auditor_email=updated_obs.auditor.email,
        auditor_name=updated_obs.auditor.name,
        teacher_name=current_user.name,
        teacher_email=current_user.email,
        school=updated_obs.school,
        grade=f"{updated_obs.grade} {updated_obs.section}",
        app_url=f"{settings.APP_URL}/?page=dashboard",
    )
    return updated_obs


@app.get("/api/observations/{obs_id}", response_model=schemas.ObservationOut)
async def get_single_observation(
    obs_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    obs = crud.get_observation_by_id(db, obs_id)
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    # The observed teacher can always see their own report — including a teaching SME being
    # observed (their own id is the teacher_id even though their role is 'sme').
    if current_user.id == obs.teacher_id:
        return obs
    if current_user.role == "teacher":
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == "sme":
        assigned = db.query(models.TeacherSME).filter_by(
            teacher_id=obs.teacher_id, sme_id=current_user.id
        ).first()
        if not assigned:
            raise HTTPException(status_code=403, detail="Access denied")
    return obs


@app.get("/api/observations/teacher/{teacher_id}", response_model=List[schemas.ObservationOut])
async def get_teacher_observations(
    teacher_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    # A user can always fetch their OWN received (finalised) observations — covers a teaching
    # SME/coordinator viewing reports where they are the observed teacher, not the observer.
    if current_user.id == teacher_id:
        return crud.get_observations_for_teacher(db, teacher_id, include_drafts=False)
    if current_user.role == "teacher":
        if current_user.id != teacher_id:
            raise HTTPException(status_code=403, detail="Access denied to other teacher reports")
        return crud.get_observations_for_teacher(db, teacher_id, include_drafts=False)
    elif current_user.role == "auditor":
        return crud.get_teacher_full_history(db, teacher_id)
    elif current_user.role == "sme":
        assigned = db.query(models.TeacherSME).filter_by(
            teacher_id=teacher_id, sme_id=current_user.id
        ).first()
        if not assigned:
            raise HTTPException(status_code=403, detail="Unauthorized access for this teacher")
        return crud.get_teacher_full_history(db, teacher_id)
    raise HTTPException(status_code=403, detail="Unauthorized role")


@app.get("/api/dashboard", response_model=List[schemas.TeacherSummary])
async def get_dashboard(
    location: str = Query("Kodathi"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    sme_id = current_user.id if current_user.role == "sme" else None
    return crud.get_dashboard_teachers(db, location, sme_id)


@app.post("/api/dashboard/compare")
async def compare_teacher_progress(
    req: schemas.ProgressComparisonRequest,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    teacher = crud.get_user_by_id(db, req.teacher_id)
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    if current_user.role == "sme":
        assigned = db.query(models.TeacherSME).filter_by(
            teacher_id=req.teacher_id, sme_id=current_user.id
        ).first()
        if not assigned:
            raise HTTPException(status_code=403, detail="This teacher is not assigned to you")

    history = db.query(models.Observation).options(
        joinedload(models.Observation.auditor),
    ).filter(
        models.Observation.teacher_id == req.teacher_id,
        models.Observation.is_draft == False,
    ).order_by(models.Observation.date_time.asc()).all()

    if len(history) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 observations to compare.")

    history_list = [
        {
            "date_time": obs.date_time,
            "auditor_name": obs.auditor.name,
            "overall_score": obs.overall_score,
            "domain1_score": obs.domain1_score,
            "domain2_score": obs.domain2_score,
            "domain3_score": obs.domain3_score,
            "rating": obs.rating,
            "ai_feedback": obs.ai_feedback,
        }
        for obs in history
    ]

    comparison = await ai_service.generate_progress_comparison(teacher.name, history_list)
    return {"success": True, "comparison": comparison}


# --- IMAGE UPLOAD ---

from pydantic import BaseModel as PydanticBase

class ImageLinkIn(PydanticBase):
    drive_link: str

@app.post("/api/observations/{id}/images", response_model=schemas.ObservationImageOut)
async def add_observation_image_link(
    id: int,
    body: ImageLinkIn,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs = crud.get_observation_by_id(db, id)
    if not obs:
        raise HTTPException(status_code=404, detail="Observation not found")
    if obs.auditor_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only add images to audits done by you")
    return crud.add_observation_image(db, id, body.drive_link)


# --- SPA (SPORTS / PERFORMING ARTS) OBSERVATION ROUTES ---

@app.post("/api/spa-observations", response_model=schemas.SpaObservationOut)
async def submit_spa_observation(
    obs_in: schemas.SpaObservationCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    teacher = crud.get_user_by_id(db, obs_in.teacher_id)
    if not teacher or not crud.is_spa_coach_eligible(teacher):
        raise HTTPException(status_code=400, detail="Invalid SPA coach selected")
    obs = crud.create_spa_observation(db, obs_in, current_user.id)
    if not obs:
        raise HTTPException(status_code=500, detail="Failed to create SPA observation")
    return obs


@app.put("/api/spa-observations/{id}/draft", response_model=schemas.SpaObservationOut)
async def update_spa_draft(
    id: int,
    update: schemas.SpaObservationDraftUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs = crud.get_spa_observation_by_id(db, id)
    if not obs:
        raise HTTPException(status_code=404, detail="SPA observation not found")
    if obs.auditor_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only edit audits done by you")
    if not obs.is_draft:
        raise HTTPException(status_code=400, detail="Cannot edit a finalised observation")
    return crud.update_spa_observation_draft(db, id, update)


@app.post("/api/spa-observations/{id}/finalise", response_model=schemas.SpaObservationOut)
async def finalise_spa_observation_route(
    id: int,
    body: schemas.SpaObservationFinalise,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs = crud.get_spa_observation_by_id(db, id)
    if not obs:
        raise HTTPException(status_code=404, detail="SPA observation not found")
    if obs.auditor_id != current_user.id:
        raise HTTPException(status_code=403, detail="You can only finalise audits done by you")
    if not obs.is_draft:
        raise HTTPException(status_code=400, detail="Observation is already finalised")
    if not body.ch_name.strip() or not body.ch_date:
        raise HTTPException(status_code=400, detail="Curriculum Head name and date are required to finalise")

    finalised_obs = crud.finalise_spa_observation(db, id, body)

    background_tasks.add_task(
        email_service.send_spa_audit_notification,
        teacher_email=finalised_obs.teacher.email,
        teacher_name=finalised_obs.teacher.name,
        auditor_name=finalised_obs.auditor.name,
        auditor_email=finalised_obs.auditor.email,
        school=finalised_obs.school,
        activity=finalised_obs.activity,
        app_url=settings.APP_URL,
    )
    finalised_obs.email_sent = True
    db.commit()
    return finalised_obs


@app.get("/api/spa-observations/{obs_id}", response_model=schemas.SpaObservationOut)
async def get_single_spa_observation(
    obs_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    obs = crud.get_spa_observation_by_id(db, obs_id)
    if not obs:
        raise HTTPException(status_code=404, detail="SPA observation not found")
    if current_user.id == obs.teacher_id:
        return obs
    if current_user.role == "teacher":
        raise HTTPException(status_code=403, detail="Access denied")
    if current_user.role == "sme":
        assigned = db.query(models.TeacherSME).filter_by(
            teacher_id=obs.teacher_id, sme_id=current_user.id
        ).first()
        if not assigned:
            raise HTTPException(status_code=403, detail="Access denied")
    return obs


@app.get("/api/spa-observations/teacher/{teacher_id}", response_model=List[schemas.SpaObservationOut])
async def get_teacher_spa_observations(
    teacher_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.id == teacher_id:
        return crud.get_spa_observations_for_teacher(db, teacher_id, include_drafts=False)
    if current_user.role == "teacher":
        if current_user.id != teacher_id:
            raise HTTPException(status_code=403, detail="Access denied to other teacher reports")
        return crud.get_spa_observations_for_teacher(db, teacher_id, include_drafts=False)
    elif current_user.role == "auditor":
        return crud.get_spa_teacher_full_history(db, teacher_id)
    elif current_user.role == "sme":
        assigned = db.query(models.TeacherSME).filter_by(
            teacher_id=teacher_id, sme_id=current_user.id
        ).first()
        if not assigned:
            raise HTTPException(status_code=403, detail="Unauthorized access for this teacher")
        return crud.get_spa_teacher_full_history(db, teacher_id)
    raise HTTPException(status_code=403, detail="Unauthorized role")


@app.get("/api/spa-dashboard/audit-list")
async def get_spa_audit_list_route(
    location: str = Query("Kodathi"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    sme_id = current_user.id if current_user.role == "sme" else None
    return crud.get_spa_audit_list(db, location, sme_id)


@app.get("/api/dashboard/filter-options")
async def get_dashboard_filter_options(
    location: str = Query("Kodathi"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    return crud.get_dashboard_filter_options(db, location)


@app.get("/api/dashboard/audit-list")
async def get_audit_list(
    location: str = Query("Kodathi"),
    subject: Optional[str] = Query(None),
    grade: Optional[str] = Query(None),
    auditor_id: Optional[int] = Query(None),
    teacher_id: Optional[int] = Query(None),
    status: Optional[str] = Query(None, description="'draft', 'saved', or omitted for all"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs_query = db.query(models.Observation).options(
        joinedload(models.Observation.teacher),
        joinedload(models.Observation.auditor),
    ).filter(models.Observation.school == location)
    if current_user.role == "sme":
        assigned_ids = db.query(models.TeacherSME.teacher_id).filter(
            models.TeacherSME.sme_id == current_user.id
        ).subquery()
        obs_query = obs_query.filter(models.Observation.teacher_id.in_(assigned_ids))
    if subject:
        obs_query = obs_query.filter(models.Observation.subject == subject)
    if grade:
        obs_query = obs_query.filter(models.Observation.grade == grade)
    if auditor_id:
        obs_query = obs_query.filter(models.Observation.auditor_id == auditor_id)
    if teacher_id:
        obs_query = obs_query.filter(models.Observation.teacher_id == teacher_id)
    if status == "draft":
        obs_query = obs_query.filter(models.Observation.is_draft == True)
    elif status == "saved":
        obs_query = obs_query.filter(models.Observation.is_draft == False)
    observations = obs_query.order_by(models.Observation.date_time.desc()).all()
    return [
        {
            "id": obs.id,
            "teacher_id": obs.teacher_id,
            "teacher_name": obs.teacher.name,
            "auditor_name": obs.auditor.name,
            "subject": obs.subject,
            "grade": obs.grade,
            "section": obs.section,
            "observation_type": obs.observation_type or "Unannounced",
            "date_time": crud.utc_iso(obs.date_time),
            "overall_score": obs.overall_score,
            "domain1_score": obs.domain1_score,
            "domain2_score": obs.domain2_score,
            "domain3_score": obs.domain3_score,
            "p34": obs.p34,
            "rating": obs.rating,
            "is_draft": obs.is_draft,
        }
        for obs in observations
    ]


@app.get("/api/dashboard/subject-summary")
async def get_subject_summary(
    location: str = Query("Kodathi"),
    subject: str = Query(...),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_role(["auditor", "sme"])),
):
    obs_query = db.query(models.Observation).options(
        joinedload(models.Observation.teacher),
    ).filter(
        models.Observation.school == location,
        models.Observation.subject == subject,
        models.Observation.is_draft == False,
    )
    if current_user.role == "sme":
        assigned_ids = db.query(models.TeacherSME.teacher_id).filter(
            models.TeacherSME.sme_id == current_user.id
        ).subquery()
        obs_query = obs_query.filter(models.Observation.teacher_id.in_(assigned_ids))
    observations = obs_query.order_by(models.Observation.date_time.desc()).all()

    teacher_data = {}
    for obs in observations:
        t_id = obs.teacher_id
        if t_id not in teacher_data:
            teacher_data[t_id] = {
                "teacher_id": t_id,
                "teacher_name": obs.teacher.name,
                "scores": [], "d1_scores": [], "d2_scores": [], "d3_scores": [],
                "obs_count": 0,
                "latest_rating": obs.rating,
            }
        teacher_data[t_id]["scores"].append(obs.overall_score)
        teacher_data[t_id]["d1_scores"].append(obs.domain1_score)
        teacher_data[t_id]["d2_scores"].append(obs.domain2_score)
        teacher_data[t_id]["d3_scores"].append(obs.domain3_score)
        teacher_data[t_id]["obs_count"] += 1

    result = []
    for t_id, data in teacher_data.items():
        avg = lambda k: round(sum(data[k]) / len(data[k]), 1)
        result.append({
            "teacher_id": data["teacher_id"],
            "teacher_name": data["teacher_name"],
            "avg_score": avg("scores"),
            "domain1_avg": avg("d1_scores"),
            "domain2_avg": avg("d2_scores"),
            "domain3_avg": avg("d3_scores"),
            "obs_count": data["obs_count"],
            "scores": data["scores"],
            "latest_rating": data["latest_rating"],
        })
    result.sort(key=lambda x: x["avg_score"], reverse=True)
    return result


@app.get("/api/dashboard/sme-activity")
async def get_sme_activity(
    location: str = Query("Kodathi"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_leadership),
):
    return crud.get_leadership_sme_stats(db, location)


@app.get("/api/dashboard/observation-coverage")
async def get_observation_coverage(
    location: str = Query("Kodathi"),
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.require_leadership),
):
    return crud.get_teacher_observation_coverage(db, location)


@app.get("/api/alerts")
async def get_alerts(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(auth.get_current_user),
):
    if current_user.role in ["auditor", "sme"]:
        drafts = db.query(models.Observation).options(
            joinedload(models.Observation.teacher),
        ).filter(
            models.Observation.auditor_id == current_user.id,
            models.Observation.is_draft == True
        ).all()
        return {
            "type": "auditor",
            "items": [
                {
                    "id": o.id,
                    "teacher_name": o.teacher.name,
                    "subject": o.subject,
                    "date": o.date_time.strftime("%d %b %Y"),
                }
                for o in drafts
            ],
        }
    elif current_user.role == "teacher":
        pending = db.query(models.Observation).filter(
            models.Observation.teacher_id == current_user.id,
            models.Observation.is_draft == False,
            models.Observation.remarks_saved == False
        ).all()
        return {
            "type": "teacher",
            "items": [
                {
                    "id": o.id,
                    "subject": o.subject,
                    "date": o.date_time.strftime("%d %b %Y"),
                }
                for o in pending
            ],
        }
    return {"type": "none", "items": []}


@app.get("/api/health")
async def health_check():
    return {"status": "ok"}
