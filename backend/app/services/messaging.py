"""Outbound messaging: WhatsApp (via Node queue → Meta Cloud API) and SMTP email.

Consent is enforced here — a message to a customer who has withdrawn consent for a
channel is recorded as ``blocked`` and never leaves the building (GDPR art. 7/21).
"""
from __future__ import annotations

import html
import logging
import smtplib
import sqlite3
from email.message import EmailMessage
from string import Template
from typing import Any

from ..config import settings
from ..db import fetch_one, insert, update
from .events import activity, publish, realtime_call

log = logging.getLogger("dms.messaging")

# ---------------------------------------------------------------------------
# Templates  ($placeholders are filled from `context`)
# ---------------------------------------------------------------------------
TEMPLATES: dict[str, dict[str, str]] = {
    "lead_followup": {
        "label": "Lead follow-up",
        "subject": "Following up on the $vehicle",
        "whatsapp": "Hi $first_name, it's $agent from $dealer. Thanks for your interest in the $vehicle — "
                    "would you like to come in for a test drive this week? Reply here and I'll set it up.",
        "body": "Thank you for your interest in the <strong>$vehicle</strong>. It's still available and I'd love to "
                "show it to you in person. I can hold a test-drive slot for you this week — just reply with a time "
                "that works.",
    },
    "test_drive_confirmation": {
        "label": "Test drive confirmation",
        "subject": "Your test drive is confirmed — $when",
        "whatsapp": "✅ $first_name, your test drive of the $vehicle is confirmed for $when at $dealer "
                    "($address). Please bring your driver's license. See you soon!",
        "body": "Your test drive of the <strong>$vehicle</strong> is confirmed for <strong>$when</strong>. "
                "Please bring a valid driver's license. Your vehicle will be detailed and ready on arrival.",
    },
    "test_drive_reminder": {
        "label": "Test drive reminder (24h)",
        "subject": "Reminder: test drive tomorrow",
        "whatsapp": "⏰ Reminder: your $vehicle test drive is on $when. Reply C to confirm or R to reschedule.",
        "body": "A friendly reminder that your test drive of the <strong>$vehicle</strong> is scheduled for "
                "<strong>$when</strong>.",
    },
    "service_update": {
        "label": "Service status update",
        "subject": "Repair order $ro_number — $status",
        "whatsapp": "🔧 $first_name, update on RO $ro_number ($vehicle): $status. $note",
        "body": "Here's an update on repair order <strong>$ro_number</strong> for your $vehicle.<br/>"
                "Current status: <strong>$status</strong>.<br/>$note",
    },
    "quote_ready": {
        "label": "Quote ready",
        "subject": "Your quote $deal_number for the $vehicle",
        "whatsapp": "Hi $first_name, your personalised quote $deal_number for the $vehicle is ready — "
                    "out-the-door total $total. Happy to walk you through it.",
        "body": "Your personalised quote <strong>$deal_number</strong> for the <strong>$vehicle</strong> is ready.<br/>"
                "Out-the-door total: <strong>$total</strong>.",
    },
}

EMAIL_SHELL = Template("""<!doctype html><html><body style="margin:0;background:#f4f4f2;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 12px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e7e5e0">
<tr><td style="background:#111113;padding:22px 32px;color:#fff;font-size:15px;letter-spacing:.14em;text-transform:uppercase;font-weight:700">
<span style="color:#f26b3a">&#9670;</span>&nbsp; $dealer</td></tr>
<tr><td style="padding:32px 32px 8px;font-size:22px;font-weight:700;letter-spacing:-.01em">$subject</td></tr>
<tr><td style="padding:8px 32px 8px;font-size:15px;line-height:1.65;color:#3f3f46">Hi $first_name,<br/><br/>$body</td></tr>
<tr><td style="padding:24px 32px 32px"><a href="$cta_url" style="display:inline-block;background:#f26b3a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:9px;font-weight:600;font-size:14px">$cta_label</a></td></tr>
<tr><td style="padding:20px 32px;background:#fafaf9;border-top:1px solid #eeece8;font-size:12px;color:#71717a;line-height:1.6">
$agent &middot; $dealer<br/>$address &middot; $phone<br/>
You're receiving this because you contacted $dealer. <a href="$unsubscribe_url" style="color:#71717a">Manage preferences</a></td></tr>
</table></td></tr></table></body></html>""")


def _ctx(context: dict[str, Any]) -> dict[str, str]:
    base = {"dealer": settings.dealer_name, "address": settings.dealer_address, "phone": settings.dealer_phone,
            "agent": "the Meridian team", "first_name": "there", "vehicle": "vehicle", "when": "", "note": "",
            "cta_url": "http://localhost:5173/portal", "cta_label": "Open my portal",
            "unsubscribe_url": "http://localhost:5173/portal/privacy"}
    return {**base, **{k: str(v) for k, v in context.items() if v is not None}}


