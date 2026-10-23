/**
 * Media Beem Agency Manager — API (Cloudflare Workers + D1)
 *
 * Roles: admin (full access) · employee (own tasks/salary/channels/DMs) · client (own invoices/projects/#general)
 * Auth:  email + password → JWT (HS256, 7 days) sent as `Authorization: Bearer <token>`.
 *
 * Every data table keeps the spec columns plus a `data` JSON column with the full record,
 * so the admin app (which works with rich objects) never loses a field.
 */

import { loadMessages, persistMessage, roomKey, touchPresence, ChatError, EMOJIS } from './chat.js';
export { ChatRoom } from './chat.js';   // the Durable Object class must be exported from the Worker entry

const PBKDF2_ITERATIONS = 100000; // Workers' WebCrypto maximum
const TOKEN_TTL_SECONDS = 7 * 24 * 3600;
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const enc = new TextEncoder();

/* ------------------------------------------------------------------ utils */
const b64u = {
  enc(buf) { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); },
  dec(str) { const p = str.replace(/-/g, '+').replace(/_/g, '/'); const bin = atob(p + '==='.slice((p.length + 3) % 4)); return Uint8Array.from(bin, c => c.charCodeAt(0)); },
};
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);
const num = x => (Number.isFinite(+x) && x !== '' && x !== null && x !== undefined ? +x : null);
const str = x => (x === undefined || x === null ? null : String(x));
const sum = (arr, f) => arr.reduce((t, x) => t + (+f(x) || 0), 0);
const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };

function corsHeaders(req, env) {
  const origin = req.headers.get('Origin');
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization,Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && allowed.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}
function respond(req, env, data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...corsHeaders(req, env) },
  });
}
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m = 'Bad request') => new HttpError(400, m);
const forbidden = (m = 'Forbidden') => new HttpError(403, m);
const notFound = (m = 'Not found') => new HttpError(404, m);

