/**
 * Media Beem Agency Manager — API (Cloudflare Workers + D1)
 *
 * Roles: admin (full access) · employee (own tasks/salary/channels/DMs) · client (own invoices/projects/#general)
 * Auth:  email + password → JWT (HS256, 7 days) sent as `Authorization: Bearer <token>`.
 *
 * Every data table keeps the spec columns plus a `data` JSON column with the full record,
 * so the admin app (which works with rich objects) never loses a field.
 */

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
async function authenticate(req, env, roles) {
  if (!env.JWT_SECRET) throw new HttpError(500, 'Server is missing JWT_SECRET');
  const m = /^Bearer (.+)$/.exec(req.headers.get('Authorization') || '');
  const payload = m ? await verifyJwt(m[1], env.JWT_SECRET) : null;
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
  charity_expenses: { t: 'allah_share_payments', cols: ['amount', 'type', 'given_to', 'date', 'notes'], row: e => [num(e.amount), e.type === 'voluntary' ? 'voluntary' : 'obligated', str(e.cause), str(e.date), str(e.notes)] },
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
const SETTING_KEYS = ['data_version', 'cu_migrated', 'cu_nofolders'];
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
  const out = {};
  for (const key of SHARED_KEYS) out[key] = await loadCollection(env, key, since);
  return { changes: out, now: Date.now() };
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
async function ownTask(env, user, taskId) {
  if (!user.linked_id) throw forbidden('Your account is not linked to an employee record');
  const rows = await empTaskRows(env, user.linked_id, taskId);
  if (!rows.length) throw forbidden('That task is not assigned to you');
  return safeJson(rows[0].data, null);
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
  return msg;
}
async function getDm(env, user, other, url) {
  const peer = await resolveDmPeer(env, user, other);
  const after = url.searchParams.get('after');
  const rs = await env.DB.prepare(`SELECT id,from_id,to_id,from_name,text,timestamp,reply_to FROM dm_messages WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))${after ? ' AND timestamp>?' : ''} ORDER BY timestamp DESC LIMIT 500`)
    .bind(...[user.id, peer.id, peer.id, user.id, ...(after ? [after] : [])]).all();
  return { messages: rs.results.reverse(), me: user.id };
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
    if (seg[2] === 'subtasks' && seg[3] && method === 'PATCH') {
      const row = await env.DB.prepare('SELECT data FROM subtasks WHERE id=?').bind(seg[3]).first(); const s = row && safeJson(row.data, null);
      if (!s) throw notFound(); await ownTask(env, user, s.taskId);
      const { done } = await readBody(req); s.done = !!done; const c = COLLECTIONS.cu_subtasks;
      await upsertStmt(env, c).bind(s.id, ...c.row(s), JSON.stringify(s), Date.now()).run();
      return { ok: true, subtask: { id: s.id, title: s.title, done: s.done } };
    }
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
      return respond(req, env, data);
    } catch (e) {
      if (e instanceof HttpError) return respond(req, env, { error: e.message }, e.status);
      console.error('Unhandled error', e && e.stack || e);
      return respond(req, env, { error: 'Server error' }, 500);
    }
  },
};
