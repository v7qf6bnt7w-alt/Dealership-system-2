from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from ..db import decode_rows, fetch_all, fetch_one, insert, now_iso, transaction, update
from ..security import DB, AdminUser, StaffUser, client_ip, hash_password
from ..services.events import audit

router = APIRouter(tags=["admin"])


# =============================================================================
# Business intelligence
# =============================================================================
@router.get("/dashboard")
def dashboard(db: DB, user: StaffUser):
    """Role-aware KPI payload. Sales reps get their personal numbers; admins see the whole store."""
    rep_filter = "AND d.sales_rep_id = ?" if user["role"] == "sales" else ""
    rp = [user["id"]] if user["role"] == "sales" else []
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0).strftime("%Y-%m-%dT%H:%M:%SZ")
    prev_start = (now.replace(day=1) - timedelta(days=1)).replace(day=1, hour=0, minute=0, second=0).strftime("%Y-%m-%dT%H:%M:%SZ")

    def kpi(since: str, until: str | None = None) -> dict:
        until_sql = "AND d.delivered_at < ?" if until else ""
        return fetch_one(db, f"""SELECT COUNT(*) AS units, COALESCE(SUM(total_otd),0) AS revenue, COALESCE(SUM(gross_profit),0) AS gross
                                 FROM deals d WHERE d.status = 'delivered' AND d.delivered_at >= ? {until_sql} {rep_filter}""",
                         [since, *([until] if until else []), *rp])

    cur, prev = kpi(month_start), kpi(prev_start, month_start)

    monthly = fetch_all(db, f"""SELECT substr(delivered_at, 1, 7) AS month, COUNT(*) AS units, SUM(total_otd) AS revenue,
                                SUM(gross_profit) AS gross FROM deals d WHERE d.status = 'delivered'
                                AND d.delivered_at >= datetime('now', 'start of month', '-11 months') {rep_filter}
                                GROUP BY month ORDER BY month""", rp)

    inventory = fetch_one(db, """SELECT COUNT(*) FILTER (WHERE status != 'sold') AS total_units,
        COUNT(*) FILTER (WHERE status = 'in_stock') AS in_stock, COUNT(*) FILTER (WHERE status = 'reserved') AS reserved,
        COUNT(*) FILTER (WHERE status = 'in_service') AS in_service, COUNT(*) FILTER (WHERE status = 'incoming') AS incoming,
        COUNT(*) FILTER (WHERE status != 'sold' AND condition = 'new') AS new_units,
        COUNT(*) FILTER (WHERE status != 'sold' AND condition != 'new') AS used_units,
        COALESCE(SUM(price) FILTER (WHERE status != 'sold'), 0) AS stock_value,
        COALESCE(SUM(cost) FILTER (WHERE status != 'sold'), 0) AS stock_cost,
        CAST(AVG(julianday('now') - julianday(acquired_at)) FILTER (WHERE status != 'sold') AS INTEGER) AS avg_days_in_stock,
        CAST(AVG(julianday(sold_at) - julianday(acquired_at)) FILTER (WHERE status = 'sold' AND sold_at >= datetime('now','-90 days')) AS INTEGER) AS avg_days_to_sell,
        COUNT(*) FILTER (WHERE status = 'sold' AND sold_at >= datetime('now','-365 days')) AS sold_12m FROM vehicles""")
    avg_stock = max(inventory["total_units"], 1)
    inventory["turnover_rate"] = round(inventory["sold_12m"] / avg_stock, 2)

    aging = fetch_all(db, """SELECT CASE WHEN d < 30 THEN '0–30' WHEN d < 60 THEN '31–60' WHEN d < 90 THEN '61–90' ELSE '90+' END AS bucket,
                             COUNT(*) AS count FROM (SELECT julianday('now') - julianday(acquired_at) AS d FROM vehicles WHERE status != 'sold')
                             GROUP BY bucket ORDER BY MIN(d)""")
    lead_scope = "WHERE assigned_to = ?" if user["role"] == "sales" else ""
    pipeline = fetch_all(db, f"""SELECT stage, COUNT(*) AS count, COALESCE(SUM(budget),0) AS value FROM leads {lead_scope}
                                 GROUP BY stage""", rp)
    conv = fetch_one(db, f"""SELECT COUNT(*) FILTER (WHERE stage = 'won') AS won, COUNT(*) FILTER (WHERE stage IN ('won','lost')) AS closed,
                             COUNT(*) FILTER (WHERE created_at >= ?) AS new_this_month FROM leads {lead_scope}""", [month_start, *rp])
    sources = fetch_all(db, f"SELECT source, COUNT(*) AS count, COUNT(*) FILTER (WHERE stage='won') AS won FROM leads {lead_scope} GROUP BY source ORDER BY count DESC", rp)
    leaderboard = fetch_all(db, """SELECT u.id, u.full_name, u.avatar_color, COUNT(d.id) AS units, COALESCE(SUM(d.total_otd),0) AS revenue,
                                   COALESCE(SUM(d.gross_profit),0) AS gross FROM users u
                                   LEFT JOIN deals d ON d.sales_rep_id = u.id AND d.status = 'delivered' AND d.delivered_at >= datetime('now','-90 days')
                                   WHERE u.role = 'sales' AND u.is_active = 1 GROUP BY u.id ORDER BY revenue DESC""")
    service = fetch_one(db, """SELECT COUNT(*) FILTER (WHERE status NOT IN ('closed','cancelled')) AS open_jobs,
        COUNT(*) FILTER (WHERE status = 'ready') AS ready, COUNT(*) FILTER (WHERE status = 'waiting_parts') AS waiting_parts,
        COALESCE(SUM(total) FILTER (WHERE status = 'closed' AND closed_at >= ?), 0) AS revenue_mtd FROM service_jobs""", (month_start,))
    service["low_stock_parts"] = fetch_one(db, "SELECT COUNT(*) AS n FROM parts WHERE qty_on_hand - qty_reserved <= reorder_level")["n"]
    mix = fetch_all(db, "SELECT body_style AS label, COUNT(*) AS count FROM vehicles WHERE status != 'sold' GROUP BY body_style ORDER BY count DESC")
    today = fetch_all(db, """SELECT t.id, t.scheduled_at, t.status, c.first_name || ' ' || c.last_name AS customer_name,
                             v.year || ' ' || v.make || ' ' || v.model AS vehicle_title FROM test_drives t
                             JOIN customers c ON c.id = t.customer_id JOIN vehicles v ON v.id = t.vehicle_id
                             WHERE date(t.scheduled_at) = date('now') AND t.status IN ('requested','confirmed') ORDER BY t.scheduled_at""")
    recent = fetch_all(db, """SELECT a.id, a.type, a.summary, a.created_at, u.full_name AS user_name,
                              c.first_name || ' ' || c.last_name AS customer_name FROM activities a
                              LEFT JOIN users u ON u.id = a.user_id LEFT JOIN customers c ON c.id = a.customer_id
                              ORDER BY a.created_at DESC LIMIT 12""")
    return {
        "kpis": {"current": cur, "previous": prev, "conversion_rate": round(conv["won"] / conv["closed"] * 100, 1) if conv["closed"] else 0,
                 "new_leads_month": conv["new_this_month"]},
        "monthly": monthly, "inventory": inventory, "aging": aging, "pipeline": pipeline, "sources": sources,
        "leaderboard": leaderboard, "service": service, "mix": mix, "today_test_drives": today, "recent_activity": recent,
    }


