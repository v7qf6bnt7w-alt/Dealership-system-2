from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..db import fetch_all, fetch_one, insert
from ..security import DB, StaffUser, require_internal
from ..services import messaging
from ..services.events import activity, publish

router = APIRouter(tags=["communications"])


class SendIn(BaseModel):
    customer_id: int
    channel: Literal["whatsapp", "email"]
    template: str | None = None
    subject: str | None = None
    body: str | None = Field(None, max_length=4096)
    lead_id: int | None = None
    context: dict = {}


@router.get("/communications")
def list_comms(db: DB, user: StaffUser, channel: str | None = None, customer_id: int | None = None, limit: int = 200):
    where, params = [], []
    if channel:
        where.append("m.channel = ?"); params.append(channel)
    if customer_id:
        where.append("m.customer_id = ?"); params.append(customer_id)
    clause = f"WHERE {' AND '.join(where)}" if where else ""
    return fetch_all(db, f"""SELECT m.*, c.first_name || ' ' || c.last_name AS customer_name, u.full_name AS user_name
                             FROM communications m LEFT JOIN customers c ON c.id = m.customer_id
                             LEFT JOIN users u ON u.id = m.user_id {clause} ORDER BY m.created_at DESC LIMIT ?""",
                     [*params, limit])


@router.get("/communications/threads")
def threads(db: DB, user: StaffUser):
    """Inbox view: one row per customer, latest message first."""
    return fetch_all(db, """
        SELECT c.id AS customer_id, c.first_name || ' ' || c.last_name AS customer_name, c.preferred_channel,
               m.channel, m.body AS last_body, m.direction AS last_direction, m.created_at AS last_at, m.status AS last_status,
               (SELECT COUNT(*) FROM communications x WHERE x.customer_id = c.id AND x.direction = 'inbound'
                  AND x.created_at > COALESCE((SELECT MAX(created_at) FROM communications y WHERE y.customer_id = c.id
                  AND y.direction = 'outbound'), '')) AS unread
        FROM communications m JOIN customers c ON c.id = m.customer_id
        WHERE m.id = (SELECT id FROM communications z WHERE z.customer_id = m.customer_id ORDER BY created_at DESC, id DESC LIMIT 1)
        ORDER BY m.created_at DESC LIMIT 200""")


@router.get("/communications/templates")
def templates(user: StaffUser):
    return [{"key": k, "label": v["label"], "subject": v["subject"], "whatsapp": v["whatsapp"]} for k, v in messaging.TEMPLATES.items()]


@router.post("/communications/preview")
def preview(body: SendIn, db: DB, user: StaffUser):
    c = fetch_one(db, "SELECT first_name FROM customers WHERE id = ?", (body.customer_id,))
    if not body.template:
        raise HTTPException(422, "template required")
    return messaging.render(body.template, body.channel, {"first_name": c["first_name"] if c else "there",
                                                          "agent": user["full_name"], **body.context})


@router.post("/communications/send", status_code=201)
def send(body: SendIn, db: DB, user: StaffUser):
    try:
        return messaging.send(db, customer_id=body.customer_id, channel=body.channel, template=body.template,
                              subject=body.subject, body=body.body, context=body.context, user=user, lead_id=body.lead_id)
    except ValueError as exc:
        raise HTTPException(422, str(exc))


# ---------------------------------------------------------------------------
# Internal callbacks from the Node realtime/WhatsApp service
# ---------------------------------------------------------------------------
class InboundIn(BaseModel):
    from_number: str
    body: str
    provider_ref: str | None = None
    channel: Literal["whatsapp", "sms"] = "whatsapp"


class StatusIn(BaseModel):
    communication_id: int | None = None
    provider_ref: str | None = None
    status: Literal["sent", "delivered", "read", "failed", "simulated"]
    error: str | None = None


@router.post("/internal/communications/inbound", dependencies=[Depends(require_internal)], include_in_schema=False)
def inbound(body: InboundIn, db: DB):
    digits = "".join(ch for ch in body.from_number if ch.isdigit())[-10:]
    c = fetch_one(db, """SELECT id FROM customers WHERE replace(replace(replace(replace(COALESCE(whatsapp, phone, ''),'+',''),' ',''),'-',''),'(','')
                         LIKE ? ORDER BY updated_at DESC LIMIT 1""", (f"%{digits}",))
    if not c:  # unknown sender → auto-create a CRM record + lead so nothing is lost
        cid = insert(db, "customers", {"first_name": "WhatsApp", "last_name": body.from_number[-4:], "whatsapp": body.from_number,
                                       "phone": body.from_number, "preferred_channel": "whatsapp"})
        insert(db, "consents", {"customer_id": cid, "channel": "whatsapp", "granted": 1, "source": "webhook"})
        insert(db, "leads", {"customer_id": cid, "source": "whatsapp", "stage": "new"})
    else:
        cid = c["id"]
    lead = fetch_one(db, "SELECT id FROM leads WHERE customer_id = ? AND stage NOT IN ('won','lost') ORDER BY updated_at DESC LIMIT 1", (cid,))
    mid = insert(db, "communications", {"customer_id": cid, "lead_id": lead["id"] if lead else None, "channel": body.channel,
                                        "direction": "inbound", "recipient": body.from_number, "body": body.body,
                                        "status": "received", "provider_ref": body.provider_ref})
    if lead:
        db.execute("UPDATE leads SET last_activity_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", (lead["id"],))
    activity(db, type="message", customer_id=cid, lead_id=lead["id"] if lead else None, summary=f"WhatsApp received: {body.body[:80]}")
    msg = fetch_one(db, """SELECT m.*, c.first_name || ' ' || c.last_name AS customer_name FROM communications m
                           JOIN customers c ON c.id = m.customer_id WHERE m.id = ?""", (mid,))
    publish("communication.created", msg)
    return {"customer_id": cid, "communication_id": mid}


@router.post("/internal/communications/status", dependencies=[Depends(require_internal)], include_in_schema=False)
def delivery_status(body: StatusIn, db: DB):
    if body.communication_id:
        db.execute("UPDATE communications SET status = ?, error = ? WHERE id = ?", (body.status, body.error, body.communication_id))
    elif body.provider_ref:
        db.execute("UPDATE communications SET status = ?, error = ? WHERE provider_ref = ?", (body.status, body.error, body.provider_ref))
    return {"ok": True}
