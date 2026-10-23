/* Real-time chat for every portal: WebSocket rooms (Durable Objects) with reconnect, polling fallback, presence,
   typing, edit / delete / reactions, DM seen ticks, unread counts and older-message paging.
     MB.rt     connection status, heartbeat/presence, unread counts
     MB.chat   mount(container, {kind:'channel'|'dm'|'task', id, title, variant, clientToggle}) → {close()} */
(function () {
  const MB = window.MB, esc = MB.esc, cfg = window.MB_CONFIG || {};
  const API = String(cfg.API_BASE || '').replace(/\/$/, ''), WS = API.replace(/^http/, 'ws');
  const EMOJI = ['👍', '❤️', '😂', '😮'], EDIT_MS = 15 * 60 * 1000;
  const hue = n => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const ini = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();

  /* ------------------------------------------------------------------ connection state, presence, unread */
  const rt = MB.rt = {
    conns: new Set(), hbOk: null, online: new Set(), unread: { channels: {}, dms: {}, total: 0 }, listeners: [], started: false,
    status() { if (rt.conns.size) { for (const c of rt.conns) if (c.status === 'connected') return 'connected'; return 'reconnecting'; } return rt.hbOk === false ? 'reconnecting' : 'connected'; },
    on(fn) { rt.listeners.push(fn); return fn; },
    emit(what) { rt.listeners.forEach(f => { try { f(what); } catch (e) {} }); },
    statusHtml() { const ok = rt.status() === 'connected'; return ok ? '<span class="rt-stat ok">🟢 Connected</span>' : '<span class="rt-stat bad">🔴 Reconnecting…</span>'; },
    /** keeps an element showing 🟢 Connected / 🔴 Reconnecting */
    bindStatus(el) { const paint = () => { el.innerHTML = rt.statusHtml(); }; paint(); rt.on(w => { if (w === 'status') paint(); }); },
    async pull() {
      try { rt.hbOk = true; const [u, p] = await Promise.all([MB.api('/api/chat/unread', { noRedirect: true }), MB.api('/api/chat/presence', { noRedirect: true })]); rt.unread = u; rt.online = new Set(p.online || []); rt.emit('unread'); rt.emit('presence'); }
      catch (e) { if (e.offline) rt.hbOk = false; }
      rt.emit('status');
    },
    /** call once after sign-in: heartbeat every 60 s, unread + presence refresh, offline beacon on close */
    start() {
      if (rt.started) return; rt.started = true;
      const beat = async () => { try { await MB.api('/api/chat/heartbeat', { method: 'POST', noRedirect: true }); rt.hbOk = true; } catch (e) { if (e.offline) rt.hbOk = false; } rt.emit('status'); };
      beat(); rt.pull(); setInterval(beat, 60000); setInterval(() => { if (!document.hidden) rt.pull(); }, 20000);
      window.addEventListener('pagehide', () => { try { navigator.sendBeacon(API + '/api/chat/offline?token=' + encodeURIComponent(MB.token() || '')); } catch (e) {} });
    },
  };

  /** One WebSocket with exponential backoff (1,2,4,8 s), 30 s heartbeat and a 5 s polling fallback while it is down. */
  class Conn {
    constructor(path, h) { this.path = path; this.h = h; this.attempt = 0; this.fails = 0; this.status = 'connecting'; this.stopped = false; rt.conns.add(this); this.open(); }
    setStatus(s) { this.status = s; rt.emit('status'); this.h.onstatus && this.h.onstatus(s); }
    open() {
      if (this.stopped) return;
      let ws; try { ws = new WebSocket(WS + this.path + '?token=' + encodeURIComponent(MB.token() || '')); } catch (e) { return this.retry(); }
      this.ws = ws;
      ws.onopen = () => { this.attempt = 0; this.fails = 0; this.setStatus('connected'); this.stopPoll(); clearInterval(this.hb); this.hb = setInterval(() => this.send({ t: 'ping' }), 30000); };
      ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } if (m.t !== 'pong') this.h.onmessage(m); };
      ws.onclose = () => { clearInterval(this.hb); if (!this.stopped) this.retry(); };
      ws.onerror = () => {};
    }
    retry() {
      this.fails++; this.setStatus('reconnecting');
      if (this.fails >= 2) this.startPoll();   // still down after a couple of tries → poll every 5 s
      const d = Math.min(8000, 1000 * 2 ** this.attempt++); clearTimeout(this.timer); this.timer = setTimeout(() => this.open(), d);
    }
    startPoll() { if (this.poller || !this.h.poll) return; this.h.poll(); this.poller = setInterval(() => { if (!document.hidden) this.h.poll(); }, 5000); }
    stopPoll() { clearInterval(this.poller); this.poller = null; }
    get open_() { return !!this.ws && this.ws.readyState === 1; }
    send(o) { if (this.open_) { this.ws.send(JSON.stringify(o)); return true; } return false; }
    close() { this.stopped = true; clearInterval(this.hb); clearTimeout(this.timer); this.stopPoll(); rt.conns.delete(this); try { this.ws && this.ws.close(1000); } catch (e) {} rt.emit('status'); }
  }

  /* ------------------------------------------------------------------ the chat view */
  const dayKey = iso => { const d = new Date(iso); return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate(); };
  const dayLabel = iso => { const d = new Date(iso), n = new Date(), y = new Date(); y.setDate(n.getDate() - 1); if (dayKey(iso) === dayKey(n)) return 'Today'; if (dayKey(iso) === dayKey(y)) return 'Yesterday'; return d.toLocaleDateString('en-US', d.getFullYear() === n.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }); };
  const css = `
.rc{display:flex;flex-direction:column;min-height:0;height:100%;background:var(--panel);color:var(--text);font-size:14px}
.rc-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--line)}.rc-head b{color:var(--strong)}
.rc-on{font-size:12px;color:var(--muted)}.rc-on i{font-style:normal;color:#22c55e}.rc-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#22c55e;margin-right:4px}.rc-dot.off{background:var(--dim)}
.rc-feed{flex:1;min-height:0;overflow:auto;padding:10px 16px;position:relative}
.rc-day{text-align:center;margin:14px 0 8px}.rc-day span{font-size:11px;color:var(--muted);border:1px solid var(--line2);border-radius:99px;padding:2px 10px;background:var(--panel)}
.rc-m{display:flex;gap:10px;padding:2px 0;position:relative;border-radius:6px}.rc-m:hover{background:var(--panel2)}.rc-m.cont{padding-left:44px}
.rc-av{width:34px;height:34px;border-radius:50%;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:13px;flex:none}
.rc-b{flex:1;min-width:0}.rc-h b{color:var(--strong)}.rc-h span{color:var(--muted);font-size:11px;margin-left:6px}.rc-t{white-space:pre-wrap;word-break:break-word}
.rc-t.gone{color:var(--muted);font-style:italic}.rc-ed{color:var(--muted);font-size:11px;margin-left:6px}
.rc-tick{font-size:11px;margin-left:6px;color:var(--muted)}.rc-tick.seen{color:#38bdf8}.rc-pend{opacity:.55}
.rc-act{display:none;position:absolute;right:8px;top:-12px;background:var(--line);border:1px solid var(--line2);border-radius:8px;padding:2px 4px;gap:2px;z-index:2}.rc-m:hover .rc-act{display:flex}
.rc-act button{background:none;border:0;color:var(--sub);cursor:pointer;font-size:14px;padding:2px 6px;border-radius:5px}.rc-act button:hover{background:var(--line2)}
.rc-pick{display:none;position:absolute;right:8px;top:14px;background:var(--line);border:1px solid var(--line2);border-radius:8px;padding:4px;gap:2px;z-index:3}.rc-pick.open{display:flex}.rc-pick button{background:none;border:0;font-size:18px;cursor:pointer;padding:3px 6px;border-radius:5px}.rc-pick button:hover{background:var(--line2)}
.rc-rx{display:flex;gap:6px;flex-wrap:wrap;margin-top:4px}.rc-rx button{background:var(--line);border:1px solid var(--line2);color:var(--sub);border-radius:99px;padding:1px 8px;font-size:12px;cursor:pointer}.rc-rx button.me{border-color:#7c3aed;background:var(--accentSoft)}
.rc-ev{color:var(--muted);font-style:italic;font-size:12px;padding:3px 0 3px 4px}
.rc-more{text-align:center;color:var(--muted);font-size:12px;padding:6px}
.rc-ty{min-height:20px;padding:0 16px 2px;font-size:12px;color:#a78bfa;font-style:italic}
.rc-c{display:flex;gap:8px;align-items:flex-end;border-top:1px solid var(--line);padding:10px 12px}.rc-c textarea{flex:1;resize:none;max-height:140px;background:var(--input);border:1px solid var(--line2);border-radius:6px;padding:9px 12px;color:var(--text);font:inherit;outline:none}.rc-c textarea:focus{border-color:#7c3aed}
.rc-c button.rc-send{background:#7c3aed;color:#fff;border:0;border-radius:6px;padding:9px 16px;font-weight:600;cursor:pointer}.rc-c label{font-size:12px;color:var(--sub);white-space:nowrap}
.rc-edit{display:flex;gap:6px;margin-top:2px}.rc-edit input{flex:1;background:var(--input);border:1px solid #7c3aed;border-radius:6px;padding:6px 10px;color:var(--strong);font:inherit}
.rc-none{color:var(--muted);text-align:center;margin-top:30px}.rt-stat{font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;background:var(--side);border:1px solid var(--line);white-space:nowrap}.rt-stat.ok{color:#4ade80}.rt-stat.bad{color:#f87171}
.rc-task .rc-m{padding:6px 0;border-bottom:1px solid var(--line)}.rc-task .rc-av{width:26px;height:26px;font-size:11px}.rc-task .rc-m.cont{padding-left:0}.rc-task .rc-feed{flex:none;overflow:auto;padding:0;max-height:380px}.rc-task{height:auto;background:transparent}.rc-task .rc-c{border-top:0;padding:0 0 10px;flex-wrap:wrap}.rc-task .rc-c label{order:-1;width:100%}.rc-task .rc-head{padding:0 0 8px;border:0}`;
  const injectCss = () => { if (!document.getElementById('rcCss')) { const s = document.createElement('style'); s.id = 'rcCss'; s.textContent = css; document.head.appendChild(s); } };

  MB.chat = {
    mount(box, o) {
      injectCss();
      const kind = o.kind, id = o.id, task = kind === 'task' || o.variant === 'task', me = (MB.user() || {}).id;
      let msgs = [], more = false, loadingOlder = false, presence = [], typers = new Map(), pickFor = null, editing = null, ready = false;
      let typingOn = false, typingTimer = null, lastTypingSent = 0, destroyed = false;
      box.innerHTML = `<div class="rc ${task ? 'rc-task' : ''}"><div class="rc-head"><b>${esc(o.title || '')}</b><span class="rc-on" id="rcOn"></span></div><div class="rc-feed" id="rcFeed"><div class="rc-none">Connecting…</div></div><div class="rc-ty" id="rcTy"></div>
        <form class="rc-c" id="rcForm"><textarea id="rcIn" rows="1" maxlength="4000" placeholder="${task ? 'Write a comment…' : 'Write a message…'}"></textarea>${o.clientToggle ? '<label title="Clients can read comments marked visible"><input type="checkbox" id="rcVis" style="width:auto"> Visible to client</label>' : ''}<button class="rc-send">${task ? 'Post' : 'Send'}</button></form></div>`;
      const feed = box.querySelector('#rcFeed'), ta = box.querySelector('#rcIn'), tyEl = box.querySelector('#rcTy'), onEl = box.querySelector('#rcOn');
      if (!o.title) box.querySelector('.rc-head b').remove();

      /* ---- rendering ---- */
      const mine = m => m.author_id === me;
      const canEdit = m => mine(m) && !m.deleted && !m.pending && (m.kind || 'comment') === 'comment' && Date.now() - Date.parse(m.ts) < EDIT_MS;
      const ticks = m => kind !== 'dm' || !mine(m) || m.deleted ? '' : m.pending ? '<span class="rc-tick">🕒</span>' : m.seen ? '<span class="rc-tick seen" title="Seen">✓✓</span>' : '<span class="rc-tick" title="Delivered">✓</span>';
      const rx = m => { const e = Object.entries(m.reactions || {}).filter(([, u]) => u.length); return e.length ? `<div class="rc-rx">${e.map(([em, u]) => `<button class="${u.includes(me) ? 'me' : ''}" data-rx="${esc(m.id)}" data-em="${em}" title="${u.length} reaction${u.length > 1 ? 's' : ''}">${em} ${u.length}</button>`).join('')}</div>` : ''; };
      function paint(keepScroll) {
        const atBottom = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 90, prevH = feed.scrollHeight, prevTop = feed.scrollTop;
        let html = more ? '<div class="rc-more" id="rcMore">↑ Scroll up for older messages</div>' : '', lastDay = '', lastBy = '', lastT = 0;
        msgs.forEach(m => {
          const dk = dayKey(m.ts), t = Date.parse(m.ts);
          if (dk !== lastDay) { html += `<div class="rc-day"><span>${esc(dayLabel(m.ts))}</span></div>`; lastDay = dk; lastBy = ''; }
          if (m.kind === 'activity') { html += `<div class="rc-ev">${esc(m.author_name)} ${esc(m.text)} · ${MB.clock(m.ts)}</div>`; lastBy = ''; return; }
          const cont = !task && lastBy === m.author_id && t - lastT < 10 * 60000 && !m.deleted; lastBy = m.author_id; lastT = t;
          const body = m.deleted ? '<div class="rc-t gone">🚫 This message was deleted</div>' : editing === m.id ? `<div class="rc-edit"><input id="rcEditIn" value="${esc(m.text)}" maxlength="4000"><button class="btn sm" data-save="${esc(m.id)}">Save</button><button class="btn sm ghost" data-cancel="1">Cancel</button></div>` : `<div class="rc-t">${esc(m.text)}${m.edited_at ? '<span class="rc-ed">(edited)</span>' : ''}</div>`;
          const acts = m.deleted || m.pending ? '' : `<div class="rc-act"><button title="React" data-pick="${esc(m.id)}">😊</button>${canEdit(m) ? `<button title="Edit (15 min)" data-edit="${esc(m.id)}">✏️</button>` : ''}${mine(m) ? `<button title="Delete" data-del="${esc(m.id)}">🗑️</button>` : ''}</div><div class="rc-pick ${pickFor === m.id ? 'open' : ''}">${EMOJI.map(e => `<button data-rx="${esc(m.id)}" data-em="${e}">${e}</button>`).join('')}</div>`;
          html += `<div class="rc-m ${cont ? 'cont' : ''} ${m.pending ? 'rc-pend' : ''}" data-id="${esc(m.id)}">${cont ? '' : `<span class="rc-av" style="background:hsl(${hue(m.author_name)},55%,42%)">${esc(ini(m.author_name))}</span>`}<div class="rc-b">${cont ? '' : `<div class="rc-h"><b>${esc(mine(m) ? 'You' : m.author_name)}</b><span>${MB.clock(m.ts)}</span>${ticks(m)}</div>`}${body}${cont ? '' : ''}${rx(m)}</div>${acts}</div>`;
          if (cont) { /* tick for continuation rows */ }
        });
        feed.innerHTML = html || '<div class="rc-none">No messages yet — say hello.</div>';
        if (keepScroll === 'older') feed.scrollTop = feed.scrollHeight - prevH + prevTop; else if (keepScroll === 'bottom' || atBottom) feed.scrollTop = feed.scrollHeight; else feed.scrollTop = prevTop;
        const ei = feed.querySelector('#rcEditIn'); if (ei) { ei.focus(); ei.setSelectionRange(ei.value.length, ei.value.length); ei.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(editing, ei.value); } if (e.key === 'Escape') { editing = null; paint(); } }; }
      }
      function paintPresence() {
        const others = presence.filter(u => u.id !== me);
        if (task) onEl.innerHTML = others.length ? `<span>👀 ${others.map(u => esc(u.name)).join(', ')} ${others.length > 1 ? 'are' : 'is'} also viewing this task</span>` : '';
        else if (kind === 'dm') { const on = others.length || (o.peerId && rt.online.has(o.peerId)); onEl.innerHTML = `<span class="rc-dot ${on ? '' : 'off'}"></span>${on ? 'Online' : 'Offline'}`; }
        else onEl.innerHTML = others.length ? `<i>●</i> Online now: ${others.map(u => `<span class="rc-dot"></span>${esc(u.name)}`).join(' · ')}` : '<span class="rc-dot off"></span>Just you here';
      }
      function paintTyping() {
        const names = [...typers.values()].map(t => t.name);
        tyEl.textContent = !names.length ? '' : names.length === 1 ? names[0] + ' is typing…' : names.slice(0, 2).join(' and ') + (names.length > 2 ? ' and others' : '') + ' are typing…';
      }

      /* ---- socket events ---- */
      const upsert = m => { const i = msgs.findIndex(x => x.id === m.id || (m.cid && x.cid === m.cid && x.pending)); if (i >= 0) msgs[i] = { ...msgs[i], ...m, pending: false }; else msgs.push(m); msgs.sort((a, b) => a.ts.localeCompare(b.ts)); };
      const sendSeen = () => { if (kind !== 'channel' && kind !== 'dm') return; if (!document.hidden) conn.send({ t: 'seen' }); };
      function onmessage(m) {
        switch (m.t) {
          case 'init': msgs = m.messages; more = m.more; presence = m.presence; ready = true; paint('bottom'); paintPresence(); sendSeen(); rt.pull(); break;
          case 'presence': presence = m.users; paintPresence(); break;
          case 'msg': { const fresh = !msgs.some(x => x.id === m.msg.id); upsert(m.msg); paint(); if (fresh && m.msg.author_id !== me) { typers.delete(m.msg.author_id); paintTyping(); sendSeen(); if (o.onIncoming) o.onIncoming(m.msg); } break; }
          case 'edited': upsert(m.msg); paint(); break;
          case 'deleted': { const x = msgs.find(y => y.id === m.id); if (x) { x.deleted = true; x.text = ''; x.reactions = {}; paint(); } break; }
          case 'reactions': { const x = msgs.find(y => y.id === m.id); if (x) { x.reactions = m.reactions; paint(); } break; }
          case 'seen': { let ch = false; msgs.forEach(x => { if (m.ids.includes(x.id) && !x.seen) { x.seen = true; ch = true; } }); if (ch) paint(); break; }
          case 'typing': { if (m.user.id === me) break; clearTimeout((typers.get(m.user.id) || {}).t); if (m.on) typers.set(m.user.id, { name: m.user.name, t: setTimeout(() => { typers.delete(m.user.id); paintTyping(); }, 4500) }); else typers.delete(m.user.id); paintTyping(); break; }
          case 'history': { loadingOlder = false; const have = new Set(msgs.map(x => x.id)); const older = m.messages.filter(x => !have.has(x.id)); msgs = [...older, ...msgs]; more = m.more; paint('older'); break; }
          case 'error': { MB.toast(m.message); if (m.cid) { const x = msgs.find(y => y.cid === m.cid && y.pending); if (x) { msgs = msgs.filter(y => y !== x); paint(); } } break; }
        }
      }
      /* REST fallback: poll the latest page and merge it in */
      async function poll() {
        try { const r = await MB.api(`/api/chat/history?kind=${kind}&id=${encodeURIComponent(id)}&limit=50`, { noRedirect: true }); const keep = msgs.filter(x => x.pending); if (!ready) { msgs = r.messages; more = r.more; ready = true; paint('bottom'); } else { r.messages.forEach(upsert); paint(); } rt.pull(); } catch (e) {}
      }
      const conn = new Conn(`/api/ws/${kind}/${encodeURIComponent(id)}`, { onmessage, poll, onstatus: s => { if (s === 'connected') { ready = false; } } });

      /* ---- actions ---- */
      async function send(text) {
        const cid = 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), vis = !!(box.querySelector('#rcVis') || {}).checked;
        const tmp = { id: 'tmp-' + cid, cid, room: '', author_id: me, author_name: (MB.user() || {}).name || 'You', text, ts: new Date().toISOString(), pending: true, reactions: {}, kind: 'comment', client_visible: vis };
        msgs.push(tmp); paint('bottom');
        if (conn.send({ t: 'send', text, cid, client_visible: vis })) return;
        try { const r = await MB.api('/api/chat/send', { method: 'POST', body: { kind, id, text, client_visible: vis }, noRedirect: true }); msgs = msgs.filter(x => x !== tmp); upsert(r.msg); paint('bottom'); }
        catch (e) { msgs = msgs.filter(x => x !== tmp); paint(); MB.toast(e.message); }
      }
      function saveEdit(mid, text) { text = (text || '').trim(); editing = null; if (text && !conn.send({ t: 'edit', id: mid, text })) MB.toast('Reconnecting — try again in a moment'); paint(); }
      ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); box.querySelector('#rcForm').requestSubmit(); } });
      ta.addEventListener('input', () => {
        ta.style.height = 'auto'; ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
        if (Date.now() - lastTypingSent > 2500 && ta.value) { lastTypingSent = Date.now(); typingOn = true; conn.send({ t: 'typing', on: true }); }
        clearTimeout(typingTimer); typingTimer = setTimeout(() => { if (typingOn) { typingOn = false; conn.send({ t: 'typing', on: false }); } }, 3000);
      });
      box.querySelector('#rcForm').addEventListener('submit', e => { e.preventDefault(); const v = ta.value.trim(); if (!v) return; ta.value = ''; ta.style.height = 'auto'; typingOn = false; clearTimeout(typingTimer); send(v); });
      feed.addEventListener('click', e => {
        const t = e.target.closest('button'); if (!t) return;
        if (t.dataset.rx) { if (!conn.send({ t: 'react', id: t.dataset.rx, emoji: t.dataset.em })) MB.toast('Reconnecting — try again in a moment'); pickFor = null; return; }
        if (t.dataset.pick) { pickFor = pickFor === t.dataset.pick ? null : t.dataset.pick; paint(); return; }
        if (t.dataset.edit) { editing = t.dataset.edit; pickFor = null; paint(); return; }
        if (t.dataset.save) { saveEdit(t.dataset.save, (feed.querySelector('#rcEditIn') || {}).value); return; }
        if (t.dataset.cancel) { editing = null; paint(); return; }
        if (t.dataset.del) { if (confirm('Delete this message?') && !conn.send({ t: 'delete', id: t.dataset.del })) MB.toast('Reconnecting — try again in a moment'); }
      });
      feed.addEventListener('scroll', () => {   // near the top → fetch the next 50 older messages
        if (feed.scrollTop < 40 && more && !loadingOlder && msgs.length) {
          loadingOlder = true; const before = msgs[0].ts;
          if (!conn.send({ t: 'history', before })) MB.api(`/api/chat/history?kind=${kind}&id=${encodeURIComponent(id)}&before=${encodeURIComponent(before)}`, { noRedirect: true }).then(r => onmessage({ t: 'history', messages: r.messages, more: r.more })).catch(() => { loadingOlder = false; });
        }
      });
      const onVis = () => { if (!document.hidden && ready) sendSeen(); };
      document.addEventListener('visibilitychange', onVis); window.addEventListener('focus', onVis);
      const unsubPresence = rt.on(w => { if (w === 'presence' && kind === 'dm') paintPresence(); });
      paintPresence();
      return {
        close() { if (destroyed) return; destroyed = true; conn.close(); document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); rt.listeners = rt.listeners.filter(f => f !== unsubPresence); rt.pull(); },
        focus() { ta.focus(); },
      };
    },
  };
})();
