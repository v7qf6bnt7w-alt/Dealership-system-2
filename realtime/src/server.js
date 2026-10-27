/**
 * Meridian DMS — realtime hub.
 *
 *  • Socket.IO push to staff/customer browsers (JWT shared with the FastAPI backend)
 *  • POST /internal/events          ← backend fan-out (role + user rooms)
 *  • POST /internal/whatsapp/send   ← backend outbound queue (rate-limited, retried)
 *  • GET/POST /webhooks/whatsapp    ← Meta Cloud API webhook (verify, inbound, delivery status)
 *
 * Without WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID the queue runs in simulation mode:
 * messages are marked "simulated" and delivery receipts are faked so the UI is fully demoable.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const env = (k, d) => process.env[k] ?? d;
const PORT = Number(env('REALTIME_PORT', 4000));
const JWT_SECRET = env('JWT_SECRET', 'dev-only-change-me-' + 'x'.repeat(32));
const INTERNAL_KEY = env('INTERNAL_API_KEY', 'dev-internal-key');
const BACKEND_URL = env('BACKEND_URL', 'http://127.0.0.1:8000/api');
const CORS_ORIGINS = env('CORS_ORIGINS', 'http://localhost:5173,http://127.0.0.1:5173').split(',');
const WA_TOKEN = env('WHATSAPP_TOKEN', '');
const WA_PHONE_ID = env('WHATSAPP_PHONE_NUMBER_ID', '');
const WA_VERIFY = env('WHATSAPP_VERIFY_TOKEN', 'meridian-verify');
const WA_APP_SECRET = env('WHATSAPP_APP_SECRET', '');
const WA_RATE_PER_SEC = Number(env('WHATSAPP_RATE_PER_SEC', 20));
const SIMULATE = !(WA_TOKEN && WA_PHONE_ID);

const log = (...a) => console.log(new Date().toISOString(), '[realtime]', ...a);

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function readBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(data === undefined ? '' : JSON.stringify(data));
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

async function backend(path, payload) {
  try {
    const r = await fetch(BACKEND_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': INTERNAL_KEY },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) log('backend', path, r.status, await r.text());
    return r.ok ? r.json() : null;
  } catch (e) {
    log('backend unreachable', path, e.message);
    return null;
  }
}

// ---------------------------------------------------------------------------
// WhatsApp outbound queue (token bucket + exponential backoff)
// ---------------------------------------------------------------------------
const queue = [];
const stats = { queued: 0, sent: 0, failed: 0, simulated: 0, inbound: 0 };
let tokens = WA_RATE_PER_SEC;
setInterval(() => { tokens = WA_RATE_PER_SEC; }, 1000).unref();

function enqueue(job) {
  // notBefore: give the backend time to persist its own "queued" row before receipts arrive
  queue.push({ ...job, attempts: 0, notBefore: Date.now() + 600, ref: `wamid.${crypto.randomBytes(12).toString('hex')}` });
  stats.queued++;
  return queue.at(-1).ref;
}

async function deliver(job) {
  const to = String(job.to).replace(/[^\d]/g, '');
  if (SIMULATE) {
    stats.simulated++;
    await backend('/internal/communications/status', { communication_id: job.communicationId, status: 'simulated' });
    // Fake receipts so the inbox ticks behave like production
    setTimeout(() => backend('/internal/communications/status', { communication_id: job.communicationId, status: 'delivered' }), 1500);
    setTimeout(() => backend('/internal/communications/status', { communication_id: job.communicationId, status: 'read' }), 6000);
    return;
  }
  const r = await fetch(`https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: job.body } }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data?.error?.message || `HTTP ${r.status}`), { retryable: r.status >= 500 || r.status === 429 });
  stats.sent++;
  await backend('/internal/communications/status', {
    communication_id: job.communicationId, provider_ref: data.messages?.[0]?.id, status: 'sent',
  });
}

async function pump() {
  while (queue.length && tokens > 0 && queue[0].notBefore <= Date.now()) {
    const job = queue.shift();
    tokens--;
    try {
      await deliver(job);
    } catch (e) {
      job.attempts++;
      if (e.retryable && job.attempts < 5) {
        setTimeout(() => queue.push(job), 2 ** job.attempts * 1000);
      } else {
        stats.failed++;
        await backend('/internal/communications/status', { communication_id: job.communicationId, status: 'failed', error: e.message });
      }
    }
  }
}
setInterval(pump, 200).unref();

// ---------------------------------------------------------------------------
// Meta webhook parsing
// ---------------------------------------------------------------------------
async function handleWebhook(payload) {
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {};
      for (const m of v.messages ?? []) {
        stats.inbound++;
        const body = m.text?.body ?? m.button?.text ?? m.interactive?.button_reply?.title ?? `[${m.type}]`;
        await backend('/internal/communications/inbound', { from_number: `+${m.from}`, body, provider_ref: m.id });
      }
      for (const s of v.statuses ?? []) {
        const status = { sent: 'sent', delivered: 'delivered', read: 'read', failed: 'failed' }[s.status];
        if (status) await backend('/internal/communications/status', { provider_ref: s.id, status, error: s.errors?.[0]?.title });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { status: 'ok', simulate: SIMULATE, sockets: io.engine.clientsCount, queue: queue.length, stats });
    }

    if (url.pathname.startsWith('/internal/')) {
      if (!safeEqual(req.headers['x-internal-key'], INTERNAL_KEY)) return send(res, 403, { detail: 'Invalid internal key' });
      const payload = JSON.parse((await readBody(req)).toString() || '{}');

      if (req.method === 'POST' && url.pathname === '/internal/events') {
        const { event, data, roles = [], userIds } = payload;
        if (!event) return send(res, 422, { detail: 'event required' });
        const rooms = [...roles.map((r) => `role:${r}`), ...(userIds ?? []).filter(Boolean).map((u) => `user:${u}`)];
        // Customer-role broadcasts are only safe for public payloads; targeted customer events go via user rooms.
        if (rooms.length) io.to(rooms).emit(event, data);
        return send(res, 202, { delivered: rooms.length });
      }

      if (req.method === 'POST' && url.pathname === '/internal/whatsapp/send') {
        const { communicationId, to, body } = payload;
        if (!to || !body) return send(res, 422, { detail: 'to and body required' });
        const ref = enqueue({ communicationId, to, body });
        return send(res, 202, { status: 'queued', ref });
      }
      return send(res, 404, { detail: 'Not found' });
    }

    if (url.pathname === '/webhooks/whatsapp') {
      if (req.method === 'GET') {
        if (url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === WA_VERIFY) {
          res.writeHead(200, { 'Content-Type': 'text/plain' });
          return res.end(url.searchParams.get('hub.challenge'));
        }
        return send(res, 403, { detail: 'Verification failed' });
      }
      if (req.method === 'POST') {
        const raw = await readBody(req);
        if (WA_APP_SECRET) {
          const expected = 'sha256=' + crypto.createHmac('sha256', WA_APP_SECRET).update(raw).digest('hex');
          if (!safeEqual(req.headers['x-hub-signature-256'], expected)) return send(res, 401, { detail: 'Bad signature' });
        }
        send(res, 200, { ok: true }); // ack fast, Meta retries on slow responses
        return handleWebhook(JSON.parse(raw.toString() || '{}')).catch((e) => log('webhook error', e.message));
      }
    }

    // Dev helper: simulate an inbound WhatsApp message (disabled in production)
    if (req.method === 'POST' && url.pathname === '/dev/whatsapp/inbound' && env('APP_ENV', 'development') !== 'production') {
      const { from, body } = JSON.parse((await readBody(req)).toString() || '{}');
      await handleWebhook({ entry: [{ changes: [{ value: { messages: [{ from: String(from).replace(/[^\d]/g, ''), id: `wamid.dev${Date.now()}`, type: 'text', text: { body } }] } }] }] });
      return send(res, 202, { ok: true });
    }

    send(res, 404, { detail: 'Not found' });
  } catch (e) {
    log('request error', req.method, url.pathname, e.message);
    if (!res.headersSent) send(res, 400, { detail: e.message });
  }
});

const io = new Server(server, { cors: { origin: CORS_ORIGINS, credentials: true }, pingInterval: 20_000 });

const presence = new Map(); // userId -> { name, role, sockets }

io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const claims = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'], issuer: 'meridian-dms' });
    socket.data.user = { id: Number(claims.sub), role: claims.role, name: claims.name };
    next();
  } catch {
    next(new Error('unauthorized'));
  }
});

function broadcastPresence() {
  const online = [...presence.entries()].filter(([, p]) => p.role !== 'customer').map(([id, p]) => ({ id, name: p.name, role: p.role }));
  io.to(['role:admin', 'role:sales', 'role:service']).emit('presence', online);
}

io.on('connection', (socket) => {
  const u = socket.data.user;
  socket.join([`role:${u.role}`, `user:${u.id}`]);
  const p = presence.get(u.id) ?? { name: u.name, role: u.role, sockets: 0 };
  p.sockets++;
  presence.set(u.id, p);
  broadcastPresence();

  socket.on('disconnect', () => {
    const cur = presence.get(u.id);
    if (cur && --cur.sockets <= 0) presence.delete(u.id);
    broadcastPresence();
  });
});

server.listen(PORT, () => log(`listening on :${PORT} (whatsapp ${SIMULATE ? 'SIMULATION' : 'LIVE'} mode, backend ${BACKEND_URL})`));
