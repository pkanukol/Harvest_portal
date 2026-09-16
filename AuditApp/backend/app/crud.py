from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_, and_, select, text
from datetime import datetime, timezone, date
import string
import random
from . import models, schemas, auth

def utc_iso(dt):
    """Serialize a naive datetime (always UTC in this app, via datetime.utcnow()) with an
    explicit UTC marker, so the browser's `new Date(...)` doesn't misread it as local time."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

# --- USER CRUD ---
def get_user_by_email(db: Session, email: str):
    return db.query(models.User).filter(models.User.email == email.strip().lower()).first()

def get_user_by_id(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()

def get_users_by_role(db: Session, role: str):
    return db.query(models.User).filter(models.User.role == role).all()

def create_user(db: Session, user: schemas.UserCreate):
    password_hash = auth.get_password_hash(user.password)
    db_user = models.User(
        email=user.email.strip().lower(),
        password_hash=password_hash,
        name=user.name.strip(),
        designation=user.designation.strip(),
        role=user.role,
        location=user.location,
        sme_id=user.sme_id
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    return db_user

# --- OBSERVATION CRUD ---
def calculate_scores_and_rating(p11: int, p12: int, p21: int, p31: int, p32: int, p33: int, p34: int):
    d1 = p11 + p12
    d2 = p21
    # p34 (Technology) is stored but excluded from domain3 total — shown separately
    d3 = p31 + p32 + p33  # max 12
    overall = d1 + d2 + d3  # max 24

    if overall >= 20:
        rating = "DISTINGUISHED"
    elif overall >= 15:
        rating = "PROFICIENT"
    elif overall >= 10:
        rating = "DEVELOPING"
    else:
        rating = "BEGINNING"

    return d1, d2, d3, overall, rating

def generate_unique_id(teacher_name: str, auditor_name: str) -> str:
    now = datetime.now()
    ddmmyy = now.strftime("%d%m%y")
    hhmm = now.strftime("%H%M")
    
    clean_t = "".join(c for c in teacher_name if c.isalnum()).upper()[:3]
    clean_a = "".join(c for c in auditor_name if c.isalnum()).upper()[:3]
    
    # Random suffix to prevent collisions
    rand = "".join(random.choices(string.ascii_uppercase, k=2))
    
    return f"{clean_t}{clean_a}{ddmmyy}{hhmm}{rand}"

def create_observation(db: Session, obs_in: schemas.ObservationCreate, auditor_id: int):
    auditor = get_user_by_id(db, auditor_id)
    teacher = get_user_by_id(db, obs_in.teacher_id)
    
    if not teacher or not auditor:
        return None

    # Scores may be omitted (None) when saving an early draft with only basic session data —
    # treat those as 0 = "not scored yet". The finalise step enforces that they're all filled.
    p11, p12 = obs_in.p11 or 0, obs_in.p12 or 0
    p21 = obs_in.p21 or 0
    p31, p32, p33, p34 = obs_in.p31 or 0, obs_in.p32 or 0, obs_in.p33 or 0, obs_in.p34 or 0

    d1, d2, d3, overall, rating = calculate_scores_and_rating(p11, p12, p21, p31, p32, p33, p34)

    unique_id = generate_unique_id(teacher.name, auditor.name)

    db_obs = models.Observation(
        unique_id=unique_id,
        auditor_id=auditor_id,
        teacher_id=obs_in.teacher_id,
        school=obs_in.school,
        subject=obs_in.subject,
        grade=obs_in.grade,
        section=obs_in.section,
        topic=obs_in.topic,
        observation_type=obs_in.observation_type,
        p11=p11,
        p12=p12,
        domain1_score=d1,
        p21=p21,
        domain2_score=d2,
        p31=p31,
        p32=p32,
        p33=p33,
        p34=p34,
        domain3_score=d3,
        overall_score=overall,
        rating=rating,
        infrastructure_issues=obs_in.infrastructure_issues,
        other_issues=obs_in.other_issues,
        objective_observations=obs_in.objective_observations,
        is_draft=True,
        domain1_remarks=obs_in.domain1_remarks,
        domain2_remarks=obs_in.domain2_remarks,
        domain3_remarks=obs_in.domain3_remarks,
    )
    
    db.add(db_obs)
    db.commit()
    db.refresh(db_obs)
    return db_obs

def get_observation_by_id(db: Session, obs_id: int):
    return db.query(models.Observation).options(
        joinedload(models.Observation.teacher),
        joinedload(models.Observation.auditor),
        joinedload(models.Observation.images),
    ).filter(models.Observation.id == obs_id).first()

def get_observations_for_teacher(db: Session, teacher_id: int, include_drafts: bool = False):
    query = db.query(models.Observation).options(
        joinedload(models.Observation.teacher),
        joinedload(models.Observation.auditor),
        joinedload(models.Observation.images),
    ).filter(models.Observation.teacher_id == teacher_id)
    if not include_drafts:
        query = query.filter(models.Observation.is_draft == False)
    return query.order_by(models.Observation.date_time.desc()).all()

def get_dashboard_teachers(db: Session, location: str, sme_user_id: int = None):
    # Filter observations by location
    obs_query = db.query(models.Observation).options(
        joinedload(models.Observation.teacher),
        joinedload(models.Observation.auditor),
    ).filter(models.Observation.school == location)
    
    # If filtered by SME, use the teacher_sme join table (many-to-many)
    if sme_user_id:
        obs_query = obs_query.join(
            models.TeacherSME, models.Observation.teacher_id == models.TeacherSME.teacher_id
        ).filter(models.TeacherSME.sme_id == sme_user_id)
        
    observations = obs_query.all()
    
    # Aggregate data by teacher
    teacher_stats = {}
    for obs in observations:
        t_id = obs.teacher_id
        if t_id not in teacher_stats:
            teacher_stats[t_id] = {
                "teacher_id": t_id,
                "teacher_name": obs.teacher.name,
                "subject_counts": {},
                "scores": [],
                "latest_obs": None,
                "has_draft": False,
            }

        # Track subjects
        subj = obs.subject
        teacher_stats[t_id]["subject_counts"][subj] = teacher_stats[t_id]["subject_counts"].get(subj, 0) + 1

        if obs.is_draft:
            teacher_stats[t_id]["has_draft"] = True
        else:
            # Track scores for average (only finalised observations count towards stats)
            teacher_stats[t_id]["scores"].append(obs.overall_score)

        # Track latest observation to get latest rating
        if (not teacher_stats[t_id]["latest_obs"] or
            obs.date_time > teacher_stats[t_id]["latest_obs"].date_time):
            # Only count finalised ratings or if there are no finalised, allow draft rating
            if not obs.is_draft or not teacher_stats[t_id]["latest_obs"]:
                teacher_stats[t_id]["latest_obs"] = obs
                
    result = []
    for t_id, stats in teacher_stats.items():
        # Find primary subject
        subjs = stats["subject_counts"]
        primary_subject = max(subjs, key=subjs.get) if subjs else "N/A"
        
        # Calculate average score
        scores = stats["scores"]
        avg_score = round(sum(scores) / len(scores), 1) if scores else 0.0
        
        latest_rating = stats["latest_obs"].rating if stats["latest_obs"] else "BEGINNING"
        obs_count = len(scores)  # Finalised observation count
        
        # If no finalised observations, skip teacher from score lists or keep with 0 count
        latest_obs = stats["latest_obs"]
        result.append(schemas.TeacherSummary(
            teacher_id=t_id,
            teacher_name=stats["teacher_name"],
            subject=primary_subject,
            latest_rating=latest_rating,
            avg_score=avg_score,
            obs_count=len(scores),
            has_draft=stats["has_draft"],
            latest_date=latest_obs.date_time if latest_obs else None,
            latest_auditor_name=latest_obs.auditor.name if latest_obs else "",
        ))
        
    # Sort by average score descending
    result.sort(key=lambda x: x.avg_score, reverse=True)
    return result

def get_teacher_full_history(db: Session, teacher_id: int):
    # Returns all observations for details view
    return db.query(models.Observation).options(
        joinedload(models.Observation.teacher),
        joinedload(models.Observation.auditor),
        joinedload(models.Observation.images),
    ).filter(
        models.Observation.teacher_id == teacher_id
    ).order_by(models.Observation.date_time.desc()).all()

# Specialist/co-curricular subjects observed only via the dedicated SPA (Sports/Performing
# Arts) observation flow, not the regular classroom one — teachers whose only subject is one
# of these are excluded from the classroom Teacher dropdown by default (see SPA_SUBJECTS in
# main.py, which includes these plus "STEM" so a teacher who does both shows in both places).
SPA_ONLY_SUBJECTS = {
    "Art", "Dance", "LifeSkill", "Music", "PE and basketball",
    "Football + PE", "Cricket + PE", "Yoga", "Karate", "Skating", "Library",
    "Theatre", "Keyboard", "Visual Arts", "Vocals", "Guitar", "Drums",
    "Football, Sports, PE", "Football", "Basketball",
}

# Auditor-role staff who ALSO teach a class, and so can be the subject of a classroom
# observation. They are identified by their designation — Coordinators and HODs teach
# alongside their coordination role. (A set `subject` also qualifies, as a fallback.)
TEACHING_AUDITOR_DESIGNATIONS = ("Coordinator", "HOD")

def auditor_teaches_clause():
    """SQL clause: an auditor-role user who also teaches (see TEACHING_AUDITOR_DESIGNATIONS)."""
    return and_(
        models.User.role == "auditor",
        or_(
            and_(models.User.subject.isnot(None), models.User.subject != ""),
            models.User.designation.in_(TEACHING_AUDITOR_DESIGNATIONS),
        ),
    )

def sme_observable_clause():
    """SME-role users who can be the subject of a classroom observation:
      - non-'Subject Matter Expert' designations (e.g. HODs), always; plus
      - the rare 'Subject Matter Expert' who also teaches, flagged by being assigned as an
        observed teacher in teacher_sme (i.e. added under an auditor/SME for observation).
    Regular SMEs only ever appear on the sme_id side of teacher_sme, never teacher_id, so
    this cleanly picks out only the teaching exception without a hardcoded name."""
    assigned_as_observed_teacher = select(models.TeacherSME.teacher_id)
    return and_(
        models.User.role == "sme",
        or_(
            models.User.designation != "Subject Matter Expert",
            models.User.id.in_(assigned_as_observed_teacher),
        ),
    )

def _teaching_staff_filter():
    """Users who can be the subject of a classroom observation: dedicated teachers (other
    than SPA-only specialists), SME-role staff (HODs, plus any teaching SME — see
    sme_observable_clause), and auditor-role coordinators/HODs who also teach."""
    not_spa_only = or_(models.User.subject.is_(None), models.User.subject.notin_(SPA_ONLY_SUBJECTS))
    return or_(
        and_(models.User.role == "teacher", not_spa_only),
        sme_observable_clause(),
        auditor_teaches_clause(),
    )

def is_classroom_observable(user, db: Session = None):
    """Python-side equivalent of _teaching_staff_filter(), for validating a specific
    already-loaded user (e.g. a submitted teacher_id) rather than filtering a query."""
    if user.role == "teacher":
        return not user.subject or user.subject not in SPA_ONLY_SUBJECTS
    if user.role == "sme":
        if user.designation != "Subject Matter Expert":
            return True
        # Rare teaching SME: observable only if assigned as an observed teacher (teacher_sme).
        if db is not None:
            return db.query(models.TeacherSME).filter(
                models.TeacherSME.teacher_id == user.id
            ).first() is not None
        return False
    if user.role == "auditor":
        # Coordinators/HODs teach alongside their role; a set subject also qualifies.
        return user.designation in TEACHING_AUDITOR_DESIGNATIONS or bool(user.subject)
    return False

def is_spa_coach_eligible(user):
    """Python-side equivalent of the SPA-lookup base condition in /api/users/teachers,
    for validating a specific already-loaded user submitted as an SPA observation's coach."""
    if user.role == "teacher":
        return True
    if user.role == "sme":
        return user.designation != "Subject Matter Expert"
    if user.role == "auditor":
        return bool(user.subject)
    return False

