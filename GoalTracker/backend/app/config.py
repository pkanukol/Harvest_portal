from pathlib import Path
from pydantic_settings import BaseSettings

# Resolved relative to this file, not the process's current working directory -
# see CurriculumTracker/backend/app/config.py for why a plain ".env" silently
# loads nothing when uvicorn isn't launched from the backend/ folder.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./goal_tracker.db"
    SECRET_KEY: str = "harvest_goal_tracker_secret_change_me_in_prod_1234567890"
    ALGORITHM: str = "HS256"

    SUPABASE_URL: str = "https://aouvxdfamzprykezeovl.supabase.co"
    SUPABASE_ANON_KEY: str = "sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE"
    PORTAL_URL: str = "http://localhost:3000/portal/login.html"
    APP_URL: str = "http://localhost:5177"

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""

    # How many days must pass before a still-flagged person gets re-emailed.
    FLAG_RENOTIFY_DAYS: int = 7

    # Academic year rolls over on this month/day (matches AuditApp's informal
    # June-1 convention, AuditApp/backend/app/crud.py:310-311). Mid-term goals
    # are flagged missing once the mid-term cutoff has passed - no precedent
    # for this date exists anywhere in the codebase, November 1 is a
    # placeholder (roughly the midpoint of a June-May cycle); change freely.
    ACADEMIC_YEAR_START_MONTH: int = 6
    ACADEMIC_YEAR_START_DAY: int = 1
    MID_TERM_CUTOFF_MONTH: int = 11
    MID_TERM_CUTOFF_DAY: int = 1

    model_config = {"env_file": _ENV_FILE, "extra": "ignore"}


settings = Settings()
