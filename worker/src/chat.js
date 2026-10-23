/**
 * Real-time chat — one ChatRoom Durable Object per room:
 *   channel:{channel_id} · dm:{userA}:{userB} (ids sorted) · task:{task_id}
 *
 * The Worker (index.js) authenticates the JWT and checks the caller may enter the room BEFORE forwarding the WebSocket
 * upgrade here, passing the verified user + room description in trusted headers. This class only ever sees vetted sockets.
 * Messages are written to D1 (history) and fanned out to every socket in the room.
 */
import { DurableObject } from 'cloudflare:workers';

export const EMOJIS = ['👍', '❤️', '😂', '😮'];
const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_TEXT = 4000;
const PAGE = 50;
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const nowIso = () => new Date().toISOString();
const safeJson = (s, d) => { try { return JSON.parse(s); } catch { return d; } };
const chunk = (arr, n) => { const out = []; for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n)); return out; };
const TABLE = { channel: 'channel_messages', dm: 'dm_messages', task: 'task_comments' };

/** the room description the Worker builds after checking access: {room, type, id, pair?} */
export const roomKey = (type, id, pair) => type === 'dm' ? 'dm:' + pair.slice().sort().map(x => x.replace(/:/g, '~')).join(':') : type + ':' + id;

/* ----------------------------------------------------------------- message shapes */
function shape(meta, r) {
  const m = meta.type === 'channel' ? { id: r.id, author_id: r.author_id, author_name: r.author_name, ts: r.timestamp }
    : meta.type === 'dm' ? { id: r.id, author_id: r.from_id, author_name: r.from_name, ts: r.timestamp, seen: !!r.seen_at }
      : { id: r.id, author_id: r.author_id, author_name: r.author_name, ts: r.timestamp, kind: r.kind || 'comment', client_visible: !!r.client_visible };
  return { ...m, room: meta.room, text: r.deleted ? '' : r.text, deleted: !!r.deleted, edited_at: r.edited_at || null, reply_to: r.reply_to || null, reactions: {} };
}
async function attachReactions(env, meta, msgs) {
  if (!msgs.length) return msgs;
  const byId = new Map(msgs.map(m => [m.id, m]));
  for (const part of chunk(msgs.map(m => m.id), 80)) {
    const rs = await env.DB.prepare(`SELECT message_id,user_id,emoji FROM message_reactions WHERE message_type=? AND message_id IN (${part.map(() => '?').join(',')})`).bind(meta.type, ...part).all();
    rs.results.forEach(r => { const m = byId.get(r.message_id); if (m) (m.reactions[r.emoji] = m.reactions[r.emoji] || []).push(r.user_id); });
  }
  return msgs;
}
export async function loadMessages(env, meta, viewer, { before, limit = PAGE } = {}) {
  limit = Math.min(Math.max(+limit || PAGE, 1), 100);
  let sql, binds;
  if (meta.type === 'channel') { sql = `SELECT id,author_id,author_name,text,timestamp,reply_to,edited_at,deleted FROM channel_messages WHERE channel_id=?${before ? ' AND timestamp<?' : ''} ORDER BY timestamp DESC LIMIT ?`; binds = [meta.id]; }
  else if (meta.type === 'dm') { const [a, b] = meta.pair; sql = `SELECT id,from_id,to_id,from_name,text,timestamp,reply_to,edited_at,deleted,seen_at FROM dm_messages WHERE ((from_id=? AND to_id=?) OR (from_id=? AND to_id=?))${before ? ' AND timestamp<?' : ''} ORDER BY timestamp DESC LIMIT ?`; binds = [a, b, b, a]; }
  else { sql = `SELECT id,author_id,author_name,text,timestamp,client_visible,kind,edited_at,deleted FROM task_comments WHERE task_id=?${viewer.role === 'client' ? " AND client_visible=1 AND kind='comment'" : ''}${before ? ' AND timestamp<?' : ''} ORDER BY timestamp DESC LIMIT ?`; binds = [meta.id]; }
  if (before) binds.push(before);
  binds.push(limit + 1);
  const rows = (await env.DB.prepare(sql).bind(...binds).all()).results, more = rows.length > limit;
  const msgs = rows.slice(0, limit).reverse().map(r => shape(meta, r));
  return { messages: await attachReactions(env, meta, msgs), more };
}
/** does this stored row really belong to the room the caller is in? (ids come from the client) */
const belongs = (meta, r) => meta.type === 'channel' ? r.channel_id === meta.id : meta.type === 'dm' ? meta.pair.includes(r.from_id) && meta.pair.includes(r.to_id) : r.task_id === meta.id;
async function loadOne(env, meta, id) {
  const cols = { channel: 'id,channel_id,author_id,author_name,text,timestamp,reply_to,edited_at,deleted', dm: 'id,from_id,to_id,from_name,text,timestamp,reply_to,edited_at,deleted,seen_at', task: 'id,task_id,author_id,author_name,text,timestamp,client_visible,kind,edited_at,deleted' }[meta.type];
  const r = await env.DB.prepare(`SELECT ${cols} FROM ${TABLE[meta.type]} WHERE id=?`).bind(id).first();
  return r && belongs(meta, r) ? (await attachReactions(env, meta, [shape(meta, r)]))[0] : null;
}