def get_dashboard_filter_options(db: Session, location: str):
    """Lightweight lookup data to populate the dashboard's filter dropdowns —
    loaded once up front so the (expensive) observation list itself doesn't have
    to be fetched until the user actually picks a filter or clicks 'All'."""
    teachers = db.query(models.User).filter(
        _teaching_staff_filter(),
        or_(models.User.location == location, models.User.location == "Both"),
    ).order_by(models.User.name).all()

    observers = db.query(models.User).filter(
        models.User.role.in_(["auditor", "sme"]),
        or_(models.User.location == location, models.User.location == "Both"),
    ).order_by(models.User.name).all()

    subject_rows = db.query(models.User.subject).filter(
        models.User.subject.isnot(None), models.User.subject != ""
    ).distinct().all()
    subjects = sorted({row[0] for row in subject_rows if row[0]})

    return {
        "teachers": [{"id": t.id, "name": t.name} for t in teachers],
        "observers": [{"id": o.id, "name": o.name} for o in observers],
        "subjects": subjects,
        "grades": [f"Grade {i}" for i in range(1, 13)],
    }

def update_observation_draft(db: Session, obs_id: int, update_in: schemas.ObservationDraftUpdate):
    db_obs = get_observation_by_id(db, obs_id)
    if not db_obs:
        return None
    db_obs.objective_observations = update_in.objective_observations
    db_obs.ai_feedback = update_in.ai_feedback
    db_obs.domain1_remarks = update_in.domain1_remarks
    db_obs.domain2_remarks = update_in.domain2_remarks
    db_obs.domain3_remarks = update_in.domain3_remarks
    if update_in.topic is not None:
        db_obs.topic = update_in.topic
    if update_in.observation_type is not None:
        db_obs.observation_type = update_in.observation_type
    scores = [update_in.p11, update_in.p12, update_in.p21, update_in.p31, update_in.p32, update_in.p33, update_in.p34]
    if all(v is not None for v in scores):
        d1, d2, d3, overall, rating = calculate_scores_and_rating(
            update_in.p11, update_in.p12, update_in.p21,
            update_in.p31, update_in.p32, update_in.p33, update_in.p34
        )
        db_obs.p11, db_obs.p12 = update_in.p11, update_in.p12
        db_obs.domain1_score = d1
        db_obs.p21 = update_in.p21
        db_obs.domain2_score = d2
        db_obs.p31, db_obs.p32 = update_in.p31, update_in.p32
        db_obs.p33, db_obs.p34 = update_in.p33, update_in.p34
        db_obs.domain3_score = d3
        db_obs.overall_score = overall
        db_obs.rating = rating
    db.commit()
    db.refresh(db_obs)
    return db_obs

