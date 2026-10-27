from __future__ import annotations

import json
import math
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from ..config import settings
from ..db import decode_json, decode_rows, fetch_all, fetch_one, insert, now_iso, transaction, update
from ..security import DB, SalesUser, StaffUser, client_ip
from ..services import messaging, pricing
from ..services.events import activity, audit, publish

router = APIRouter(tags=["sales"])


# =============================================================================
# Test drives
# =============================================================================
class TestDriveIn(BaseModel):
    customer_id: int
    vehicle_id: int
    lead_id: int | None = None
    sales_rep_id: int | None = None
    scheduled_at: str
    duration_min: int = Field(30, ge=15, le=180)
    status: Literal["requested", "confirmed"] = "confirmed"
    notify: bool = True


class TestDrivePatch(BaseModel):
    status: Literal["requested", "confirmed", "completed", "no_show", "cancelled"] | None = None
    scheduled_at: str | None = None
    sales_rep_id: int | None = None
    feedback: str | None = None
    license_verified: bool | None = None


class RouteIn(BaseModel):
    points: list[tuple[float, float]] = Field(min_length=2, max_length=5000)


TD_SELECT = """
    SELECT t.*, c.first_name || ' ' || c.last_name AS customer_name, c.phone AS customer_phone,
           v.year || ' ' || v.make || ' ' || v.model AS vehicle_title, v.stock_number, v.exterior_color,
           (SELECT url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY sort_order LIMIT 1) AS vehicle_photo,
           u.full_name AS rep_name, u.avatar_color AS rep_color
    FROM test_drives t JOIN customers c ON c.id = t.customer_id JOIN vehicles v ON v.id = t.vehicle_id
    LEFT JOIN users u ON u.id = t.sales_rep_id
"""


