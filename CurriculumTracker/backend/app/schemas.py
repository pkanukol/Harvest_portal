from typing import Optional, List
from pydantic import BaseModel


class SSORequest(BaseModel):
    supabase_token: str


class SSOResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str  # "Teacher" | "SME" | "Leadership"
    name: str
    email: str
    designation: str
    subject: Optional[str] = None
    location: Optional[str] = None


class PlannerTopicOut(BaseModel):
    chapter_name: str
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    month: str
    sessions: int
    discipline: Optional[str] = None
    pre_req_chapter: Optional[str] = None
    pre_req_topic: Optional[str] = None
    pre_req_subtopic: Optional[str] = None
    pre_req_grade: Optional[str] = None
    cct: Optional[str] = None

    class Config:
        from_attributes = True


class PowCardOut(BaseModel):
    id: int
    teacher_email: str
    teacher_name: str
    subject: str
    grade: str
    week_start: str
    week_end: str
    topic: str
    status: str
    tbs_mom_missing: bool


class TeacherOut(BaseModel):
    email: str
    name: str
    subject: str
    location: str


class PowCardsResponse(BaseModel):
    cards: List[PowCardOut]
    teachers: List[TeacherOut]


class PowCreateRequest(BaseModel):
    subject: str
    grade: str
    week_start: str
    week_end: str
    topic: str  # Chapter Name
    subtopic: Optional[str] = ""  # comma-joined selected Topic/Sub Topic picks
    lp_session_num: Optional[str] = ""
    cw: Optional[str] = ""
    binder: Optional[str] = ""
    activity: Optional[str] = ""
    homework: Optional[str] = ""
    cct_topic_yn: Optional[str] = "No"
    cct_topic_text: Optional[str] = ""
    cct_dashboard_updated: Optional[bool] = False
    tbs_mom: Optional[str] = ""
    correction_done: Optional[str] = ""
    instructions: Optional[str] = ""
    teacher_remarks: Optional[str] = ""


class PowImplementationRequest(BaseModel):
    impl_a: Optional[str] = ""
    impl_b: Optional[str] = ""
    impl_c: Optional[str] = ""
    impl_d: Optional[str] = ""
    impl_e: Optional[str] = ""
    impl_f: Optional[str] = ""
    tbs_mom: Optional[str] = ""
    correction_done: Optional[str] = ""
    instructions: Optional[str] = ""
    teacher_remarks: Optional[str] = ""
    final_save: bool = False


class SmeReviewRequest(BaseModel):
    remarks: Optional[str] = ""
    approved_closed: Optional[bool] = None  # None = section not shown (no impl content yet), see crud.save_sme_review
    cct_discussed: Optional[bool] = None    # None = section not shown (cct_topic_yn != 'yes')
    sme_name: Optional[str] = None          # required by crud.save_sme_review when approved_closed is being set true
    confirmed_date: Optional[str] = None    # ISO date string, required alongside sme_name
