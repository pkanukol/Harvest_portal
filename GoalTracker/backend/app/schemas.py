from typing import Optional, List
from datetime import date, datetime
from pydantic import BaseModel


class SSORequest(BaseModel):
    supabase_token: str


class SSOResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    name: str
    email: str
    designation: str
    is_admin: bool
    location: Optional[str] = None


class GoalLogOut(BaseModel):
    id: int
    log_date: date
    notes: str

    class Config:
        from_attributes = True


class GoalLogCreate(BaseModel):
    log_date: Optional[date] = None  # defaults to today if omitted
    notes: str


class GoalCreate(BaseModel):
    cadence: str  # mid_term | annual
    category: str  # role_based | organizational
    title: str
    specific_text: str
    measurable_text: str
    achievable_text: Optional[str] = None
    relevant_text: Optional[str] = None


class GoalEdit(BaseModel):
    title: str
    specific_text: str
    measurable_text: str
    achievable_text: Optional[str] = None
    relevant_text: Optional[str] = None


class ReviewActionOut(BaseModel):
    id: int
    action_type: str  # approved | modified | struck_off
    reason: Optional[str] = None
    reviewed_by: str
    reviewed_at: datetime
    owner_ack_by: Optional[str] = None
    owner_ack_at: Optional[datetime] = None
    upper_ack_by: Optional[str] = None
    upper_ack_at: Optional[datetime] = None
    upper_ack_notes: Optional[str] = None

    class Config:
        from_attributes = True


class GoalOut(BaseModel):
    id: int
    owner_email: str
    cadence: str
    category: str
    period_key: str
    title: str
    specific_text: str
    measurable_text: str
    achievable_text: Optional[str] = None
    relevant_text: Optional[str] = None
    status: str
    logs: List[GoalLogOut] = []
    review_actions: List[ReviewActionOut] = []

    class Config:
        from_attributes = True


class FlagsOut(BaseModel):
    mid_term_missing: bool
    annual_missing: bool
    mid_term_set: bool
    annual_set: bool


class GoalsResponse(BaseModel):
    goals: List[GoalOut]
    flags: FlagsOut


class ReviewRequest(BaseModel):
    action_type: str  # approved | modified | struck_off
    reason: Optional[str] = None
    # required when action_type == "modified" - the new field values
    edit: Optional[GoalEdit] = None


class AckRequest(BaseModel):
    notes: Optional[str] = None


class ReviewerAssignmentOut(BaseModel):
    person_email: str
    person_name: str
    designation: str
    reviewer_email: Optional[str] = None
    acknowledger_email: Optional[str] = None


class ReviewerAssignmentIn(BaseModel):
    person_email: str
    reviewer_email: Optional[str] = None
    acknowledger_email: Optional[str] = None


class DirectoryEntryOut(BaseModel):
    email: str
    name: str
    designation: str


class ReviewerAssignmentsResponse(BaseModel):
    people: List[ReviewerAssignmentOut]
    directory: List[DirectoryEntryOut]


class RevieweeOut(BaseModel):
    email: str
    name: str
    designation: str
    flags: FlagsOut


class PendingAckOut(BaseModel):
    goal: GoalOut
    action: ReviewActionOut
    owner_email: str
    owner_name: str
    reviewed_by_name: str


class TeamResponse(BaseModel):
    reviewees: List[RevieweeOut]
    pending_acknowledgments: List[PendingAckOut]
