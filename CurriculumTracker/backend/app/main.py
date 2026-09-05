import logging
import time
import httpx
from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException, Request, status, Query, File, Form, UploadFile
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

from .config import settings
from .database import engine, Base, get_db, run_migrations
from . import models, schemas, crud, auth, excel_import, overview_export, staff_directory, email_service_resend

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

def _app_role_for(user: models.User) -> str:
    """Teacher | SME | Leadership, from the shared users table. Shared by the
    SSO exchange and "View as" so a previewed session resolves exactly the
    same role the real person would get by logging in."""
    is_sme = auth.role_is_sme(user.role, user.designation)
    # role='auditor' is the shared marker for every real leadership account
    # (APM, Principal, Vice Principal, Curriculum Head, Managing Director,
    # Coordinator) in the shared users table — checked first since designation
    # wording alone was found to miss real accounts (the bug just fixed in the
    # Apps Script version of this app).
    is_leadership = not is_sme and (auth.role_is_leadership(user.role) or auth.designation_is_leadership(user.designation))
    return "SME" if is_sme else ("Leadership" if is_leadership else "Teacher")


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

    app_role = _app_role_for(user)

    if not user.subject and app_role != "Leadership":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This app is for subject teachers and Subject Matter Experts for POW and TBS discussions. If you believe this is a mistake, please contact your administrator.",
        )

    token = auth.create_access_token(data={
        "sub": user.email, "role": app_role, "name": user.name,
        "designation": user.designation, "subject": user.subject,
    })
    return {
        "access_token": token, "token_type": "bearer", "role": app_role,
        "name": user.name, "email": user.email, "designation": user.designation,
        "subject": user.subject, "location": user.location,
        "can_view_as": auth.can_view_as(user.email, user.designation),
        "can_upload_curriculum": auth.can_upload_curriculum(
            auth.CurrentUser(user.email, user.name, user.designation, user.subject, app_role),
            crud.curriculum_uploader_emails(db),
        ),
        "can_see_lagging": crud.can_see_lagging(app_role, user.designation),
        "can_create_pow": auth.can_author_pow(
            auth.CurrentUser(user.email, user.name, user.designation, user.subject, app_role),
            crud.pow_author_emails(db),
        ),
        "can_see_overview": auth.can_see_curriculum_overview(
            auth.CurrentUser(user.email, user.name, user.designation, user.subject, app_role)
        ),
        "can_mark_coverage": auth.can_mark_coverage(
            auth.CurrentUser(user.email, user.name, user.designation, user.subject, app_role)
        ),
        "can_oversee": auth.can_oversee_curriculum(
            auth.CurrentUser(user.email, user.name, user.designation, user.subject, app_role)
        ),
        "branches": crud.branches_for_viewer(user.location, auth.can_mark_coverage(
            auth.CurrentUser(user.email, user.name, user.designation, user.subject, app_role))),
    }


