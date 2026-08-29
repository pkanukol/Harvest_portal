from typing import Optional, List
from pydantic import BaseModel, Field


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
    can_see_lagging: bool = False   # SME/HOD and leadership — the curriculum-lag dashboard
    can_create_pow: bool = False    # also teaches, so may file POWs regardless of role
    can_see_overview: bool = False  # the week-by-week Curriculum Overview table
    can_oversee: bool = False       # reads curriculum delivery across teachers
    branches: List[str] = []        # campuses this account may view


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
    can_create_pow: bool = False
    can_see_overview: bool = False
    can_oversee: bool = False
    branches: List[str] = []


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
    branch: str = ""
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


class SubjectOptions(BaseModel):
    curriculum: List[str] = []  # subjects curriculum workbooks exist for — offered first
    other: List[str] = []       # every other subject staff are tagged with


class TeachersResponse(BaseModel):
    teachers: List[TeacherOut]
    branches: List[str] = []   # campuses this viewer may switch between
    # Optional with a default on purpose: a required field here means any
    # response that omits it is a 500 rather than a slightly emptier dropdown —
    # which is what a half-deployed backend produced. The frontend already
    # falls back to deriving subjects from the teacher list.
    subjects: SubjectOptions = Field(default_factory=SubjectOptions)


# ─── Curriculum upload ──────────────────────────────────────────────────────

class PlannerInventoryItem(BaseModel):
    subject: str
    grade: int
    rows: int
    chapters: int
    warnings: List[str] = []       # from the last import, kept until a clean re-upload
    imported_at: Optional[str] = None
    imported_by: Optional[str] = None


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


class PowSessionIn(BaseModel):
    """One session of the week, with its own plan. See models.PowSession."""
    session_no: Optional[str] = ""
    # The sections this session is for. Empty means the whole grade.
    sections: List[str] = []
    # Defaults to the POW's chapter on the form; sent per session because a
    # week can finish one chapter and start the next.
    chapter: Optional[str] = ""
    topic: Optional[str] = ""
    subtopic: Optional[str] = ""
    cw: Optional[str] = ""
    binder: Optional[str] = ""
    activity: Optional[str] = ""
    homework: Optional[str] = ""
    lp_link: Optional[str] = ""
    learning_outcomes: Optional[str] = ""


class PowSectionPlanIn(BaseModel):
    """What one section is working on. Sections drift apart, so this is per
    section rather than once for the grade - see models.PowSectionPlan."""
    section: str
    chapter: Optional[str] = ""
    topic: Optional[str] = ""
    subtopic: Optional[str] = ""


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
    instructions: Optional[str] = ""          # labelled "Events / Holidays" in the UI
    teacher_remarks: Optional[str] = ""       # retired; kept so an older client still posts cleanly
    # Per session, and per section. cw/binder/activity/homework above stay for
    # older clients; when sessions are sent they are what counts.
    sessions: List[PowSessionIn] = []
    section_plans: List[PowSectionPlanIn] = []


class SessionImplIn(BaseModel):
    """One section's record of one session. See models.PowSessionImpl."""
    session_id: int
    section: str
    remarks: Optional[str] = None
    completed_on: Optional[str] = None      # ISO date, or "" to clear
    correction_on: Optional[str] = None


class PowImplementationRequest(BaseModel):
    """Every field defaults to None = "not sent", so a caller can save just one
    section (or just the TBS MOM) without wiping the rest. An explicit "" is
    still honoured as the user clearing that field."""
    impl_a: Optional[str] = None
    impl_b: Optional[str] = None
    impl_c: Optional[str] = None
    impl_d: Optional[str] = None
    impl_e: Optional[str] = None
    impl_f: Optional[str] = None
    # ISO dates, or "" to clear. Same not-sent-means-untouched rule as above.
    impl_a_date: Optional[str] = None
    impl_b_date: Optional[str] = None
    impl_c_date: Optional[str] = None
    impl_d_date: Optional[str] = None
    impl_e_date: Optional[str] = None
    impl_f_date: Optional[str] = None
    # Correction Done is now a date per section, saved beside that section's
    # completion date. Same not-sent-means-untouched rule.
    correction_a_date: Optional[str] = None
    correction_b_date: Optional[str] = None
    correction_c_date: Optional[str] = None
    correction_d_date: Optional[str] = None
    correction_e_date: Optional[str] = None
    correction_f_date: Optional[str] = None
    tbs_mom: Optional[str] = None
    correction_done: Optional[str] = None
    instructions: Optional[str] = None
    teacher_remarks: Optional[str] = None
    # Per (session, section). Only the rows sent are touched, so one section's
    # teacher saving theirs never disturbs another's.
    session_impl: List[SessionImplIn] = []
    final_save: bool = False


class SmeReviewRequest(BaseModel):
    remarks: Optional[str] = ""
    approved_closed: Optional[bool] = None  # None = section not shown (no impl content yet), see crud.save_sme_review
    cct_discussed: Optional[bool] = None    # None = section not shown (cct_topic_yn != 'yes')
    sme_name: Optional[str] = None          # required by crud.save_sme_review when approved_closed is being set true
    confirmed_date: Optional[str] = None    # ISO date string, required alongside sme_name


# ─── Backfill (curriculum covered before POWs began) ────────────────────────

class BackfillMark(BaseModel):
    month: str
    chapter_name: str
    subtopic: Optional[str] = None   # None = the whole chapter
    done: bool = True


class BackfillSaveRequest(BaseModel):
    subject: str
    grade: int
    branch: Optional[str] = ""      # coverage is marked per campus
    marks: List[BackfillMark] = []


class BackfillItem(BaseModel):
    label: str
    done: bool


class BackfillChapter(BaseModel):
    month: str
    chapter_name: str
    sessions: int
    done: bool
    items: List[BackfillItem] = []
    items_done: int = 0


class BackfillConfirmRequest(BaseModel):
    subject: str
    grade: int
    branch: Optional[str] = ""


class BackfillResponse(BaseModel):
    subject: str
    grade: int
    confirmed_by: Optional[str] = None
    confirmed_at: Optional[str] = None
    months: List[str]            # April up to and including the current month
    chapters: List[BackfillChapter]
    locked: bool                 # confirmed complete by an SME — POWs do not lock it
    pow_count: int
    marked_by: Optional[str] = None
