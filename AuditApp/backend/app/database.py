from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from .config import settings

connect_args = {}
if settings.DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False, "timeout": 30}

engine = create_engine(
    settings.DATABASE_URL, connect_args=connect_args
)

if settings.DATABASE_URL.startswith("sqlite"):
    @event.listens_for(engine, "connect")
    def set_sqlite_pragmas(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA journal_mode=WAL")
        dbapi_conn.execute("PRAGMA busy_timeout=30000")

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
    if "observations" not in inspector.get_table_names():
        return
    existing_cols = {c["name"] for c in inspector.get_columns("observations")}
    missing = [
        col for col in ("witness_name", "witness_designation", "observation_type")
        if col not in existing_cols
    ]
    with engine.begin() as conn:
        for col in missing:
            conn.execute(text(f"ALTER TABLE observations ADD COLUMN {col} VARCHAR"))
        # Backfill: every observation recorded before this feature existed was, in fact,
        # unannounced (there was no other kind) — and this also covers any row that
        # somehow ends up without a value going forward. Idempotent no-op once caught up.
        conn.execute(text("UPDATE observations SET observation_type = 'Unannounced' WHERE observation_type IS NULL"))
