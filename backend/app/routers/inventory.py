from __future__ import annotations

import secrets
import time
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

from ..config import settings
from ..db import decode_json, fetch_all, fetch_one, insert, now_iso, transaction, update
from ..security import DB, STAFF, SalesUser, StaffUser, client_ip, get_optional_user
from ..services.events import audit, publish
from ..services.vin_decoder import VinError, decode_vin

router = APIRouter(prefix="/inventory", tags=["inventory"])

Condition = Literal["new", "used", "certified"]
Status = Literal["in_stock", "reserved", "sold", "in_service", "incoming"]
SORTS = {
    "newest": "v.acquired_at DESC",
    "price_asc": "v.price ASC",
    "price_desc": "v.price DESC",
    "year_desc": "v.year DESC, v.price DESC",
    "mileage_asc": "v.mileage ASC",
    "aging": "v.acquired_at ASC",
}
PUBLIC_HIDDEN = ("cost", "vin_decoded")

LIST_COLUMNS = """
    v.id, v.vin, v.stock_number, v.condition, v.status, v.year, v.make, v.model, v.trim, v.body_style,
    v.transmission, v.fuel_type, v.drivetrain, v.engine, v.horsepower, v.exterior_color, v.interior_color,
    v.mileage, v.condition_grade, v.price, v.msrp, v.cost, v.is_featured, v.is_published, v.acquired_at, v.sold_at,
    CAST(julianday('now') - julianday(v.acquired_at) AS INTEGER) AS days_in_stock,
    (SELECT url FROM vehicle_photos p WHERE p.vehicle_id = v.id ORDER BY sort_order LIMIT 1) AS photo,
    (SELECT COUNT(*) FROM vehicle_photos p WHERE p.vehicle_id = v.id) AS photo_count
"""


class VehicleIn(BaseModel):
    vin: str = Field(min_length=17, max_length=17)
    stock_number: str | None = None
    condition: Condition
    status: Status = "in_stock"
    year: int = Field(ge=1950, le=2100)
    make: str
    model: str
    trim: str | None = None
    body_style: str
    transmission: str
    fuel_type: str
    drivetrain: str | None = None
    engine: str | None = None
    horsepower: int | None = None
    doors: int | None = None
    seats: int | None = None
    exterior_color: str | None = None
    interior_color: str | None = None
    mileage: int = Field(ge=0, default=0)
    condition_grade: str | None = None
    price: int = Field(gt=0, description="cents")
    msrp: int | None = None
    cost: int | None = None
    features: list[str] = []
    description: str | None = None
    is_featured: bool = False
    is_published: bool = True
    vin_decoded: dict | None = None


class VehiclePatch(BaseModel):
    status: Status | None = None
    price: int | None = Field(default=None, gt=0)
    msrp: int | None = None
    cost: int | None = None
    mileage: int | None = None
    trim: str | None = None
    exterior_color: str | None = None
    interior_color: str | None = None
    condition_grade: str | None = None
    features: list[str] | None = None
    description: str | None = None
    is_featured: bool | None = None
    is_published: bool | None = None


def _is_staff(user: dict | None) -> bool:
    return bool(user and user["role"] in STAFF)


def _scrub(row: dict, staff: bool) -> dict:
    if not staff:
        for k in PUBLIC_HIDDEN:
            row.pop(k, None)
    return row


