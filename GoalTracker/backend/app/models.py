import datetime
from sqlalchemy import Column, Integer, String, Text, DateTime, Date, ForeignKey, Index, JSON
from sqlalchemy.orm import relationship
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
    `cadence` is mid_term or annual; `category` is a self-authored tag
    (role_based vs organizational); `period_key` is an academic-year label
    e.g. "2026-27" (see crud.current_academic_year_key - computed via the
    same June-1 rollover convention AuditApp already uses informally).
    `status` is a small workflow state machine - see GoalReviewAction for the
    review/acknowledge history that drives transitions between states."""
    __tablename__ = "goals"
    __table_args__ = (
        Index("ix_goals_owner_cadence_period", "owner_email", "cadence", "period_key"),
    )

    id = Column(Integer, primary_key=True, index=True)
    owner_email = Column(String, nullable=False, index=True)
    cadence = Column(String, nullable=False)  # mid_term | annual
    category = Column(String, nullable=False)  # role_based | organizational
    period_key = Column(String, nullable=False)
    title = Column(String, nullable=False)
    specific_text = Column(Text, nullable=False)
    measurable_text = Column(Text, nullable=False)
    achievable_text = Column(Text, nullable=True)
    relevant_text = Column(Text, nullable=True)
    # active | modified_pending_ack | struck_off_pending_ack | deleted (soft)
    status = Column(String, nullable=False, default="active")
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
