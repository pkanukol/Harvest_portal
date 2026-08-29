from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

_is_sqlite = settings.DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    engine = create_engine(
        settings.DATABASE_URL,
        connect_args={"check_same_thread": False, "timeout": 30},
    )

    @event.listens_for(engine, "connect")
    def set_sqlite_pragmas(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA journal_mode=WAL")
        dbapi_conn.execute("PRAGMA busy_timeout=30000")
else:
    # Timeouts everywhere so a network hiccup to the remote Postgres surfaces as an
    # error within seconds instead of hanging a request (and the UI) forever:
    # connect_timeout caps the initial TCP handshake, statement_timeout caps any
    # single query server-side, pool_timeout caps how long a request waits for a
    # free connection, and pool_recycle proactively refreshes connections before
    # the Supabase pooler might silently drop them. (Same hardening as Timetable.)
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
    idempotent ALTER TABLE here (no Alembic in this project). This app never
    migrates the shared `users`/`teacher_sme` tables — only its own
    pow_entries/sme_reviews/planner_topics tables.
    """
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())

    if "pow_entries" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("pow_entries")}
        if "cct_dashboard_updated" not in cols:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE pow_entries ADD COLUMN cct_dashboard_updated BOOLEAN DEFAULT FALSE"
                ))
        if "impl_f" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE pow_entries ADD COLUMN impl_f TEXT"))

    if "planner_topics" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("planner_topics")}
        for column in ("skill_of_development", "strands_of_language"):
            if column not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE planner_topics ADD COLUMN {column} VARCHAR"))

    if "pow_entries" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("pow_entries")}
        for section in ("a", "b", "c", "d", "e", "f"):
            column = f"impl_{section}_date"
            if column not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE pow_entries ADD COLUMN {column} DATE"))

    if "pow_entries" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("pow_entries")}
        # Correction Done became a date per section (see models.PowEntry).
        for section in ("a", "b", "c", "d", "e", "f"):
            column = f"correction_{section}_date"
            if column not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE pow_entries ADD COLUMN {column} DATE"))

    if "pow_entries" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("pow_entries")}
        if "branch" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE pow_entries ADD COLUMN branch VARCHAR"))
                # Existing POWs take the campus their teacher is on today -
                # the best evidence available, and correct for everyone who has
                # not moved.
                conn.execute(text("""
                    UPDATE pow_entries p
                       SET branch = u.location
                      FROM users u
                     WHERE lower(u.email) = lower(p.teacher_email)
                       AND p.branch IS NULL
                       AND u.location IS NOT NULL
                """))

    if "pow_sessions" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("pow_sessions")}
        # A session carries its own chapter/topic/sub-topic (a week can cross a
        # chapter boundary) plus its lesson-plan link and learning outcomes.
        for column, coltype in (
            ("chapter", "VARCHAR"), ("topic", "VARCHAR"), ("subtopic", "TEXT"),
            ("lp_link", "TEXT"), ("learning_outcomes", "TEXT"),
            ("sections", "VARCHAR"),
        ):
            if column not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE pow_sessions ADD COLUMN {column} {coltype}"))

    if "curriculum_backfill_confirmed" in existing_tables:
        # Confirmations were per teacher; they're per subject+grade now, and the
        # old unique index would block the new shape.
        with engine.begin() as conn:
            conn.execute(text("DROP INDEX IF EXISTS ix_backfill_confirmed_key"))
            conn.execute(text("DELETE FROM curriculum_backfill_confirmed WHERE teacher_email IS NOT NULL"))
        # The column itself was still NOT NULL from the per-teacher design, so
        # every grade-wise confirmation failed on insert. Guarded on the current
        # state rather than run every startup: ALTER TABLE takes an exclusive
        # lock, and two instances booting together (Render and a local one)
        # deadlocked on each other trying to make the same change.
        still_not_null = any(
            c["name"] == "teacher_email" and not c["nullable"]
            for c in inspector.get_columns("curriculum_backfill_confirmed")
        )
        if still_not_null:
            with engine.begin() as conn:
                conn.execute(text(
                    "ALTER TABLE curriculum_backfill_confirmed ALTER COLUMN teacher_email DROP NOT NULL"
                ))

    for table in ("curriculum_backfill", "curriculum_backfill_confirmed"):
        if table in existing_tables:
            cols = {c["name"] for c in inspector.get_columns(table)}
            if "branch" not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN branch VARCHAR"))

    if "curriculum_backfill" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("curriculum_backfill")}
        # Marks were per teacher, then per class. Per-teacher rows would double
        # up now that several teachers share one class, so they're cleared —
        # nothing has been marked in production yet.
        with engine.begin() as conn:
            conn.execute(text("DELETE FROM curriculum_backfill WHERE teacher_email IS NOT NULL"))
        if "teacher_email" not in cols:
            # Marks were per subject+grade in the first cut; they're per teacher
            # now, and an existing row can't be attributed to a teacher after
            # the fact, so the (pre-launch, easily redone) marks are cleared.
            with engine.begin() as conn:
                conn.execute(text("DELETE FROM curriculum_backfill"))
                conn.execute(text("ALTER TABLE curriculum_backfill ADD COLUMN teacher_email VARCHAR"))

    if "sme_reviews" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("sme_reviews")}
        if "sme_name" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sme_reviews ADD COLUMN sme_name VARCHAR"))
        if "confirmed_date" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sme_reviews ADD COLUMN confirmed_date DATE"))
