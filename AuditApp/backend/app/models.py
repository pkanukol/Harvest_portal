import datetime
from sqlalchemy import Column, Integer, Float, String, Boolean, DateTime, Date, Text, ForeignKey, UniqueConstraint, JSON
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
    topic = Column(String, nullable=True)
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
    observation_type = Column(String, nullable=True)  # 'Unannounced' or 'Invited'

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


# --- ROLE FITMENT REPORT (probation evaluation for leadership) -----------------
# A separate observation format from Classroom/SPA: a probation "Role Fitment Report"
# for one employee, filled across 4 periods (1st / 3rd / 6th / 11th month) over the
# probation year. Only leadership designations (see ROLE_FITMENT_DESIGNATIONS in
# main.py) can see/create these. Header identity is snapshotted from users +
# staff_master at creation so the report stays correct even if those change later.
class RoleFitmentReport(Base):
    __tablename__ = "role_fitment_reports"

    id = Column(Integer, primary_key=True, index=True)
    # The employee being evaluated (their app account, if they have one).
    employee_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    employee_name = Column(String, nullable=False)
    employee_code = Column(String, nullable=True)      # staff_master.employee_id
    designation = Column(String, nullable=True)
    department = Column(String, nullable=True)          # users.subject
    branch = Column(String, nullable=True)              # users.location / staff_master.branch
    date_of_joining = Column(Date, nullable=True)
    supervisor_name = Column(String, nullable=True)     # observer fills
    hod_name = Column(String, nullable=True)            # observer fills
    principal_name = Column(String, nullable=True)      # auto from branch, editable
    academic_year = Column(String, nullable=True)
    status = Column(String, default="in_progress")      # in_progress | completed

    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    employee = relationship("User", foreign_keys=[employee_user_id])
    creator = relationship("User", foreign_keys=[created_by])
    evaluations = relationship("RoleFitmentEvaluation", back_populates="report", cascade="all, delete-orphan")
    final_remarks = relationship("RoleFitmentFinalRemark", back_populates="report", cascade="all, delete-orphan")


class RoleFitmentEvaluation(Base):
    """One observer's assessment block for a period — each observer (HOD / Principal /
    Block Head) scores the parameters and gives a remark independently."""
    __tablename__ = "role_fitment_evaluations"
    __table_args__ = (UniqueConstraint("report_id", "period", "observer_type", name="uq_rf_report_period_observer"),)

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("role_fitment_reports.id"), nullable=False)
    period = Column(String, nullable=False)             # first_month|third_month|sixth_month|ninth_month
    observer_type = Column(String, nullable=True)       # hod | principal | block_head
    evaluation_date = Column(Date, nullable=True)
    average_score = Column(Float, nullable=True)        # avg of the period's parameter scores (out of 5)
    evaluated_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    report = relationship("RoleFitmentReport", back_populates="evaluations")
    evaluator = relationship("User", foreign_keys=[evaluated_by])
    scores = relationship("RoleFitmentScore", back_populates="evaluation", cascade="all, delete-orphan")
    remarks = relationship("RoleFitmentRemark", back_populates="evaluation", cascade="all, delete-orphan")


class RoleFitmentScore(Base):
    __tablename__ = "role_fitment_scores"
    __table_args__ = (UniqueConstraint("evaluation_id", "parameter_key", name="uq_rf_eval_param"),)

    id = Column(Integer, primary_key=True, index=True)
    evaluation_id = Column(Integer, ForeignKey("role_fitment_evaluations.id"), nullable=False)
    parameter_key = Column(String, nullable=False)      # e.g. 'understanding_of_role'
    score = Column(Integer, nullable=True)              # 0..5

    evaluation = relationship("RoleFitmentEvaluation", back_populates="scores")


class RoleFitmentRemark(Base):
    """Append-only remark log — every remark entered is kept (with author + timestamp),
    so nothing is lost when a later contributor edits their remark."""
    __tablename__ = "role_fitment_remarks"

    id = Column(Integer, primary_key=True, index=True)
    evaluation_id = Column(Integer, ForeignKey("role_fitment_evaluations.id"), nullable=False)
    remark_type = Column(String, nullable=False)        # hod|principal|block_head|overall_recommendation|final_recommendation
    remark_text = Column(Text, nullable=False)
    remark_date = Column(Date, nullable=True)           # date this remark author set for their entry
    author_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    author_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    evaluation = relationship("RoleFitmentEvaluation", back_populates="remarks")
    author = relationship("User", foreign_keys=[author_user_id])


class RoleFitmentFinalRemark(Base):
    """Report-level 'Final Recommendation for next Academic Year' — an append-only thread any
    observer / management / HR can add to; HR can close the report with their remark."""
    __tablename__ = "role_fitment_final_remarks"

    id = Column(Integer, primary_key=True, index=True)
    report_id = Column(Integer, ForeignKey("role_fitment_reports.id"), nullable=False)
    remark_text = Column(Text, nullable=False)
    remark_date = Column(Date, nullable=True)
    author_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    author_name = Column(String, nullable=True)
    author_designation = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    report = relationship("RoleFitmentReport", back_populates="final_remarks")
    author = relationship("User", foreign_keys=[author_user_id])