async function readBody(req) {
  const len = +req.headers.get('Content-Length') || 0;
  if (len > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Payload too large');
  if (!text) return {};
  try { const j = JSON.parse(text); return j && typeof j === 'object' ? j : {}; } catch { throw bad('Invalid JSON'); }
}

/* --------------------------------------------------------- password + JWT */
async function pbkdf2(password, salt, iterations = PBKDF2_ITERATIONS) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PBKDF2_ITERATIONS}$${b64u.enc(salt)}$${b64u.enc(await pbkdf2(password, salt))}`;
}
function constEq(a, b) { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0; }
async function verifyPassword(password, stored) {
  const [scheme, iter, salt, hash] = String(stored || '').split('$');
  if (scheme !== 'pbkdf2' || !salt || !hash) return false;
  const got = new Uint8Array(await pbkdf2(password, b64u.dec(salt), +iter || PBKDF2_ITERATIONS));
  return constEq(got, b64u.dec(hash));
}
async function hmacKey(secret) { return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']); }
async function signJwt(payload, secret) {
  const head = b64u.enc(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64u.enc(enc.encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u.enc(sig)}`;
}
async function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64u.dec(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) return null;
  const payload = safeJson(new TextDecoder().decode(b64u.dec(parts[1])), null);
  if (!payload || !payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

/* ------------------------------------------------------------------- auth */
async function linkedIdFor(env, user) {
  if (user.role === 'employee') { const r = await env.DB.prepare('SELECT employee_id FROM employee_user WHERE user_id=?').bind(user.id).first(); return r ? r.employee_id : null; }
  if (user.role === 'client') { const r = await env.DB.prepare('SELECT client_id FROM client_user WHERE user_id=?').bind(user.id).first(); return r ? r.client_id : null; }
  return null;
}
/** Verifies the bearer token, re-checks the user is still active, and enforces the allowed roles. */
async function authenticate(req, env, roles, allowQuery) {
  if (!env.JWT_SECRET) throw new HttpError(500, 'Server is missing JWT_SECRET');
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  const tok = m ? m[1] : allowQuery ? new URL(req.url).searchParams.get('token') : null;
  const payload = tok ? await verifyJwt(tok, env.JWT_SECRET) : null;
  if (!payload) throw new HttpError(401, 'Not signed in');
  const u = await env.DB.prepare('SELECT id,email,name,role,active FROM users WHERE id=?').bind(payload.sub).first();
  if (!u || !u.active) throw new HttpError(401, 'Account is inactive');
  const user = { id: u.id, email: u.email, name: u.name, role: u.role, linked_id: await linkedIdFor(env, u) };
  if (roles && !roles.includes(user.role)) throw forbidden('You do not have access to this area');
  return user;
}

async function login(req, env) {
  const { email, password } = await readBody(req);
  const em = String(email || '').trim().toLowerCase();
  if (!em || !password) throw bad('Email and password are required');
  const since = Date.now() - 15 * 60 * 1000;
  const fails = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE email=? AND ts>?').bind(em, since).first();
  if (fails && fails.n >= 8) throw new HttpError(429, 'Too many attempts — try again in 15 minutes');
  const u = await env.DB.prepare('SELECT * FROM users WHERE email=?').bind(em).first();
  // verify even for unknown emails so response time does not reveal whether an account exists
  const ok = await verifyPassword(String(password), u ? u.password_hash : 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  if (!u || !ok || !u.active) {
    await env.DB.prepare('INSERT INTO login_attempts (email, ts) VALUES (?,?)').bind(em, Date.now()).run();
    throw new HttpError(401, 'Invalid email or password');
  }
  await env.DB.prepare('DELETE FROM login_attempts WHERE email=?').bind(em).run();
  const linked_id = await linkedIdFor(env, u);
  const iat = Math.floor(Date.now() / 1000);
  const token = await signJwt({ user_id: u.id, sub: u.id, role: u.role, linked_id, iat, exp: iat + TOKEN_TTL_SECONDS }, env.JWT_SECRET);
  return { token, expires_in: TOKEN_TTL_SECONDS, user: { id: u.id, name: u.name, email: u.email, role: u.role, linked_id } };
}

/* ------------------------------------------------- collections (admin sync) */
const paymentsOf = e => (Array.isArray(e.payments) ? e.payments : []);
function invoiceStatus(e) {
  const rec = sum(paymentsOf(e), p => p.amount), total = +e.total_amount || 0;
  if (total - rec <= 0) return 'paid';
  if (e.expectedBy && today() > e.expectedBy) return 'overdue';
  return rec > 0 ? 'partial' : 'unpaid';
}
const slug = s => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * key = the browser-side collection name (same names the app used in localStorage).
 * t = table, cols = columns besides id/data/updated_at, row(item) = values for cols.
 */
const COLLECTIONS = {
  income_entries: { t: 'income_entries', cols: ['total_amount', 'received_amount', 'source', 'date', 'description', 'category', 'status'],
    row: e => [num(e.total_amount), num(e.received_amount), str(e.client), str(e.date), str(e.description), str(e.category), (+e.received_amount || 0) >= (+e.total_amount || 0) ? 'received' : 'partial'] },
  expenses: { t: 'expenses', cols: ['amount', 'category', 'vendor', 'date', 'description'], row: e => [num(e.amount), str(e.category), str(e.vendor), str(e.date), str(e.description)] },
  invoices: { t: 'invoices', cols: ['client_id', 'total_amount', 'received_amount', 'remaining', 'status', 'issue_date', 'expected_date', 'client_type'],
    row: e => { const rec = sum(paymentsOf(e), p => p.amount); return [str(e.clientId), num(e.total_amount), rec, Math.max(0, (+e.total_amount || 0) - rec), invoiceStatus(e), str(e.date), str(e.expectedBy), str(e.clientType)]; } },
  charity_expenses: { t: 'allah_share_payments', cols: ['amount', 'type', 'given_to', 'date', 'notes', 'kind', 'obligated_part', 'credit_added', 'credit_applied'],
    row: e => [num(e.amount), e.type === 'voluntary' ? 'voluntary' : 'obligated', str(e.cause), str(e.date), str(e.notes), e.type === 'credit' ? 'credit_applied' : 'payment', e.type === 'voluntary' ? num(e.obligated_part) : null, e.type === 'voluntary' ? (+e.credit_added || 0) : 0, e.type === 'credit' ? (+e.credit_applied || +e.amount || 0) : 0] },
  recurring_alerts: { t: 'recurring_alerts', cols: ['client_id', 'frequency_days', 'last_invoice_date', 'next_alert_date', 'active'], id: e => 'ra-' + slug(e.client_name),
    row: e => [str(e.client_id), num(e.frequency_days), str(e.last_invoice_date), str(e.next_alert_date), e.active ? 1 : 0] },
  employees: { t: 'employees', cols: ['name', 'role', 'salary', 'join_date', 'bank_name', 'account_number', 'phone', 'email', 'status'],
    row: e => [str(e.name), str(e.designation), num(e.salary), str(e.joinDate), str(e.bankName), str(e.accountNumber), str(e.phone), str(e.email), str(e.status)] },
  salary_payments: { t: 'salary_payments', cols: ['employee_id', 'month', 'amount', 'date', 'method', 'notes', 'is_prorata'],
    row: e => [str(e.employee_id), str(e.month), num(e.amount), str(e.date), str(e.method), str(e.notes), /^pro-?rata/i.test(e.notes || '') ? 1 : 0] },
  employee_leaves: { t: 'employee_leaves', cols: ['employee_id', 'date', 'type', 'notes'], row: e => [str(e.employee_id), str(e.date), str(e.type), str(e.notes)] },
  clients: { t: 'clients', cols: ['name', 'contact', 'email', 'phone', 'status', 'client_type', 'retainer_amount'],
    row: e => [str(e.company), str(e.contact), str(e.email), str(e.phone), str(e.status), str(e.clientType), num(e.retainer)] },
  cu_spaces: { t: 'cu_spaces', cols: ['name', 'client_id', 'color'], row: e => [str(e.name), str(e.clientId), str(e.color)] },
  cu_lists: { t: 'cu_lists', cols: ['space_id', 'name', 'color', 'client_id'], row: e => [str(e.spaceId), str(e.name), str(e.color), str(e.clientId)] },
  cu_tasks: { t: 'tasks', cols: ['list_id', 'title', 'description', 'assignee_id', 'due_date', 'priority', 'status', 'tags', 'time_estimate'],
    row: e => [str(e.listId), str(e.title), str(e.description), str((e.assignees || [])[0]), str(e.due), str(e.priority), str(e.status), JSON.stringify(e.tags || []), num(e.estimate)] },
  cu_subtasks: { t: 'subtasks', cols: ['task_id', 'title', 'completed'], row: e => [str(e.taskId), str(e.title), e.done ? 1 : 0] },
  cu_comments: { t: 'task_comments', cols: ['task_id', 'author_id', 'author_name', 'text', 'timestamp', 'client_visible', 'kind'],
    row: e => [str(e.taskId), str(e.author_id), str(e.by), str(e.text), str(e.at), e.client_visible ? 1 : 0, e.kind === 'activity' ? 'activity' : 'comment'] },
  cu_time_logs: { t: 'task_time_logs', cols: ['task_id', 'hours', 'date', 'note', 'by_name'], row: e => [str(e.taskId), num(e.hours), str(e.date), str(e.note), str(e.by)] },
  cu_messages: { t: 'list_messages', cols: ['scope', 'author_name', 'text', 'timestamp'], row: e => [str(e.scope), str(e.by), str(e.text), str(e.at)] },
  channels: { t: 'channels', cols: ['name', 'space_id', 'client_id', 'permanent'], row: e => [str(e.name), str(e.spaceId), str(e.clientId), e.permanent ? 1 : 0] },
  resource_folders: { t: 'resource_folders', cols: ['space_id', 'name'], row: e => [str(e.spaceId), str(e.name)] },
  resource_files: { t: 'resource_files', cols: ['folder_id', 'space_id', 'name', 'size', 'type', 'kind', 'url', 'by_name'],
    row: e => [str(e.folderId), str(e.spaceId), str(e.name), num(e.size), str(e.type), str(e.kind), str(e.url), str(e.by)] },
  personal_expenses: { t: 'personal_expenses', cols: ['amount', 'category', 'date', 'description', 'payment_method'], row: e => [num(e.amount), str(e.category), str(e.date), str(e.note), str(e.method)] },
  personal_income: { t: 'personal_income', cols: ['amount', 'source', 'date', 'notes'], row: e => [num(e.amount), str(e.source), str(e.date), str(e.note)] },
  personal_withdrawals: { t: 'personal_withdrawals', cols: ['amount', 'date', 'note'], row: e => [num(e.amount), str(e.date), str(e.note)] },
};
const SETTING_KEYS = ['data_version', 'cu_migrated', 'cu_nofolders', 'allah_share_credit', 'allah_share_credit_manual', 'allah_share_credit_manual_at', 'allah_share_credit_last'];
/** collections that portal users can also change — the admin app polls these */
const SHARED_KEYS = ['cu_tasks', 'cu_subtasks', 'cu_comments', 'cu_time_logs'];

const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
async function runBatch(env, stmts) { for (const part of chunk(stmts, 40)) if (part.length) await env.DB.batch(part); }
const idOf = (c, e) => String(c.id ? c.id(e) : e.id);

function upsertStmt(env, c) {
  const cols = ['id', ...c.cols, 'data', 'updated_at'];
  return env.DB.prepare(`INSERT INTO ${c.t} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${cols.slice(1).map(x => `${x}=excluded.${x}`).join(',')}`);
}

async function syncCollection(env, key, upserts, deletes) {
  const c = COLLECTIONS[key];
  if (!c) throw bad('Unknown collection: ' + key);
  const ts = Date.now(), stmts = [], up = upsertStmt(env, c);
  for (const item of upserts || []) {
    if (!item || typeof item !== 'object') continue;
    const id = idOf(c, item);
    if (!id || id === 'undefined') continue;
    const data = key === 'recurring_alerts' ? { ...item, id } : item;
    stmts.push(up.bind(id, ...c.row(item), JSON.stringify(data), ts));
    if (key === 'invoices') {
      stmts.push(env.DB.prepare('DELETE FROM invoice_payments WHERE invoice_id=?').bind(id));
      for (const p of paymentsOf(item)) stmts.push(env.DB.prepare('INSERT OR REPLACE INTO invoice_payments (id,invoice_id,amount,date,notes) VALUES (?,?,?,?,?)').bind(String(p.id || uid()), id, num(p.amount), str(p.date), str(p.note)));
    }
  }
  for (const rawId of deletes || []) {
    const id = String(rawId);
    stmts.push(env.DB.prepare(`DELETE FROM ${c.t} WHERE id=?`).bind(id));
    if (key === 'invoices') stmts.push(env.DB.prepare('DELETE FROM invoice_payments WHERE invoice_id=?').bind(id));
    if (key === 'channels') { stmts.push(env.DB.prepare('DELETE FROM channel_messages WHERE channel_id=?').bind(id)); stmts.push(env.DB.prepare('DELETE FROM channel_members WHERE channel_id=?').bind(id)); }
    if (key === 'employees') { stmts.push(env.DB.prepare('UPDATE users SET active=0 WHERE id IN (SELECT user_id FROM employee_user WHERE employee_id=?)').bind(id)); stmts.push(env.DB.prepare('DELETE FROM employee_user WHERE employee_id=?').bind(id)); }
    if (key === 'clients') { stmts.push(env.DB.prepare('UPDATE users SET active=0 WHERE id IN (SELECT user_id FROM client_user WHERE client_id=?)').bind(id)); stmts.push(env.DB.prepare('DELETE FROM client_user WHERE client_id=?').bind(id)); }
  }
  await runBatch(env, stmts);
  if (key === 'cu_spaces' || key === 'channels' || key === 'cu_lists') await propagateClientIds(env);
  return ts;
}
/** channels/lists inherit the client of their Space so portal filters stay simple */
async function propagateClientIds(env) {
  await env.DB.batch([
    env.DB.prepare("UPDATE channels SET client_id = (SELECT client_id FROM cu_spaces WHERE cu_spaces.id = channels.space_id) WHERE space_id IS NOT NULL"),
    env.DB.prepare("UPDATE cu_lists SET client_id = (SELECT client_id FROM cu_spaces WHERE cu_spaces.id = cu_lists.space_id) WHERE (client_id IS NULL OR client_id = '') AND space_id IS NOT NULL"),
  ]);
}

async function loadCollection(env, key, since) {
  const c = COLLECTIONS[key];
  const rs = since ? await env.DB.prepare(`SELECT data FROM ${c.t} WHERE updated_at>? ORDER BY rowid`).bind(since).all()
    : await env.DB.prepare(`SELECT data FROM ${c.t} ORDER BY rowid`).all();
  return rs.results.map(r => safeJson(r.data, null)).filter(Boolean);
}
async function loadSettings(env) {
  const rs = await env.DB.prepare('SELECT key,value FROM app_settings').all();
  const out = {}; rs.results.forEach(r => { out[r.key] = r.value; }); return out;
}

/* ------------------------------------------------------------------ admin */
async function adminState(env) {
  const data = {};
  for (const key of Object.keys(COLLECTIONS)) data[key] = await loadCollection(env, key);
  const members = {};
  (await env.DB.prepare('SELECT channel_id,user_id FROM channel_members').all()).results.forEach(r => { (members[r.channel_id] = members[r.channel_id] || []).push(r.user_id); });
  return { data, settings: await loadSettings(env), members, users: await listUsers(env), now: Date.now() };
}
async function listUsers(env) {
  const rs = await env.DB.prepare(`SELECT u.id,u.email,u.name,u.role,u.active,u.created_at, eu.employee_id, cu.client_id
    FROM users u LEFT JOIN employee_user eu ON eu.user_id=u.id LEFT JOIN client_user cu ON cu.user_id=u.id ORDER BY u.created_at`).all();
  return rs.results;
}
async function adminSync(req, env) {
  const { key, upserts, deletes, settings } = await readBody(req);
  const stmts = [];
  if (settings && typeof settings === 'object') {
    for (const [k, v] of Object.entries(settings)) if (SETTING_KEYS.includes(k)) stmts.push(env.DB.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, v === null ? null : String(v)));
    await runBatch(env, stmts);
  }
  let ts = Date.now();
  if (key) ts = await syncCollection(env, key, upserts, deletes);
  return { ok: true, ts };
}
async function adminChanges(env, since) {
  const out = {}, deleted = {};
  for (const key of SHARED_KEYS) out[key] = await loadCollection(env, key, since);
  (await env.DB.prepare('SELECT key,id FROM tombstones WHERE ts>?').bind(since).all()).results.forEach(r => { (deleted[r.key] = deleted[r.key] || []).push(r.id); });
  return { changes: out, deleted, now: Date.now() };
}
async function adminImport(req, env, admin) {
  const { collections, settings } = await readBody(req);
  const cols = collections || {};
  let count = 0;
  const dms = [], chanMsgs = [];
  for (const [key, val] of Object.entries(cols)) {
    if (key === 'channels_messages') { chanMsgs.push(...(Array.isArray(val) ? val : [])); continue; }
    if (!COLLECTIONS[key] || !Array.isArray(val)) continue;
    let items = val;
    if (key === 'cu_messages') { // legacy: DMs lived next to list-channel messages
      dms.push(...val.filter(m => String(m.scope || '').startsWith('dm:')));
      items = val.filter(m => !String(m.scope || '').startsWith('dm:'));
    }
    await syncCollection(env, key, items, []);
    count += items.length;
  }
  const stmts = [];
  for (const m of dms) {
    const emp = String(m.scope).slice(3), fromMe = !m.by || m.by === 'You';
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO dm_messages (id,from_id,to_id,from_name,text,timestamp) VALUES (?,?,?,?,?,?)').bind(String(m.id || uid()), fromMe ? admin.id : 'emp:' + emp, fromMe ? 'emp:' + emp : admin.id, fromMe ? admin.name : str(m.by), str(m.text) || '', str(m.at) || nowIso()));
  }
  for (const m of chanMsgs) {
    const mine = !m.author || m.author === 'You';
    stmts.push(env.DB.prepare('INSERT OR IGNORE INTO channel_messages (id,channel_id,author_id,author_name,text,timestamp) VALUES (?,?,?,?,?,?)').bind(String(m.id || uid()), String(m.channel_id), mine ? admin.id : null, mine ? admin.name : str(m.author), str(m.text) || '', str(m.timestamp) || nowIso()));
  }
  await runBatch(env, stmts);
  const stmts2 = [];
  for (const [k, v] of Object.entries(settings || {})) if (SETTING_KEYS.includes(k)) stmts2.push(env.DB.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k, v === null ? null : String(v)));
  await runBatch(env, stmts2);
  return { ok: true, imported: count, dm_messages: dms.length, channel_messages: chanMsgs.length };
}
async function createUser(req, env) {
  const b = await readBody(req);
  const role = b.role, email = String(b.email || '').trim().toLowerCase(), password = String(b.password || '');
  if (!['employee', 'client'].includes(role)) throw bad('role must be employee or client');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw bad('Enter a valid email address');
  if (password.length < 8) throw bad('Temporary password must be at least 8 characters');
  const linked = String(b.linked_id || '');
  const target = await env.DB.prepare(role === 'employee' ? 'SELECT id,name FROM employees WHERE id=?' : 'SELECT id,name FROM clients WHERE id=?').bind(linked).first();
  if (!target) throw bad('That ' + role + ' was not found — make sure it has been saved first');
  const already = await env.DB.prepare(role === 'employee' ? 'SELECT user_id FROM employee_user WHERE employee_id=?' : 'SELECT user_id FROM client_user WHERE client_id=?').bind(linked).first();
  if (already) throw new HttpError(409, 'This ' + role + ' already has portal access');
  if (await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first()) throw new HttpError(409, 'That email is already in use');
  const id = uid(), hash = await hashPassword(password), name = String(b.name || target.name || email);
  const stmts = [
    env.DB.prepare('INSERT INTO users (id,email,password_hash,role,name,active) VALUES (?,?,?,?,?,1)').bind(id, email, hash, role, name),
    env.DB.prepare(role === 'employee' ? 'INSERT INTO employee_user (employee_id,user_id) VALUES (?,?)' : 'INSERT INTO client_user (client_id,user_id) VALUES (?,?)').bind(linked, id),
  ];
  if (role === 'employee') { // DMs written before the account existed now belong to the real user
    stmts.push(env.DB.prepare("UPDATE dm_messages SET from_id=? WHERE from_id=?").bind(id, 'emp:' + linked));
    stmts.push(env.DB.prepare("UPDATE dm_messages SET to_id=? WHERE to_id=?").bind(id, 'emp:' + linked));
  }
  await env.DB.batch(stmts);
  return { ok: true, id };
}
async function patchUser(req, env, admin, id) {
  const b = await readBody(req);
  const u = await env.DB.prepare('SELECT id,role FROM users WHERE id=?').bind(id).first();
  if (!u) throw notFound('User not found');
  if (u.role === 'admin' && id !== admin.id) throw forbidden('Admin accounts cannot be modified here');
  const stmts = [];
  if (b.active !== undefined) {
    if (id === admin.id) throw bad('You cannot deactivate your own account');
    stmts.push(env.DB.prepare('UPDATE users SET active=? WHERE id=?').bind(b.active ? 1 : 0, id));
  }
  if (b.password !== undefined) {
    if (String(b.password).length < 8) throw bad('Password must be at least 8 characters');
    stmts.push(env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(String(b.password)), id));
  }
  if (b.email !== undefined) {
    const em = String(b.email).trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw bad('Enter a valid email address');
    const clash = await env.DB.prepare('SELECT id FROM users WHERE email=? AND id<>?').bind(em, id).first();
    if (clash) throw new HttpError(409, 'That email is already in use');
    stmts.push(env.DB.prepare('UPDATE users SET email=? WHERE id=?').bind(em, id));
  }
  if (!stmts.length) throw bad('Nothing to update');
  await env.DB.batch(stmts);
  return { ok: true };
}
async function setChannelMembers(req, env) {
  const { channel_id, user_ids } = await readBody(req);
  const ch = await env.DB.prepare('SELECT id FROM channels WHERE id=?').bind(String(channel_id || '')).first();
  if (!ch) throw notFound('Channel not found — it may not be saved yet');
  const ids = [...new Set((Array.isArray(user_ids) ? user_ids : []).map(String))];
  const valid = ids.length ? (await env.DB.prepare(`SELECT id FROM users WHERE active=1 AND role='employee' AND id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all()).results.map(r => r.id) : [];
  const stmts = [env.DB.prepare('DELETE FROM channel_members WHERE channel_id=?').bind(ch.id), ...valid.map(u => env.DB.prepare('INSERT INTO channel_members (channel_id,user_id) VALUES (?,?)').bind(ch.id, u))];
  await env.DB.batch(stmts);
  return { ok: true, members: valid };
}
async function clearDm(env, admin, other) {
  await env.DB.prepare('DELETE FROM dm_messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?)').bind(admin.id, other, other, admin.id).run();
  return { ok: true };
}

/* ----------------------------------------------------------- shared tasks */
async function loadList(env, id) { const r = await env.DB.prepare('SELECT data FROM cu_lists WHERE id=?').bind(id).first(); return r ? safeJson(r.data, null) : null; }
const statusMeta = (list, id) => { const s = list && (list.statuses || []).find(x => x.id === id); return s || { name: '—', color: '#6b7280', kind: 'open' }; };

async function taskPayload(env, rows, { audience }) {
  if (!rows.length) return { tasks: [], lists: {} };
  const tasks = rows.map(r => safeJson(r.data, null)).filter(Boolean);
  const ids = tasks.map(t => t.id), listIds = [...new Set(tasks.map(t => t.listId))];
  const lists = {}, spaces = {};
  for (const part of chunk(listIds, 80)) {
    (await env.DB.prepare(`SELECT l.data, s.name AS space_name, s.id AS space_id FROM cu_lists l LEFT JOIN cu_spaces s ON s.id=l.space_id WHERE l.id IN (${part.map(() => '?').join(',')})`).bind(...part).all())
      .results.forEach(r => { const l = safeJson(r.data, null); if (l) { lists[l.id] = l; spaces[l.id] = { id: r.space_id, name: r.space_name }; } });
  }
  const subs = {}, cms = {};
  for (const part of chunk(ids, 80)) {
    const q = part.map(() => '?').join(',');
    (await env.DB.prepare(`SELECT data FROM subtasks WHERE task_id IN (${q}) ORDER BY rowid`).bind(...part).all()).results.forEach(r => { const s = safeJson(r.data, null); if (s) (subs[s.taskId] = subs[s.taskId] || []).push({ id: s.id, title: s.title, done: !!s.done }); });
    const cq = audience === 'client' ? ' AND client_visible=1' : '';
    (await env.DB.prepare(`SELECT id,task_id,author_id,author_name,text,timestamp,kind FROM task_comments WHERE task_id IN (${q})${cq} ORDER BY timestamp`).bind(...part).all())
      .results.forEach(c => { (cms[c.task_id] = cms[c.task_id] || []).push({ id: c.id, by: c.author_name, author_id: c.author_id, text: c.text, at: c.timestamp, kind: c.kind }); });
  }
  const empNames = {};
  if (audience !== 'client') (await env.DB.prepare('SELECT id,name FROM employees').all()).results.forEach(e => { empNames[e.id] = e.name; });
  const out = tasks.map(t => {
    const l = lists[t.listId], st = statusMeta(l, t.status);
    const base = { id: t.id, title: t.title, description: t.description || '', due: t.due || '', priority: t.priority || 'normal', status: t.status, status_name: st.name, status_color: st.color, status_kind: st.kind,
      list: { id: t.listId, name: l ? l.name : '', color: l ? l.color : '' }, space: spaces[t.listId] || {}, tags: t.tags || [], subtasks: subs[t.id] || [], comments: cms[t.id] || [], repeat: t.repeat || '' };
    if (audience === 'client') return base;
    return { ...base, estimate: t.estimate || 0, assignees: (t.assignees || []).map(id => empNames[id]).filter(Boolean), assignee_ids: t.assignees || [], attachments: t.attachments || '' };
  });
  const listMeta = {}; Object.values(lists).forEach(l => { listMeta[l.id] = { id: l.id, name: l.name, color: l.color, statuses: l.statuses || [] }; });
  return { tasks: out, lists: listMeta };
}
function nextDue(t) {
  const base = t.due || today();
  const add = n => { const d = new Date(base + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (t.repeat === 'daily') return add(1);
  if (t.repeat === 'weekly') return add(7);
  if (t.repeat === 'custom') return add(Math.max(1, +t.repeatDays || 1));
  const d = new Date(base + 'T00:00:00Z'), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + 1);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return d.toISOString().slice(0, 10);
}
async function writeTask(env, t) {
  const c = COLLECTIONS.cu_tasks;
  await upsertStmt(env, c).bind(String(t.id), ...c.row(t), JSON.stringify(t), Date.now()).run();
}
async function addComment(env, taskId, { by, author_id, text, kind = 'comment', client_visible = 0 }) {
  const item = { id: uid(), taskId, at: nowIso(), by, author_id, text, kind, client_visible };
  const c = COLLECTIONS.cu_comments;
  await upsertStmt(env, c).bind(item.id, ...c.row(item), JSON.stringify(item), Date.now()).run();
  await notifyRoom(env, 'task:' + taskId, { t: 'msg', msg: { id: item.id, room: 'task:' + taskId, author_id: author_id || null, author_name: by, text, ts: item.at, kind, client_visible: !!client_visible, deleted: false, edited_at: null, reply_to: null, reactions: {} } });
  return item;
}
async function setTaskStatus(env, user, task, statusId) {
  const list = await loadList(env, task.listId);
  const next = list && (list.statuses || []).find(s => s.id === statusId);
  if (!next) throw bad('That status does not exist in this list');
  if (next.id === task.status) return task;
  const old = statusMeta(list, task.status);
  task.status = next.id;
  if (next.kind === 'done' && task.repeat && !task.spawned) { // recurring task: next instance, status reset
    const firstOpen = (list.statuses || []).find(s => s.kind === 'open') || list.statuses[0];
    const copy = { ...task, id: uid(), status: firstOpen.id, due: nextDue(task), start: '', spawned: false, created: nowIso(), assignees: [...(task.assignees || [])], tags: [...(task.tags || [])] };
    await writeTask(env, copy);
    await addComment(env, copy.id, { by: user.name, author_id: user.id, text: 'created this recurring task', kind: 'activity' });
    const subs = (await env.DB.prepare('SELECT data FROM subtasks WHERE task_id=?').bind(task.id).all()).results.map(r => safeJson(r.data, null)).filter(Boolean);
    const sc = COLLECTIONS.cu_subtasks, up = upsertStmt(env, sc), ts = Date.now();
    await runBatch(env, subs.map(s => { const n = { id: uid(), taskId: copy.id, title: s.title, done: false }; return up.bind(n.id, ...sc.row(n), JSON.stringify(n), ts); }));
    task.spawned = true;
  }
  await writeTask(env, task);
  await addComment(env, task.id, { by: user.name, author_id: user.id, text: `changed status from ${old.name} to ${next.name}`, kind: 'activity' });
  return task;
}

/* --------------------------------------------------------------- employee */
async function empTaskRows(env, employeeId, taskId) {
  const sql = `SELECT t.data FROM tasks t WHERE EXISTS (SELECT 1 FROM json_each(t.data, '$.assignees') j WHERE j.value = ?)${taskId ? ' AND t.id = ?' : ''} ORDER BY t.due_date IS NULL, t.due_date, t.rowid`;
  return (await env.DB.prepare(sql).bind(...(taskId ? [employeeId, taskId] : [employeeId])).all()).results;
}
async function ownTask(env, user, taskId) {   // employees work on every task, not only the ones assigned to them
  if (!user.linked_id) throw forbidden('Your account is not linked to an employee record');
  const r = await env.DB.prepare('SELECT data FROM tasks WHERE id=?').bind(taskId).first();
  if (!r) throw notFound('Task not found');
  return safeJson(r.data, null);
}
async function employeeMe(env, user) {
  const e = user.linked_id ? await env.DB.prepare('SELECT data FROM employees WHERE id=?').bind(user.linked_id).first() : null;
  const emp = e ? safeJson(e.data, {}) : {};
  const { notes, ...own } = emp; // private HR notes stay admin-only
  const pays = user.linked_id ? (await env.DB.prepare('SELECT id,month,amount,date,method,notes,is_prorata FROM salary_payments WHERE employee_id=? ORDER BY month DESC, date DESC').bind(user.linked_id).all()).results : [];
  return { user: { id: user.id, name: user.name, email: user.email }, employee: own, salary_payments: pays };
}
async function employeeChannels(env, user) {
  return (await env.DB.prepare(`SELECT c.id,c.name,c.space_id,c.client_id,c.permanent, s.name AS space_name FROM channels c JOIN channel_members m ON m.channel_id=c.id LEFT JOIN cu_spaces s ON s.id=c.space_id WHERE m.user_id=? ORDER BY c.name`).bind(user.id).all()).results;
}
async function contacts(env, user) {
  return (await env.DB.prepare(`SELECT id,name,role FROM users WHERE active=1 AND id<>? AND role IN ('admin','employee') ORDER BY role, name`).bind(user.id).all()).results;
}

/* ----------------------------------------------------------------- client */
async function clientInvoices(env, user) {
  if (!user.linked_id) return [];
  const rs = await env.DB.prepare('SELECT data FROM invoices WHERE client_id=? ORDER BY issue_date DESC, rowid DESC').bind(user.linked_id).all();
  return rs.results.map(r => safeJson(r.data, null)).filter(Boolean).map(e => {
    const pays = paymentsOf(e).map(p => ({ id: p.id, amount: +p.amount || 0, date: p.date, note: p.note || '' })), rec = sum(pays, p => p.amount), total = +e.total_amount || 0;
    return { id: e.id, service: e.service, category: e.category, date: e.date, expected_by: e.expectedBy || '', notes: e.notes || '', total, received: rec, remaining: Math.max(0, total - rec), status: invoiceStatus(e), payments: pays };
  });
}
async function clientTaskRows(env, user, taskId) {
  if (!user.linked_id) return [];
  const sql = `SELECT t.data FROM tasks t JOIN cu_lists l ON l.id=t.list_id WHERE l.client_id=?${taskId ? ' AND t.id=?' : ''} ORDER BY t.due_date IS NULL, t.due_date, t.rowid`;
  return (await env.DB.prepare(sql).bind(...(taskId ? [user.linked_id, taskId] : [user.linked_id])).all()).results;
}
async function clientChannel(env, user) {
  if (!user.linked_id) return null;
  return await env.DB.prepare('SELECT id,name FROM channels WHERE client_id=? ORDER BY permanent DESC, rowid LIMIT 1').bind(user.linked_id).first();
}

/* --------------------------------------------------------------- messaging */
async function canAccessChannel(env, user, channelId) {
  const ch = await env.DB.prepare('SELECT id,name,client_id FROM channels WHERE id=?').bind(channelId).first();
  if (!ch) throw notFound('Channel not found');
  if (user.role === 'admin') return ch;
  if (user.role === 'client') { if (ch.client_id && ch.client_id === user.linked_id) return ch; throw forbidden(); }
  const m = await env.DB.prepare('SELECT 1 FROM channel_members WHERE channel_id=? AND user_id=?').bind(channelId, user.id).first();
  if (!m) throw forbidden('You are not a member of this channel');
  return ch;
}
function cleanText(t) { const s = String(t || '').trim(); if (!s) throw bad('Message is empty'); if (s.length > 4000) throw bad('Message is too long'); return s; }
async function postChannel(req, env, user) {
  const b = await readBody(req); const ch = await canAccessChannel(env, user, String(b.channel_id || ''));
  const msg = { id: uid(), channel_id: ch.id, author_id: user.id, author_name: user.name, text: cleanText(b.text), timestamp: nowIso(), reply_to: str(b.reply_to) };
  await env.DB.prepare('INSERT INTO channel_messages (id,channel_id,author_id,author_name,text,timestamp,reply_to) VALUES (?,?,?,?,?,?,?)').bind(msg.id, msg.channel_id, msg.author_id, msg.author_name, msg.text, msg.timestamp, msg.reply_to).run();
  await notifyRoom(env, 'channel:' + ch.id, { t: 'msg', msg: { id: msg.id, room: 'channel:' + ch.id, author_id: msg.author_id, author_name: msg.author_name, text: msg.text, ts: msg.timestamp, deleted: false, edited_at: null, reply_to: msg.reply_to, reactions: {} } });
  return msg;
}
async function getChannel(env, user, id, url) {
  await canAccessChannel(env, user, id);
  const after = url.searchParams.get('after');
  const rs = await env.DB.prepare(`SELECT id,channel_id,author_id,author_name,text,timestamp,reply_to FROM channel_messages WHERE channel_id=?${after ? ' AND timestamp>?' : ''} ORDER BY timestamp DESC LIMIT 500`).bind(...(after ? [id, after] : [id])).all();
  return { messages: rs.results.reverse(), me: user.id };
}
async function resolveDmPeer(env, user, to) {
  if (user.role === 'client') throw forbidden('Clients can only use their #general channel');
  if (user.role === 'admin' && /^emp:/.test(to)) {
    if (!(await env.DB.prepare('SELECT 1 FROM employees WHERE id=?').bind(to.slice(4)).first())) throw notFound('Employee not found');
    return { id: to, name: null };
  }
  const p = await env.DB.prepare('SELECT id,name,role,active FROM users WHERE id=?').bind(to).first();
  if (!p || !p.active) throw notFound('Recipient not found');
  if (p.id === user.id) throw bad('You cannot message yourself');
  if (!['admin', 'employee'].includes(p.role)) throw forbidden('You cannot message this person');
  return p;
}
async function postDm(req, env, user) {
  const b = await readBody(req); const peer = await resolveDmPeer(env, user, String(b.to_id || ''));
  const msg = { id: uid(), from_id: user.id, to_id: peer.id, from_name: user.name, text: cleanText(b.text), timestamp: nowIso(), reply_to: str(b.reply_to) };
  await env.DB.prepare('INSERT INTO dm_messages (id,from_id,to_id,from_name,text,timestamp,reply_to) VALUES (?,?,?,?,?,?,?)').bind(msg.id, msg.from_id, msg.to_id, msg.from_name, msg.text, msg.timestamp, msg.reply_to).run();
  const room = roomKey('dm', null, [user.id, peer.id]);
  await notifyRoom(env, room, { t: 'msg', msg: { id: msg.id, room, author_id: user.id, author_name: user.name, text: msg.text, ts: msg.timestamp, seen: false, deleted: false, edited_at: null, reply_to: msg.reply_to, reactions: {} } });
  return msg;
}
async function getDm(env, user, other, url) {
  const peer = await resolveDmPeer(env, user, other);
  const after = url.searchParams.get('after');
  const rs = await env.DB.prepare(`SELECT id,from_id,to_id,from_name,text,timestamp,reply_to FROM dm_messages WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))${after ? ' AND timestamp>?' : ''} ORDER BY timestamp DESC LIMIT 500`)
    .bind(...[user.id, peer.id, peer.id, user.id, ...(after ? [after] : [])]).all();
  return { messages: rs.results.reverse(), me: user.id };
}

/* ------------------------------------------------------------- attendance */
async function getWorkSettings(env) {
  const r = (await env.DB.prepare('SELECT * FROM work_settings WHERE id=1').first()) || {};
  return { start_time: r.start_time || '10:00', end_time: r.end_time || '18:00', working_days: String(r.working_days ?? '1,2,3,4,5').split(',').filter(x => x !== '').map(Number),
    alert_minutes: r.alert_minutes ?? 60, half_day_hours: r.half_day_hours ?? 4, timezone: r.timezone || 'Asia/Karachi', tracking_start: r.tracking_start || '1970-01-01' };
}
const hmToMin = s => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); if (!m) return null; const h = +m[1], mi = +m[2]; return h < 24 && mi < 60 ? h * 60 + mi : null; };
function zoneParts(ms, tz) {
  const o = {}; new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(ms)).forEach(p => { o[p.type] = p.value; });
  return { date: `${o.year}-${o.month}-${o.day}`, min: (+o.hour) * 60 + (+o.minute), utc: Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute, +o.second) };
}
const zoneOffset = (ms, tz) => zoneParts(ms, tz).utc - Math.floor(ms / 1000) * 1000;
/** "10:30" on a local date in the work timezone → ISO UTC */
function zonedToIso(date, hm, tz) {
  const [y, m, d] = date.split('-').map(Number), mins = hmToMin(hm), guess = Date.UTC(y, m - 1, d, Math.floor(mins / 60), mins % 60);
  let t = guess - zoneOffset(guess, tz); t = guess - zoneOffset(t, tz); return new Date(t).toISOString();
}
const attNow = settings => { const ms = Date.now(), z = zoneParts(ms, settings.timezone); return { date: z.date, min: z.min, iso: new Date(ms).toISOString() }; };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !isNaN(Date.parse(s + 'T00:00:00Z'));
const addDays = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

/** first check-in decides Late; a finished day under the half-day threshold is a Half Day */
function summarize(sessions, settings) {
  const s = sessions.slice().sort((a, b) => a.check_in.localeCompare(b.check_in));
  const open = s.some(x => !x.check_out);
  const hours = s.reduce((t, x) => x.check_out ? t + Math.max(0, (Date.parse(x.check_out) - Date.parse(x.check_in)) / 36e5) : t, 0);
  const first = s[0] ? s[0].check_in : null;
  const late = first ? zoneParts(Date.parse(first), settings.timezone).min > hmToMin(settings.start_time) : false;
  const status = (!open && s.length && hours < settings.half_day_hours) ? 'Half Day' : late ? 'Late' : 'Present';
  return { check_in: first, check_out: open || !s.length ? null : s[s.length - 1].check_out, total_hours: Math.round(hours * 100) / 100, status };
}
async function refreshLog(env, logId, settings) {
  const sessions = (await env.DB.prepare('SELECT id,check_in,check_out FROM attendance_sessions WHERE attendance_id=?').bind(logId).all()).results;
  const r = summarize(sessions, settings);
  await env.DB.prepare('UPDATE attendance_logs SET check_in=?,check_out=?,total_hours=?,status=?,updated_at=? WHERE id=?').bind(r.check_in, r.check_out, r.total_hours, r.status, Date.now(), logId).run();
}
async function attLogs(env, where, binds) {
  const logs = (await env.DB.prepare(`SELECT id,employee_id,date,check_in,check_out,total_hours,status,activity_note,active_task_id FROM attendance_logs WHERE ${where} ORDER BY date, check_in`).bind(...binds).all()).results;
  const sess = {}, tasks = {};
  for (const part of chunk(logs.map(l => l.id), 80)) {
    const q = part.map(() => '?').join(',');
    (await env.DB.prepare(`SELECT id,attendance_id,check_in,check_out FROM attendance_sessions WHERE attendance_id IN (${q}) ORDER BY check_in`).bind(...part).all()).results.forEach(x => { (sess[x.attendance_id] = sess[x.attendance_id] || []).push({ id: x.id, check_in: x.check_in, check_out: x.check_out }); });
    (await env.DB.prepare(`SELECT attendance_id,task_id FROM attendance_task_logs WHERE attendance_id IN (${q})`).bind(...part).all()).results.forEach(x => { (tasks[x.attendance_id] = tasks[x.attendance_id] || []).push(x.task_id); });
  }
  return logs.map(l => ({ ...l, sessions: sess[l.id] || [], task_ids: tasks[l.id] || [] }));
}
async function taskTitles(env, logs) {
  const ids = [...new Set(logs.flatMap(l => l.task_ids))], out = {};
  for (const part of chunk(ids, 80)) (await env.DB.prepare(`SELECT id,title FROM tasks WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results.forEach(t => { out[t.id] = t.title; });
  return out;
}
const needEmp = user => { if (!user.linked_id) throw forbidden('Your account is not linked to an employee record'); return user.linked_id; };

