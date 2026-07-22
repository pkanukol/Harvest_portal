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

    if "sme_reviews" in existing_tables:
        cols = {c["name"] for c in inspector.get_columns("sme_reviews")}
        if "sme_name" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sme_reviews ADD COLUMN sme_name VARCHAR"))
        if "confirmed_date" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE sme_reviews ADD COLUMN confirmed_date DATE"))