@app.get("/api/me", response_model=schemas.MeResponse)
def get_me(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """Current identity and capabilities, recomputed from the database.

    The frontend caches the user object in localStorage at login, so a session
    opened before a capability existed would otherwise keep a stale copy until
    the next portal login — which is exactly how the Curriculum Upload button
    went missing for accounts that already had a session. The app calls this on
    mount and refreshes what it stored.
    """
    user = db.query(models.User).filter(models.User.email.ilike(current_user.email)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Your account is no longer registered.")

    app_role = _app_role_for(user)
    resolved = auth.CurrentUser(user.email, user.name, user.designation, user.subject, app_role)

    # A teacher's stored subject first, then anything else staff_roles says
    # they teach — the portal's users.subject holds only one, but plenty of
    # teachers have two (Science and English, Maths and Computer Science).
    subjects = [user.subject] if user.subject else []
    for s in staff_directory.subjects_for(user.email):
        if s.lower() not in [x.lower() for x in subjects]:
            subjects.append(s)
    # ...and anything they are recorded as teaching in class_teachers, which
    # may be a subject their profile does not name.
    for s in crud.extra_subjects_for(db, user.email):
        if s.lower() not in [x.lower() for x in subjects]:
            subjects.append(s)
    # A third language is its own planner subject ("Hindi (R3)"), and
    # staff_roles only ever says "Hindi" - offer the levels to the teachers of
    # the base subject so they can file against them.
    for s in crud.subject_variants(db, subjects):
        if s.lower() not in [x.lower() for x in subjects]:
            subjects.append(s)

    return {
        "role": app_role, "name": user.name, "email": user.email,
        "designation": user.designation, "subject": user.subject,
        "subjects": subjects, "location": user.location,
        # No chained impersonation: a previewed session can't switch onward.
        "can_view_as": auth.can_view_as(user.email, user.designation) and not current_user.view_as_actor,
        "can_upload_curriculum": auth.can_upload_curriculum(resolved, crud.curriculum_uploader_emails(db)),
        "can_see_lagging": crud.can_see_lagging(app_role, user.designation),
        "can_create_pow": auth.can_author_pow(resolved, crud.pow_author_emails(db)),
        "can_see_overview": auth.can_see_curriculum_overview(resolved),
        "can_mark_coverage": auth.can_mark_coverage(resolved),
        "can_oversee": auth.can_oversee_curriculum(resolved),
        # Campuses this account may look at - both for anyone who owns a
        # subject across the school, otherwise their own.
        "branches": crud.branches_for_viewer(user.location, auth.can_mark_coverage(resolved)),
    }


# ─── View as (preview the app as another staff member) ───────────────────────

@app.get("/api/staff/search", response_model=schemas.StaffSearchResponse)
def search_staff(
    q: str = Query("", min_length=0, max_length=100),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.require_view_as),
):
    """Staff picker for the View as switcher — name or email substring."""
    query = db.query(models.User)
    term = q.strip()
    if term:
        like = f"%{term}%"
        query = query.filter(models.User.name.ilike(like) | models.User.email.ilike(like))
    users = query.order_by(models.User.name).limit(20).all()
    return {"staff": [
        {"email": u.email, "name": u.name, "designation": u.designation,
         "subject": u.subject, "role": _app_role_for(u)}
        for u in users
    ]}


@app.post("/api/auth/view-as", response_model=schemas.SSOResponse)
def view_as(
    req: schemas.ViewAsRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_view_as),
):
    """Mints a session for another staff member. The previewed session is a
    real session — anything saved during it is attributed to that person, not
    to the previewer (the same trade-off as Attendance's View as switcher),
    which is exactly what makes it useful for checking a teacher's or SME's
    view. Every mint is logged with both identities."""
    target = db.query(models.User).filter(models.User.email.ilike(req.email.strip())).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No staff account with that email.")

    app_role = _app_role_for(target)
    if not target.subject and app_role != "Leadership":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"{target.name} has no subject set, so they can't use this app — nothing to preview.",
        )

    logger.warning("VIEW AS: %s is now previewing the app as %s (%s, %s)",
                   current_user.email, target.email, app_role, target.subject or "no subject")

    token = auth.create_access_token(data={
        "sub": target.email, "role": app_role, "name": target.name,
        "designation": target.designation, "subject": target.subject,
        "view_as_actor": current_user.email,
    })
    return {
        "access_token": token, "token_type": "bearer", "role": app_role,
        "name": target.name, "email": target.email, "designation": target.designation,
        "subject": target.subject, "location": target.location,
        "can_view_as": False,  # no chained impersonation — reset to yourself first
        "can_upload_curriculum": auth.can_upload_curriculum(
            auth.CurrentUser(target.email, target.name, target.designation, target.subject, app_role),
            crud.curriculum_uploader_emails(db),
        ),
        "can_see_lagging": crud.can_see_lagging(app_role, target.designation),
        "can_create_pow": auth.can_author_pow(
            auth.CurrentUser(target.email, target.name, target.designation, target.subject, app_role),
            crud.pow_author_emails(db),
        ),
        "can_see_overview": auth.can_see_curriculum_overview(
            auth.CurrentUser(target.email, target.name, target.designation, target.subject, app_role)
        ),
        "can_mark_coverage": auth.can_mark_coverage(
            auth.CurrentUser(target.email, target.name, target.designation, target.subject, app_role)
        ),
        "can_oversee": auth.can_oversee_curriculum(
            auth.CurrentUser(target.email, target.name, target.designation, target.subject, app_role)
        ),
        "branches": crud.branches_for_viewer(target.location, auth.can_mark_coverage(
            auth.CurrentUser(target.email, target.name, target.designation, target.subject, app_role))),
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


# ─── Curriculum upload (SMEs + curriculum admins) ────────────────────────────

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


@app.get("/api/planner/inventory", response_model=schemas.PlannerInventoryResponse)
def planner_inventory(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_curriculum_uploader),
):
    # An SME only owns their own subject, so both the picker and the "currently
    # loaded" list are scoped to it. Curriculum Head / DLP Manager / APM
    # administer every subject and get the unrestricted list.
    limit = crud.allowed_upload_subjects(db, current_user.email, current_user.designation, current_user.subject)
    return {
        "inventory": crud.get_planner_inventory(db, limit_to=limit),
        "subjects": crud.get_known_subjects(db, limit_to=limit),
    }


