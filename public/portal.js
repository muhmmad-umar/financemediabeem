/* Shared client for all three portals: API calls, JWT session, role guard, helpers. */
(function () {
  const cfg = window.MB_CONFIG || {};
  const base = String(cfg.API_BASE || '').replace(/\/$/, '');
  const TK = 'mb_token', UK = 'mb_user';
  const LSG = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const LSS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const LSD = k => { try { localStorage.removeItem(k); } catch (e) {} };
  const HOME = { admin: '/admin', employee: '/employee', client: '/client' };
  const MB = window.MB = {
    HOME,
    token: () => LSG(TK),
    user: () => { try { return JSON.parse(LSG(UK)); } catch (e) { return null; } },
    setSession(token, user) { LSS(TK, token); LSS(UK, JSON.stringify(user)); },
    clear() { LSD(TK); LSD(UK); },
    go(path) { location.replace(path); },
    logout() { MB.clear(); MB.go('/login'); },
    async api(path, opts = {}) {
      const headers = { 'Content-Type': 'application/json' };
      const t = MB.token(); if (t) headers.Authorization = 'Bearer ' + t;
      let res;
      try { res = await fetch(base + path, { method: opts.method || 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }); }
      catch (e) { const err = new Error('Cannot reach the server — check your connection'); err.offline = true; throw err; }
      let data = {}; try { data = await res.json(); } catch (e) {}
      if (res.status === 401 && !opts.noRedirect && path !== '/api/auth/login') { MB.clear(); MB.go('/login'); throw new Error('Session expired'); }
      if (!res.ok) { const err = new Error(data.error || ('Request failed (' + res.status + ')')); err.status = res.status; throw err; }
      return data;
    },
    /** Ensure the visitor is signed in with the right role; otherwise bounce them to the right place. */
    async guard(role) {
      if (!MB.token()) { MB.go('/login'); return new Promise(() => {}); }
      const { user } = await MB.api('/api/auth/me');
      if (user.role !== role) { MB.go(HOME[user.role] || '/login'); return new Promise(() => {}); }
      LSS(UK, JSON.stringify(user));
      return user;
    },
    esc: s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    fmt: n => '₨ ' + Math.round(n || 0).toLocaleString('en-US'),
    fdate: d => d ? new Date(String(d).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—',
    clock: iso => new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase(),
    day: iso => { const d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1); const s = x => x.toDateString(); return s(d) === s(t) ? 'Today' : s(d) === s(y) ? 'Yesterday' : d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }); },
    toast(msg) { let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); } t.textContent = msg; t.classList.add('show'); clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2600); },
  };
})();

