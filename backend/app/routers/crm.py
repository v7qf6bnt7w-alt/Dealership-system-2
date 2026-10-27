from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, EmailStr, Field

from ..db import decode_json, decode_rows, fetch_all, fetch_one, insert, now_iso, transaction, update
from ..security import DB, SalesUser, StaffUser, client_ip
from ..services import automation
from ..services.events import activity, audit, publish

router = APIRouter(tags=["crm"])

Stage = Literal["new", "contacted", "qualified", "test_drive", "negotiation", "won", "lost"]
STAGE_LABEL = {"new": "New", "contacted": "Contacted", "qualified": "Qualified", "test_drive": "Test drive",
               "negotiation": "Negotiation", "won": "Won", "lost": "Lost"}


# =============================================================================
# Customers
# =============================================================================
class CustomerIn(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None
    address: str | None = None
    city: str | None = None
    preferred_channel: Literal["email", "whatsapp", "phone"] = "email"
    owner_id: int | None = None
    tags: list[str] = []
    notes: str | None = None
    consents: dict[str, bool] = Field(default_factory=lambda: {"data_processing": True, "email": True})


class CustomerPatch(BaseModel):
    first_name: str | None = None
    last_name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    whatsapp: str | None = None
    address: str | None = None
    city: str | None = None
    preferred_channel: Literal["email", "whatsapp", "phone"] | None = None
    owner_id: int | None = None
    tags: list[str] | None = None
    notes: str | None = None


class ConsentIn(BaseModel):
    channel: Literal["email", "whatsapp", "phone", "marketing", "data_processing"]
    granted: bool


def current_consents(db, customer_id: int) -> dict[str, dict]:
    rows = fetch_all(db, """SELECT channel, granted, source, created_at FROM consents c1
                            WHERE customer_id = ? AND id = (SELECT id FROM consents c2 WHERE c2.customer_id = c1.customer_id
                            AND c2.channel = c1.channel ORDER BY created_at DESC, id DESC LIMIT 1)""", (customer_id,))
    return {r["channel"]: r for r in rows}


@router.get("/customers")
def list_customers(db: DB, user: StaffUser, q: str | None = None, owner_id: int | None = None, limit: int = 200):
    where, params = ["c.is_anonymized = 0"], []
    if q:
        like = f"%{q}%"
        where.append("(c.first_name || ' ' || c.last_name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?)")
        params += [like, like, like]
    if owner_id:
        where.append("c.owner_id = ?"); params.append(owner_id)
    rows = fetch_all(db, f"""
        SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.city, c.preferred_channel, c.lifetime_value,
               c.tags, c.created_at, c.user_id IS NOT NULL AS has_portal, u.full_name AS owner_name,
               (SELECT stage FROM leads l WHERE l.customer_id = c.id ORDER BY l.updated_at DESC LIMIT 1) AS lead_stage,
               (SELECT MAX(created_at) FROM activities a WHERE a.customer_id = c.id) AS last_activity_at
        FROM customers c LEFT JOIN users u ON u.id = c.owner_id
        WHERE {' AND '.join(where)} ORDER BY last_activity_at DESC NULLS LAST LIMIT ?""", [*params, limit])
    return decode_rows(rows, "tags")


@router.get("/customers/{customer_id}")
def customer_360(customer_id: int, db: DB, user: StaffUser):
    c = decode_json(fetch_one(db, """SELECT c.*, u.full_name AS owner_name FROM customers c
                                     LEFT JOIN users u ON u.id = c.owner_id WHERE c.id = ?""", (customer_id,)), "tags")
    if not c:
        raise HTTPException(404, "Customer not found")
    q = lambda sql: fetch_all(db, sql, (customer_id,))  # noqa: E731
    c["consents"] = current_consents(db, customer_id)
    c["leads"] = q("""SELECT l.*, v.year || ' ' || v.make || ' ' || v.model AS vehicle, u.full_name AS assigned_name
                      FROM leads l LEFT JOIN vehicles v ON v.id = l.vehicle_id LEFT JOIN users u ON u.id = l.assigned_to
                      WHERE l.customer_id = ? ORDER BY l.created_at DESC""")
    c["deals"] = q("""SELECT d.id, d.deal_number, d.status, d.total_otd, d.created_at, d.delivered_at,
                      v.year || ' ' || v.make || ' ' || v.model AS vehicle FROM deals d JOIN vehicles v ON v.id = d.vehicle_id
                      WHERE d.customer_id = ? ORDER BY d.created_at DESC""")
    c["test_drives"] = q("""SELECT t.id, t.scheduled_at, t.status, t.distance_km, v.year || ' ' || v.make || ' ' || v.model AS vehicle
                            FROM test_drives t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.customer_id = ?
                            ORDER BY t.scheduled_at DESC""")
    c["service_jobs"] = q("""SELECT s.id, s.ro_number, s.status, s.complaint, s.total, s.scheduled_at,
                             COALESCE(v.year || ' ' || v.make || ' ' || v.model, s.customer_vehicle) AS vehicle
                             FROM service_jobs s LEFT JOIN vehicles v ON v.id = s.vehicle_id WHERE s.customer_id = ?
                             ORDER BY s.scheduled_at DESC""")
    c["communications"] = q("""SELECT id, channel, direction, subject, body, status, is_automated, created_at
                               FROM communications WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100""")
    c["timeline"] = q("""SELECT a.id, a.type, a.summary, a.created_at, u.full_name AS user_name FROM activities a
                         LEFT JOIN users u ON u.id = a.user_id WHERE a.customer_id = ? ORDER BY a.created_at DESC LIMIT 150""")
    c["tasks"] = q("""SELECT t.*, u.full_name AS assigned_name FROM tasks t LEFT JOIN users u ON u.id = t.assigned_to
                      WHERE t.customer_id = ? AND t.status = 'open' ORDER BY t.due_at""")
    c["favorites"] = q("""SELECT v.id, v.year, v.make, v.model, v.price, v.status FROM favorites f
                          JOIN vehicles v ON v.id = f.vehicle_id WHERE f.customer_id = ?""")
    return c


@router.post("/customers", status_code=201)
def create_customer(body: CustomerIn, request: Request, db: DB, user: StaffUser):
    data = body.model_dump(exclude={"consents"})
    data["owner_id"] = data["owner_id"] or (user["id"] if user["role"] == "sales" else None)
    with transaction(db):
        cid = insert(db, "customers", data)
        for ch, granted in body.consents.items():
            insert(db, "consents", {"customer_id": cid, "channel": ch, "granted": int(granted), "source": "staff",
                                    "ip_address": client_ip(request)})
        activity(db, type="system", customer_id=cid, user_id=user["id"], summary="Customer profile created")
        audit(db, user, "create", "customer", cid, ip=client_ip(request))
    return customer_360(cid, db, user)


@router.patch("/customers/{customer_id}")
def patch_customer(customer_id: int, body: CustomerPatch, request: Request, db: DB, user: StaffUser):
    changes = body.model_dump(exclude_unset=True)
    with transaction(db):
        update(db, "customers", customer_id, changes)
        audit(db, user, "update", "customer", customer_id, {"fields": list(changes)}, client_ip(request))
    return customer_360(customer_id, db, user)


@router.post("/customers/{customer_id}/consents")
def set_consent(customer_id: int, body: ConsentIn, request: Request, db: DB, user: StaffUser):
    insert(db, "consents", {"customer_id": customer_id, "channel": body.channel, "granted": int(body.granted),
                            "source": "staff", "ip_address": client_ip(request)})
    activity(db, type="system", customer_id=customer_id, user_id=user["id"],
             summary=f"{body.channel.replace('_', ' ').title()} consent {'granted' if body.granted else 'withdrawn'}")
    return current_consents(db, customer_id)


class NoteIn(BaseModel):
    summary: str = Field(min_length=1, max_length=4000)
    type: Literal["note", "call"] = "note"
    lead_id: int | None = None


@router.post("/customers/{customer_id}/activities", status_code=201)
def add_activity(customer_id: int, body: NoteIn, db: DB, user: StaffUser):
    activity(db, type=body.type, summary=body.summary, customer_id=customer_id, lead_id=body.lead_id, user_id=user["id"])
    if body.lead_id:
        db.execute("UPDATE leads SET last_activity_at = ? WHERE id = ?", (now_iso(), body.lead_id))
    return {"ok": True}


# =============================================================================
# Leads (Kanban)
# =============================================================================
class LeadIn(BaseModel):
    customer_id: int | None = None
    new_customer: CustomerIn | None = None
    vehicle_id: int | None = None
    assigned_to: int | None = None
    source: str = "walk_in"
    budget: int | None = None
    score: int = Field(50, ge=0, le=100)
    notes: str | None = None


class LeadMove(BaseModel):
    stage: Stage
    position: float | None = None
    lost_reason: str | None = None


class LeadPatch(BaseModel):
    vehicle_id: int | None = None
    assigned_to: int | None = None
    score: int | None = Field(None, ge=0, le=100)
    budget: int | None = None
    notes: str | None = None
    source: str | None = None


LEAD_SELECT = """
    SELECT l.*, c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
           c.email AS customer_email, c.preferred_channel,
           v.year || ' ' || v.make || ' ' || v.model AS vehicle_title, v.price AS vehicle_price,
           (SELECT url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY sort_order LIMIT 1) AS vehicle_photo,
           u.full_name AS assigned_name, u.avatar_color AS assigned_color,
           (SELECT COUNT(*) FROM tasks t WHERE t.lead_id = l.id AND t.status = 'open') AS open_tasks,
           (SELECT MIN(due_at) FROM tasks t WHERE t.lead_id = l.id AND t.status = 'open') AS next_due
    FROM leads l JOIN customers c ON c.id = l.customer_id
    LEFT JOIN vehicles v ON v.id = l.vehicle_id LEFT JOIN users u ON u.id = l.assigned_to
"""


def _lead(db, lead_id: int) -> dict:
    row = fetch_one(db, LEAD_SELECT + " WHERE l.id = ?", (lead_id,))
    if not row:
        raise HTTPException(404, "Lead not found")
    return row


@router.get("/leads")
def list_leads(db: DB, user: SalesUser, mine: bool = False, include_closed_days: int = 30):
    where, params = ["(l.stage NOT IN ('won','lost') OR l.updated_at >= datetime('now', ?))"], [f"-{include_closed_days} days"]
    if mine or user["role"] == "sales":
        where.append("l.assigned_to = ?"); params.append(user["id"])
    return fetch_all(db, LEAD_SELECT + f" WHERE {' AND '.join(where)} ORDER BY l.stage, l.position, l.created_at DESC", params)


@router.post("/leads", status_code=201)
def create_lead(body: LeadIn, request: Request, db: DB, user: SalesUser):
    with transaction(db):
        cid = body.customer_id
        if not cid:
            if not body.new_customer:
                raise HTTPException(422, "Provide customer_id or new_customer")
            nc = body.new_customer
            cid = insert(db, "customers", {**nc.model_dump(exclude={"consents"}), "owner_id": body.assigned_to or user["id"]})
            for ch, granted in nc.consents.items():
                insert(db, "consents", {"customer_id": cid, "channel": ch, "granted": int(granted), "source": "staff"})
        top = db.execute("SELECT COALESCE(MIN(position), 1000) - 1 AS p FROM leads WHERE stage = 'new'").fetchone()["p"]
        lid = insert(db, "leads", {
            "customer_id": cid, "vehicle_id": body.vehicle_id, "assigned_to": body.assigned_to or user["id"],
            "source": body.source, "budget": body.budget, "score": body.score, "notes": body.notes, "position": top,
        })
        lead = _lead(db, lid)
        activity(db, type="system", customer_id=cid, lead_id=lid, user_id=user["id"],
                 summary=f"Lead created from {body.source.replace('_', ' ')}" +
                         (f" — interested in {lead['vehicle_title']}" if lead["vehicle_title"] else ""))
        automation.on_lead_event(db, lead, lead["customer_name"])
        audit(db, user, "create", "lead", lid, ip=client_ip(request))
    lead = _lead(db, lid)
    publish("lead.created", lead)
    return lead


@router.post("/leads/{lead_id}/move")
def move_lead(lead_id: int, body: LeadMove, db: DB, user: SalesUser):
    before = _lead(db, lead_id)
    with transaction(db):
        update(db, "leads", lead_id, {"stage": body.stage, "position": body.position if body.position is not None else before["position"],
                                      "lost_reason": body.lost_reason, "last_activity_at": now_iso()})
        if before["stage"] != body.stage:
            activity(db, type="stage_change", customer_id=before["customer_id"], lead_id=lead_id, user_id=user["id"],
                     summary=f"Moved from {STAGE_LABEL[before['stage']]} to {STAGE_LABEL[body.stage]}"
                             + (f" — {body.lost_reason}" if body.lost_reason else ""),
                     meta={"from": before["stage"], "to": body.stage})
            lead = _lead(db, lead_id)
            automation.on_lead_event(db, lead, lead["customer_name"])
    lead = _lead(db, lead_id)
    publish("lead.moved", {"lead": lead, "from": before["stage"], "by": user["full_name"]})
    return lead


@router.patch("/leads/{lead_id}")
def patch_lead(lead_id: int, body: LeadPatch, db: DB, user: SalesUser):
    update(db, "leads", lead_id, body.model_dump(exclude_unset=True))
    lead = _lead(db, lead_id)
    publish("lead.updated", lead)
    return lead


# =============================================================================
# Tasks
# =============================================================================
class TaskIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str | None = None
    due_at: str
    priority: Literal["low", "normal", "high"] = "normal"
    lead_id: int | None = None
    customer_id: int | None = None
    assigned_to: int | None = None


@router.get("/tasks")
def list_tasks(db: DB, user: StaffUser, scope: Literal["mine", "all"] = "mine", status: str = "open"):
    where, params = ["t.status = ?"], [status]
    if scope == "mine" or user["role"] != "admin":
        where.append("t.assigned_to = ?"); params.append(user["id"])
    return fetch_all(db, f"""
        SELECT t.*, c.first_name || ' ' || c.last_name AS customer_name, u.full_name AS assigned_name, l.stage AS lead_stage
        FROM tasks t LEFT JOIN customers c ON c.id = t.customer_id LEFT JOIN users u ON u.id = t.assigned_to
        LEFT JOIN leads l ON l.id = t.lead_id WHERE {' AND '.join(where)} ORDER BY t.due_at LIMIT 300""", params)


@router.post("/tasks", status_code=201)
def create_task(body: TaskIn, db: DB, user: StaffUser):
    tid = insert(db, "tasks", {**body.model_dump(), "assigned_to": body.assigned_to or user["id"]})
    return fetch_one(db, "SELECT * FROM tasks WHERE id = ?", (tid,))


@router.post("/tasks/{task_id}/complete")
def complete_task(task_id: int, db: DB, user: StaffUser):
    t = fetch_one(db, "SELECT * FROM tasks WHERE id = ?", (task_id,))
    if not t:
        raise HTTPException(404, "Task not found")
    db.execute("UPDATE tasks SET status = 'done', completed_at = ? WHERE id = ?", (now_iso(), task_id))
    if t["customer_id"]:
        activity(db, type="system", customer_id=t["customer_id"], lead_id=t["lead_id"], user_id=user["id"],
                 summary=f"Completed task: {t['title']}")
    if t["lead_id"]:
        db.execute("UPDATE leads SET last_activity_at = ? WHERE id = ?", (now_iso(), t["lead_id"]))
    return {"ok": True}


@router.post("/automation/run")
def run_automation(db: DB, user: SalesUser):
    """Manually trigger the follow-up sweep (also runs every 5 minutes in the background)."""
    return automation.run_sweep(db)
