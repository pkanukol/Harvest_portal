import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Text, ForeignKey, UniqueConstraint, JSON
from sqlalchemy.orm import relationship
from .database import Base


class TeacherSME(Base):
    """Many-to-many: a teacher can be observed by multiple SMEs."""
    __tablename__ = "teacher_sme"
    __table_args__ = (UniqueConstraint("teacher_id", "sme_id", name="uq_teacher_sme"),)

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sme_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    teacher = relationship("User", foreign_keys=[teacher_id], backref="sme_assignments")
    sme = relationship("User", foreign_keys=[sme_id], backref="assigned_teachers")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    name = Column(String, nullable=False)
    designation = Column(String, nullable=False)
    role = Column(String, nullable=False)  # 'teacher', 'auditor', 'sme'
    location = Column(String, nullable=False)  # 'Kodathi', 'Attibele', 'Both'
    app_password = Column(String, nullable=True)
    subject = Column(String, nullable=True)


class Observation(Base):
    __tablename__ = "observations"

    id = Column(Integer, primary_key=True, index=True)
    unique_id = Column(String, unique=True, index=True, nullable=False)
    date_time = Column(DateTime, default=datetime.datetime.utcnow)
    
    auditor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    school = Column(String, nullable=False)  # 'Kodathi' or 'Attibele'
    subject = Column(String, nullable=False)
    grade = Column(String, nullable=False)
    section = Column(String, nullable=False)
    observation_type = Column(String, nullable=True)  # 'Unannounced' or 'Invited'
    
    # Domain Scores
    p11 = Column(Integer, nullable=False)
    p12 = Column(Integer, nullable=False)
    domain1_score = Column(Integer, nullable=False)
    
    p21 = Column(Integer, nullable=False)
    domain2_score = Column(Integer, nullable=False)
    
    p31 = Column(Integer, nullable=False)
    p32 = Column(Integer, nullable=False)
    p33 = Column(Integer, nullable=False)
    p34 = Column(Integer, nullable=False)
    domain3_score = Column(Integer, nullable=False)
    
    overall_score = Column(Integer, nullable=False)
    rating = Column(String, nullable=False)  # DISTINGUISHED, PROFICIENT, DEVELOPING, BEGINNING
    
    # Issues & Remarks
    infrastructure_issues = Column(Text, nullable=True)
    other_issues = Column(Text, nullable=True)
    objective_observations = Column(Text, nullable=True)
    teacher_remarks = Column(Text, nullable=True)
    ai_feedback = Column(Text, nullable=True)
    domain1_remarks = Column(Text, nullable=True)
    domain2_remarks = Column(Text, nullable=True)
    domain3_remarks = Column(Text, nullable=True)
    
    # Status
    is_draft = Column(Boolean, default=True)
    email_sent = Column(Boolean, default=False)
    remarks_saved = Column(Boolean, default=False)

    # Third-party witness recorded at finalisation (SME mutual-agreement acknowledgment)
    witness_name = Column(String, nullable=True)
    witness_designation = Column(String, nullable=True)

    # Relationships
    auditor = relationship("User", foreign_keys=[auditor_id], backref="conducted_observations")
    teacher = relationship("User", foreign_keys=[teacher_id], backref="received_observations")
    images = relationship("ObservationImage", back_populates="observation", cascade="all, delete-orphan")


class ObservationImage(Base):
    __tablename__ = "observation_images"

    id = Column(Integer, primary_key=True, index=True)
    observation_id = Column(Integer, ForeignKey("observations.id"), nullable=False)
    image_path = Column(String, nullable=False)
    uploaded_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    observation = relationship("Observation", back_populates="images")


class SpaObservation(Base):
    """SPA (Sports/Performing Arts) observation — a separate form from the classroom
    Observation model since its 18 criteria have varying per-row max scores (not a
    fixed 4-point rubric), so scores+comments are stored as one JSON blob keyed by
    criterion id rather than fixed columns."""
    __tablename__ = "spa_observations"

    id = Column(Integer, primary_key=True, index=True)
    unique_id = Column(String, unique=True, index=True, nullable=False)
    date_time = Column(DateTime, default=datetime.datetime.utcnow)

    auditor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # SPA coach

    school = Column(String, nullable=False)
    activity = Column(String, nullable=False)
    timing = Column(String, nullable=True)
    grade_section = Column(String, nullable=True)

    # {criterion_key: {"score": int, "comment": str}} — criteria defined in frontend spaRubrics.js
    criteria_scores = Column(JSON, nullable=False, default=dict)
    overall_score = Column(Integer, nullable=False, default=0)

    strengths_observed = Column(Text, nullable=True)
    areas_of_improvement = Column(Text, nullable=True)

    feedback_shared_with_coach = Column(Boolean, nullable=True)
    coach_name = Column(String, nullable=True)
    coach_date = Column(Date, nullable=True)
    spa_hod_name = Column(String, nullable=True)
    spa_hod_date = Column(Date, nullable=True)
    ch_name = Column(String, nullable=True)
    ch_date = Column(Date, nullable=True)

    is_draft = Column(Boolean, default=True)
    email_sent = Column(Boolean, default=False)

    auditor = relationship("User", foreign_keys=[auditor_id])
    teacher = relationship("User", foreign_keys=[teacher_id])