/* ---------- shared UI helpers for the employee + client portals ---------- */
(function () {
  const MB = window.MB, esc = MB.esc;
  const $ = id => document.getElementById(id);
  MB.$ = $;

  /** Task descriptions are rich text written in the admin app — keep only harmless formatting. */
  const OK_TAGS = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'UL', 'OL', 'LI', 'A', 'H1', 'H2', 'H3', 'CODE', 'PRE', 'DIV', 'SPAN', 'BLOCKQUOTE']);
  MB.sanitize = html => {
    const doc = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html');
    const walk = node => {
      [...node.childNodes].forEach(n => {
        if (n.nodeType === 3) return;
        if (n.nodeType !== 1 || !OK_TAGS.has(n.tagName)) { n.replaceWith(document.createTextNode(n.textContent || '')); return; }
        [...n.attributes].forEach(a => { if (!(n.tagName === 'A' && a.name === 'href' && /^https?:\/\//i.test(a.value))) n.removeAttribute(a.name); });
        if (n.tagName === 'A') { n.setAttribute('target', '_blank'); n.setAttribute('rel', 'noopener noreferrer'); }
        walk(n);
      });
    };
    walk(doc.body); return doc.body.innerHTML;
  };

  MB.openModal = html => { $('modal').innerHTML = html; $('overlay').classList.add('open'); };
  MB.closeModal = () => { $('overlay').classList.remove('open'); $('modal').innerHTML = ''; };

  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const hue = n => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  MB.avatar = n => `<span class="av" style="background:hsl(${hue(n)},55%,42%)">${esc(initials(n))}</span>`;

  /** A live chat pane. cfg: {title, load():{messages,me}, send(text), norm(m)->{id,uid,name,text,ts}} */
  MB.chatPane = (el, cfg) => {
    let timer = null, sig = '', msgs = [], me = null, stopped = false, draft = '';
    el.innerHTML = `<div class="chat-head">${esc(cfg.title)}</div><div class="chat-feed" id="cfeed"></div>
      <form class="composer" id="cform"><textarea id="cin" rows="1" placeholder="Write a message…" maxlength="4000"></textarea><button class="btn" id="csend">Send</button></form>`;
    const feed = el.querySelector('#cfeed'), ta = el.querySelector('#cin');
    const paint = () => {
      let html = '', lastDay = '', lastBy = '', lastT = 0;
      msgs.forEach(m => {
        const dk = m.ts.slice(0, 10), t = new Date(m.ts).getTime();
        if (dk !== lastDay) { html += `<div class="daydiv"><span>${esc(MB.day(m.ts))}</span></div>`; lastDay = dk; lastBy = ''; }
        const cont = lastBy === m.uid && t - lastT < 10 * 60000; lastBy = m.uid; lastT = t;
        const who = m.uid === me ? 'You' : m.name;
        html += cont ? `<div class="mrow cont"><div class="mb"><div class="mtxt">${esc(m.text)}</div></div></div>`
          : `<div class="mrow">${MB.avatar(who)}<div class="mb"><div class="mh"><b>${esc(who)}</b><span>${MB.clock(m.ts)}</span></div><div class="mtxt">${esc(m.text)}</div></div></div>`;
      });
      const stick = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80 || !feed.children.length;
      feed.innerHTML = html || '<div class="chat-none">No messages yet — say hello.</div>';
      if (stick) feed.scrollTop = feed.scrollHeight;
    };
    const pull = async () => {
      if (stopped || document.hidden) return;
      try { const r = await cfg.load(); me = r.me; const next = r.messages.map(cfg.norm), s = next.length + ':' + (next.length ? next[next.length - 1].id : ''); if (s !== sig) { sig = s; msgs = next; paint(); } } catch (e) { if (!sig) feed.innerHTML = `<div class="chat-none">${esc(e.message)}</div>`; }
    };
    const send = async () => {
      const text = ta.value.trim(); if (!text) return; ta.disabled = true;
      try { await cfg.send(text); ta.value = ''; sig = ''; await pull(); } catch (e) { MB.toast(e.message); }
      ta.disabled = false; ta.focus();
    };
    el.querySelector('#cform').addEventListener('submit', e => { e.preventDefault(); send(); });
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
    pull(); timer = setInterval(pull, 4000);
    return { stop() { stopped = true; clearInterval(timer); } };
  };

  /** Sidebar + topbar shell. items: [{key,label,icon,badge?}]; views: {key: ()=>Promise|void}. */
  MB.shell = ({ user, role, items, titles, onView }) => {
    document.body.classList.add(role);
    document.body.innerHTML = `<div class="shell"><aside class="side" id="side"><div class="brand"><div class="logo">MB</div><div>MEDIA BEEM<small>${role === 'client' ? 'CLIENT PORTAL' : 'EMPLOYEE PORTAL'}</small></div></div>
      <nav class="nav" id="nav">${items.map(i => `<button data-k="${i.key}">${i.icon ? `<span>${i.icon}</span>` : ''}${esc(i.label)}<span class="nb" id="nb-${i.key}" style="display:none"></span></button>`).join('')}</nav>
      <div class="side-foot"><div class="who">${esc(user.name || user.email)}<div class="muted">${esc(user.email)}</div></div><button class="btn ghost sm" style="width:100%" id="logout">Log out</button></div></aside>
      <div class="scrim" id="scrim"></div>
      <main class="main"><div class="topbar"><button class="menu-btn" id="menuBtn">☰</button><div><h1 id="title"></h1><p id="subtitle"></p></div><div class="topbar-r" id="topRight"></div></div><div id="view"></div></main></div>
      <div class="overlay" id="overlay"><div class="modal" id="modal"></div></div><div class="toast" id="toast"></div>`;
    const side = $('side'), scrim = $('scrim');
    $('logout').onclick = MB.logout;
    $('menuBtn').onclick = () => { side.classList.add('open'); scrim.classList.add('open'); };
    scrim.onclick = () => { side.classList.remove('open'); scrim.classList.remove('open'); };
    $('overlay').addEventListener('mousedown', e => { if (e.target === $('overlay')) MB.closeModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') MB.closeModal(); });
    const go = key => {
      document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.k === key));
      $('title').textContent = titles[key][0]; $('subtitle').textContent = titles[key][1];
      side.classList.remove('open'); scrim.classList.remove('open');
      try { history.replaceState(null, '', '#' + key); } catch (e) {}
      onView(key);
    };
    $('nav').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go(b.dataset.k); });
    const start = (location.hash || '').slice(1);
    go(items.some(i => i.key === start) ? start : items[0].key);
    return { go };
  };

  MB.statusPill = (name, color) => `<span class="pill" style="background:${esc(color || '#6b7280')}">${esc(name || '—')}</span>`;
  MB.fmtTs = iso => MB.fdate(iso) + ' · ' + MB.clock(iso);
})();

