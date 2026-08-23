import datetime
import re
import calendar
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import func
from . import models, staff_directory

IST_OFFSET = datetime.timedelta(hours=5, minutes=30)

# Raw pow_entries.status -> dashboard display label. Lifecycle:
#   created (teacher creates the POW)
#   -> final (teacher's Confirm Final Save on the implementation, with/without TBS MOM)
#   -> reviewed (SME has saved remarks, but not yet confirmed & closed)
#   -> approved (SME confirmed & closed — see save_sme_review)
STATUS_LABELS = {
    "created": "Created",
    "final": "To be Reviewed",
    "reviewed": "Reviewed",
    "approved": "Closed",
}


# Academic year order, not calendar order — the curriculum runs April to
# March, so January is LATER than December when judging whether a planner
# month has already passed.
ACADEMIC_MONTHS = [
    "April", "May", "June", "July", "August", "September",
    "October", "November", "December", "January", "February", "March",
]
MONTH_INDEX = {m: i for i, m in enumerate(ACADEMIC_MONTHS)}


def now_ist() -> datetime.datetime:
    """Matches Code.gs's Session.getScriptTimeZone() == 'Asia/Kolkata' behavior
    for the server-side progress calculations (distinct from the client-side
    IST hack in JS.html used only for past-week POW-form detection)."""
    return datetime.datetime.utcnow() + IST_OFFSET


def _first_session_num(raw: Optional[str]) -> int:
    """parseInt()-style: takes the leading integer only ("3, 4" -> 3), matching
    Code.gs's getProgressData: `parseInt(r[8]) || 0`."""
    if not raw:
        return 0
    m = re.match(r"\s*(\d+)", raw)
    return int(m.group(1)) if m else 0


def _max_session_num(raw: Optional[str]) -> int:
    """max() over every number found, matching Code.gs's getProgressSummary:
    `lpStr.split(/[,\\s]+/).map(Number).filter(n=>!isNaN(n)&&n>0)`, default 1
    if the string has no usable digits — a session was still done, just not
    numbered clearly."""
    if not raw:
        return 1
    nums = [int(n) for n in re.findall(r"\d+", raw)]
    nums = [n for n in nums if n > 0]
    return max(nums) if nums else 1


# ─── Planner topics ────────────────────────────────────────────────────────

# Subjects whose curriculum is split into streams that the shared users table
# has no way to express. Every Biology/Physics/Chemistry teacher and SME is
# tagged simply 'Science' in the portal (confirmed against the live table:
# Ms Bhuvana R, Mr Deepak Damodaran and Dr Francis Joy are all subject
# 'Science', as are all 21 teachers mapped to them — and 10 of those teachers
# are mapped to two of the three SMEs, so the split isn't one-teacher-per-
# stream either). Uploads stay per stream, so each replaces only itself; a
# Science teacher's POW form then sees all three, picking the stream first.
SUBJECT_GROUPS = {
    "science": ["Science", "Biology", "Physics", "Chemistry"],
}


def subjects_in_group(subject: str) -> List[str]:
    """The planner subjects a teacher of `subject` should see. Identity for
    everything outside SUBJECT_GROUPS."""
    return SUBJECT_GROUPS.get((subject or "").strip().lower(), [subject])


def _subject_group_filter(subject: str):
    """SQL predicate matching a subject or any stream within its group. POWs
    are stored under the stream the teacher picked ("Physics"), while the
    dashboard and progress screens ask by profile subject ("Science") — this
    is what bridges the two. Deliberately NOT used by find_duplicate_pow:
    the same chapter name in two different streams is two different POWs."""
    return func.lower(models.PowEntry.subject).in_([s.lower() for s in subjects_in_group(subject)])


def get_planner_rows(db: Session, subject: str, grade: Optional[int] = None) -> List[models.PlannerTopic]:
    group = [s.lower() for s in subjects_in_group(subject)]
    q = db.query(models.PlannerTopic).filter(func.lower(models.PlannerTopic.subject).in_(group))
    if grade is not None:
        q = q.filter(models.PlannerTopic.grade == int(grade))
    # Ordered by subject first so a grouped subject's streams stay contiguous
    # and each keeps its own sheet order — display_order is only meaningful
    # within one (subject, grade), and the month-sequencing in
    # get_progress_chart depends on that per-stream order being intact.
    return q.order_by(models.PlannerTopic.subject, models.PlannerTopic.display_order).all()


def get_planner_chapters(db: Session, subject: str, grade: int) -> List[models.PlannerTopic]:
    """One entry per unique CHAPTER NAME — the progress-tracking unit.

    "No of sessions" is a chapter-level total, and the importer carries it down
    into a chapter's continuation rows, so a chapter taught across two months
    shows the same figure twice: English Grade 5's "Tell Me a Story" reads 21
    sessions in May and 21 in June for one 21-session chapter. Keying by
    (chapter, month) therefore DOUBLE COUNTED — 69 sessions for a Grade 5 whose
    sheet plans 33 (confirmed with the APM).

    Where two occurrences state different counts the larger is taken, so the
    plan is never under-stated, and `month` is the LAST month the chapter
    appears in — the month by which it should be finished, which is what
    "expected by now" needs.

    Chapters with no name fall back to their Topic at import time (see
    excel_import.parse_grade_tab), so a sheet that plans against topics rather
    than chapters still counts."""
    return chapters_from_rows(get_planner_rows(db, subject, grade))


class PlannerChapter:
    """A chapter as the progress maths sees it. Deliberately NOT a
    models.PlannerTopic: this collapses several rows into one and adjusts the
    month, and mutating ORM instances would write those adjustments back to
    planner_topics on the next commit."""

    __slots__ = ("chapter_name", "month", "first_month", "sessions", "discipline", "subject")

    def __init__(self, row):
        self.chapter_name = row.chapter_name
        self.month = row.month
        self.first_month = row.month
        self.sessions = row.sessions or 0
        self.discipline = row.strands_of_language or row.discipline
        self.subject = row.subject


