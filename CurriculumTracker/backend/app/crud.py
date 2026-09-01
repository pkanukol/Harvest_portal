import datetime
import re
import calendar
from typing import Optional, List
from sqlalchemy.orm import Session, selectinload
from sqlalchemy import func, or_, true as sql_true
from . import models, staff_directory
from .config import settings

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


# Some sheets write a span rather than a single month - Social Science Grade 8
# has "Aug-Sep", "May-June-July", "Oct-Nov-Dec". MONTH_INDEX only knows whole
# month names, so every one of those sorted to 99 and counted as "not yet
# planned": the entire subject and grade came out blank on the reports.
#
# A span is placed by the FIRST month it names, which is when that stretch of
# teaching starts. The label is left exactly as the sheet wrote it, so nothing
# on screen is rewritten behind the SME's back.
_MONTH_WORD = re.compile(r"[A-Za-z]+")
# First three letters of each month -> its academic position. Three is enough
# to separate all twelve, and it absorbs both abbreviations ("Sep") and the
# odd typo ("Novemeber").
_MONTH_BY_PREFIX = {name.lower()[:3]: idx for name, idx in MONTH_INDEX.items()}


def month_position(label, default=99):
    """Where a month label sits in the academic year (April = 0)."""
    if not label:
        return default
    text = str(label).strip()
    if text in MONTH_INDEX:
        return MONTH_INDEX[text]
    for word in _MONTH_WORD.findall(text):
        idx = _MONTH_BY_PREFIX.get(word.lower()[:3])
        if idx is not None:
            return idx
    return default


def months_in_label(label):
    """Every month a label names: ["August", "September"] for "Aug-Sep"."""
    if not label:
        return []
    by_idx = {v: k for k, v in MONTH_INDEX.items()}
    out = []
    for word in _MONTH_WORD.findall(str(label)):
        idx = _MONTH_BY_PREFIX.get(word.lower()[:3])
        if idx is not None and by_idx[idx] not in out:
            out.append(by_idx[idx])
    return out


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


def _sessions_completed(raw: Optional[str], week_start, status: str) -> int:
    """How many of a chapter's sessions are DONE, from the session numbers a
    teacher ticked.

    A POW is written for the week ahead, so ticking 4 and 5 means 1-3 are
    already behind them and 4-5 are what's coming: while that week is still
    ahead, 3 sessions are complete. Once the week has started (or the teacher
    has done their final save) the ticked ones count too, so it's 5.
    """
    nums = [int(n) for n in re.findall(r"\d+", raw or "")]
    nums = [n for n in nums if n > 0]
    if not nums:
        return 0
    if status in FINALISED_STATUSES:
        return max(nums)
    today = now_ist().date()
    if week_start and week_start <= today:
        return max(nums)
    return min(nums) - 1        # the week is still ahead: only what precedes it


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


# Reverse index over SUBJECT_GROUPS, so membership works in BOTH directions.
# Asking for "Science" always returned the streams; asking for "Biology"
# returned only itself - and since every workbook and every POW is stored under
# "Science" with the stream in the Discipline column, choosing Biology found
# nothing at all.
_GROUP_BY_MEMBER = {
    member.lower(): (head, members)
    for head, members in SUBJECT_GROUPS.items()
    for member in members
}


def subjects_in_group(subject: str) -> List[str]:
    """The planner subjects a teacher of `subject` should see. Any member of a
    group resolves to the whole group; identity for everything else."""
    entry = _GROUP_BY_MEMBER.get((subject or "").strip().lower())
    return list(entry[1]) if entry else [subject]


def group_head(subject: str) -> str:
    """The name a grouped subject's own rows are stored under. Biology,
    Physics and Chemistry all belong to Science, and the curriculum, the POWs
    and the backfill marks are all recorded as "Science" - so anything this app
    WRITES for a stream is written under the head, and reads match the whole
    group."""
    entry = _GROUP_BY_MEMBER.get((subject or "").strip().lower())
    return entry[0].title() if entry else subject


def _backfill_branch_filter(model, branch: Optional[str]):
    """Rows for this campus only.

    Rows with no campus - marked before coverage became per campus - are
    deliberately NOT counted for anybody. Letting them stand in for whichever
    campus was being viewed showed Attibele coverage it had never been given,
    which is worse than showing none: the two campuses teach the same grade at
    their own pace and the marks belong to one of them. Saving a campus deletes
    them (see save_backfill), so they clear as coverage is re-marked.

    A blank branch means "no campus filter" - the whole-school view - and still
    sees everything."""
    if not branch:
        return sql_true()
    return func.lower(model.branch) == branch.lower()


def _backfill_subject_filter(subject: str):
    """Backfill marks belong to the subject GROUP, for the same reason POWs do
    (see _subject_group_filter): they are stored as "Science" while a Biology
    SME asks for "Biology". Without this, marks made under one name were
    invisible under the other - the year view read zero while the month view
    showed seven chapters covered."""
    group = [x.lower() for x in subjects_in_group(subject)]
    return func.lower(models.CurriculumBackfill.subject).in_(group)


def _backfill_confirmation_filter(subject: str):
    group = [x.lower() for x in subjects_in_group(subject)]
    return func.lower(models.BackfillConfirmation.subject).in_(group)


def stream_discipline(subject: str) -> Optional[str]:
    """The Discipline this subject names, when it names a stream rather than a
    whole group: "Biology" -> Biology, "Science" -> None. Bhuvana R is recorded
    as Biology in staff_roles but the curriculum is one Science workbook with a
    Discipline column, so picking Biology has to mean "Science, Biology only"
    rather than a subject of its own."""
    key = (subject or "").strip().lower()
    entry = _GROUP_BY_MEMBER.get(key)
    if not entry:
        return None
    head, members = entry
    if key == head.lower():
        return None                       # the group itself, not one stream
    return next((m for m in members if m.lower() == key), None)


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


def get_planner_chapters(db: Session, subject: str, grade: int) -> List["PlannerChapter"]:
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

    # Carries every field the progress screens read off a chapter. Keep this in
    # step with them: a missing attribute here is a 500 at request time, not an
    # error at import time (that's how `topic` went missing and broke
    # /api/progress/summary).
    __slots__ = ("chapter_name", "month", "first_month", "months", "sessions", "discipline",
                 "subject", "topic", "subtopic", "cct", "grade")

    def __init__(self, row):
        self.chapter_name = row.chapter_name
        self.month = row.month
        self.first_month = row.month
        # EVERY month the sheet lists this chapter in. A chapter spanning
        # August-September is being taught in both, so a monthly view must count
        # it in both — attributing it only to its last month made August look
        # like it had one chapter when the sheet plans four.
        self.months = [row.month]
        self.sessions = row.sessions or 0
        self.discipline = row.strands_of_language or row.discipline
        self.subject = row.subject
        self.grade = row.grade
        self.topic = row.topic
        self.subtopic = row.subtopic
        self.cct = row.cct


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
        if r.month and r.month not in entry.months:
            entry.months.append(r.month)
        # the largest stated count wins, so the plan is never under-stated
        entry.sessions = max(entry.sessions, r.sessions or 0)
        # and the chapter is due by the LAST month it appears in
        if month_position(r.month, -1) > month_position(entry.month, -1):
            entry.month = r.month
        if month_position(r.month, 99) < month_position(entry.first_month, 99):
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


def pow_author_emails(db: Session) -> set:
    """The SMEs and HODs recorded as teaching. Tiny table, read per request -
    and the env var stays honoured so an emergency addition needs no SQL."""
    listed = {e.lower() for (e,) in db.query(models.PowAuthor.email).all() if e}
    return listed | settings.pow_author_emails


def subject_variants(db: Session, subjects: list) -> list:
    """Planner subjects that are a LEVEL of one this person teaches:
    "Hindi (R3)" for a Hindi teacher.

    A third language is stored as its own subject so its curriculum does not
    collide with the main one for the same grade, which means staff_roles - it
    only ever says "Hindi" - would otherwise leave nobody able to file a POW
    against it."""
    if not subjects:
        return []
    mine = {x.strip().lower() for x in subjects if x}
    out = []
    rows = db.query(models.PlannerTopic.subject).distinct().all()
    for (name,) in rows:
        base = re.sub(r"\s*[\(\[][^)\]]*[\)\]]\s*$", "", name or "").strip().lower()
        if base and base != (name or "").strip().lower() and base in mine:
            out.append(name)
    return sorted(set(out))


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


# ─── Branches ───────────────────────────────────────────────────────────────

# The two campuses, as spelled in users.location. Staff are 'Kodathi',
# 'Attibele' or 'Both' (also seen lower-cased), and every TEACHER is on exactly
# one campus — 91 Kodathi, 45 Attibele — so a teacher list is always
# branch-separable.
BRANCHES = ["Kodathi", "Attibele"]


def normalize_branch(value: str) -> Optional[str]:
    v = (value or "").strip().lower()
    for b in BRANCHES:
        if v == b.lower():
            return b
    return None


def branches_for_viewer(location: str, oversees_subject: bool) -> List[str]:
    """The campuses this account may switch between.

    Normally their own. But an SME or HOD owns a SUBJECT, not a campus - they
    oversee Kodathi and Attibele separately and mark coverage for both - and
    their record still names the one campus they sit at. Reading that as a
    limit left a Kodathi SME unable to touch Attibele at all.
    """
    if oversees_subject:
        return list(BRANCHES)
    return viewer_branches(location) or list(BRANCHES)


def viewer_branches(location: str) -> Optional[List[str]]:
    """Which campuses this account may see. None = no restriction, which is
    what 'Both' and an unset location mean."""
    branch = normalize_branch(location)
    return [branch] if branch else None


# ─── POW cards (dashboard) ──────────────────────────────────────────────────

def _build_teacher_map(db: Session, user_email: str, role: str, branch: Optional[str] = None) -> dict:
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
        # Leadership sees every subject teacher on the campuses their own
        # account covers ('Both' covers all).
        allowed = viewer_branches(_viewer_location(db, user_email))
        for t in db.query(models.User).all():
            if not t.subject or t.designation == "Subject Matter Expert":
                continue
            if allowed and normalize_branch(t.location) not in allowed:
                continue
            teacher_map[t.email.lower()] = {"name": t.name or t.email, "subject": t.subject or "", "location": t.location or ""}
    else:
        # Teacher: share visibility across every teacher of the SAME subject,
        # not just cards this teacher personally created — different section
        # teachers (A-F) need to find and open the same shared POW card to
        # fill in their own section. Confirmed with user 2026-07-22.
        requester = db.query(models.User).filter(func.lower(models.User.email) == user_email.lower()).first()
        subject = requester.subject if requester else None
        own_branch = normalize_branch(requester.location if requester else "")
        if subject:
            for t in db.query(models.User).all():
                if not t.subject or t.subject.lower() != subject.lower():
                    continue
                # Shared POWs are shared within a campus: a Kodathi teacher has
                # no business in an Attibele section's POW.
                if own_branch and normalize_branch(t.location) != own_branch:
                    continue
                teacher_map[t.email.lower()] = {"name": t.name or t.email, "subject": t.subject or "", "location": t.location or ""}
        else:
            teacher_map[user_email.lower()] = {"name": "", "subject": "", "location": ""}

    # An SME's mapping crosses campuses (all 15 SMEs are mapped to teachers on
    # both), so for them branch is a FILTER over their mapped teachers rather
    # than a restriction — otherwise Ms Madhuri Jha, on Kodathi, would lose the
    # Attibele teachers she is the Hindi SME for.
    wanted = normalize_branch(branch)
    if wanted:
        teacher_map = {
            e: i for e, i in teacher_map.items()
            if normalize_branch(i.get("location")) == wanted
        }

    return teacher_map