@app.post("/api/planner/import", response_model=schemas.PlannerImportResponse)
async def import_planner_workbook(
    subject: str = Form(...),
    commit: bool = Form(False),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_curriculum_uploader),
):
    """Imports EVERY grade tab in one subject workbook. Grades come from the
    tab names, so the uploader only picks a subject and the file.

    With commit=false nothing is written — the UI calls this twice, once to
    show the per-grade summary and again on Confirm, so a bad file can never
    reach the database on the strength of a mis-click. On commit each grade
    replaces only its own (subject, grade); grades absent from the file are
    left exactly as they were.
    """
    subject = (subject or "").strip()
    if not subject:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please choose a subject.")

    # Enforced server-side: hiding other subjects in the dropdown is not a
    # permission check, and an upload replaces a whole subject+grade.
    limit = crud.allowed_upload_subjects(db, current_user.email, current_user.designation, current_user.subject)
    if limit is not None and subject.lower() not in {s.lower() for s in limit}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You can only upload curriculum for {', '.join(limit) or 'your own subject'}.",
        )
    if not (file.filename or "").lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please upload an Excel .xlsx file (a .xls or Google Sheet needs saving as .xlsx first).")

    contents = await file.read()
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="That file is larger than 10 MB — please check it's the right workbook.")

    try:
        parsed = excel_import.parse_workbook_all_grades(contents, subject)
    except Exception as exc:
        logger.exception("Curriculum upload parse failed for %s", subject)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Could not read that workbook: {exc}")

    if not parsed["grades"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No grade tabs could be read from that file. Name each tab for its grade "
                   "(\"Grade 3\" or \"Gr 3\"), and make sure each has a 'Chapter Name' column.",
        )

    warnings = list(parsed["warnings"])
    reached_by = crud.subjects_reaching(db, subject)
    if not reached_by:
        warnings.append(
            f"No staff account currently has the subject '{subject}'. The data will import, but teachers "
            f"only see the planner for their own subject, so nobody will see it until their profile matches."
        )
    elif [r.lower() for r in reached_by] != [subject.lower()]:
        # e.g. uploading "Physics" — nobody is tagged Physics, but every
        # Science teacher reaches it through the subject group.
        warnings.append(
            f"'{subject}' will be visible to teachers tagged {', '.join(reached_by)} — they pick "
            f"{subject} as the stream on the POW form."
        )

    # A third-language tab is a curriculum of its own, stored under its own
    # subject name ("Hindi (R3)") so it never collides with the main one for
    # the same grade.
    def subject_for(g):
        return f"{subject} ({g['level']})" if g.get("level") else subject

    inventory = crud.get_planner_inventory(db)
    existing_by_grade = {
        (i["subject"].lower(), i["grade"]): i["rows"] for i in inventory
    }

    grades_out = []
    for g in parsed["grades"]:
        grades_out.append({
            "grade": g["grade"], "level": g.get("level"),
            "subject": subject_for(g), "tab": g["tab"],
            "row_count": g["row_count"], "chapter_count": len(g["chapters"]),
            "chapters": g["chapters"],
            "has_strands": g["has_strands"], "has_skill": g["has_skill"],
            "existing_rows": existing_by_grade.get((subject_for(g).lower(), g["grade"]), 0),
            "warnings": g["warnings"],
            "replaced": 0, "imported": 0,
        })

    result = {
        "committed": False, "subject": subject,
        "grades": grades_out,
        "missing_grades": parsed["missing_grades"],
        "skipped_tabs": parsed["skipped_tabs"],
        "warnings": warnings,
        "total_rows": sum(g["row_count"] for g in grades_out),
    }

    if not commit:
        return result

    for g, out in zip(parsed["grades"], grades_out):
        target = subject_for(g)
        for row in g["rows"]:
            row["subject"] = target
        counts = crud.replace_planner_grade(db, target, g["grade"], g["rows"])
        out["replaced"] = counts["deleted"]
        out["imported"] = counts["inserted"]
        # Kept so the sheet's own warnings stay visible after this session ends.
        crud.save_import_log(
            db, target, g["grade"], g["tab"], counts["inserted"],
            len(g["chapters"]), g["warnings"], current_user.email,
        )

    logger.info(
        "Curriculum import by %s: %s — grades %s (%s rows)",
        current_user.email, subject,
        ", ".join(str(g["grade"]) for g in grades_out),
        result["total_rows"],
    )
    result["committed"] = True
    return result