/* ---------- attendance helpers (shared by the employee portal and the admin app) ---------- */
(function () {
  const MB = window.MB, esc = MB.esc;
  const A = MB.att = {};
  const MON = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const pad = n => String(n).padStart(2, '0');
  A.dow = date => new Date(date + 'T00:00:00Z').getUTCDay();   // 0 = Sunday
  A.fmtTime = (iso, tz) => iso ? new Date(iso).toLocaleTimeString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }) : '—';
  A.hhmm = (iso, tz) => { const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(iso)).forEach(x => { p[x.type] = x.value; }); return p.hour + ':' + p.minute; };
  A.minOf = hm => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); return m ? (+m[1]) * 60 + (+m[2]) : 0; };
  A.t12 = hm => { const m = A.minOf(hm), h = Math.floor(m / 60); return (h % 12 || 12) + ':' + pad(m % 60) + ' ' + (h < 12 ? 'AM' : 'PM'); };
  A.fmtH = h => (Math.round((+h || 0) * 100) / 100) + ' hrs';
  A.longDate = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' });
  A.monthLabel = ym => new Date(ym + '-01T00:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  A.shiftMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number), d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1); };
  A.shiftDay = (date, n) => { const d = new Date(date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  A.daysOf = ym => { const [y, m] = ym.split('-').map(Number), n = new Date(Date.UTC(y, m, 0)).getUTCDate(); return Array.from({ length: n }, (_, i) => ym + '-' + pad(i + 1)); };
  /** hours including a session that is still open right now */
  A.liveHours = (log, nowIso) => !log ? 0 : (log.sessions || []).reduce((t, s) => t + Math.max(0, (Date.parse(s.check_out || nowIso) - Date.parse(s.check_in)) / 36e5), 0);
  A.isOpen = log => !!log && (log.sessions || []).some(s => !s.check_out);

  /** ctx = {settings, now, log, leave, join} → {key, label} */
  A.classify = (date, ctx) => {
    const { settings: s, now, log } = ctx;
    if (log) return log.status === 'Half Day' ? { key: 'half', label: 'Half Day' } : log.status === 'Late' ? { key: 'late', label: 'Late' } : { key: 'present', label: 'Present' };
    if (date > now.date) return { key: 'future', label: '' };
    if ((ctx.join && date < ctx.join) || (s.tracking_start && date < s.tracking_start)) return { key: 'before', label: '' };
    if (ctx.leave) return { key: 'leave', label: 'On leave' };
    if (!s.working_days.includes(A.dow(date))) return { key: 'off', label: 'Off' };
    if (date === now.date && now.min < A.minOf(s.end_time)) return { key: 'pending', label: 'Not in yet' };
    return { key: 'absent', label: 'Absent' };
  };
  A.summary = (ym, ctx) => {
    const out = { present: 0, late: 0, half: 0, absent: 0, leave: 0, hours: 0 };
    A.daysOf(ym).forEach(d => {
      const log = ctx.logsByDate[d], c = A.classify(d, { settings: ctx.settings, now: ctx.now, log, leave: ctx.leaves.has(d), join: ctx.join });
      if (c.key in out) out[c.key]++; if (log) out.hours += A.liveHours(log, ctx.now.iso);
    });
    out.attended = out.present + out.late + out.half; out.hours = Math.round(out.hours * 100) / 100; return out;
  };
  A.calendar = (ym, ctx) => {
    const days = A.daysOf(ym), lead = (A.dow(days[0]) + 6) % 7;   // Monday-first grid
    let h = `<div class="ac-grid">${MON.map(d => `<div class="ac-h">${d}</div>`).join('')}${'<div class="ac-d ac-blank"></div>'.repeat(lead)}`;
    days.forEach(d => {
      const log = ctx.logsByDate[d], c = A.classify(d, { settings: ctx.settings, now: ctx.now, log, leave: ctx.leaves.has(d), join: ctx.join }), open = A.isOpen(log);
      const sub = log ? (open ? (d === ctx.now.date ? 'working' : 'no check-out') : A.fmtH(log.total_hours).replace(' hrs', 'h')) : c.label;
      h += `<div class="ac-d ac-${c.key}${d === ctx.now.date ? ' ac-today' : ''}${log || ctx.clickAll ? ' ac-click' : ''}" data-date="${d}" title="${esc(c.label)}"><b>${+d.slice(8)}</b><span>${esc(sub)}</span></div>`;
    });
    return h + '</div>' + A.legend();
  };
  A.legend = () => `<div class="ac-leg"><span><i class="ac-present"></i>Present</span><span><i class="ac-late"></i>Late</span><span><i class="ac-half"></i>Half day</span><span><i class="ac-absent"></i>Absent</span><span><i class="ac-off"></i>Weekend / off</span><span><i class="ac-leave"></i>Leave</span></div>`;
  A.summaryHtml = s => `<div class="ac-sum"><div><b>${s.attended}</b><span>Days present</span></div><div><b style="color:#22c55e">${s.present}</b><span>On time</span></div><div><b style="color:#eab308">${s.late}</b><span>Late</span></div><div><b style="color:#f97316">${s.half}</b><span>Half days</span></div><div><b style="color:#ef4444">${s.absent}</b><span>Absent</span></div><div><b>${s.hours}</b><span>Total hours</span></div></div>`;
  A.pill = status => { const c = { Present: '#22c55e', Late: '#eab308', 'Half Day': '#f97316', Absent: '#ef4444' }[status] || '#6b7280'; return `<span class="pill" style="background:${c};color:${status === 'Late' ? '#1a1a1a' : '#fff'}">${esc(status)}</span>`; };
  /** one day's full activity: sessions, hours, report, tasks worked on */
  A.dayDetail = (log, tz, titles, nowIso) => {
    if (!log) return '<div class="muted">No attendance recorded for this day.</div>';
    const open = A.isOpen(log), hrs = A.liveHours(log, nowIso);
    return `<div style="display:flex;gap:10px;align-items:center;margin-bottom:12px">${A.pill(log.status)}<b>${A.fmtH(hrs)}</b>${open ? '<span class="muted">· still checked in</span>' : ''}</div>
      <div class="ac-sec"><h4>Check-ins</h4>${(log.sessions || []).map(s => `<div class="ac-row"><div class="grow">🟢 In <b>${A.fmtTime(s.check_in, tz)}</b></div><div class="grow">${s.check_out ? '🔴 Out <b>' + A.fmtTime(s.check_out, tz) + '</b>' : '<span class="muted">not checked out</span>'}</div><div class="muted">${s.check_out ? A.fmtH((Date.parse(s.check_out) - Date.parse(s.check_in)) / 36e5) : ''}</div></div>`).join('')}</div>
      <div class="ac-sec"><h4>What they worked on</h4><div style="white-space:pre-wrap">${log.activity_note ? esc(log.activity_note) : '<span class="muted">No daily note written.</span>'}</div></div>
      <div class="ac-sec"><h4>Tasks worked on</h4>${(log.task_ids || []).map(id => `<div class="ac-row">✅ ${esc(titles[id] || 'Deleted task')}</div>`).join('') || '<div class="muted">None selected.</div>'}</div>`;
  };
  A.css = `
.pill{display:inline-block;padding:2px 9px;border-radius:99px;font-size:11px;font-weight:600;color:#fff;white-space:nowrap}
.ac-sec{margin-bottom:16px}.ac-sec h4{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;font-weight:600}
.ac-row{display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid #2a2a2a}.ac-row:last-child{border:0}.ac-row .grow{flex:1}
.ac-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:6px}
.ac-h{font-size:11px;color:#888;text-align:center;text-transform:uppercase;letter-spacing:.06em;padding:2px 0}
.ac-d{min-height:56px;border-radius:8px;padding:6px 8px;border:1px solid #2a2a2a;background:#1a1a1a;display:flex;flex-direction:column;justify-content:space-between;font-size:11px;color:#aaa}
.ac-d b{font-size:13px;color:#fff}.ac-d span{font-size:10.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ac-blank{border:0;background:none}.ac-click{cursor:pointer}.ac-click:hover{filter:brightness(1.25)}
.ac-present{background:rgba(34,197,94,.18);border-color:#22c55e}.ac-late{background:rgba(234,179,8,.2);border-color:#eab308}
.ac-half{background:rgba(249,115,22,.2);border-color:#f97316}.ac-absent{background:rgba(239,68,68,.2);border-color:#ef4444}
.ac-off{background:#252525;border-color:#333;color:#777}.ac-leave{background:rgba(100,116,139,.22);border:1px dashed #64748b}
.ac-before,.ac-future{opacity:.45}.ac-pending{border-style:dashed}.ac-today{box-shadow:0 0 0 2px #7c3aed}
.ac-leg{display:flex;gap:14px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:#999}.ac-leg i{display:inline-block;width:11px;height:11px;border-radius:3px;margin-right:5px;vertical-align:-1px;border:1px solid}
.ac-leg i.ac-present{border-color:#22c55e}.ac-leg i.ac-late{border-color:#eab308}.ac-leg i.ac-half{border-color:#f97316}.ac-leg i.ac-absent{border-color:#ef4444}.ac-leg i.ac-off{border-color:#444}.ac-leg i.ac-leave{border-color:#64748b}
.ac-sum{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin:0 0 16px}
.ac-sum div{background:#161616;border:1px solid #2a2a2a;border-radius:8px;padding:10px 12px}.ac-sum b{display:block;font-size:20px;color:#fff}.ac-sum span{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.05em}
.ac-nav{display:flex;align-items:center;gap:10px;margin-bottom:14px}.ac-nav b{min-width:150px;text-align:center;color:#fff}
.ac-big{font-size:17px;padding:14px 34px;border-radius:10px;font-weight:600}.ac-big.out{background:#ef4444}
@media(max-width:600px){.ac-d{min-height:46px;padding:4px}.ac-d span{display:none}}`;
  A.injectCss = () => { if (!document.getElementById('attCss')) { const st = document.createElement('style'); st.id = 'attCss'; st.textContent = A.css; document.head.appendChild(st); } };
})();
