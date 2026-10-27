from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field

from ..db import fetch_one, insert, now_iso, transaction
from ..security import DB, CurrentUser, client_ip, create_access_token, hash_password, verify_password
from ..services.events import activity, audit, publish

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    phone: str | None = Field(default=None, max_length=32)
    consent_email: bool = True
    consent_whatsapp: bool = False
    consent_marketing: bool = False


def _session(user: dict) -> dict:
    return {
        "access_token": create_access_token(user),
        "token_type": "bearer",
        "user": {k: user.get(k) for k in ("id", "email", "full_name", "role", "avatar_color")},
    }


@router.post("/login")
def login(body: LoginIn, request: Request, db: DB):
    user = fetch_one(db, "SELECT * FROM users WHERE email = ?", (body.email,))
    if not user or not verify_password(body.password, user["password_hash"]):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not user["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account disabled — contact your administrator")
    db.execute("UPDATE users SET last_login_at = ? WHERE id = ?", (now_iso(), user["id"]))
    audit(db, user, "login", "user", user["id"], ip=client_ip(request))
    return _session(user)


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, db: DB):
    """Customer self-registration for the portal. Links to an existing CRM record by email."""
    if fetch_one(db, "SELECT id FROM users WHERE email = ?", (body.email,)):
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    ip = client_ip(request)
    with transaction(db):
        uid = insert(db, "users", {
            "email": body.email, "password_hash": hash_password(body.password),
            "full_name": f"{body.first_name} {body.last_name}", "phone": body.phone,
            "role": "customer", "avatar_color": "#f26b3a",
        })
        existing = fetch_one(db, "SELECT id FROM customers WHERE email = ? AND user_id IS NULL", (body.email,))
        if existing:
            cid = existing["id"]
            db.execute("UPDATE customers SET user_id = ? WHERE id = ?", (uid, cid))
        else:
            cid = insert(db, "customers", {
                "user_id": uid, "first_name": body.first_name, "last_name": body.last_name,
                "email": body.email, "phone": body.phone, "whatsapp": body.phone,
                "preferred_channel": "whatsapp" if body.consent_whatsapp else "email",
            })
        for channel, granted in (("data_processing", True), ("email", body.consent_email),
                                 ("whatsapp", body.consent_whatsapp), ("marketing", body.consent_marketing)):
            insert(db, "consents", {"customer_id": cid, "channel": channel, "granted": int(granted),
                                    "source": "portal", "ip_address": ip})
        activity(db, type="system", customer_id=cid, summary="Created customer portal account")
        audit(db, {"id": uid}, "register", "user", uid, ip=ip)
    publish("customer.registered", {"customer_id": cid, "name": f"{body.first_name} {body.last_name}"})
    user = fetch_one(db, "SELECT * FROM users WHERE id = ?", (uid,))
    return _session(user)  # type: ignore[arg-type]


@router.get("/me")
def me(user: CurrentUser):
    return user