@router.get("")
def list_inventory(
    db: DB,
    user: Annotated[dict | None, Depends(get_optional_user)],
    q: str | None = None,
    condition: Annotated[list[Condition] | None, Query()] = None,
    status: Annotated[list[Status] | None, Query()] = None,
    make: Annotated[list[str] | None, Query()] = None,
    body_style: Annotated[list[str] | None, Query()] = None,
    fuel_type: Annotated[list[str] | None, Query()] = None,
    transmission: Annotated[list[str] | None, Query()] = None,
    model: str | None = None,
    year_min: int | None = None,
    year_max: int | None = None,
    price_min: int | None = None,
    price_max: int | None = None,
    mileage_max: int | None = None,
    sort: str = "newest",
    limit: int = Query(500, le=1000),
    offset: int = 0,
):
    """Indexed, fully parameterised inventory search. Returns `took_ms` for SLA monitoring."""
    t0 = time.perf_counter()
    staff = _is_staff(user)
    where, params = [], []
    if not staff:
        where.append("v.is_published = 1 AND v.status IN ('in_stock','reserved','incoming')")

    def _in(col: str, values: list | None) -> None:
        if values:
            where.append(f"{col} IN ({','.join('?' * len(values))})")
            params.extend(values)

    _in("v.condition", condition); _in("v.status", status); _in("v.make", make)
    _in("v.body_style", body_style); _in("v.fuel_type", fuel_type); _in("v.transmission", transmission)
    for col, op, val in (("v.year", ">=", year_min), ("v.year", "<=", year_max), ("v.price", ">=", price_min),
                         ("v.price", "<=", price_max), ("v.mileage", "<=", mileage_max)):
        if val is not None:
            where.append(f"{col} {op} ?"); params.append(val)
    if model:
        where.append("v.model = ?"); params.append(model)
    if q:
        like = f"%{q.strip()}%"
        where.append("(v.make LIKE ? OR v.model LIKE ? OR v.trim LIKE ? OR v.vin LIKE ? OR v.stock_number LIKE ?"
                     " OR (v.year || ' ' || v.make || ' ' || v.model) LIKE ?)")
        params.extend([like] * 6)

    clause = f"WHERE {' AND '.join(where)}" if where else ""
    total = db.execute(f"SELECT COUNT(*) AS n FROM vehicles v {clause}", params).fetchone()["n"]
    rows = fetch_all(db, f"SELECT {LIST_COLUMNS} FROM vehicles v {clause} "
                         f"ORDER BY {SORTS.get(sort, SORTS['newest'])} LIMIT ? OFFSET ?", [*params, limit, offset])
    return {
        "items": [_scrub(r, staff) for r in rows],
        "total": total,
        "took_ms": round((time.perf_counter() - t0) * 1000, 2),
    }


@router.get("/facets")
def facets(db: DB, user: Annotated[dict | None, Depends(get_optional_user)]):
    scope = "" if _is_staff(user) else "WHERE is_published = 1 AND status IN ('in_stock','reserved','incoming')"
    out: dict = {}
    for col in ("make", "body_style", "fuel_type", "transmission", "condition", "status", "drivetrain"):
        out[col] = fetch_all(db, f"SELECT {col} AS value, COUNT(*) AS count FROM vehicles {scope} "
                                 f"GROUP BY {col} ORDER BY count DESC")
    out["models"] = fetch_all(db, f"SELECT make, model, COUNT(*) AS count FROM vehicles {scope} GROUP BY make, model")
    out["ranges"] = fetch_one(db, f"SELECT MIN(price) AS price_min, MAX(price) AS price_max, MIN(year) AS year_min, "
                                  f"MAX(year) AS year_max, MAX(mileage) AS mileage_max FROM vehicles {scope}")
    return out


@router.post("/vin/decode")
def vin_decode(payload: dict, db: DB, user: StaffUser):
    try:
        result = decode_vin(db, str(payload.get("vin", "")))
    except VinError as exc:
        raise HTTPException(422, str(exc))
    existing = fetch_one(db, "SELECT id, stock_number FROM vehicles WHERE vin = ?", (result["vin"],))
    result["existing_vehicle"] = existing
    return result


@router.get("/{vehicle_id}")
def get_vehicle(vehicle_id: int, db: DB, user: Annotated[dict | None, Depends(get_optional_user)]):
    staff = _is_staff(user)
    v = fetch_one(db, f"SELECT {LIST_COLUMNS}, v.doors, v.seats, v.features, v.description, v.vin_decoded "
                      "FROM vehicles v WHERE v.id = ?", (vehicle_id,))
    if not v or (not staff and (not v["is_published"] or v["status"] == "sold")):
        raise HTTPException(404, "Vehicle not found")
    decode_json(v, "features", "vin_decoded")
    v["photos"] = fetch_all(db, "SELECT id, url, caption FROM vehicle_photos WHERE vehicle_id = ? ORDER BY sort_order",
                            (vehicle_id,))
    if staff:
        v["leads"] = fetch_all(db, """SELECT l.id, l.stage, c.first_name || ' ' || c.last_name AS customer
                                      FROM leads l JOIN customers c ON c.id = l.customer_id
                                      WHERE l.vehicle_id = ? AND l.stage NOT IN ('won','lost')""", (vehicle_id,))
        v["upcoming_test_drives"] = fetch_all(db, """SELECT id, scheduled_at, status FROM test_drives
                                      WHERE vehicle_id = ? AND scheduled_at >= strftime('%Y-%m-%dT%H:%M:%SZ','now')
                                      AND status IN ('requested','confirmed') ORDER BY scheduled_at""", (vehicle_id,))
        v["service_history"] = fetch_all(db, "SELECT id, ro_number, status, complaint, scheduled_at FROM service_jobs "
                                             "WHERE vehicle_id = ? ORDER BY scheduled_at DESC", (vehicle_id,))
    return _scrub(v, staff)


