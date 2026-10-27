"""End-to-end API smoke test against a running server.

Usage:  python scripts/smoke_test.py [base_url]     (default http://127.0.0.1:8000/api)
Exercises every router with each role and prints a pass/fail table. Mutates data —
run against a freshly seeded dev database.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8000/api"
results: list[tuple[str, str, int, bool, str]] = []


def call(method: str, path: str, token: str | None = None, body=None, expect=(200, 201, 202, 204), headers=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {}),
                                          **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            code, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, raw = e.code, e.read()
    try:
        data = json.loads(raw) if raw else None
    except json.JSONDecodeError:
        data = raw.decode(errors="replace")
    ok = code in (expect if isinstance(expect, tuple) else (expect,))
    results.append((method, path, code, ok, "" if ok else str(data)[:200]))
    return data


def login(email, pw):
    return call("POST", "/auth/login", body={"email": email, "password": pw})["access_token"]


def main():
    call("GET", "/health")
    admin, sales, svc, cust = (login("admin@meridian.demo", "meridian123"), login("sarah@meridian.demo", "meridian123"),
                               login("diego@meridian.demo", "meridian123"), login("customer@meridian.demo", "customer123"))
    call("POST", "/auth/login", body={"email": "admin@meridian.demo", "password": "nope"}, expect=401)
    call("GET", "/auth/me", admin)

    # Inventory (public + staff)
    pub = call("GET", "/inventory?sort=price_asc&limit=5")
    assert all("cost" not in v for v in pub["items"]), "cost leaked to public"
    call("GET", "/inventory?condition=new&make=Toyota&price_max=5000000", admin)
    call("GET", "/inventory/facets")
    vid = pub["items"][0]["id"]
    call("GET", f"/inventory/{vid}")
    call("GET", f"/inventory/{vid}", admin)
    call("POST", "/inventory/vin/decode", admin, {"vin": "1HGCM82633A004352"})
    call("POST", "/inventory/vin/decode", admin, {"vin": "bad"}, expect=422)
    new_v = call("POST", "/inventory", sales, {"vin": "1HGCM82633A004352", "condition": "used", "year": 2003, "make": "Honda",
                                                "model": "Accord", "body_style": "sedan", "transmission": "automatic",
                                                "fuel_type": "gasoline", "price": 650000, "mileage": 140000})
    call("PATCH", f"/inventory/{new_v['id']}", admin, {"price": 620000, "status": "reserved"})
    call("POST", "/inventory", cust, {}, expect=(403, 422))

    # CRM
    customers = call("GET", "/customers?q=a", sales)
    cid = customers[0]["id"]
    call("GET", f"/customers/{cid}", sales)
    nc = call("POST", "/customers", sales, {"first_name": "Smoke", "last_name": "Test", "email": "smoke@test.dev",
                                             "consents": {"data_processing": True, "email": True}})
    call("PATCH", f"/customers/{nc['id']}", sales, {"city": "Austin"})
    call("POST", f"/customers/{nc['id']}/consents", sales, {"channel": "whatsapp", "granted": True})
    call("POST", f"/customers/{nc['id']}/activities", sales, {"summary": "Called", "type": "call"})
    leads = call("GET", "/leads", admin)
    lead = call("POST", "/leads", sales, {"customer_id": nc["id"], "vehicle_id": vid, "source": "website"})
    call("POST", f"/leads/{lead['id']}/move", sales, {"stage": "contacted"})
    call("PATCH", f"/leads/{lead['id']}", sales, {"score": 80})
    tasks = call("GET", "/tasks?scope=all", admin)
    t = call("POST", "/tasks", sales, {"title": "Smoke task", "due_at": datetime.now(timezone.utc).isoformat()})
    call("POST", f"/tasks/{t['id']}/complete", sales)
    call("POST", "/automation/run", admin)

    # Sales
    when = (datetime.now(timezone.utc) + timedelta(days=9)).strftime("%Y-%m-%dT15:00:00Z")
    call("GET", "/test-drives", sales)
    td = call("POST", "/test-drives", sales, {"customer_id": nc["id"], "vehicle_id": vid, "lead_id": lead["id"], "scheduled_at": when})
    call("POST", "/test-drives", sales, {"customer_id": nc["id"], "vehicle_id": vid, "scheduled_at": when}, expect=409)
    call("PATCH", f"/test-drives/{td['id']}", sales, {"status": "completed", "feedback": "great"})
    call("POST", f"/test-drives/{td['id']}/route", sales, {"points": [[30.24, -97.78], [30.25, -97.77], [30.26, -97.76]]})
    call("POST", "/deals/calculate", sales, {"vehicle_price": 3000000, "discount": 100000, "fees": [{"label": "Doc", "amount": 15000}]})
    call("GET", "/deals", admin)
    deal = call("POST", "/deals", sales, {"customer_id": nc["id"], "vehicle_id": vid, "lead_id": lead["id"]})
    call("GET", f"/deals/{deal['id']}", sales)
    call("PATCH", f"/deals/{deal['id']}", sales, {"discount": 50000, "accessories": [{"label": "Mats", "amount": 20000}]})
    for s in ("quoted", "accepted", "invoiced", "delivered"):
        call("POST", f"/deals/{deal['id']}/status", sales, {"status": s, "send_to_customer": s == "quoted"})
    call("PATCH", f"/deals/{deal['id']}", sales, {"discount": 1}, expect=409)

    # Service
    jobs = call("GET", "/service/jobs", svc)
    parts = call("GET", "/parts", svc)
    call("GET", "/parts?low_stock=true", svc)
    job = call("POST", "/service/jobs", svc, {"customer_id": nc["id"], "customer_vehicle": "2015 Mazda 3", "complaint": "Noise from rear",
                                               "scheduled_at": when})
    stocked = next(p for p in parts if p["available"] > 0)
    job = call("POST", f"/service/jobs/{job['id']}/parts", svc, {"part_id": stocked["id"], "quantity": 1})
    call("DELETE", f"/service/jobs/{job['id']}/parts/{job['parts'][0]['id']}", svc)
    call("PATCH", f"/service/jobs/{job['id']}", svc, {"status": "in_progress", "labor_hours": 1.5, "notify_customer": True})
    call("PATCH", f"/service/jobs/{job['id']}", svc, {"status": "closed"})
    call("GET", f"/service/jobs/{job['id']}", svc)
    p = call("POST", "/parts", svc, {"sku": "SMOKE-1", "name": "Smoke part", "category": "Test", "unit_cost": 100, "unit_price": 200})
    call("POST", f"/parts/{p['id']}/adjust", svc, {"delta": 5})
    call("GET", "/leads", svc, expect=403)

    # Comms
    call("GET", "/communications", sales)
    call("GET", "/communications/threads", sales)
    call("GET", "/communications/templates", sales)
    call("POST", "/communications/preview", sales, {"customer_id": nc["id"], "channel": "email", "template": "lead_followup"})
    call("POST", "/communications/send", sales, {"customer_id": nc["id"], "channel": "email", "subject": "Hi", "body": "Hello!"})
    call("POST", "/internal/communications/inbound", None, {"from_number": "+1 512 555 0198", "body": "Hi there"},
         headers={"X-Internal-Key": "dev-internal-key"})
    call("POST", "/internal/communications/inbound", None, {"from_number": "+1", "body": "x"}, expect=403)

    # Admin
    call("GET", "/dashboard", admin)
    call("GET", "/dashboard", sales)
    call("GET", "/users", admin)
    u = call("POST", "/users", admin, {"email": "smoke.user@meridian.demo", "full_name": "Smoke User", "role": "sales", "password": "password123"})
    call("PATCH", f"/users/{u['id']}", admin, {"is_active": False})
    call("GET", "/audit-logs", admin)
    call("GET", "/audit-logs", sales, expect=403)
    call("GET", "/gdpr/requests", admin)
    call("GET", f"/customers/{nc['id']}/export", admin)
    call("GET", "/settings/dealer", sales)

    # Portal
    call("GET", "/portal/dealer")
    call("GET", "/portal/me", cust)
    call("PATCH", "/portal/me", cust, {"city": "Austin"})
    call("GET", "/portal/favorites", cust)
    call("POST", f"/portal/favorites/{pub['items'][1]['id']}", cust)
    vid2 = pub["items"][1]["id"]
    b = call("POST", "/portal/test-drives", cust, {"vehicle_id": vid2, "scheduled_at": when, "message": "Saturday?"})
    call("GET", "/portal/test-drives", cust)
    call("POST", f"/portal/test-drives/{b['id']}/cancel", cust)
    call("GET", "/portal/garage", cust)
    call("POST", "/portal/consents", cust, {"channel": "marketing", "granted": False})
    call("GET", "/portal/privacy/export", cust)
    call("GET", "/portal/me", sales, expect=403)
    reg = call("POST", "/auth/register", body={"email": "new.customer@test.dev", "password": "password123", "first_name": "New",
                                               "last_name": "Customer", "consent_whatsapp": True})
    call("POST", "/portal/privacy/erasure", reg["access_token"], {"reason": "test"})
    call("POST", "/portal/privacy/erasure", reg["access_token"], {"reason": "test"}, expect=409)
    gdpr = call("GET", "/gdpr/requests", admin)
    pending = next(g for g in gdpr if g["status"] == "pending" and g["customer_email"] == "new.customer@test.dev")
    call("POST", f"/gdpr/requests/{pending['id']}", admin, {"action": "complete"})
    call("POST", "/auth/login", body={"email": "new.customer@test.dev", "password": "password123"}, expect=401)

    call("DELETE", f"/inventory/{new_v['id']}", sales)

    failed = [r for r in results if not r[3]]
    for m, pth, code, ok, err in results:
        print(f"{'PASS' if ok else 'FAIL'} {code} {m:6} {pth} {err}")
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        for m, pth, code, ok, err in results:
            print(f"{'PASS' if ok else 'FAIL'} {code} {m:6} {pth} {err}")
        raise
