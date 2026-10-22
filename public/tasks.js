/* ClickUp-style Tasks for the employee portal: Spaces sidebar, My/All tabs, List / Board / Calendar, slide-in task panel.
   Employees can create, delete, reassign, comment, check subtasks, change status and log time on any task. They cannot
   create or delete Spaces/Lists, and the data they receive never includes finance, client money or salaries. */
(function () {
  const MB = window.MB, esc = MB.esc, A = MB.att;
  const PRI = { urgent: ['Urgent', '#ef4444'], high: ['High', '#f59e0b'], normal: ['Normal', '#6b7280'], low: ['Low', '#3b82f6'] };
  const pad = n => String(n).padStart(2, '0');
  const localToday = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const hue = n => { let h = 0; for (const c of String(n)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const initials = n => String(n || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const av = (n, sz = 24) => `<span class="tk-av" title="${esc(n)}" style="width:${sz}px;height:${sz}px;font-size:${Math.round(sz * .42)}px;background:hsl(${hue(n)},55%,42%)">${esc(initials(n))}</span>`;

  MB.tasks = {
    async mount(root) {
      const S = { ws: null, scope: { type: 'all' }, tab: 'mine', view: 'list', month: localToday().slice(0, 7), q: '', panelId: null, detail: null, collapsed: new Set(), grpHidden: new Set() };
      let lists = {}, people = {}, panelBusy = false;
      try { S.ws = await MB.api('/api/employee/workspace'); } catch (e) { root.innerHTML = `<div class="card empty">${esc(e.message)}</div>`; return { stop() {} }; }
      const index = () => { lists = {}; S.ws.lists.forEach(l => { lists[l.id] = l; }); people = {}; S.ws.people.forEach(p => { people[p.id] = p.name; }); };
      index();

      /* ---------- derived helpers ---------- */
      const listOf = t => lists[t.listId], stOf = t => { const l = listOf(t); return (l && l.statuses.find(s => s.id === t.status)) || { name: '—', color: '#6b7280', kind: 'open' }; };
      const isDone = t => ['done', 'closed'].includes(stOf(t).kind);
      const scopeLists = () => S.scope.type === 'list' ? [lists[S.scope.id]].filter(Boolean) : S.scope.type === 'space' ? S.ws.lists.filter(l => l.spaceId === S.scope.id) : S.ws.lists;
      const columns = ls => { const m = new Map(); ls.forEach(l => l.statuses.forEach(s => { const k = s.name.toLowerCase(); if (!m.has(k)) m.set(k, { key: k, name: s.name, color: s.color, kind: s.kind }); })); return [...m.values()]; };
      const visible = () => { const ids = new Set(scopeLists().map(l => l.id)), q = S.q.trim().toLowerCase();
        return S.ws.tasks.filter(t => ids.has(t.listId) && (S.tab === 'all' || t.assignees.includes(S.ws.me)) && (!q || t.title.toLowerCase().includes(q))); };
      const sortT = a => a.slice().sort((x, y) => (x.due || '9').localeCompare(y.due || '9') || x.title.localeCompare(y.title));
      const dueHtml = t => t.due ? `<span class="tk-due ${!isDone(t) && t.due < localToday() ? 'late' : ''}">${MB.fdate(t.due)}</span>` : '';
      const avs = t => t.assignees.length ? `<span class="tk-avs">${t.assignees.slice(0, 3).map(id => av(people[id] || '?')).join('')}${t.assignees.length > 3 ? `<span class="tk-av more">+${t.assignees.length - 3}</span>` : ''}</span>` : '<span class="tk-av noone" title="Unassigned">＋</span>';
      const priDot = t => t.priority && t.priority !== 'normal' ? `<span class="tk-pri" style="color:${PRI[t.priority][1]}" title="${PRI[t.priority][0]}">⚑</span>` : '';
      const toastErr = e => MB.toast(e.message || 'Something went wrong');
      const summarize = t => ({ id: t.id, listId: t.listId, title: t.title, status: t.status, assignees: t.assignees || [], due: t.due || '', priority: t.priority || 'normal', tags: t.tags || [], estimate: t.estimate || 0, created: t.created || '', repeat: t.repeat || '' });
      const putTask = d => { const i = S.ws.tasks.findIndex(t => t.id === d.task.id), old = i >= 0 ? S.ws.tasks[i] : {}, n = { ...summarize(d.task), sub_total: d.subtasks ? d.subtasks.length : old.sub_total || 0, sub_done: d.subtasks ? d.subtasks.filter(s => s.done).length : old.sub_done || 0 }; if (i >= 0) S.ws.tasks[i] = n; else S.ws.tasks.push(n); };

      async function changeStatus(id, name, statusId) {   // by status id (select) or by column name (board drag)
        const t = S.ws.tasks.find(x => x.id === id), l = t && lists[t.listId]; if (!t || !l) return;
        let target = statusId ? l.statuses.find(s => s.id === statusId) : l.statuses.find(s => s.name.toLowerCase() === name.toLowerCase());
        if (!target) { MB.toast('This task’s list has no “' + name + '” status'); return; }
        if (target.id === t.status) return;
        try { const d = await MB.api('/api/employee/task/' + id, { method: 'PATCH', body: { status: target.id } }); putTask(d); if (S.panelId === id) { S.detail = d; paintPanel(); } paint(); } catch (e) { toastErr(e); paint(); }
      }

      /* ---------- layout ---------- */
      root.innerHTML = `<div class="tk"><aside class="tk-side" id="tkSide"></aside><section class="tk-main"><div class="tk-bar" id="tkBar"></div><div class="tk-body" id="tkBody"></div></section></div>
        <div class="tk-scrim" id="tkScrim"></div><aside class="tk-panel" id="tkPanel" aria-hidden="true"></aside>`;
      const $s = id => root.querySelector('#' + id);

      function paintSide() {
        const open = t => !isDone(t), count = ids => S.ws.tasks.filter(t => ids.has(t.listId) && open(t) && (S.tab === 'all' || t.assignees.includes(S.ws.me))).length;
        $s('tkSide').innerHTML = `<div class="tk-sec">SPACES</div>
          <button class="tk-sp ${S.scope.type === 'all' ? 'sel' : ''}" data-scope="all">☰ <span>All spaces</span><i>${count(new Set(S.ws.lists.map(l => l.id))) || ''}</i></button>
          ${S.ws.spaces.map(sp => { const ls = S.ws.lists.filter(l => l.spaceId === sp.id), ids = new Set(ls.map(l => l.id)), col = S.collapsed.has(sp.id);
            return `<button class="tk-sp ${S.scope.type === 'space' && S.scope.id === sp.id ? 'sel' : ''}" data-scope="space:${esc(sp.id)}"><b class="tk-sq" style="background:${esc(sp.color || '#7c3aed')}">${esc(initials(sp.name))}</b><span>${esc(sp.name)}</span><i>${count(ids) || ''}</i><u data-tog="${esc(sp.id)}">${col ? '▸' : '▾'}</u></button>
            ${col ? '' : ls.map(l => `<button class="tk-li ${S.scope.type === 'list' && S.scope.id === l.id ? 'sel' : ''}" data-scope="list:${esc(l.id)}"><span style="color:${esc(l.color || '#06b6d4')}">📋</span><span>${esc(l.name)}</span><i>${count(new Set([l.id])) || ''}</i></button>`).join('')}`; }).join('') || '<div class="muted" style="padding:8px">No spaces yet — an admin creates them.</div>'}`;
        $s('tkSide').querySelectorAll('[data-scope]').forEach(b => b.onclick = e => {
          if (e.target.dataset.tog) { S.collapsed.has(e.target.dataset.tog) ? S.collapsed.delete(e.target.dataset.tog) : S.collapsed.add(e.target.dataset.tog); paintSide(); return; }
          const [type, id] = b.dataset.scope.split(':'); S.scope = type === 'all' ? { type } : { type, id }; paint();
        });
      }
      function paintBar() {
        const mineN = S.ws.tasks.filter(t => t.assignees.includes(S.ws.me) && !isDone(t)).length;
        $s('tkBar').innerHTML = `<div class="tk-tabs">${[['mine', 'My Tasks', mineN], ['all', 'All Tasks', S.ws.tasks.filter(t => !isDone(t)).length]].map(([k, l, n]) => `<button class="${S.tab === k ? 'on' : ''}" data-tab="${k}">${l} <i>${n}</i></button>`).join('')}</div>
          <div class="tk-views">${[['list', '≡ List'], ['board', '▥ Board'], ['calendar', '📅 Calendar']].map(([k, l]) => `<button class="${S.view === k ? 'on' : ''}" data-view="${k}">${l}</button>`).join('')}</div>
          <input class="tk-q" id="tkQ" placeholder="Search tasks…" value="${esc(S.q)}"><button class="btn sm" id="tkNew">+ New Task</button>`;
        $s('tkBar').querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; paint(); });
        $s('tkBar').querySelectorAll('[data-view]').forEach(b => b.onclick = () => { S.view = b.dataset.view; paint(); });
        $s('tkQ').oninput = e => { S.q = e.target.value; paintBody(); };
        $s('tkNew').onclick = () => newTaskForm();
      }

      /* ---------- views ---------- */
      const crumb = t => S.scope.type === 'list' ? '' : `<span class="tk-crumb">${esc(((S.ws.spaces.find(s => s.id === (listOf(t) || {}).spaceId) || {}).name || '') + ' › ' + ((listOf(t) || {}).name || ''))}</span>`;
      const statusSel = t => { const l = listOf(t), st = stOf(t); return `<select class="tk-st" data-st="${esc(t.id)}" style="background:${esc(st.color)}" onclick="event.stopPropagation()">${(l ? l.statuses : []).map(s => `<option value="${esc(s.id)}" ${s.id === t.status ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>`; };
      function paintList(ts) {
        const cols = columns(scopeLists());
        if (!ts.length) return '<div class="card empty">No tasks here. Create one with “+ New Task”.</div>';
        return cols.map(c => { const g = sortT(ts.filter(t => stOf(t).name.toLowerCase() === c.key)); if (!g.length) return ''; const hid = S.grpHidden.has(c.key);
          return `<div class="tk-grp"><div class="tk-gh" data-g="${esc(c.key)}"><span class="pill" style="background:${esc(c.color)}">${esc(c.name)}</span><span class="muted">${g.length}</span><u>${hid ? '▸' : '▾'}</u></div>
            ${hid ? '' : g.map(t => `<div class="tk-row" data-open="${esc(t.id)}">${statusSel(t)}<div class="tk-t"><div class="tk-title ${isDone(t) ? 'done' : ''}">${esc(t.title)}</div>${crumb(t)}</div>
              ${t.sub_total ? `<span class="tk-sub">☑ ${t.sub_done}/${t.sub_total}</span>` : ''}${avs(t)}${dueHtml(t)}${priDot(t)}</div>`).join('')}</div>`; }).join('');
      }
      function paintBoard(ts) {
        const cols = columns(scopeLists());
        return `<div class="tk-board">${cols.map(c => { const g = sortT(ts.filter(t => stOf(t).name.toLowerCase() === c.key));
          return `<div class="tk-col" data-col="${esc(c.name)}"><div class="tk-ch"><span class="pill" style="background:${esc(c.color)}">${esc(c.name)}</span><span class="muted">${g.length}</span></div>
            ${g.map(t => `<div class="tk-card" draggable="true" data-open="${esc(t.id)}" data-drag="${esc(t.id)}"><div class="tk-title ${isDone(t) ? 'done' : ''}">${esc(t.title)}</div>${crumb(t)}<div class="tk-cf">${avs(t)}${dueHtml(t)}${priDot(t)}${t.sub_total ? `<span class="tk-sub">☑ ${t.sub_done}/${t.sub_total}</span>` : ''}</div></div>`).join('') || '<div class="tk-none">Drop here</div>'}</div>`; }).join('')}</div>`;
      }
      function paintCalendar(ts) {
        const days = A.daysOf(S.month), lead = (A.dow(days[0]) + 6) % 7, byDay = {}; ts.forEach(t => { if (t.due) (byDay[t.due] = byDay[t.due] || []).push(t); });
        const undated = ts.filter(t => !t.due).length, t0 = localToday();
        return `<div class="ac-nav"><button class="btn ghost sm" data-cm="-1">‹</button><b>${A.monthLabel(S.month)}</b><button class="btn ghost sm" data-cm="1">›</button><button class="btn ghost sm" data-cm="0">Today</button>${undated ? `<span class="muted" style="margin-left:auto">${undated} without a due date</span>` : ''}</div>
          <div class="ac-grid">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="ac-h">${d}</div>`).join('')}${'<div class="ac-d ac-blank"></div>'.repeat(lead)}
          ${days.map(d => { const g = byDay[d] || []; return `<div class="tk-cal ${d === t0 ? 'today' : ''}"><b>${+d.slice(8)}</b>${g.slice(0, 3).map(t => `<div class="tk-chip ${isDone(t) ? 'done' : ''}" data-open="${esc(t.id)}" style="border-left-color:${esc(stOf(t).color)}" title="${esc(t.title)}">${esc(t.title)}</div>`).join('')}${g.length > 3 ? `<div class="muted" style="font-size:11px">+${g.length - 3} more</div>` : ''}</div>`; }).join('')}</div>`;
      }
      function paintBody() {
        const ts = visible(), body = $s('tkBody');
        body.innerHTML = S.view === 'board' ? paintBoard(ts) : S.view === 'calendar' ? paintCalendar(ts) : paintList(ts);
        body.querySelectorAll('[data-open]').forEach(el => el.onclick = () => openPanel(el.dataset.open));
        body.querySelectorAll('[data-st]').forEach(sel => sel.onchange = () => changeStatus(sel.dataset.st, '', sel.value));
        body.querySelectorAll('.tk-gh').forEach(h => h.onclick = () => { const k = h.dataset.g; S.grpHidden.has(k) ? S.grpHidden.delete(k) : S.grpHidden.add(k); paintBody(); });
        body.querySelectorAll('[data-cm]').forEach(b => b.onclick = () => { const n = +b.dataset.cm; S.month = n === 0 ? localToday().slice(0, 7) : A.shiftMonth(S.month, n); paintBody(); });
        body.querySelectorAll('[data-drag]').forEach(c => c.ondragstart = e => { e.dataTransfer.setData('text/plain', c.dataset.drag); e.dataTransfer.effectAllowed = 'move'; c.classList.add('drag'); c.ondragend = () => c.classList.remove('drag'); });
        body.querySelectorAll('.tk-col').forEach(col => { col.ondragover = e => { e.preventDefault(); col.classList.add('over'); }; col.ondragleave = () => col.classList.remove('over'); col.ondrop = e => { e.preventDefault(); col.classList.remove('over'); const id = e.dataTransfer.getData('text/plain'); if (id) changeStatus(id, col.dataset.col); }; });
      }
      function paint() { paintSide(); paintBar(); paintBody(); }

      /* ---------- new task ---------- */
      function newTaskForm() {
        if (!S.ws.lists.length) { MB.toast('There are no lists yet — ask an admin to create one'); return; }
        const dl = S.scope.type === 'list' ? S.scope.id : (scopeLists()[0] || S.ws.lists[0]).id;
        MB.openModal(`<h2>New task</h2><form id="ntf"><div class="field"><label>Title</label><input name="title" required maxlength="300" placeholder="What needs doing?" autofocus></div>
          <div class="tk-2"><div class="field"><label>List</label><select name="list">${S.ws.spaces.map(sp => `<optgroup label="${esc(sp.name)}">${S.ws.lists.filter(l => l.spaceId === sp.id).map(l => `<option value="${esc(l.id)}" ${l.id === dl ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</optgroup>`).join('')}</select></div>
          <div class="field"><label>Assign to</label><select name="who"><option value="">Unassigned</option>${S.ws.people.map(p => `<option value="${esc(p.id)}" ${p.id === S.ws.me ? 'selected' : ''}>${esc(p.name)}${p.id === S.ws.me ? ' (me)' : ''}</option>`).join('')}</select></div></div>
          <div class="tk-2"><div class="field"><label>Due date</label><input type="date" name="due"></div><div class="field"><label>Priority</label><select name="pri">${Object.entries(PRI).map(([k, [l]]) => `<option value="${k}" ${k === 'normal' ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
          <div class="modal-actions"><button type="button" class="btn ghost" id="ntc">Cancel</button><button class="btn">Create task</button></div></form>`);
        root.ownerDocument.getElementById('ntc').onclick = MB.closeModal;
        root.ownerDocument.getElementById('ntf').onsubmit = async e => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
          try { const d = await MB.api('/api/employee/task', { method: 'POST', body: { list_id: f.list, title: f.title, assignees: f.who ? [f.who] : [], due: f.due, priority: f.pri } }); putTask(d); MB.closeModal(); paint(); openPanel(d.task.id, d); MB.toast('Task created'); } catch (er) { toastErr(er); } };
        setTimeout(() => { const i = root.ownerDocument.querySelector('#ntf input[name=title]'); if (i) i.focus(); }, 40);
      }

      /* ---------- slide-in task panel ---------- */
      const panel = $s('tkPanel'), scrim = $s('tkScrim');
      async function openPanel(id, preloaded) {
        const tb = document.querySelector('.topbar'), top = tb ? Math.max(0, Math.round(tb.getBoundingClientRect().bottom)) : 0;   // keep the top bar (check-in button) usable while the panel is open
        panel.style.top = top + 'px'; scrim.style.top = top + 'px';
        S.panelId = id; panel.classList.add('open'); scrim.classList.add('open'); panel.setAttribute('aria-hidden', 'false');
        if (preloaded) S.detail = preloaded; else { S.detail = null; panel.innerHTML = '<div class="empty">Loading…</div>'; try { S.detail = await MB.api('/api/employee/task/' + id); } catch (e) { toastErr(e); closePanel(); return; } }
        paintPanel();
      }
      function closePanel() { S.panelId = null; S.detail = null; panel.classList.remove('open'); scrim.classList.remove('open'); panel.setAttribute('aria-hidden', 'true'); }
      scrim.onclick = closePanel;
      const onKey = e => { if (e.key === 'Escape' && S.panelId && !document.getElementById('overlay').classList.contains('open')) closePanel(); };
      document.addEventListener('keydown', onKey);
      async function save(body, quiet) {
        if (panelBusy) return; panelBusy = true;
        try { const d = await MB.api('/api/employee/task/' + S.panelId, { method: 'PATCH', body }); S.detail = { ...S.detail, ...d }; putTask(d); if (!quiet) { paintPanel(); } paint(); } catch (e) { toastErr(e); }
        panelBusy = false;
      }
      function paintPanel() {
        const d = S.detail; if (!d) return; const t = d.task, l = lists[t.listId] || { statuses: d.statuses, name: '' }, sp = S.ws.spaces.find(s => s.id === l.spaceId) || {}, st = (l.statuses || []).find(s => s.id === t.status) || { color: '#6b7280' };
        const att = MB.punch && MB.punch.state, active = att && att.log && att.log.active_task_id === t.id, spent = d.time_logs.reduce((n, x) => n + (+x.hours || 0), 0);
        panel.innerHTML = `<div class="tk-ph"><span class="muted">${esc(sp.name || '')} › ${esc(l.name || '')}</span><span style="margin-left:auto"><button class="ibtn" id="pDel" title="Delete task">🗑</button><button class="ibtn" id="pX" title="Close">✕</button></span></div>
          <div class="tk-pb"><input class="tk-pt" id="pTitle" value="${esc(t.title)}" maxlength="300">
          <div class="tk-props"><label>Status<select id="pSt" style="background:${esc(st.color)}">${(l.statuses || []).map(s => `<option value="${esc(s.id)}" ${s.id === t.status ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
            <label>Due<input type="date" id="pDue" value="${esc(t.due || '')}"></label>
            <label>Priority<select id="pPri">${Object.entries(PRI).map(([k, [n]]) => `<option value="${k}" ${k === (t.priority || 'normal') ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
            <label>Estimate (h)<input type="number" id="pEst" min="0" step="0.5" value="${t.estimate || 0}"></label></div>
          <div class="tk-sec2">Assignees</div><div class="tk-assg" id="pAssg">${(t.assignees || []).map(id => `<span class="tk-chipx">${av(people[id] || '?', 20)} ${esc(people[id] || 'Unknown')}<u data-un="${esc(id)}">✕</u></span>`).join('') || '<span class="muted">Unassigned</span>'}
            <select id="pAdd"><option value="">＋ Assign…</option>${S.ws.people.filter(p => !(t.assignees || []).includes(p.id)).map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.id === S.ws.me ? ' (me)' : ''}</option>`).join('')}</select></div>
          <div style="margin:12px 0"><button class="btn sm ${active ? '' : 'ghost'}" id="pWork">${active ? '⏱ Working on this (click to stop)' : '▶ Work on this task'}</button> <span class="muted" style="font-size:12px">links it to today’s attendance</span></div>
          <div class="tk-sec2">Description</div><div class="tk-tb"><button data-cmd="bold"><b>B</b></button><button data-cmd="italic"><i>I</i></button><button data-cmd="insertUnorderedList">• List</button></div>
          <div class="tk-desc" id="pDesc" contenteditable="true" data-ph="Add a description…">${MB.sanitize(t.description || '')}</div>
          <div class="tk-sec2">Subtasks ${d.subtasks.length ? `<span class="muted">${d.subtasks.filter(s => s.done).length}/${d.subtasks.length}</span>` : ''}</div>
          ${d.subtasks.map(s => `<div class="tk-subr"><input type="checkbox" data-sub="${esc(s.id)}" ${s.done ? 'checked' : ''}><span class="${s.done ? 'done' : ''}">${esc(s.title)}</span><u data-dsub="${esc(s.id)}" title="Delete subtask">✕</u></div>`).join('')}
          <form id="pSubF" class="tk-inline"><input id="pSubIn" placeholder="Add a subtask…" maxlength="300"><button class="btn sm ghost">Add</button></form>
          <div class="tk-sec2">Time tracked <span class="muted">${A.fmtH(spent)}${t.estimate ? ' of ' + t.estimate + ' h estimate' : ''}</span></div>
          ${d.time_logs.map(x => `<div class="tk-subr"><span>⏱ <b>${A.fmtH(x.hours)}</b> · ${MB.fdate(x.date)} · ${esc(x.by || '')}${x.note ? ' — ' + esc(x.note) : ''}</span>${x.author_id === (MB.user() || {}).id ? `<u data-dtime="${esc(x.id)}" title="Remove">✕</u>` : ''}</div>`).join('')}
          <form id="pTimeF" class="tk-inline"><input id="pTimeH" type="number" min="0.01" max="24" step="any" placeholder="Hours" required style="max-width:90px"><input id="pTimeN" placeholder="What did you do? (optional)" maxlength="500"><button class="btn sm ghost">Log time</button></form>
          <div class="tk-sec2">Activity &amp; comments</div>
          <form id="pCmF" class="tk-inline" style="align-items:flex-start"><textarea id="pCmIn" rows="2" placeholder="Write a comment…" maxlength="4000" required></textarea><button class="btn sm">Post</button></form>
          <div id="pCms">${d.comments.slice().reverse().map(c => c.kind === 'activity' ? `<div class="cm act">${esc(c.by)} ${esc(c.text)} <span class="at">${MB.fmtTs(c.at)}</span></div>` : `<div class="cm"><span class="by">${esc(c.by)}</span><span class="at">${MB.fmtTs(c.at)}</span><div style="white-space:pre-wrap">${esc(c.text)}</div></div>`).join('') || '<div class="muted">No activity yet.</div>'}</div></div>`;
        const $p = id => panel.querySelector('#' + id), act = fn => async (...a) => { try { await fn(...a); } catch (e) { toastErr(e); } };
        $p('pX').onclick = closePanel;
        $p('pDel').onclick = async () => { if (!confirm('Delete “' + t.title + '”? Its subtasks, comments and time entries are deleted too.')) return; try { await MB.api('/api/employee/task/' + t.id, { method: 'DELETE' }); S.ws.tasks = S.ws.tasks.filter(x => x.id !== t.id); closePanel(); paint(); MB.toast('Task deleted'); if (MB.punch) MB.punch.refresh().catch(() => {}); } catch (e) { toastErr(e); } };
        $p('pTitle').onchange = e => { const v = e.target.value.trim(); if (v && v !== t.title) save({ title: v }, true); else e.target.value = t.title; };
        $p('pSt').onchange = e => changeStatus(t.id, '', e.target.value);
        $p('pDue').onchange = e => save({ due: e.target.value }); $p('pPri').onchange = e => save({ priority: e.target.value }); $p('pEst').onchange = e => save({ estimate: +e.target.value || 0 });
        panel.querySelectorAll('[data-un]').forEach(u => u.onclick = () => save({ assignees: (t.assignees || []).filter(x => x !== u.dataset.un) }));
        $p('pAdd').onchange = e => { if (e.target.value) save({ assignees: [...(t.assignees || []), e.target.value] }); };
        $p('pWork').onclick = act(async () => {
          if (!MB.punch || !MB.punch.state || !MB.punch.state.log) { MB.toast('Check in first, then pick the task you are working on'); return; }
          await MB.api('/api/employee/attendance/link-task', { method: 'POST', body: { task_id: active ? null : t.id } }); await MB.punch.refresh(); paintPanel(); MB.toast(active ? 'Stopped — task stays in today’s report' : 'Linked to today’s attendance');
        });
        panel.querySelectorAll('.tk-tb button').forEach(b => b.onmousedown = e => { e.preventDefault(); document.execCommand(b.dataset.cmd); });
        $p('pDesc').onblur = e => { const h = e.target.innerHTML; if (MB.sanitize(h) !== MB.sanitize(t.description || '')) save({ description: h }, true); };
        panel.querySelectorAll('[data-sub]').forEach(cb => cb.onchange = act(async () => { await MB.api('/api/employee/subtasks/' + cb.dataset.sub, { method: 'PATCH', body: { done: cb.checked } }); d.subtasks.find(s => s.id === cb.dataset.sub).done = cb.checked; putTask(S.detail); paintPanel(); paint(); }));
        panel.querySelectorAll('[data-dsub]').forEach(u => u.onclick = act(async () => { await MB.api('/api/employee/subtasks/' + u.dataset.dsub, { method: 'DELETE' }); d.subtasks = d.subtasks.filter(s => s.id !== u.dataset.dsub); putTask(S.detail); paintPanel(); paint(); }));
        $p('pSubF').onsubmit = act(async e => { e.preventDefault(); const v = $p('pSubIn').value.trim(); if (!v) return; const r = await MB.api('/api/employee/task/' + t.id + '/subtasks', { method: 'POST', body: { title: v } }); d.subtasks.push(r.subtask); putTask(S.detail); paintPanel(); paint(); });
        $p('pTimeF').onsubmit = act(async e => { e.preventDefault(); const r = await MB.api('/api/employee/task/' + t.id + '/time', { method: 'POST', body: { hours: +$p('pTimeH').value, note: $p('pTimeN').value } }); d.time_logs.push(r.time_log); paintPanel(); MB.toast('Time logged'); });
        panel.querySelectorAll('[data-dtime]').forEach(u => u.onclick = act(async () => { await MB.api('/api/employee/time/' + u.dataset.dtime, { method: 'DELETE' }); d.time_logs = d.time_logs.filter(x => x.id !== u.dataset.dtime); paintPanel(); }));
        $p('pCmF').onsubmit = act(async e => { e.preventDefault(); const v = $p('pCmIn').value.trim(); if (!v) return; const c = await MB.api('/api/employee/task/' + t.id + '/comments', { method: 'POST', body: { text: v } }); d.comments.push({ id: c.id, by: c.by, author_id: c.author_id, text: c.text, at: c.at, kind: 'comment' }); paintPanel(); });
      }

      paint();
      const timer = setInterval(async () => {   // pick up tasks other people created / changed (not while editing something)
        if (document.hidden || S.panelId || document.activeElement && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
        try { S.ws = await MB.api('/api/employee/workspace'); index(); paint(); } catch (e) {}
      }, 45000);
      return { stop() { clearInterval(timer); document.removeEventListener('keydown', onKey); }, openTask: openPanel };
    },
  };
})();
