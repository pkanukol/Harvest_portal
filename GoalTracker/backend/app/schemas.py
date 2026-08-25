from typing import Optional, List
from datetime import date, datetime
from pydantic import BaseModel


class SSORequest(BaseModel):
    supabase_token: str


class DevLoginRequest(BaseModel):
    email: str


class SSOResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    name: str
    email: str
    designation: str
    is_admin: bool
    can_manage_reviewers: bool
    can_view_observations: bool
    can_view_overview: bool = False
    can_view_as: bool = False
    location: Optional[str] = None
    # Set only on a leadership "act as" switch: the admin who started it.
    # Present so the UI can show a permanent banner and a way back, and so
    # anything written during the session is traceable to a real person.
    impersonated_by: Optional[str] = None
    # True only for the one person allowed to start an "act as" session, and
    # false inside a switched session - the UI keys the switcher off this.
    can_act_as: bool = False


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


class GoalCompletionUpdate(BaseModel):
    is_completed: bool


class ReviewActionOut(BaseModel):
    id: int
    action_type: str  # approved | modified | struck_off
    reason: Optional[str] = None
    reviewed_by: str
    reviewed_at: datetime
    owner_ack_by: Optional[str] = None
    owner_ack_at: Optional[datetime] = None
    # upper_ack_* columns still exist on GoalReviewAction (historical rows
    # from before the acknowledger step was removed) but are no longer read
    # or written anywhere - deliberately not exposed here.

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
    is_completed: bool = False
    completed_at: Optional[datetime] = None
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
    period_key: str


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
    reviewer_name: Optional[str] = None
    can_edit: bool = True


class ReviewerAssignmentIn(BaseModel):
    person_email: str
    reviewer_email: Optional[str] = None


class DirectoryEntryOut(BaseModel):
    email: str
    name: str
    designation: str


class ReviewerAssignmentsResponse(BaseModel):
    people: List[ReviewerAssignmentOut]
    directory: List[DirectoryEntryOut]


class ProgressOut(BaseModel):
    completed: int
    total: int


class RevieweeOut(BaseModel):
    email: str
    name: str
    designation: str
    role: str = ""  # teacher | sme | auditor - lets the frontend group without re-deriving from designation strings
    subject: Optional[str] = None
    location: Optional[str] = None
    # Collapsed status per cadence for the reviewer-facing table: "not_set" |
    # "pending" | "approved" - folds in "needs your acknowledgment" rather
    # than surfacing it as a separate list (see crud.goal_slot_status).
    mid_term_status: str
    annual_status: str
    # Goals set vs. marked complete (crud.goal_progress) - independent of
    # the review-status columns above, which track sign-off, not completion.
    mid_term_progress: ProgressOut
    annual_progress: ProgressOut
    # Only populated for teachers, and only when the viewer has observation
    # access (see auth.require_observation_access) - None means either "not
    # a teacher" or "you're not allowed to see this", not "no observations".
    observation_average: Optional[float] = None


class ObservationOut(BaseModel):
    id: int
    date_time: Optional[datetime] = None
    subject: str
    grade: str
    section: str
    observation_type: Optional[str] = None
    overall_score: int
    rating: str
    auditor_name: Optional[str] = None

    class Config:
        from_attributes = True


class ObservationsResponse(BaseModel):
    average_score: Optional[float] = None
    observations: List[ObservationOut]


class TeamResponse(BaseModel):
    reviewees: List[RevieweeOut]


class StatusCountsOut(BaseModel):
    not_set: int
    pending: int
    approved: int


class OverviewGroupOut(BaseModel):
    key: str            # sme | auditor | teacher
    total: int
    mid_term: StatusCountsOut
    annual: StatusCountsOut


class OverviewSummaryResponse(BaseModel):
    """Counts only - people come from /api/admin/overview-people per group."""
    period_key: str
    groups: List[OverviewGroupOut]


class GoalsOverviewResponse(BaseModel):
    people: List[RevieweeOut]  # same shape - email/name/designation/mid_term_status/annual_status
    mid_term_summary: StatusCountsOut
    annual_summary: StatusCountsOut


class FlagCheckRecipientOut(BaseModel):
    email: str
    name: str
    flag_type: str
    flag_label: str


class FlagCheckResultOut(BaseModel):
    checked: int          # org members examined
    sent: int             # reminder emails actually sent
    skipped_recent: int   # flagged, but already emailed within renotify_days
    failed: int           # Resend rejected the send
    renotify_days: int
    recipients: List[FlagCheckRecipientOut]


# ─── Tasks ────────────────────────────────────────────────────────────────

class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = None
    assignee_email: str
    assignee_name: str  # captured from the staff-search picker at selection time
    due_at: Optional[datetime] = None
    parent_id: Optional[int] = None  # set when creating a subtask
    goal_id: Optional[int] = None  # optional link to one of the creator's own goals


class GoalOptionOut(BaseModel):
    id: int
    title: str
    cadence: str

    class Config:
        from_attributes = True


class TaskEdit(BaseModel):
    title: str
    description: Optional[str] = None
    assignee_email: str
    assignee_name: str
    due_at: Optional[datetime] = None
    goal_id: Optional[int] = None


class TaskCompletionUpdate(BaseModel):
    is_completed: bool


class TaskNoteCreate(BaseModel):
    note: str


class TaskNoteOut(BaseModel):
    id: int
    author_email: str
    author_name: str
    note: str
    created_at: datetime

    class Config:
        from_attributes = True


class TaskOut(BaseModel):
    id: int
    parent_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    created_by_email: str
    created_by_name: Optional[str] = None
    assignee_email: str
    assignee_name: Optional[str] = None
    due_at: Optional[datetime] = None
    is_completed: bool
    completed_at: Optional[datetime] = None
    postpone_count: int = 0
    created_at: datetime
    can_edit: bool = False  # populated per-request: creator or assignee
    goal_id: Optional[int] = None
    goal_title: Optional[str] = None  # populated per-request from the linked Goal, if any
    subtasks: List["TaskOut"] = []
    notes: List[TaskNoteOut] = []

    class Config:
        from_attributes = True


TaskOut.model_rebuild()


class OrgPersonOut(BaseModel):
    """Just enough to pick someone from a list. Deliberately NOT the overview
    shape - that one runs several queries per person to compute goal status
    and observation averages, which is far too much work to render names."""
    email: str
    name: str
    designation: Optional[str] = None
    role: Optional[str] = None
    location: Optional[str] = None


class ViewAsPersonOut(BaseModel):
    email: str
    name: str
    designation: Optional[str] = None
    is_admin: bool
    can_manage_reviewers: bool
    can_view_observations: bool
    reviewee_count: int


class ViewAsResponse(BaseModel):
    """Everything needed to redraw the dashboard exactly as one person sees
    it - their goals AND their tasks, resolved against their own visibility
    rules rather than the viewer's."""
    person: ViewAsPersonOut
    goals: List[GoalOut]
    flags: FlagsOut
    period_key: str
    tasks: List[TaskOut]
    # The people THEY review - so the preview can show the reviewer queue
    # that opens behind their "Goals I review" button, not just claim it exists.
    reviewees: List[RevieweeOut]


class StaffMemberOut(BaseModel):
    email: str
    name: str
    designation: Optional[str] = None
    branches: List[str] = []
