import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Date, ForeignKey, Index, JSON, Boolean
from sqlalchemy.orm import relationship, backref
from .database import Base


class User(Base):
    """Read-mostly mapping onto the portal's existing shared `users` table
    (owned by AuditApp / the school portal, same Supabase Postgres project).
    GoalTracker never creates or alters this table - only queries it by email
    during the SSO exchange to resolve role/designation, same as
    CurriculumTracker's User model."""
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    password_hash = Column(String, nullable=False)
    name = Column(String, nullable=False)
    designation = Column(String, nullable=False)
    role = Column(String, nullable=False)
    location = Column(String, nullable=False)
    app_password = Column(String, nullable=True)
    subject = Column(String, nullable=True)


class TeacherSme(Base):
    """Read-only mapping onto the existing teacher_sme table (already
    populated in Supabase, shared with CurriculumTracker). Never
    created/altered by this app. Not used for review-chain purposes anymore
    (see ReviewerAssignment) - kept only in case a future feature still wants
    the original SME<->teacher subject-mapping data."""
    __tablename__ = "teacher_sme"

    id = Column(Integer, primary_key=True, index=True)
    sme_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)


class Observation(Base):
    """Read-only mapping onto AuditApp's existing `observations` table (same
    shared Supabase Postgres project) - only the columns GoalTracker needs to
    render a summary card + average score. GoalTracker never creates/alters
    this table; the full schema (domain scores, remarks, images, etc.) lives
    in AuditApp/backend/app/models.py and is irrelevant here."""
    __tablename__ = "observations"

    id = Column(Integer, primary_key=True, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    auditor_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    date_time = Column(DateTime, nullable=True)
    subject = Column(String, nullable=False)
    grade = Column(String, nullable=False)
    section = Column(String, nullable=False)
    observation_type = Column(String, nullable=True)
    overall_score = Column(Integer, nullable=False)
    rating = Column(String, nullable=False)
    is_draft = Column(Boolean, default=True)


class ReviewerAssignment(Base):
    """Admin-configured, per-person record of who reviews this person's own
    goals, and who acknowledges this person's review actions *when they act
    as a reviewer for someone else*. Two independent relationships - e.g. an
    SME's reviewer is the Curriculum Head (reviews the SME's own goals),
    while the SME's acknowledger is the Principal (signs off when the SME
    reviews a teacher's goals). This is what actually encodes the org's
    review chain; nothing is derived from designation/location."""
    __tablename__ = "reviewer_assignments"

    id = Column(Integer, primary_key=True, index=True)
    person_email = Column(String, nullable=False, unique=True, index=True)
    reviewer_email = Column(String, nullable=True)
    acknowledger_email = Column(String, nullable=True)
    updated_by = Column(String, nullable=True)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class Goal(Base):
    """A SMART goal owned by one person for one academic-year period.
    `cadence` is mid_term or annual; `period_key` is an academic-year label
    e.g. "2026-27" (see crud.current_academic_year_key - computed via the
    same June-1 rollover convention AuditApp already uses informally).
    `status` is a small workflow state machine - see GoalReviewAction for the
    review/acknowledge history that drives transitions between states.
    `category` (role_based vs organizational) was a user-facing distinction
    that's no longer exposed anywhere - the column stays (existing rows keep
    their value, and dropping a column has no upside here) but new goals just
    get a fixed default; nothing reads it going forward."""
    __tablename__ = "goals"
    __table_args__ = (
        Index("ix_goals_owner_cadence_period", "owner_email", "cadence", "period_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_email = Column(String, nullable=False, index=True)
    cadence = Column(String, nullable=False)  # mid_term | annual
    category = Column(String, nullable=False, default="general")  # deprecated, unused by the UI
    period_key = Column(String, nullable=False)
    title = Column(String, nullable=False)
    specific_text = Column(Text, nullable=False)
    measurable_text = Column(Text, nullable=False)
    achievable_text = Column(Text, nullable=True)
    relevant_text = Column(Text, nullable=True)
    # active | modified_pending_ack | struck_off_pending_ack | deleted (soft)
    status = Column(String, nullable=False, default="active")
    # Owner-controlled "did I actually achieve this" flag - independent of
    # the review/acknowledge workflow above, which only tracks sign-off that
    # the goal was properly set/reviewed, not whether it was accomplished.
    is_completed = Column(Boolean, nullable=False, default=False)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    logs = relationship(
        "GoalLog", cascade="all, delete-orphan", order_by="GoalLog.log_date.desc()"
    )
    review_actions = relationship(
        "GoalReviewAction", cascade="all, delete-orphan", order_by="GoalReviewAction.reviewed_at.desc()"
    )


class GoalLog(Base):
    """One informal progress entry ('what I did') logged against a goal,
    daily or weekly - separate from the formal Mid Term / Year End review
    feedback (Phase 2/3)."""
    __tablename__ = "goal_logs"
    __table_args__ = (
        Index("ix_goal_logs_goal_date", "goal_id", "log_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    goal_id = Column(Integer, ForeignKey("goals.id"), nullable=False, index=True)
    log_date = Column(Date, nullable=False)
    notes = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class GoalReviewAction(Base):
    """One review pass on a goal by its assigned reviewer (see
    ReviewerAssignment.reviewer_email for owner_email). A goal can be
    reviewed more than once over its lifetime (e.g. re-reviewed after
    returning to active), so this is an append-only history, not a
    single row per goal."""
    __tablename__ = "goal_review_actions"
    __table_args__ = (
        Index("ix_review_actions_goal", "goal_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    goal_id = Column(Integer, ForeignKey("goals.id"), nullable=False, index=True)
    action_type = Column(String, nullable=False)  # approved | modified | struck_off
    reason = Column(Text, nullable=True)  # required (enforced in crud) for modified/struck_off
    snapshot_before = Column(JSON, nullable=True)  # prior field values, for 'modified' audit history
    reviewed_by = Column(String, nullable=False)
    reviewed_at = Column(DateTime, default=datetime.datetime.utcnow)

    owner_ack_by = Column(String, nullable=True)
    owner_ack_at = Column(DateTime, nullable=True)

    upper_ack_by = Column(String, nullable=True)
    upper_ack_at = Column(DateTime, nullable=True)
    upper_ack_notes = Column(Text, nullable=True)


class Task(Base):
    """A task, optionally nested under a parent task to arbitrary depth
    (self-referential). Unlike Goal, a task can be assigned to anyone (not
    just people the creator reviews) and each node - task or subtask -
    carries its own independent assignee, due date, and completion state.
    Deleting a task cascades to its whole subtree (cascade="all,
    delete-orphan") - there's no soft-delete/audit-trail requirement here
    the way there is for goals."""
    __tablename__ = "tasks"
    __table_args__ = (
        Index("ix_tasks_parent", "parent_id"),
        Index("ix_tasks_assignee", "assignee_email"),
    )

    id = Column(Integer, primary_key=True, index=True)
    parent_id = Column(Integer, ForeignKey("tasks.id"), nullable=True)
    # Optional link to one of the creator's own goals, so a task can be
    # tracked as work contributing to that goal. No FK-level cascade here on
    # purpose - deleting a goal shouldn't silently delete unrelated tasks.
    goal_id = Column(Integer, ForeignKey("goals.id"), nullable=True)
    title = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    created_by_email = Column(String, nullable=False)
    created_by_name = Column(String, nullable=False)
    assignee_email = Column(String, nullable=False)
    # Denormalized at assignment time from staff_roles (a different Supabase
    # project - see config.STAFF_SUPABASE_URL) so listing tasks never needs a
    # live cross-project lookup, only the assignment picker/search does.
    assignee_name = Column(String, nullable=False)
    due_at = Column(DateTime, nullable=True)
    is_completed = Column(Boolean, nullable=False, default=False)
    completed_at = Column(DateTime, nullable=True)
    # Bumped each time "Move to next week" is used - lets the UI badge a task
    # as rolled over (distinct from plain "overdue") without needing to keep
    # the original due date around.
    postpone_count = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    subtasks = relationship(
        "Task",
        cascade="all, delete-orphan",
        order_by="Task.created_at",
        backref=backref("parent", remote_side=[id]),
    )
    notes = relationship(
        "TaskNote", cascade="all, delete-orphan", order_by="TaskNote.created_at",
    )


class TaskNote(Base):
    """A free-text progress update logged against a task while work is in
    progress - separate from editing the task's own fields, and never
    deleted/edited once posted (append-only, like GoalReviewAction)."""
    __tablename__ = "task_notes"
    __table_args__ = (
        Index("ix_task_notes_task", "task_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("tasks.id"), nullable=False)
    author_email = Column(String, nullable=False)
    author_name = Column(String, nullable=False)
    note = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class GoalFlagNotification(Base):
    """Throttle record so flag_check.py nudges someone once per
    FLAG_RENOTIFY_DAYS instead of every day they're still flagged."""
    __tablename__ = "goal_flag_notifications"
    __table_args__ = (
        Index("ix_flag_notif_owner_type_period", "owner_email", "flag_type", "period_key", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_email = Column(String, nullable=False)
    flag_type = Column(String, nullable=False)  # mid_term_missing | annual_missing
    period_key = Column(String, nullable=False)
    last_notified_at = Column(DateTime, nullable=False, default=datetime.datetime.utcnow)
