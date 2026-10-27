"""Follow-up automation engine.

Two entry points:
  * ``on_lead_event`` – synchronous rules fired from API handlers (lead created / stage moved)
  * ``run_sweep``     – periodic background sweep (stale leads, 24h test-drive reminders)

Every generated task carries an ``automation_key`` with a UNIQUE index, so rules are
idempotent: re-running a sweep never duplicates work.
"""
from __future__ import annotations

import asyncio
import logging
import sqlite3
from datetime import datetime, timedelta, timezone

from ..db import closing_conn, fetch_all
from . import messaging
from .events import publish

log = logging.getLogger("dms.automation")

STAGE_RULES: dict[str, tuple[str, timedelta, str]] = {
    "new":         ("First contact: call {name} within the hour", timedelta(hours=1), "high"),
    "contacted":   ("Follow up with {name} — qualify budget & timeline", timedelta(days=2), "normal"),
    "qualified":   ("Offer {name} a test drive", timedelta(days=1), "normal"),
    "test_drive":  ("Post test-drive call with {name}", timedelta(days=1), "high"),
    "negotiation": ("Check in on {name}'s quote decision", timedelta(days=1), "high"),
}
STALE_AFTER = timedelta(days=3)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _create_task(conn: sqlite3.Connection, *, key: str, title: str, due: datetime, priority: str,
                 lead_id: int | None, customer_id: int | None, assigned_to: int | None) -> bool:
    cur = conn.execute(
        "INSERT OR IGNORE INTO tasks (title, due_at, priority, lead_id, customer_id, assigned_to, is_automated, automation_key)"
        " VALUES (?,?,?,?,?,?,1,?)",
        (title, _iso(due), priority, lead_id, customer_id, assigned_to, key),
    )
    if cur.rowcount:
        publish("task.created", {"title": title, "assigned_to": assigned_to, "lead_id": lead_id},
                user_ids=[assigned_to] if assigned_to else None)
    return bool(cur.rowcount)


def on_lead_event(conn: sqlite3.Connection, lead: dict, customer_name: str) -> None:
    rule = STAGE_RULES.get(lead["stage"])
    if not rule:
        # Closed leads: cancel any outstanding automated tasks
        conn.execute("UPDATE tasks SET status='cancelled' WHERE lead_id=? AND status='open' AND is_automated=1",
                     (lead["id"],))
        return
    title, delay, priority = rule
    _create_task(conn, key=f"lead:{lead['id']}:stage:{lead['stage']}", title=title.format(name=customer_name),
                 due=datetime.now(timezone.utc) + delay, priority=priority, lead_id=lead["id"],
                 customer_id=lead["customer_id"], assigned_to=lead["assigned_to"])


def run_sweep(conn: sqlite3.Connection) -> dict[str, int]:
    now = datetime.now(timezone.utc)
    created = reminders = 0

    # 1) Stale open leads → re-engagement task (one per lead per day)
    stale = fetch_all(conn, """
        SELECT l.id, l.customer_id, l.assigned_to, c.first_name || ' ' || c.last_name AS name
        FROM leads l JOIN customers c ON c.id = l.customer_id
        WHERE l.stage NOT IN ('won','lost') AND l.last_activity_at < ?""", (_iso(now - STALE_AFTER),))
    for l in stale:
        created += _create_task(conn, key=f"lead:{l['id']}:stale:{now:%Y%m%d}",
                                title=f"Re-engage {l['name']} — no activity for 3+ days",
                                due=now + timedelta(hours=4), priority="normal", lead_id=l["id"],
                                customer_id=l["customer_id"], assigned_to=l["assigned_to"])

    # 2) Test drives in the next 24h → automated WhatsApp/email reminder
    upcoming = fetch_all(conn, """
        SELECT t.id, t.customer_id, t.lead_id, t.scheduled_at, c.preferred_channel,
               v.year || ' ' || v.make || ' ' || v.model AS vehicle
        FROM test_drives t JOIN customers c ON c.id = t.customer_id JOIN vehicles v ON v.id = t.vehicle_id
        WHERE t.status = 'confirmed' AND t.reminder_sent = 0 AND t.scheduled_at BETWEEN ? AND ?""",
        (_iso(now), _iso(now + timedelta(hours=24))))
    for t in upcoming:
        channel = "whatsapp" if t["preferred_channel"] == "whatsapp" else "email"
        when = datetime.fromisoformat(t["scheduled_at"].replace("Z", "+00:00")).strftime("%a %b %d, %I:%M %p")
        try:
            messaging.send(conn, customer_id=t["customer_id"], channel=channel, template="test_drive_reminder",
                           context={"vehicle": t["vehicle"], "when": when}, lead_id=t["lead_id"], automated=True)
            reminders += 1
        except Exception as exc:  # pragma: no cover
            log.warning("reminder failed for test drive %s: %s", t["id"], exc)
        conn.execute("UPDATE test_drives SET reminder_sent = 1 WHERE id = ?", (t["id"],))

    return {"tasks_created": created, "reminders_sent": reminders}


async def scheduler_loop(interval_seconds: int = 300) -> None:
    while True:
        try:
            with closing_conn() as conn:
                result = await asyncio.to_thread(run_sweep, conn)
                if any(result.values()):
                    log.info("automation sweep: %s", result)
        except Exception as exc:  # pragma: no cover
            log.exception("automation sweep failed: %s", exc)
        await asyncio.sleep(interval_seconds)
