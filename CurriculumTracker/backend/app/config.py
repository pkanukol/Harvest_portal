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

    SUPABASE_URL: str = "https://aouvxdfamzprykezeovl.supabase.co"
    SUPABASE_ANON_KEY: str = "sb_publishable_rIfo8DPrbyOmU006ii3onw_sDRWJwvE"

    # staff_roles lives in a SEPARATE Supabase project owned by another app
    # (also read by Timetable and GoalTracker). Curriculum Tracker only ever
    # READS name/designation/subjects/teaching_sections from it, to learn which
    # classes a teacher is assigned — never writes. Reads need both a GRANT and
    # an RLS read policy for anon over there; see
    # Timetable/frontend-v2/staff_roles_rls_policy.sql.
    STAFF_SUPABASE_URL: str = "https://ukpythuclqvjwygqrsds.supabase.co"
    STAFF_SUPABASE_ANON_KEY: str = "sb_publishable_D5VRoe631mb0PiJWGGD7fQ_eymhH2nN"
    # That project's RLS policies (sr_admin_read / sr_self_read / sr_admin_write)
    # are all scoped to the `authenticated` role, so the publishable key — which
    # resolves to `anon` — matches no policy and reads back zero rows. Setting a
    # service-role key here (server-side only, never shipped to the browser)
    # reads it without changing anything in that project. Left blank, the app
    # falls back to the anon key and simply reports the directory unavailable.
    STAFF_SUPABASE_SERVICE_KEY: str = ""
    STAFF_DIRECTORY_TTL_SECONDS: int = 600

    # "View as" is granted by designation (auth.VIEW_AS_DESIGNATIONS: APM,
    # DLP Manager). This is only an extra override; normally empty.
    # Comma-separated emails; empty disables the feature outright. This is
    # deliberately an allowlist and not just the Leadership role — every
    # coordinator carries role='auditor', and impersonation writes real POWs
    # attributed to the person being previewed.
    VIEW_AS_ALLOWED_EMAILS: str = ""

    # Curriculum upload is granted by DESIGNATION — see
    # auth.CURRICULUM_UPLOAD_DESIGNATIONS (Subject Matter Expert, DLP Manager,
    # APM). This is only an extra override for an account whose designation
    # doesn't reflect the job; normally empty.
    CURRICULUM_UPLOAD_EMAILS: str = ""

    # POW notification email (shared Resend account with AuditApp). Leave
    # RESEND_API_KEY blank and sends are simulated into the log instead — a
    # notification failure must never break saving a POW.
    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""
    APP_URL: str = "https://his-academy360.netlify.app"

    model_config = {"env_file": _ENV_FILE, "extra": "ignore"}

    @property
    def view_as_emails(self) -> set:
        return {e.strip().lower() for e in self.VIEW_AS_ALLOWED_EMAILS.split(",") if e.strip()}

    @property
    def curriculum_upload_emails(self) -> set:
        return {e.strip().lower() for e in self.CURRICULUM_UPLOAD_EMAILS.split(",") if e.strip()}


settings = Settings()
