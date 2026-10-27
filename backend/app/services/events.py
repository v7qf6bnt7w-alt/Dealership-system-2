"""Cross-cutting services: audit trail, activity timeline, realtime event bus."""
from __future__ import annotations

import json
import logging
import sqlite3
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from ..config import settings
from ..db import insert

log = logging.getLogger("dms")
_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="realtime")


def audit(
    conn: sqlite3.Connection,
    user: dict | None,
    action: str,
    entity: str,
    entity_id: int | None = None,
    details: dict | None = None,
    ip: str | None = None,
) -> None:
    insert(
        conn,
        "audit_logs",
        {
            "user_id": user["id"] if user else None,
            "action": action,
            "entity": entity,
            "entity_id": entity_id,
            "details": json.dumps(details or {}, default=str),
            "ip_address": ip,
        },
    )


def activity(
    conn: sqlite3.Connection,
    *,
    type: str,
    summary: str,
    customer_id: int | None = None,
    lead_id: int | None = None,
    user_id: int | None = None,
    meta: dict | None = None,
) -> None:
    insert(
        conn,
        "activities",
        {
            "customer_id": customer_id,
            "lead_id": lead_id,
            "user_id": user_id,
            "type": type,
            "summary": summary,
            "meta": json.dumps(meta) if meta else None,
        },
    )


def _post(path: str, payload: dict[str, Any], timeout: float = 2.0) -> dict | None:
    req = urllib.request.Request(
        settings.realtime_url + path,
        data=json.dumps(payload, default=str).encode(),
        headers={"Content-Type": "application/json", "X-Internal-Key": settings.internal_api_key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (trusted internal URL)
        body = resp.read()
        return json.loads(body) if body else None


def publish(event: str, data: dict[str, Any], roles: tuple[str, ...] = ("admin", "sales", "service"), user_ids: list[int] | None = None) -> None:
    """Fire-and-forget push to the Node realtime hub (never blocks a request)."""

    def _send() -> None:
        try:
            _post("/internal/events", {"event": event, "data": data, "roles": list(roles), "userIds": user_ids})
        except Exception as exc:  # realtime is best-effort
            log.debug("realtime publish failed: %s", exc)

    _pool.submit(_send)


def realtime_call(path: str, payload: dict[str, Any]) -> dict | None:
    """Synchronous call into the Node service (e.g. WhatsApp outbound queue)."""
    return _post(path, payload, timeout=3.0)
