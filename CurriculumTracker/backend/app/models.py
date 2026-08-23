import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Text, ForeignKey, Index
from sqlalchemy.orm import relationship
from .database import Base


class User(Base):
    """Read-mostly mapping onto the portal's existing shared `users` table
    (owned by AuditApp / the school portal, same Supabase Postgres project).
    Curriculum Tracker never creates or alters this table — only queries it
    by email during the SSO exchange to resolve role/designation/subject."""
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
    populated in Supabase — the old Apps Script version queries it as
    `teacher_sme?sme_id=eq....&select=teacher_id`). Never created/altered
    by this app."""
    __tablename__ = "teacher_sme"

    id = Column(Integer, primary_key=True, index=True)
    sme_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)


class PowEntry(Base):
    __tablename__ = "pow_entries"
    __table_args__ = (
        Index("ix_pow_teacher_subject_grade_week", "teacher_email", "subject", "grade", "week_start"),
    )

    id = Column(Integer, primary_key=True, index=True)
    teacher_email = Column(String, nullable=False, index=True)  # lowercased; no FK against shared users table
    subject = Column(String, nullable=False, index=True)
    grade = Column(String, nullable=False, index=True)  # free text ("6", "7A"...), matches the POWForm input
    week_start = Column(Date, nullable=False, index=True)
    week_end = Column(Date, nullable=False)
    topic = Column(String, nullable=False)          # Chapter Name (see planner hierarchy)
    subtopic = Column(Text, nullable=True)           # comma-joined selected Topic/Sub Topic picks
    lp_session_num = Column(String, nullable=True)   # comma-joined "1, 2, 3" — plain string, never date-corrupted
    cw = Column(Text, nullable=True)
    binder = Column(Text, nullable=True)
    activity = Column(Text, nullable=True)
    homework = Column(Text, nullable=True)
    cct_topic_yn = Column(String(3), nullable=True)  # 'Yes' | 'No'
    cct_topic_text = Column(Text, nullable=True)
    cct_dashboard_updated = Column(Boolean, default=False)
    impl_a = Column(Text, nullable=True)
    impl_b = Column(Text, nullable=True)
    impl_c = Column(Text, nullable=True)
    impl_d = Column(Text, nullable=True)
    impl_e = Column(Text, nullable=True)
    impl_f = Column(Text, nullable=True)
    correction_done = Column(Text, nullable=True)
    instructions = Column(Text, nullable=True)
    teacher_remarks = Column(Text, nullable=True)
    status = Column(String, nullable=False, default="created", index=True)  # created | final | reviewed | approved — see crud.STATUS_LABELS
    tbs_mom = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    review = relationship("SmeReview", back_populates="pow", uselist=False, cascade="all, delete-orphan")


class SmeReview(Base):
    __tablename__ = "sme_reviews"

    id = Column(Integer, primary_key=True, index=True)
    pow_id = Column(Integer, ForeignKey("pow_entries.id"), nullable=False, unique=True)
    sme_email = Column(String, nullable=False)
    cct_discussed = Column(Boolean, default=False)
    approved_closed = Column(Boolean, default=False)
    remarks = Column(Text, nullable=True)
    sme_name = Column(String, nullable=True)     # typed by the SME as part of confirming/closing the POW
    confirmed_date = Column(Date, nullable=True)  # the date she confirmed & closed it, not just when the row was saved
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    pow = relationship("PowEntry", back_populates="review")


class PlannerTopic(Base):
    """One row per (subject, grade, chapter/topic/subtopic) entry, imported
    from the CurriculumMapping_<subject>_2026_27 Google Sheets (one workbook
    per subject, one tab per grade). display_order must equal the source
    sheet's row-encounter order — the progress-chart cumulative/verdict
    algorithm depends on it for month sequencing."""
    __tablename__ = "planner_topics"
    __table_args__ = (
        Index("ix_planner_subject_grade_month", "subject", "grade", "month"),
        Index("ix_planner_subject_grade_order", "subject", "grade", "display_order"),
    )

    id = Column(Integer, primary_key=True, index=True)
    subject = Column(String, nullable=False)
    grade = Column(Integer, nullable=False)
    month = Column(String, nullable=False)
    sessions = Column(Integer, nullable=False, default=0)  # chapter-level session count
    discipline = Column(String, nullable=True)
    chapter_name = Column(String, nullable=False)
    topic = Column(String, nullable=True)
    subtopic = Column(String, nullable=True)
    # Language sheets (English/Hindi/Kannada) carry a "Skill of Development"
    # column, and English/Hindi additionally carry "Strands of Language" in
    # place of Discipline — the POW form shows Strands instead of Discipline
    # whenever a row has it (see the hierarchy in POWForm).
    skill_of_development = Column(String, nullable=True)
    strands_of_language = Column(String, nullable=True)
    pre_req_chapter = Column(String, nullable=True)
    pre_req_topic = Column(String, nullable=True)
    pre_req_subtopic = Column(String, nullable=True)
    pre_req_grade = Column(String, nullable=True)
    cct = Column(String, nullable=True)
    display_order = Column(Integer, nullable=False, default=0)


class PlannerImportLog(Base):
    """One row per (subject, grade) imported, keeping the warnings that upload
    raised so they stay visible after the uploader logs out — they describe
    problems in the SOURCE SHEET (conflicting session counts, duplicate grade
    tabs, rows with no chapter), which stay unresolved until someone fixes the
    workbook and re-uploads. Replaced wholesale on re-import, so a corrected
    sheet clears its own warnings."""
    __tablename__ = "planner_import_logs"
    __table_args__ = (
        Index("ix_planner_import_subject_grade", "subject", "grade", unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    subject = Column(String, nullable=False)
    grade = Column(Integer, nullable=False)
    tab = Column(String, nullable=True)          # workbook tab this grade came from
    row_count = Column(Integer, nullable=False, default=0)
    chapter_count = Column(Integer, nullable=False, default=0)
    warnings = Column(Text, nullable=True)        # JSON list of strings
    imported_by = Column(String, nullable=True)
    imported_at = Column(DateTime, default=datetime.datetime.utcnow)


class CurriculumBackfill(Base):
    """One-time record of curriculum covered BEFORE the app started collecting
    POWs. An SME ticks the months/chapters already taught; from then on the app
    tracks progress from POWs alone (see crud.backfill_credit).

    A row means "this was covered". Whole chapter = topic/subtopic NULL;
    otherwise the row names the specific topic/sub-topic, for a chapter only
    partly done. Unticking deletes the row rather than storing done=False, so
    the table only ever holds positive statements."""
    __tablename__ = "curriculum_backfill"
    __table_args__ = (
        Index("ix_backfill_teacher_subject_grade", "teacher_email", "subject", "grade"),
    )

    id = Column(Integer, primary_key=True, index=True)
    # Per TEACHER, not just per class: two teachers sharing Grade 3 English can
    # be at different points, so each is marked separately.
    teacher_email = Column(String, nullable=False, index=True)
    subject = Column(String, nullable=False)
    grade = Column(Integer, nullable=False)
    month = Column(String, nullable=False)
    chapter_name = Column(String, nullable=False)
    topic = Column(String, nullable=True)
    subtopic = Column(String, nullable=True)
    marked_by = Column(String, nullable=True)
    marked_at = Column(DateTime, default=datetime.datetime.utcnow)
