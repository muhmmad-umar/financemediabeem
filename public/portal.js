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
      <main class="main"><div class="topbar"><button class="menu-btn" id="menuBtn">☰</button><div><h1 id="title"></h1><p id="subtitle"></p></div></div><div id="view"></div></main></div>
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
