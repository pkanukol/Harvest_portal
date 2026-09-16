from pydantic import BaseModel, EmailStr, field_serializer
from typing import Dict, List, Literal, Optional
from datetime import date, datetime, timezone

def _utc_iso(dt):
    """Naive datetimes in this app are always UTC (written via datetime.utcnow()), but
    lack an explicit timezone marker — without one, browsers parse the ISO string as
    local time instead of converting from UTC, showing times ~5:30h off in India."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()

# --- USER SCHEMAS ---
class UserBase(BaseModel):
    email: EmailStr
    name: str
    designation: str
    role: str  # 'teacher', 'auditor', 'sme'
    location: str  # 'Kodathi', 'Attibele', 'Both'

class UserCreate(UserBase):
    password: str

class UserOut(UserBase):
    id: int

    class Config:
        from_attributes = True

class UserMinimal(BaseModel):
    id: int
    name: str
    email: str
    role: str
    designation: str
    location: str

    class Config:
        from_attributes = True

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    name: str
    email: str
    designation: str
    location: str
    id: int

class TokenData(BaseModel):
    email: Optional[str] = None
    role: Optional[str] = None

# --- IMAGE SCHEMAS ---
class ObservationImageBase(BaseModel):
    image_path: str

class ObservationImageCreate(ObservationImageBase):
    pass

class ObservationImageOut(ObservationImageBase):
    id: int
    observation_id: int
    uploaded_at: datetime

    @field_serializer("uploaded_at")
    def _ser_uploaded_at(self, dt, _info):
        return _utc_iso(dt)

    class Config:
        from_attributes = True

# --- OBSERVATION SCHEMAS ---
class ObservationBase(BaseModel):
    school: str
    subject: str
    grade: str
    section: str
    topic: Optional[str] = None
    observation_type: Literal["Unannounced", "Invited"] = "Unannounced"
    # Scores default to 0 ("not scored yet") so an auditor can save a draft with only the
    # basic session data. Valid rubric scores are 1-4; all domain params must be filled
    # (>= 1) before the observation can be finalised. p34 (Technology) may stay 0 = N/A.
    p11: Optional[int] = 0
    p12: Optional[int] = 0
    p21: Optional[int] = 0
    p31: Optional[int] = 0
    p32: Optional[int] = 0
    p33: Optional[int] = 0
    p34: Optional[int] = 0
    infrastructure_issues: Optional[str] = ""
    other_issues: Optional[str] = ""
    objective_observations: Optional[str] = ""
    domain1_remarks: Optional[str] = ""
    domain2_remarks: Optional[str] = ""
    domain3_remarks: Optional[str] = ""

class ObservationCreate(ObservationBase):
    teacher_id: int

class ObservationDraftUpdate(BaseModel):
    objective_observations: str
    ai_feedback: str
    domain1_remarks: Optional[str] = ""
    domain2_remarks: Optional[str] = ""
    domain3_remarks: Optional[str] = ""
    topic: Optional[str] = None
    observation_type: Optional[Literal["Unannounced", "Invited"]] = None
    p11: Optional[int] = None
    p12: Optional[int] = None
    p21: Optional[int] = None
    p31: Optional[int] = None
    p32: Optional[int] = None
    p33: Optional[int] = None
    p34: Optional[int] = None

class ObservationTeacherRemarks(BaseModel):
    teacher_remarks: str

class ObservationFinalise(BaseModel):
    witness_name: Optional[str] = None
    witness_designation: Optional[str] = None

class ObservationOut(ObservationBase):
    id: int
    unique_id: str
    date_time: datetime
    auditor_id: int
    teacher_id: int
    domain1_score: int
    domain2_score: int
    domain3_score: int
    overall_score: int
    rating: str
    teacher_remarks: Optional[str] = None
    ai_feedback: Optional[str] = None
    domain1_remarks: Optional[str] = None
    domain2_remarks: Optional[str] = None
    domain3_remarks: Optional[str] = None
    is_draft: bool
    email_sent: bool
    remarks_saved: bool
    witness_name: Optional[str] = None
    witness_designation: Optional[str] = None

    auditor: UserMinimal
    teacher: UserMinimal
    images: List[ObservationImageOut] = []

    @field_serializer("date_time")
    def _ser_date_time(self, dt, _info):
        return _utc_iso(dt)

    class Config:
        from_attributes = True

class TeacherSummary(BaseModel):
    teacher_id: int
    teacher_name: str
    subject: str
    latest_rating: str
    avg_score: float
    obs_count: int
    has_draft: bool = False
    latest_date: Optional[datetime] = None
    latest_auditor_name: str = ""

    class Config:
        from_attributes = True

class DashboardData(BaseModel):
    teachers: List[TeacherSummary]
    location: str

class ProgressComparisonRequest(BaseModel):
    teacher_id: int

# --- SPA (SPORTS / PERFORMING ARTS) OBSERVATION SCHEMAS ---
class CriterionScore(BaseModel):
    score: int
    comment: Optional[str] = ""

class SpaObservationBase(BaseModel):
    school: str
    activity: str
    timing: Optional[str] = ""
    grade_section: Optional[str] = ""
    observation_type: Literal["Unannounced", "Invited"] = "Unannounced"
    criteria_scores: Dict[str, CriterionScore]
    strengths_observed: Optional[str] = ""
    areas_of_improvement: Optional[str] = ""

class SpaObservationCreate(SpaObservationBase):
    teacher_id: int

class SpaObservationDraftUpdate(BaseModel):
    activity: str
    timing: Optional[str] = ""
    grade_section: Optional[str] = ""
    observation_type: Optional[Literal["Unannounced", "Invited"]] = None
    criteria_scores: Dict[str, CriterionScore]
    strengths_observed: Optional[str] = ""
    areas_of_improvement: Optional[str] = ""

class SpaObservationFinalise(BaseModel):
    feedback_shared_with_coach: Optional[bool] = None
    coach_name: Optional[str] = None
    coach_date: Optional[date] = None
    spa_hod_name: Optional[str] = None
    spa_hod_date: Optional[date] = None
    ch_name: str
    ch_date: date

class SpaObservationOut(SpaObservationBase):
    id: int
    unique_id: str
    date_time: datetime
    auditor_id: int
    teacher_id: int
    overall_score: int
    is_draft: bool
    email_sent: bool
    feedback_shared_with_coach: Optional[bool] = None
    coach_name: Optional[str] = None
    coach_date: Optional[date] = None
    spa_hod_name: Optional[str] = None
    spa_hod_date: Optional[date] = None
    ch_name: Optional[str] = None
    ch_date: Optional[date] = None

    auditor: UserMinimal
    teacher: UserMinimal

    @field_serializer("date_time")
    def _ser_date_time(self, dt, _info):
        return _utc_iso(dt)

    class Config:
        from_attributes = True


# --- ROLE FITMENT REPORT SCHEMAS ---
RoleFitmentPeriod = Literal["first_month", "third_month", "sixth_month", "ninth_month"]

class RoleFitmentStaffOption(BaseModel):
    """One selectable employee for a new report, with header fields pre-resolved."""
    user_id: int
    name: str
    role: Optional[str] = None            # teacher | sme | auditor (drives the category filter)
    designation: Optional[str] = None
    department: Optional[str] = None
    branch: Optional[str] = None
    employee_code: Optional[str] = None
    date_of_joining: Optional[date] = None
    joined_this_year: bool = False
    principal_name: Optional[str] = None

class RoleFitmentReportCreate(BaseModel):
    employee_user_id: Optional[int] = None
    employee_name: str
    employee_code: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    branch: Optional[str] = None
    date_of_joining: Optional[date] = None
    supervisor_name: Optional[str] = None
    hod_name: Optional[str] = None
    principal_name: Optional[str] = None
    academic_year: Optional[str] = None

class RoleFitmentHeaderUpdate(BaseModel):
    supervisor_name: Optional[str] = None
    hod_name: Optional[str] = None
    principal_name: Optional[str] = None
    date_of_joining: Optional[date] = None
    academic_year: Optional[str] = None
    status: Optional[Literal["in_progress", "completed"]] = None

class RoleFitmentFinalRemarkIn(BaseModel):
    remark_text: str
    remark_date: Optional[date] = None
    close: bool = False  # HR/management can close (mark completed) with their remark

class RoleFitmentScoreIn(BaseModel):
    parameter_key: str
    score: Optional[int] = None  # 0..5

class RoleFitmentRemarkIn(BaseModel):
    remark_type: str
    remark_text: str

class RoleFitmentBlockIn(BaseModel):
    """Save one observer's block for a period: their date, the 3 parameter scores, and
    their remark — all together (one Save button per observer block)."""
    period: RoleFitmentPeriod
    observer_type: str  # hod | principal | block_head
    evaluation_date: Optional[date] = None
    scores: List[RoleFitmentScoreIn] = []
    remark_text: Optional[str] = None

# --- Out ---
class RoleFitmentScoreOut(BaseModel):
    parameter_key: str
    score: Optional[int] = None

    class Config:
        from_attributes = True

class RoleFitmentRemarkOut(BaseModel):
    id: int
    remark_type: str
    remark_text: str
    remark_date: Optional[date] = None
    author_name: Optional[str] = None
    created_at: datetime

    @field_serializer("created_at")
    def _ser_created_at(self, dt, _info):
        return _utc_iso(dt)

    class Config:
        from_attributes = True

class RoleFitmentEvaluationOut(BaseModel):
    id: int
    period: str
    observer_type: Optional[str] = None
    evaluation_date: Optional[date] = None
    average_score: Optional[float] = None
    scores: List[RoleFitmentScoreOut] = []
    remarks: List[RoleFitmentRemarkOut] = []

    class Config:
        from_attributes = True

class RoleFitmentFinalRemarkOut(BaseModel):
    id: int
    remark_text: str
    remark_date: Optional[date] = None
    author_name: Optional[str] = None
    author_designation: Optional[str] = None
    created_at: datetime

    @field_serializer("created_at")
    def _ser_created_at(self, dt, _info):
        return _utc_iso(dt)

    class Config:
        from_attributes = True

class RoleFitmentReportOut(BaseModel):
    id: int
    employee_user_id: Optional[int] = None
    employee_name: str
    employee_code: Optional[str] = None
    designation: Optional[str] = None
    department: Optional[str] = None
    branch: Optional[str] = None
    date_of_joining: Optional[date] = None
    supervisor_name: Optional[str] = None
    hod_name: Optional[str] = None
    principal_name: Optional[str] = None
    academic_year: Optional[str] = None
    status: str
    created_by: int
    created_at: datetime
    creator: UserMinimal
    evaluations: List[RoleFitmentEvaluationOut] = []
    final_remarks: List[RoleFitmentFinalRemarkOut] = []

    @field_serializer("created_at")
    def _ser_created_at(self, dt, _info):
        return _utc_iso(dt)

    class Config:
        from_attributes = True

class RoleFitmentListItem(BaseModel):
    id: int
    employee_name: str
    designation: Optional[str] = None
    department: Optional[str] = None
    branch: Optional[str] = None
    status: str
    created_at: datetime
    creator_name: str
    periods_done: int

    @field_serializer("created_at")
    def _ser_created_at(self, dt, _info):
        return _utc_iso(dt)
