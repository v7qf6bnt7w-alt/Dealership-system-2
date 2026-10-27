// Integration check: backend ⇄ realtime. Run with backend (8000) + realtime (4000) up.
import { io } from 'socket.io-client';

const API = 'http://127.0.0.1:8000/api';
const post = (p, body, token) => fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token && { Authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) }).then((r) => r.json());
const get = (p, token) => fetch(API + p, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { access_token: token } = await post('/auth/login', { email: 'admin@meridian.demo', password: 'meridian123' });
const events = [];
const sock = io('http://127.0.0.1:4000', { auth: { token }, transports: ['websocket'] });
sock.onAny((e, d) => events.push(e));
await new Promise((res, rej) => { sock.on('connect', res); sock.on('connect_error', rej); });
console.log('socket connected ✔');

const bad = io('http://127.0.0.1:4000', { auth: { token: 'nope' }, transports: ['websocket'] });
await new Promise((res) => bad.on('connect_error', (e) => { console.log('bad token rejected ✔', e.message); bad.close(); res(); }));

// WhatsApp to a customer with consent (Emma)
const me = await get('/customers?q=Emma%20Clarke', token);
const msg = await post('/communications/send', { customer_id: me[0].id, channel: 'whatsapp', body: 'Integration test 👋' }, token);
console.log('send status:', msg.status, msg.provider_ref);
await sleep(8000);
const after = (await get(`/communications?customer_id=${me[0].id}&limit=5`, token)).find((m) => m.id === msg.id);
console.log('status after receipts:', after.status, after.status === 'read' ? '✔' : '✘');

// Inbound via dev webhook
await fetch('http://127.0.0.1:4000/dev/whatsapp/inbound', { method: 'POST', body: JSON.stringify({ from: '+1 512 555 0198', body: 'Can I come Saturday?' }) });
await sleep(800);
console.log('events received:', [...new Set(events)].join(', '));
console.log(events.includes('communication.created') ? 'inbound pushed ✔' : 'inbound push ✘');
sock.close();
process.exit(0);