def _viewer_location(db: Session, email: str) -> str:
    row = db.query(models.User.location).filter(func.lower(models.User.email) == email.lower()).first()
    return (row[0] if row else "") or ""


def branch_choices(db: Session, user_email: str, role: str) -> List[str]:
    """Campuses this viewer may switch between. A single-campus account gets
    just theirs; 'Both' gets whatever campuses actually appear in their own
    teacher list."""
    allowed = viewer_branches(_viewer_location(db, user_email))
    if allowed:
        return allowed
    present = {
        normalize_branch(i.get("location"))
        for i in _build_teacher_map(db, user_email, role).values()
    }
    return [b for b in BRANCHES if b in present]


def get_teachers_for_role(db: Session, user_email: str, role: str, branch: Optional[str] = None) -> list:
    teacher_map = _build_teacher_map(db, user_email, role, branch)
    return [{"email": email, **info} for email, info in teacher_map.items()]


def _card_dict(p: models.PowEntry, teacher_map: dict) -> dict:
    temail = p.teacher_email.lower()
    return {
        "id": p.id,
        "teacher_email": temail,
        "teacher_name": teacher_map.get(temail, {}).get("name") or temail,
        # Campus, so a both-branch view can label whose card is whose.
        "branch": teacher_map.get(temail, {}).get("location") or "",
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


def get_pow_cards(db: Session, user_email: str, role: str, subject: str, grade: str,
                  branch: Optional[str] = None):
    """Cards are only ever fetched once a subject+grade is picked (see
    main.py) — the dashboard no longer loads anything on mount, since the
    unfiltered query could span every grade of a subject for Leadership/SME
    and was the main reason the dashboard felt slow even with little data."""
    teacher_map = _build_teacher_map(db, user_email, role, branch)

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


# ─── Curriculum Overview ────────────────────────────────────────────────────

SECTION_LETTERS = "ABCDEF"

# Separator for fields the form keeps apart and this report merges.
NEWLINE = chr(10)


def _joined(*parts) -> str:
    """Fields the POW form keeps apart but the overview reports as one column
    (Class Work + Binder). Blank parts drop out, so a cell never opens with a
    stray separator."""
    return NEWLINE.join(p.strip() for p in parts if p and str(p).strip())


def _overview_cct(p) -> str:
    """CCT/Class test as one cell: the topic when there is one, otherwise the
    plain Yes/No the teacher ticked."""
    text = (p.cct_topic_text or "").strip()
    yn = (p.cct_topic_yn or "").strip()
    if text:
        return f"{yn}: {text}" if yn else text
    return yn


def get_curriculum_overview(db: Session, user_email: str, role: str, subject: str,
                            grade: str, branch: Optional[str] = None) -> dict:
    """Every POW filed for one subject+grade, as one week-by-week table — the
    view an SME or Curriculum Head reads across a whole grade rather than card
    by card.

    Implementation is reported per SECTION, one column each ("Implementation
    Date - 8 A", "8 B"...). Only sections that actually carry something are
    returned: a grade with two sections must not show four empty columns, and
    the app has no separate record of how many sections a grade runs.

    Scoped through the same teacher_map as the dashboard, so an SME sees their
    mapped teachers and a Curriculum Head sees the campus.
    """
    teacher_map = _build_teacher_map(db, user_email, role, branch)
    if not teacher_map:
        return {"subject": subject, "grade": grade, "sections": [], "rows": []}

    pows = (
        db.query(models.PowEntry)
        .filter(
            func.lower(models.PowEntry.teacher_email).in_(teacher_map.keys()),
            _subject_group_filter(subject),
            models.PowEntry.grade == str(grade),
        )
        .order_by(models.PowEntry.week_start.asc(), models.PowEntry.id.asc())
        .all()
    )

    # Asked for one stream of a grouped subject: keep the POWs whose chapter
    # belongs to that Discipline in the mapping. A chapter the mapping no longer
    # names is kept rather than dropped - an unattributable POW is better shown
    # than silently lost.
    stream = stream_discipline(subject)
    if stream:
        disc_of = {}
        for r in get_planner_rows(db, subject, int(grade)):
            d = r.strands_of_language or r.discipline
            if d and r.chapter_name not in disc_of:
                disc_of[r.chapter_name] = d
        pows = [
            p for p in pows
            if disc_of.get((p.topic or "").strip(), stream).lower() == stream.lower()
        ]

    def legacy_impl(p, letter):
        """The pre-session record: one field and one date pair per section for
        the whole week. Still read for the POWs filed that way."""
        return (
            (getattr(p, "impl_" + letter.lower(), None) or "").strip(),
            getattr(p, "impl_" + letter.lower() + "_date", None),
            getattr(p, "correction_" + letter.lower() + "_date", None),
        )

    # A section counts as present if anything names it: a session's plan, a
    # per-session record, or a legacy per-section field.
    named = {sp.section for p in pows for sp in p.section_plans}
    for p in pows:
        for x in p.sessions:
            named.update(y for y in (x.sections or "").split(",") if y)
            named.update(i.section for i in x.implementations)
        named.update(l for l in SECTION_LETTERS if any(legacy_impl(p, l)))
    sections = [l for l in SECTION_LETTERS if l in named]

    def group_sessions(p):
        """The POW's sessions grouped by the sections that share them - one
        group per plan. Sections taught the same thing belong on ONE row, with
        the topic stated once; a section that fell behind gets its own row."""
        groups = {}
        order = []
        for x in sorted(p.sessions, key=lambda y: y.display_order):
            letters = [y for y in (x.sections or "").split(",") if y]
            key = ",".join(sorted(letters)) if letters else ",".join(sections)
            if key not in groups:
                groups[key] = []
                order.append(key)
            groups[key].append(x)
        return [(k.split(",") if k else [], groups[k]) for k in order]

    rows = []
    for p in pows:
        temail = p.teacher_email.lower()
        base = {
            "id": p.id,
            "teacher_name": teacher_map.get(temail, {}).get("name") or temail,
            "branch": teacher_map.get(temail, {}).get("location") or "",
            "week_start": p.week_start.isoformat() if p.week_start else None,
            "week_end": p.week_end.isoformat() if p.week_end else None,
            "cct": _overview_cct(p),
            "instructions": (p.instructions or "").strip(),
            "tbs_mom": (p.tbs_mom or "").strip(),
            "status": STATUS_LABELS.get(p.status, p.status),
        }

        groups = group_sessions(p)

        # A POW filed before sessions existed: one row, its week-level boxes,
        # and whatever its per-section fields hold.
        if not groups:
            rows.append({
                **base,
                "row_index": 0,
                "sections": [l for l in sections if any(legacy_impl(p, l))] or sections,
                "lp_session_num": p.lp_session_num or "",
                "topic": p.topic or "",
                "subtopic": p.subtopic or "",
                "sessions": [],
                "classwork": _joined(p.cw, p.binder),
                "activity": (p.activity or "").strip(),
                "homework": (p.homework or "").strip(),
                "section_impl": {
                    l: {
                        "remarks": t,
                        "entries": [{"session_no": "", "completed_on": d.isoformat() if d else None,
                                     "correction_on": c.isoformat() if c else None}]
                        if (d or c) else [],
                    }
                    for l in sections
                    for t, d, c in [legacy_impl(p, l)]
                    if any(legacy_impl(p, l))
                },
            })
            continue

        for gi, (letters, group) in enumerate(groups):
            # The topic is stated once for the row, not repeated per section -
            # every section on the row is doing the same thing.
            topics = []
            for x in group:
                label = " - ".join(y for y in [(x.topic or "").strip(), (x.subtopic or "").strip()] if y)
                if label and label not in topics:
                    topics.append(label)

            section_impl = {}
            for letter in letters:
                entries = []
                remarks = []
                for x in group:
                    rec = next((i for i in x.implementations if i.section == letter), None)
                    if not rec:
                        continue
                    if rec.remarks:
                        remarks.append("S%s: %s" % (x.session_no or "?", rec.remarks))
                    if rec.completed_on or rec.correction_on:
                        entries.append({
                            "session_no": x.session_no or "",
                            "completed_on": rec.completed_on.isoformat() if rec.completed_on else None,
                            "correction_on": rec.correction_on.isoformat() if rec.correction_on else None,
                        })
                if entries or remarks:
                    section_impl[letter] = {"remarks": NEWLINE.join(remarks), "entries": entries}

            rows.append({
                **base,
                # Which of several rows for the same POW this is, so the table
                # can band them together as one week.
                "row_index": gi,
                "sections": letters,
                "lp_session_num": ", ".join(
                    x.session_no for x in group if (x.session_no or "").strip()
                ),
                "topic": next((x.chapter for x in group if x.chapter), p.topic or ""),
                "subtopic": NEWLINE.join(topics),
                "sessions": [
                    {
                        "session_no": x.session_no or "",
                        "chapter": x.chapter or "",
                        "topic": x.topic or "",
                        "subtopic": x.subtopic or "",
                        "classwork": _joined(x.cw, x.binder),
                        "activity": (x.activity or "").strip(),
                        "homework": (x.homework or "").strip(),
                        "lp_link": (x.lp_link or "").strip(),
                        "learning_outcomes": (x.learning_outcomes or "").strip(),
                    }
                    for x in group
                ],
                "classwork": NEWLINE.join(
                    "S%s: %s" % (x.session_no or "?", _joined(x.cw, x.binder))
                    for x in group if _joined(x.cw, x.binder)
                ),
                "activity": NEWLINE.join(
                    "S%s: %s" % (x.session_no or "?", (x.activity or "").strip())
                    for x in group if (x.activity or "").strip()
                ),
                "homework": NEWLINE.join(
                    "S%s: %s" % (x.session_no or "?", (x.homework or "").strip())
                    for x in group if (x.homework or "").strip()
                ),
                "section_impl": section_impl,
            })

    return {"subject": subject, "grade": grade, "sections": sections, "rows": rows}


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


def _all_pow_sections(data) -> list:
    """Every section this POW names, across its sessions. A session that names
    none is for all of them, and this is what "all of them" resolves to."""
    seen = []
    for s in getattr(data, "sessions", []) or []:
        for x in (getattr(s, "sections", []) or []):
            letter = (x or "").strip().upper()[:1]
            if letter and letter not in seen:
                seen.append(letter)
    return seen


def teacher_branch(db: Session, email: str) -> Optional[str]:
    """The campus a member of staff is on, normalised. 'Both' resolves to None
    - it is not a campus a POW can be filed for."""
    u = db.query(models.User).filter(func.lower(models.User.email) == (email or "").lower()).first()
    # viewer_branches returns None for 'Both' and for an unset location - both
    # mean "not one campus", so there is nothing to stamp.
    own = viewer_branches(u.location if u else "") or []
    return own[0] if len(own) == 1 else None


def create_pow(db: Session, teacher_email: str, data) -> models.PowEntry:
    # What the author had selected wins over what their record says: a 'Both'
    # account has no single campus to fall back on.
    chosen = normalize_branch(getattr(data, "branch", "") or "")
    pow_entry = models.PowEntry(
        teacher_email=teacher_email.lower(),
        branch=chosen if chosen in BRANCHES else teacher_branch(db, teacher_email),
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
    db.flush()          # need the id before the children can point at it

    for order, s in enumerate(getattr(data, "sessions", []) or []):
        db.add(models.PowSession(
            pow_id=pow_entry.id,
            session_no=(s.session_no or "").strip(),
            display_order=order,
            sections=",".join(
                x.strip().upper()[:1] for x in (getattr(s, "sections", []) or []) if x and x.strip()
            ),
            chapter=(getattr(s, "chapter", "") or "").strip() or data.topic,
            topic=(getattr(s, "topic", "") or "").strip(),
            subtopic=(getattr(s, "subtopic", "") or "").strip(),
            cw=s.cw or "", binder=s.binder or "",
            activity=s.activity or "", homework=s.homework or "",
            lp_link=(getattr(s, "lp_link", "") or "").strip(),
            learning_outcomes=(getattr(s, "learning_outcomes", "") or "").strip(),
        ))

    # Where each section ends the week - derived from ITS sessions, so nothing
    # has to be stated twice. A section's plan is the last session it was given,
    # which is exactly what the next POW should suggest it continues from.
    per_section = {}
    for order, s in enumerate(getattr(data, "sessions", []) or []):
        letters = [x.strip().upper()[:1] for x in (getattr(s, "sections", []) or []) if x and x.strip()]
        if not letters:
            # No sections named: the session is for the whole grade.
            letters = [x.strip().upper()[:1] for x in _all_pow_sections(data) if x]
        for letter in letters:
            per_section[letter] = s

    for letter, s in per_section.items():
        db.add(models.PowSectionPlan(
            pow_id=pow_entry.id,
            section=letter,
            subject=data.subject,
            grade=str(data.grade),
            week_start=pow_entry.week_start,
            chapter=(getattr(s, "chapter", "") or "").strip() or data.topic,
            topic=(getattr(s, "topic", "") or "").strip(),
            subtopic=(getattr(s, "subtopic", "") or "").strip(),
        ))

    db.commit()
    db.refresh(pow_entry)
    return pow_entry


def last_section_plans(db: Session, subject: str, grade: str,
                       branch: Optional[str] = None) -> dict:
    """Where each section got to, most recent first.

    What the new POW form suggests from: 6A finished "Adaptations" last week
    while a holiday left 6B still on "Habitats", so each section starts from
    its own last recorded plan rather than from the grade's."""
    rows = (
        db.query(models.PowSectionPlan)
        .filter(
            func.lower(models.PowSectionPlan.subject).in_(
                [s.lower() for s in subjects_in_group(subject)]
            ),
            models.PowSectionPlan.grade == str(grade),
            *( [models.PowSectionPlan.pow_id.in_(
                   db.query(models.PowEntry.id).filter(
                       func.lower(models.PowEntry.branch) == branch.lower()))]
               if normalize_branch(branch or "") in BRANCHES else [] ),
        )
        .order_by(models.PowSectionPlan.week_start.asc(), models.PowSectionPlan.id.asc())
        .all()
    )
    latest = {}
    for r in rows:
        latest[r.section] = {
            "section": r.section,
            "chapter": r.chapter or "",
            "topic": r.topic or "",
            "subtopic": r.subtopic or "",
            "week_start": r.week_start.isoformat() if r.week_start else None,
        }
    return latest


def get_pow(db: Session, pow_id: int) -> Optional[models.PowEntry]:
    return db.query(models.PowEntry).filter(models.PowEntry.id == pow_id).first()


IMPLEMENTATION_FIELDS = ("impl_a", "impl_b", "impl_c", "impl_d", "impl_e", "impl_f",
                         "tbs_mom", "correction_done", "instructions", "teacher_remarks")
IMPLEMENTATION_DATE_FIELDS = (
    tuple(f"impl_{s}_date" for s in "abcdef")
    + tuple(f"correction_{s}_date" for s in "abcdef")
)


def _as_date(value):
    """"" clears the date; None means the caller did not send it."""
    if value is None:
        return None
    return datetime.date.fromisoformat(value) if value else None


def save_session_impl(db: Session, pow_entry: models.PowEntry, rows: list) -> int:
    """Upsert what each section did in each session.

    Keyed on (session, section) so a section teacher can save theirs without
    touching anyone else's, and can come back and add a date later without
    retyping their remarks. Sessions that do not belong to this POW are
    ignored rather than trusted from the request."""
    if not rows:
        return 0
    own = {s.id: s for s in pow_entry.sessions}
    saved = 0
    for r in rows:
        session = own.get(r.session_id)
        letter = (r.section or "").strip().upper()[:1]
        if not session or not letter:
            continue
        existing = next((x for x in session.implementations if x.section == letter), None)
        if existing is None:
            existing = models.PowSessionImpl(session_id=session.id, section=letter)
            db.add(existing)
            session.implementations.append(existing)
        if r.remarks is not None:
            existing.remarks = r.remarks
        if r.completed_on is not None:
            existing.completed_on = _as_date(r.completed_on)
        if r.correction_on is not None:
            existing.correction_on = _as_date(r.correction_on)
        saved += 1
    return saved


def session_impl_rows(pow_entry: models.PowEntry) -> list:
    """Every (session, section) record this POW holds, for the API to return."""
    out = []
    for s in pow_entry.sessions:
        for x in s.implementations:
            out.append({
                "session_id": s.id,
                "section": x.section,
                "remarks": x.remarks or "",
                "completed_on": x.completed_on.isoformat() if x.completed_on else None,
                "correction_on": x.correction_on.isoformat() if x.correction_on else None,
            })
    return out


def update_pow_implementation(db: Session, pow_entry: models.PowEntry, data) -> models.PowEntry:
    """Only finalSave=true ever changes status (to 'final') — a non-final
    draft save never touches status, matching Code.gs's updatePowImpl()
    comment: 'Status always stays as-is after teacher saves'.

    Only fields the caller actually sent are written. This used to assign all
    ten unconditionally, so saving one section blanked the others — a real risk
    with A-F filled in by different section teachers, and it silently wiped the
    implementation when only the TBS MOM was being saved."""
    for field in IMPLEMENTATION_FIELDS:
        value = getattr(data, field, None)
        if value is not None:
            setattr(pow_entry, field, value)
    for field in IMPLEMENTATION_DATE_FIELDS:
        value = getattr(data, field, None)
        if value is None:
            continue
        setattr(pow_entry, field, datetime.date.fromisoformat(value) if value else None)
    save_session_impl(db, pow_entry, getattr(data, "session_impl", []) or [])
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

# ─── POW permissions ────────────────────────────────────────────────────────

FINALISED_STATUSES = ("final", "reviewed", "approved")


def teaches_pow_subject(user, pow_entry) -> bool:
    """Does this person teach the POW's subject at all? POWs are shared across
    the section teachers of a subject (see get_pow_cards), so this is
    subject-scoped rather than creator-scoped, and group-aware so a
    Science-tagged teacher reaches their Physics/Biology/Chemistry POWs.
    Leadership and Curriculum Heads are view-only."""
    from .auth import teaching_subjects, POW_VIEW_ONLY_DESIGNATIONS
    if (user.designation or "").strip().lower() in POW_VIEW_ONLY_DESIGNATIONS:
        return False
    return (pow_entry.subject or "").lower() in {s.lower() for s in teaching_subjects(user)}


def can_edit_pow(user, pow_entry) -> bool:
    """Who may fill in a POW's IMPLEMENTATION: any teacher of that subject,
    until Confirm Final Save locks it. Nobody edits what another teacher
    planned — an SME reviews through remarks and Confirm & Close."""
    return teaches_pow_subject(user, pow_entry) and pow_entry.status not in FINALISED_STATUSES


def can_edit_tbs_mom(user, pow_entry) -> bool:
    """TBS MOM has a window, not a permission: it opens at Confirm Final Save
    (the discussion it records happens after the POW is finalised, which is
    what the missing-MOM reminder chases) and closes once it has been filled in
    and saved. A recorded minute isn't something to rewrite later."""
    if not teaches_pow_subject(user, pow_entry):
        return False
    if pow_entry.status not in FINALISED_STATUSES:
        return False                                  # not due yet — field is hidden
    return not (pow_entry.tbs_mom or "").strip()      # only while still empty


# ─── POW notifications ──────────────────────────────────────────────────────

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


def planner_disciplines(db: Session, subject: str, grade: int) -> List[str]:
    """Disciplines this subject+grade is split into, in sheet order. Science is
    Biology/Chemistry/Physics from Grade 5 up (EVS in 1-2, plain Science in
    3-4); English and Hindi use Strands of Language in the same column."""
    out = []
    for r in get_planner_rows(db, subject, grade):
        d = r.strands_of_language or r.discipline
        if d and d not in out:
            out.append(d)
    return out


def default_discipline_for(user_subjects: List[str], available: List[str]) -> Optional[str]:
    """An SME of a discipline lands on it by default. Bhuvana R is Science in
    the portal but Biology in staff_roles, Deepak Physics, Francis Joy
    Chemistry — so their own subject list is what picks the discipline."""
    lowered = {d.lower(): d for d in available}
    for s in user_subjects or []:
        if s.lower() in lowered:
            return lowered[s.lower()]
    return None


def sections_by_grade(allowed: Optional[set] = None) -> dict:
    """{(subject lowercased, grade): [sections]} for a campus, in ONE pass over
    the staff directory and no database round trips.

    sections_for_grade answers the same question for a single grade, but the
    management report asks it for every subject and grade at once - forty
    separate calls, each with a fallback query, and the report took fifty
    seconds against a remote database.
    """
    out = {}
    for email, entry in staff_directory.get_directory().items():
        if allowed is not None and email not in allowed:
            continue
        for a in entry.get("assignments", []):
            sec = (a.get("section") or "").strip().upper()[:1]
            grade = str(a.get("grade") or "").strip()
            subject = (a.get("subject") or "").strip().lower()
            if not sec or not grade:
                continue
            # Recorded against the stream ("Biology"); the report asks by the
            # group as well, so both keys are filled.
            for key_subject in {subject, group_head(subject).lower() if subject else ""}:
                if key_subject:
                    out.setdefault((key_subject, grade), set()).add(sec)
    return {k: [l for l in SECTION_LETTERS if l in v] for k, v in out.items()}


def sections_for_grade(db: Session, subject: str, grade: str, branch: Optional[str] = None,
                       allowed: Optional[set] = None) -> list:
    """Which sections a campus actually runs for this subject+grade.

    Attibele runs two sections of a grade where Kodathi runs five or six, so
    offering A-F everywhere invites a teacher to file against a section that
    does not exist. Read from the assigned classes in staff_roles
    ("Science|6A"), narrowed to the teachers at this campus, and falling back
    to whatever POWs already name if the directory is unreachable.
    """
    wanted_subjects = {x.lower() for x in subjects_in_group(subject)}
    # The caller may already have the campus's teacher set (the branch
    # comparison does, for ten grades) - building it per call made that twenty
    # full staff scans.
    if allowed is None and branch:
        allowed = set(_build_teacher_map(db, "", "Leadership", branch).keys())

    letters = set()
    for email, entry in staff_directory.get_directory().items():
        if allowed is not None and email not in allowed:
            continue
        for a in entry.get("assignments", []):
            if str(a.get("grade")) != str(grade):
                continue
            if a.get("subject") and a["subject"].lower() not in wanted_subjects:
                continue
            sec = (a.get("section") or "").strip().upper()[:1]
            if sec:
                letters.add(sec)

    if not letters:
        # Nothing in the directory: fall back to the sections POWs already use
        # on this campus, so an existing grade keeps working.
        q = db.query(models.PowSession).join(models.PowEntry).filter(
            _subject_group_filter(subject),
            models.PowEntry.grade == str(grade),
        )
        if allowed is not None:
            q = q.filter(func.lower(models.PowEntry.teacher_email).in_(allowed or {""}))
        for row in q.all():
            letters.update(x for x in (row.sections or "").split(",") if x)

    return [l for l in SECTION_LETTERS if l in letters]


def progress_scope(db: Session, user_email: str, role: str, branch: Optional[str] = None) -> set:
    """The teachers whose POWs count towards a progress reading: the ones this
    viewer oversees on the selected campus. Same map the dashboard and the
    Curriculum Overview use, so all three describe the same set of people."""
    return set(_build_teacher_map(db, user_email, role, branch).keys())


def get_progress_summary(db: Session, subject: str, grade: int, teacher_email: Optional[str] = None,
                         discipline: Optional[str] = None, teacher_emails: Optional[set] = None,
                         branch: Optional[str] = None):
    """One table's worth of truth for the month: per chapter, what was planned
    and what has actually been done, with the POW detail behind each row. The
    headline tiles are derived from these same rows, so they cannot disagree.

    Three things count as done:
      * a POW on the chapter (see _sessions_completed for the session rule),
      * a chapter EARLIER in its discipline's order than one already started —
        teaching moves through a discipline in sequence, so starting chapter 3
        means 1 and 2 are behind you,
      * an SME's backfill mark.
    """
    today = now_ist()
    month = today.strftime("%B")
    last_day = calendar.monthrange(today.year, today.month)[1]
    days_left = max(0, (datetime.date(today.year, today.month, last_day) - today.date()).days)

    rows = get_planner_rows(db, subject, grade)
    all_chapters = chapters_from_rows(rows)
    disciplines = planner_disciplines(db, subject, grade)

    wanted = (discipline or "").strip().lower()
    scoped = [c for c in all_chapters if not wanted or (c.discipline or "").lower() == wanted]

    # A chapter belongs to this month if the sheet lists it in this month.
    month_chapters = [c for c in scoped if month in (c.months or [])]

    q = db.query(models.PowEntry).filter(
        _subject_group_filter(subject),
        models.PowEntry.grade == str(grade),
    )
    if teacher_email:
        q = q.filter(func.lower(models.PowEntry.teacher_email) == teacher_email.lower())
    # Campus scoping: the caller passes the set of teachers this viewer may see
    # on the selected branch, so a Kodathi view never counts Attibele's POWs.
    # An empty set means the viewer oversees nobody there - no POWs, not all.
    if teacher_emails is not None:
        q = q.filter(func.lower(models.PowEntry.teacher_email).in_(teacher_emails or {""}))
    pows = q.order_by(models.PowEntry.week_start.asc()).all()

    pows_by_chapter = {}
    for p in pows:
        pows_by_chapter.setdefault((p.topic or "").strip(), []).append(p)

    # Sequential completion, computed per DISCIPLINE: a Biology chapter being
    # under way says nothing about Physics, so each discipline is its own track.
    implied_complete = set()
    for disc in (disciplines or [None]):
        track = [c for c in all_chapters if (c.discipline or None) == disc] if disc else list(all_chapters)
        started = [i for i, c in enumerate(track) if pows_by_chapter.get(c.chapter_name)]
        if started:
            implied_complete.update(c.chapter_name for c in track[:max(started)])

    marks = db.query(models.CurriculumBackfill).filter(
        _backfill_subject_filter(subject),
        models.CurriculumBackfill.grade == int(grade),
        _backfill_branch_filter(models.CurriculumBackfill, branch),
    ).all()
    # Scoped to THIS month. A chapter spanning July and August, marked covered
    # for July, is not covered for August - crediting the mark to both months
    # read "11 of 11 done" in August while the POW said session 9.
    marked_full = {m.chapter_name for m in marks if not m.subtopic and m.month == month}
    marked_items = {}
    for m in marks:
        if m.subtopic and m.month == month:
            marked_items.setdefault(m.chapter_name, set()).add(m.subtopic)
    item_counts = planner_item_counts(rows)
    items_by_chapter = {}
    for (mth, ch), n in item_counts.items():
        items_by_chapter[ch] = items_by_chapter.get(ch, 0) + n

    def sessions_done_for(c) -> int:
        planned = c.sessions or 0
        done = 0
        for p in pows_by_chapter.get(c.chapter_name, []):
            done = max(done, _sessions_completed(p.lp_session_num, p.week_start, p.status))
        if c.chapter_name in implied_complete or c.chapter_name in marked_full:
            done = max(done, planned)
        elif c.chapter_name in marked_items:
            total_items = items_by_chapter.get(c.chapter_name, 0)
            if total_items:
                done = max(done, round(planned * len(marked_items[c.chapter_name]) / total_items))
        return min(done, planned) if planned else done

    chapter_rows = []
    for c in month_chapters:
        planned = c.sessions or 0
        done = sessions_done_for(c)
        entries = []
        for p in pows_by_chapter.get(c.chapter_name, []):
            sections = []
            for letter in "ABCDEF":
                remark = (getattr(p, "impl_" + letter.lower(), None) or "").strip()
                completed_on = getattr(p, "impl_" + letter.lower() + "_date", None)
                if not remark and not completed_on:
                    continue
                sections.append({
                    "section": letter,
                    "completed_on": completed_on.isoformat() if completed_on else None,
                    "remark": remark,
                })
            entries.append({
                "pow_id": p.id,
                "teacher_email": p.teacher_email,
                "week_start": p.week_start.isoformat() if p.week_start else None,
                "subtopic": p.subtopic or "",
                "sessions_marked": p.lp_session_num or "",
                "sessions_completed": _sessions_completed(p.lp_session_num, p.week_start, p.status),
                "status": STATUS_LABELS.get(p.status, p.status),
                "sections": sections,
            })

        why = []
        if pows_by_chapter.get(c.chapter_name):
            why.append("POW")
        if c.chapter_name in implied_complete:
            why.append("a later chapter has started")
        if c.chapter_name in marked_full or c.chapter_name in marked_items:
            why.append("marked by SME")

        chapter_rows.append({
            "chapter": c.chapter_name,
            "discipline": c.discipline or "",
            "months": c.months,
            "sessions_planned": planned,
            "sessions_done": done,
            "sessions_left": max(0, planned - done),
            "pct": min(100, round(done * 100 / planned)) if planned else 0,
            "status": "done" if planned and done >= planned else ("in_progress" if done else "pending"),
            "counted_from": ", ".join(why),
            "entries": entries,
        })

    total_planned = sum(r["sessions_planned"] for r in chapter_rows)
    total_done = sum(r["sessions_done"] for r in chapter_rows)
    sessions_left = max(0, total_planned - total_done)
    weeks_left = max(1, days_left / 5)

    # Chapters worked on this month that the sheet doesn't plan for this month.
    planned_names = {r["chapter"] for r in chapter_rows}
    discipline_of = {c.chapter_name: (c.discipline or "") for c in all_chapters}
    extra = []
    for name, plist in pows_by_chapter.items():
        if name in planned_names or not name:
            continue
        # Don't report another discipline's chapter as an anomaly here: with a
        # Physics filter on, a Biology POW is simply out of scope, not 'extra'.
        if wanted and discipline_of.get(name, "").lower() != wanted:
            continue
        if any(p.week_start and p.week_start.strftime("%B") == month for p in plist):
            extra.append(name)

    return {
        "success": True,
        "month": month,
        "grade": grade,
        "days_left": days_left,
        "disciplines": disciplines,
        "discipline": discipline or "",
        "topics_planned": len(chapter_rows),
        "topics_covered": sum(1 for r in chapter_rows if r["status"] == "done"),
        "total_sessions_planned": total_planned,
        "sessions_done": total_done,
        "sessions_left": sessions_left,
        "sess_per_week_needed": int(-(-sessions_left // weeks_left)),
        "chapter_rows": chapter_rows,
        "extra_topics": extra,
    }


# ─── Annual progress (leadership) ───────────────────────

# What a teacher's chosen Topic/Sub Topic is joined with on the POW form
# (POWForm.jsx: [topic, subtopic].join(" — ")), and therefore what splits it
# back apart here.
PICK_SEPARATOR = " — "


def annual_planner_tree(rows) -> list:
    """The year's curriculum for one subject+grade as chapter -> topic ->
    sub-topic, in sheet order.

    Sessions are counted ONCE PER UNIQUE CHAPTER - the figure the sheet states
    for it, not a sum of its rows. The mapping repeats a chapter's total on
    every row it occupies, including across months: English Grade 4's "Wit &
    Humour" reads 34 in May, June and July for one 34-session chapter. Summing
    those made it 102 and the Grade 4 year total 330 instead of 122.

    Where a chapter's months disagree (Science Grade 6 has "Temperature and its
    measurement" as 3 in October and 5 in November) the larger figure wins, so
    the plan is never under-stated, and the disagreement is reported in
    `session_conflicts` for someone to settle in the sheet.

    Chapters with no chapter name are already the promoted Topic - see
    excel_import.WORK_UNIT_FIELDS - so "unique chapter" covers the
    topic-planned sheets too.
    """
    chapters = {}
    order = []
    seen_month_sessions = set()

    for r in rows:
        name = r.chapter_name
        if name not in chapters:
            chapters[name] = {
                "chapter": name,
                "discipline": r.strands_of_language or r.discipline or "",
                "months": [],
                # {month: the figure the sheet states there}; the chapter's own
                # total is the largest of them, and is shared back across the
                # months for month-by-month views.
                "month_sessions": {},
                "topics": {},
                "topic_order": [],
            }
            order.append(name)
        c = chapters[name]

        if r.month and r.month not in c["months"]:
            c["months"].append(r.month)
        key = (name, r.month)
        if key not in seen_month_sessions:
            seen_month_sessions.add(key)
            # What the sheet states for this chapter in this month. The
            # chapter's own total is resolved from these below, not accumulated
            # here.
            c["month_sessions"][r.month] = r.sessions or 0

        topic = (r.topic or "").strip()
        if topic not in c["topics"]:
            c["topics"][topic] = []
            c["topic_order"].append(topic)
        sub = (r.subtopic or "").strip()
        if sub and sub not in c["topics"][topic]:
            c["topics"][topic].append(sub)

    out = []
    for name in order:
        c = chapters[name]
        stated = [v for v in c["month_sessions"].values() if v]
        total = max(stated) if stated else 0
        conflict = len(set(stated)) > 1

        # The chapter's one total, spread over the months it occupies so a
        # month-by-month view (the year chart, and crediting a month an SME
        # marked) still adds back up to it. Remainders go to the earliest
        # months, which is the order the sessions are taught in.
        months = [m for m in c["months"] if m]
        share = {}
        if months and total:
            base, extra = divmod(total, len(months))
            for i, m in enumerate(sorted(months, key=lambda x: month_position(x, 99))):
                share[m] = base + (1 if i < extra else 0)

        out.append({
            "chapter": c["chapter"],
            "discipline": c["discipline"],
            "months": c["months"],
            "sessions": total,
            "month_sessions": share,
            "session_conflict": conflict,
            "stated_sessions": c["month_sessions"],
            "topics": [{"topic": t, "subtopics": list(c["topics"][t])} for t in c["topic_order"]],
        })
    return out


def _leaf_keys(chapter: dict) -> list:
    """The finest unit a tick can be placed on. A chapter planned down to
    sub-topics is complete only when its sub-topics are; one planned only to
    topics is judged on topics; one with neither is its own leaf."""
    leaves = []
    for t in chapter["topics"]:
        if t["subtopics"]:
            leaves.extend((t["topic"], sub) for sub in t["subtopics"])
        else:
            leaves.append((t["topic"], ""))
    return leaves or [("", "")]


def _pow_targets(p, chapter: dict) -> list:
    """Which leaves of a chapter one POW speaks for. The form stores the pick
    as "Topic — Sub Topic", or just the one it offered when the sheet has no
    real topics, so a single value is matched against both levels before being
    discarded."""
    raw = (p.subtopic or "").strip()
    parts = [x.strip() for x in raw.split(PICK_SEPARATOR) if x.strip()] if raw else []
    leaves = _leaf_keys(chapter)

    if len(parts) >= 2:
        topic, sub = parts[0], parts[1]
        hit = [l for l in leaves if l == (topic, sub)]
        if hit:
            return hit
        parts = [sub]          # fall through: the sub-topic alone may still match

    if len(parts) == 1:
        value = parts[0]
        hit = [l for l in leaves if l[1] == value]
        if hit:
            return hit
        hit = [l for l in leaves if l[0] == value]
        if hit:
            return hit

    # No usable pick (or one that no longer exists in a re-uploaded sheet):
    # the POW is evidence for the chapter as a whole.
    return leaves


def implied_complete_chapters(chapters: list, pows_by_chapter: dict, disciplines: list) -> set:
    """Chapters behind one that is already under way, per DISCIPLINE.

    Teaching moves through a discipline in sequence, so starting chapter 3 means
    1 and 2 are done. Biology being under way says nothing about Physics, hence
    one track per discipline."""
    out = set()
    for disc in (disciplines or [None]):
        track = [c for c in chapters if (c["discipline"] or None) == disc] if disc else list(chapters)
        started = [i for i, c in enumerate(track) if pows_by_chapter.get(c["chapter"])]
        if started:
            out.update(c["chapter"] for c in track[:max(started)])
    return out


def chapter_sessions_done(chapters: list, pows_by_chapter: dict, marked_full: set,
                          marked_months: dict, marked_labels: dict, implied: set) -> dict:
    """{chapter: sessions done}. The one place this rule lives, so the year
    view, the charts and the branch comparison can never drift apart.

    Sessions are recorded on the POW for the CHAPTER, not per section
    (lp_session_num is one field for the class), so this is grade-wide.
    """
    out = {}
    for c in chapters:
        name, planned = c["chapter"], c["sessions"]
        done = 0
        for p in pows_by_chapter.get(name, []):
            done = max(done, _sessions_completed(p.lp_session_num, p.week_start, p.status))
        if name in marked_full or name in implied:
            done = max(done, planned)
        else:
            # Credit the sessions of the months that WERE marked. Session
            # numbers on a POW count the chapter, not the month, so this is a
            # max rather than a sum - two readings of the same chapter, not two
            # separate stretches of work.
            marked = marked_months.get(name, set())
            if marked:
                done = max(done, sum(v for m, v in c["month_sessions"].items() if m in marked))
            if name in marked_labels:
                leaves = _leaf_keys(c)
                if leaves:
                    done = max(done, round(planned * len(marked_labels[name]) / len(leaves)))
        out[name] = min(done, planned) if planned else done
    return out


# Subjects shown as one column per discipline in the management report.
# Science and Social Science are taught as separate streams with their own
# teachers; Mathematics carries "disciplines" too (Arithmetic, Geometry...) but
# those are strands of one subject taught by one teacher, so it stays a single
# column.
REPORT_SPLIT_SUBJECTS = {"science", "social science"}


def _variance(done: float, expected: float):
    """How far ahead or behind the plan, as a percentage of what should have
    been covered by now. None when nothing is planned yet - a blank cell rather
    than a misleading zero."""
    if not expected:
        return None
    return round((done - expected) * 100.0 / expected)


# The report reads the whole planner and every POW, and the round trips to a
# remote Postgres dominate. It is read-only and identical for everyone with the
# same scope, so it is held briefly rather than rebuilt per viewer - a
# management page with several readers would otherwise pay for each of them.
_REPORT_CACHE = {}
_REPORT_TTL_SECONDS = 300


def _report_cache_get(key):
    hit = _REPORT_CACHE.get(key)
    if not hit:
        return None
    stamp, value = hit
    if (now_ist() - stamp).total_seconds() > _REPORT_TTL_SECONDS:
        _REPORT_CACHE.pop(key, None)
        return None
    return value


def delivery_report(db: Session, user_email: str, role: str, branch: Optional[str] = None,
                    fresh: bool = False) -> dict:
    """Grade x subject delivery for one campus, as the management report.

    Each cell is how far ahead or behind that class is against the sessions the
    mapping expects to have been covered by now - not how much of the year is
    done, which always reads low in September. A grade's figure is the average
    of its sections, and each grade opens into those sections.

    Built from a handful of bulk queries: per-subject-per-grade readings would
    be about fifty round trips.
    """
    today = now_ist()
    this_month = today.strftime("%B")
    month_cut = month_position(this_month, 99)

    scope = set(_build_teacher_map(db, user_email, role, branch))
    # Keyed on the scope, not the viewer: two people who oversee the same
    # teachers see the same report and can share the cached one.
    cache_key = (normalize_branch(branch) if branch else "", this_month, tuple(sorted(scope)))
    if not fresh:
        cached = _report_cache_get(cache_key)
        if cached is not None:
            return {**cached, "cached": True}

    rows = db.query(models.PlannerTopic).order_by(
        models.PlannerTopic.subject, models.PlannerTopic.display_order
    ).all()
    # Eager-loaded: walking p.sessions and their implementations lazily is a
    # query per POW per session, which is what a remote database charges most
    # for.
    pows = (
        db.query(models.PowEntry)
        .options(
            selectinload(models.PowEntry.sessions).selectinload(models.PowSession.implementations)
        )
        .all()
    )
    marks = db.query(models.CurriculumBackfill).all()
    campus_sections = sections_by_grade(scope)

    # Which disciplines of a split subject are real STREAMS, and which mean
    # "not bifurcated at this grade".
    #
    # Science is EVS in Grades 1-2, plain Science in 3-4 and only splits into
    # Biology/Chemistry/Physics from Grade 5. A value that is the sole
    # discipline for its grade is therefore the whole subject under another
    # name, not a stream, and belongs in the group's FIRST column with the rest
    # left blank - one figure for the subject, which is what it is.
    streams, catchalls, first_seen = {}, {}, {}
    per_grade = {}
    for r in rows:
        if r.subject.strip().lower() not in REPORT_SPLIT_SUBJECTS:
            continue
        d = (r.strands_of_language or r.discipline or "").strip()
        if not d:
            continue
        per_grade.setdefault((r.subject, int(r.grade)), set()).add(d)
        key = (r.subject, d)
        if key not in first_seen:
            first_seen[key] = r.display_order or 0

    for (subject, grade), found in per_grade.items():
        for d in found:
            # Sole discipline for a grade, or simply the subject's own name:
            # either way it is the unbifurcated case.
            if len(found) == 1 or d.strip().lower() == subject.strip().lower():
                catchalls.setdefault(subject, set()).add(d)

    for (subject, d) in first_seen:
        if d not in catchalls.get(subject, set()):
            streams.setdefault(subject, []).append(d)
    # Alphabetical, not sheet order: the sheet happens to introduce Physics
    # first, and the leftmost column is where an unbifurcated grade's single
    # figure lands, so it should be a predictable one.
    for subject in streams:
        streams[subject].sort(key=lambda d: d.lower())

    def column_for(subject, discipline):
        """Where a planner row's figures belong. A stream keeps its own column;
        anything else lands in the group's first column."""
        if subject.strip().lower() not in REPORT_SPLIT_SUBJECTS:
            return ""
        mine = streams.get(subject) or []
        if discipline in mine:
            return discipline
        return mine[0] if mine else ""

    # planner rows grouped by (subject, column, grade)
    plans = {}
    for r in rows:
        subject = r.subject
        disc = (r.strands_of_language or r.discipline or "").strip()
        plans.setdefault((subject, column_for(subject, disc)), {}) \
             .setdefault(int(r.grade), []).append(r)

    # POWs by (subject-group-head, grade). Scope decides who this viewer may
    # see; the POW's own stamped campus decides which report it belongs in, so
    # a teacher moving campus does not move their history with them.
    pows_by_key = {}
    for p in pows:
        email = (p.teacher_email or "").lower()
        if email not in scope:
            continue
        if branch and p.branch and normalize_branch(p.branch) != normalize_branch(branch):
            continue
        pows_by_key.setdefault((group_head(p.subject), str(p.grade)), []).append(p)

    marks_by_key = {}
    for m in marks:
        # A mark with no campus counts for nobody: see _backfill_branch_filter.
        if branch and normalize_branch(m.branch or "") != normalize_branch(branch):
            continue
        marks_by_key.setdefault((group_head(m.subject), str(m.grade)), []).append(m)

    def column_order(key):
        subject, disc = key
        mine = streams.get(subject) or []
        return (subject, mine.index(disc) if disc in mine else -1)

    columns = []
    for (subject, disc) in sorted(plans, key=column_order):
        columns.append({"subject": subject, "discipline": disc,
                        "key": f"{subject}|{disc}" if disc else subject,
                        "label": disc or subject})

    all_grades = sorted({g for byg in plans.values() for g in byg})

    def sections_of(subject, grade):
        return (campus_sections.get((subject.lower(), str(grade)))
                or campus_sections.get((group_head(subject).lower(), str(grade)))
                or [])

    grades = []
    for grade in all_grades:
        grade_row = {"grade": grade, "cells": {}, "sections": []}
        section_rows = {}

        for col in columns:
            subject, disc = col["subject"], col["discipline"]
            grade_rows = plans[(subject, disc)].get(grade)
            if not grade_rows:
                continue

            chapters = annual_planner_tree(grade_rows)
            if not chapters:
                continue

            # What should have been covered by now: every month up to this one.
            expected = 0
            for c in chapters:
                for month, v in c["month_sessions"].items():
                    if month_position(month, 99) <= month_cut:
                        expected += v
            if not expected:
                continue

            key = (group_head(subject), str(grade))
            subject_pows = [
                p for p in pows_by_key.get(key, [])
                if not disc or (p.topic or "").strip() in {c["chapter"] for c in chapters}
            ]
            pows_by_chapter = {}
            for p in subject_pows:
                pows_by_chapter.setdefault((p.topic or "").strip(), []).append(p)

            marked_months, marked_labels = {}, {}
            chapter_names = {c["chapter"] for c in chapters}
            for m in marks_by_key.get(key, []):
                if m.chapter_name not in chapter_names:
                    continue
                if m.subtopic:
                    marked_labels.setdefault(m.chapter_name, set()).add(m.subtopic)
                else:
                    marked_months.setdefault(m.chapter_name, set()).add(m.month)
            marked_full = {
                c["chapter"] for c in chapters
                if c["months"] and set(c["months"]) <= marked_months.get(c["chapter"], set())
            }

            # Coverage the SME marked, which belongs to every section equally.
            backfill_only = sum(chapter_sessions_done(
                chapters, {}, marked_full, marked_months, marked_labels, set(),
            ).values())

            # What each section itself recorded: a session it marked completed.
            done_by_section = {}
            for p in subject_pows:
                for sess in p.sessions:
                    for impl in sess.implementations:
                        if impl.completed_on:
                            done_by_section[impl.section] = done_by_section.get(impl.section, 0) + 1

            letters = sections_of(subject, grade)
            if not letters:
                letters = sorted(done_by_section) or ["A"]

            variances = []
            for letter in letters:
                done = min(backfill_only + done_by_section.get(letter, 0), expected)
                v = _variance(done, expected)
                variances.append(v)
                section_rows.setdefault(letter, {})[col["key"]] = {
                    "variance": v, "done": done, "expected": expected,
                }

            real = [v for v in variances if v is not None]
            grade_row["cells"][col["key"]] = {
                "variance": round(sum(real) / len(real)) if real else None,
                "expected": expected,
                "sections": len(letters),
            }

        grade_row["sections"] = [
            {"section": letter, "cells": cells}
            for letter, cells in sorted(section_rows.items())
        ]
        grades.append(grade_row)

    result = {
        "branch": branch or "",
        "month": this_month,
        "columns": columns,
        "grades": grades,
        "cached": False,
    }
    _REPORT_CACHE[cache_key] = (now_ist(), result)
    return result


def compare_branches(db: Session, user_email: str, role: str, subject: str,
                     discipline: Optional[str] = None) -> dict:
    """Grade-by-grade, Kodathi against Attibele, for one subject.

    Built from three queries rather than one annual reading per grade per
    campus: the same maths run twenty times took eleven seconds, which is too
    slow for a button. The per-chapter rule itself is shared with the year view
    (chapter_sessions_done), so the two cannot disagree.
    """
    rows = get_planner_rows(db, subject)
    wanted = (discipline or "").strip().lower()
    if wanted:
        rows = [r for r in rows if (r.strands_of_language or r.discipline or "").lower() == wanted]

    by_grade = {}
    for r in rows:
        by_grade.setdefault(int(r.grade), []).append(r)

    pows = db.query(models.PowEntry).filter(_subject_group_filter(subject)).all()
    marks = db.query(models.CurriculumBackfill).filter(_backfill_subject_filter(subject)).all()

    # Which campus each teacher belongs to, so a POW can be placed without a
    # query per row.
    campus_of = {}
    for u in db.query(models.User).all():
        if u.email:
            campus_of[u.email.lower()] = normalize_branch(u.location)

    allowed = {
        br: set(_build_teacher_map(db, user_email, role, br).keys())
        for br in BRANCHES
    }

    grades = []
    for grade in sorted(by_grade):
        chapters = annual_planner_tree(by_grade[grade])
        if not chapters:
            continue
        disciplines = []
        for r in by_grade[grade]:
            d = r.strands_of_language or r.discipline
            if d and d not in disciplines:
                disciplines.append(d)

        planned_chapters = len(chapters)
        planned_sessions = sum(c["sessions"] for c in chapters)
        entry = {"grade": grade, "chapters": planned_chapters, "sessions": planned_sessions,
                 "branches": {}}

        for br in BRANCHES:
            scope = allowed[br]
            pows_by_chapter = {}
            for p in pows:
                if str(p.grade) != str(grade):
                    continue
                email = (p.teacher_email or "").lower()
                if email not in scope:
                    continue
                pows_by_chapter.setdefault((p.topic or "").strip(), []).append(p)

            marked_months, marked_labels = {}, {}
            for m in marks:
                if int(m.grade) != grade:
                    continue
                # Unattributed marks (made before coverage was per campus)
                # count for both until that campus is saved again.
                # Unattributed marks belong to neither campus.
                if normalize_branch(m.branch or "") != br:
                    continue
                if m.subtopic:
                    marked_labels.setdefault(m.chapter_name, set()).add(m.subtopic)
                else:
                    marked_months.setdefault(m.chapter_name, set()).add(m.month)

            marked_full = {
                c["chapter"] for c in chapters
                if c["months"] and set(c["months"]) <= marked_months.get(c["chapter"], set())
            }
            implied = implied_complete_chapters(chapters, pows_by_chapter, disciplines)
            done = chapter_sessions_done(
                chapters, pows_by_chapter, marked_full, marked_months, marked_labels, implied,
            )

            sessions_done = sum(done.values())
            chapters_done = sum(
                1 for c in chapters if c["sessions"] and done.get(c["chapter"], 0) >= c["sessions"]
            )
            entry["branches"][br] = {
                "chapters_done": chapters_done,
                "sessions_done": sessions_done,
                "pct": round(sessions_done * 100 / planned_sessions) if planned_sessions else 0,
                "sections": sections_for_grade(db, subject, str(grade), br, allowed[br]),
                "teachers_filing": len({
                    (p.teacher_email or "").lower()
                    for p in pows if str(p.grade) == str(grade)
                    and (p.teacher_email or "").lower() in scope
                }),
            }

        k, a = entry["branches"].get("Kodathi", {}), entry["branches"].get("Attibele", {})
        entry["gap_sessions"] = (k.get("sessions_done", 0) or 0) - (a.get("sessions_done", 0) or 0)
        entry["gap_pct"] = (k.get("pct", 0) or 0) - (a.get("pct", 0) or 0)
        grades.append(entry)

    return {
        "subject": subject,
        "discipline": discipline or "",
        "branches": BRANCHES,
        "grades": grades,
    }


def get_annual_progress(db: Session, subject: str, grade: int, discipline: Optional[str] = None,
                        teacher_emails: Optional[set] = None, branch: Optional[str] = None) -> dict:
    """Whole-year progress for one subject+grade, per SECTION - the leadership
    view, as opposed to the month-at-a-time SME view in get_progress_summary.

    A section ticks a leaf when it wrote implementation for it: the
    implementation box is filled in after the lesson happens, so it is the
    record that the section actually covered that ground. Sections come from
    the POWs themselves (impl_a..impl_f), since nothing in the app records how
    many sections a grade runs.

    Headline numbers are AVERAGED across sections: with 8A finished and 8B
    halfway, the grade is three-quarters through, not finished.
    """
    rows = get_planner_rows(db, subject, int(grade))
    wanted = (discipline or "").strip().lower()
    if wanted:
        rows = [r for r in rows if (r.strands_of_language or r.discipline or "").lower() == wanted]

    chapters = annual_planner_tree(rows)
    disciplines = planner_disciplines(db, subject, int(grade))

    pow_q = db.query(models.PowEntry).filter(
        _subject_group_filter(subject),
        models.PowEntry.grade == str(grade),
    )
    if teacher_emails is not None:
        pow_q = pow_q.filter(func.lower(models.PowEntry.teacher_email).in_(teacher_emails or {""}))
    pows = pow_q.order_by(models.PowEntry.week_start.asc()).all()

    sections = [
        l for l in SECTION_LETTERS
        if any((getattr(p, "impl_" + l.lower(), None) or "").strip()
               or getattr(p, "impl_" + l.lower() + "_date", None) for p in pows)
    ]
    # No section has written implementation yet, but the class may still have
    # covered ground an SME marked or a POW records. One column stands for the
    # class so that evidence has somewhere to show.
    section_labels = [f"{grade}{l}" for l in sections]
    if not sections:
        sections = ["*"]
        section_labels = ["Whole class"]

    by_chapter = {c["chapter"]: c for c in chapters}
    ticked = {}          # (section, chapter) -> leaves that section implemented

    for p in pows:
        chapter = by_chapter.get((p.topic or "").strip())
        if not chapter:
            continue                      # a chapter no longer in the mapping
        targets = _pow_targets(p, chapter)
        for l in sections:
            if not ((getattr(p, "impl_" + l.lower(), None) or "").strip()
                    or getattr(p, "impl_" + l.lower() + "_date", None)):
                continue
            ticked.setdefault((l, chapter["chapter"]), set()).update(targets)

    # ── Evidence that is about the CLASS, not one section ───────────────────
    # Implementation is written per section; these three are not, so each of
    # them ticks every section. Without them the year view contradicted the
    # month view: an SME could mark seven chapters covered and file a POW for
    # the eighth, and the year still read zero.
    marks = db.query(models.CurriculumBackfill).filter(
        _backfill_subject_filter(subject),
        models.CurriculumBackfill.grade == int(grade),
        _backfill_branch_filter(models.CurriculumBackfill, branch),
    ).all()
    # Marks are per (month, chapter). A chapter taught across two months and
    # marked for only one is partly covered, so the months are kept and the
    # chapter counts as fully covered only when every month it appears in is
    # marked.
    marked_months = {}
    for m in marks:
        if not m.subtopic:
            marked_months.setdefault(m.chapter_name, set()).add(m.month)
    marked_labels = {}
    for m in marks:
        if m.subtopic:
            marked_labels.setdefault(m.chapter_name, set()).add(m.subtopic)
    marked_full = {
        c["chapter"] for c in chapters
        if c["months"] and set(c["months"]) <= marked_months.get(c["chapter"], set())
    }

    # A later chapter in the same discipline being under way means the earlier
    # ones are behind us — same rule as the monthly view, computed per
    # discipline so Biology says nothing about Physics.
    pows_by_chapter = {}
    for p in pows:
        pows_by_chapter.setdefault((p.topic or "").strip(), []).append(p)

    implied_complete = implied_complete_chapters(chapters, pows_by_chapter, disciplines)

    def leaf_label(leaf):
        """How the backfill sheet names this leaf (BackfillPanel items use
        `subtopic or topic`), so a tick there lines up with a leaf here."""
        return leaf[1] or leaf[0]

    # Filled in once the session counts are known, just below: sessions are
    # taught in sheet order, so "9 of 11 sessions done" says the first 9/11 of
    # the chapter's topics and sub-topics are behind us, whether or not anyone
    # ticked them individually.
    implied_leaves = {}

    def covered(chapter_name, leaf, section):
        if chapter_name in marked_full or chapter_name in implied_complete:
            return True
        if leaf_label(leaf) in marked_labels.get(chapter_name, ()):
            return True
        if leaf in implied_leaves.get(chapter_name, ()):
            return True
        return leaf in ticked.get((section, chapter_name), set())

    grade_sessions = chapter_sessions_done(
        chapters, pows_by_chapter, marked_full, marked_months, marked_labels, implied_complete,
    )

    # Sessions -> leaves. The proportion of the chapter's sessions that are
    # done, applied to its topics/sub-topics in sheet order. Rounded DOWN, so a
    # part-finished item is never shown as complete.
    for c in chapters:
        planned = c["sessions"] or 0
        done = grade_sessions.get(c["chapter"], 0)
        leaves = _leaf_keys(c)
        if planned and leaves and done:
            n = int(len(leaves) * done / planned)
            if n:
                implied_leaves[c["chapter"]] = set(leaves[:n])

    # Which sections have covered each node, for the drill-down table.
    for c in chapters:
        name = c["chapter"]
        leaves = _leaf_keys(c)
        c["done_sections"] = [l for l in sections if all(covered(name, leaf, l) for leaf in leaves)]
        c["sessions_done"] = grade_sessions.get(name, 0)
        for t in c["topics"]:
            t_leaves = [(t["topic"], sub) for sub in t["subtopics"]] or [(t["topic"], "")]
            t["done_sections"] = [l for l in sections if all(covered(name, leaf, l) for leaf in t_leaves)]
            t["subtopic_rows"] = [
                {
                    "subtopic": sub,
                    "done_sections": [l for l in sections if covered(name, (t["topic"], sub), l)],
                }
                for sub in t["subtopics"]
            ]

    total_chapters = len(chapters)
    total_sessions = sum(c["sessions"] for c in chapters)
    grade_sessions_done = sum(grade_sessions.values())

    per_section = []
    for l in sections:
        per_section.append({
            "section": l,
            "chapters_done": sum(1 for c in chapters if l in c["done_sections"]),
            "sessions_done": grade_sessions_done,
        })

    n = len(per_section) or 1
    avg_chapters_done = round(sum(x["chapters_done"] for x in per_section) / n, 1)
    avg_sessions_done = round(sum(x["sessions_done"] for x in per_section) / n, 1)

    chapters_left = max(0, round(total_chapters - avg_chapters_done, 1))
    sessions_left = max(0, round(total_sessions - avg_sessions_done, 1))
    chapters_pct_left = round(chapters_left * 100 / total_chapters) if total_chapters else 0
    sessions_pct_left = round(sessions_left * 100 / total_sessions) if total_sessions else 0

    # "More than 50% left by August end" - raised from August onward, since
    # before that a large remainder is simply the year being young.
    today = now_ist()
    past_august = month_position(today.strftime("%B"), 0) >= month_position("August", 0)
    behind = past_august and (chapters_pct_left > 50 or sessions_pct_left > 50)
    reasons = []
    if behind and chapters_pct_left > 50:
        reasons.append("%s%% of chapters" % chapters_pct_left)
    if behind and sessions_pct_left > 50:
        reasons.append("%s%% of sessions" % sessions_pct_left)

    return {
        "subject": subject,
        "grade": grade,
        "month": today.strftime("%B"),
        "sections": sections,
        "section_labels": section_labels,
        "disciplines": disciplines,
        "discipline": discipline or "",
        "totals": {
            "chapters": total_chapters,
            "chapters_done": avg_chapters_done,
            "chapters_left": chapters_left,
            "chapters_pct_left": chapters_pct_left,
            "sessions": total_sessions,
            "sessions_done": avg_sessions_done,
            "sessions_left": sessions_left,
            "sessions_pct_left": sessions_pct_left,
            "behind": behind,
            "behind_reason": " and ".join(reasons),
        },
        "per_section": per_section,
        "chapters": chapters,
    }


# ─── Backfill: curriculum covered before POWs began ─────────────────────────

def months_to_date() -> List[str]:
    """Academic months up to and INCLUDING the current one — everything that
    could already have been taught. In August: April to August."""
    current = now_ist().strftime("%B")
    cutoff = month_position(current, None)
    if cutoff is None:
        return []
    return [m for m in ACADEMIC_MONTHS if MONTH_INDEX[m] <= cutoff]


def get_backfill_view(db: Session, subject: str, grade: int, branch: Optional[str] = None) -> dict:
    """The marking sheet: every planner chapter in a month already past, with
    its sub-topics and what's ticked so far.

    `locked` is the one-time rule — once a POW exists for this subject+grade,
    progress comes from POWs and the marking is closed for good."""
    rows = get_planner_rows(db, subject, grade)
    # Compared by POSITION, not by name: a sheet that writes a span
    # ("Aug-Sep", "May-June-July") never matched a whole-month name, so those
    # chapters could not be ticked at all - Social Science Grade 8 offered
    # nothing to mark. A span counts as under way once its first month has
    # started, which is how it is ordered everywhere else.
    cutoff = month_position(now_ist().strftime("%B"), None)

    # Grade-wise: the curriculum was covered (or not) for the class, so the
    # marks belong to the subject+grade rather than to each teacher of it.
    marks = db.query(models.CurriculumBackfill).filter(
        _backfill_subject_filter(subject),
        models.CurriculumBackfill.grade == int(grade),
        _backfill_branch_filter(models.CurriculumBackfill, branch),
    ).all()
    chapter_marks = {(m.month, m.chapter_name) for m in marks if not m.subtopic}
    item_marks = {(m.month, m.chapter_name, m.subtopic) for m in marks if m.subtopic}

    chapters = {}
    for r in rows:
        if cutoff is None or month_position(r.month) > cutoff:
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
    out.sort(key=lambda c: (month_position(c["month"], 99), c["chapter_name"]))

    # POWs do NOT close the marking — an SME may still be working through past
    # coverage after teachers have started filing. Only their explicit
    # confirmation closes it. The POW count is still reported, as context.
    pow_count = db.query(func.count(models.PowEntry.id)).filter(
        _subject_group_filter(subject), models.PowEntry.grade == str(grade)
    ).scalar()
    confirmation = _backfill_confirmation(db, subject, grade, branch)

    return {
        "subject": subject, "grade": int(grade),
        # The month labels actually on the sheet, in academic order - the panel
        # groups its rows by these. Whole month names would leave a span like
        # "May-June-July" in no group at all, and its chapters unreachable.
        "months": ([c["month"] for c in sorted(
            {x["month"]: x for x in out}.values(), key=lambda x: month_position(x["month"]))]
            or months_to_date()),
        "chapters": out,
        "locked": confirmation is not None,
        "confirmed_by": confirmation.confirmed_by if confirmation else None,
        "confirmed_at": confirmation.confirmed_at.isoformat() if confirmation and confirmation.confirmed_at else None,
        "pow_count": int(pow_count or 0),
        "marked_by": next((m.marked_by for m in marks if m.marked_by), None),
    }


def _backfill_confirmation(db: Session, subject: str, grade: int, branch: Optional[str] = None):
    return (
        db.query(models.BackfillConfirmation)
        .filter(_backfill_confirmation_filter(subject),
                models.BackfillConfirmation.grade == int(grade),
                _backfill_branch_filter(models.BackfillConfirmation, branch))
        .first()
    )


def confirm_backfill(db: Session, subject: str, grade: int, email: str,
                     branch: Optional[str] = None) -> dict:
    """Closes the marking for this subject+grade on this campus."""
    existing = _backfill_confirmation(db, subject, grade, branch)
    if existing:
        return {"already_confirmed": True, "confirmed_by": existing.confirmed_by}
    db.add(models.BackfillConfirmation(
        subject=group_head(subject), grade=int(grade), confirmed_by=email,
        branch=normalize_branch(branch) if branch else None,
    ))
    db.commit()
    return {"already_confirmed": False, "confirmed_by": email}


def reopen_backfill(db: Session, subject: str, grade: int, branch: Optional[str] = None) -> dict:
    """Undoes a confirmation — the marks themselves are untouched."""
    deleted = (
        db.query(models.BackfillConfirmation)
        .filter(_backfill_confirmation_filter(subject),
                models.BackfillConfirmation.grade == int(grade),
                _backfill_branch_filter(models.BackfillConfirmation, branch))
        .delete(synchronize_session=False)
    )
    db.commit()
    return {"reopened": bool(deleted)}


def save_backfill(db: Session, subject: str, grade: int, marks: list, email: str,
                  branch: Optional[str] = None) -> dict:
    """Replaces the marks for this subject+grade on this campus. A tick is a
    row; unticking removes it, so the table only ever states what WAS covered.

    Deletes the unattributed rows too (branch IS NULL, from before coverage was
    per campus): the SME is now stating it for this campus, so the older
    ambiguous rows have been superseded."""
    # Replaces this campus's marks, and clears any left unattributed for the
    # same subject and grade: the SME is stating coverage per campus now, so
    # the older ambiguous rows have been superseded. Reads ignore them either
    # way (see _backfill_branch_filter) - this is what actually removes them.
    db.query(models.CurriculumBackfill).filter(
        _backfill_subject_filter(subject),
        models.CurriculumBackfill.grade == int(grade),
        or_(
            models.CurriculumBackfill.branch.is_(None),
            _backfill_branch_filter(models.CurriculumBackfill, branch),
        ),
    ).delete(synchronize_session=False)

    saved = 0
    for m in marks:
        if not m.done:
            continue
        db.add(models.CurriculumBackfill(
            subject=group_head(subject), grade=int(grade),
            branch=normalize_branch(branch) if branch else None,
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


def get_lagging_report(db: Session, viewer_email: str, role: str, branch: Optional[str] = None) -> dict:
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

    teacher_map = _build_teacher_map(db, viewer_email, role, branch)
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
        backfill_by_key.setdefault((m.subject.lower(), m.grade), []).append(m)

    def credited(subject_name, grade_num, chapters):
        marks, items = [], {}
        for member in subjects_in_group(subject_name):
            marks.extend(backfill_by_key.get((member.lower(), int(grade_num)), []))
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
            months_elapsed = [m for m in month_order if month_position(m, 99) <= month_position(current_month, -1)]
            expected = month_cum[months_elapsed[-1]] if months_elapsed else 0

        done = 0
        last = None
        for p in entries:
            if not p.week_start:
                continue
            key = ((p.topic or "").strip(), p.week_start.strftime("%B"))
            reached = cum_before.get(key, 0) + _sessions_completed(p.lp_session_num, p.week_start, p.status) \
                if key in cum_before else 0
            if reached > done:
                done = reached
            if last is None or p.week_start > last.week_start:
                last = p

        # Backfill is a floor, not an addition: it states where the class had
        # already reached before POWs started, so progress is whichever is
        # further along.
        done = max(done, credited(subject, grade_int, chapters))
        behind = max(0, expected - done)
        info = teacher_map.get(email, {})
        weeks_since = ((today.date() - last.week_start).days // 7) if last and last.week_start else None

        rows.append({
            "teacher_email": email,
            "teacher_name": info.get("name") or email,
            "branch": info.get("location") or "",
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
                    elapsed = [m for m in month_cum if month_position(m, 99) <= month_position(current_month, -1)]
                    expected = max((month_cum[m] for m in elapsed), default=0)
                if expected <= 0:
                    continue

                covered.add((email, subject.lower(), str(grade_int)))
                done_from_backfill = credited(subject, grade_int, chapters)
                rows.append({
                    "teacher_email": email,
                    "teacher_name": info.get("name") or email,
                    "branch": info.get("location") or "",
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
         "branch": i.get("location") or "",
         "assigned_classes": len(staff_directory.assignments_for(e)) if directory_available else None}
        for e, i in teacher_map.items()
        if e not in with_pows and not any(p.teacher_email.lower() == e for p in pows)
    ]

    return {
        "generated_month": current_month,
        "branch": normalize_branch(branch) or "",
        "rows": rows,
        "teachers_without_pows": sorted(without, key=lambda t: t["teacher_name"]),
        # False means class assignments couldn't be read, so the report covers
        # only classes that already have POWs — the UI says so explicitly.
        "directory_available": directory_available,
    }


# ─── Progress chart (cumulative planned vs. actual) ─────────────────────────

def month_weeks(year: int, month: int) -> list:
    """The Mondays of a calendar month, plus the Monday of the week the 1st
    falls in - a week that starts in the previous month still teaches this
    month's sessions."""
    first = datetime.date(year, month, 1)
    monday = first - datetime.timedelta(days=first.weekday())
    last_day = calendar.monthrange(year, month)[1]
    end = datetime.date(year, month, last_day)
    out = []
    while monday <= end:
        out.append(monday)
        monday += datetime.timedelta(days=7)
    return out


def get_month_chart(db: Session, subject: str, grade: int, discipline: Optional[str] = None,
                    teacher_emails: Optional[set] = None, branch: Optional[str] = None) -> dict:
    """This month, week by week: how far through the month's planned sessions
    the class should be, against how far the POWs say it is.

    The cumulative year-to-date picture is a different question and lives in
    get_progress_chart, on the Full year tab. Here the x axis is the weeks of
    the current month and both lines reset at the start of it.

    The planned line is spread evenly across the month's weeks because that is
    all the mapping supports - it states a session count per chapter per MONTH,
    never per week. It is a pace line, not a claim about which week a chapter
    is taught in.
    """
    today = now_ist()
    month = today.strftime("%B")
    summary = get_progress_summary(db, subject, int(grade), None, discipline, teacher_emails, branch)
    rows = summary["chapter_rows"]
    planned_total = sum(r["sessions_planned"] for r in rows)

    weeks = month_weeks(today.year, today.month)
    if not weeks or not planned_total:
        return {
            "success": True, "month": month, "labels": [], "planned": [], "actual": [],
            "planned_total": planned_total, "done_total": summary["sessions_done"],
            "verdict": "No sessions planned for " + month if not planned_total else "No weeks",
        }

    chart_q = db.query(models.PowEntry).filter(
        _subject_group_filter(subject),
        models.PowEntry.grade == str(grade),
    )
    if teacher_emails is not None:
        chart_q = chart_q.filter(func.lower(models.PowEntry.teacher_email).in_(teacher_emails or {""}))
    pows = chart_q.all()
    wanted_chapters = {r["chapter"] for r in rows}
    planned_by_chapter = {r["chapter"]: r["sessions_planned"] for r in rows}

    # What the chapter table says is covered, and how it knows. A POW carries
    # the week it was taught; coverage the SME marks carries no date at all -
    # it is a statement that the chapter WAS covered during its planned month.
    done_by_chapter = {r["chapter"]: r["sessions_done"] for r in rows}
    dateless = {r["chapter"] for r in rows if "POW" not in (r["counted_from"] or "")}

    labels, planned, actual = [], [], []
    for i, monday in enumerate(weeks):
        week_end = monday + datetime.timedelta(days=6)
        labels.append(monday.strftime("%d %b"))
        # even pace across the month, rounded so the last week lands exactly on
        # the month's total
        pace = round(planned_total * (i + 1) / len(weeks))
        planned.append(pace)

        # Nothing to plot for a week that hasn't happened: the line should stop
        # at today rather than run flat to the end of the month, which read as
        # "covered nothing" for weeks nobody has taught yet.
        if monday > today.date():
            actual.append(None)
            continue

        done = 0
        for chapter in wanted_chapters:
            chapter_planned = planned_by_chapter.get(chapter, 0)
            best = 0
            for p in pows:
                if (p.topic or "").strip() != chapter:
                    continue
                if not p.week_start or p.week_start > week_end:
                    continue          # hasn't happened yet as of this week
                best = max(best, _sessions_completed(p.lp_session_num, p.week_start, p.status))
            if chapter in dateless and chapter_planned:
                # Credited at the plan's own pace, capped by what was actually
                # marked: a chapter the SME confirms was fully covered tracks
                # the pace line exactly, and a half-marked one plateaus at half.
                # Backfilling in September must not read as "behind in August".
                credited = min(done_by_chapter.get(chapter, 0),
                               round(chapter_planned * (i + 1) / len(weeks)))
                best = max(best, credited)
            done += min(best, chapter_planned)
        actual.append(done)

    # Where we are now, against where the pace line says we should be - the
    # last week that has actually started.
    idx = max(0, min(len(weeks) - 1, sum(1 for w in weeks if w <= today.date()) - 1))
    ahead = (actual[idx] or 0) - planned[idx]
    verdict = "On track" if abs(ahead) <= 1 else ("Ahead of plan" if ahead > 0 else "Behind plan")

    return {
        "success": True,
        "month": month,
        "labels": labels,
        "planned": planned,
        "actual": actual,
        "planned_total": planned_total,
        "done_total": summary["sessions_done"],
        "verdict": verdict,
        "note": "Planned is an even pace across the month's weeks - the curriculum "
                "mapping gives a session count per month, not per week. Coverage the "
                "SME has marked carries no date, so it is credited at that same pace: "
                "a chapter confirmed covered tracks the plan rather than counting as "
                "taught on the day it was ticked.",
    }


def get_progress_chart(db: Session, subject: str, grade: int, discipline: Optional[str] = None,
                       teacher_emails: Optional[set] = None, branch: Optional[str] = None):
    """The year, month by month: cumulative sessions planned against
    cumulative sessions covered.

    Built on get_annual_progress so its totals are the SAME numbers the Full
    year donuts show. The previous version deduplicated chapters by name and
    took the largest month's session count, which made the year total read 102
    for a Science Grade 6 plan of 221, and plotted a POW's first ticked session
    number on top of a running total - two different units on one line.
    """
    annual = get_annual_progress(db, subject, int(grade), discipline, teacher_emails, branch)
    chapters = annual["chapters"]
    if not chapters:
        return {"success": True, "labels": [], "planned": [], "actual": [], "verdict": "No planner data",
                "total_planned": 0, "current_actual": 0, "analysis": []}

    # Academic order (April -> March), only the months this plan actually uses.
    months = sorted(
        {m for c in chapters for m in c["month_sessions"]},
        key=lambda m: month_position(m, 99),
    )

    planned_by_month = {m: 0 for m in months}
    done_by_month = {m: 0 for m in months}
    for c in chapters:
        done_left = c.get("sessions_done", 0)
        # A chapter's progress is recorded against the CHAPTER, not the month
        # (one session counter per POW), so it is filled into the chapter's
        # months in academic order - sessions 1..n are taught in sequence, so
        # the earliest month gets its share first. Spreading it proportionally
        # instead pushed part of the work already done into months still ahead,
        # and the year-to-date line then disagreed with the donut.
        for m in sorted(c["month_sessions"], key=lambda x: month_position(x, 99)):
            v = c["month_sessions"][m]
            planned_by_month[m] += v
            take = min(done_left, v)
            done_by_month[m] += take
            done_left -= take

    today = now_ist()
    this_month_idx = month_position(today.strftime("%B"), 99)

    labels, plan_line, act_line, analysis = [], [], [], []
    cum_planned = cum_done = 0
    for m in months:
        cum_planned += planned_by_month[m]
        cum_done += done_by_month[m]
        labels.append(m[:3])
        plan_line.append(cum_planned)
        # The actual line stops at the current month - drawing it flat across
        # months not yet taught reads as a collapse in progress.
        past = month_position(m, 99) <= this_month_idx
        act_line.append(round(cum_done) if past else None)

        gap = round(cum_done - cum_planned)
        analysis.append({
            "month": m,
            "planned": planned_by_month[m],
            "done": round(done_by_month[m]),
            "cum_planned": cum_planned,
            "cum_done": round(cum_done) if past else None,
            "status": ("—" if not past else
                       "on_track" if abs(gap) <= 2 else "ahead" if gap > 0 else "behind"),
            "gap": gap if past else None,
        })

    to_date = [a for a in analysis if a["cum_done"] is not None]
    if to_date:
        gap = to_date[-1]["gap"]
        verdict = "On track" if abs(gap) <= 2 else ("Ahead of plan" if gap > 0 else "Behind plan")
    else:
        verdict = "Not started"

    return {
        "success": True,
        "labels": labels,
        "planned": plan_line,
        "actual": act_line,
        "total_planned": cum_planned,
        "current_actual": to_date[-1]["cum_done"] if to_date else 0,
        "verdict": verdict,
        "analysis": analysis,
    }


def _fmt_display_date(iso: str) -> str:
    try:
        d = datetime.date.fromisoformat(iso)
        return d.strftime("%d %b")
    except ValueError:
        return iso
