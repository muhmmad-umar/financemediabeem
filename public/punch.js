/* Persistent check-in / check-out widget for the employee top bar — visible on every page. */
(function () {
  const MB = window.MB, A = MB.att, esc = MB.esc;
  const P = MB.punch = { state: null, fetched: 0, listeners: [], el: null };
  const nowIso = () => new Date(Date.parse(P.state.now.iso) + (Date.now() - P.fetched)).toISOString();
  const openSession = log => log && (log.sessions || []).filter(s => !s.check_out).pop();
  P.refresh = async () => { P.state = await MB.api('/api/employee/attendance/today'); P.fetched = Date.now(); P.paint(); return P.state; };
  P.changed = () => P.listeners.forEach(f => { try { f(); } catch (e) {} });
  P.paint = () => {
    if (!P.el) return;
    if (!P.state) { P.el.innerHTML = '<span class="muted">Loading attendance…</span>'; return; }
    const { log, settings } = P.state, tz = settings.timezone, os = openSession(log), hrs = A.liveHours(log, nowIso());
    const act = log && log.active_task_id && (P.state.my_tasks.find(t => t.id === log.active_task_id) || {}).title;
    const txt = os ? `🟢 Checked In <span class="muted" style="font-weight:400">(since ${A.fmtTime(os.check_in, tz)})</span>` : log ? `⚪ Checked out <span class="muted" style="font-weight:400">(${A.fmtTime(log.check_out, tz)})</span>` : '⚪ Not checked in';
    P.el.innerHTML = `<div class="punch"><span class="ptxt">${txt}</span><span class="phrs">Today: <b style="color:var(--strong)">${A.fmtH(hrs)}</b></span>${act ? `<span class="pact" id="pActive" title="Active task — click to open">⏱ ${esc(act)}</span>` : ''}
      <button class="btn ${os ? 'out' : 'inn'}" id="punchTop">${os ? '⏹ Check Out' : log ? '▶ Check In again' : '▶ Check In'}</button></div>`;
    P.el.querySelector('#punchTop').onclick = P.toggle;
    const pa = P.el.querySelector('#pActive'); if (pa) pa.onclick = () => P.openActive && P.openActive(log.active_task_id);
  };
  P.toggle = async () => {
    if (!P.state) await P.refresh().catch(() => {});
    const log = P.state && P.state.log, os = openSession(log), btn = document.getElementById('punchTop');
    if (!os) {   // one click to check in
      if (btn) btn.disabled = true;
      try { P.state = await MB.api('/api/employee/attendance/check-in', { method: 'POST' }); P.fetched = Date.now(); MB.toast('Checked in — have a productive day'); P.paint(); P.changed(); }
      catch (e) { MB.toast(e.message); P.refresh().catch(() => {}); }
      return;
    }
    checkoutForm();
  };
  function checkoutForm() {
    const s = P.state, log = s.log, picked = new Set(log.task_ids || []), tasks = s.my_tasks.slice().sort((a, b) => (picked.has(b.id) - picked.has(a.id)) || (a.due || '9').localeCompare(b.due || '9'));
    MB.openModal(`<h2>Check out</h2><p class="muted" style="margin-bottom:12px">Today so far: <b style="color:var(--strong)">${A.fmtH(A.liveHours(log, nowIso()))}</b></p>
      <div class="field"><label>Add a note about today's work (optional)</label><textarea id="coNote" rows="4" maxlength="4000" placeholder="What did you work on today?">${esc(log.activity_note || '')}</textarea></div>
      <div class="task-sec"><h4>Tasks I worked on</h4>${tasks.map(t => `<label class="sub"><input type="checkbox" data-co="${esc(t.id)}" ${picked.has(t.id) || t.id === log.active_task_id ? 'checked' : ''}><span>${esc(t.title)}</span></label>`).join('') || '<div class="muted">No tasks assigned to you.</div>'}</div>
      <div class="modal-actions"><button class="btn ghost" id="coCancel">Stay checked in</button><button class="btn out" id="coGo" style="background:var(--red)">Check out</button></div>`);
    document.getElementById('coCancel').onclick = MB.closeModal;
    document.getElementById('coGo').onclick = async () => {
      const b = document.getElementById('coGo'); b.disabled = true;
      try {
        const r = await MB.api('/api/employee/attendance/check-out', { method: 'POST' });
        const note = document.getElementById('coNote').value, ids = [...document.querySelectorAll('[data-co]:checked')].map(c => c.dataset.co);
        try { P.state = await MB.api('/api/employee/attendance/report', { method: 'PUT', body: { activity_note: note, task_ids: ids } }); } catch (e) { P.state = r; }
        P.fetched = Date.now(); MB.closeModal(); MB.toast(r.notice || 'Checked out — have a good evening'); P.paint(); P.changed();
      } catch (e) { MB.toast(e.message); b.disabled = false; P.refresh().catch(() => {}); }
    };
  }
  P.mount = async el => {
    P.el = el; P.paint();
    try { await P.refresh(); } catch (e) { el.innerHTML = '<span class="muted">Attendance unavailable</span>'; }
    setInterval(() => { if (!document.hidden) P.paint(); }, 30000);          // keep "Today: x hrs" ticking
    setInterval(() => { if (!document.hidden) P.refresh().catch(() => {}); }, 120000);   // resync with the server
  };
})();