def finalise_observation(db: Session, obs_id: int, witness_name: str = None, witness_designation: str = None):
    db_obs = get_observation_by_id(db, obs_id)
    if not db_obs:
        return None
    db_obs.is_draft = False
    if witness_name:
        db_obs.witness_name = witness_name.strip()
    if witness_designation:
        db_obs.witness_designation = witness_designation.strip()
    db.commit()
    db.refresh(db_obs)
    return db_obs

def delete_observation(db: Session, obs_id: int):
    """Hard-delete an observation and its images (images cascade via the relationship's
    delete-orphan). Caller is responsible for the creator + draft-only checks."""
    db_obs = db.query(models.Observation).filter(models.Observation.id == obs_id).first()
    if not db_obs:
        return False
    db.delete(db_obs)
    db.commit()
    return True

def save_teacher_remarks(db: Session, obs_id: int, remarks_in: schemas.ObservationTeacherRemarks):
    db_obs = get_observation_by_id(db, obs_id)
    if not db_obs:
        return None
    db_obs.teacher_remarks = remarks_in.teacher_remarks
    db_obs.remarks_saved = True
    db.commit()
    db.refresh(db_obs)
    return db_obs

# --- LEADERSHIP / SME ACTIVITY STATS ---
def get_leadership_sme_stats(db: Session, location: str):
    now = datetime.utcnow()
    # Academic year runs June -> May, relative to today.
    academic_year_start_year = now.year if now.month >= 6 else now.year - 1
    academic_year_start = datetime(academic_year_start_year, 6, 1)

    observations = db.query(models.Observation).options(
        joinedload(models.Observation.teacher),
    ).join(
        models.User, models.Observation.auditor_id == models.User.id
    ).filter(
        models.User.role == "sme",
        models.Observation.school == location,
        models.Observation.date_time >= academic_year_start,
        models.Observation.date_time <= now,
    ).order_by(models.Observation.date_time.desc()).all()

    obs_by_sme = {}
    observed_by_anyone = set()
    for obs in observations:
        entry = obs_by_sme.setdefault(obs.auditor_id, {"scores": [], "observations": [], "observed_teacher_ids": set()})
        entry["scores"].append(obs.overall_score)
        entry["observed_teacher_ids"].add(obs.teacher_id)
        entry["observations"].append({
            "obs_id": obs.id,
            "teacher_id": obs.teacher_id,
            "teacher_name": obs.teacher.name,
            "rating": obs.rating,
            "overall_score": obs.overall_score,
            "date_time": utc_iso(obs.date_time),
            "is_draft": obs.is_draft,
        })
        observed_by_anyone.add(obs.teacher_id)

    # Teacher roster for this branch, and every SME relevant to it (location match or 'Both') —
    # queried independently of `observations` so an SME with zero observations still shows up
    # with their full assigned-teacher gap in the "not observed" breakdown.
    roster = db.query(models.User).filter(
        _teaching_staff_filter(),
        or_(models.User.location == location, models.User.location == "Both"),
    ).all()
    teacher_names = {t.id: t.name for t in roster}

    sme_users = db.query(models.User).filter(
        models.User.role == "sme",
        or_(models.User.location == location, models.User.location == "Both"),
    ).all()

    assigned_by_sme = {}
    for a in db.query(models.TeacherSME).filter(models.TeacherSME.teacher_id.in_(teacher_names.keys())).all():
        assigned_by_sme.setdefault(a.sme_id, set()).add(a.teacher_id)

    smes = []
    for sme in sme_users:
        entry = obs_by_sme.get(sme.id, {"scores": [], "observations": [], "observed_teacher_ids": set()})
        avg_score = round(sum(entry["scores"]) / len(entry["scores"]), 1) if entry["scores"] else 0
        assigned_ids = assigned_by_sme.get(sme.id, set())
        not_observed = sorted(
            [{"teacher_id": tid, "name": teacher_names[tid]} for tid in assigned_ids if tid not in entry["observed_teacher_ids"]],
            key=lambda t: t["name"],
        )
        smes.append({
            "sme_id": sme.id,
            "sme_name": sme.name,
            "subject": sme.subject,
            "observation_count": len(entry["observations"]),
            "avg_score": avg_score,
            "observations": entry["observations"],
            "teachers_not_observed": not_observed,
        })
    smes.sort(key=lambda s: s["observation_count"], reverse=True)

    teachers_not_observed_overall = sorted(
        [{"teacher_id": tid, "name": name} for tid, name in teacher_names.items() if tid not in observed_by_anyone],
        key=lambda t: t["name"],
    )

    return {
        "academic_year_start": utc_iso(academic_year_start),
        "total_observations": len(observations),
        "smes": smes,
        "teachers_not_observed_overall": teachers_not_observed_overall,
    }


