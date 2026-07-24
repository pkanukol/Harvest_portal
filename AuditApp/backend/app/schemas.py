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
    observation_type: Literal["Unannounced", "Invited"] = "Unannounced"
    p11: int
    p12: int
    p21: int
    p31: int
    p32: int
    p33: int
    p34: int
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
