import datetime
from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, Text, ForeignKey,
    UniqueConstraint, Index, JSON, Float,
)
from sqlalchemy.orm import relationship
from .database import Base


class User(Base):
    """Read-mostly mapping onto the portal's existing shared `users` table
    (owned by AuditApp / the school portal, same Supabase Postgres project).
    Timetable never creates or alters this table — only queries it by email
    during the SSO exchange to resolve role/name/designation."""
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


class AcademicYear(Base):
    __tablename__ = "academic_years"

    id = Column(Integer, primary_key=True, index=True)
    label = Column(String, nullable=False)
    location = Column(String, nullable=False, default="Kodathi")  # 'Kodathi' | 'Attibele' - matches the portal users.location values
    is_active = Column(Boolean, default=False)  # active WITHIN its location, not globally - see crud.commit_import
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    rules_text = Column(Text, nullable=True)  # raw rules.txt content - see scheduler.py's rule parsing; falls back to DEFAULT_RULES_TEXT when absent

    grades = relationship("Grade", back_populates="academic_year", cascade="all, delete-orphan")
    subjects = relationship("Subject", back_populates="academic_year", cascade="all, delete-orphan")
    timing_config = relationship("TimingConfig", back_populates="academic_year", uselist=False, cascade="all, delete-orphan")