/** sessions left open from an earlier day are closed at that day's official end (never later than now) */
async function closeStale(env, empId, settings, todayDate) {
  const rows = (await env.DB.prepare(`SELECT x.id, x.check_in, l.id AS log_id, l.date FROM attendance_sessions x JOIN attendance_logs l ON l.id=x.attendance_id WHERE l.employee_id=? AND x.check_out IS NULL AND l.date<?`).bind(empId, todayDate).all()).results;
  for (const r of rows) {
    const endIso = zonedToIso(r.date, settings.end_time, settings.timezone), at = endIso > r.check_in ? endIso : r.check_in;
    await env.DB.prepare('UPDATE attendance_sessions SET check_out=? WHERE id=?').bind(at, r.id).run();
    await refreshLog(env, r.log_id, settings);
  }
  return rows.length;
}
async function empAttendanceToday(env, user) {
  const empId = needEmp(user), settings = await getWorkSettings(env), now = attNow(settings);
  const [log] = await attLogs(env, 'employee_id=? AND date=?', [empId, now.date]);
  const stale = await env.DB.prepare(`SELECT l.date, x.check_in FROM attendance_sessions x JOIN attendance_logs l ON l.id=x.attendance_id WHERE l.employee_id=? AND x.check_out IS NULL AND l.date<? LIMIT 1`).bind(empId, now.date).first();
  const rows = await empTaskRows(env, empId);
  const mineT = rows.map(r => safeJson(r.data, null)).filter(Boolean).map(t => ({ id: t.id, title: t.title, due: t.due || '', status: t.status }));
  const extra = (log ? log.task_ids : []).filter(id => !mineT.some(t => t.id === id));   // tasks linked to today's log that are not assigned to them
  if (log && log.active_task_id && !extra.includes(log.active_task_id) && !mineT.some(t => t.id === log.active_task_id)) extra.push(log.active_task_id);
  for (const id of extra) { const r = await env.DB.prepare('SELECT data FROM tasks WHERE id=?').bind(id).first(), t = r && safeJson(r.data, null); if (t) mineT.push({ id: t.id, title: t.title, due: t.due || '', status: t.status }); }
  const my_tasks = mineT;
  return { settings, now, log: log || null, stale_open: stale || null, my_tasks };
}
async function empCheckIn(env, user) {
  const empId = needEmp(user), settings = await getWorkSettings(env), now = attNow(settings);
  await closeStale(env, empId, settings, now.date);
  await env.DB.prepare('INSERT OR IGNORE INTO attendance_logs (id,employee_id,date,status,updated_at) VALUES (?,?,?,?,?)').bind(uid(), empId, now.date, 'Present', Date.now()).run();
  const log = await env.DB.prepare('SELECT id FROM attendance_logs WHERE employee_id=? AND date=?').bind(empId, now.date).first();
  const ins = await env.DB.prepare(`INSERT INTO attendance_sessions (id,attendance_id,check_in) SELECT ?,?,? WHERE NOT EXISTS (SELECT 1 FROM attendance_sessions WHERE attendance_id=? AND check_out IS NULL)`).bind(uid(), log.id, now.iso, log.id).run();
  if (!ins.meta.changes) throw new HttpError(409, 'You are already checked in');
  await refreshLog(env, log.id, settings);
  return empAttendanceToday(env, user);
}
async function empCheckOut(env, user) {
  const empId = needEmp(user), settings = await getWorkSettings(env), now = attNow(settings);
  const open = await env.DB.prepare(`SELECT x.id, x.check_in, l.id AS log_id, l.date FROM attendance_sessions x JOIN attendance_logs l ON l.id=x.attendance_id WHERE l.employee_id=? AND x.check_out IS NULL ORDER BY x.check_in DESC LIMIT 1`).bind(empId).first();
  if (!open) throw new HttpError(409, 'You are not checked in');
  let at = now.iso, note = null;
  if (open.date < now.date) { const endIso = zonedToIso(open.date, settings.end_time, settings.timezone); at = endIso > open.check_in ? endIso : open.check_in; note = 'You did not check out on ' + open.date + ' — it was closed at the official end time. Ask an admin to correct it if that is wrong.'; }
  await env.DB.prepare('UPDATE attendance_sessions SET check_out=? WHERE id=?').bind(at, open.id).run();
  await refreshLog(env, open.log_id, settings);
  return { ...(await empAttendanceToday(env, user)), notice: note };
}
async function empReport(req, env, user) {
  const empId = needEmp(user), b = await readBody(req), settings = await getWorkSettings(env), now = attNow(settings);
  const date = b.date ? String(b.date) : now.date;
  if (!isDate(date) || date > now.date || date < addDays(now.date, -7)) throw bad('You can only edit reports from the last 7 days');
  const log = await env.DB.prepare('SELECT id FROM attendance_logs WHERE employee_id=? AND date=?').bind(empId, date).first();
  if (!log) throw bad('Check in first — there is no attendance record for that day');
  const note = String(b.activity_note || '').slice(0, 4000);
  const asked = [...new Set((Array.isArray(b.task_ids) ? b.task_ids : []).map(String))].slice(0, 100), real = new Set();
  for (const part of chunk(asked, 80)) (await env.DB.prepare(`SELECT id FROM tasks WHERE id IN (${part.map(() => '?').join(',')})`).bind(...part).all()).results.forEach(t => real.add(t.id));
  const ids = asked.filter(id => real.has(id));
  await env.DB.batch([env.DB.prepare('UPDATE attendance_logs SET activity_note=?,updated_at=? WHERE id=?').bind(note, Date.now(), log.id), env.DB.prepare('DELETE FROM attendance_task_logs WHERE attendance_id=?').bind(log.id),
    ...ids.map(t => env.DB.prepare('INSERT INTO attendance_task_logs (attendance_id,task_id) VALUES (?,?)').bind(log.id, t))]);
  return empAttendanceToday(env, user);
}
async function empAttendanceMonth(env, user, month) {
  const empId = needEmp(user), settings = await getWorkSettings(env), now = attNow(settings);
  if (!/^\d{4}-\d{2}$/.test(month || '')) month = now.date.slice(0, 7);
  const logs = await attLogs(env, 'employee_id=? AND date>=? AND date<=?', [empId, month + '-01', month + '-31']);
  const emp = safeJson((await env.DB.prepare('SELECT data FROM employees WHERE id=?').bind(empId).first() || {}).data, {});
  const acct = await env.DB.prepare('SELECT u.created_at FROM users u JOIN employee_user eu ON eu.user_id=u.id WHERE eu.employee_id=?').bind(empId).first();
  const since = String((acct && acct.created_at) || '').slice(0, 10);
  const leaves = (await env.DB.prepare('SELECT date,type FROM employee_leaves WHERE employee_id=? AND date>=? AND date<=?').bind(empId, month + '-01', month + '-31').all()).results;
  return { settings, now, month, logs, join_date: [emp.joinDate || '', since].sort().pop(), leaves, task_titles: await taskTitles(env, logs) };
}