def render(template_key: str, channel: str, context: dict[str, Any]) -> dict[str, str]:
    t = TEMPLATES[template_key]
    ctx = _ctx(context)
    subject = Template(t["subject"]).safe_substitute(ctx)
    if channel == "whatsapp":
        return {"subject": subject, "body": Template(t["whatsapp"]).safe_substitute(ctx)}
    safe_ctx = {k: html.escape(v) for k, v in ctx.items()}
    inner = Template(t["body"]).safe_substitute(safe_ctx)
    return {"subject": subject, "body": inner,
            "html": EMAIL_SHELL.safe_substitute({**safe_ctx, "subject": html.escape(subject), "body": inner})}


def has_consent(conn: sqlite3.Connection, customer_id: int, channel: str) -> bool:
    row = fetch_one(conn, "SELECT granted FROM consents WHERE customer_id = ? AND channel = ? "
                          "ORDER BY created_at DESC, id DESC LIMIT 1", (customer_id, channel))
    return bool(row and row["granted"])


def send(
    conn: sqlite3.Connection,
    *,
    customer_id: int,
    channel: str,
    body: str | None = None,
    subject: str | None = None,
    template: str | None = None,
    context: dict[str, Any] | None = None,
    user: dict | None = None,
    lead_id: int | None = None,
    automated: bool = False,
) -> dict:
    customer = fetch_one(conn, "SELECT * FROM customers WHERE id = ?", (customer_id,))
    if not customer:
        raise ValueError("Customer not found")
    context = {"first_name": customer["first_name"], **({"agent": user["full_name"]} if user else {}), **(context or {})}
    html_body = None
    if template:
        rendered = render(template, channel, context)
        subject, body, html_body = subject or rendered["subject"], body or rendered["body"], rendered.get("html")
    if not body:
        raise ValueError("Message body is required")
    if channel == "email" and not html_body:
        ctx = _ctx(context)
        html_body = EMAIL_SHELL.safe_substitute({**{k: html.escape(v) for k, v in ctx.items()},
                                                 "subject": html.escape(subject or ""),
                                                 "body": html.escape(body).replace("\n", "<br/>")})

    recipient = (customer["whatsapp"] or customer["phone"]) if channel == "whatsapp" else customer["email"]
    comm_id = insert(conn, "communications", {
        "customer_id": customer_id, "lead_id": lead_id, "user_id": user["id"] if user else None,
        "channel": channel, "direction": "outbound", "recipient": recipient, "subject": subject,
        "body": body, "template": template, "status": "queued", "is_automated": int(automated),
    })

    status, provider_ref, error = "queued", None, None
    if customer["is_anonymized"] or not has_consent(conn, customer_id, channel):
        status, error = "blocked", f"No active {channel} consent on file"
    elif not recipient:
        status, error = "failed", f"Customer has no {channel} address"
    elif channel == "whatsapp":
        try:
            res = realtime_call("/internal/whatsapp/send", {"communicationId": comm_id, "to": recipient, "body": body})
            status, provider_ref = (res or {}).get("status", "queued"), (res or {}).get("ref")
        except Exception as exc:
            status, error = "failed", f"Realtime service unavailable: {exc}"
    elif channel == "email":
        status, provider_ref, error = _send_email(recipient, subject or "", body, html_body or "")

    update(conn, "communications", comm_id, {"status": status, "provider_ref": provider_ref, "error": error}, touch=False)
    if status != "blocked":
        activity(conn, type="message", customer_id=customer_id, lead_id=lead_id,
                 user_id=user["id"] if user else None,
                 summary=f"{'Automated ' if automated else ''}{channel.title()} sent: {subject or body[:60]}")
    if lead_id:
        conn.execute("UPDATE leads SET last_activity_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", (lead_id,))
    row = fetch_one(conn, "SELECT * FROM communications WHERE id = ?", (comm_id,))
    publish("communication.created", row)
    return row  # type: ignore[return-value]


def _send_email(to: str, subject: str, text: str, html_body: str) -> tuple[str, str | None, str | None]:
    if not settings.smtp_host:
        log.info("SMTP not configured — simulated email to %s: %s", to, subject)
        return "simulated", None, None
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = settings.smtp_from, to, subject
    msg.set_content(text)
    msg.add_alternative(html_body, subtype="html")
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as s:
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
        return "sent", msg.get("Message-ID"), None
    except Exception as exc:
        return "failed", None, str(exc)
