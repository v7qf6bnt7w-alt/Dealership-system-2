"""Authentication (bcrypt + JWT) and role-based access control."""
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Annotated, Any

import bcrypt
import jwt
from fastapi import Depends, Header, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import settings
from .db import fetch_one, get_db

bearer = HTTPBearer(auto_error=False)

ROLES = ("admin", "sales", "service", "customer")
STAFF = ("admin", "sales", "service")


# ---------------------------------------------------------------------------
# Passwords
# ---------------------------------------------------------------------------
def hash_password(raw: str) -> str:
    return bcrypt.hashpw(raw.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(raw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(raw.encode(), hashed.encode())
    except ValueError:
        return False


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------
def create_access_token(user: dict[str, Any]) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user["id"]),
        "role": user["role"],
        "name": user["full_name"],
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=settings.access_token_minutes)).timestamp()),
        "iss": "meridian-dms",
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm], issuer="meridian-dms")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")


# ---------------------------------------------------------------------------
# Dependencies
# ---------------------------------------------------------------------------
def get_current_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[sqlite3.Connection, Depends(get_db)],
) -> dict[str, Any]:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    payload = decode_token(creds.credentials)
    user = fetch_one(
        db,
        "SELECT id, email, full_name, role, phone, is_active, avatar_color FROM users WHERE id = ?",
        (int(payload["sub"]),),
    )
    if not user or not user["is_active"]:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account disabled")
    if user["role"] == "customer":
        c = fetch_one(db, "SELECT id FROM customers WHERE user_id = ?", (user["id"],))
        user["customer_id"] = c["id"] if c else None
    return user


def get_optional_user(
    creds: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
    db: Annotated[sqlite3.Connection, Depends(get_db)],
) -> dict[str, Any] | None:
    if creds is None:
        return None
    try:
        return get_current_user(creds, db)
    except HTTPException:
        return None


def require_roles(*roles: str):
    """Usage: `user = Depends(require_roles("admin", "sales"))`."""

    def checker(user: Annotated[dict, Depends(get_current_user)]) -> dict:
        if user["role"] not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")
        return user

    return checker


def require_internal(x_internal_key: Annotated[str | None, Header()] = None) -> None:
    """Service-to-service auth used by the Node realtime module."""
    if x_internal_key != settings.internal_api_key:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid internal key")


def client_ip(request: Request) -> str | None:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


CurrentUser = Annotated[dict, Depends(get_current_user)]
StaffUser = Annotated[dict, Depends(require_roles(*STAFF))]
SalesUser = Annotated[dict, Depends(require_roles("admin", "sales"))]
ServiceUser = Annotated[dict, Depends(require_roles("admin", "service"))]
AdminUser = Annotated[dict, Depends(require_roles("admin"))]
CustomerUser = Annotated[dict, Depends(require_roles("customer"))]
DB = Annotated[sqlite3.Connection, Depends(get_db)]
