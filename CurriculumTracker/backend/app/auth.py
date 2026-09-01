from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from .config import settings
from . import staff_directory
from .database import get_db

IST = timezone(timedelta(hours=5, minutes=30))

# Leadership is derived from the shared `users.designation` field (keyword,
# case-insensitive containment — same list already fixed in Session_Tracker's
# Code.gs, including 'vice principal' which was originally missing) OR from
# `role == 'auditor'`, since every real leadership account in the shared
# Supabase `users` table (APM, Principal, Vice Principal, Curriculum Head,
# Managing Director, Coordinator) carries role='auditor' — designation
# wording alone was found to miss real accounts (e.g. a plain "Coordinator"
# with no keyword match), so role is checked first as the more reliable signal.
LEADERSHIP_DESIGNATION_KEYWORDS = [
    "managing director", "principal", "vice principal",
    "curriculum head", "apm", "chairman",
]


def designation_is_leadership(designation: str) -> bool:
    d = (designation or "").strip().lower()
    return any(kw in d for kw in LEADERSHIP_DESIGNATION_KEYWORDS)


def role_is_leadership(role: str) -> bool:
    return (role or "").strip().lower() == "auditor"


def role_is_sme(role: str, designation: str) -> bool:
    return (role or "").strip().lower() == "sme" or (designation or "") == "Subject Matter Expert"


# tokenUrl is just documentation for the OpenAPI schema; the actual token is
# minted by /api/auth/sso after exchanging the portal's Supabase token.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/sso")


def _next_monday_morning_utc() -> datetime:
    """The upcoming Monday 00:00 IST, converted to UTC - a shared weekly reset point
    for session expiry (this app is now embedded via iframe in a Netlify shell with
    no logout button, so a hard mid-week expiry leaves users stuck logged out with
    no way to re-trigger SSO). Everyone's session resets together each Monday rather
    than N days after their own last login."""
    now_ist = datetime.now(timezone.utc).astimezone(IST)
    days_ahead = (7 - now_ist.weekday()) % 7 or 7  # weekday(): Monday=0 - always the NEXT Monday, even if today already is one
    target_ist = (now_ist + timedelta(days=days_ahead)).replace(hour=0, minute=0, second=0, microsecond=0)
    return target_ist.astimezone(timezone.utc)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = (datetime.now(timezone.utc) + expires_delta) if expires_delta else _next_monday_morning_utc()
    to_encode.update({"exp": int(expire.timestamp())})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


class CurrentUser:
    def __init__(self, email: str, name: str, designation: str, subject: Optional[str], role: str,
                 view_as_actor: Optional[str] = None):
        self.email = email
        self.name = name
        self.designation = designation
        self.subject = subject
        self.role = role  # "Teacher" | "SME" | "Leadership" — computed once at SSO time, trusted from the JWT
        # Set only on a "View as" token: the real person behind this session.
        # Everything else about the request behaves as the previewed user, so
        # this exists purely so writes can be traced back in the logs.
        self.view_as_actor = view_as_actor


def get_current_user(token: str = Depends(oauth2_scheme)) -> CurrentUser:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        raise credentials_exception
    email = payload.get("sub")
    role = payload.get("role")
    if not email or role not in ("Teacher", "SME", "Leadership"):
        raise credentials_exception
    return CurrentUser(
        email=email,
        name=payload.get("name", ""),
        designation=payload.get("designation", ""),
        subject=payload.get("subject"),
        role=role,
        view_as_actor=payload.get("view_as_actor"),
    )


# Gated by designation, not by email address. Email addresses in the shared
# users table move between people (pavani.k@ belonged to the APM account and
# now belongs to a Teacher), and an allowlisted address that changes hands
# would silently hand impersonation to whoever holds it next.
VIEW_AS_DESIGNATIONS = {"apm", "dlp manager"}


def can_view_as(email: str, designation: str = "") -> bool:
    if (designation or "").strip().lower() in VIEW_AS_DESIGNATIONS:
        return True
    return (email or "").strip().lower() in settings.view_as_emails