def chapters_from_rows(rows: List[models.PlannerTopic]) -> List[PlannerChapter]:
    chosen = {}
    order = []
    for r in rows:
        key = r.chapter_name
        if key not in chosen:
            chosen[key] = PlannerChapter(r)
            order.append(key)
            continue
        entry = chosen[key]
        # the largest stated count wins, so the plan is never under-stated
        entry.sessions = max(entry.sessions, r.sessions or 0)
        # and the chapter is due by the LAST month it appears in
        if MONTH_INDEX.get(r.month, -1) > MONTH_INDEX.get(entry.month, -1):
            entry.month = r.month
        if MONTH_INDEX.get(r.month, 99) < MONTH_INDEX.get(entry.first_month, 99):
            entry.first_month = r.month
    return [chosen[key] for key in order]


def save_import_log(db: Session, subject: str, grade: int, tab: str, row_count: int,
                    chapter_count: int, warnings: list, imported_by: str) -> None:
    """Records this import's warnings so they outlive the upload screen. One row
    per (subject, grade), replaced on re-import — fix the sheet, re-upload, and
    the warnings for that grade disappear on their own."""
    import json
    existing = (
        db.query(models.PlannerImportLog)
        .filter(func.lower(models.PlannerImportLog.subject) == subject.lower(),
                models.PlannerImportLog.grade == int(grade))
        .first()
    )
    if not existing:
        existing = models.PlannerImportLog(subject=subject, grade=int(grade))
        db.add(existing)
    existing.subject = subject
    existing.tab = tab
    existing.row_count = row_count
    existing.chapter_count = chapter_count
    existing.warnings = json.dumps(warnings or [])
    existing.imported_by = imported_by
    existing.imported_at = datetime.datetime.utcnow()
    db.commit()


def get_import_logs(db: Session) -> dict:
    """{(subject_lower, grade): {...}} of the last import per subject+grade."""
    import json
    out = {}
    for log in db.query(models.PlannerImportLog).all():
        try:
            warnings = json.loads(log.warnings or "[]")
        except ValueError:
            warnings = []
        out[(log.subject.lower(), log.grade)] = {
            "tab": log.tab, "warnings": warnings,
            "imported_by": log.imported_by,
            "imported_at": log.imported_at.isoformat() if log.imported_at else None,
        }
    return out


def get_planner_inventory(db: Session, limit_to: Optional[List[str]] = None) -> list:
    """What curriculum data is currently loaded, one row per (subject, grade) —
    powers the "already uploaded" table on the admin upload screen."""
    rows = (
        db.query(
            models.PlannerTopic.subject,
            models.PlannerTopic.grade,
            func.count(models.PlannerTopic.id),
            func.count(func.distinct(models.PlannerTopic.chapter_name)),
        )
        .group_by(models.PlannerTopic.subject, models.PlannerTopic.grade)
        .order_by(models.PlannerTopic.subject, models.PlannerTopic.grade)
        .all()
    )
    logs = get_import_logs(db)
    keep = {s.lower() for s in limit_to} if limit_to is not None else None
    out = []
    for s_name, g, n, c in rows:
        if keep is not None and s_name.lower() not in keep:
            continue
        log = logs.get((s_name.lower(), g), {})
        out.append({
            "subject": s_name, "grade": g, "rows": n, "chapters": c,
            "warnings": log.get("warnings", []),
            "imported_at": log.get("imported_at"),
            "imported_by": log.get("imported_by"),
        })
    return out


# The subjects curriculum mapping workbooks actually exist for. Listed first
# on the upload screen, ahead of the long tail of staff subjects (Karate,
# Skating, Library...) that will never have a planner workbook.
#
# "Mathematics" — not "Maths" — deliberately: teachers are tagged Mathematics
# in the shared users table, and the planner a teacher sees is looked up by
# that exact value, so an upload filed under "Maths" would be invisible to
# every maths teacher.
CURRICULUM_SUBJECTS = [
    "English", "Hindi", "Kannada", "Mathematics", "Science",
    "Biology", "Physics", "Chemistry", "Social Science",
]


def allowed_upload_subjects(db: Session, email: str, designation: str, subject: Optional[str]) -> Optional[List[str]]:
    """Which subjects this account may upload for. None means "no limit" — the
    cross-subject administrators (Curriculum Head, DLP Manager, APM).

    An SME owns one subject, so they get that subject plus its streams: a
    Science SME must be able to upload Biology, Physics and Chemistry, since
    that's how those sheets are stored. Anything staff_roles also lists for
    them is included, which covers an SME who teaches a second subject.
    """
    from .auth import CURRICULUM_UPLOAD_DESIGNATIONS
    admin_designations = CURRICULUM_UPLOAD_DESIGNATIONS - {"subject matter expert"}
    if (designation or "").strip().lower() in admin_designations:
        return None

    allowed = []
    for name in subjects_in_group(subject) if subject else []:
        if name and name not in allowed:
            allowed.append(name)
    for name in staff_directory.subjects_for(email):
        for member in subjects_in_group(name):
            if member and member not in allowed:
                allowed.append(member)
    return allowed


def get_known_subjects(db: Session, limit_to: Optional[List[str]] = None) -> dict:
    """Subject options for the upload screen, split into the curriculum
    subjects proper and everything else a staff account is tagged with (plus
    anything already imported, so an existing import is always re-selectable
    even if it matches neither list).

    limit_to scopes the list to what the viewer may actually upload (an SME
    sees only their own subject and its streams)."""
    from_users = {
        s.strip() for (s,) in db.query(models.User.subject).filter(models.User.subject.isnot(None)).distinct()
        if s and s.strip()
    }
    from_planner = {
        s.strip() for (s,) in db.query(models.PlannerTopic.subject).distinct() if s and s.strip()
    }
    curriculum_lower = {s.lower() for s in CURRICULUM_SUBJECTS}
    other = sorted(
        {s for s in (from_users | from_planner) if s.lower() not in curriculum_lower},
        key=str.lower,
    )
    curriculum = list(CURRICULUM_SUBJECTS)

    if limit_to is not None:
        keep = {s.lower() for s in limit_to}
        curriculum = [s for s in curriculum if s.lower() in keep]
        other = [s for s in other if s.lower() in keep]

    return {"curriculum": curriculum, "other": other}