@router.post("", status_code=201)
def create_vehicle(body: VehicleIn, request: Request, db: DB, user: SalesUser):
    data = body.model_dump()
    data["vin"] = data["vin"].upper()
    if fetch_one(db, "SELECT id FROM vehicles WHERE vin = ?", (data["vin"],)):
        raise HTTPException(409, "A vehicle with this VIN already exists")
    if not data.get("stock_number"):
        prefix = "N" if body.condition == "new" else "U"
        data["stock_number"] = f"{prefix}{data['vin'][-6:]}"
    with transaction(db):
        vid = insert(db, "vehicles", data)
        audit(db, user, "create", "vehicle", vid, {"vin": data["vin"]}, client_ip(request))
    publish("inventory.created", {"id": vid, "title": f"{body.year} {body.make} {body.model}"})
    return get_vehicle(vid, db, user)


@router.patch("/{vehicle_id}")
def patch_vehicle(vehicle_id: int, body: VehiclePatch, request: Request, db: DB, user: StaffUser):
    before = fetch_one(db, "SELECT id, status, price FROM vehicles WHERE id = ?", (vehicle_id,))
    if not before:
        raise HTTPException(404, "Vehicle not found")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("status") == "sold" and before["status"] != "sold":
        changes["sold_at"] = now_iso()
    with transaction(db):
        update(db, "vehicles", vehicle_id, changes)
        audit(db, user, "update", "vehicle", vehicle_id, {"before": before, "changes": changes}, client_ip(request))
    publish("inventory.updated", {"id": vehicle_id, **{k: v for k, v in changes.items() if k in ("status", "price")}},
            roles=("admin", "sales", "service", "customer"))
    return get_vehicle(vehicle_id, db, user)


@router.delete("/{vehicle_id}", status_code=204)
def delete_vehicle(vehicle_id: int, request: Request, db: DB, user: SalesUser):
    if fetch_one(db, "SELECT id FROM deals WHERE vehicle_id = ? AND status != 'cancelled'", (vehicle_id,)):
        raise HTTPException(409, "Vehicle has active deals — mark as sold or cancel the deal first")
    with transaction(db):
        db.execute("DELETE FROM vehicles WHERE id = ?", (vehicle_id,))
        audit(db, user, "delete", "vehicle", vehicle_id, ip=client_ip(request))
    publish("inventory.deleted", {"id": vehicle_id})


ALLOWED_IMAGE = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


@router.post("/{vehicle_id}/photos", status_code=201)
async def upload_photos(vehicle_id: int, db: DB, user: StaffUser, files: list[UploadFile] = File(...)):
    if not fetch_one(db, "SELECT id FROM vehicles WHERE id = ?", (vehicle_id,)):
        raise HTTPException(404, "Vehicle not found")
    target = Path(settings.media_dir) / "vehicles" / str(vehicle_id)
    target.mkdir(parents=True, exist_ok=True)
    start = db.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM vehicle_photos WHERE vehicle_id = ?",
                       (vehicle_id,)).fetchone()["n"]
    saved = []
    for i, f in enumerate(files):
        ext = ALLOWED_IMAGE.get(f.content_type or "")
        if not ext:
            raise HTTPException(415, f"Unsupported image type: {f.content_type}")
        data = await f.read()
        if len(data) > 15 * 1024 * 1024:
            raise HTTPException(413, "Images must be under 15MB")
        name = f"{secrets.token_hex(8)}{ext}"
        (target / name).write_bytes(data)
        url = f"/media/vehicles/{vehicle_id}/{name}"
        saved.append({"id": insert(db, "vehicle_photos", {"vehicle_id": vehicle_id, "url": url, "sort_order": start + i}),
                      "url": url})
    return saved


@router.delete("/{vehicle_id}/photos/{photo_id}", status_code=204)
def delete_photo(vehicle_id: int, photo_id: int, db: DB, user: StaffUser):
    db.execute("DELETE FROM vehicle_photos WHERE id = ? AND vehicle_id = ?", (photo_id, vehicle_id))