/* ----------------------------------------------------------------- writes */
export const cleanText = t => { const s = String(t ?? '').trim(); if (!s) throw new ChatError('Message is empty'); if (s.length > MAX_TEXT) throw new ChatError('Message is too long'); return s; };
export class ChatError extends Error {}

export async function persistMessage(env, meta, user, { text, reply_to, client_visible } = {}) {
  text = cleanText(text); const id = uid(), ts = nowIso(), reply = reply_to ? String(reply_to).slice(0, 40) : null;
  if (meta.type === 'channel') await env.DB.prepare('INSERT INTO channel_messages (id,channel_id,author_id,author_name,text,timestamp,reply_to) VALUES (?,?,?,?,?,?,?)').bind(id, meta.id, user.id, user.name, text, ts, reply).run();
  else if (meta.type === 'dm') { const other = meta.pair.find(x => x !== user.id); await env.DB.prepare('INSERT INTO dm_messages (id,from_id,to_id,from_name,text,timestamp,reply_to) VALUES (?,?,?,?,?,?,?)').bind(id, user.id, other, user.name, text, ts, reply).run(); }
  else {
    const vis = user.role === 'client' ? 1 : (user.role === 'admin' && client_visible ? 1 : 0), data = { id, taskId: meta.id, at: ts, by: user.name, author_id: user.id, text, kind: 'comment', client_visible: !!vis };
    await env.DB.prepare('INSERT INTO task_comments (id,task_id,author_id,author_name,text,timestamp,client_visible,kind,data,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(id, meta.id, user.id, user.name, text, ts, vis, 'comment', JSON.stringify(data), Date.now()).run();
  }
  return loadOne(env, meta, id);
}
async function ownRow(env, meta, id, user) {
  const col = meta.type === 'dm' ? 'from_id' : 'author_id';
  const sel = meta.type === 'channel' ? 'id,channel_id,author_id,timestamp,deleted' : meta.type === 'dm' ? 'id,from_id,to_id,timestamp,deleted' : 'id,task_id,author_id,timestamp,deleted';
  const r = await env.DB.prepare(`SELECT ${sel} FROM ${TABLE[meta.type]} WHERE id=?`).bind(id).first();
  if (!r || !belongs(meta, r)) throw new ChatError('Message not found');
  if (r[col] !== user.id) throw new ChatError('You can only change your own messages');
  if (r.deleted) throw new ChatError('Message was deleted');
  return r;
}
export async function editMessage(env, meta, user, id, text) {
  const r = await ownRow(env, meta, id, user); text = cleanText(text);
  if (Date.now() - Date.parse(r.timestamp) > EDIT_WINDOW_MS) throw new ChatError('Messages can only be edited within 15 minutes');
  const at = nowIso();
  if (meta.type === 'task') await env.DB.prepare("UPDATE task_comments SET text=?,edited_at=?,data=json_set(data,'$.text',?,'$.edited_at',?),updated_at=? WHERE id=?").bind(text, at, text, at, Date.now(), id).run();
  else await env.DB.prepare(`UPDATE ${TABLE[meta.type]} SET text=?,edited_at=? WHERE id=?`).bind(text, at, id).run();
  return loadOne(env, meta, id);
}
export async function deleteMessage(env, meta, user, id) {
  await ownRow(env, meta, id, user);
  if (meta.type === 'task') await env.DB.prepare("UPDATE task_comments SET text='',deleted=1,data=json_set(data,'$.text','','$.deleted',1),updated_at=? WHERE id=?").bind(Date.now(), id).run();
  else await env.DB.prepare(`UPDATE ${TABLE[meta.type]} SET text='',deleted=1 WHERE id=?`).bind(id).run();
  await env.DB.prepare('DELETE FROM message_reactions WHERE message_type=? AND message_id=?').bind(meta.type, id).run();
  return { id };
}
export async function toggleReaction(env, meta, user, id, emoji) {
  if (!EMOJIS.includes(emoji)) throw new ChatError('Unsupported reaction');
  const msg = await loadOne(env, meta, id); if (!msg || msg.deleted) throw new ChatError('Message not found');
  const has = await env.DB.prepare('SELECT id FROM message_reactions WHERE message_type=? AND message_id=? AND user_id=? AND emoji=?').bind(meta.type, id, user.id, emoji).first();
  if (has) await env.DB.prepare('DELETE FROM message_reactions WHERE id=?').bind(has.id).run();
  else await env.DB.prepare('INSERT INTO message_reactions (id,message_id,message_type,user_id,emoji,created_at) VALUES (?,?,?,?,?,?)').bind(uid(), id, meta.type, user.id, emoji, nowIso()).run();
  return (await loadOne(env, meta, id)).reactions;
}
/** the recipient has the DM open → everything sent to them is now seen (✓✓) */
export async function markSeen(env, meta, userId) {
  if (meta.type !== 'dm') return [];
  const other = meta.pair.find(x => x !== userId), rows = (await env.DB.prepare('SELECT id FROM dm_messages WHERE to_id=? AND from_id=? AND seen_at IS NULL').bind(userId, other).all()).results;
  if (!rows.length) return [];
  await env.DB.prepare('UPDATE dm_messages SET seen_at=? WHERE to_id=? AND from_id=? AND seen_at IS NULL').bind(nowIso(), userId, other).run();
  return rows.map(r => r.id);
}
export async function markRead(env, userId, room) {
  if (room.startsWith('task:')) return;
  await env.DB.prepare('INSERT INTO chat_reads (user_id,room,last_read) VALUES (?,?,?) ON CONFLICT(user_id,room) DO UPDATE SET last_read=excluded.last_read').bind(userId, room, nowIso()).run();
}
export async function touchPresence(env, userId, status = 'online') {
  await env.DB.prepare('INSERT INTO user_presence (user_id,status,last_seen) VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET status=excluded.status,last_seen=excluded.last_seen').bind(userId, status, nowIso()).run();
}

/* ----------------------------------------------------------------- the Durable Object */
export class ChatRoom extends DurableObject {
  constructor(ctx, env) { super(ctx, env); this.sendLog = new Map(); this.lastPresence = new Map(); }

  /** Worker → room: a message was created over REST (or a task activity line) — fan it out */
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/notify') {
      const { event } = await req.json();
      this.fanOut(event);
      return new Response('ok');
    }
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const user = safeJson(req.headers.get('X-Chat-User'), null), meta = safeJson(req.headers.get('X-Chat-Room'), null);
    if (!user || !meta) return new Response('Bad request', { status: 400 });
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ user, meta });
    try { await this.join(server, user, meta); } catch (e) { server.send(JSON.stringify({ t: 'error', message: 'Could not load this conversation' })); }
    return new Response(null, { status: 101, webSocket: client });
  }

  sockets() { return this.ctx.getWebSockets().filter(ws => ws.readyState === 1); }
  send(ws, obj) { try { ws.send(JSON.stringify(obj)); } catch (e) { /* socket is going away */ } }
  /** clients never receive internal-only task comments or employee names (privacy) */
  allowed(u, meta, ev) {
    if (u.role !== 'client' || meta.type !== 'task') return true;
    if (ev.t === 'msg') return !!ev.msg.client_visible;
    if (ev.t === 'typing') return ev.role === 'client';
    return true;
  }
  fanOut(ev, except) { for (const ws of this.sockets()) { if (ws === except) continue; const { user, meta } = ws.deserializeAttachment() || {}; if (user && this.allowed(user, meta, ev)) this.send(ws, ev); } }
  presenceFor(viewer, meta, skip) {
    const m = new Map(); for (const ws of this.sockets()) { if (ws === skip) continue; const { user } = ws.deserializeAttachment() || {}; if (user) m.set(user.id, { id: user.id, name: user.name, role: user.role }); }
    let arr = [...m.values()]; if (viewer.role === 'client' && meta.type === 'task') arr = arr.filter(u => u.role === 'client');
    return arr;
  }
  broadcastPresence(skip) { for (const ws of this.sockets()) { if (ws === skip) continue; const { user, meta } = ws.deserializeAttachment() || {}; if (user) this.send(ws, { t: 'presence', users: this.presenceFor(user, meta, skip) }); } }

  async join(ws, user, meta) {
    const hist = await loadMessages(this.env, meta, user);
    const seenIds = await markSeen(this.env, meta, user.id); await markRead(this.env, user.id, meta.room);
    this.send(ws, { t: 'init', me: user.id, room: meta.room, type: meta.type, presence: this.presenceFor(user, meta), messages: hist.messages, more: hist.more, emojis: EMOJIS });
    if (seenIds.length) this.fanOut({ t: 'seen', by: user.id, ids: seenIds }, ws);
    this.broadcastPresence();
    this.ctx.waitUntil(touchPresence(this.env, user.id).catch(() => {}));
  }

  rateLimited(userId) {
    const now = Date.now(), log = (this.sendLog.get(userId) || []).filter(t => now - t < 5000);
    if (log.length >= 12) { this.sendLog.set(userId, log); return true; }
    log.push(now); this.sendLog.set(userId, log); return false;
  }

  async webSocketMessage(ws, data) {
    const att = ws.deserializeAttachment(); if (!att) return;
    const { user, meta } = att; let m; try { m = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch { return; }
    try {
      switch (m.t) {
        case 'ping': {
          this.send(ws, { t: 'pong' });
          const last = this.lastPresence.get(user.id) || 0;   // presence is refreshed about once a minute
          if (Date.now() - last > 55000) { this.lastPresence.set(user.id, Date.now()); this.ctx.waitUntil(touchPresence(this.env, user.id).catch(() => {})); }
          break;
        }
        case 'send': {
          if (this.rateLimited(user.id)) { this.send(ws, { t: 'error', message: 'Slow down — you are sending too fast', cid: m.cid }); break; }
          const msg = await persistMessage(this.env, meta, user, { text: m.text, reply_to: m.reply_to, client_visible: m.client_visible });
          msg.cid = m.cid || null;
          this.fanOut({ t: 'msg', msg });
          this.fanOut({ t: 'typing', user: { id: user.id, name: user.name }, on: false, role: user.role }, ws);
          await markRead(this.env, user.id, meta.room);
          break;
        }
        case 'typing': this.fanOut({ t: 'typing', user: { id: user.id, name: user.name }, on: !!m.on, role: user.role }, ws); break;
        case 'edit': { const msg = await editMessage(this.env, meta, user, String(m.id), m.text); this.fanOut({ t: 'edited', msg }); break; }
        case 'delete': { const r = await deleteMessage(this.env, meta, user, String(m.id)); this.fanOut({ t: 'deleted', id: r.id }); break; }
        case 'react': { const reactions = await toggleReaction(this.env, meta, user, String(m.id), String(m.emoji)); this.fanOut({ t: 'reactions', id: String(m.id), reactions }); break; }
        case 'seen': {
          const ids = await markSeen(this.env, meta, user.id); await markRead(this.env, user.id, meta.room);
          if (ids.length) this.fanOut({ t: 'seen', by: user.id, ids }, ws);
          break;
        }
        case 'history': { const h = await loadMessages(this.env, meta, user, { before: m.before, limit: PAGE }); this.send(ws, { t: 'history', messages: h.messages, more: h.more, before: m.before }); break; }
      }
    } catch (e) {
      this.send(ws, { t: 'error', message: e instanceof ChatError ? e.message : 'Something went wrong', cid: m && m.cid });
      if (!(e instanceof ChatError)) console.error('chat error', e && e.stack || e);
    }
  }

  async webSocketClose(ws, code) {
    const att = ws.deserializeAttachment();
    try { ws.close(code && code !== 1005 ? code : 1000); } catch (e) {}
    this.broadcastPresence(ws);
    if (att) this.ctx.waitUntil(this.env.DB.prepare('UPDATE user_presence SET last_seen=? WHERE user_id=?').bind(nowIso(), att.user.id).run().catch(() => {}));
  }
  async webSocketError(ws) { await this.webSocketClose(ws, 1011); }
}
