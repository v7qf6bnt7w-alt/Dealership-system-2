from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..db import fetch_all, fetch_one, insert, now_iso, transaction, update
from ..security import DB, StaffUser, client_ip
from ..services import messaging
from ..services.events import activity, audit, publish

router = APIRouter(tags=["service"])

JobStatus = Literal["scheduled", "checked_in", "in_progress", "waiting_parts", "quality_check", "ready", "closed", "cancelled"]
STATUS_COPY = {
    "checked_in": "Your vehicle has been checked in", "in_progress": "A technician is working on your vehicle",
    "waiting_parts": "We're waiting on a part to arrive", "quality_check": "Work complete — final quality check",
    "ready": "Your vehicle is ready for pickup", "closed": "Repair order closed — thank you!",
}


class JobIn(BaseModel):
    customer_id: int
    vehicle_id: int | None = None
    customer_vehicle: str | None = None
    complaint: str = Field(min_length=3)
    scheduled_at: str
    promised_at: str | None = None
    technician: str | None = None
    bay: str | None = None
    priority: Literal["low", "normal", "high", "urgent"] = "normal"
    odometer_in: int | None = None
    labor_hours: float = 0


class JobPatch(BaseModel):
    status: JobStatus | None = None
    technician: str | None = None
    bay: str | None = None
    priority: Literal["low", "normal", "high", "urgent"] | None = None
    diagnosis: str | None = None
    work_performed: str | None = None
    labor_hours: float | None = Field(None, ge=0)
    labor_rate: int | None = None
    scheduled_at: str | None = None
    promised_at: str | None = None
    notify_customer: bool = False
    note: str | None = None


class JobPartIn(BaseModel):
    part_id: int
    quantity: int = Field(gt=0)


class PartIn(BaseModel):
    sku: str
    name: str
    category: str
    qty_on_hand: int = 0
    reorder_level: int = 5
    unit_cost: int
    unit_price: int
    bin_location: str | None = None


JOB_SELECT = """
    SELECT s.*, c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
           COALESCE(v.year || ' ' || v.make || ' ' || v.model, s.customer_vehicle) AS vehicle_title, v.vin,
           u.full_name AS advisor_name,
           (SELECT COUNT(*) FROM service_job_parts sp WHERE sp.service_job_id = s.id) AS parts_count
    FROM service_jobs s JOIN customers c ON c.id = s.customer_id LEFT JOIN vehicles v ON v.id = s.vehicle_id
    LEFT JOIN users u ON u.id = s.advisor_id
"""


def _recalc(db, job_id: int) -> None:
    parts_total = db.execute("SELECT COALESCE(SUM(quantity * unit_price), 0) AS t FROM service_job_parts WHERE service_job_id = ?",
                             (job_id,)).fetchone()["t"]
    j = fetch_one(db, "SELECT labor_hours, labor_rate FROM service_jobs WHERE id = ?", (job_id,))
    update(db, "service_jobs", job_id, {"parts_total": parts_total, "total": parts_total + round(j["labor_hours"] * j["labor_rate"])})


def _job(db, job_id: int) -> dict:
    j = fetch_one(db, JOB_SELECT + " WHERE s.id = ?", (job_id,))
    if not j:
        raise HTTPException(404, "Repair order not found")
    j["parts"] = fetch_all(db, """SELECT sp.id, sp.quantity, sp.unit_price, p.sku, p.name, p.id AS part_id
                                  FROM service_job_parts sp JOIN parts p ON p.id = sp.part_id WHERE sp.service_job_id = ?""", (job_id,))
    return j


@router.get("/service/jobs")
def list_jobs(db: DB, user: StaffUser, status: str | None = None, include_closed: bool = False):
    where, params = [], []
    if status:
        where.append("s.status = ?"); params.append(status)
    elif not include_closed:
        where.append("(s.status NOT IN ('closed','cancelled') OR s.closed_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now','-7 days'))")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return fetch_all(db, f"{JOB_SELECT} {clause} ORDER BY s.scheduled_at LIMIT 500", params)


@router.get("/service/jobs/{job_id}")
def get_job(job_id: int, db: DB, user: StaffUser):
    return _job(db, job_id)


@router.post("/service/jobs", status_code=201)
def create_job(body: JobIn, request: Request, db: DB, user: StaffUser):
    with transaction(db):
        seq = db.execute("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM service_jobs").fetchone()["n"]
        jid = insert(db, "service_jobs", {**body.model_dump(), "ro_number": f"RO-{datetime.now():%y}{seq:05d}",
                                          "advisor_id": user["id"]})
        _recalc(db, jid)
        if body.vehicle_id:
            db.execute("UPDATE vehicles SET status = 'in_service' WHERE id = ? AND status = 'in_stock'", (body.vehicle_id,))
        activity(db, type="service", customer_id=body.customer_id, user_id=user["id"], summary=f"Repair order opened: {body.complaint[:80]}")
        audit(db, user, "create", "service_job", jid, ip=client_ip(request))
    job = _job(db, jid)
    publish("service.created", job)
    return job