# ─── Backfill: what was covered before POWs began ────────────────────────────

def _check_backfill_scope(db: Session, user: auth.CurrentUser, subject: str) -> None:
    """Same scoping as curriculum upload: an SME only for their own subject and
    its streams, the curriculum administrators for anything."""
    limit = crud.allowed_upload_subjects(db, user.email, user.designation, user.subject)
    if limit is not None and subject.lower() not in {s.lower() for s in limit}:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"You can only mark coverage for {', '.join(limit) or 'your own subject'}.",
        )


def _require_campus(branch: str, doing: str) -> None:
    """Coverage belongs to a campus. Kodathi and Attibele teach the same grade
    at their own pace, so a mark saved with no campus selected would count for
    both - which is exactly how the unattributed rows came about."""
    if not (branch or "").strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Choose a campus at the top of the page before {doing} — "
                   f"Kodathi and Attibele are marked separately.",
        )


@app.get("/api/backfill", response_model=schemas.BackfillResponse)
def get_backfill(
    subject: str = Query(...),
    grade: int = Query(...),
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_coverage_marker),
):
    _check_backfill_scope(db, current_user, subject)
    return crud.get_backfill_view(db, subject, grade, branch)


@app.post("/api/backfill")
def save_backfill(
    req: schemas.BackfillSaveRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_coverage_marker),
):
    """One-time marking. Refused once a POW exists for this subject+grade —
    from that point progress is whatever the POWs say, and re-opening the
    marking would let someone silently rewrite history."""
    _check_backfill_scope(db, current_user, req.subject)
    _require_campus(req.branch, "marking coverage")
    view = crud.get_backfill_view(db, req.subject, req.grade, req.branch)
    if view["locked"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Coverage for {req.subject} Grade {req.grade} was confirmed complete by "
                   f"{view['confirmed_by'] or 'an SME'} — reopen it first if it needs changing.",
        )
    result = crud.save_backfill(db, req.subject, req.grade, req.marks, current_user.email, req.branch)
    logger.info("Backfill saved by %s: %s Grade %s %s — %s marks",
                current_user.email, req.subject, req.grade, req.branch or "(all campuses)", result["saved"])
    return {"success": True, **result}