async function adminAttendance(env, url) {
  const settings = await getWorkSettings(env), now = attNow(settings);
  let from = url.searchParams.get('from') || now.date, to = url.searchParams.get('to') || from;
  if (!isDate(from) || !isDate(to) || to < from) throw bad('Invalid date range');
  if (Date.parse(to) - Date.parse(from) > 400 * 864e5) throw bad('Range too large');
  const logs = await attLogs(env, 'date>=? AND date<=?', [from, to]);
  return { settings, now, from, to, logs, task_titles: await taskTitles(env, logs) };
}
/** today's records + anything still open from the last 2 weeks (for the dashboard + alerts) */
async function adminAttendanceOverview(env) {
  const settings = await getWorkSettings(env), now = attNow(settings), since = addDays(now.date, -14);
  const logs = await attLogs(env, `date=? OR (check_out IS NULL AND date>=? AND date<?)`, [now.date, since, now.date]);
  return { settings, now, logs, task_titles: await taskTitles(env, logs) };
}
async function putWorkSettings(req, env) {
  const b = await readBody(req), cur = await getWorkSettings(env);
  const start = b.start_time ?? cur.start_time, end = b.end_time ?? cur.end_time;
  if (hmToMin(start) === null || hmToMin(end) === null) throw bad('Times must look like 10:00');
  if (hmToMin(end) <= hmToMin(start)) throw bad('End time must be after the start time');
  const days = b.working_days !== undefined ? [...new Set((Array.isArray(b.working_days) ? b.working_days : String(b.working_days).split(',')).map(Number))].filter(d => Number.isInteger(d) && d >= 0 && d <= 6).sort() : cur.working_days;
  if (!days.length) throw bad('Pick at least one working day');
  const alertMin = b.alert_minutes !== undefined ? Math.round(+b.alert_minutes) : cur.alert_minutes, half = b.half_day_hours !== undefined ? +b.half_day_hours : cur.half_day_hours, tz = b.timezone ?? cur.timezone;
  if (!(alertMin >= 0 && alertMin <= 480)) throw bad('Alert delay must be 0–480 minutes');
  if (!(half >= 0 && half <= 12)) throw bad('Half-day hours must be 0–12');
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); } catch { throw bad('Unknown timezone'); }
  const ts = b.tracking_start !== undefined ? String(b.tracking_start) : cur.tracking_start;
  if (!isDate(ts)) throw bad('Pick a valid date to start counting attendance from');
  await env.DB.prepare('UPDATE work_settings SET start_time=?,end_time=?,working_days=?,alert_minutes=?,half_day_hours=?,timezone=?,tracking_start=? WHERE id=1').bind(start, end, days.join(','), alertMin, half, tz, ts).run();
  // statuses depend on the settings → recompute recent logs so Late / Half Day stay consistent
  const s = await getWorkSettings(env), logs = (await env.DB.prepare('SELECT id FROM attendance_logs WHERE date>=?').bind(addDays(attNow(s).date, -62)).all()).results;
  for (const l of logs) await refreshLog(env, l.id, s);
  return { ok: true, settings: s };
}
/** admin: replace one employee's day with a single session (fix a forgotten check-out, or add a missed day) */
async function adminSetDay(req, env) {
  const b = await readBody(req), settings = await getWorkSettings(env), date = String(b.date || '');
  if (!isDate(date)) throw bad('Pick a date');
  if (!(await env.DB.prepare('SELECT 1 FROM employees WHERE id=?').bind(String(b.employee_id || '')).first())) throw notFound('Employee not found');
  if (hmToMin(b.check_in) === null) throw bad('Check-in time looks like 10:00');
  const hasOut = b.check_out !== undefined && b.check_out !== null && b.check_out !== '';
  if (hasOut && hmToMin(b.check_out) === null) throw bad('Check-out time looks like 18:00');
  const inIso = zonedToIso(date, b.check_in, settings.timezone), outIso = hasOut ? zonedToIso(date, b.check_out, settings.timezone) : null;
  if (outIso && outIso <= inIso) throw bad('Check-out must be after check-in');
  await env.DB.prepare('INSERT OR IGNORE INTO attendance_logs (id,employee_id,date,status,updated_at) VALUES (?,?,?,?,?)').bind(uid(), b.employee_id, date, 'Present', Date.now()).run();
  const log = await env.DB.prepare('SELECT id FROM attendance_logs WHERE employee_id=? AND date=?').bind(b.employee_id, date).first();
  const stmts = [env.DB.prepare('DELETE FROM attendance_sessions WHERE attendance_id=?').bind(log.id), env.DB.prepare('INSERT INTO attendance_sessions (id,attendance_id,check_in,check_out) VALUES (?,?,?,?)').bind(uid(), log.id, inIso, outIso)];
  if (b.activity_note !== undefined) stmts.push(env.DB.prepare('UPDATE attendance_logs SET activity_note=? WHERE id=?').bind(String(b.activity_note).slice(0, 4000), log.id));
  await env.DB.batch(stmts); await refreshLog(env, log.id, settings);
  return { ok: true, id: log.id };
}
async function adminDeleteDay(env, id) {
  await env.DB.batch([env.DB.prepare('DELETE FROM attendance_sessions WHERE attendance_id=?').bind(id), env.DB.prepare('DELETE FROM attendance_task_logs WHERE attendance_id=?').bind(id), env.DB.prepare('DELETE FROM attendance_logs WHERE id=?').bind(id)]);
  return { ok: true };
}

