from typing import Optional, List
from pydantic import BaseModel


class SSORequest(BaseModel):
    supabase_token: str


class SSOResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    access_level: str
    role: str
    name: str
    email: str
    designation: str
    teacher_id: Optional[int] = None


class ClassTeacherOf(BaseModel):
    section_id: int
    code: str  # e.g. "6F"


class SubjectAssignment(BaseModel):
    sst_id: int
    code: str  # e.g. "6A"
    subject: str  # e.g. "Math"
    periods_per_week: int


class TeacherOut(BaseModel):
    id: int
    name: str
    linked_email: Optional[str] = None
    location: str
    is_active: bool
    class_teacher_of: List[ClassTeacherOf] = []
    subject_assignments: List[SubjectAssignment] = []
    subjects: List[str] = []  # distinct subjects across subject_assignments
    periods_per_week: int = 0  # total weekly periods across subject_assignments


class TeacherCreateRequest(BaseModel):
    name: str
    linked_email: Optional[str] = None


class TeacherLinkEmailRequest(BaseModel):
    linked_email: Optional[str] = None


class TeacherUpdateRequest(BaseModel):
    name: Optional[str] = None
    linked_email: Optional[str] = None


class SetTeacherRequest(BaseModel):
    teacher_id: Optional[int] = None


class SubjectRenameRequest(BaseModel):
    raw_name: str


class SubjectSlotCreateRequest(BaseModel):
    subject_name: str
    periods_per_week: Optional[int] = None  # required only if this subject is new for the grade
    component_label: Optional[str] = None
    teacher_id: Optional[int] = None


class ImportCommitRequest(BaseModel):
    label: str
    location: str = "Kodathi"
    parsed: dict  # the exact payload returned by /import/preview
    rules_text: Optional[str] = None  # raw rules.txt content - see app/rules.py; None = use DEFAULT_RULES_TEXT
    lessons: Optional[list] = None  # from /import/preview-timetable-export - see app/timetable_workbook.py
    teacher_details: Optional[list] = None  # from /import/preview-teacher-details - email + class teacher only


class GapTarget(BaseModel):
    section_id: int
    gsp_id: int


class GenerateSelectedRequest(BaseModel):
    targets: List[GapTarget]


class SlotPatchRequest(BaseModel):
    section_subject_teacher_ids: List[int] = []  # empty = clear the slot


class GenerateRequest(BaseModel):
    academic_year_id: int


class SubstitutionSuggestRequest(BaseModel):
    academic_year_id: int
    date: str  # "YYYY-MM-DD"
    absent_teacher_id: int


class SubstitutionCreateRequest(BaseModel):
    academic_year_id: int
    date: str
    day_of_week: int
    period_number: int
    grade_name: str
    section_name: str
    subject: str
    absent_teacher_name: str
    absent_teacher_id: Optional[int] = None
    substitute_teacher_name: str
    substitute_teacher_id: Optional[int] = None
    tier: Optional[int] = None
