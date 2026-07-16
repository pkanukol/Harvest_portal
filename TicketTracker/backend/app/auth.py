from datetime import datetime, timedelta
from typing import Optional
import jwt
from fastapi import Depends, HTTPException, Query, status
from fastapi.security import OAuth2PasswordBearer
from .config import settings

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/sso", auto_error=False)


class CurrentUser:
    def __init__(self, email: str, name: str):
        self.email = email
        self.name = name


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
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