# --- TERM-WISE OBSERVATION COVERAGE (Unannounced vs Invited) ---
def _get_term_bounds(now=None):
    """Term 1: June-September, Term 2: November-February, of the current academic year
    (which itself starts in June). Upper bounds are exclusive (first day of the month
    after the term ends), so Term 2's Feb end is correct in leap and non-leap years alike."""
    now = now or datetime.utcnow()
    year = now.year if now.month >= 6 else now.year - 1
    return {
        "term1": {
            "label": "Term 1 (June - September)",
            "start": datetime(year, 6, 1),
            "end": datetime(year, 10, 1),
        },
        "term2": {
            "label": "Term 2 (November - February)",
            "start": datetime(year, 11, 1),
            "end": datetime(year + 1, 3, 1),
        },
    }

def get_teacher_observation_coverage(db: Session, location: str):
    """For each teacher at this campus, per term: how many Unannounced vs Invited
    observations they've had so far this academic year, and by whom. Includes drafts —
    the observation happened even if the report isn't finalised yet."""
    term_bounds = _get_term_bounds()

    teachers = db.query(models.User).filter(
        _teaching_staff_filter(),
        or_(models.User.location == location, models.User.location == "Both"),
    ).order_by(models.User.name).all()

    result = {}
    for term_key, term in term_bounds.items():
        observations = db.query(models.Observation).options(
            joinedload(models.Observation.auditor),
        ).filter(
            models.Observation.school == location,
            models.Observation.date_time >= term["start"],
            models.Observation.date_time < term["end"],
        ).all()

        by_teacher = {}
        for obs in observations:
            entry = by_teacher.setdefault(obs.teacher_id, {"unannounced": 0, "invited": 0, "auditors": set()})
            if obs.observation_type == "Invited":
                entry["invited"] += 1
            else:
                entry["unannounced"] += 1
            entry["auditors"].add(obs.auditor.name)

        rows = []
        for t in teachers:
            entry = by_teacher.get(t.id, {"unannounced": 0, "invited": 0, "auditors": set()})
            total = entry["unannounced"] + entry["invited"]
            rows.append({
                "teacher_id": t.id,
                "teacher_name": t.name,
                "subject": t.subject,
                "unannounced_count": entry["unannounced"],
                "invited_count": entry["invited"],
                "total": total,
                "auditors": ", ".join(sorted(entry["auditors"])),
                "never_observed": total == 0,
            })

        result[term_key] = {
            "label": term["label"],
            "start": utc_iso(term["start"]),
            "end": utc_iso(term["end"]),
            "rows": rows,
        }

    return result