@app.post("/api/backfill/confirm")
def confirm_backfill(
    req: schemas.BackfillConfirmRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_coverage_marker),
):
    """The SME saying "past coverage for this teacher is complete". This — not
    the arrival of POWs — is what closes the marking."""
    _check_backfill_scope(db, current_user, req.subject)
    _require_campus(req.branch, "confirming coverage")
    result = crud.confirm_backfill(db, req.subject, req.grade, current_user.email, req.branch)
    logger.info("Backfill confirmed by %s: %s Grade %s",
                current_user.email, req.subject, req.grade)
    return {"success": True, **result}


@app.post("/api/backfill/reopen")
def reopen_backfill(
    req: schemas.BackfillConfirmRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_coverage_marker),
):
    """Undo a confirmation — the marks are kept, the window just opens again."""
    _check_backfill_scope(db, current_user, req.subject)
    _require_campus(req.branch, "reopening coverage")
    result = crud.reopen_backfill(db, req.subject, req.grade, req.branch)
    logger.info("Backfill reopened by %s: %s Grade %s",
                current_user.email, req.subject, req.grade)
    return {"success": True, **result}


# ─── POW cards (dashboard) ───────────────────────────────────────────────────

@app.get("/api/teachers", response_model=schemas.TeachersResponse)
def get_teachers(
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """Cheap, pow_entries-free lookup used to populate the Subject filter
    dropdown before any POW cards are fetched. Also returns the subjects
    grouped into curriculum vs other, so the dashboard filter reads the same
    way as the upload screen's picker."""
    teachers = crud.get_teachers_for_role(db, current_user.email, current_user.role, branch)
    if current_user.role == "SME":
        # An SME's dashboard is already limited to their mapped teachers, so the
        # subject list follows from those rather than the whole school. A
        # teacher's profile says "Hindi" even when they also take the third
        # language, so the levels of each subject are added explicitly -
        # otherwise Hindi (R3) exists in the planner and appears in no dropdown.
        scope = sorted({t["subject"] for t in teachers if t.get("subject")})
        scope = sorted(set(scope) | set(crud.planner_levels_of(db, scope)))
    else:
        scope = None
    return {
        "teachers": teachers,
        "subjects": crud.get_known_subjects(db, limit_to=scope),
        "branches": crud.branch_choices(db, current_user.email, current_user.role),
    }


@app.get("/api/pow/cards", response_model=schemas.PowCardsResponse)
def get_pow_cards(
    subject: str = Query(...),
    grade: str = Query(...),
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return {"cards": crud.get_pow_cards(db, current_user.email, current_user.role, subject, grade, branch)}


@app.get("/api/pow/overview")
def get_curriculum_overview(
    subject: str = Query(...),
    grade: str = Query(...),
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_curriculum_overview),
):
    """Week-by-week table of every POW filed for one subject+grade."""
    return crud.get_curriculum_overview(
        db, current_user.email, current_user.role, subject, grade, branch
    )


@app.get("/api/pow/overview.xlsx")
def download_curriculum_overview(
    subject: str = Query(...),
    grade: str = Query(...),
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_curriculum_overview),
):
    """The same table as /api/pow/overview, as a workbook — 15 to 19 columns
    reads better in Excel than in a browser."""
    data = crud.get_curriculum_overview(
        db, current_user.email, current_user.role, subject, grade, branch
    )
    content = overview_export.build_overview_workbook(data)
    filename = overview_export.overview_filename(subject, grade)
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/pow/tbs-mom-alerts", response_model=schemas.PowCardsResponse)
def get_tbs_mom_alerts(
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    return {"cards": crud.get_tbs_mom_alerts(db, current_user.email, current_user.role)}


# Declared before /api/pow/{pow_id}: FastAPI matches routes in order, and
# "last-plans" would otherwise be read as a pow_id.
@app.get("/api/pow/sections")
def get_sections_for_grade(
    subject: str = Query(...),
    grade: str = Query(...),
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """The sections this campus runs for a subject+grade - Attibele runs two
    where Kodathi runs five or six.

    A teacher with no campus selected gets their OWN campus rather than the
    union of both: they can only file for the sections they actually teach."""
    campus = branch
    if not campus:
        me = db.query(models.User).filter(models.User.email.ilike(current_user.email)).first()
        own = crud.viewer_branches(me.location if me else "")
        if len(own) == 1:
            campus = own[0]
    return {"sections": crud.sections_for_grade(db, subject, grade, campus), "branch": campus}


@app.get("/api/pow/last-plans")
def get_last_section_plans(
    subject: str = Query(...),
    grade: str = Query(...),
    branch: str = Query(""),
    db: Session = Depends(get_db),
    _user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """Where each section of this subject+grade got to, so a new POW can start
    each one from its own last topic rather than from the grade's."""
    return {"plans": crud.last_section_plans(db, subject, grade, branch)}


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
            **{
                f"impl_{s}_date": (getattr(pow_entry, f"impl_{s}_date").isoformat()
                                   if getattr(pow_entry, f"impl_{s}_date") else None)
                for s in "abcdef"
            },
            **{
                f"correction_{s}_date": (getattr(pow_entry, f"correction_{s}_date").isoformat()
                                         if getattr(pow_entry, f"correction_{s}_date") else None)
                for s in "abcdef"
            },
            "correction_done": pow_entry.correction_done, "instructions": pow_entry.instructions,
            "teacher_remarks": pow_entry.teacher_remarks, "status": pow_entry.status, "tbs_mom": pow_entry.tbs_mom,
            # A week runs several sessions, each with its own plan, and each
            # section may be on its own topic - see models.PowSession and
            # models.PowSectionPlan.
            "sessions": [
                {"session_no": x.session_no or "",
                 "sections": [y for y in (x.sections or "").split(",") if y],
                 "chapter": x.chapter or "",
                 "topic": x.topic or "", "subtopic": x.subtopic or "",
                 "cw": x.cw or "", "binder": x.binder or "",
                 "activity": x.activity or "", "homework": x.homework or "",
                 "lp_link": x.lp_link or "", "learning_outcomes": x.learning_outcomes or "",
                 "id": x.id,
                 "impl": {
                     i.section: {
                         "remarks": i.remarks or "",
                         "completed_on": i.completed_on.isoformat() if i.completed_on else None,
                         "correction_on": i.correction_on.isoformat() if i.correction_on else None,
                     }
                     for i in x.implementations
                 }}
                for x in pow_entry.sessions
            ],
            "section_plans": [
                {"section": x.section, "chapter": x.chapter or "", "topic": x.topic or "",
                 "subtopic": x.subtopic or ""}
                for x in pow_entry.section_plans
            ],
            # Inside `pow` deliberately: the frontend keeps res.pow in state, so
            # a flag on the wrapper reads as undefined and silently disables
            # every field (exactly what happened).
            "can_edit": crud.can_edit_pow(_user, pow_entry),
            "can_edit_tbs_mom": crud.can_edit_tbs_mom(_user, pow_entry),
        },
        "review": ({
            "sme_email": review.sme_email, "cct_discussed": review.cct_discussed,
            "approved_closed": review.approved_closed, "remarks": review.remarks,
            "sme_name": review.sme_name, "confirmed_date": review.confirmed_date.isoformat() if review.confirmed_date else None,
        } if review else None),
    }


def _notify_pow(background: BackgroundTasks, db: Session, pow_entry: models.PowEntry,
                teacher_name: str, action: str) -> None:
    """Queued as a background task so email latency never delays the save, and
    a Resend outage can't fail the request."""
    recipients = crud.get_pow_notification_recipients(db, pow_entry.teacher_email, pow_entry.subject)
    background.add_task(
        email_service_resend.send_pow_notification,
        recipients=recipients,
        teacher_name=teacher_name or pow_entry.teacher_email,
        action=action,
        subject=pow_entry.subject,
        grade=pow_entry.grade,
        week=f"{pow_entry.week_start} to {pow_entry.week_end}",
        topic=pow_entry.topic or "",
        subtopic=pow_entry.subtopic or "",
        sessions=pow_entry.lp_session_num or "",
        status_label=crud.STATUS_LABELS.get(pow_entry.status, pow_entry.status),
    )


@app.post("/api/pow")
def create_pow(
    req: schemas.PowCreateRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_pow_author),
):
    dup = crud.find_duplicate_pow(db, req.subject, req.grade, req.week_start, req.topic, req.subtopic or "")
    if dup:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A POW already exists for this week, subject, grade, topic and sub-topic.")
    pow_entry = crud.create_pow(db, current_user.email, req)
    _notify_pow(background, db, pow_entry, current_user.name, "created")
    return {"success": True, "id": pow_entry.id}