# =============================================================================
# User management
# =============================================================================
class UserIn(BaseModel):
    email: EmailStr
    full_name: str = Field(min_length=2)
    role: Literal["admin", "sales", "service"]
    phone: str | None = None
    password: str = Field(min_length=8)
    avatar_color: str | None = "#6366f1"


class UserPatch(BaseModel):
    full_name: str | None = None
    role: Literal["admin", "sales", "service"] | None = None
    phone: str | None = None
    is_active: bool | None = None
    password: str | None = Field(None, min_length=8)
    avatar_color: str | None = None


@router.get("/users")
def list_users(db: DB, user: StaffUser, include_customers: bool = False):
    where = "" if include_customers else "WHERE role != 'customer'"
    return fetch_all(db, f"""SELECT id, email, full_name, role, phone, is_active, avatar_color, last_login_at, created_at
                             FROM users {where} ORDER BY role, full_name""")


@router.post("/users", status_code=201)
def create_user(body: UserIn, request: Request, db: DB, admin: AdminUser):
    if fetch_one(db, "SELECT id FROM users WHERE email = ?", (body.email,)):
        raise HTTPException(409, "Email already in use")
    uid = insert(db, "users", {**body.model_dump(exclude={"password"}), "password_hash": hash_password(body.password)})
    audit(db, admin, "create", "user", uid, {"role": body.role}, client_ip(request))
    return fetch_one(db, "SELECT id, email, full_name, role, is_active, avatar_color FROM users WHERE id = ?", (uid,))