# --- OBSERVATION IMAGES ---
def add_observation_image(db: Session, obs_id: int, image_path: str):
    db_img = models.ObservationImage(
        observation_id=obs_id,
        image_path=image_path
    )
    db.add(db_img)
    db.commit()
    db.refresh(db_img)
    return db_img


# --- SPA (SPORTS / PERFORMING ARTS) OBSERVATION CRUD ---
def _sum_spa_scores(criteria_scores: dict) -> int:
    total = 0
    for entry in criteria_scores.values():
        score = entry.score if hasattr(entry, "score") else entry.get("score", 0)
        total += score or 0
    return total

def create_spa_observation(db: Session, obs_in: schemas.SpaObservationCreate, auditor_id: int):
    auditor = get_user_by_id(db, auditor_id)
    teacher = get_user_by_id(db, obs_in.teacher_id)
    if not teacher or not auditor:
        return None

    criteria_dict = {k: v.model_dump() for k, v in obs_in.criteria_scores.items()}
    overall_score = _sum_spa_scores(obs_in.criteria_scores)
    unique_id = "SPA" + generate_unique_id(teacher.name, auditor.name)

    db_obs = models.SpaObservation(
        unique_id=unique_id,
        auditor_id=auditor_id,
        teacher_id=obs_in.teacher_id,
        school=obs_in.school,
        activity=obs_in.activity,
        timing=obs_in.timing,
        grade_section=obs_in.grade_section,
        observation_type=obs_in.observation_type,
        criteria_scores=criteria_dict,
        overall_score=overall_score,
        strengths_observed=obs_in.strengths_observed,
        areas_of_improvement=obs_in.areas_of_improvement,
        is_draft=True,
    )
    db.add(db_obs)
    db.commit()
    db.refresh(db_obs)
    return db_obs