@app.patch("/api/pow/{pow_id}/implementation")
def update_pow_implementation(
    pow_id: int,
    req: schemas.PowImplementationRequest,
    background: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    pow_entry = crud.get_pow(db, pow_id)
    if not pow_entry:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="POW not found")
    # Shared-by-subject visibility (see crud.get_pow_cards) means any teacher of
    # this POW's subject may fill in their own section (A-F), not just whoever
    # created it — and the subject's SME may too. Group-aware, so a
    # Science-tagged teacher owns Physics/Biology/Chemistry POWs as well.
    # After the final save only the TBS MOM may still change, so a request
    # that touches nothing else is allowed through.
    if not crud.can_edit_pow(current_user, pow_entry):
        tbs_mom_only = req.tbs_mom is not None and not req.final_save and not any([
            req.impl_a, req.impl_b, req.impl_c, req.impl_d, req.impl_e, req.impl_f,
            req.correction_done, req.instructions, req.teacher_remarks,
        ])
        if not (tbs_mom_only and crud.can_edit_tbs_mom(current_user, pow_entry)):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="This POW is finalised — only its TBS MOM can still be updated, and only by a teacher of this subject.",
            )
    crud.update_pow_implementation(db, pow_entry, req)
    _notify_pow(background, db, pow_entry, current_user.name, "updated")
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
    discipline: str = Query(""),
    branch: str = Query(""),
    month: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    # Leadership/SME omit teacher_email (see whole-school/mapped-teacher view);
    # a plain Teacher can only ever query their own email.
    effective_email = teacher_email or None
    if current_user.role == "Teacher":
        effective_email = current_user.email
    available = crud.planner_disciplines(db, subject, int(grade))
    chosen = discipline.strip()
    if not chosen:
        # A discipline SME lands on their own: Bhuvana R is 'Science' in the
        # portal but Biology in staff_roles, Deepak Physics, Francis Joy
        # Chemistry. A subject that already names a stream wins over that.
        chosen = crud.stream_discipline(subject) or crud.default_discipline_for(
            staff_directory.subjects_for(current_user.email), available
        ) or ""
    scope = crud.progress_scope(db, current_user.email, current_user.role, branch)
    summary = crud.get_progress_summary(db, subject, int(grade), effective_email, chosen or None,
                                        scope, branch, month.strip() or None)
    summary["discipline_default"] = chosen
    # The months a reader may look back at, so the picker needs no second call.
    summary["months_available"] = crud.months_so_far()
    return summary