/* -------------------------------------------------- employee workspace (full task management) */
const PRIORITIES = ['urgent', 'high', 'normal', 'low'];
/** descriptions are HTML shown inside the admin app too → rebuild them from an allow-list, no attributes except safe link hrefs */
function cleanHtml(html) {
  const OK = new Set(['p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'div', 'h1', 'h2', 'h3', 'blockquote', 'code', 'pre']);
  const esc = t => t.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;)/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let out = '', last = 0, openA = 0; const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, str = String(html || '').slice(0, 20000); let m;
  while ((m = re.exec(str))) {
    out += esc(str.slice(last, m.index)); last = re.lastIndex;
    const name = m[2].toLowerCase();
    if (OK.has(name)) out += `<${m[1]}${name}>`;
    else if (name === 'a') { if (m[1]) { if (openA) { openA--; out += '</a>'; } } else { const href = /href\s*=\s*"(https?:\/\/[^"\s<>']+)"/i.exec(m[3]); if (href) { openA++; out += `<a href="${href[1]}" target="_blank" rel="noopener noreferrer">`; } } }
  }
  return out + esc(str.slice(last)) + '</a>'.repeat(openA);
}
async function activity(env, user, taskId, text) { await addComment(env, taskId, { by: user.name, author_id: user.id, text, kind: 'activity' }); }
async function tomb(env, key, ids) { const ts = Date.now(); for (const part of chunk(ids, 40)) if (part.length) await env.DB.batch(part.map(id => env.DB.prepare('INSERT OR REPLACE INTO tombstones (key,id,ts) VALUES (?,?,?)').bind(key, String(id), ts))); }

async function workspace(env, user) {
  const spaces = (await env.DB.prepare('SELECT data FROM cu_spaces ORDER BY rowid').all()).results.map(r => safeJson(r.data, null)).filter(Boolean).map(s => ({ id: s.id, name: s.name, color: s.color || '' }));   // no client link → nothing about the client's money
  const lists = (await env.DB.prepare('SELECT data FROM cu_lists ORDER BY rowid').all()).results.map(r => safeJson(r.data, null)).filter(Boolean).map(l => ({ id: l.id, spaceId: l.spaceId, name: l.name, color: l.color || '', statuses: l.statuses || [] }));
  const tasks = (await env.DB.prepare('SELECT data FROM tasks ORDER BY rowid').all()).results.map(r => safeJson(r.data, null)).filter(Boolean).map(t => ({
    id: t.id, listId: t.listId, title: t.title, status: t.status, assignees: t.assignees || [], due: t.due || '', priority: t.priority || 'normal', tags: t.tags || [], estimate: t.estimate || 0, created: t.created || '', repeat: t.repeat || '' }));
  const subs = {}; (await env.DB.prepare('SELECT task_id, COUNT(*) n, SUM(completed) d FROM subtasks GROUP BY task_id').all()).results.forEach(r => { subs[r.task_id] = [r.n, r.d || 0]; });
  const people = (await env.DB.prepare('SELECT id,name,data FROM employees ORDER BY name').all()).results.map(e => ({ id: e.id, name: e.name, d: safeJson(e.data, {}) })).filter(e => !e.d.archived && (e.d.status === 'Active' || e.d.status === 'On Leave')).map(e => ({ id: e.id, name: e.name }));   // names only — never salary or HR data
  return { me: user.linked_id, spaces, lists, tasks: tasks.map(t => ({ ...t, sub_total: (subs[t.id] || [0, 0])[0], sub_done: (subs[t.id] || [0, 0])[1] })), people };
}
async function taskDetail(env, user, id) {
  const task = await ownTask(env, user, id);
  const subtasks = (await env.DB.prepare('SELECT id,title,completed FROM subtasks WHERE task_id=? ORDER BY rowid').bind(id).all()).results.map(s => ({ id: s.id, title: s.title, done: !!s.completed }));
  const comments = (await env.DB.prepare('SELECT id,author_id,author_name,text,timestamp,kind FROM task_comments WHERE task_id=? ORDER BY timestamp').bind(id).all()).results.map(c => ({ id: c.id, by: c.author_name, author_id: c.author_id, text: c.text, at: c.timestamp, kind: c.kind }));
  const time = (await env.DB.prepare('SELECT data FROM task_time_logs WHERE task_id=? ORDER BY rowid').bind(id).all()).results.map(r => safeJson(r.data, null)).filter(Boolean);
  const list = await loadList(env, task.listId);
  return { task: { ...task, description: task.description || '' }, subtasks, comments, time_logs: time, statuses: list ? list.statuses || [] : [] };
}
async function createTask(req, env, user) {
  const b = await readBody(req), list = await loadList(env, String(b.list_id || ''));
  if (!list) throw bad('Pick a list for the task');
  const title = String(b.title || '').trim().slice(0, 300); if (!title) throw bad('Give the task a title');
  const first = (list.statuses || []).find(s => s.kind === 'open') || (list.statuses || [])[0];
  const status = b.status && (list.statuses || []).some(s => s.id === b.status) ? b.status : (first ? first.id : '');
  const t = { id: uid(), listId: list.id, title, description: cleanHtml(b.description), assignees: await validAssignees(env, b.assignees), due: isDate(b.due) ? b.due : '', start: '', priority: PRIORITIES.includes(b.priority) ? b.priority : 'normal', status, tags: [], estimate: 0, repeat: '', repeatDays: 7, created: nowIso() };
  await writeTask(env, t); await activity(env, user, t.id, 'created this task');
  return taskDetail(env, user, t.id);
}
async function validAssignees(env, ids) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(String))].slice(0, 30); if (!want.length) return [];
  return (await env.DB.prepare(`SELECT id FROM employees WHERE id IN (${want.map(() => '?').join(',')})`).bind(...want).all()).results.map(r => r.id);
}
async function patchTask(req, env, user, id) {
  const b = await readBody(req), t = await ownTask(env, user, id), list = await loadList(env, t.listId), names = {};
  (await env.DB.prepare('SELECT id,name FROM employees').all()).results.forEach(e => { names[e.id] = e.name; });
  if (b.title !== undefined) { const v = String(b.title).trim().slice(0, 300); if (!v) throw bad('Title cannot be empty'); if (v !== t.title) { t.title = v; } }
  if (b.description !== undefined) t.description = cleanHtml(b.description);
  if (b.due !== undefined) { const v = b.due === '' || b.due === null ? '' : String(b.due); if (v && !isDate(v)) throw bad('Invalid due date'); if (v !== (t.due || '')) { t.due = v; await activity(env, user, id, v ? 'changed the due date to ' + v : 'cleared the due date'); } }
  if (b.priority !== undefined) { if (!PRIORITIES.includes(b.priority)) throw bad('Invalid priority'); if (b.priority !== (t.priority || 'normal')) { t.priority = b.priority; await activity(env, user, id, 'set priority to ' + b.priority); } }
  if (b.assignees !== undefined) {
    const next = await validAssignees(env, b.assignees), prev = t.assignees || [];
    if (next.join() !== prev.join()) { t.assignees = next; const add = next.filter(x => !prev.includes(x)).map(x => names[x]), rem = prev.filter(x => !next.includes(x)).map(x => names[x]).filter(Boolean);
      await activity(env, user, id, [add.length ? 'assigned ' + add.join(', ') : '', rem.length ? 'unassigned ' + rem.join(', ') : ''].filter(Boolean).join(' · ') || 'cleared the assignees'); }
  }
  if (b.tags !== undefined && Array.isArray(b.tags)) t.tags = b.tags.map(x => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
  if (b.estimate !== undefined) { const v = +b.estimate; if (!(v >= 0 && v <= 10000)) throw bad('Invalid estimate'); t.estimate = v; }
  if (b.status !== undefined && b.status !== t.status) { if (!list || !(list.statuses || []).some(s => s.id === b.status)) throw bad('That status does not exist in this list'); await setTaskStatus(env, user, t, String(b.status)); }
  else await writeTask(env, t);
  return taskDetail(env, user, id);
}
async function deleteTask(env, user, id) {
  await ownTask(env, user, id);
  const sub = (await env.DB.prepare('SELECT id FROM subtasks WHERE task_id=?').bind(id).all()).results.map(r => r.id), cm = (await env.DB.prepare('SELECT id FROM task_comments WHERE task_id=?').bind(id).all()).results.map(r => r.id), tl = (await env.DB.prepare('SELECT id FROM task_time_logs WHERE task_id=?').bind(id).all()).results.map(r => r.id);
  await env.DB.batch([env.DB.prepare('DELETE FROM subtasks WHERE task_id=?').bind(id), env.DB.prepare('DELETE FROM task_comments WHERE task_id=?').bind(id), env.DB.prepare('DELETE FROM task_time_logs WHERE task_id=?').bind(id),
    env.DB.prepare('DELETE FROM attendance_task_logs WHERE task_id=?').bind(id), env.DB.prepare('UPDATE attendance_logs SET active_task_id=NULL WHERE active_task_id=?').bind(id), env.DB.prepare('DELETE FROM tasks WHERE id=?').bind(id)]);
  await tomb(env, 'cu_tasks', [id]); await tomb(env, 'cu_subtasks', sub); await tomb(env, 'cu_comments', cm); await tomb(env, 'cu_time_logs', tl);
  return { ok: true };
}
async function addSubtask(req, env, user, taskId) {
  await ownTask(env, user, taskId); const title = String((await readBody(req)).title || '').trim().slice(0, 300); if (!title) throw bad('Write the subtask');
  const s = { id: uid(), taskId, title, done: false }, c = COLLECTIONS.cu_subtasks;
  await upsertStmt(env, c).bind(s.id, ...c.row(s), JSON.stringify(s), Date.now()).run(); return { subtask: s };
}
async function patchSubtask(req, env, user, id) {
  const row = await env.DB.prepare('SELECT data FROM subtasks WHERE id=?').bind(id).first(), s = row && safeJson(row.data, null); if (!s) throw notFound();
  await ownTask(env, user, s.taskId); const b = await readBody(req);
  if (b.done !== undefined) s.done = !!b.done; if (b.title !== undefined && String(b.title).trim()) s.title = String(b.title).trim().slice(0, 300);
  const c = COLLECTIONS.cu_subtasks; await upsertStmt(env, c).bind(s.id, ...c.row(s), JSON.stringify(s), Date.now()).run(); return { subtask: { id: s.id, title: s.title, done: s.done } };
}
async function deleteSubtask(env, user, id) {
  const row = await env.DB.prepare('SELECT data FROM subtasks WHERE id=?').bind(id).first(), s = row && safeJson(row.data, null); if (!s) throw notFound();
  await ownTask(env, user, s.taskId); await env.DB.prepare('DELETE FROM subtasks WHERE id=?').bind(id).run(); await tomb(env, 'cu_subtasks', [id]); return { ok: true };
}
async function logTime(req, env, user, taskId) {
  await ownTask(env, user, taskId); const b = await readBody(req), hours = +b.hours;
  if (!(hours > 0 && hours <= 24)) throw bad('Enter hours between 0 and 24');
  const settings = await getWorkSettings(env), t = { id: uid(), taskId, hours: Math.round(hours * 100) / 100, date: isDate(b.date) ? b.date : attNow(settings).date, note: String(b.note || '').trim().slice(0, 500), by: user.name, author_id: user.id }, c = COLLECTIONS.cu_time_logs;
  await upsertStmt(env, c).bind(t.id, ...c.row(t), JSON.stringify(t), Date.now()).run(); return { time_log: t };
}
async function deleteTime(env, user, id) {
  const row = await env.DB.prepare('SELECT data FROM task_time_logs WHERE id=?').bind(id).first(), t = row && safeJson(row.data, null); if (!t) throw notFound();
  if (t.author_id && t.author_id !== user.id) throw forbidden('You can only remove your own time entries');
  await env.DB.prepare('DELETE FROM task_time_logs WHERE id=?').bind(id).run(); await tomb(env, 'cu_time_logs', [id]); return { ok: true };
}
async function linkActiveTask(req, env, user) {
  const empId = needEmp(user), b = await readBody(req), settings = await getWorkSettings(env), now = attNow(settings);
  const log = await env.DB.prepare('SELECT id FROM attendance_logs WHERE employee_id=? AND date=?').bind(empId, now.date).first();
  if (!log) throw bad('Check in first, then pick the task you are working on');
  if (b.task_id) { await ownTask(env, user, String(b.task_id)); await env.DB.batch([env.DB.prepare('UPDATE attendance_logs SET active_task_id=?,updated_at=? WHERE id=?').bind(String(b.task_id), Date.now(), log.id), env.DB.prepare('INSERT OR IGNORE INTO attendance_task_logs (attendance_id,task_id) VALUES (?,?)').bind(log.id, String(b.task_id))]); }
  else await env.DB.prepare('UPDATE attendance_logs SET active_task_id=NULL,updated_at=? WHERE id=?').bind(Date.now(), log.id).run();
  return empAttendanceToday(env, user);
}

/* ---------------------------------------------------------------- real-time chat plumbing */
async function notifyRoom(env, room, event) {
  if (!env.CHAT_ROOM) return;
  try { await env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(room)).fetch('https://chat.internal/notify', { method: 'POST', body: JSON.stringify({ event }) }); } catch (e) { /* live delivery is best-effort; history is already saved */ }
}
/** Verifies the caller may enter the room and returns its description {room,type,id,pair?}. kind: channel | dm | task */
async function chatRoomFor(env, user, kind, id) {
  if (kind === 'channel') { const ch = await canAccessChannel(env, user, id); return { room: roomKey('channel', ch.id), type: 'channel', id: ch.id, name: ch.name }; }
  if (kind === 'dm') { const peer = await resolveDmPeer(env, user, id); return { room: roomKey('dm', null, [user.id, peer.id]), type: 'dm', pair: [user.id, peer.id] }; }
  if (kind === 'task') {
    const r = await env.DB.prepare('SELECT t.id, l.client_id FROM tasks t LEFT JOIN cu_lists l ON l.id=t.list_id WHERE t.id=?').bind(id).first();
    if (!r) throw notFound('Task not found');
    if (user.role === 'client' && !(r.client_id && r.client_id === user.linked_id)) throw forbidden('That task is not part of your projects');
    return { room: roomKey('task', r.id), type: 'task', id: r.id };
  }
  throw notFound();
}
function checkOrigin(req, env) {   // a WebSocket handshake is not covered by CORS, so enforce the allow-list ourselves
  const origin = req.headers.get('Origin'); if (!origin) return;
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!allowed.includes(origin)) throw forbidden('Origin not allowed');
}
async function wsUpgrade(req, env, seg) {
  if (req.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'Expected a WebSocket connection');
  checkOrigin(req, env);
  const user = await authenticate(req, env, null, true);   // JWT from ?token= is verified before anything is upgraded
  const meta = await chatRoomFor(env, user, seg[2], decodeURIComponent(seg[3] || ''));
  const stub = env.CHAT_ROOM.get(env.CHAT_ROOM.idFromName(meta.room)), h = new Headers(req.headers);
  h.set('X-Chat-User', JSON.stringify({ id: user.id, name: user.name, role: user.role, linked_id: user.linked_id }));
  h.set('X-Chat-Room', JSON.stringify(meta));
  return stub.fetch(new Request('https://chat.internal/ws', { method: 'GET', headers: h }));
}
const ONLINE_WINDOW_MS = 150000;
async function chatUnread(env, user) {
  const since = new Date(Date.now() - 7 * 864e5).toISOString(), out = { channels: {}, dms: {}, total: 0 };
  let ids = [];
  if (user.role === 'admin') ids = (await env.DB.prepare('SELECT id FROM channels').all()).results.map(r => r.id);
  else if (user.role === 'employee') ids = (await env.DB.prepare('SELECT channel_id AS id FROM channel_members WHERE user_id=?').bind(user.id).all()).results.map(r => r.id);
  else if (user.linked_id) ids = (await env.DB.prepare('SELECT id FROM channels WHERE client_id=?').bind(user.linked_id).all()).results.map(r => r.id);
  for (const part of chunk(ids, 80)) {
    (await env.DB.prepare(`SELECT m.channel_id AS id, COUNT(*) AS n FROM channel_messages m LEFT JOIN chat_reads r ON r.user_id=? AND r.room='channel:'||m.channel_id
      WHERE m.channel_id IN (${part.map(() => '?').join(',')}) AND m.deleted=0 AND COALESCE(m.author_id,'')<>? AND m.timestamp>COALESCE(r.last_read,?) GROUP BY m.channel_id`).bind(user.id, ...part, user.id, since).all()).results.forEach(r => { out.channels[r.id] = r.n; out.total += r.n; });
  }
  if (user.role !== 'client') {
    (await env.DB.prepare(`SELECT m.from_id AS id, COUNT(*) AS n FROM dm_messages m LEFT JOIN chat_reads r ON r.user_id=? AND r.room=(CASE WHEN m.from_id<m.to_id THEN 'dm:'||REPLACE(m.from_id,':','~')||':'||REPLACE(m.to_id,':','~') ELSE 'dm:'||REPLACE(m.to_id,':','~')||':'||REPLACE(m.from_id,':','~') END)
      WHERE m.to_id=? AND m.deleted=0 AND m.timestamp>COALESCE(r.last_read,?) GROUP BY m.from_id`).bind(user.id, user.id, since).all()).results.forEach(r => { out.dms[r.id] = r.n; out.total += r.n; });
  }
  return out;
}
async function chatPresence(env, user) {
  if (user.role === 'client') return { online: [] };   // clients never learn who is on the team
  const since = new Date(Date.now() - ONLINE_WINDOW_MS).toISOString();
  return { online: (await env.DB.prepare("SELECT user_id FROM user_presence WHERE status='online' AND last_seen>?").bind(since).all()).results.map(r => r.user_id) };
}

