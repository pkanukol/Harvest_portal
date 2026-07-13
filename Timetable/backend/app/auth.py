from datetime import datetime, timedelta
from typing import Optional
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from .config import settings
from .database import get_db
from . import models

# Access tier is computed from the portal's `designation` field, never from
# `role` — role is shared across other portal apps and this app must not
# require any change to that shared data. Any designation containing one of
# these (case-insensitive) gets full Import/Generate/Edit access; everyone
# else with a valid portal account gets read-only access.
LEADERSHIP_DESIGNATION_KEYWORDS = [
    "vice principal", "block head", "coordinator", "principal",
    "managing director", "chairman", "apm",
]

# tokenUrl is just documentation for the OpenAPI schema; the actual token is
# minted by /api/auth/sso after exchanging the portal's Supabase token.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/sso")


def designation_is_leadership(designation: str) -> bool:
    d = (designation or "").strip().lower()
    return any(kw in d for kw in LEADERSHIP_DESIGNATION_KEYWORDS)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": int(expire.timestamp())})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


class CurrentUser:
    def __init__(self, email: str, access_level: str, role: str, name: str, designation: str, teacher_id: Optional[int]):
        self.email = email
        self.access_level = access_level
        self.role = role
        self.name = name
        self.designation = designation
        self.teacher_id = teacher_id


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
    access_level = payload.get("access_level")
    if not email or access_level not in ("leadership", "view"):
        raise credentials_exception
    return CurrentUser(
        email=email,
        access_level=access_level,
        role=payload.get("role", ""),
        name=payload.get("name", ""),
        designation=payload.get("designation", ""),
        teacher_id=payload.get("teacher_id"),
    )


def require_leadership(current_user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    if current_user.access_level != "leadership":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Leadership access required")
    return current_user
