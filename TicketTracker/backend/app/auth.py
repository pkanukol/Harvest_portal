from datetime import datetime, timedelta, timezone
from typing import Optional
import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from .config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/sso", auto_error=False)

IST = timezone(timedelta(hours=5, minutes=30))


class CurrentUser:
    def __init__(self, email: str, name: str):
        self.email = email
        self.name = name


def _next_monday_morning_utc() -> datetime:
    """The upcoming Monday 00:00 IST, converted to UTC - a shared weekly reset point
    for session expiry (interim fix for the idle-session/no-logout-button issue in
    the Netlify-embedded apps). Everyone's session resets together each Monday
    rather than N days after their own last login, so logging in on a Thursday
    still only buys you until the following Monday, not a rolling week."""
    now_ist = datetime.now(timezone.utc).astimezone(IST)
    days_ahead = (7 - now_ist.weekday()) % 7 or 7  # weekday(): Monday=0 - always the NEXT Monday, even if today already is one
    target_ist = (now_ist + timedelta(days=days_ahead)).replace(hour=0, minute=0, second=0, microsecond=0)
    return target_ist.astimezone(timezone.utc)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = _next_monday_morning_utc()
    to_encode.update({"exp": int(expire.timestamp())})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


_CREDENTIALS_EXCEPTION = HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail="Could not validate credentials",
    headers={"WWW-Authenticate": "Bearer"},
)


def _decode(token: Optional[str]) -> CurrentUser:
    if not token:
        raise _CREDENTIALS_EXCEPTION
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        email = payload.get("sub")
        name = payload.get("name")
        if not email:
            raise _CREDENTIALS_EXCEPTION
    except jwt.PyJWTError:
        raise _CREDENTIALS_EXCEPTION
    return CurrentUser(email=email, name=name or email)


def get_current_user(token: str = Depends(oauth2_scheme)) -> CurrentUser:
    return _decode(token)


def get_current_user_flexible(
    token: str = Depends(oauth2_scheme),
    query_token: Optional[str] = Query(None, alias="token"),
) -> CurrentUser:
    """Same as get_current_user, but also accepts the JWT as a ?token= query param -
    needed for <img src> tags, which can't send an Authorization header."""
    return _decode(token or query_token)