/* ------------------------------------------------------------------ router */
async function route(req, env, url) {
  const path = url.pathname.replace(/\/+$/, '') || '/', method = req.method, seg = path.split('/').filter(Boolean);
  if (path === '/api/health') return { ok: true, time: nowIso() };

  if (path === '/api/auth/login' && method === 'POST') return login(req, env);
  if (path === '/api/auth/me' && method === 'GET') { const u = await authenticate(req, env); return { user: u }; }
  if (path === '/api/auth/change-password' && method === 'POST') {
    const u = await authenticate(req, env); const { current_password, new_password } = await readBody(req);
    if (String(new_password || '').length < 8) throw bad('New password must be at least 8 characters');
    const row = await env.DB.prepare('SELECT password_hash FROM users WHERE id=?').bind(u.id).first();
    if (!(await verifyPassword(String(current_password || ''), row.password_hash))) throw new HttpError(401, 'Current password is incorrect');
    await env.DB.prepare('UPDATE users SET password_hash=? WHERE id=?').bind(await hashPassword(String(new_password)), u.id).run();
    return { ok: true };
  }

  if (seg[0] === 'api' && seg[1] === 'ws' && seg.length === 4 && method === 'GET') return wsUpgrade(req, env, seg);
  if (seg[0] === 'api' && seg[1] === 'chat') {
    if (seg[2] === 'offline') { const u = await authenticate(req, env, null, true); await touchPresence(env, u.id, 'offline'); return { ok: true }; }   // sendBeacon from pagehide (token in the query)
    const user = await authenticate(req, env);
    if (seg[2] === 'unread' && method === 'GET') return chatUnread(env, user);
    if (seg[2] === 'presence' && method === 'GET') return chatPresence(env, user);
    if (seg[2] === 'heartbeat' && method === 'POST') { await touchPresence(env, user.id, 'online'); return { ok: true }; }
    if (seg[2] === 'history' && method === 'GET') {   // polling fallback + older pages: ?kind=channel|dm|task&id=…&before=ISO
      const meta = await chatRoomFor(env, user, url.searchParams.get('kind'), url.searchParams.get('id') || '');
      return loadMessages(env, meta, user, { before: url.searchParams.get('before') || undefined, limit: url.searchParams.get('limit') });
    }
    if (seg[2] === 'send' && method === 'POST') {   // REST fallback while the WebSocket is down
      const b = await readBody(req), meta = await chatRoomFor(env, user, String(b.kind || ''), String(b.id || ''));
      try { const msg = await persistMessage(env, meta, user, { text: b.text, reply_to: b.reply_to, client_visible: b.client_visible }); await notifyRoom(env, meta.room, { t: 'msg', msg }); return { msg }; }
      catch (e) { if (e instanceof ChatError) throw bad(e.message); throw e; }
    }
    throw notFound();
  }

  /* messaging — shared by all roles, permission-checked per route */
  if (seg[0] === 'api' && seg[1] === 'messages') {
    const user = await authenticate(req, env);
    if (seg[2] === 'channel' && method === 'POST' && seg.length === 3) return postChannel(req, env, user);
    if (seg[2] === 'channel' && method === 'GET' && seg[3]) return getChannel(env, user, decodeURIComponent(seg[3]), url);
    if (seg[2] === 'dm' && method === 'POST' && seg.length === 3) return postDm(req, env, user);
    if (seg[2] === 'dm' && method === 'GET' && seg[3]) return getDm(env, user, decodeURIComponent(seg[3]), url);
    throw notFound();
  }

  if (seg[0] === 'api' && seg[1] === 'admin') {
    const admin = await authenticate(req, env, ['admin']);
    const r = seg.slice(2).join('/');
    if (r === 'state' && method === 'GET') return adminState(env);
    if (r === 'sync' && method === 'POST') return adminSync(req, env);
    if (r === 'changes' && method === 'GET') return adminChanges(env, +url.searchParams.get('since') || 0);
    if (r === 'import' && method === 'POST') return adminImport(req, env, admin);
    if (r === 'users' && method === 'GET') return { users: await listUsers(env) };
    if (r === 'users' && method === 'POST') return createUser(req, env);
    if (seg[2] === 'users' && seg[3] && method === 'PATCH') return patchUser(req, env, admin, seg[3]);
    if (r === 'channel_members' && method === 'POST') return setChannelMembers(req, env);
    if (seg[2] === 'dm' && seg[3] && method === 'DELETE') return clearDm(env, admin, decodeURIComponent(seg[3]));
    if (r === 'attendance' && method === 'GET') return adminAttendance(env, url);
    if (r === 'attendance/overview' && method === 'GET') return adminAttendanceOverview(env);
    if (r === 'attendance' && method === 'PUT') return adminSetDay(req, env);
    if (seg[2] === 'attendance' && seg[3] && seg.length === 4 && method === 'DELETE') return adminDeleteDay(env, seg[3]);
    if (r === 'work-settings' && method === 'GET') return { settings: await getWorkSettings(env) };
    if (r === 'work-settings' && method === 'PUT') return putWorkSettings(req, env);
    throw notFound();
  }

  if (seg[0] === 'api' && seg[1] === 'employee') {
    const user = await authenticate(req, env, ['employee']);
    const r = seg.slice(2).join('/');
    if (r === 'me' && method === 'GET') return employeeMe(env, user);
    if (r === 'tasks' && method === 'GET') { if (!user.linked_id) return { tasks: [], lists: {} }; return taskPayload(env, await empTaskRows(env, user.linked_id), { audience: 'employee' }); }
    if (seg[2] === 'tasks' && seg[3] && seg.length === 4 && method === 'PATCH') {
      const task = await ownTask(env, user, seg[3]); const { status } = await readBody(req);
      await setTaskStatus(env, user, task, String(status || ''));
      return taskPayload(env, await empTaskRows(env, user.linked_id, seg[3]), { audience: 'employee' });
    }
    if (seg[2] === 'tasks' && seg[3] && seg[4] === 'comments' && method === 'POST') {
      const task = await ownTask(env, user, seg[3]); const { text } = await readBody(req);
      return addComment(env, task.id, { by: user.name, author_id: user.id, text: cleanText(text) });
    }
    if (seg[2] === 'subtasks' && seg[3] && method === 'PATCH') return patchSubtask(req, env, user, seg[3]);
    if (r === 'workspace' && method === 'GET') return workspace(env, user);
    if (r === 'task' && method === 'POST') return createTask(req, env, user);
    if (seg[2] === 'task' && seg[3] && seg.length === 4 && method === 'GET') return taskDetail(env, user, seg[3]);
    if (seg[2] === 'task' && seg[3] && seg.length === 4 && method === 'PATCH') return patchTask(req, env, user, seg[3]);
    if (seg[2] === 'task' && seg[3] && seg.length === 4 && method === 'DELETE') return deleteTask(env, user, seg[3]);
    if (seg[2] === 'task' && seg[3] && seg[4] === 'subtasks' && method === 'POST') return addSubtask(req, env, user, seg[3]);
    if (seg[2] === 'task' && seg[3] && seg[4] === 'comments' && method === 'POST') { const t = await ownTask(env, user, seg[3]); return addComment(env, t.id, { by: user.name, author_id: user.id, text: cleanText((await readBody(req)).text) }); }
    if (seg[2] === 'task' && seg[3] && seg[4] === 'time' && method === 'POST') return logTime(req, env, user, seg[3]);
    if (seg[2] === 'time' && seg[3] && method === 'DELETE') return deleteTime(env, user, seg[3]);
    if (seg[2] === 'subtasks' && seg[3] && method === 'DELETE') return deleteSubtask(env, user, seg[3]);
    if (r === 'attendance/link-task' && method === 'POST') return linkActiveTask(req, env, user);
    if (r === 'attendance/today' && method === 'GET') return empAttendanceToday(env, user);
    if (r === 'attendance/check-in' && method === 'POST') return empCheckIn(env, user);
    if (r === 'attendance/check-out' && method === 'POST') return empCheckOut(env, user);
    if (r === 'attendance/report' && method === 'PUT') return empReport(req, env, user);
    if (r === 'attendance' && method === 'GET') return empAttendanceMonth(env, user, url.searchParams.get('month'));
    if (r === 'channels' && method === 'GET') return { channels: await employeeChannels(env, user) };
    if (r === 'contacts' && method === 'GET') return { contacts: await contacts(env, user) };
    throw notFound();
  }

  if (seg[0] === 'api' && seg[1] === 'client') {
    const user = await authenticate(req, env, ['client']);
    const r = seg.slice(2).join('/');
    if (r === 'me' && method === 'GET') {
      const c = user.linked_id ? await env.DB.prepare('SELECT id,name,contact,email,phone FROM clients WHERE id=?').bind(user.linked_id).first() : null;
      return { user: { id: user.id, name: user.name, email: user.email }, client: c };
    }
    if (r === 'invoices' && method === 'GET') return { invoices: await clientInvoices(env, user) };
    if (r === 'projects' && method === 'GET') return taskPayload(env, await clientTaskRows(env, user), { audience: 'client' });
    if (seg[2] === 'tasks' && seg[3] && seg[4] === 'comments' && method === 'POST') {
      const rows = await clientTaskRows(env, user, seg[3]); if (!rows.length) throw forbidden('That task does not belong to your projects');
      const { text } = await readBody(req);
      const c = await addComment(env, seg[3], { by: user.name, author_id: user.id, text: cleanText(text), client_visible: 1 });
      return c;
    }
    if (r === 'channel' && method === 'GET') return { channel: await clientChannel(env, user) };
    throw notFound();
  }
  throw notFound();
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    if (!url.pathname.startsWith('/api/')) return respond(req, env, { error: 'Not found' }, 404);
    try {
      const data = await route(req, env, url);
      if (data instanceof Response) return data;
      return respond(req, env, data);
    } catch (e) {
      if (e instanceof HttpError) return respond(req, env, { error: e.message }, e.status);
      console.error('Unhandled error', e && e.stack || e);
      return respond(req, env, { error: 'Server error' }, 500);
    }
  },
};