def subjects_reaching(db: Session, subject: str) -> List[str]:
    """Which staff profile subjects will actually see a planner uploaded under
    `subject`. Usually just the subject itself, but a stream is reached through
    its group's profile subject — nobody is tagged 'Physics', yet every
    'Science' teacher sees the Physics planner. Empty means the upload would
    be invisible to everyone, which the upload screen warns about."""
    profile_subjects = {
        s.strip() for (s,) in db.query(models.User.subject).filter(models.User.subject.isnot(None)).distinct()
        if s and s.strip()
    }
    return sorted(
        p for p in profile_subjects
        if subject.lower() in [s.lower() for s in subjects_in_group(p)]
    )


def replace_planner_grade(db: Session, subject: str, grade: int, rows: list) -> dict:
    """Replaces the planner data for ONE (subject, grade) — deliberately not
    the whole subject, so uploading Grade 6 never disturbs Grade 5. Matched
    case-insensitively on subject so a re-upload as "MATHEMATICS" replaces the
    "Mathematics" rows instead of doubling them up."""
    deleted = (
        db.query(models.PlannerTopic)
        .filter(func.lower(models.PlannerTopic.subject) == subject.lower(), models.PlannerTopic.grade == int(grade))
        .delete(synchronize_session=False)
    )
    for r in rows:
        db.add(models.PlannerTopic(**r))
    db.commit()
    return {"deleted": deleted, "inserted": len(rows)}


# ─── POW cards (dashboard) ──────────────────────────────────────────────────

def _build_teacher_map(db: Session, user_email: str, role: str) -> dict:
    """email -> {name, subject, location} scoped by role — the set of
    teachers whose POWs this user is allowed to see. Cheap (no pow_entries
    touched), so it's safe to call on its own to populate a subject filter
    dropdown before ever fetching any cards."""
    teacher_map = {}

    if role == "SME":
        sme = db.query(models.User).filter(func.lower(models.User.email) == user_email.lower()).first()
        if sme:
            mapped_ids = [m.teacher_id for m in db.query(models.TeacherSme).filter(models.TeacherSme.sme_id == sme.id).all()]
            if mapped_ids:
                for t in db.query(models.User).filter(models.User.id.in_(mapped_ids)).all():
                    teacher_map[t.email.lower()] = {"name": t.name or t.email, "subject": t.subject or "", "location": t.location or ""}
    elif role == "Leadership":
        # Leadership sees POWs for every subject teacher across the school
        for t in db.query(models.User).all():
            if not t.subject or t.designation == "Subject Matter Expert":
                continue
            teacher_map[t.email.lower()] = {"name": t.name or t.email, "subject": t.subject or "", "location": t.location or ""}
    else:
        # Teacher: share visibility across every teacher of the SAME subject,
        # not just cards this teacher personally created — different section
        # teachers (A-F) need to find and open the same shared POW card to
        # fill in their own section. Confirmed with user 2026-07-22.
        requester = db.query(models.User).filter(func.lower(models.User.email) == user_email.lower()).first()
        subject = requester.subject if requester else None
        if subject:
            for t in db.query(models.User).all():
                if not t.subject or t.subject.lower() != subject.lower():
                    continue
                teacher_map[t.email.lower()] = {"name": t.name or t.email, "subject": t.subject or "", "location": t.location or ""}
        else:
            teacher_map[user_email.lower()] = {"name": "", "subject": "", "location": ""}

    return teacher_map


def get_teachers_for_role(db: Session, user_email: str, role: str) -> list:
    teacher_map = _build_teacher_map(db, user_email, role)
    return [{"email": email, **info} for email, info in teacher_map.items()]


def _card_dict(p: models.PowEntry, teacher_map: dict) -> dict:
    temail = p.teacher_email.lower()
    return {
        "id": p.id,
        "teacher_email": temail,
        "teacher_name": teacher_map.get(temail, {}).get("name") or temail,
        "subject": p.subject,
        "grade": p.grade,
        "week_start": p.week_start.isoformat(),
        "week_end": p.week_end.isoformat(),
        "topic": p.topic,
        # Flags a POW past the teacher's own final-save that never got a
        # TBS MOM filled in — surfaced as a highlight on the dashboard card,
        # recomputed fresh on every load so it keeps nagging until fixed.
        "tbs_mom_missing": p.status in ("final", "reviewed", "approved") and not (p.tbs_mom or "").strip(),
        "status": STATUS_LABELS.get(p.status, "Created"),
    }


def get_pow_cards(db: Session, user_email: str, role: str, subject: str, grade: str):
    """Cards are only ever fetched once a subject+grade is picked (see
    main.py) — the dashboard no longer loads anything on mount, since the
    unfiltered query could span every grade of a subject for Leadership/SME
    and was the main reason the dashboard felt slow even with little data."""
    teacher_map = _build_teacher_map(db, user_email, role)

    cards = []
    if teacher_map:
        pows = db.query(models.PowEntry).filter(
            func.lower(models.PowEntry.teacher_email).in_(teacher_map.keys()),
            _subject_group_filter(subject),
            models.PowEntry.grade == str(grade),
        ).all()
        cards = [_card_dict(p, teacher_map) for p in pows]
    cards.sort(key=lambda c: c["week_start"], reverse=True)
    return cards


def get_tbs_mom_alerts(db: Session, user_email: str, role: str) -> list:
    """Independent of whatever subject/grade filter is currently selected on
    the dashboard — a teacher shouldn't miss the "you forgot TBS MOM" nag
    just because they haven't browsed to that specific grade. Scoped to the
    same teacher_map as get_pow_cards, but filtered directly at the DB level
    to just the final/reviewed/approved rows, so it stays cheap."""
    teacher_map = _build_teacher_map(db, user_email, role)
    if not teacher_map:
        return []
    pows = db.query(models.PowEntry).filter(
        func.lower(models.PowEntry.teacher_email).in_(teacher_map.keys()),
        models.PowEntry.status.in_(("final", "reviewed", "approved")),
    ).all()
    cards = [_card_dict(p, teacher_map) for p in pows if not (p.tbs_mom or "").strip()]
    cards.sort(key=lambda c: c["week_start"], reverse=True)
    return cards


# ─── POW create / get / update ──────────────────────────────────────────────

