import logging
import re
import time
from fastapi import FastAPI, Depends, HTTPException, Request, status, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import httpx

from .config import settings
from .database import engine, Base, get_db, run_migrations
from . import models, schemas, crud, auth, excel_import, scheduler, rules as rules_module

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger("timetable")

Base.metadata.create_all(bind=engine)
run_migrations()

app = FastAPI(title="Timetable Generator API", version="1.0.0")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Every request logged with its outcome and how long it took - this
    shows up in the terminal running uvicorn, so a slow or stuck request is
    visible immediately instead of just a spinner with no information."""
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


# --- AUTH ---

@app.post("/api/auth/sso", response_model=schemas.SSOResponse)
async def sso_login(req: schemas.SSORequest, db: Session = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{settings.SUPABASE_URL}/auth/v1/user",
            headers={
                "Authorization": f"Bearer {req.supabase_token}",
                "apikey": settings.SUPABASE_ANON_KEY,
            },
            timeout=10,
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid SSO token")

    supabase_user = resp.json()
    email = (supabase_user.get("email") or "").strip()
    if not email.lower().endswith("@harvestinternationalschool.in"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Unauthorized domain")

    user = db.query(models.User).filter(models.User.email.ilike(email)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found in system")

    access_level = "leadership" if auth.designation_is_leadership(user.designation) else "view"
    teacher = crud.get_teacher_by_email(db, email)
    teacher_id = teacher.id if teacher else None

    token = auth.create_access_token(data={
        "sub": user.email, "access_level": access_level, "role": user.role, "name": user.name,
        "designation": user.designation, "teacher_id": teacher_id,
    })
    return {
        "access_token": token, "token_type": "bearer", "access_level": access_level, "role": user.role,
        "name": user.name, "email": user.email, "designation": user.designation,
        "teacher_id": teacher_id,
    }


# --- IMPORT ---

@app.post("/api/import/preview")
async def import_preview(
    workbook: UploadFile = File(...),
    timing_text: str = Form(...),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    logger.info("import/preview: parsing %s", workbook.filename)
    xlsx_bytes = await workbook.read()
    start = time.time()
    try:
        parsed = excel_import.parse_workbook(xlsx_bytes, timing_text)
    except Exception as exc:
        logger.exception("import/preview: parse failed")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not parse workbook: {exc}")
    logger.info(
        "import/preview: parsed %d grades, %d warnings in %.2fs",
        len(parsed["grades"]), len(parsed["warnings"]), time.time() - start,
    )
    return parsed


@app.post("/api/import/commit")
def import_commit(
    req: schemas.ImportCommitRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    if req.rules_text and req.rules_text.strip():
        try:
            rules_module.parse_rules_text(req.rules_text)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not parse rules.txt: {exc}")

    logger.info("import/commit: label=%s location=%s starting (this writes ~1000+ rows, can take a while)", req.label, req.location)
    start = time.time()
    year = crud.commit_import(db, req.label, req.location, req.parsed, req.rules_text)
    logger.info("import/commit: academic_year_id=%d committed in %.2fs", year.id, time.time() - start)
    return {"academic_year_id": year.id, "label": year.label, "location": year.location}


# --- ACADEMIC YEARS / GRADES ---

@app.get("/api/academic-years/active")
def get_active_year(
    location: str = Query("Kodathi"),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.get_current_user),
):
    year = crud.get_active_academic_year(db, location)
    if not year:
        return None
    grades = db.query(models.Grade).filter(models.Grade.academic_year_id == year.id).order_by(models.Grade.order_index).all()
    timing = db.query(models.TimingConfig).filter(models.TimingConfig.academic_year_id == year.id).first()
    return {
        "id": year.id,
        "label": year.label,
        "location": year.location,
        "grades": [
            {
                "id": g.id, "name": g.name,
                "sections": [
                    {"id": s.id, "name": s.name, "class_teacher_name": s.class_teacher.name if s.class_teacher else None}
                    for s in sorted(g.sections, key=lambda s: s.name)
                ],
            }
            for g in grades
        ],
        "timing": {
            "class_teacher_start": timing.class_teacher_start,
            "class_teacher_end": timing.class_teacher_end,
            "periods_per_day": timing.periods_per_day,
            "schedule": timing.schedule,
        } if timing else None,
    }


@app.post("/api/academic-years/{academic_year_id}/generate")
def generate_timetable(
    academic_year_id: int,
    sections: str = Query(None, description="Space/comma separated section tokens like '6A 6F 7C' - omit for all"),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    section_ids = None
    if sections and sections.strip():
        tokens = re.split(r"[,\s]+", sections.strip())
        try:
            section_ids = crud.resolve_section_tokens(db, academic_year_id, tokens)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    logger.info(
        "generate: academic_year_id=%d scope=%s starting",
        academic_year_id, f"{len(section_ids)} section(s)" if section_ids is not None else "whole year",
    )
    start = time.time()
    result = scheduler.generate(db, academic_year_id, section_ids=section_ids)
    logger.info("generate: placed %d periods in %.2fs, computing gaps...", result["placed_count"], time.time() - start)

    gaps_start = time.time()
    gaps = crud.get_gaps(db, academic_year_id)
    logger.info("generate: %d gaps found in %.2fs", len(gaps), time.time() - gaps_start)
    return {"placed_count": result["placed_count"], "gaps": gaps}


@app.post("/api/academic-years/{academic_year_id}/generate-selected")
def generate_selected(
    academic_year_id: int,
    req: schemas.GenerateSelectedRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    targets = [(t.section_id, t.gsp_id) for t in req.targets]
    logger.info("generate-selected: academic_year_id=%d fixing %d selected gap(s)", academic_year_id, len(targets))
    start = time.time()
    result = scheduler.generate_selected(db, academic_year_id, targets)
    logger.info("generate-selected: placed %d periods in %.2fs", result["placed_count"], time.time() - start)
    gaps = crud.get_gaps(db, academic_year_id)
    return {"placed_count": result["placed_count"], "gaps": gaps}


@app.post("/api/academic-years/{academic_year_id}/save-timetable")
def save_timetable(
    academic_year_id: int,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    locked = crud.lock_timetable(db, academic_year_id)
    logger.info("save-timetable: academic_year_id=%d locked %d slot(s) as manual", academic_year_id, locked)
    return {"locked": locked}


@app.get("/api/academic-years/{academic_year_id}/gaps")
def get_gaps(
    academic_year_id: int,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    start = time.time()
    gaps = crud.get_gaps(db, academic_year_id)
    logger.info("gaps: academic_year_id=%d found %d in %.2fs", academic_year_id, len(gaps), time.time() - start)
    return gaps


# --- TIMETABLE ---

@app.get("/api/timetable/section/{section_id}")
def get_section_timetable(
    section_id: int,
    academic_year_id: int = Query(...),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.get_current_user),
):
    result = crud.get_section_timetable(db, academic_year_id, section_id)
    if result is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Section not found")
    return result


@app.get("/api/timetable/teacher/{teacher_id}")
def get_teacher_week_for_leadership(
    teacher_id: int,
    academic_year_id: int = Query(...),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    return crud.get_teacher_week(db, academic_year_id, teacher_id)


@app.get("/api/timetable/my-week")
def get_my_week(
    academic_year_id: int = Query(...),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    if not current_user.teacher_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No linked teacher profile for this account")
    return crud.get_teacher_week(db, academic_year_id, current_user.teacher_id)


@app.patch("/api/timetable/slot")
def patch_slot(
    body: schemas.SlotPatchRequest,
    academic_year_id: int = Query(...),
    section_id: int = Query(...),
    day_of_week: int = Query(...),
    period_number: int = Query(...),
    force: bool = Query(False),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        result = crud.set_slot(
            db, academic_year_id, section_id, day_of_week, period_number,
            body.section_subject_teacher_ids, force=force,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return result


# --- TEACHERS ---

@app.get("/api/teachers", response_model=list[schemas.TeacherOut])
def list_teachers(
    location: str = Query(None),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    return crud.list_teachers(db, location)


@app.patch("/api/teachers/{teacher_id}/linked-email", response_model=schemas.TeacherOut)
def link_teacher_email(
    teacher_id: int,
    req: schemas.TeacherLinkEmailRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    teacher = crud.set_teacher_linked_email(db, teacher_id, req.linked_email)
    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")
    return teacher


@app.patch("/api/teachers/{teacher_id}", response_model=schemas.TeacherOut)
def update_teacher(
    teacher_id: int,
    req: schemas.TeacherUpdateRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    teacher = crud.update_teacher(db, teacher_id, name=req.name, linked_email=req.linked_email)
    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")
    return teacher


@app.delete("/api/teachers/{teacher_id}")
def delete_teacher(
    teacher_id: int,
    merge_into: int = Query(None),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        crud.delete_or_merge_teacher(db, teacher_id, merge_into_id=merge_into)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"ok": True}


@app.patch("/api/sections/{section_id}/class-teacher")
def set_class_teacher(
    section_id: int,
    req: schemas.SetTeacherRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        crud.set_class_teacher(db, section_id, req.teacher_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"ok": True}


@app.get("/api/sections/{section_id}/subject-slots")
def get_section_subject_slots(
    section_id: int,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    return crud.get_section_subject_slots(db, section_id)


@app.patch("/api/section-subject-teachers/{sst_id}")
def set_sst_teacher(
    sst_id: int,
    req: schemas.SetTeacherRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        crud.set_sst_teacher(db, sst_id, req.teacher_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"ok": True}
