from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime
import string
import random
from . import models, schemas, auth

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
    d3 = p31 + p32 + p33 + p34
    overall = d1 + d2 + d3
    
    # Rating threshold: >= 23 scale
    if overall >= 23:
        rating = "DISTINGUISHED"
    elif overall >= 17:
        rating = "PROFICIENT"
    elif overall >= 12:
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
    return db.query(models.Observation).filter(models.Observation.id == obs_id).first()

def get_observations_for_teacher(db: Session, teacher_id: int, include_drafts: bool = False):
    query = db.query(models.Observation).filter(models.Observation.teacher_id == teacher_id)
    if not include_drafts:
        query = query.filter(models.Observation.is_draft == False)
    return query.order_by(models.Observation.date_time.desc()).all()

def get_dashboard_teachers(db: Session, location: str, sme_user_id: int = None):
    # Filter observations by location
    obs_query = db.query(models.Observation).filter(models.Observation.school == location)
    
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
    return db.query(models.Observation).filter(
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

def finalise_observation(db: Session, obs_id: int):
    db_obs = get_observation_by_id(db, obs_id)
    if not db_obs:
        return None
    db_obs.is_draft = False
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