def find_duplicate_pow(db: Session, subject: str, grade: str, week_start: str, topic: str, subtopic: str) -> Optional[models.PowEntry]:
    """Application-level duplicate check (not a DB constraint), mirroring
    createPow()'s manual scan — subtopic is a variable-order comma-joined
    string a DB unique constraint couldn't safely dedupe. Scoped by
    subject/grade/week/chapter only, NOT by teacher_email — since POWs are
    now shared across every teacher of a subject (see get_pow_cards), a
    second section-teacher must find and open the existing card rather than
    create a duplicate."""
    candidates = db.query(models.PowEntry).filter(
        func.lower(models.PowEntry.subject) == subject.lower(),
        models.PowEntry.grade == str(grade),
        models.PowEntry.week_start == datetime.date.fromisoformat(week_start),
        func.lower(models.PowEntry.topic) == topic.lower(),
    ).all()
    for c in candidates:
        if (c.subtopic or "").lower() == (subtopic or "").lower():
            return c
    return None


def create_pow(db: Session, teacher_email: str, data) -> models.PowEntry:
    pow_entry = models.PowEntry(
        teacher_email=teacher_email.lower(),
        subject=data.subject,
        grade=data.grade,
        week_start=datetime.date.fromisoformat(data.week_start),
        week_end=datetime.date.fromisoformat(data.week_end),
        topic=data.topic,
        subtopic=data.subtopic or "",
        lp_session_num=data.lp_session_num or "",
        cw=data.cw or "",
        binder=data.binder or "",
        activity=data.activity or "",
        homework=data.homework or "",
        cct_topic_yn=data.cct_topic_yn or "No",
        cct_topic_text=data.cct_topic_text or "",
        cct_dashboard_updated=bool(data.cct_dashboard_updated),
        correction_done=data.correction_done or "",
        instructions=data.instructions or "",
        teacher_remarks=data.teacher_remarks or "",
        tbs_mom=data.tbs_mom or "",
        status="created",
    )
    db.add(pow_entry)
    db.commit()
    db.refresh(pow_entry)
    return pow_entry


def get_pow(db: Session, pow_id: int) -> Optional[models.PowEntry]:
    return db.query(models.PowEntry).filter(models.PowEntry.id == pow_id).first()


def update_pow_implementation(db: Session, pow_entry: models.PowEntry, data) -> models.PowEntry:
    """Only finalSave=true ever changes status (to 'final') — a non-final
    draft save never touches status, matching Code.gs's updatePowImpl()
    comment: 'Status always stays as-is after teacher saves'."""
    pow_entry.impl_a = data.impl_a or ""
    pow_entry.impl_b = data.impl_b or ""
    pow_entry.impl_c = data.impl_c or ""
    pow_entry.impl_d = data.impl_d or ""
    pow_entry.impl_e = data.impl_e or ""
    pow_entry.impl_f = data.impl_f or ""
    pow_entry.tbs_mom = data.tbs_mom or ""
    pow_entry.correction_done = data.correction_done or ""
    pow_entry.instructions = data.instructions or ""
    pow_entry.teacher_remarks = data.teacher_remarks or ""
    if data.final_save:
        pow_entry.status = "final"
    db.commit()
    db.refresh(pow_entry)
    return pow_entry


def save_sme_review(db: Session, pow_entry: models.PowEntry, sme_email: str, data) -> models.SmeReview:
    review = pow_entry.review
    if not review:
        review = models.SmeReview(pow_id=pow_entry.id, sme_email=sme_email)
        db.add(review)
    else:
        review.sme_email = sme_email  # reflects whichever SME is currently confirming, not just the first one

    if data.remarks is not None:
        review.remarks = data.remarks
        # SME adding remarks moves a POW from "To be Reviewed" to "Reviewed" —
        # but only once the teacher has actually final-saved it; an SME
        # jotting an early note on a still-in-progress POW shouldn't skip
        # straight past "To be Reviewed".
        if data.remarks.strip() and pow_entry.status == "final":
            pow_entry.status = "reviewed"
    if data.cct_discussed is not None:
        review.cct_discussed = bool(data.cct_discussed)
    if data.approved_closed is not None:
        review.approved_closed = bool(data.approved_closed)
        if review.approved_closed:
            # Closing the POW is a signed confirmation, not just a checkbox —
            # requires her typed name and the date she's confirming, both
            # captured alongside the login-derived sme_email.
            if not data.sme_name or not data.confirmed_date:
                raise ValueError("Name and date are required to confirm and close a POW.")
            review.sme_name = data.sme_name
            review.confirmed_date = datetime.date.fromisoformat(data.confirmed_date)
            pow_entry.status = "approved"

    db.commit()
    db.refresh(review)
    return review


# ─── Progress summary (monthly) ─────────────────────────────────────────────