@app.get("/api/progress/annual")
def get_annual_progress(
    subject: str = Query(...),
    grade: str = Query(...),
    discipline: str = Query(""),
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """Whole-year, per-section progress for one subject+grade. The leadership
    reading of Progress Check; SMEs keep the month-at-a-time view but may
    switch to this one."""
    if not auth.can_oversee_curriculum(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The annual view is for staff who oversee curriculum delivery.",
        )
    available = crud.planner_disciplines(db, subject, int(grade))
    chosen = discipline.strip()
    if not chosen:
        # Picking "Biology" already says which discipline; otherwise fall back
        # to the viewer's own stream from staff_roles.
        chosen = crud.stream_discipline(subject) or crud.default_discipline_for(
            staff_directory.subjects_for(current_user.email), available
        ) or ""
    result = crud.get_annual_progress(
        db, subject, int(grade), chosen or None,
        crud.progress_scope(db, current_user.email, current_user.role, branch), branch,
    )
    result["discipline_default"] = chosen
    return result


@app.get("/api/progress/report")
def delivery_report(
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_oversight),
):
    """Grade x subject delivery for one campus - the management report. Each
    cell is how far ahead or behind the plan that class is, and each grade
    opens into its sections."""
    return crud.delivery_report(db, current_user.email, current_user.role, branch)