def get_spa_observation_by_id(db: Session, obs_id: int):
    return db.query(models.SpaObservation).options(
        joinedload(models.SpaObservation.teacher),
        joinedload(models.SpaObservation.auditor),
    ).filter(models.SpaObservation.id == obs_id).first()

def update_spa_observation_draft(db: Session, obs_id: int, update_in: schemas.SpaObservationDraftUpdate):
    db_obs = get_spa_observation_by_id(db, obs_id)
    if not db_obs:
        return None
    db_obs.activity = update_in.activity
    db_obs.timing = update_in.timing
    db_obs.grade_section = update_in.grade_section
    if update_in.observation_type is not None:
        db_obs.observation_type = update_in.observation_type
    db_obs.criteria_scores = {k: v.model_dump() for k, v in update_in.criteria_scores.items()}
    db_obs.overall_score = _sum_spa_scores(update_in.criteria_scores)
    db_obs.strengths_observed = update_in.strengths_observed
    db_obs.areas_of_improvement = update_in.areas_of_improvement
    db.commit()
    db.refresh(db_obs)
    return db_obs

def finalise_spa_observation(db: Session, obs_id: int, finalise_in: schemas.SpaObservationFinalise):
    db_obs = get_spa_observation_by_id(db, obs_id)
    if not db_obs:
        return None
    db_obs.is_draft = False
    db_obs.feedback_shared_with_coach = finalise_in.feedback_shared_with_coach
    db_obs.coach_name = finalise_in.coach_name
    db_obs.coach_date = finalise_in.coach_date
    db_obs.spa_hod_name = finalise_in.spa_hod_name
    db_obs.spa_hod_date = finalise_in.spa_hod_date
    db_obs.ch_name = finalise_in.ch_name
    db_obs.ch_date = finalise_in.ch_date
    db.commit()
    db.refresh(db_obs)
    return db_obs

def get_spa_observations_for_teacher(db: Session, teacher_id: int, include_drafts: bool = False):
    query = db.query(models.SpaObservation).options(
        joinedload(models.SpaObservation.teacher),
        joinedload(models.SpaObservation.auditor),
    ).filter(models.SpaObservation.teacher_id == teacher_id)
    if not include_drafts:
        query = query.filter(models.SpaObservation.is_draft == False)
    return query.order_by(models.SpaObservation.date_time.desc()).all()

def get_spa_teacher_full_history(db: Session, teacher_id: int):
    return db.query(models.SpaObservation).options(
        joinedload(models.SpaObservation.teacher),
        joinedload(models.SpaObservation.auditor),
    ).filter(
        models.SpaObservation.teacher_id == teacher_id
    ).order_by(models.SpaObservation.date_time.desc()).all()

def get_spa_audit_list(db: Session, location: str, sme_user_id: int = None):
    query = db.query(models.SpaObservation).options(
        joinedload(models.SpaObservation.teacher),
        joinedload(models.SpaObservation.auditor),
    ).filter(models.SpaObservation.school == location)
    if sme_user_id:
        assigned_ids = db.query(models.TeacherSME.teacher_id).filter(
            models.TeacherSME.sme_id == sme_user_id
        ).subquery()
        query = query.filter(models.SpaObservation.teacher_id.in_(assigned_ids))
    observations = query.order_by(models.SpaObservation.date_time.desc()).all()
    return [
        {
            "id": obs.id,
            "teacher_id": obs.teacher_id,
            "teacher_name": obs.teacher.name,
            "auditor_name": obs.auditor.name,
            "activity": obs.activity,
            "grade_section": obs.grade_section,
            "observation_type": obs.observation_type or "Unannounced",
            "date_time": utc_iso(obs.date_time),
            "overall_score": obs.overall_score,
            "is_draft": obs.is_draft,
        }
        for obs in observations
    ]


# --- ROLE FITMENT REPORT CRUD ---
def _principal_name_for_branch(principals, branch):
    """Best-effort principal for a branch. The two principals both carry location
    'Both', so we key off their email/name containing the branch (principal.kodathi@,
    principal.attibele@), then fall back to an exact non-'Both' location match."""
    if not branch:
        return None
    b = branch.strip().lower()
    for p in principals:
        if b in (p.email or "").lower() or b in (p.name or "").lower():
            return p.name
    for p in principals:
        if (p.location or "").strip().lower() == b:
            return p.name
    return None

# Designations never subject to a Role Fitment (probation) report — excluded from the
# picker and the coverage "others" list.
EXCLUDED_FROM_FITMENT = {"chairman", "managing director"}