@router.patch("/service/jobs/{job_id}")
def patch_job(job_id: int, body: JobPatch, request: Request, db: DB, user: StaffUser):
    before = _job(db, job_id)
    changes = body.model_dump(exclude_unset=True, exclude={"notify_customer", "note"})
    status_changed = "status" in changes and changes["status"] != before["status"]
    with transaction(db):
        if changes.get("status") == "closed":
            changes["closed_at"] = now_iso()
            # Consume reserved parts on close
            for p in before["parts"]:
                db.execute("UPDATE parts SET qty_on_hand = qty_on_hand - ?, qty_reserved = MAX(qty_reserved - ?, 0) WHERE id = ?",
                           (p["quantity"], p["quantity"], p["part_id"]))
            if before["vehicle_id"]:
                db.execute("UPDATE vehicles SET status = 'in_stock' WHERE id = ? AND status = 'in_service'", (before["vehicle_id"],))
        update(db, "service_jobs", job_id, changes)
        _recalc(db, job_id)
        if status_changed:
            activity(db, type="service", customer_id=before["customer_id"], user_id=user["id"],
                     summary=f"{before['ro_number']}: {before['status'].replace('_', ' ')} → {changes['status'].replace('_', ' ')}")
        audit(db, user, "update", "service_job", job_id, {"changes": changes}, client_ip(request))
    if status_changed and body.notify_customer and changes["status"] in STATUS_COPY:
        cust = fetch_one(db, "SELECT preferred_channel FROM customers WHERE id = ?", (before["customer_id"],))
        messaging.send(db, customer_id=before["customer_id"], channel="whatsapp" if cust["preferred_channel"] == "whatsapp" else "email",
                       template="service_update", user=user, automated=True,
                       context={"ro_number": before["ro_number"], "vehicle": before["vehicle_title"],
                                "status": STATUS_COPY[changes["status"]], "note": body.note or ""})
    job = _job(db, job_id)
    publish("service.updated", job)
    publish("service.updated", {"id": job_id, "status": job["status"], "ro_number": job["ro_number"]},
            roles=("customer",), user_ids=_customer_user_ids(db, before["customer_id"]))
    return job


def _customer_user_ids(db, customer_id: int) -> list[int]:
    r = fetch_one(db, "SELECT user_id FROM customers WHERE id = ?", (customer_id,))
    return [r["user_id"]] if r and r["user_id"] else []


@router.post("/service/jobs/{job_id}/parts", status_code=201)
def add_part(job_id: int, body: JobPartIn, db: DB, user: StaffUser):
    with transaction(db):
        p = fetch_one(db, "SELECT * FROM parts WHERE id = ?", (body.part_id,))
        if not p:
            raise HTTPException(404, "Part not found")
        available = p["qty_on_hand"] - p["qty_reserved"]
        if available < body.quantity:
            raise HTTPException(409, f"Only {available} × {p['name']} available")
        insert(db, "service_job_parts", {"service_job_id": job_id, "part_id": body.part_id, "quantity": body.quantity,
                                         "unit_price": p["unit_price"]})
        db.execute("UPDATE parts SET qty_reserved = qty_reserved + ? WHERE id = ?", (body.quantity, body.part_id))
        _recalc(db, job_id)
    if available - body.quantity <= p["reorder_level"]:
        publish("parts.low_stock", {"sku": p["sku"], "name": p["name"], "available": available - body.quantity})
    return _job(db, job_id)


@router.delete("/service/jobs/{job_id}/parts/{line_id}")
def remove_part(job_id: int, line_id: int, db: DB, user: StaffUser):
    with transaction(db):
        line = fetch_one(db, "SELECT * FROM service_job_parts WHERE id = ? AND service_job_id = ?", (line_id, job_id))
        if not line:
            raise HTTPException(404, "Line not found")
        db.execute("DELETE FROM service_job_parts WHERE id = ?", (line_id,))
        db.execute("UPDATE parts SET qty_reserved = MAX(qty_reserved - ?, 0) WHERE id = ?", (line["quantity"], line["part_id"]))
        _recalc(db, job_id)
    return _job(db, job_id)


@router.get("/parts")
def list_parts(db: DB, user: StaffUser, q: str | None = None, low_stock: bool = False):
    where, params = [], []
    if q:
        where.append("(sku LIKE ? OR name LIKE ?)"); params += [f"%{q}%", f"%{q}%"]
    if low_stock:
        where.append("qty_on_hand - qty_reserved <= reorder_level")
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return fetch_all(db, f"SELECT *, qty_on_hand - qty_reserved AS available FROM parts {clause} ORDER BY category, name", params)


@router.post("/parts", status_code=201)
def create_part(body: PartIn, db: DB, user: StaffUser):
    pid = insert(db, "parts", body.model_dump())
    return fetch_one(db, "SELECT * FROM parts WHERE id = ?", (pid,))


@router.post("/parts/{part_id}/adjust")
def adjust_part(part_id: int, payload: dict, db: DB, user: StaffUser):
    delta = int(payload.get("delta", 0))
    db.execute("UPDATE parts SET qty_on_hand = MAX(qty_on_hand + ?, 0) WHERE id = ?", (delta, part_id))
    audit(db, user, "stock_adjust", "part", part_id, {"delta": delta})
    return fetch_one(db, "SELECT *, qty_on_hand - qty_reserved AS available FROM parts WHERE id = ?", (part_id,))
