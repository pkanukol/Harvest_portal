from pathlib import Path
from typing import List
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

    # staff_roles lives in a SEPARATE Supabase project owned by a different
    # app (also read by Timetable/frontend-v2) - GoalTracker only ever reads
    # name/designation/branches from it for the task-assignment picker, via
    # its public anon key (RLS already grants the anon role read access -
    # see Timetable/frontend-v2/staff_roles_rls_policy.sql). Never write here.
    STAFF_SUPABASE_URL: str = "https://ukpythuclqvjwygqrsds.supabase.co"
    STAFF_SUPABASE_ANON_KEY: str = "sb_publishable_D5VRoe631mb0PiJWGGD7fQ_eymhH2nN"

    # Where email notifications send people. The standalone app is now embedded
    # in this Netlify shell as the actual front door.
    APP_URL: str = "https://his-academy360.netlify.app"

    RESEND_API_KEY: str = ""
    RESEND_FROM_EMAIL: str = ""

    # How many days must pass before a still-flagged person gets re-emailed.
    FLAG_RENOTIFY_DAYS: int = 7

    # An overdue goal or task is only chased once nothing has happened to it
    # for this long - someone who worked on it this morning is not ignoring it.
    STALE_ACTION_DAYS: int = 1
    # And then not chased again for this long, so a daily job does not send a
    # daily email about the same thing.
    REMINDER_RENOTIFY_DAYS: int = 3

    # Academic year rolls over on this month/day (matches AuditApp's informal
    # June-1 convention, AuditApp/backend/app/crud.py:310-311). Mid-term goals
    # are flagged missing once the mid-term cutoff has passed - no precedent
    # for this date exists anywhere in the codebase, November 1 is a
    # placeholder (roughly the midpoint of a June-May cycle); change freely.
    ACADEMIC_YEAR_START_MONTH: int = 6
    ACADEMIC_YEAR_START_DAY: int = 1
    MID_TERM_CUTOFF_MONTH: int = 11
    MID_TERM_CUTOFF_DAY: int = 1

    # The school runs TWO terms, not three: Term 1 is June-October, Term 2 is
    # November onwards. Term 2 straddles the calendar-year boundary, which is
    # why term maths is done against the academic year (see crud.current_term).
    TERM_1_START_MONTH: int = 6
    TERM_2_START_MONTH: int = 11
    # Term 2 ends in MAY for everyone except teachers, whose academic year
    # finishes in APRIL. A teacher's termly goal therefore has a month less to
    # run, and dating one to May would set a deadline after they have left for
    # the year. Month numbers are inclusive - the term ends on the last day.
    TERM_2_END_MONTH: int = 5
    TERM_2_END_MONTH_TEACHER: int = 4

    # /api/dev/login (local-testing shortcut) only ever mints a token for one
    # of these emails, on top of the sqlite-only gate in main.py - restricts
    # who can use the one-click "test as" panel, not just hiding it in the
    # UI. Pavani (the person actually operating this locally) plus one real
    # account per role she wants to preview the dashboard of.
    DEV_LOGIN_ALLOWED_EMAILS: List[str] = [
        "pavani.k@harvestinternationalschool.in",       # APM
        "principal.kodathi@harvestinternationalschool.in",  # Principal
        "abhinav_g@harvestinternationalschool.in",      # Managing Director
        "sumathi@harvestinternationalschool.in",        # Coordinator
        "timsy.thomas@harvestinternationalschool.in",   # SME / HOD
        "chitra@harvestinternationalschool.in",         # Curriculum Head
        "hr2@harvestinternationalschool.in",            # HR
    ]

    # The reviewer-assignment admin screen (who reviews/acknowledges whom) is
    # restricted to just this one person, separate from the broader
    # `is_admin`/leadership flag which still gates other admin-ish behavior
    # (e.g. viewing anyone's goals as a fallback).
    REVIEWER_ASSIGNMENTS_ADMIN_EMAIL: str = "pavani.k@harvestinternationalschool.in"
    # Additional accounts allowed on that same screen. HR maintains the chain
    # alongside the APM, so anyone with designation "HR" gets it too (see
    # auth.can_manage_reviewer_assignments) - this list is for accounts whose
    # designation is recorded differently.
    REVIEWER_ADMIN_EMAILS: List[str] = ["hr2@harvestinternationalschool.in"]

    # The "act as" switch (POST /api/admin/act-as) mints a real, write-capable
    # token for another person so a whole role's flow can be exercised end to
    # end. That is a genuine impersonation power - anything done while switched
    # is recorded as the person being acted as - so unlike `is_admin` it is
    # restricted to this ONE email rather than leadership as a group, and works
    # in production only for that person. Deliberately a separate setting from
    # REVIEWER_ASSIGNMENTS_ADMIN_EMAIL so the two powers can diverge later.
    # Set to "" to disable the switch entirely, everywhere.
    ACT_AS_ADMIN_EMAIL: str = "pavani.k@harvestinternationalschool.in"

    # HR oversight: read-only visibility of every person's goals and tasks,
    # plus the printable HR report. Granted by designation "HR" as well, so a
    # future HR appointment needs no code change - this list is the belt to
    # that braces, for an HR account whose designation is recorded differently.
    HR_EMAILS: List[str] = ["hr2@harvestinternationalschool.in"]

    model_config = {"env_file": _ENV_FILE, "extra": "ignore"}


settings = Settings()