@router.patch("/users/{user_id}")
def patch_user(user_id: int, body: UserPatch, request: Request, db: DB, admin: AdminUser):
    changes = body.model_dump(exclude_unset=True)
    if user_id == admin["id"] and (changes.get("is_active") is False or changes.get("role", "admin") != "admin"):
        raise HTTPException(400, "You cannot demote or deactivate your own account")
    if "password" in changes:
        changes["password_hash"] = hash_password(changes.pop("password"))
    update(db, "users", user_id, changes)
    audit(db, admin, "update", "user", user_id, {"fields": [k for k in changes if k != "password_hash"]}, client_ip(request))
    return fetch_one(db, "SELECT id, email, full_name, role, is_active, avatar_color FROM users WHERE id = ?", (user_id,))


@router.get("/audit-logs")
def audit_logs(db: DB, admin: AdminUser, entity: str | None = None, user_id: int | None = None, limit: int = 300):
    where, params = [], []
    if entity:
        where.append("a.entity = ?"); params.append(entity)
    if user_id:
        where.append("a.user_id = ?"); params.append(user_id)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return decode_rows(fetch_all(db, f"""SELECT a.*, u.full_name AS user_name, u.role AS user_role FROM audit_logs a
                                         LEFT JOIN users u ON u.id = a.user_id {clause} ORDER BY a.created_at DESC, a.id DESC LIMIT ?""",
                                 [*params, limit]), "details")


# =============================================================================
# GDPR
# =============================================================================
def export_customer(db, customer_id: int) -> dict:
    c = fetch_one(db, "SELECT * FROM customers WHERE id = ?", (customer_id,))
    if not c:
        raise HTTPException(404, "Customer not found")
    q = lambda sql: fetch_all(db, sql, (customer_id,))  # noqa: E731
    return {
        "exported_at": now_iso(), "format": "meridian-dms/gdpr-export@1",
        "profile": c, "consents": q("SELECT channel, granted, source, created_at FROM consents WHERE customer_id = ? ORDER BY created_at"),
        "leads": q("SELECT id, stage, source, budget, created_at FROM leads WHERE customer_id = ?"),
        "deals": q("SELECT deal_number, status, total_otd, created_at, delivered_at FROM deals WHERE customer_id = ?"),
        "test_drives": q("SELECT scheduled_at, status, distance_km FROM test_drives WHERE customer_id = ?"),
        "service_jobs": q("SELECT ro_number, status, complaint, work_performed, total, scheduled_at FROM service_jobs WHERE customer_id = ?"),
        "communications": q("SELECT channel, direction, subject, body, status, created_at FROM communications WHERE customer_id = ?"),
        "activities": q("SELECT type, summary, created_at FROM activities WHERE customer_id = ?"),
        "favorites": q("SELECT vehicle_id, created_at FROM favorites WHERE customer_id = ?"),
    }


