/* Ad Copy Studio UI — shared by the admin app and the employee portal.
   MB.adStudio.mount(el, { isAdmin, onSettings }) paints into el; the state survives re-renders. */
(function () {
  'use strict';
  var MB = window.MB, esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var TYPE_LABEL = { headline: 'Headlines', primary_text: 'Primary texts', description: 'Descriptions' };
  var SEC = [['headline', '✍️', 'HEADLINES'], ['primary_text', '📝', 'PRIMARY TEXTS'], ['description', '📌', 'DESCRIPTIONS']];
  var S = { tab: 'generate', cfg: null, cfgErr: '', form: { url: '', brief: '', language: '', style: '', client_id: '' }, urlNote: '', result: null, busy: false, err: '', note: '',
    saved: { list: null, client_id: '', type: '', language: '', all: false }, hist: { list: null, all: false } };
  var el = null, opts = {};

  var css = '.as{max-width:900px;--asbg:var(--panel,var(--card,#1a1a1a));--asline:var(--line,#2a2a2a);--asmut:var(--muted,#888);--asacc:var(--accent,var(--teal,#7c3aed));--astx:var(--text,var(--strong,#fff))}' +
    '.as *{box-sizing:border-box}.as .card{background:var(--asbg);border:1px solid var(--asline);border-radius:14px;padding:18px;margin-bottom:14px}' +
    '.as-tabs{display:flex;gap:6px;margin-bottom:14px;overflow-x:auto;scrollbar-width:none}.as-tabs button{flex:none;border:1px solid var(--asline);background:transparent;color:var(--asmut);border-radius:99px;padding:9px 18px;font-weight:600;font-size:14px;cursor:pointer}.as-tabs button.on{background:var(--asacc);border-color:transparent;color:#fff}' +
    '.as-lbl{display:block;font-size:11.5px;font-weight:700;letter-spacing:.07em;color:var(--asmut);text-transform:uppercase;margin:16px 0 6px}.as-lbl:first-child{margin-top:0}.as-lbl em{color:var(--red,#ef4444);font-style:normal}' +
    '.as input[type=url],.as input[type=text],.as textarea,.as select{width:100%;background:var(--input,#141414);color:var(--astx);border:1px solid var(--asline);border-radius:10px;padding:11px 12px;font:inherit;font-size:14px;outline:none}.as textarea{min-height:120px;resize:vertical;line-height:1.5}.as input:focus,.as textarea:focus,.as select:focus{border-color:var(--asacc)}' +
    '.as .as-seg{display:flex;gap:8px;flex-wrap:wrap}.as .as-seg label{flex:1 1 140px;display:flex!important;gap:10px;align-items:flex-start;text-align:left;border:1px solid var(--asline);border-radius:10px;padding:11px 12px;cursor:pointer;font-size:14px;font-weight:500;color:var(--astx);margin:0}.as .as-seg label small{display:block;color:var(--asmut);font-size:12px;margin-top:2px;font-weight:400}.as .as-seg input{width:18px!important;height:18px!important;min-height:0!important;padding:0!important;margin:2px 0 0!important;accent-color:var(--asacc);flex:none}.as .as-seg label.on{border-color:var(--asacc);background:rgba(124,58,237,.1)}' +
    '.as-hint{font-size:12.5px;color:var(--asmut);margin-top:6px}.as-hint.ok{color:var(--green,#22c55e)}.as-hint.bad{color:var(--amber,#f59e0b)}' +
    '.as-go{width:100%;margin-top:18px;border:0;background:var(--asacc);color:#fff;font-weight:700;font-size:16px;border-radius:12px;padding:15px;cursor:pointer}.as-go:disabled{opacity:.6;cursor:wait}' +
    '.as-banner{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.5);color:var(--amber,#f59e0b);border-radius:12px;padding:12px 16px;margin-bottom:14px;font-weight:600}.as-banner button{margin-left:10px;border:1px solid currentColor;background:none;color:inherit;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer}' +
    '.as-err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.5);color:var(--red,#ef4444);border-radius:10px;padding:10px 14px;margin-top:12px;font-size:14px}.as-note{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);color:var(--amber,#f59e0b);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px}' +
    '.as-learn{font-size:12.5px;color:var(--asmut);margin:0 0 12px}.as-learn b{color:var(--astx)}' +
    '.as-sec{margin:22px 0 10px;padding:10px 0;border-top:2px solid var(--asline);border-bottom:2px solid var(--asline);font-weight:800;letter-spacing:.08em;font-size:14px}' +
    '.as-item{border:1px solid var(--asline);border-radius:12px;padding:14px;margin-bottom:10px;background:var(--asbg)}.as-item.rej{opacity:.5}.as-item.app{border-color:var(--green,#22c55e)}' +
    '.as-txt{white-space:pre-wrap;word-break:break-word;font-size:15.5px;line-height:1.55;color:var(--astx)}.as-txt.hl{font-size:18px;font-weight:700}.as-num{color:var(--asmut);font-weight:700;margin-right:6px}' +
    '.as-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.as-acts button{flex:1 1 120px;min-height:46px;border-radius:10px;border:1px solid var(--asline);background:transparent;color:var(--astx);font-weight:700;font-size:14px;cursor:pointer}' +
    '.as-acts .use{background:var(--green,#16a34a);border-color:transparent;color:#fff}.as-acts .use.done{background:transparent;border-color:var(--green,#16a34a);color:var(--green,#22c55e)}.as-acts .no{background:var(--red,#dc2626);border-color:transparent;color:#fff}.as-acts .no.done{background:transparent;border-color:var(--red,#ef4444);color:var(--red,#ef4444)}.as-acts .sv.on{border-color:#eab308;color:#eab308}' +
    '.as-bar{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.as-bar button{flex:1 1 180px;min-height:48px;border-radius:12px;border:1px solid var(--asline);background:transparent;color:var(--astx);font-weight:700;cursor:pointer}.as-bar .pri{background:var(--asacc);border-color:transparent;color:#fff}' +
    '.as-fil{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}.as-fil select{flex:1 1 150px;width:auto}.as .as-fil label{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--asmut)}.as .as-fil input{width:auto!important;min-height:0!important}' +
    '.as-meta{font-size:12px;color:var(--asmut);margin-top:8px}.as-h{cursor:pointer}.as-h:hover{border-color:var(--asacc)}.as-h b{display:block;margin-bottom:4px}.as-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:as-sp .8s linear infinite;vertical-align:-2px;margin-right:8px}@keyframes as-sp{to{transform:rotate(360deg)}}' +
    '@media(max-width:767px){.as .as-seg label{flex:1 1 100%}.as .card{padding:16px 14px}.as-txt.hl{font-size:19px}.as-acts button{flex:1 1 100%;min-height:50px;font-size:15px}.as input[type=url],.as input[type=text],.as textarea,.as select{font-size:16px;min-height:46px}.as-seg label{flex:1 1 100%}}';
  function injectCss() { if (document.getElementById('as-css')) return; var s = document.createElement('style'); s.id = 'as-css'; s.textContent = css; document.head.appendChild(s); }

  function toast(m) { if (MB && MB.toast) MB.toast(m); else if (window.toast) window.toast(m); }
  function copy(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).catch(fallback);
    return fallback();
    function fallback() { var t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0;top:0'; document.body.appendChild(t); t.select(); try { document.execCommand('copy'); } catch (e) {} t.remove(); return Promise.resolve(); }
  }
  var rtl = function (s) { return /[؀-ۿ]/.test(s) ? ' dir="rtl" style="text-align:right"' : ''; };
  function find(id) { return (S.result ? S.result.copies : []).find(function (c) { return c.id === id; }); }

  function load() {
    if (S.cfg) return Promise.resolve();
    return MB.api('/api/ai/config').then(function (c) { S.cfg = c; S.cfgErr = ''; if (!S.form.language) { S.form.language = c.default_language; S.form.style = c.default_style; } }).catch(function (e) { S.cfgErr = e.message; });
  }
  function mount(target, o) { el = target; opts = o || {}; injectCss(); paint(); load().then(function () { if (S.tab === 'saved' && !S.saved.list) loadSaved(); if (S.tab === 'history' && !S.hist.list) loadHist(); paint(); }); }

  /* ---------------------------------------------------------------- paint */
  function paint() {
    if (!el) return;
    var keep = el.querySelector('#asBrief'), y = window.scrollY;
    var html = '<div class="as">';
    if (S.cfgErr) html += '<div class="as-err">' + esc(S.cfgErr) + '</div>';
    else if (S.cfg && !S.cfg.has_key) html += '<div class="as-banner">🔑 Add your Claude API key in Settings to use Ad Copy Studio' + (opts.isAdmin && opts.onSettings ? '<button type="button" id="asSet">Open Settings</button>' : '<span style="font-weight:400"> — ask your admin to add it.</span>') + '</div>';
    html += '<div class="as-tabs">' + [['generate', '✨ Generate'], ['saved', '⭐ Saved Copies'], ['history', '🕘 History']].map(function (t) { return '<button type="button" data-tab="' + t[0] + '" class="' + (S.tab === t[0] ? 'on' : '') + '">' + t[1] + '</button>'; }).join('') + '</div>';
    html += S.tab === 'generate' ? genHtml() : S.tab === 'saved' ? savedHtml() : histHtml();
    el.innerHTML = html + '</div>';
    wire(); void keep; window.scrollTo(0, y);
  }

  function genHtml() {
    var c = S.cfg, f = S.form; if (!c) return '<div class="card">Loading…</div>';
    var radio = function (name, val, label, sub, cur) { return '<label class="' + (cur === val ? 'on' : '') + '"><input type="radio" name="' + name + '" value="' + val + '" ' + (cur === val ? 'checked' : '') + '><span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>'; };
    var h = '<form id="asForm" class="card" novalidate><label class="as-lbl" for="asUrl">Product / service link <em>*</em></label>' +
      '<input type="url" id="asUrl" inputmode="url" placeholder="https://..." value="' + esc(f.url) + '" autocomplete="off"><div class="as-hint ' + (S.urlNote.indexOf('✓') === 0 ? 'ok' : S.urlNote ? 'bad' : '') + '" id="asUrlNote">' + esc(S.urlNote || "We read the page text automatically so the copy uses your real offer.") + '</div>' +
      '<label class="as-lbl" for="asBrief">Your brief <em>*</em></label><textarea id="asBrief" placeholder="Describe your product, offer, target audience, and key benefit.\ne.g. Teeth whitening powder for Pakistani women, PKR 1,200, removes stains in 7 days">' + esc(f.brief) + '</textarea>' +
      '<label class="as-lbl">Language</label><div class="as-seg">' + ['English', 'Urdu', 'Hinglish'].map(function (l) { return radio('lang', l, l, '', f.language); }).join('') + '</div>' +
      '<label class="as-lbl">Style</label><div class="as-seg">' + radio('style', 'market', 'Market Style', 'Direct, offer-focused, emoji-driven, Pakistani market', f.style) + radio('style', 'premium', 'Premium Style', 'Identity, emotion, psychology — for high-ticket brands', f.style) + '</div>' +
      '<label class="as-lbl" for="asClient">Linked client <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label><select id="asClient"><option value="">— None —</option>' + c.clients.map(function (cl) { return '<option value="' + esc(cl.id) + '" ' + (f.client_id === cl.id ? 'selected' : '') + '>' + esc(cl.name) + '</option>'; }).join('') + '</select>' +
      (S.err ? '<div class="as-err">' + esc(S.err) + '</div>' : '') +
      '<button class="as-go" id="asGo" type="submit" ' + (S.busy || !c.has_key ? 'disabled' : '') + '>' + (S.busy ? '<span class="as-spin"></span>Writing your ad copy…' : '✨ Generate Ad Copy') + '</button></form>';
    if (S.result) h += resultsHtml();
    return h;
  }
  function learnChip() { var l = S.cfg && S.cfg.learning; if (!l) return ''; var n = l.approved + l.rejected; return '<p class="as-learn">🧠 ' + (l.active ? 'Personalised from <b>' + n + '</b> of your choices (✅ ' + l.approved + ' · ❌ ' + l.rejected + ')' : 'Choose <b>' + Math.max(0, l.needed - n) + '</b> more with ✅ / ❌ and the studio will start learning your taste') + '</p>'; }
  function resultsHtml() {
    var r = S.result, h = '<div id="asRes">' + (S.note ? '<div class="as-note">' + esc(S.note) + '</div>' : '') + learnChip();
    SEC.forEach(function (s) {
      h += '<div class="as-sec">' + s[1] + ' ' + s[2] + '</div>';
      r.copies.filter(function (c) { return c.type === s[0]; }).sort(function (a, b) { return a.position - b.position; }).forEach(function (c, i) {
        h += '<div class="as-item ' + (c.preference === 'approved' ? 'app' : c.preference === 'rejected' ? 'rej' : '') + '" data-id="' + esc(c.id) + '"><div class="as-txt ' + (c.type === 'headline' ? 'hl' : '') + '"' + rtl(c.content) + '><span class="as-num">' + (i + 1) + '.</span>' + esc(c.content) + '</div>' +
          '<div class="as-acts"><button type="button" class="use ' + (c.preference === 'approved' ? 'done' : '') + '" data-a="use">' + (c.preference === 'approved' ? '✅ Used — copy again' : '✅ Use This') + '</button><button type="button" class="no ' + (c.preference === 'rejected' ? 'done' : '') + '" data-a="no">' + (c.preference === 'rejected' ? '❌ Rejected' : '❌ Not This') + '</button><button type="button" class="sv ' + (c.saved ? 'on' : '') + '" data-a="save">' + (c.saved ? '⭐ Saved' : '⭐ Save') + '</button></div></div>';
      });
    });
    return h + '<div class="as-bar"><button type="button" id="asRegen">🔄 Regenerate All</button><button type="button" class="pri" id="asSaveAll">💾 Save All</button></div></div>';
  }

  function savedHtml() {
    var sv = S.saved, c = S.cfg || { clients: [] }, l = sv.list;
    var h = '<div class="as-fil"><select id="fCl"><option value="">All clients</option>' + c.clients.map(function (x) { return '<option value="' + esc(x.id) + '" ' + (sv.client_id === x.id ? 'selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<select id="fTy"><option value="">All types</option>' + Object.keys(TYPE_LABEL).map(function (k) { return '<option value="' + k + '" ' + (sv.type === k ? 'selected' : '') + '>' + TYPE_LABEL[k] + '</option>'; }).join('') + '</select>' +
      '<select id="fLa"><option value="">All languages</option>' + ['English', 'Urdu', 'Hinglish'].map(function (k) { return '<option ' + (sv.language === k ? 'selected' : '') + '>' + k + '</option>'; }).join('') + '</select>' +
      (opts.isAdmin ? '<label><input type="checkbox" id="fAll" ' + (sv.all ? 'checked' : '') + '> Whole team</label>' : '') + '</div>';
    if (!l) return h + '<div class="card">Loading…</div>';
    if (!l.length) return h + '<div class="card" style="text-align:center;color:var(--asmut,#888)">No saved copies yet. Tap ⭐ Save on anything you like.</div>';
    return h + l.map(function (c) { return '<div class="as-item" data-id="' + esc(c.id) + '"><div class="as-txt ' + (c.type === 'headline' ? 'hl' : '') + '"' + rtl(c.content) + '>' + esc(c.content) + '</div><div class="as-meta">' + esc(TYPE_LABEL[c.type] || c.type).replace(/s$/, '') + ' · ' + esc(c.language || '') + ' · ' + esc(c.style === 'premium' ? 'Premium' : 'Market') + (c.client_name ? ' · ' + esc(c.client_name) : '') + ' · ' + esc((c.created_at || '').slice(0, 10)) + '</div>' +
      '<div class="as-acts"><button type="button" class="use" data-a="copy">📋 Copy</button><button type="button" class="sv on" data-a="unsave">⭐ Remove</button></div></div>'; }).join('');
  }
  function histHtml() {
    var l = S.hist.list, h = opts.isAdmin ? '<div class="as-fil"><label><input type="checkbox" id="hAll" ' + (S.hist.all ? 'checked' : '') + '> Whole team</label></div>' : '';
    if (!l) return h + '<div class="card">Loading…</div>';
    if (!l.length) return h + '<div class="card" style="text-align:center;color:var(--asmut,#888)">Nothing generated yet.</div>';
    return h + l.map(function (g) { return '<div class="as-item as-h" data-gid="' + esc(g.id) + '"><b>' + esc(g.page_title || g.product_url || 'Untitled') + '</b><div class="as-txt" style="font-size:14px;color:var(--asmut,#888)">' + esc((g.brief || '').slice(0, 140)) + '</div><div class="as-meta">' + esc(g.language) + ' · ' + esc(g.style === 'premium' ? 'Premium' : 'Market') + ' · ' + esc((g.created_at || '').replace('T', ' ').slice(0, 16)) + '</div></div>'; }).join('');
  }

  /* ---------------------------------------------------------------- actions */
  function loadSaved() {
    var s = S.saved, q = '?' + [s.client_id && 'client_id=' + encodeURIComponent(s.client_id), s.type && 'type=' + s.type, s.language && 'language=' + s.language, s.all && 'scope=all'].filter(Boolean).join('&');
    s.list = null; paint(); return MB.api('/api/ai/saved-copies' + q).then(function (r) { s.list = r.copies; paint(); }).catch(function (e) { s.list = []; toast(e.message); paint(); });
  }
  function loadHist() { S.hist.list = null; paint(); return MB.api('/api/ai/history' + (S.hist.all ? '?scope=all' : '')).then(function (r) { S.hist.list = r.history; paint(); }).catch(function (e) { S.hist.list = []; toast(e.message); paint(); }); }
  function readForm() {
    if (!el.querySelector('#asForm')) return;
    var f = S.form; f.url = el.querySelector('#asUrl').value.trim(); f.brief = el.querySelector('#asBrief').value;
    var l = el.querySelector('input[name=lang]:checked'), st = el.querySelector('input[name=style]:checked'); if (l) f.language = l.value; if (st) f.style = st.value; f.client_id = el.querySelector('#asClient').value;
  }
  function generate(regen) {
    readForm(); var f = S.form; S.err = ''; S.note = '';
    if (!f.url) { S.err = 'Paste the product or service link.'; return paint(); }
    if (f.brief.trim().length < 10) { S.err = 'Add a short brief: product, offer, audience and key benefit.'; return paint(); }
    S.busy = true; paint();
    var avoid = regen && S.result ? S.result.copies.map(function (c) { return '- ' + c.content.replace(/\s*\n\s*/g, ' / '); }).join('\n').slice(0, 1400) : '';
    MB.api('/api/ai/generate-copy', { method: 'POST', body: { url: f.url, brief: f.brief, language: f.language, style: f.style, client_id: f.client_id, avoid: avoid } }).then(function (r) {
      S.result = { generation: r.generation, copies: r.copies }; S.note = r.page_note || ''; S.busy = false; S.hist.list = null; paint();
      var res = el.querySelector('#asRes'); if (res) res.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) { S.busy = false; S.err = e.message; paint(); });
  }
  function checkUrl() {
    readForm(); var u = S.form.url; if (!u || !/^https?:\/\//i.test(u)) { S.urlNote = ''; return; }
    var note = el.querySelector('#asUrlNote'); if (note) { note.className = 'as-hint'; note.textContent = 'Reading the page…'; }
    MB.api('/api/ai/fetch-url', { method: 'POST', body: { url: u } }).then(function (r) { S.urlNote = '✓ Read ' + r.chars.toLocaleString() + ' characters' + (r.title ? ' from “' + r.title + '”' : ''); }).catch(function (e) { S.urlNote = '⚠ ' + e.message; }).then(function () { var n = el && el.querySelector('#asUrlNote'); if (n) { n.className = 'as-hint ' + (S.urlNote.indexOf('✓') === 0 ? 'ok' : 'bad'); n.textContent = S.urlNote; } });
  }
  function setPref(c, pref) {
    var prev = c.preference; c.preference = pref; paint();
    return MB.api('/api/ai/preference', { method: 'POST', body: { copy_id: c.id, preference: pref } }).then(function (r) { if (S.cfg && r.learning) { S.cfg.learning = r.learning; paint(); } }).catch(function (e) { c.preference = prev; paint(); toast(e.message); });
  }
  function toggleSave(c, on) { c.saved = on ? 1 : 0; paint(); return MB.api('/api/ai/save-copy', { method: 'POST', body: { copy_id: c.id, saved: on } }).then(function () { S.saved.list = null; }).catch(function (e) { c.saved = on ? 0 : 1; paint(); toast(e.message); }); }

  function wire() {
    el.querySelectorAll('[data-tab]').forEach(function (b) { b.onclick = function () { readForm(); S.tab = b.dataset.tab; if (S.tab === 'saved' && !S.saved.list) loadSaved(); else if (S.tab === 'history' && !S.hist.list) loadHist(); else paint(); }; });
    var set = el.querySelector('#asSet'); if (set) set.onclick = opts.onSettings;
    var form = el.querySelector('#asForm');
    if (form) {
      form.onsubmit = function (e) { e.preventDefault(); if (!S.busy) generate(false); };
      el.querySelector('#asUrl').onchange = checkUrl;
      el.querySelector('#asUrl').oninput = function () { S.form.url = this.value.trim(); };
      el.querySelector('#asBrief').oninput = function () { S.form.brief = this.value; };
      el.querySelectorAll('.as-seg input').forEach(function (i) { i.onchange = function () { readForm(); form.querySelectorAll('.as-seg label').forEach(function (l) { l.classList.toggle('on', l.querySelector('input').checked); }); }; });
      el.querySelector('#asClient').onchange = readForm;
    }
    el.querySelectorAll('.as-item[data-id]').forEach(function (card) {
      card.querySelectorAll('[data-a]').forEach(function (b) {
        b.onclick = function () {
          var id = card.dataset.id, a = b.dataset.a, c = find(id) || (S.saved.list || []).find(function (x) { return x.id === id; });
          if (!c) return;
          if (a === 'use') { copy(c.content).then(function () { toast('✓ Copied'); }); if (c.preference !== 'approved') setPref(c, 'approved'); }
          else if (a === 'no') setPref(c, c.preference === 'rejected' ? null : 'rejected');
          else if (a === 'save') toggleSave(c, !c.saved);
          else if (a === 'copy') copy(c.content).then(function () { toast('✓ Copied'); });
          else if (a === 'unsave') { MB.api('/api/ai/save-copy', { method: 'POST', body: { copy_id: id, saved: false } }).then(function () { S.saved.list = S.saved.list.filter(function (x) { return x.id !== id; }); paint(); toast('Removed from saved'); }).catch(function (e) { toast(e.message); }); }
        };
      });
    });
    var rg = el.querySelector('#asRegen'); if (rg) rg.onclick = function () { generate(true); };
    var sa = el.querySelector('#asSaveAll'); if (sa) sa.onclick = function () { MB.api('/api/ai/save-copy', { method: 'POST', body: { generation_id: S.result.generation.id, saved: true } }).then(function () { S.result.copies.forEach(function (c) { c.saved = 1; }); S.saved.list = null; paint(); toast('All 9 saved ⭐'); }).catch(function (e) { toast(e.message); }); };
    ['fCl:client_id', 'fTy:type', 'fLa:language'].forEach(function (p) { var pair = p.split(':'), n = el.querySelector('#' + pair[0]); if (n) n.onchange = function () { S.saved[pair[1]] = n.value; loadSaved(); }; });
    var fa = el.querySelector('#fAll'); if (fa) fa.onchange = function () { S.saved.all = fa.checked; loadSaved(); };
    var ha = el.querySelector('#hAll'); if (ha) ha.onchange = function () { S.hist.all = ha.checked; loadHist(); };
    el.querySelectorAll('.as-h').forEach(function (n) { n.onclick = function () {
      MB.api('/api/ai/generation/' + encodeURIComponent(n.dataset.gid)).then(function (r) { var g = r.generation; S.form = { url: g.product_url || '', brief: g.brief || '', language: g.language, style: g.style, client_id: g.client_id || '' }; S.result = r; S.note = ''; S.urlNote = ''; S.tab = 'generate'; paint(); var res = el.querySelector('#asRes'); if (res) res.scrollIntoView({ behavior: 'smooth' }); }).catch(function (e) { toast(e.message); });
    }; });
  }

  /* ---------------------------------------------------------------- admin Settings → AI Settings */
  function settingsCard(box, onDone) {
    box.innerHTML = '<div class="muted">Loading…</div>';
    MB.api('/api/ai/config').then(function (c) {
      box.innerHTML = '<div class="field"><label>Claude API key</label><input id="aiKey" type="password" autocomplete="off" placeholder="' + (c.has_key ? 'Saved (' + esc(c.key_hint || '') + ') — paste a new key to replace' : 'sk-ant-…') + '"><div class="muted" style="font-size:12px;margin-top:6px">' + (c.key_source === 'secret' ? '✓ A Worker secret <code>CLAUDE_API_KEY</code> is set and is used first.' : c.has_key ? '✓ Key saved. Employees use it automatically; it is never shown to them.' : 'Not set — Ad Copy Studio stays locked until you add one.') + ' You can also set it as a Worker secret: <code>npx wrangler secret put CLAUDE_API_KEY</code>.</div></div>' +
        '<div class="row2"><div class="field"><label>Default language</label><select id="aiLang">' + ['English', 'Urdu', 'Hinglish'].map(function (l) { return '<option ' + (c.default_language === l ? 'selected' : '') + '>' + l + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>Default style</label><select id="aiStyle"><option value="market" ' + (c.default_style === 'market' ? 'selected' : '') + '>Market Style</option><option value="premium" ' + (c.default_style === 'premium' ? 'selected' : '') + '>Premium Style</option></select></div></div>' +
        '<div class="field" style="max-width:340px"><label>Model</label><select id="aiModel">' + c.models.map(function (m) { return '<option value="' + m + '" ' + (c.model === m ? 'selected' : '') + '>' + m + (m === 'claude-opus-5-5' ? ' (best quality)' : m === 'claude-sonnet-5-5' ? ' (cheaper)' : ' (cheapest)') + '</option>'; }).join('') + '</select></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="aiSave">Save AI settings</button>' + (c.key_source === 'settings' ? '<button class="btn ghost" id="aiClear">Remove saved key</button>' : '') + '</div>';
      box.querySelector('#aiSave').onclick = function () {
        var body = { default_language: box.querySelector('#aiLang').value, default_style: box.querySelector('#aiStyle').value, model: box.querySelector('#aiModel').value }, k = box.querySelector('#aiKey').value.trim(); if (k) body.claude_api_key = k;
        MB.api('/api/ai/settings', { method: 'PUT', body: body }).then(function () { S.cfg = null; toast('AI settings saved'); settingsCard(box, onDone); if (onDone) onDone(); }).catch(function (e) { toast(e.message); });
      };
      var cl = box.querySelector('#aiClear'); if (cl) cl.onclick = function () { if (confirm('Remove the saved API key? Ad Copy Studio will stop working until a new one is added.')) MB.api('/api/ai/settings', { method: 'PUT', body: { claude_api_key: '' } }).then(function () { S.cfg = null; settingsCard(box, onDone); toast('Key removed'); }); };
    }).catch(function (e) { box.innerHTML = '<div class="muted">' + esc(e.message) + '</div>'; });
  }
  function reset() { S.cfg = null; }
  MB.adStudio = { mount: mount, settingsCard: settingsCard, reset: reset };
})();
