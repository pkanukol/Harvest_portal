from sqlalchemy import create_engine, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

# Timeouts everywhere so a network hiccup to the remote Postgres surfaces as an
# error within seconds instead of hanging a request (and the UI) forever:
# connect_timeout caps the initial TCP handshake, statement_timeout caps any
# single query server-side, pool_timeout caps how long a request waits for a
# free connection, and pool_recycle proactively refreshes connections before
# the Supabase pooler might silently drop them.
engine = create_engine(
    settings.DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=280,
    pool_timeout=10,
    connect_args={
        "connect_timeout": 10,
        "options": "-c statement_timeout=15000",
    },
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def run_migrations():
    """Add newly-introduced columns to already-existing tables.

    Base.metadata.create_all() only creates missing tables, it never alters
    an existing table's columns, so new nullable columns need a manual
    idempotent ALTER TABLE here (no Alembic in this project).
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    if "teachers" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("teachers")}
        if "linked_email" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN linked_email VARCHAR"))
        if "location" not in cols:
            # Everything imported so far was Kodathi - backfill existing rows
            # rather than leaving them NULL, since location is NOT NULL going forward.
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE teachers ADD COLUMN location VARCHAR"))
                conn.execute(text("UPDATE teachers SET location = 'Kodathi' WHERE location IS NULL"))
                conn.execute(text("ALTER TABLE teachers ALTER COLUMN location SET NOT NULL"))
                conn.execute(text("ALTER TABLE teachers ALTER COLUMN location SET DEFAULT 'Kodathi'"))

    if "academic_years" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("academic_years")}
        if "location" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE academic_years ADD COLUMN location VARCHAR"))
                conn.execute(text("UPDATE academic_years SET location = 'Kodathi' WHERE location IS NULL"))
                conn.execute(text("ALTER TABLE academic_years ALTER COLUMN location SET NOT NULL"))
                conn.execute(text("ALTER TABLE academic_years ALTER COLUMN location SET DEFAULT 'Kodathi'"))
        if "rules_text" not in cols:
            # NULL is meaningful here (not just "not yet migrated") - it means
            # "no rules.txt supplied, use rules.DEFAULT_RULES_TEXT" - so no
            # backfill needed, existing years keep behaving exactly as before.
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE academic_years ADD COLUMN rules_text TEXT"))

    # A flat, human-readable view of the whole timetable - anyone with Supabase
    # table-editor/SQL access can browse this directly (Grade/Section/Day/
    # Period/Subject/Teacher), without needing to join the normalized app
    # tables themselves or log into the app at all. Read-only, re-created on
    # every startup so it always reflects the current schema.
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE OR REPLACE VIEW timetable_view AS
            SELECT
                ay.label AS academic_year,
                ay.location,
                g.name AS grade,
                s.name AS section,
                CASE ts.day_of_week
                    WHEN 0 THEN 'Monday' WHEN 1 THEN 'Tuesday' WHEN 2 THEN 'Wednesday'
                    WHEN 3 THEN 'Thursday' WHEN 4 THEN 'Friday' ELSE 'Unknown'
                END AS day,
                ts.period_number,
                COALESCE(sst.component_label, subj.raw_name) AS subject,
                t.name AS teacher,
                ts.is_manual_override AS locked
            FROM timetable_slots ts
            JOIN sections s ON ts.section_id = s.id
            JOIN grades g ON s.grade_id = g.id
            JOIN academic_years ay ON ts.academic_year_id = ay.id
            LEFT JOIN section_subject_teachers sst ON ts.section_subject_teacher_id = sst.id
            LEFT JOIN grade_subject_periods gsp ON sst.grade_subject_period_id = gsp.id
            LEFT JOIN subjects subj ON gsp.subject_id = subj.id
            LEFT JOIN teachers t ON ts.teacher_id = t.id
            ORDER BY ay.location, g.order_index, s.name, ts.day_of_week, ts.period_number
        """))
