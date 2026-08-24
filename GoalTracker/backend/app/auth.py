from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from .config import settings

IST = timezone(timedelta(hours=5, minutes=30))

# Same role-classification rules as CurriculumTracker/backend/app/auth.py -
# role='auditor' is the shared marker for every leadership/admin account in
# the shared users table (APM, Principal, Vice Principal, Curriculum Head,
# Managing Director, Coordinator, IT Manager, ...); designation keywords are
# a fallback since wording alone misses real accounts.
LEADERSHIP_DESIGNATION_KEYWORDS = [
    "managing director", "principal", "vice principal",
    "curriculum head", "apm", "chairman", "block head", "coordinator",
]


def designation_is_leadership(designation: str) -> bool:
    d = (designation or "").strip().lower()
    return any(kw in d for kw in LEADERSHIP_DESIGNATION_KEYWORDS)


def role_is_leadership(role: str) -> bool:
    return (role or "").strip().lower() == "auditor"


# Deliberately an exact-match set, not substring containment like
# LEADERSHIP_DESIGNATION_KEYWORDS above - "principal" as a substring would
# also match "Vice Principal", which must NOT get classroom-observation
# access per the explicit named list (Principal, MD, Curriculum Head, DLP
# Manager, APM only).
OBSERVATION_ACCESS_DESIGNATIONS = {
    "principal", "managing director", "curriculum head", "dlp manager", "apm",
}


def designation_can_view_observations(designation: str) -> bool:
    return (designation or "").strip().lower() in OBSERVATION_ACCESS_DESIGNATIONS


# The org-wide Goals overview is narrower than `is_admin`: it exposes every
# person's goal status at once, so it is the MD, the branch principals, and
# the owner - not every leadership designation (Coordinator, IT Manager,
# Vice Principal, Chairman, ... all classify as is_admin but do not get it).
# Exact-match, so "Principal" does not also let "Vice Principal" through.
OVERVIEW_DESIGNATIONS = {"managing director", "principal"}


def designation_can_view_overview(designation: str) -> bool:
    return (designation or "").strip().lower() in OVERVIEW_DESIGNATIONS


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
    """Capabilities are no longer baked into a fixed Teacher/SME/Leadership
    tier - who reviews/acknowledges whom is looked up per-request from the
    ReviewerAssignment table (it can change without re-login). The JWT
    carries identity plus `is_admin` (broad leadership/admin capabilities)
    and `can_manage_reviewers` (the much narrower reviewer-assignment admin
    screen, restricted to one person - see settings.REVIEWER_ASSIGNMENTS_ADMIN_EMAIL)."""

    def __init__(self, email: str, name: str, designation: str, is_admin: bool, can_manage_reviewers: bool,
                 can_view_observations: bool, impersonated_by: Optional[str] = None,
                 can_view_overview: bool = False):
        self.email = email
        self.name = name
        self.designation = designation
        self.is_admin = is_admin
        self.can_manage_reviewers = can_manage_reviewers
        self.can_view_observations = can_view_observations
        self.can_view_overview = can_view_overview
        # Set when this session came from the "act as" switch: the real person
        # who started it. Kept on the token (not just the login response) so a
        # switched session stays identifiable across reloads and cannot be
        # laundered into a normal one by the client.
        self.impersonated_by = impersonated_by

    @property
    def can_act_as(self) -> bool:
        """Whether this person may start an "act as" session. One named email,
        and never from inside a switched session (no chaining)."""
        allowed = (settings.ACT_AS_ADMIN_EMAIL or "").strip().lower()
        if not allowed:
            return False
        return self.email.strip().lower() == allowed and not self.impersonated_by


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
    if not email:
        raise credentials_exception
    return CurrentUser(
        email=email,
        name=payload.get("name", ""),
        designation=payload.get("designation", ""),
        is_admin=bool(payload.get("is_admin", False)),
        can_manage_reviewers=bool(payload.get("can_manage_reviewers", False)),
        can_view_observations=bool(payload.get("can_view_observations", False)),
        impersonated_by=payload.get("impersonated_by"),
        can_view_overview=bool(payload.get("can_view_overview", False)),
    )


def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Leadership access required")
    return current_user


def require_overview_access(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Org-wide goal status. Narrower than require_admin - see
    OVERVIEW_DESIGNATIONS."""
    if not current_user.can_view_overview:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view the org-wide goals overview")
    return current_user


def require_owner(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """The single owner account. Used for the powers that are one person's
    tool rather than a leadership capability: reading anyone's page, and
    triggering an org-wide email."""
    if not current_user.can_manage_reviewers:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized")
    return current_user


def require_act_as_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Gate for the "act as" switch. Deliberately narrower than require_admin:
    impersonation is one named person's tool, not a leadership capability."""
    if not current_user.can_act_as:
        detail = (
            "Return to your own account before switching to someone else."
            if current_user.impersonated_by
            else "Not authorized to switch users"
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)
    return current_user


def require_reviewer_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current_user.can_manage_reviewers:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to manage reviewer assignments")
    return current_user


def require_observation_access(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current_user.can_view_observations:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to view classroom observations")
    return current_user
