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
    can_view_as: bool = False  # allowlisted to preview the app as other staff
    can_upload_curriculum: bool = False  # SME, or a named curriculum administrator
    can_see_lagging: bool = False  # SME/HOD and leadership — the curriculum-lag dashboard


class MeResponse(BaseModel):
    """Identity + capabilities recomputed server-side, so a cached session
    picks up capability changes without a fresh portal login."""
    role: str
    name: str
    email: str
    designation: str
    subject: Optional[str] = None
    subjects: List[str] = []   # every subject they teach; may be more than one
    location: Optional[str] = None
    can_view_as: bool = False
    can_upload_curriculum: bool = False
    can_see_lagging: bool = False


class ViewAsRequest(BaseModel):
    email: str


class StaffOut(BaseModel):
    email: str
    name: str
    designation: str
    subject: Optional[str] = None
    role: str


class StaffSearchResponse(BaseModel):
    staff: List[StaffOut]


class PlannerTopicOut(BaseModel):
    subject: str  # the planner subject this row came from — the stream (Biology/Physics/Chemistry) for grouped subjects
    chapter_name: str
    topic: Optional[str] = None
    subtopic: Optional[str] = None
    month: str
    sessions: int
    discipline: Optional[str] = None
    skill_of_development: Optional[str] = None
    strands_of_language: Optional[str] = None  # shown in place of Discipline when present (English/Hindi)
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


class TeachersResponse(BaseModel):
    teachers: List[TeacherOut]


# ─── Curriculum upload ──────────────────────────────────────────────────────

class PlannerInventoryItem(BaseModel):
    subject: str
    grade: int
    rows: int
    chapters: int
    warnings: List[str] = []       # from the last import, kept until a clean re-upload
    imported_at: Optional[str] = None
    imported_by: Optional[str] = None


class SubjectOptions(BaseModel):
    curriculum: List[str]  # subjects curriculum workbooks exist for — offered first
    other: List[str]       # every other subject staff are tagged with


class PlannerInventoryResponse(BaseModel):
    inventory: List[PlannerInventoryItem]
    subjects: SubjectOptions


class PlannerChapterPreview(BaseModel):
    chapter_name: str
    month: str
    sessions: int
    discipline: Optional[str] = None  # Strands of Language for English/Hindi, Discipline otherwise
    topics: int
    subtopics: int


class PlannerGradePreview(BaseModel):
    grade: int
    tab: str                 # the workbook tab this grade was read from
    row_count: int
    chapter_count: int
    chapters: List[PlannerChapterPreview]
    has_strands: bool        # sheet carries a "Strands of Language" column
    has_skill: bool          # sheet carries a "Skill of Development" column
    existing_rows: int       # rows already stored for this subject+grade, i.e. what Confirm replaces
    warnings: List[str]
    replaced: int
    imported: int


class PlannerSkippedTab(BaseModel):
    name: str
    why: str


class PlannerImportResponse(BaseModel):
    committed: bool          # False for a preview (nothing written), True after Confirm
    subject: str
    grades: List[PlannerGradePreview]
    missing_grades: List[int]        # of Grades 1-10, the ones this workbook has no tab for
    skipped_tabs: List[PlannerSkippedTab]
    warnings: List[str]
    total_rows: int


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