class TimingConfig(Base):
    """One row per academic year, capturing timing.txt: class-teacher slot,
    periods and breaks, in display order."""
    __tablename__ = "timing_configs"

    id = Column(Integer, primary_key=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id"), nullable=False, unique=True)
    class_teacher_start = Column(String, nullable=False, default="08:00")
    class_teacher_end = Column(String, nullable=False, default="08:10")
    periods_per_day = Column(Integer, nullable=False, default=8)
    # Ordered list of {type: 'period'|'break', number?, label?, start, end}
    schedule = Column(JSON, nullable=False, default=list)

    academic_year = relationship("AcademicYear", back_populates="timing_config")


class Grade(Base):
    __tablename__ = "grades"
    __table_args__ = (UniqueConstraint("academic_year_id", "name", name="uq_grade_year_name"),)

    id = Column(Integer, primary_key=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id"), nullable=False)
    name = Column(String, nullable=False)  # "Grade 5"
    order_index = Column(Integer, nullable=False)

    academic_year = relationship("AcademicYear", back_populates="grades")
    sections = relationship("Section", back_populates="grade", cascade="all, delete-orphan")
    grade_subject_periods = relationship("GradeSubjectPeriod", back_populates="grade", cascade="all, delete-orphan")


class Teacher(Base):
    """Not scoped to an academic year — the same person persists across
    yearly re-imports, matched by normalized_name. Scoped to a location/branch
    since Kodathi and Attibele are different physical campuses with different
    staff."""
    __tablename__ = "teachers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    normalized_name = Column(String, nullable=False, index=True)
    linked_email = Column(String, nullable=True, index=True)
    location = Column(String, nullable=False, default="Kodathi")
    is_active = Column(Boolean, default=True)

    sections_as_class_teacher = relationship("Section", back_populates="class_teacher")


class Section(Base):
    __tablename__ = "sections"
    __table_args__ = (UniqueConstraint("grade_id", "name", name="uq_section_grade_name"),)

    id = Column(Integer, primary_key=True, index=True)
    grade_id = Column(Integer, ForeignKey("grades.id"), nullable=False)
    name = Column(String, nullable=False)  # "A"
    class_teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)

    grade = relationship("Grade", back_populates="sections")
    class_teacher = relationship("Teacher", back_populates="sections_as_class_teacher")
    section_subject_teachers = relationship("SectionSubjectTeacher", back_populates="section", cascade="all, delete-orphan")


class Subject(Base):
    __tablename__ = "subjects"

    id = Column(Integer, primary_key=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id"), nullable=False)
    raw_name = Column(String, nullable=False)  # "Hindi/Kannada/ Sanskrit (Lang II)"
    is_combo = Column(Boolean, default=False)

    academic_year = relationship("AcademicYear", back_populates="subjects")
    grade_subject_periods = relationship("GradeSubjectPeriod", back_populates="subject", cascade="all, delete-orphan")


class GradeSubjectPeriod(Base):
    """One row per (grade, subject) from SUB BIFURCATION."""
    __tablename__ = "grade_subject_periods"

    id = Column(Integer, primary_key=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id"), nullable=False)
    grade_id = Column(Integer, ForeignKey("grades.id"), nullable=False)
    subject_id = Column(Integer, ForeignKey("subjects.id"), nullable=False)
    periods_per_week = Column(Integer, nullable=False)

    grade = relationship("Grade", back_populates="grade_subject_periods")
    subject = relationship("Subject", back_populates="grade_subject_periods")
    section_subject_teachers = relationship("SectionSubjectTeacher", back_populates="grade_subject_period", cascade="all, delete-orphan")


class SectionSubjectTeacher(Base):
    """Resolved teacher(s) for one (section, grade_subject_period). Multiple
    rows sharing the same (section_id, grade_subject_period_id) is the
    parallel/split-subject case (e.g. Hindi teacher + Kannada teacher both
    covering a section's "Lang II" block at the same period)."""
    __tablename__ = "section_subject_teachers"

    id = Column(Integer, primary_key=True, index=True)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=False)
    grade_subject_period_id = Column(Integer, ForeignKey("grade_subject_periods.id"), nullable=False)
    component_label = Column(String, nullable=False)  # e.g. "Hindi", or the plain subject name
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)

    section = relationship("Section", back_populates="section_subject_teachers")
    grade_subject_period = relationship("GradeSubjectPeriod", back_populates="section_subject_teachers")
    teacher = relationship("Teacher")
    timetable_slots = relationship("TimetableSlot", back_populates="section_subject_teacher", cascade="all, delete-orphan")


class TimetableSlot(Base):
    """"No teacher double-booked school-wide" is intentionally NOT a DB
    constraint: a leadership user can force-save a genuine clash (to be
    resolved later) and it must still be persisted, just flagged. That
    check lives in crud.check_conflicts()/set_slot() instead. teacher_id
    is indexed since conflict checks filter on it constantly."""
    __tablename__ = "timetable_slots"
    __table_args__ = (
        Index("ix_timetable_slots_lookup", "academic_year_id", "day_of_week", "period_number", "teacher_id"),
    )

    id = Column(Integer, primary_key=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id"), nullable=False)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=False)
    day_of_week = Column(Integer, nullable=False)  # 0=Mon .. 4=Fri
    period_number = Column(Integer, nullable=False)  # 1..periods_per_day
    section_subject_teacher_id = Column(Integer, ForeignKey("section_subject_teachers.id"), nullable=True)
    teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)  # denormalized copy, see crud.py checks
    is_manual_override = Column(Boolean, default=False)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    section = relationship("Section")
    section_subject_teacher = relationship("SectionSubjectTeacher", back_populates="timetable_slots")
    teacher = relationship("Teacher")


class Substitution(Base):
    """A one-off record of who covered a specific teacher's specific period on
    a specific calendar date. Deliberately separate from TimetableSlot (which
    is the recurring weekly schedule, keyed by day-of-week not a real date) so
    recording a substitution never touches or risks corrupting the regular
    timetable. Names are stored alongside the (nullable) teacher id since a
    substitution computed from an uploaded override file may reference
    teachers with no matching Teacher row."""
    __tablename__ = "substitutions"

    id = Column(Integer, primary_key=True, index=True)
    academic_year_id = Column(Integer, ForeignKey("academic_years.id"), nullable=False)
    date = Column(String, nullable=False)  # "YYYY-MM-DD"
    day_of_week = Column(Integer, nullable=False)
    period_number = Column(Integer, nullable=False)
    grade_name = Column(String, nullable=False)
    section_name = Column(String, nullable=False)
    subject = Column(String, nullable=False)
    absent_teacher_name = Column(String, nullable=False)
    absent_teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)
    substitute_teacher_name = Column(String, nullable=False)
    substitute_teacher_id = Column(Integer, ForeignKey("teachers.id"), nullable=True)
    tier = Column(Integer, nullable=True)
    created_by_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