def require_view_as(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Gate on the "View as" endpoints. Allowlisted accounts only, and never
    from inside an existing preview — chained impersonation would lose track
    of who the real actor is."""
    if current_user.view_as_actor:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Already previewing as someone else — reset to yourself first.")
    if not can_view_as(current_user.email, current_user.designation):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Your account is not allowed to preview the app as other staff.")
    return current_user


def require_teacher(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.role != "Teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")
    return current_user


def teaching_subjects(user: CurrentUser) -> list:
    """Every subject this person may file a POW under: their profile subject
    and its streams, plus anything staff_roles says they teach."""
    from .crud import subjects_in_group
    out = []
    for name in (subjects_in_group(user.subject) if user.subject else []):
        if name and name not in out:
            out.append(name)
    for name in staff_directory.subjects_for(user.email):
        for member in subjects_in_group(name):
            if member and member not in out:
                out.append(member)
    return out


# View-only for POWs, by explicit instruction: Curriculum Heads oversee the
# curriculum rather than teach it, so they never author. Stated as a rule
# rather than relying on their profile having no subject — otherwise setting a
# subject on a head's account would quietly hand them authoring rights.
POW_VIEW_ONLY_DESIGNATIONS = {
    "curriculum head",
    # The leadership team oversees POWs, it doesn't write them. Listed
    # explicitly so the rule survives someone setting a subject on one of
    # these accounts. Coordinators are NOT here — Ms Nimisha coordinates AND
    # teaches Biology G6, and she must still be able to file.
    "principal", "vice principal", "managing director", "apm",
    "dlp manager", "chairman", "it manager", "information technology", "sys admin",
}


def can_author_pow(user: CurrentUser, extra_authors=None) -> bool:
    """Plenty of staff both review AND teach — Coordinators and HODs with a
    subject, and SMEs like Ms Madhuri Jha. The app resolves each person to ONE
    role, so gating POW authoring on role == Teacher locked those people out of
    filing POWs for their own classes, while the lag report still expects them.
    Anyone with a subject or an assigned class may author, except the
    designations above.

    A Coordinator with no subject and no assigned class is excluded by the same
    rule that admits Ms Nimisha (Science, teaches Biology G6): there is nothing
    on record saying they teach."""
    designation = (user.designation or "").strip().lower()
    if designation in POW_VIEW_ONLY_DESIGNATIONS:
        return False
    if user.role == "Teacher":
        return True
    # An SME or HOD carries a subject because they OWN it, not because they
    # teach it — so for them a subject proves nothing and an assigned class is
    # what counts. Everyone else (Coordinators, and Ms Nimisha in particular)
    # keeps the older, looser test.
    if designation in {"subject matter expert", "hod"}:
        listed = set(extra_authors or ()) | settings.pow_author_emails
        return (bool(staff_directory.assignments_for(user.email))
                or (user.email or "").strip().lower() in listed)
    return bool(user.subject) or bool(staff_directory.assignments_for(user.email))


def require_pow_author(current_user: CurrentUser = Depends(get_current_user),
                       db=Depends(get_db)) -> CurrentUser:
    from . import crud
    if not can_author_pow(current_user, crud.pow_author_emails(db)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only staff who teach a subject can create or edit a POW.",
        )
    return current_user


def require_sme(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.role != "SME":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SME access required")
    return current_user


# Who may upload curriculum workbooks, by designation — SMEs own their
# subject's mapping, and the Curriculum Heads, DLP Manager and APM administer
# it across subjects. Deliberately NOT every 'auditor' role: coordinators,
# principals and IT accounts all carry that role, and an upload replaces a
# whole subject+grade. HOD is still excluded (the ask named "Subject Matter
# Expert" specifically) — add "hod" here if that should change.
CURRICULUM_UPLOAD_DESIGNATIONS = {
    "subject matter expert", "curriculum head", "dlp manager", "apm",
}

# Marking what a class has already covered is a lighter act than replacing a
# whole subject's mapping, so HODs are admitted here without being given the
# upload screen: they know what their department taught before the app was in
# use, and were the ones being asked and unable to answer.
CURRICULUM_COVERAGE_DESIGNATIONS = CURRICULUM_UPLOAD_DESIGNATIONS | {"hod"}


def can_upload_curriculum(user: CurrentUser) -> bool:
    if (user.designation or "").strip().lower() in CURRICULUM_UPLOAD_DESIGNATIONS:
        return True
    # Escape hatch for accounts whose designation doesn't say it (empty by
    # default in config).
    return (user.email or "").strip().lower() in settings.curriculum_upload_emails


# Everyone who OVERSEES curriculum delivery rather than filing it: the three
# reading screens (Progress Check, Curriculum Overview, Compare Campuses) all
# use this one list, so access cannot drift apart between them again.
#
# Named explicitly rather than inferred from the resolved role, which was the
# bug: the Managing Director, Principals, HODs and Coordinators all came out as
# "Leadership" and got Progress Check, but Curriculum Overview was gated on the
# curriculum-upload list and left them out.
OVERSIGHT_DESIGNATIONS = {
    "subject matter expert",
    "curriculum head",
    "hod",
    "coordinator",
    "principal", "vice principal",
    "managing director",
    "apm",
    "dlp manager",
}


def can_oversee_curriculum(user: CurrentUser) -> bool:
    """May read the curriculum-delivery screens across teachers and grades."""
    if user.role == "SME":
        return True
    return (user.designation or "").strip().lower() in OVERSIGHT_DESIGNATIONS


def can_see_curriculum_overview(user: CurrentUser) -> bool:
    """The week-by-week POW table across a whole grade."""
    return can_oversee_curriculum(user)


def require_curriculum_overview(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not can_see_curriculum_overview(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This view is for staff who oversee curriculum delivery.",
        )
    return current_user


def require_oversight(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not can_oversee_curriculum(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This view is for staff who oversee curriculum delivery.",
        )
    return current_user


def can_mark_coverage(user: CurrentUser) -> bool:
    """Who may record coverage already taught. A superset of the uploaders."""
    if (user.designation or "").strip().lower() in CURRICULUM_COVERAGE_DESIGNATIONS:
        return True
    return can_upload_curriculum(user)


def require_coverage_marker(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not can_mark_coverage(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only SMEs, HODs and the curriculum administrators can record coverage",
        )
    return current_user


def require_curriculum_uploader(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not can_upload_curriculum(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only Subject Matter Experts and the curriculum administrators can upload curriculum data",
        )
    return current_user


def require_reviewer(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """SME or Leadership — read-only dashboard/progress access, distinct from
    require_sme which additionally gates the review-approval endpoint."""
    if current_user.role not in ("SME", "Leadership"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Reviewer access required")
    return current_user
