from pathlib import Path
from pydantic_settings import BaseSettings

# Resolved relative to this file, not the process's current working directory -
# pydantic-settings treats a plain ".env" as relative to the shell's cwd at
# launch time, so running uvicorn from anywhere other than this backend/
# folder silently loads no .env at all and falls back to the hardcoded
# SECRET_KEY default below. That mismatch (whichever run happened to load the
# real secret vs. whichever fell back to the default) is what makes a
# previously-issued token suddenly fail to validate. (Same fix as Timetable.)
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"


class Settings(BaseSettings):
    DATABASE_URL: str = "sqlite:///./curriculum_tracker.db"
    SECRET_KEY: str = "harvest_curriculum_tracker_secret_change_me_in_prod_1234567890"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440

    SUPABASE_URL: str = "https://aouvxdfamzprykezeovl.supabase.co"
    SUPABASE_ANON_KEY: str = "sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE"
    PORTAL_URL: str = "http://localhost:3000/portal/login.html"

    model_config = {"env_file": _ENV_FILE, "extra": "ignore"}


settings = Settings()