def _current_ay_bounds(today=None):
    """Academic year runs May 1 -> April 30 of the next year."""
    today = today or date.today()
    start_year = today.year if today.month >= 5 else today.year - 1
    return date(start_year, 5, 1), date(start_year + 1, 4, 30)

def _joined_this_year(doj):
    if not doj:
        return False
    s, e = _current_ay_bounds()
    return s <= doj <= e

def _doj_sort_key(iso_or_date):
    # Sort most-recent-first, with unknown DOJ last.
    return (iso_or_date is not None, str(iso_or_date) if iso_or_date else "")

def get_role_fitment_staff_options(db: Session):
    """Selectable employees, enriched from staff_master (employee_id, date_of_joining,
    branch) + branch principal. Excludes Chairman/MD, sorted most-recently-joined first,
    with a `joined_this_year` flag (this academic year = May..April)."""
    sm_by_email = {}
    for r in db.execute(text(
        "SELECT email, employee_id, date_of_joining, branch FROM staff_master"
    )).mappings().all():
        e = (r["email"] or "").strip().lower()
        if e and e not in sm_by_email:
            sm_by_email[e] = r
    principals = db.query(models.User).filter(models.User.designation.ilike("Principal")).all()

    options = []
    for u in db.query(models.User).all():
        if (u.designation or "").strip().lower() in EXCLUDED_FROM_FITMENT:
            continue
        sm = sm_by_email.get((u.email or "").strip().lower())
        branch = (sm["branch"] if sm and sm["branch"] else u.location)
        doj = sm["date_of_joining"] if sm else None
        options.append({
            "user_id": u.id, "name": u.name, "role": u.role,
            "designation": u.designation, "department": u.subject, "branch": branch,
            "employee_code": sm["employee_id"] if sm else None,
            "date_of_joining": doj,
            "joined_this_year": _joined_this_year(doj),
            "principal_name": _principal_name_for_branch(principals, branch),
        })
    options.sort(key=lambda o: _doj_sort_key(o["date_of_joining"]), reverse=True)
    return options

def get_role_fitment_coverage(db: Session, branch: str = None):
    """Staff (teacher / SME / others) with NO Role Fitment report yet. Excludes Chairman/MD
    from 'others'; each person carries subject + DOJ, sorted most-recently-joined first,
    flagged if they joined this academic year."""
    reported_ids = {
        r[0] for r in db.query(models.RoleFitmentReport.employee_user_id)
        .filter(models.RoleFitmentReport.employee_user_id.isnot(None)).all()
    }
    sm_by_email = {}
    for r in db.execute(text("SELECT email, branch, date_of_joining FROM staff_master")).mappings().all():
        e = (r["email"] or "").strip().lower()
        if e and e not in sm_by_email:
            sm_by_email[e] = r

    cats = {"teacher": [], "sme": [], "others": []}
    for u in db.query(models.User).all():
        if u.id in reported_ids:
            continue
        if (u.designation or "").strip().lower() in EXCLUDED_FROM_FITMENT:
            continue
        sm = sm_by_email.get((u.email or "").strip().lower())
        resolved_branch = (sm["branch"] if sm and sm["branch"] else u.location)
        doj = sm["date_of_joining"] if sm else None
        if branch and not ((resolved_branch or "").lower() == branch.lower() or (u.location or "") == "Both"):
            continue
        cat = "teacher" if u.role == "teacher" else ("sme" if u.role == "sme" else "others")
        cats[cat].append({
            "user_id": u.id, "name": u.name, "subject": u.subject,
            "designation": u.designation, "branch": resolved_branch,
            "date_of_joining": doj.isoformat() if doj else None,
            "joined_this_year": _joined_this_year(doj),
        })
    for k in cats:
        cats[k].sort(key=lambda p: _doj_sort_key(p["date_of_joining"]), reverse=True)
    return {k: {"count": len(v), "people": v} for k, v in cats.items()}

def get_role_fitment_report(db: Session, report_id: int):
    return db.query(models.RoleFitmentReport).options(
        joinedload(models.RoleFitmentReport.creator),
        joinedload(models.RoleFitmentReport.evaluations).joinedload(models.RoleFitmentEvaluation.scores),
        joinedload(models.RoleFitmentReport.evaluations).joinedload(models.RoleFitmentEvaluation.remarks),
        joinedload(models.RoleFitmentReport.final_remarks),
    ).filter(models.RoleFitmentReport.id == report_id).first()

