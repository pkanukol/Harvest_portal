from pydantic import BaseModel, EmailStr
from typing import List, Optional
from datetime import datetime

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

    class Config:
        from_attributes = True

# --- OBSERVATION SCHEMAS ---
class ObservationBase(BaseModel):
    school: str
    subject: str
    grade: str
    section: str
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
    p11: Optional[int] = None
    p12: Optional[int] = None
    p21: Optional[int] = None
    p31: Optional[int] = None
    p32: Optional[int] = None
    p33: Optional[int] = None
    p34: Optional[int] = None

class ObservationTeacherRemarks(BaseModel):
    teacher_remarks: str

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
    
    auditor: UserMinimal
    teacher: UserMinimal
    images: List[ObservationImageOut] = []

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
