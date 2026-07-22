import datetime
import re
import calendar
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import func
from . import models

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

def get_planner_rows(db: Session, subject: str, grade: Optional[int] = None) -> List[models.PlannerTopic]:
    q = db.query(models.PlannerTopic).filter(func.lower(models.PlannerTopic.subject) == subject.lower())
    if grade is not None:
        q = q.filter(models.PlannerTopic.grade == int(grade))
    return q.order_by(models.PlannerTopic.display_order).all()


def get_planner_chapters(db: Session, subject: str, grade: int) -> List[models.PlannerTopic]:
    """Distinct (chapter_name, month) occurrences, first-seen order, each
    carrying that occurrence's sessions count. This is the progress-tracking
    unit — the equivalent of Code.gs's flat pre-hierarchy 'topic' concept.

    Deliberately keyed by (chapter_name, month), NOT chapter_name alone —
    real planner data confirmed some chapters recur across multiple months
    with a different session count each time (e.g. English Grade 5's
    "Reading Comprehension" appears in June/August/September/November/
    February with 2/1/1/2/2 sessions respectively). Deduping by name alone
    would silently collapse all but the first occurrence."""
    rows = get_planner_rows(db, subject, grade)
    seen = {}
    order = []
    for r in rows:
        key = (r.chapter_name, r.month)
        if key not in seen:
            seen[key] = r
            order.append(key)
    return [seen[key] for key in order]


# ─── POW cards (dashboard) ──────────────────────────────────────────────────

def get_pow_cards(db: Session, user_email: str, role: str):
    """Mirrors Code.gs's getPowCards(userEmail, role): builds an
    email -> {name, subject, location} teacher map scoped by role, then
    filters pow_entries to only those teachers' rows."""
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

    cards = []
    if teacher_map:
        pows = db.query(models.PowEntry).filter(func.lower(models.PowEntry.teacher_email).in_(teacher_map.keys())).all()
        for p in pows:
            temail = p.teacher_email.lower()
            cards.append({
                "id": p.id,
                "teacher_email": temail,
                "teacher_name": teacher_map.get(temail, {}).get("name") or temail,
                "subject": p.subject,
                "grade": p.grade,
                "week_start": p.week_start.isoformat(),
                "week_end": p.week_end.isoformat(),
                "topic": p.topic,
                # Flags a POW past the teacher's own final-save that never got a
                # TBS MOM filled in — surfaced as a highlight on the dashboard
                # card, recomputed fresh on every load so it keeps nagging until fixed.
                "tbs_mom_missing": p.status in ("final", "reviewed", "approved") and not (p.tbs_mom or "").strip(),
                "status": STATUS_LABELS.get(p.status, "Created"),
            })
    cards.sort(key=lambda c: c["week_start"], reverse=True)

    teachers = [{"email": email, **info} for email, info in teacher_map.items()]
    return {"cards": cards, "teachers": teachers}


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
        func.lower(models.PowEntry.subject) == subject.lower(),
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
        func.lower(models.PowEntry.subject) == subject.lower(),
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
