import logging
import re
import time
from datetime import datetime
from fastapi import FastAPI, Depends, HTTPException, Request, status, UploadFile, File, Form, Query
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import httpx

from .config import settings
from .database import engine, Base, get_db, run_migrations
from . import (
    models, schemas, crud, auth, excel_import, scheduler, rules as rules_module,
    substitution as substitution_module, timetable_workbook,
)

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


@app.post("/api/import/preview-timetable-export")
async def import_preview_timetable_export(
    workbook: UploadFile = File(...),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    """Alternative to /import/preview: reads an already-generated timetable
    export (class-wise grid, one section after another) instead of a
    WORK ALLOTMENT allocation workbook - see app/timetable_workbook.py. The
    response matches /import/preview's shape (grades/timing/warnings) plus a
    "lessons" array, so the same ImportView summary UI and /import/commit
    endpoint handle both import paths."""
    logger.info("import/preview-timetable-export: parsing %s", workbook.filename)
    xlsx_bytes = await workbook.read()
    start = time.time()
    try:
        parsed = timetable_workbook.parse_generated_workbook(xlsx_bytes)
    except Exception as exc:
        logger.exception("import/preview-timetable-export: parse failed")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not parse timetable export: {exc}")
    logger.info(
        "import/preview-timetable-export: parsed %d grades, %d lessons, %d warnings in %.2fs",
        len(parsed["grades"]), len(parsed["lessons"]), len(parsed["warnings"]), time.time() - start,
    )
    return parsed


@app.post("/api/import/preview-teacher-details")
async def import_preview_teacher_details(
    workbook: UploadFile = File(...),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    """Optional companion to the "Generated timetable export" import mode:
    reads a Name/Email/Class Teacher (/Allocation/Subject, ignored) roster
    sheet - see timetable_workbook.parse_teacher_details_sheet(). Everything
    else about a teacher is already derived from the timetable itself; this
    only supplies the two things that isn't in - email and class-teacher."""
    logger.info("import/preview-teacher-details: parsing %s", workbook.filename)
    xlsx_bytes = await workbook.read()
    try:
        parsed = timetable_workbook.parse_teacher_details_sheet(xlsx_bytes)
    except Exception as exc:
        logger.exception("import/preview-teacher-details: parse failed")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not parse teacher details sheet: {exc}")
    logger.info("import/preview-teacher-details: parsed %d teacher(s), %d warnings", len(parsed["details"]), len(parsed["warnings"]))
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

    if req.lessons:
        place_start = time.time()
        result = crud.place_generated_slots(db, year.id, req.lessons)
        logger.info(
            "import/commit: placed %d lesson(s) as manual-override slots (%d skipped, no matching section/assignment) in %.2fs",
            result["placed"], result["skipped"], time.time() - place_start,
        )

    teacher_details_warnings = []
    if req.teacher_details:
        details_result = crud.apply_teacher_details(db, year.id, req.location, req.teacher_details)
        teacher_details_warnings = details_result["warnings"]
        logger.info(
            "import/commit: teacher details applied - %d email(s), %d class-teacher(s), %d warning(s)",
            details_result["updated_email"], details_result["updated_class_teacher"], len(teacher_details_warnings),
        )

    return {
        "academic_year_id": year.id, "label": year.label, "location": year.location,
        "teacher_details_warnings": teacher_details_warnings,
    }


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


@app.get("/api/academic-years/{academic_year_id}/subjects")
def list_subjects(
    academic_year_id: int,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    return crud.list_subjects(db, academic_year_id)


@app.get("/api/academic-years")
def list_academic_years(
    location: str = Query("Kodathi"),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    return crud.list_academic_years(db, location)


@app.post("/api/academic-years/{academic_year_id}/activate")
def activate_academic_year(
    academic_year_id: int,
    location: str = Query(...),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        return crud.activate_academic_year(db, academic_year_id, location)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.post("/api/academic-years/{academic_year_id}/deactivate")
def deactivate_academic_year(
    academic_year_id: int,
    location: str = Query(...),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        return crud.deactivate_academic_year(db, academic_year_id, location)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.delete("/api/academic-years/{academic_year_id}")
def delete_academic_year(
    academic_year_id: int,
    location: str = Query(...),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        crud.delete_academic_year(db, academic_year_id, location)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))
    return {"ok": True}


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


@app.post("/api/teachers", response_model=schemas.TeacherOut)
def create_teacher(
    req: schemas.TeacherCreateRequest,
    location: str = Query(...),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        return crud.create_teacher(db, req.name, location, req.linked_email)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


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


@app.post("/api/sections/{section_id}/subject-slots")
def add_subject_slot(
    section_id: int,
    req: schemas.SubjectSlotCreateRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        return crud.add_subject_slot(
            db, section_id, req.subject_name, req.periods_per_week, req.component_label, req.teacher_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


@app.patch("/api/subjects/{subject_id}")
def rename_subject(
    subject_id: int,
    req: schemas.SubjectRenameRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        return crud.rename_subject(db, subject_id, req.raw_name)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))


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


# --- SUBSTITUTION ---

@app.post("/api/substitution/suggest")
def substitution_suggest(
    req: schemas.SubstitutionSuggestRequest,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        date_obj = datetime.strptime(req.date, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="date must be in YYYY-MM-DD format")
    day_of_week = date_obj.weekday()
    if day_of_week > 4:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That date is a weekend - no periods to substitute")

    teacher = db.query(models.Teacher).filter(models.Teacher.id == req.absent_teacher_id).first()
    if not teacher:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Teacher not found")
    absent_name = teacher.name
    lessons = crud.get_all_lessons(db, req.academic_year_id)
    all_names = crud.list_active_teacher_names(db, teacher.location)

    periods = substitution_module.compute_suggestions(lessons, absent_name, day_of_week, all_names)
    return {
        "day_of_week": day_of_week, "day_name": crud.DAY_NAMES[day_of_week],
        "absent_teacher_name": absent_name, "periods": periods,
    }


@app.post("/api/substitutions")
def create_substitution(
    req: schemas.SubstitutionCreateRequest,
    db: Session = Depends(get_db),
    user: auth.CurrentUser = Depends(auth.require_leadership),
):
    data = req.dict()
    data["created_by_name"] = user.name
    return crud.create_substitution(db, data)


@app.get("/api/substitutions")
def get_substitutions(
    academic_year_id: int = Query(...),
    date: str = Query(None),
    teacher_name: str = Query(None),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    return crud.list_substitutions(db, academic_year_id, date=date, teacher_name=teacher_name)


@app.delete("/api/substitutions/{substitution_id}")
def delete_substitution(
    substitution_id: int,
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_leadership),
):
    try:
        crud.delete_substitution(db, substitution_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc))
    return {"ok": True}