def get_progress_summary(db: Session, subject: str, grade: int, teacher_email: Optional[str] = None):
    today = now_ist()
    month = today.strftime("%B")
    last_day = calendar.monthrange(today.year, today.month)[1]
    days_left = max(0, (datetime.date(today.year, today.month, last_day) - today.date()).days)

    chapters = get_planner_chapters(db, subject, grade)
    planned_chapters = [c for c in chapters if (c.month or "").lower() == month.lower()]
    total_sessions_planned = sum(c.sessions or 0 for c in planned_chapters)

    q = db.query(models.PowEntry).filter(
        _subject_group_filter(subject),
        models.PowEntry.grade == str(grade),
        models.PowEntry.status.in_(("approved", "final")),
    )
    if teacher_email:
        q = q.filter(func.lower(models.PowEntry.teacher_email) == teacher_email.lower())

    topic_session_map = {}
    for p in q.all():
        if p.week_start and p.week_start.strftime("%B") != month:
            continue
        topic = (p.topic or "").strip()
        if not topic:
            continue
        max_sess = _max_session_num(p.lp_session_num)
        if topic not in topic_session_map or max_sess > topic_session_map[topic]:
            topic_session_map[topic] = max_sess

    covered_topics = list(topic_session_map.keys())
    sessions_done = sum(topic_session_map[t] for t in covered_topics)

    topic_rows = []
    for c in planned_chapters:
        done = topic_session_map.get(c.chapter_name, 0)
        plan = c.sessions or 0
        pct = min(100, round(done / plan * 100)) if plan > 0 else 0
        topic_rows.append({
            "topic": c.chapter_name,
            "subtopic": c.topic or "",
            "sessions_planned": plan,
            "sessions_done": done,
            "sessions_left": max(0, plan - done),
            "pct": pct,
            "status": "pending" if done == 0 else ("done" if done >= plan else "in_progress"),
        })

    planned_names = {c.chapter_name for c in planned_chapters}
    extra_topics = [t for t in covered_topics if t not in planned_names]

    sessions_left = max(0, total_sessions_planned - sessions_done)
    weeks_left = days_left / 5
    sess_per_week = int(-(-sessions_left // weeks_left)) if weeks_left > 0 else sessions_left  # ceil

    return {
        "success": True,
        "month": month,
        "grade": grade,
        "days_left": days_left,
        "topics_planned": len(planned_chapters),
        "topics_covered": len([t for t in covered_topics if t in planned_names]),
        "total_sessions_planned": total_sessions_planned,
        "sessions_done": sessions_done,
        "sessions_left": sessions_left,
        "sess_per_week_needed": sess_per_week,
        "topic_rows": topic_rows,
        "extra_topics": extra_topics,
    }


# Which Curriculum Head owns which subject, by the split confirmed with the
# APM: Vinny Arora takes the languages plus Social Science, Chitra Venkatesh
# Prasanna takes Science (including its Biology/Physics/Chemistry streams),
# Mathematics and Kannada. Matched on NAME, not email — an email in the shared
# users table changed hands once already, and sending a subject's POWs to the
# wrong person is worse than sending to both.
CURRICULUM_HEAD_BY_SUBJECT = {
    "english": "Vinny",
    "hindi": "Vinny",
    "social science": "Vinny",
    "science": "Chitra",
    "biology": "Chitra",
    "physics": "Chitra",
    "chemistry": "Chitra",
    "mathematics": "Chitra",
    "kannada": "Chitra",
}


def can_edit_pow(user, pow_entry) -> bool:
    """Who may fill in a POW's IMPLEMENTATION. Nobody edits what another
    teacher planned: an SME reviews through remarks and Confirm & Close, not by
    rewriting the POW (confirmed with the APM).

    So: whoever teaches that subject, before their Confirm Final Save. POWs are
    shared across section teachers (see get_pow_cards) so it's subject-scoped
    rather than creator-scoped, and it's group-aware so a Science-tagged
    teacher reaches their Physics/Biology/Chemistry POWs. Leadership and
    Curriculum Heads are view-only."""
    from .auth import teaching_subjects, POW_VIEW_ONLY_DESIGNATIONS
    if (user.designation or "").strip().lower() in POW_VIEW_ONLY_DESIGNATIONS:
        return False
    if (pow_entry.subject or "").lower() not in {s.lower() for s in teaching_subjects(user)}:
        return False
    return pow_entry.status not in ("final", "reviewed", "approved")


def get_pow_notification_recipients(db: Session, teacher_email: str, subject: str = "") -> List[dict]:
    """Who hears about a POW: the SMEs this teacher is mapped to in
    teacher_sme, plus the Curriculum Head who owns that subject. A subject
    outside the mapping (Computer Science, PE...) goes to every head rather
    than to nobody. The teacher themselves is excluded — they just saved it."""
    recipients = {}

    teacher = db.query(models.User).filter(func.lower(models.User.email) == teacher_email.lower()).first()
    if teacher:
        sme_ids = [m.sme_id for m in db.query(models.TeacherSme).filter(models.TeacherSme.teacher_id == teacher.id).all()]
        if sme_ids:
            for sme in db.query(models.User).filter(models.User.id.in_(sme_ids)).all():
                if sme.email:
                    recipients[sme.email.lower()] = {"email": sme.email, "name": sme.name or sme.email, "why": "SME"}

    heads = db.query(models.User).filter(models.User.designation == "Curriculum Head").all()
    wanted = CURRICULUM_HEAD_BY_SUBJECT.get((subject or "").strip().lower())
    if wanted:
        matched = [h for h in heads if wanted.lower() in (h.name or "").lower()]
        heads = matched or heads   # never silently drop the notification
    for head in heads:
        if head.email:
            recipients.setdefault(head.email.lower(), {"email": head.email, "name": head.name or head.email, "why": "Curriculum Head"})

    recipients.pop(teacher_email.lower(), None)
    return list(recipients.values())


# ─── Backfill: curriculum covered before POWs began ─────────────────────────

def months_before_now() -> List[str]:
    """Academic months strictly earlier than the current one — the only months
    a backfill mark makes sense for. In August that's April to July."""
    current = now_ist().strftime("%B")
    cutoff = MONTH_INDEX.get(current)
    if cutoff is None:
        return []
    return [m for m in ACADEMIC_MONTHS if MONTH_INDEX[m] < cutoff]


def get_backfill_view(db: Session, subject: str, grade: int, teacher_email: str) -> dict:
    """The marking sheet: every planner chapter in a month already past, with
    its sub-topics and what's ticked so far.

    `locked` is the one-time rule — once a POW exists for this subject+grade,
    progress comes from POWs and the marking is closed for good."""
    rows = get_planner_rows(db, subject, grade)
    past = set(months_before_now())

    marks = db.query(models.CurriculumBackfill).filter(
        func.lower(models.CurriculumBackfill.teacher_email) == teacher_email.lower(),
        func.lower(models.CurriculumBackfill.subject) == subject.lower(),
        models.CurriculumBackfill.grade == int(grade),
    ).all()
    chapter_marks = {(m.month, m.chapter_name) for m in marks if not m.subtopic}
    item_marks = {(m.month, m.chapter_name, m.subtopic) for m in marks if m.subtopic}

    chapters = {}
    for r in rows:
        if r.month not in past:
            continue
        key = (r.month, r.chapter_name)
        entry = chapters.setdefault(key, {
            "month": r.month, "chapter_name": r.chapter_name, "sessions": r.sessions or 0,
            "done": key in chapter_marks, "items": [], "_seen": set(),
        })
        label = r.subtopic or r.topic
        if label and label not in entry["_seen"]:
            entry["_seen"].add(label)
            entry["items"].append({"label": label, "done": (r.month, r.chapter_name, label) in item_marks})

    out = []
    for entry in chapters.values():
        entry.pop("_seen")
        entry["items_done"] = sum(1 for i in entry["items"] if i["done"])
        out.append(entry)
    out.sort(key=lambda c: (MONTH_INDEX.get(c["month"], 99), c["chapter_name"]))

    # Locked per teacher: this teacher's own first POW closes their marking,
    # whatever colleagues sharing the class have filed.
    pow_count = db.query(func.count(models.PowEntry.id)).filter(
        func.lower(models.PowEntry.teacher_email) == teacher_email.lower(),
        _subject_group_filter(subject), models.PowEntry.grade == str(grade)
    ).scalar()

    return {
        "subject": subject, "grade": int(grade), "teacher_email": teacher_email,
        "months": months_before_now(),
        "chapters": out,
        "locked": bool(pow_count),
        "pow_count": int(pow_count or 0),
        "marked_by": next((m.marked_by for m in marks if m.marked_by), None),
    }


def save_backfill(db: Session, subject: str, grade: int, teacher_email: str,
                  marks: list, email: str) -> dict:
    """Replaces the marks for this subject+grade. A tick is a row; unticking
    removes it, so the table only ever states what WAS covered."""
    db.query(models.CurriculumBackfill).filter(
        func.lower(models.CurriculumBackfill.teacher_email) == teacher_email.lower(),
        func.lower(models.CurriculumBackfill.subject) == subject.lower(),
        models.CurriculumBackfill.grade == int(grade),
    ).delete(synchronize_session=False)

    saved = 0
    for m in marks:
        if not m.done:
            continue
        db.add(models.CurriculumBackfill(
            teacher_email=teacher_email.lower(), subject=subject, grade=int(grade),
            month=m.month, chapter_name=m.chapter_name,
            subtopic=m.subtopic or None, marked_by=email,
        ))
        saved += 1
    db.commit()
    return {"saved": saved}


def planner_item_counts(rows: List[models.PlannerTopic]) -> dict:
    """{(month, chapter_name): number of distinct topics/sub-topics}. Must be
    built from the FULL planner rows, not from get_planner_chapters() — that
    collapses each chapter to a single row, which would make every chapter look
    like it had exactly one sub-topic."""
    items = {}
    for r in rows:
        label = r.subtopic or r.topic
        if label:
            items.setdefault((r.month, r.chapter_name), set()).add(label)
    return {k: len(v) for k, v in items.items()}


def backfill_credit(marks: list, chapters: List[models.PlannerTopic], item_counts: dict) -> int:
    """Sessions to credit from backfill marks, for the progress/lag maths.

    A whole-chapter tick credits all its sessions. A part-marked chapter
    credits pro rata — 1 of 11 sub-topics ticked on a 26-session chapter counts
    2 — a rough but honest reading of "partly covered". item_counts comes from
    planner_item_counts(): using the deduped chapter list as the denominator
    credited the whole chapter for a single ticked sub-topic."""
    if not marks:
        return 0

    full = {(m.month, m.chapter_name) for m in marks if not m.subtopic}
    partial = {}
    for m in marks:
        if m.subtopic:
            partial.setdefault((m.month, m.chapter_name), set()).add(m.subtopic)

    total = 0
    for c in chapters:
        key = (c.month, c.chapter_name)
        sessions = c.sessions or 0
        if key in full:
            total += sessions
        elif key in partial:
            denominator = item_counts.get(key, 0)
            if denominator:
                total += round(sessions * len(partial[key]) / denominator)
    return total


# ─── Lagging report (leadership/SME dashboard) ──────────────────────────────

# Every leadership designation, the technical accounts included, has view
# access to the lag report. Kept as an (empty) set rather than deleted so a
# designation can be excluded again without restructuring the check.
LAGGING_EXCLUDED_DESIGNATIONS = set()


def can_see_lagging(role: str, designation: str) -> bool:
    """SMEs and HODs (both resolve to the SME role here), plus real leadership
    — MD, Chairman, Curriculum Head, DLP, APM, Principal, Coordinator."""
    if role == "SME":
        return True
    return role == "Leadership" and (designation or "").strip().lower() not in LAGGING_EXCLUDED_DESIGNATIONS


def _planner_position(chapters: List[models.PlannerTopic]):
    """Cumulative session maths shared by the chart and the lagging report:
    month order as the sheet lists it, sessions accumulated before each
    (chapter, month), and the running total at the end of each month."""
    month_order = []
    for c in chapters:
        if c.month and c.month not in month_order:
            month_order.append(c.month)

    cum_before = {}
    running = 0
    for c in chapters:
        cum_before[(c.chapter_name, c.month)] = running
        running += c.sessions or 0

    month_cum = {}
    at = 0
    for m in month_order:
        at += sum(c.sessions or 0 for c in chapters if c.month == m)
        month_cum[m] = at

    return month_order, cum_before, month_cum, running


def _all_planner_chapters(db: Session) -> dict:
    """Every subject+grade's chapter list, built from ONE query.

    get_planner_chapters() is per (subject, grade), which is fine for a single
    screen but not for the lag report: with a full curriculum loaded that was
    ~60 round trips to remote Postgres and took ~30s. The whole planner is only
    a few thousand rows, so it's read once and grouped in memory instead.

    Returns ({(subject_lower, grade): [first-seen (chapter, month) rows]},
    {(subject_lower, grade): {(month, chapter): item count}}) — the second is
    the denominator for pro-rata backfill credit.
    """
    rows = (
        db.query(models.PlannerTopic)
        .order_by(models.PlannerTopic.subject, models.PlannerTopic.display_order)
        .all()
    )
    by_key = {}
    for r in rows:
        by_key.setdefault((r.subject.lower(), r.grade), []).append(r)

    chapters = {}
    item_counts = {}
    for key, group in by_key.items():
        chapters[key] = chapters_from_rows(group)
        item_counts[key] = planner_item_counts(group)
    return chapters, item_counts


def _grouped_chapters(all_chapters: dict, subject: str, grade: int) -> List[models.PlannerTopic]:
    """Chapters for a subject+grade, expanding a grouped subject (Science ->
    its Biology/Physics/Chemistry streams) the same way get_planner_rows does."""
    out = []
    for member in subjects_in_group(subject):
        out.extend(all_chapters.get((member.lower(), int(grade)), []))
    return out


def get_lagging_report(db: Session, viewer_email: str, role: str) -> dict:
    """Where is each teacher against the curriculum mapping, right now.

    Expected position = every session the planner schedules up to and
    including the current month. Actual = the furthest point any of that
    teacher's POWs reaches (sessions accumulated before their chapter, plus
    the session number they marked). The difference is the lag, in sessions.

    Scoped to (teacher, subject, grade) combinations that actually have POWs —
    the app has no record of which classes a teacher is assigned, so a teacher
    who has never submitted a POW for a grade can't be distinguished from one
    who doesn't teach it. `teachers_without_pows` reports that gap separately
    rather than silently counting it as on-track.
    """
    today = now_ist()
    current_month = today.strftime("%B")

    teacher_map = _build_teacher_map(db, viewer_email, role)
    if not teacher_map:
        return {"generated_month": current_month, "rows": [], "teachers_without_pows": []}

    pows = db.query(models.PowEntry).filter(
        func.lower(models.PowEntry.teacher_email).in_(teacher_map.keys())
    ).order_by(models.PowEntry.week_start.asc()).all()

    # (teacher, subject, grade) -> their POWs
    buckets = {}
    for p in pows:
        buckets.setdefault((p.teacher_email.lower(), p.subject, p.grade), []).append(p)

    all_chapters, all_item_counts = _all_planner_chapters(db)   # one query, then all lookups are in memory

    # Backfill marks: what an SME recorded as covered before POWs began. Also
    # one query, grouped by (subject, grade).
    backfill_by_key = {}
    for m in db.query(models.CurriculumBackfill).all():
        key = ((m.teacher_email or "").lower(), m.subject.lower(), m.grade)
        backfill_by_key.setdefault(key, []).append(m)

    def credited(teacher, subject_name, grade_num, chapters):
        marks, items = [], {}
        for member in subjects_in_group(subject_name):
            marks.extend(backfill_by_key.get((teacher.lower(), member.lower(), int(grade_num)), []))
            items.update(all_item_counts.get((member.lower(), int(grade_num)), {}))
        return backfill_credit(marks, chapters, items) if marks else 0
    rows = []

    for (email, subject, grade), entries in buckets.items():
        try:
            grade_int = int(str(grade).strip())
        except (TypeError, ValueError):
            continue  # free-text grades like "7A" have no planner to compare against

        chapters = _grouped_chapters(all_chapters, subject, grade_int)
        if not chapters:
            continue  # nothing uploaded for this subject+grade — not a lag

        month_order, cum_before, month_cum, total_planned = _planner_position(chapters)

        # Everything scheduled up to and including the current month. Outside
        # the planner's own month range (e.g. April before the year starts)
        # nothing is due yet, so expected stays 0.
        expected = 0
        if current_month in month_order:
            expected = month_cum[current_month]
        elif month_order:
            months_elapsed = [m for m in month_order if MONTH_INDEX.get(m, 99) <= MONTH_INDEX.get(current_month, -1)]
            expected = month_cum[months_elapsed[-1]] if months_elapsed else 0

        done = 0
        last = None
        for p in entries:
            if not p.week_start:
                continue
            key = ((p.topic or "").strip(), p.week_start.strftime("%B"))
            reached = cum_before.get(key, 0) + _max_session_num(p.lp_session_num) if key in cum_before else 0
            if reached > done:
                done = reached
            if last is None or p.week_start > last.week_start:
                last = p

        # Backfill is a floor, not an addition: it states where the class had
        # already reached before POWs started, so progress is whichever is
        # further along.
        done = max(done, credited(email, subject, grade_int, chapters))
        behind = max(0, expected - done)
        info = teacher_map.get(email, {})
        weeks_since = ((today.date() - last.week_start).days // 7) if last and last.week_start else None

        rows.append({
            "teacher_email": email,
            "teacher_name": info.get("name") or email,
            "subject": subject,
            "grade": str(grade),
            "expected_sessions": expected,
            "done_sessions": done,
            "sessions_behind": behind,
            "total_planned": total_planned,
            "percent_done": round(done * 100 / expected) if expected else 100,
            "last_topic": (last.topic if last else "") or "",
            "last_week": last.week_start.isoformat() if last and last.week_start else None,
            "weeks_since_last_pow": weeks_since,
            "status": "behind" if behind > 0 else ("ahead" if done > expected else "on_track"),
        })

    # Assigned classes with NO POW at all. Only knowable from staff_roles —
    # without it a never-submitted class is indistinguishable from one the
    # teacher doesn't teach, which is why these rows appear only when the
    # directory is reachable.
    directory_available = staff_directory.is_available()
    if directory_available:
        covered = {(r["teacher_email"], r["subject"].lower(), r["grade"]) for r in rows}
        for email, info in teacher_map.items():
            for a in staff_directory.assignments_for(email):
                subject, grade_int = a["subject"], a["grade"]
                if (email, subject.lower(), str(grade_int)) in covered:
                    continue
                chapters = _grouped_chapters(all_chapters, subject, grade_int)
                if not chapters:
                    continue  # no curriculum uploaded for it — nothing to be behind on

                _, _, month_cum, total_planned = _planner_position(chapters)
                month_order = [c.month for c in chapters if c.month]
                expected = 0
                if current_month in month_cum:
                    expected = month_cum[current_month]
                else:
                    elapsed = [m for m in month_cum if MONTH_INDEX.get(m, 99) <= MONTH_INDEX.get(current_month, -1)]
                    expected = max((month_cum[m] for m in elapsed), default=0)
                if expected <= 0:
                    continue

                covered.add((email, subject.lower(), str(grade_int)))
                done_from_backfill = credited(email, subject, grade_int, chapters)
                rows.append({
                    "teacher_email": email,
                    "teacher_name": info.get("name") or email,
                    "subject": subject,
                    "grade": str(grade_int),
                    "expected_sessions": expected,
                    "done_sessions": done_from_backfill,
                    "sessions_behind": max(0, expected - done_from_backfill),
                    "total_planned": total_planned,
                    "percent_done": round(done_from_backfill * 100 / expected) if expected else 100,
                    "last_topic": "",
                    "last_week": None,
                    "weeks_since_last_pow": None,
                    "status": "behind" if expected > done_from_backfill else "on_track",
                    "no_pow_yet": True,
                })

    for r in rows:
        r.setdefault("no_pow_yet", False)
    rows.sort(key=lambda r: (-r["sessions_behind"], r["teacher_name"]))

    # Teachers the viewer oversees who have submitted nothing at all — a
    # different problem from being behind, and invisible in the rows above.
    with_pows = {r["teacher_email"] for r in rows if not r["no_pow_yet"]}
    without = [
        {"teacher_email": e, "teacher_name": i.get("name") or e, "subject": i.get("subject") or "",
         "assigned_classes": len(staff_directory.assignments_for(e)) if directory_available else None}
        for e, i in teacher_map.items()
        if e not in with_pows and not any(p.teacher_email.lower() == e for p in pows)
    ]

    return {
        "generated_month": current_month,
        "rows": rows,
        "teachers_without_pows": sorted(without, key=lambda t: t["teacher_name"]),
        # False means class assignments couldn't be read, so the report covers
        # only classes that already have POWs — the UI says so explicitly.
        "directory_available": directory_available,
    }


# ─── Progress chart (cumulative planned vs. actual) ─────────────────────────

def get_progress_chart(db: Session, subject: str, grade: int):
    """Fixes two real bugs found in Code.gs's getProgressData(subject):
    (1) it referenced an undeclared `grade` variable — this endpoint requires
    grade as a real param; (2) it built monthOrder/cumBefore from EVERY grade's
    planner rows for the subject at once, so same-named topics/chapters in
    different grades silently collided in the cumulative-session math — this
    scopes everything to the single (subject, grade) pair throughout."""
    chapters = get_planner_chapters(db, subject, grade)
    empty = {"success": True, "labels": [], "planned": [], "actual": [], "verdict": "No planner data",
             "total_planned": 0, "current_actual": 0, "analysis": []}
    if not chapters:
        return empty

    month_order = []
    for c in chapters:
        if c.month and c.month not in month_order:
            month_order.append(c.month)

    # Keyed by (chapter_name, month) — NOT chapter_name alone — since a
    # chapter can legitimately recur across multiple months with a
    # different position/session-count each time (see get_planner_chapters).
    cum_before = {}
    cum_total = 0
    for c in chapters:
        cum_before[(c.chapter_name, c.month)] = cum_total
        cum_total += c.sessions or 0
    total_planned = cum_total

    month_cum = {}
    running = 0
    for m in month_order:
        running += sum(c.sessions or 0 for c in chapters if c.month == m)
        month_cum[m] = running

    chapters_by_key = {(c.chapter_name, c.month): c for c in chapters}

    pows = db.query(models.PowEntry).filter(
        _subject_group_filter(subject),
        models.PowEntry.grade == str(grade),
    ).order_by(models.PowEntry.week_start.asc()).all()

    week_map = {}
    for p in pows:
        if not p.week_start:
            continue
        wk = p.week_start.isoformat()
        pow_month = p.week_start.strftime("%B")
        topic = (p.topic or "").strip()
        lp_session = _first_session_num(p.lp_session_num)
        # A POW's own week/month disambiguates WHICH occurrence of a
        # recurring chapter it refers to — match against that specific
        # (chapter, month) planner entry, not just the chapter name.
        key = (topic, pow_month)
        cum_actual = cum_before.get(key, 0) + lp_session if key in cum_before else 0
        if wk not in week_map or cum_actual > week_map[wk]["cum_actual"]:
            week_map[wk] = {"pow_month": pow_month, "topic": topic, "lp_session": lp_session, "cum_actual": cum_actual}

    weeks = sorted(week_map.keys())
    if not weeks:
        return {**empty, "verdict": "No POWs submitted yet"}

    labels, planned, actual, analysis = [], [], [], []
    for i, wk in enumerate(weeks):
        d = week_map[wk]
        labels.append(f"W{i + 1} ({_fmt_display_date(wk)})")
        actual.append(d["cum_actual"])
        planned.append(month_cum.get(d["pow_month"], 0))

        chapter = chapters_by_key.get((d["topic"], d["pow_month"]))
        planner_month = chapter.month if chapter else None
        planner_sessions = (chapter.sessions or 0) if chapter else 0
        pow_midx = month_order.index(d["pow_month"]) if d["pow_month"] in month_order else -1
        plan_midx = month_order.index(planner_month) if planner_month in month_order else -1

        if not chapter:
            status, detail = "unknown", "Topic not found in planner"
        elif d["pow_month"] == planner_month:
            if d["lp_session"] <= planner_sessions:
                status, detail = "on_track", f"Session {d['lp_session']}/{planner_sessions} in {d['pow_month']}"
            else:
                status, detail = "behind", f"Session {d['lp_session']} exceeds {planner_sessions} planned for {planner_month}"
        elif pow_midx >= 0 and plan_midx >= 0:
            status = "ahead" if pow_midx < plan_midx else "behind"
            detail = (f"Covering {planner_month} topic in {d['pow_month']} (ahead)" if status == "ahead"
                      else f"Should be in {planner_month}, currently in {d['pow_month']} (behind)")
        else:
            status, detail = "unknown", f'Month "{d["pow_month"]}" not in planner sequence'

        analysis.append({
            "week": _fmt_display_date(wk), "topic": d["topic"],
            "pow_month": d["pow_month"], "planner_month": planner_month or "—",
            "lp_session": d["lp_session"], "planner_sessions": planner_sessions,
            "status": status, "status_detail": detail,
        })

    latest = analysis[-1]
    verdict = ("Ahead of plan" if latest["status"] == "ahead"
               else "Behind plan" if latest["status"] == "behind"
               else "On track" if latest["status"] == "on_track"
               else "Unknown")

    return {
        "success": True, "labels": labels, "planned": planned, "actual": actual,
        "total_planned": total_planned, "current_actual": actual[-1] if actual else 0,
        "verdict": verdict, "analysis": analysis,
    }


def _fmt_display_date(iso: str) -> str:
    try:
        d = datetime.date.fromisoformat(iso)
        return d.strftime("%d %b")
    except ValueError:
        return iso