@app.post("/api/progress/teacher-note")
def save_teacher_note(
    req: schemas.TeacherNoteRequest,
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_oversight),
):
    """Why a teacher is where they are - written by whoever oversees them."""
    if not (req.section or "").strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="A note has to be against a section.")
    return crud.save_teacher_note(db, req.subject, str(req.grade), req.section,
                                  req.branch or None, req.note or "",
                                  req.teacher_email or "",
                                  current_user.email, current_user.name)


@app.get("/api/progress/sections")
def get_section_progress(
    subject: str = Query(...),
    branch: str = Query(""),
    fresh: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.require_oversight),
):
    """One subject, every section on a campus, with the teachers who take it."""
    return crud.section_progress(db, current_user.email, current_user.role,
                                 subject, branch or None, fresh)


@app.get("/api/progress/compare")
def compare_branches(
    subject: str = Query(...),
    discipline: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """Kodathi against Attibele, grade by grade, for one subject. An SME,
    Curriculum Head or the leadership team oversees both campuses separately;
    this is the one place they are put side by side."""
    if not auth.can_oversee_curriculum(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The branch comparison is for staff who oversee curriculum delivery.",
        )
    return crud.compare_branches(
        db, current_user.email, current_user.role, subject, discipline.strip() or None
    )


@app.get("/api/progress/lagging")
def get_lagging(
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """Curriculum-lag overview for the leadership/SME dashboard. Scoped to the
    teachers the viewer already oversees (an SME sees their mapped teachers,
    leadership sees the school)."""
    if not crud.can_see_lagging(current_user.role, current_user.designation):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not available for your role")
    return crud.get_lagging_report(db, current_user.email, current_user.role, branch)


@app.get("/api/progress/month-chart")
def get_month_chart(
    subject: str = Query(...),
    grade: str = Query(...),
    discipline: str = Query(""),
    branch: str = Query(""),
    month: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """One month week by week - the current one unless another is named, so
    August can still be read in September. The cumulative year-to-date chart is
    /api/progress/chart, shown on the Full year tab."""
    return crud.get_month_chart(
        db, subject, int(grade), discipline.strip() or None,
        crud.progress_scope(db, current_user.email, current_user.role, branch), branch,
        month.strip() or None,
    )


@app.get("/api/progress/chart")
def get_progress_chart(
    subject: str = Query(...),
    grade: str = Query(...),
    discipline: str = Query(""),
    branch: str = Query(""),
    db: Session = Depends(get_db),
    current_user: auth.CurrentUser = Depends(auth.get_current_user),
):
    """Cumulative year-to-date, month by month. Shown on the Full year tab -
    the month-by-week view is /api/progress/month-chart."""
    return crud.get_progress_chart(
        db, subject, int(grade), discipline.strip() or None,
        crud.progress_scope(db, current_user.email, current_user.role, branch), branch,
    )