def add_role_fitment_final_remark(db: Session, report_id: int, body: schemas.RoleFitmentFinalRemarkIn, user):
    """Append a report-level Final Recommendation remark (any observer / management / HR).
    `close=True` also marks the report completed."""
    db.add(models.RoleFitmentFinalRemark(
        report_id=report_id, remark_text=body.remark_text.strip(), remark_date=body.remark_date,
        author_user_id=user.id, author_name=user.name, author_designation=user.designation,
    ))
    if body.close:
        rep = db.query(models.RoleFitmentReport).filter(models.RoleFitmentReport.id == report_id).first()
        if rep:
            rep.status = "completed"
    db.commit()
    return get_role_fitment_report(db, report_id)

def create_role_fitment_report(db: Session, data: schemas.RoleFitmentReportCreate, creator_id: int):
    rep = models.RoleFitmentReport(
        employee_user_id=data.employee_user_id,
        employee_name=data.employee_name,
        employee_code=data.employee_code,
        designation=data.designation,
        department=data.department,
        branch=data.branch,
        date_of_joining=data.date_of_joining,
        supervisor_name=data.supervisor_name,
        hod_name=data.hod_name,
        principal_name=data.principal_name,
        academic_year=data.academic_year,
        created_by=creator_id,
    )
    db.add(rep)
    db.commit()
    db.refresh(rep)
    return get_role_fitment_report(db, rep.id)

def list_role_fitment_reports(db: Session, branch: str = None):
    q = db.query(models.RoleFitmentReport).options(
        joinedload(models.RoleFitmentReport.creator),
        joinedload(models.RoleFitmentReport.evaluations),
    )
    if branch:
        q = q.filter(models.RoleFitmentReport.branch == branch)
    reports = q.order_by(models.RoleFitmentReport.created_at.desc()).all()
    items = []
    for r in reports:
        periods_done = sum(
            1 for e in r.evaluations if e.evaluation_date or e.average_score is not None
        )
        items.append({
            "id": r.id,
            "employee_name": r.employee_name,
            "designation": r.designation,
            "department": r.department,
            "branch": r.branch,
            "status": r.status,
            "created_at": r.created_at,
            "creator_name": r.creator.name if r.creator else "",
            "periods_done": periods_done,
        })
    return items

def update_role_fitment_header(db: Session, report_id: int, update: schemas.RoleFitmentHeaderUpdate):
    rep = db.query(models.RoleFitmentReport).filter(models.RoleFitmentReport.id == report_id).first()
    if not rep:
        return None
    for field in ("supervisor_name", "hod_name", "principal_name", "date_of_joining", "academic_year", "status"):
        val = getattr(update, field)
        if val is not None:
            setattr(rep, field, val)
    db.commit()
    return get_role_fitment_report(db, report_id)

def delete_role_fitment_report(db: Session, report_id: int):
    rep = db.query(models.RoleFitmentReport).filter(models.RoleFitmentReport.id == report_id).first()
    if not rep:
        return False
    db.delete(rep)  # cascade removes evaluations -> scores + remarks
    db.commit()
    return True

def upsert_role_fitment_block(db: Session, report_id: int, body: schemas.RoleFitmentBlockIn, user):
    """Save one observer's block for a period (their date + 3 parameter scores + remark),
    keyed by (report, period, observer_type). Recomputes that observer's average and
    appends the remark (append-only log) when it's non-empty and changed."""
    ev = db.query(models.RoleFitmentEvaluation).filter_by(
        report_id=report_id, period=body.period, observer_type=body.observer_type
    ).first()
    if not ev:
        ev = models.RoleFitmentEvaluation(
            report_id=report_id, period=body.period, observer_type=body.observer_type,
        )
        db.add(ev)
        db.flush()
    if body.evaluation_date is not None:
        ev.evaluation_date = body.evaluation_date
    ev.evaluated_by = user.id

    existing = {s.parameter_key: s for s in db.query(models.RoleFitmentScore).filter_by(evaluation_id=ev.id).all()}
    for s in body.scores:
        if s.score is None:
            continue
        if s.parameter_key in existing:
            existing[s.parameter_key].score = s.score
        else:
            db.add(models.RoleFitmentScore(evaluation_id=ev.id, parameter_key=s.parameter_key, score=s.score))
    db.flush()

    all_scores = [s.score for s in db.query(models.RoleFitmentScore).filter_by(evaluation_id=ev.id).all() if s.score is not None]
    ev.average_score = round(sum(all_scores) / len(all_scores), 2) if all_scores else None

    txt = (body.remark_text or "").strip()
    if txt:
        latest = db.query(models.RoleFitmentRemark).filter_by(evaluation_id=ev.id).order_by(models.RoleFitmentRemark.created_at.desc()).first()
        if not latest or latest.remark_text != txt or latest.remark_date != body.evaluation_date:
            db.add(models.RoleFitmentRemark(
                evaluation_id=ev.id, remark_type=body.observer_type, remark_text=txt,
                remark_date=body.evaluation_date, author_user_id=user.id, author_name=user.name,
            ))

    db.commit()
    return get_role_fitment_report(db, report_id)
