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
    ReviewerAssignment table (it can change without re-login). The JWT only
    carries identity plus `is_admin`, which gates the reviewer-assignment
    admin screen (any Leadership/role=auditor account)."""

    def __init__(self, email: str, name: str, designation: str, is_admin: bool):
        self.email = email
        self.name = name
        self.designation = designation
        self.is_admin = is_admin


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
    )


def require_admin(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Leadership access required")
    return current_user
