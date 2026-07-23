from sqlalchemy.orm import Session, joinedload
from sqlalchemy import func, or_
from datetime import datetime, timezone
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
        
    d1, d2, d3, overall, rating = calculate_scores_and_rating(
        obs_in.p11, obs_in.p12, obs_in.p21, obs_in.p31, obs_in.p32, obs_in.p33, obs_in.p34
    )
    
    unique_id = generate_unique_id(teacher.name, auditor.name)
    
    db_obs = models.Observation(
        unique_id=unique_id,
        auditor_id=auditor_id,
        teacher_id=obs_in.teacher_id,
        school=obs_in.school,
        subject=obs_in.subject,
        grade=obs_in.grade,
        section=obs_in.section,
        observation_type=obs_in.observation_type,
        p11=obs_in.p11,
        p12=obs_in.p12,
        domain1_score=d1,
        p21=obs_in.p21,
        domain2_score=d2,
        p31=obs_in.p31,
        p32=obs_in.p32,
        p33=obs_in.p33,
        p34=obs_in.p34,
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

def update_observation_draft(db: Session, obs_id: int, update_in: schemas.ObservationDraftUpdate):
    db_obs = get_observation_by_id(db, obs_id)
    if not db_obs:
        return None
    db_obs.objective_observations = update_in.objective_observations
    db_obs.ai_feedback = update_in.ai_feedback
    db_obs.domain1_remarks = update_in.domain1_remarks
    db_obs.domain2_remarks = update_in.domain2_remarks
    db_obs.domain3_remarks = update_in.domain3_remarks
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
        models.User.role == "teacher",
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
        models.User.role == "teacher",
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
            "date_time": utc_iso(obs.date_time),
            "overall_score": obs.overall_score,
            "is_draft": obs.is_draft,
        }
        for obs in observations
    ]