def anonymize_customer(db, customer_id: int) -> None:
    """Right to erasure: scrub PII while retaining non-identifying financial records required by law."""
    tag = f"anon-{customer_id:06d}"
    with transaction(db):
        user_id = (fetch_one(db, "SELECT user_id FROM customers WHERE id = ?", (customer_id,)) or {}).get("user_id")
        update(db, "customers", customer_id, {"first_name": "Anonymized", "last_name": tag, "email": None, "phone": None,
                                              "whatsapp": None, "address": None, "city": None, "notes": None, "tags": [],
                                              "is_anonymized": 1, "user_id": None})
        db.execute("UPDATE communications SET body = '[redacted]', subject = NULL, recipient = NULL WHERE customer_id = ?", (customer_id,))
        db.execute("UPDATE activities SET summary = '[redacted]', meta = NULL WHERE customer_id = ?", (customer_id,))
        db.execute("UPDATE test_drives SET route = NULL, feedback = NULL WHERE customer_id = ?", (customer_id,))
        db.execute("UPDATE leads SET notes = NULL WHERE customer_id = ?", (customer_id,))
        db.execute("DELETE FROM favorites WHERE customer_id = ?", (customer_id,))
        insert(db, "consents", {"customer_id": customer_id, "channel": "data_processing", "granted": 0, "source": "erasure"})
        for ch in ("email", "whatsapp", "phone", "marketing"):
            insert(db, "consents", {"customer_id": customer_id, "channel": ch, "granted": 0, "source": "erasure"})
        if user_id:
            db.execute("UPDATE users SET is_active = 0, email = ?, full_name = 'Anonymized', phone = NULL WHERE id = ?",
                       (f"{tag}@erased.invalid", user_id))


class GdprProcess(BaseModel):
    action: Literal["complete", "reject"]
    notes: str | None = None


@router.get("/gdpr/requests")
def gdpr_requests(db: DB, admin: AdminUser):
    return fetch_all(db, """SELECT g.*, c.first_name || ' ' || c.last_name AS customer_name, c.email AS customer_email,
                            u.full_name AS completed_by_name FROM gdpr_requests g LEFT JOIN customers c ON c.id = g.customer_id
                            LEFT JOIN users u ON u.id = g.completed_by ORDER BY g.status = 'pending' DESC, g.created_at DESC""")


@router.post("/gdpr/requests/{req_id}")
def process_gdpr(req_id: int, body: GdprProcess, request: Request, db: DB, admin: AdminUser):
    r = fetch_one(db, "SELECT * FROM gdpr_requests WHERE id = ?", (req_id,))
    if not r or r["status"] != "pending":
        raise HTTPException(404, "Pending request not found")
    if body.action == "complete" and r["type"] == "erasure" and r["customer_id"]:
        anonymize_customer(db, r["customer_id"])
    update(db, "gdpr_requests", req_id, {"status": "completed" if body.action == "complete" else "rejected",
                                         "completed_by": admin["id"], "completed_at": now_iso(), "notes": body.notes}, touch=False)
    audit(db, admin, f"gdpr_{body.action}", "gdpr_request", req_id, {"type": r["type"], "customer_id": r["customer_id"]}, client_ip(request))
    return {"ok": True}


@router.get("/customers/{customer_id}/export")
def staff_export(customer_id: int, request: Request, db: DB, admin: AdminUser):
    audit(db, admin, "export", "customer", customer_id, ip=client_ip(request))
    return export_customer(db, customer_id)


@router.post("/customers/{customer_id}/anonymize")
def staff_anonymize(customer_id: int, request: Request, db: DB, admin: AdminUser):
    anonymize_customer(db, customer_id)
    audit(db, admin, "anonymize", "customer", customer_id, ip=client_ip(request))
    return {"ok": True}


@router.get("/settings/dealer")
def dealer_settings(user: StaffUser):
    from ..config import settings
    return json.loads(json.dumps({"name": settings.dealer_name, "address": settings.dealer_address, "phone": settings.dealer_phone,
                                  "lat": settings.dealer_lat, "lng": settings.dealer_lng, "tax_rate": settings.default_tax_rate,
                                  "currency": settings.currency}))
