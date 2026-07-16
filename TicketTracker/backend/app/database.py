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
    """Add newly-introduced columns to an already-existing tickets table (and drop
    ones that are no longer used). Base.metadata.create_all() only creates missing
    tables, it never alters an existing table's columns, so this is a manual
    idempotent migration - no Alembic in this project.
    """
    inspector = inspect(engine)
    if "tickets" not in inspector.get_table_names():
        return
    existing_cols = {c["name"] for c in inspector.get_columns("tickets")}

    with engine.begin() as conn:
        # Replaced by responsible_to/responsible_cc (JSON, supports multiple recipients).
        # The index on responsible_email must be dropped first - SQLite's DROP COLUMN
        # doesn't reliably clean up a dependent index on its own.
        for col in ("responsible_name", "responsible_email"):
            if col in existing_cols:
                conn.execute(text(f"DROP INDEX IF EXISTS ix_tickets_{col}"))
                conn.execute(text(f"ALTER TABLE tickets DROP COLUMN {col}"))

        additions = {
            "location": "VARCHAR",
            "responsible_to": "JSON",
            "responsible_cc": "JSON",
            "item_name": "VARCHAR",
            "approx_cost": "FLOAT",
            "quantity": "INTEGER",
            "specifications": "TEXT",
            "order_by_date": "VARCHAR",
            "approval_level": "VARCHAR",
            "order_date": "VARCHAR",
            "vendor_name": "VARCHAR",
            "order_actual_cost": "FLOAT",
            "delivery_date": "VARCHAR",
            "tracking_details": "TEXT",
        }
        needs_location_backfill = "location" not in existing_cols
        for col, coltype in additions.items():
            if col not in existing_cols:
                conn.execute(text(f"ALTER TABLE tickets ADD COLUMN {col} {coltype}"))

        if needs_location_backfill:
            conn.execute(text("UPDATE tickets SET location = 'Kodathi' WHERE location IS NULL"))
        for col in ("responsible_to", "responsible_cc"):
            if col not in existing_cols:
                conn.execute(text(f"UPDATE tickets SET {col} = '[]' WHERE {col} IS NULL"))

        # ticket_images: moved from a Google Drive link (image_path) to storing the
        # actual bytes in-DB. Old link rows don't carry a real image to migrate, so
        # they're dropped outright rather than carried forward with empty data.
        if "ticket_images" in inspector.get_table_names():
            image_cols = {c["name"] for c in inspector.get_columns("ticket_images")}
            if "image_path" in image_cols:
                conn.execute(text("DELETE FROM ticket_images"))
                conn.execute(text("ALTER TABLE ticket_images DROP COLUMN image_path"))
            if "content_type" not in image_cols:
                conn.execute(text("ALTER TABLE ticket_images ADD COLUMN content_type VARCHAR"))
            if "image_data" not in image_cols:
                image_blob_type = "BYTEA" if not settings.DATABASE_URL.startswith("sqlite") else "BLOB"
                conn.execute(text(f"ALTER TABLE ticket_images ADD COLUMN image_data {image_blob_type}"))