def _haversine_km(points: list[tuple[float, float]]) -> float:
    total = 0.0
    for (la1, lo1), (la2, lo2) in zip(points, points[1:]):
        p1, p2 = math.radians(la1), math.radians(la2)
        dp, dl = p2 - p1, math.radians(lo2 - lo1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        total += 6371 * 2 * math.asin(math.sqrt(a))
    return round(total, 2)


def _fmt_when(iso: str) -> str:
    return datetime.fromisoformat(iso.replace("Z", "+00:00")).strftime("%a %b %d, %I:%M %p")


@router.get("/test-drives")
def list_test_drives(db: DB, user: StaffUser, start: str | None = None, end: str | None = None):
    where, params = [], []
    if start:
        where.append("t.scheduled_at >= ?"); params.append(start)
    if end:
        where.append("t.scheduled_at < ?"); params.append(end)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return decode_rows(fetch_all(db, f"{TD_SELECT} {clause} ORDER BY t.scheduled_at", params), "route")


@router.post("/test-drives", status_code=201)
def create_test_drive(body: TestDriveIn, request: Request, db: DB, user: SalesUser):
    # Conflict detection: same vehicle overlapping window
    clash = fetch_one(db, """SELECT id FROM test_drives WHERE vehicle_id = ? AND status IN ('requested','confirmed')
                             AND abs(julianday(scheduled_at) - julianday(?)) * 1440 < ?""",
                      (body.vehicle_id, body.scheduled_at, body.duration_min))
    if clash:
        raise HTTPException(409, "This vehicle already has a test drive in that time slot")
    with transaction(db):
        tid = insert(db, "test_drives", {**body.model_dump(exclude={"notify"}), "sales_rep_id": body.sales_rep_id or user["id"]})
        td = fetch_one(db, TD_SELECT + " WHERE t.id = ?", (tid,))
        activity(db, type="test_drive", customer_id=body.customer_id, lead_id=body.lead_id, user_id=user["id"],
                 summary=f"Test drive scheduled: {td['vehicle_title']} on {_fmt_when(body.scheduled_at)}")
        if body.lead_id:
            db.execute("UPDATE leads SET stage = 'test_drive', last_activity_at = ? WHERE id = ? AND stage IN ('new','contacted','qualified')",
                       (now_iso(), body.lead_id))
        audit(db, user, "create", "test_drive", tid, ip=client_ip(request))
    if body.notify and body.status == "confirmed":
        cust = fetch_one(db, "SELECT preferred_channel FROM customers WHERE id = ?", (body.customer_id,))
        messaging.send(db, customer_id=body.customer_id, channel="whatsapp" if cust["preferred_channel"] == "whatsapp" else "email",
                       template="test_drive_confirmation", user=user, lead_id=body.lead_id, automated=True,
                       context={"vehicle": td["vehicle_title"], "when": _fmt_when(body.scheduled_at)})
    td = decode_json(fetch_one(db, TD_SELECT + " WHERE t.id = ?", (tid,)), "route")
    publish("test_drive.created", td)
    return td


@router.patch("/test-drives/{td_id}")
def patch_test_drive(td_id: int, body: TestDrivePatch, db: DB, user: StaffUser):
    before = fetch_one(db, TD_SELECT + " WHERE t.id = ?", (td_id,))
    if not before:
        raise HTTPException(404, "Test drive not found")
    changes = body.model_dump(exclude_unset=True)
    update(db, "test_drives", td_id, changes, touch=False)
    if "status" in changes and changes["status"] != before["status"]:
        activity(db, type="test_drive", customer_id=before["customer_id"], lead_id=before["lead_id"], user_id=user["id"],
                 summary=f"Test drive {changes['status'].replace('_', ' ')}: {before['vehicle_title']}")
    td = decode_json(fetch_one(db, TD_SELECT + " WHERE t.id = ?", (td_id,)), "route")
    publish("test_drive.updated", td)
    return td


@router.post("/test-drives/{td_id}/route")
def log_route(td_id: int, body: RouteIn, db: DB, user: StaffUser):
    """GPS trace logging (from a phone/telematics device) — distance computed via haversine."""
    distance = _haversine_km(body.points)
    db.execute("UPDATE test_drives SET route = ?, distance_km = ? WHERE id = ?",
               (json.dumps(body.points), distance, td_id))
    return {"distance_km": distance, "points": len(body.points)}


# =============================================================================
# Deals / desking
# =============================================================================
class LineItem(BaseModel):
    label: str
    amount: int
    taxable: bool = True


class DealIn(BaseModel):
    customer_id: int
    vehicle_id: int
    lead_id: int | None = None
    discount: int = 0
    trade_in_value: int = 0
    trade_in_payoff: int = 0
    trade_in_desc: str | None = None
    tax_rate: float | None = None
    fees: list[LineItem] | None = None
    accessories: list[LineItem] = []
    deposit: int = 0
    notes: str | None = None


class DealPatch(BaseModel):
    vehicle_price: int | None = None
    discount: int | None = None
    trade_in_value: int | None = None
    trade_in_payoff: int | None = None
    trade_in_desc: str | None = None
    tax_rate: float | None = Field(None, ge=0, le=0.3)
    fees: list[LineItem] | None = None
    accessories: list[LineItem] | None = None
    deposit: int | None = None
    notes: str | None = None


class DealStatusIn(BaseModel):
    status: Literal["draft", "quoted", "accepted", "invoiced", "delivered", "cancelled"]
    send_to_customer: bool = False


DEAL_SELECT = """
    SELECT d.*, c.first_name || ' ' || c.last_name AS customer_name, c.email AS customer_email, c.phone AS customer_phone,
           c.address AS customer_address, c.city AS customer_city,
           v.year, v.make, v.model, v.trim, v.vin, v.stock_number, v.mileage, v.exterior_color, v.condition, v.cost AS vehicle_cost,
           (SELECT url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY sort_order LIMIT 1) AS vehicle_photo,
           u.full_name AS rep_name
    FROM deals d JOIN customers c ON c.id = d.customer_id JOIN vehicles v ON v.id = d.vehicle_id
    LEFT JOIN users u ON u.id = d.sales_rep_id
"""


def _deal(db, deal_id: int) -> dict:
    d = decode_json(fetch_one(db, DEAL_SELECT + " WHERE d.id = ?", (deal_id,)), "fees", "accessories")
    if not d:
        raise HTTPException(404, "Deal not found")
    d["breakdown"] = pricing.calculate(vehicle_price=d["vehicle_price"], discount=d["discount"],
                                       trade_in_value=d["trade_in_value"], trade_in_payoff=d["trade_in_payoff"],
                                       tax_rate=d["tax_rate"], fees=d["fees"], accessories=d["accessories"],
                                       deposit=d["deposit"], vehicle_cost=d["vehicle_cost"])
    d["dealer"] = {"name": settings.dealer_name, "address": settings.dealer_address, "phone": settings.dealer_phone}
    return d


def _recalc(db, deal_id: int) -> None:
    d = decode_json(fetch_one(db, "SELECT d.*, v.cost FROM deals d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.id = ?",
                              (deal_id,)), "fees", "accessories")
    b = pricing.calculate(vehicle_price=d["vehicle_price"], discount=d["discount"], trade_in_value=d["trade_in_value"],
                          trade_in_payoff=d["trade_in_payoff"], tax_rate=d["tax_rate"], fees=d["fees"],
                          accessories=d["accessories"], deposit=d["deposit"], vehicle_cost=d["cost"])
    update(db, "deals", deal_id, {"subtotal": b["subtotal"], "tax_total": b["tax_total"], "total_otd": b["total_otd"],
                                  "gross_profit": b["gross_profit"]})


@router.post("/deals/calculate")
def calculate_preview(body: DealPatch, user: SalesUser):
    """Stateless calculator used by the desking UI for live recalculation."""
    return pricing.calculate(vehicle_price=body.vehicle_price or 0, discount=body.discount or 0,
                             trade_in_value=body.trade_in_value or 0, trade_in_payoff=body.trade_in_payoff or 0,
                             tax_rate=body.tax_rate if body.tax_rate is not None else settings.default_tax_rate,
                             fees=[f.model_dump() for f in body.fees or []],
                             accessories=[a.model_dump() for a in body.accessories or []], deposit=body.deposit or 0)


@router.get("/deals")
def list_deals(db: DB, user: SalesUser, status: str | None = None):
    where, params = [], []
    if status:
        where.append("d.status = ?"); params.append(status)
    if user["role"] == "sales":
        where.append("d.sales_rep_id = ?"); params.append(user["id"])
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return fetch_all(db, f"""SELECT d.id, d.deal_number, d.status, d.total_otd, d.gross_profit, d.created_at, d.updated_at,
                             d.delivered_at, c.first_name || ' ' || c.last_name AS customer_name,
                             v.year || ' ' || v.make || ' ' || v.model AS vehicle_title, u.full_name AS rep_name
                             FROM deals d JOIN customers c ON c.id = d.customer_id JOIN vehicles v ON v.id = d.vehicle_id
                             LEFT JOIN users u ON u.id = d.sales_rep_id {clause} ORDER BY d.updated_at DESC LIMIT 300""", params)


@router.get("/deals/{deal_id}")
def get_deal(deal_id: int, db: DB, user: SalesUser):
    return _deal(db, deal_id)


@router.post("/deals", status_code=201)
def create_deal(body: DealIn, request: Request, db: DB, user: SalesUser):
    v = fetch_one(db, "SELECT id, price, status, year, make, model FROM vehicles WHERE id = ?", (body.vehicle_id,))
    if not v:
        raise HTTPException(404, "Vehicle not found")
    if v["status"] == "sold":
        raise HTTPException(409, "Vehicle is already sold")
    with transaction(db):
        seq = db.execute("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM deals").fetchone()["n"]
        did = insert(db, "deals", {
            **body.model_dump(exclude={"fees", "accessories", "tax_rate"}),
            "deal_number": f"D-{datetime.now():%y%m}-{seq:04d}",
            "sales_rep_id": user["id"], "vehicle_price": v["price"],
            "tax_rate": body.tax_rate if body.tax_rate is not None else settings.default_tax_rate,
            "fees": [f.model_dump() for f in body.fees] if body.fees is not None else pricing.DEFAULT_FEES,
            "accessories": [a.model_dump() for a in body.accessories],
        })
        _recalc(db, did)
        activity(db, type="deal", customer_id=body.customer_id, lead_id=body.lead_id, user_id=user["id"],
                 summary=f"Deal opened for {v['year']} {v['make']} {v['model']}")
        audit(db, user, "create", "deal", did, ip=client_ip(request))
    return _deal(db, did)


@router.patch("/deals/{deal_id}")
def patch_deal(deal_id: int, body: DealPatch, db: DB, user: SalesUser):
    d = fetch_one(db, "SELECT status FROM deals WHERE id = ?", (deal_id,))
    if not d:
        raise HTTPException(404, "Deal not found")
    if d["status"] in ("invoiced", "delivered"):
        raise HTTPException(409, "Invoiced deals are locked")
    changes = body.model_dump(exclude_unset=True)
    for k in ("fees", "accessories"):
        if k in changes and changes[k] is not None:
            changes[k] = [dict(x) for x in changes[k]]
    with transaction(db):
        update(db, "deals", deal_id, changes)
        _recalc(db, deal_id)
    return _deal(db, deal_id)


@router.post("/deals/{deal_id}/status")
def set_deal_status(deal_id: int, body: DealStatusIn, request: Request, db: DB, user: SalesUser):
    d = _deal(db, deal_id)
    ts = now_iso()
    stamp = {"quoted": "quoted_at", "invoiced": "invoiced_at", "delivered": "delivered_at"}.get(body.status)
    with transaction(db):
        update(db, "deals", deal_id, {"status": body.status, **({stamp: ts} if stamp else {})})
        # Inventory state follows the deal lifecycle
        if body.status in ("accepted", "invoiced"):
            db.execute("UPDATE vehicles SET status = 'reserved', updated_at = ? WHERE id = ? AND status != 'sold'", (ts, d["vehicle_id"]))
        elif body.status == "delivered":
            db.execute("UPDATE vehicles SET status = 'sold', sold_at = ?, updated_at = ? WHERE id = ?", (ts, ts, d["vehicle_id"]))
            db.execute("UPDATE customers SET lifetime_value = lifetime_value + ? WHERE id = ?", (d["total_otd"], d["customer_id"]))
            if d["lead_id"]:
                db.execute("UPDATE leads SET stage = 'won', updated_at = ? WHERE id = ?", (ts, d["lead_id"]))
        elif body.status == "cancelled":
            db.execute("UPDATE vehicles SET status = 'in_stock', updated_at = ? WHERE id = ? AND status = 'reserved'", (ts, d["vehicle_id"]))
        elif body.status == "quoted" and d["lead_id"]:
            db.execute("UPDATE leads SET stage = 'negotiation', updated_at = ? WHERE id = ? AND stage NOT IN ('won','lost')", (ts, d["lead_id"]))
        activity(db, type="deal", customer_id=d["customer_id"], lead_id=d["lead_id"], user_id=user["id"],
                 summary=f"Deal {d['deal_number']} → {body.status}")
        audit(db, user, "status", "deal", deal_id, {"to": body.status}, client_ip(request))
    if body.send_to_customer and body.status == "quoted":
        messaging.send(db, customer_id=d["customer_id"], channel="email", template="quote_ready", user=user,
                       lead_id=d["lead_id"], context={"vehicle": f"{d['year']} {d['make']} {d['model']}",
                                                      "deal_number": d["deal_number"],
                                                      "total": f"${d['total_otd'] / 100:,.2f}"})
    publish("deal.status", {"id": deal_id, "status": body.status, "deal_number": d["deal_number"],
                            "total": d["total_otd"], "by": user["full_name"]})
    return _deal(db, deal_id)
