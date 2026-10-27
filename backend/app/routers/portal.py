"""Customer self-service portal API (role = customer)."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..config import settings
from ..db import fetch_all, fetch_one, insert, update
from ..security import DB, CustomerUser, client_ip
from ..services import automation
from ..services.events import activity, audit, publish
from .admin import export_customer
from .crm import current_consents

router = APIRouter(prefix="/portal", tags=["portal"])


def _cid(user: dict) -> int:
    if not user.get("customer_id"):
        raise HTTPException(404, "No customer profile linked to this account")
    return user["customer_id"]


@router.get("/dealer")
def dealer():
    return {"name": settings.dealer_name, "address": settings.dealer_address, "phone": settings.dealer_phone,
            "lat": settings.dealer_lat, "lng": settings.dealer_lng,
            "hours": [{"days": "Mon – Fri", "time": "9:00 – 19:00"}, {"days": "Saturday", "time": "9:00 – 17:00"},
                      {"days": "Sunday", "time": "Closed"}]}


@router.get("/me")
def me(db: DB, user: CustomerUser):
    cid = _cid(user)
    c = fetch_one(db, "SELECT id, first_name, last_name, email, phone, whatsapp, city, preferred_channel FROM customers WHERE id = ?", (cid,))
    c["consents"] = current_consents(db, cid)
    c["favorites"] = [r["vehicle_id"] for r in fetch_all(db, "SELECT vehicle_id FROM favorites WHERE customer_id = ?", (cid,))]
    return c


class ProfilePatch(BaseModel):
    phone: str | None = None
    whatsapp: str | None = None
    city: str | None = None
    preferred_channel: Literal["email", "whatsapp", "phone"] | None = None


@router.patch("/me")
def update_me(body: ProfilePatch, db: DB, user: CustomerUser):
    update(db, "customers", _cid(user), body.model_dump(exclude_unset=True))
    return me(db, user)


@router.get("/favorites")
def favorites(db: DB, user: CustomerUser):
    return fetch_all(db, """SELECT v.id, v.year, v.make, v.model, v.trim, v.price, v.mileage, v.status, v.condition, v.fuel_type,
                            v.transmission, v.body_style,
                            (SELECT url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY sort_order LIMIT 1) AS photo
                            FROM favorites f JOIN vehicles v ON v.id = f.vehicle_id WHERE f.customer_id = ? ORDER BY f.created_at DESC""",
                     (_cid(user),))


@router.post("/favorites/{vehicle_id}")
def toggle_favorite(vehicle_id: int, db: DB, user: CustomerUser):
    cid = _cid(user)
    if fetch_one(db, "SELECT 1 AS x FROM favorites WHERE customer_id = ? AND vehicle_id = ?", (cid, vehicle_id)):
        db.execute("DELETE FROM favorites WHERE customer_id = ? AND vehicle_id = ?", (cid, vehicle_id))
        return {"favorited": False}
    db.execute("INSERT INTO favorites (customer_id, vehicle_id) VALUES (?, ?)", (cid, vehicle_id))
    return {"favorited": True}


class BookingIn(BaseModel):
    vehicle_id: int
    scheduled_at: str
    message: str | None = Field(None, max_length=1000)


@router.post("/test-drives", status_code=201)
def book_test_drive(body: BookingIn, db: DB, user: CustomerUser):
    cid = _cid(user)
    v = fetch_one(db, "SELECT id, year, make, model, status FROM vehicles WHERE id = ? AND is_published = 1", (body.vehicle_id,))
    if not v or v["status"] == "sold":
        raise HTTPException(404, "Vehicle unavailable")
    if fetch_one(db, """SELECT id FROM test_drives WHERE vehicle_id = ? AND status IN ('requested','confirmed')
                        AND abs(julianday(scheduled_at) - julianday(?)) * 1440 < 30""", (body.vehicle_id, body.scheduled_at)):
        raise HTTPException(409, "That time slot is already taken — please pick another time")
    title = f"{v['year']} {v['make']} {v['model']}"
    lead = fetch_one(db, "SELECT * FROM leads WHERE customer_id = ? AND stage NOT IN ('won','lost') ORDER BY updated_at DESC LIMIT 1", (cid,))
    if not lead:
        owner = fetch_one(db, "SELECT owner_id FROM customers WHERE id = ?", (cid,))["owner_id"]
        if not owner:  # round-robin: rep with the fewest open leads
            r = fetch_one(db, """SELECT u.id FROM users u LEFT JOIN leads l ON l.assigned_to = u.id AND l.stage NOT IN ('won','lost')
                                 WHERE u.role = 'sales' AND u.is_active = 1 GROUP BY u.id ORDER BY COUNT(l.id) LIMIT 1""")
            owner = r["id"] if r else None
        lid = insert(db, "leads", {"customer_id": cid, "vehicle_id": body.vehicle_id, "assigned_to": owner, "source": "website",
                                   "stage": "test_drive", "score": 75, "notes": body.message})
        lead = fetch_one(db, "SELECT * FROM leads WHERE id = ?", (lid,))
    tid = insert(db, "test_drives", {"customer_id": cid, "vehicle_id": body.vehicle_id, "lead_id": lead["id"],
                                     "sales_rep_id": lead["assigned_to"], "scheduled_at": body.scheduled_at, "status": "requested"})
    activity(db, type="test_drive", customer_id=cid, lead_id=lead["id"], summary=f"Requested a test drive online: {title}")
    automation.on_lead_event(db, {**lead, "stage": "test_drive"}, user["full_name"])
    publish("test_drive.requested", {"id": tid, "vehicle": title, "customer": user["full_name"], "scheduled_at": body.scheduled_at})
    return {"id": tid, "status": "requested"}


@router.get("/test-drives")
def my_test_drives(db: DB, user: CustomerUser):
    return fetch_all(db, """SELECT t.id, t.scheduled_at, t.status, t.duration_min, v.id AS vehicle_id,
                            v.year || ' ' || v.make || ' ' || v.model AS vehicle_title, u.full_name AS rep_name,
                            (SELECT url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY sort_order LIMIT 1) AS photo
                            FROM test_drives t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN users u ON u.id = t.sales_rep_id
                            WHERE t.customer_id = ? ORDER BY t.scheduled_at DESC""", (_cid(user),))


@router.post("/test-drives/{td_id}/cancel")
def cancel_test_drive(td_id: int, db: DB, user: CustomerUser):
    db.execute("UPDATE test_drives SET status = 'cancelled' WHERE id = ? AND customer_id = ? AND status IN ('requested','confirmed')",
               (td_id, _cid(user)))
    publish("test_drive.updated", {"id": td_id, "status": "cancelled"})
    return {"ok": True}


@router.get("/garage")
def garage(db: DB, user: CustomerUser):
    """Owned vehicles + full maintenance history + live RO status."""
    cid = _cid(user)
    vehicles = fetch_all(db, """SELECT v.id, v.year, v.make, v.model, v.trim, v.vin, v.exterior_color, d.delivered_at, d.deal_number,
                                (SELECT url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY sort_order LIMIT 1) AS photo
                                FROM deals d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.customer_id = ? AND d.status = 'delivered'""", (cid,))
    jobs = fetch_all(db, """SELECT s.id, s.ro_number, s.status, s.complaint, s.work_performed, s.total, s.scheduled_at, s.promised_at,
                            s.closed_at, s.odometer_in, COALESCE(v.year || ' ' || v.make || ' ' || v.model, s.customer_vehicle) AS vehicle_title
                            FROM service_jobs s LEFT JOIN vehicles v ON v.id = s.vehicle_id WHERE s.customer_id = ? ORDER BY s.scheduled_at DESC""", (cid,))
    quotes = fetch_all(db, """SELECT d.id, d.deal_number, d.status, d.total_otd, d.quoted_at, v.year || ' ' || v.make || ' ' || v.model AS vehicle_title
                              FROM deals d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.customer_id = ? AND d.status IN ('quoted','accepted','invoiced')""", (cid,))
    return {"vehicles": vehicles, "service_jobs": jobs, "quotes": quotes}


class ConsentIn(BaseModel):
    channel: Literal["email", "whatsapp", "phone", "marketing"]
    granted: bool


@router.post("/consents")
def portal_consent(body: ConsentIn, request: Request, db: DB, user: CustomerUser):
    cid = _cid(user)
    insert(db, "consents", {"customer_id": cid, "channel": body.channel, "granted": int(body.granted), "source": "portal",
                            "ip_address": client_ip(request)})
    activity(db, type="system", customer_id=cid, summary=f"Customer {'granted' if body.granted else 'withdrew'} {body.channel} consent via portal")
    return current_consents(db, cid)


@router.get("/privacy/export")
def portal_export(request: Request, db: DB, user: CustomerUser):
    cid = _cid(user)
    insert(db, "gdpr_requests", {"customer_id": cid, "type": "export", "status": "completed", "requested_by": "customer"})
    audit(db, user, "export", "customer", cid, ip=client_ip(request))
    return export_customer(db, cid)


@router.post("/privacy/erasure", status_code=202)
def portal_erasure(request: Request, db: DB, user: CustomerUser, payload: dict | None = None):
    cid = _cid(user)
    if fetch_one(db, "SELECT id FROM gdpr_requests WHERE customer_id = ? AND type = 'erasure' AND status = 'pending'", (cid,)):
        raise HTTPException(409, "An erasure request is already pending")
    rid = insert(db, "gdpr_requests", {"customer_id": cid, "type": "erasure", "requested_by": "customer",
                                       "notes": (payload or {}).get("reason")})
    audit(db, user, "gdpr_erasure_requested", "customer", cid, ip=client_ip(request))
    publish("gdpr.requested", {"id": rid, "customer": user["full_name"]}, roles=("admin",))
    return {"id": rid, "status": "pending", "message": "Your request will be processed within 30 days."}
