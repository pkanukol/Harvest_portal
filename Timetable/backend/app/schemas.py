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


class TeacherLinkEmailRequest(BaseModel):
    linked_email: Optional[str] = None


class TeacherUpdateRequest(BaseModel):
    name: Optional[str] = None
    linked_email: Optional[str] = None


class SetTeacherRequest(BaseModel):
    teacher_id: Optional[int] = None


class ImportCommitRequest(BaseModel):
    label: str
    location: str = "Kodathi"
    parsed: dict  # the exact payload returned by /import/preview
    rules_text: Optional[str] = None  # raw rules.txt content - see app/rules.py; None = use DEFAULT_RULES_TEXT


class GapTarget(BaseModel):
    section_id: int
    gsp_id: int


class GenerateSelectedRequest(BaseModel):
    targets: List[GapTarget]


class SlotPatchRequest(BaseModel):
    section_subject_teacher_ids: List[int] = []  # empty = clear the slot


class GenerateRequest(BaseModel):
    academic_year_id: int
