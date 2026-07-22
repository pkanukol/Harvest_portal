from datetime import datetime, timedelta
from typing import Optional
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from .config import settings

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


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": int(expire.timestamp())})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


class CurrentUser:
    def __init__(self, email: str, name: str, designation: str, subject: Optional[str], role: str):
        self.email = email
        self.name = name
        self.designation = designation
        self.subject = subject
        self.role = role  # "Teacher" | "SME" | "Leadership" — computed once at SSO time, trusted from the JWT


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
    )


def require_teacher(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.role != "Teacher":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Teacher access required")
    return current_user


def require_sme(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.role != "SME":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="SME access required")
    return current_user


def require_reviewer(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """SME or Leadership — read-only dashboard/progress access, distinct from
    require_sme which additionally gates the review-approval endpoint."""
    if current_user.role not in ("SME", "Leadership"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Reviewer access required")
    return current_user
