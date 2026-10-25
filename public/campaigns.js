/* Ads Manager — one unified flow: Brief → Build (campaign + 3 ad copies in one Claude call) → Review & select → Launch in Meta.
   Tabs: 🚀 Campaign Builder · 📁 Saved Campaigns · ✍️ Ad Library.   MB.ads.mount(el, { isAdmin, onSettings }) */
(function () {
  'use strict';
  var MB = window.MB, esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var GOALS = { CONVERSIONS: 'Conversions', TRAFFIC: 'Traffic', ENGAGEMENT: 'Engagement', LEAD_GENERATION: 'Leads', AWARENESS: 'Awareness' };
  var OBJ = { CONVERSIONS: 'Conversions', TRAFFIC: 'Traffic', ENGAGEMENT: 'Engagement', LEAD_GENERATION: 'Lead generation', AWARENESS: 'Awareness' };
  var META_OBJ = { CONVERSIONS: 'Sales', TRAFFIC: 'Traffic', ENGAGEMENT: 'Engagement', LEAD_GENERATION: 'Leads', AWARENESS: 'Awareness' };
  var FMT = { SINGLE_IMAGE: 'Single image', VIDEO: 'Video', CAROUSEL: 'Carousel', REELS: 'Reels' };
  var GEN = { ALL: 'All genders', MALE: 'Men', FEMALE: 'Women' };
  var MAJOR_CITIES = ['Karachi', 'Lahore', 'Islamabad', 'Faisalabad', 'Rawalpindi', 'Peshawar', 'Quetta', 'Multan'];
  var PLACES = ['Facebook Feed', 'Instagram Feed', 'Instagram Reels', 'Facebook Reels', 'Stories'];
  var LANGS = { ENGLISH: 'English', URDU: 'Urdu', HINGLISH: 'Hinglish' };
  var STY = { market: 'Market Style', premium: 'Premium Style' };
  var MQ = window.matchMedia('(max-width:767px)');
  var ls = { get: function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };
  var $q = function (s, r) { return (r || root).querySelector(s); };

  var S = { ideas: null, setOpen: null, tab: ls.get('mb_ads_tab', 'build'), step: 1, form: { url: '', description: '', budget: '500', goal: 'CONVERSIONS', language: '', style: '', client_id: '', budget_type: 'CBO', age_mode: 'DEFAULT', audience_age_min: 18, audience_age_max: 45, ad_sets: [{ name: 'Ad Set 1', location_type: 'PAKISTAN', targeting_type: 'BROAD', interest: '', ads: 1, start_date: today(), start_time: nowTime(), budget: 500 }], placements_type: 'ADVANTAGE', placements: ['Facebook Feed', 'Instagram Feed', 'Instagram Reels'], advantage_creative: false }, urlNote: '', err: '', busy: false,
    run: null, id: null, status: 'draft', dirty: false, editSet: null, editCopy: null, launched: false, learning: null, loadMsg: 0,
    saved: { list: null, client_id: '', status: '', from: '', to: '', all: false }, lib: { list: null, angles: [], client_id: '', language: '', style: '', angle: '', from: '', to: '', q: '', all: false } };
  if (['build', 'saved', 'library'].indexOf(S.tab) < 0) S.tab = 'build';
  var cfg = null, el = null, root = null, opts = {}, pendingOpen = null, loadTimer = null;

  var css = '.cb{--cbbg:var(--panel,var(--card,#1a1a1a));--cbline:var(--line,#2a2a2a);--cbmut:var(--muted,#888);--cbacc:var(--accent,var(--teal,#7c3aed));--cbtx:var(--text,var(--strong,#fff))}.cb *{box-sizing:border-box}' +
    '.cb .card{background:var(--cbbg);border:1px solid var(--cbline);border-radius:14px;padding:18px;margin-bottom:14px}' +
    '.ads-tabs{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--cbline);overflow-x:auto;scrollbar-width:none}.ads-tabs button{flex:none;background:none;border:0;border-bottom:3px solid transparent;color:var(--cbmut);padding:12px 18px;font-weight:700;font-size:15px;cursor:pointer;margin-bottom:-1px;white-space:nowrap}.ads-tabs button.on{color:var(--cbtx);border-color:var(--cbacc)}' +
    '.cb select,.cb input[type=text],.cb input[type=url],.cb input[type=number],.cb input[type=date],.cb input[type=search],.cb textarea{width:100%;background:var(--input,#141414);color:var(--cbtx);border:1px solid var(--cbline);border-radius:10px;padding:11px 12px;font:inherit;font-size:14px;outline:none}.cb textarea{resize:vertical;line-height:1.5}.cb select:focus,.cb input:focus,.cb textarea:focus{border-color:var(--cbacc)}' +
 '.cb-as{border:1px solid var(--cbline);border-radius:14px;padding:14px;margin-bottom:12px;background:rgba(255,255,255,.02)}.cb-ash{display:flex;justify-content:space-between;align-items:center;gap:10px;border-bottom:1px solid var(--cbline);padding-bottom:10px;margin-bottom:4px}.cb-ash b{letter-spacing:.06em;font-size:13px}.cb-ash button{border:1px solid var(--cbline);background:none;color:var(--red,#ef4444);border-radius:8px;padding:8px 12px;font-weight:700;cursor:pointer;min-height:40px}.cb-addas{width:100%;border:2px dashed var(--cbline);background:none;color:var(--cbacc);border-radius:12px;padding:14px;font-weight:800;font-size:15px;cursor:pointer;min-height:50px}.cb-addas:hover{border-color:var(--cbacc)}' +
    '.cb-money{display:flex;align-items:center;gap:8px}.cb-money input{flex:1}.cb-money span{color:var(--cbmut);font-weight:700;flex:none}.cb-pl{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.cb-pl label{display:flex;gap:6px;align-items:center;border:1px solid var(--cbline);border-radius:99px;padding:8px 14px;font-size:13px;cursor:pointer;min-height:40px}.cb-pl input{width:auto!important}' +
    '.cb .cb-chk{display:flex!important;gap:12px;align-items:flex-start;border:1px solid var(--cbline);border-radius:10px;padding:12px;cursor:pointer;font-size:14px;font-weight:500;color:var(--cbtx);margin:0}.cb .cb-chk input{width:20px!important;height:20px!important;min-height:0!important;margin:1px 0 0!important;accent-color:var(--cbacc);flex:none}.cb .cb-chk small{display:block;color:var(--cbmut);font-size:12px;font-weight:400;margin-top:2px}.cb-asum{font-size:14px;line-height:1.7}.cb-tot{margin-top:8px;padding-top:8px;border-top:1px solid var(--cbline)}' +
 '.cb-ideabtn{margin-top:10px;width:100%;border:1px solid var(--cbacc);background:rgba(124,58,237,.1);color:var(--cbtx);border-radius:10px;padding:13px;font-weight:700;font-size:14px;cursor:pointer;min-height:48px}.cb-ideabtn:disabled{opacity:.7;cursor:wait}.cb-sp2{display:inline-block;width:14px;height:14px;border:2px solid var(--cbline);border-top-color:var(--cbacc);border-radius:50%;animation:cb-sp .8s linear infinite;vertical-align:-2px;margin-right:8px}' +
    '.cb-ideas{margin-top:14px;border-top:2px solid var(--cbline);padding-top:12px}.cb-ih{font-weight:800;letter-spacing:.05em;font-size:13px;margin-bottom:10px}.cb-idea{border:2px solid var(--cbline);border-radius:12px;padding:14px;margin-bottom:10px;cursor:pointer;background:var(--cbbg);transition:border-color .15s}.cb-idea:hover{border-color:rgba(124,58,237,.6)}.cb-idea.sel{border-color:var(--cbacc);background:rgba(124,58,237,.12);box-shadow:0 0 0 3px rgba(124,58,237,.22)}.cb-idea.sel .cb-pick{background:var(--cbacc);border-color:var(--cbacc);color:#fff}.cb-itx{font-size:14.5px;line-height:1.6;margin:4px 0 6px;white-space:pre-wrap}.cb-itg{font-size:12.5px;color:var(--cbmut)}' +
    '.cb-steps{display:flex;gap:6px;margin-bottom:16px;font-size:12.5px;font-weight:700;color:var(--cbmut)}.cb-steps span{flex:1;text-align:center;padding:8px 4px;border-bottom:3px solid var(--cbline);white-space:nowrap}.cb-steps span.on{color:var(--cbtx);border-color:var(--cbacc)}.cb-steps span.done{color:var(--green,#22c55e);border-color:var(--green,#22c55e)}' +
    '.cb-lbl{display:block;font-size:11.5px;font-weight:700;letter-spacing:.07em;color:var(--cbmut);text-transform:uppercase;margin:18px 0 6px}.cb-lbl:first-child{margin-top:0}.cb-lbl em{color:var(--red,#ef4444);font-style:normal}.cb-hint{font-size:12.5px;color:var(--cbmut);margin-top:6px}.cb-hint.ok{color:var(--green,#22c55e)}.cb-hint.bad{color:var(--amber,#f59e0b)}' +
    '.cb-seg{display:flex;gap:8px;flex-wrap:wrap}.cb .cb-seg label{flex:1 1 130px;display:flex!important;gap:10px;align-items:center;text-align:left;border:1px solid var(--cbline);border-radius:10px;padding:12px;cursor:pointer;font-size:14px;font-weight:500;color:var(--cbtx);margin:0}.cb .cb-seg label small{display:block;color:var(--cbmut);font-size:12px;font-weight:400}.cb .cb-seg input{width:18px!important;height:18px!important;min-height:0!important;padding:0!important;margin:0!important;accent-color:var(--cbacc);flex:none}.cb .cb-seg label.on{border-color:var(--cbacc);background:rgba(124,58,237,.12)}' +
    '.cb-go{width:100%;margin-top:20px;border:0;background:var(--cbacc);color:#fff;font-weight:800;font-size:16px;border-radius:12px;padding:16px;cursor:pointer;min-height:54px}.cb-go:disabled{opacity:.55;cursor:not-allowed}' +
    '.cb-err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.5);color:var(--red,#ef4444);border-radius:10px;padding:10px 14px;margin:12px 0;font-size:14px}.cb-note{background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);color:var(--amber,#f59e0b);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:13px}.cb-banner{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.5);color:var(--amber,#f59e0b);border-radius:12px;padding:12px 16px;margin-bottom:14px;font-weight:600}.cb-banner button{margin-left:10px;border:1px solid currentColor;background:none;color:inherit;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer}' +
    '.cb-load{text-align:center;padding:56px 16px}.cb-load .sp{width:46px;height:46px;border:4px solid var(--cbline);border-top-color:var(--cbacc);border-radius:50%;margin:0 auto 18px;animation:cb-sp .9s linear infinite}@keyframes cb-sp{to{transform:rotate(360deg)}}.cb-load b{display:block;font-size:17px;margin-bottom:6px}.cb-load span{color:var(--cbmut);font-size:14px}' +
    '.cb-box{border:2px solid var(--cbline);border-radius:16px;background:var(--cbbg);margin-bottom:16px;overflow:hidden}.cb-bh{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:14px 18px;background:rgba(124,58,237,.1);font-weight:800;letter-spacing:.05em;font-size:13px;cursor:pointer;list-style:none}.cb-bh::-webkit-details-marker{display:none}.cb-bh::after{content:"▾";color:var(--cbmut)}details:not([open])>.cb-bh::after{content:"▸"}.cb-bb{padding:6px 18px 16px}' +
    '.cb-name{font-size:19px;font-weight:800;margin:12px 0 2px}.cb-row{display:flex;gap:12px;padding:8px 0;border-bottom:1px solid var(--cbline);font-size:14px;align-items:flex-start}.cb-row:last-child{border:0}.cb-row>span:first-child{flex:0 0 110px;color:var(--cbmut)}.cb-row>div,.cb-row>span:last-child{flex:1;min-width:0;word-break:break-word}.cb-edit .cb-row{align-items:center}.cb-edit .pl{display:flex;gap:8px;flex-wrap:wrap}.cb-edit .pl label{display:flex;gap:6px;align-items:center;border:1px solid var(--cbline);border-radius:99px;padding:6px 12px;font-size:13px;cursor:pointer}.cb-edit .pl input{width:auto}' +
    '.cb-agr{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px}.cb-agr small{display:block;color:var(--cbmut);font-size:12px;margin-bottom:4px}.cb-fmt{display:flex;gap:8px;flex-wrap:wrap}.cb .cb-fmt input[type=radio]{width:auto;flex:none;min-height:0;margin:0}.cb-fmt label{display:flex;align-items:center;gap:6px;border:1px solid var(--cbline);border-radius:10px;padding:8px 12px;cursor:pointer;min-height:40px;font-weight:600}.cb-fmt label.on{border-color:#7c3aed;background:rgba(124,58,237,.14)}.cb-sh{font-weight:800;font-size:13px;letter-spacing:.04em;margin:22px 0 4px}.cb-sh+.cb-rule{height:1px;background:var(--cbline);margin-bottom:12px}.cb-var{border:2px solid var(--cbline);border-radius:14px;padding:16px;margin-bottom:12px;background:var(--cbbg);cursor:pointer;transition:border-color .15s,box-shadow .15s}.cb-var:hover{border-color:rgba(124,58,237,.6)}.cb-var.sel{border-color:var(--cbacc);background:rgba(124,58,237,.1);box-shadow:0 0 0 3px rgba(124,58,237,.25)}.cb-vh{display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap}.cb-vh b{flex:1;font-size:15px}.cb-pick{width:26px;height:26px;border-radius:50%;border:2px solid var(--cbmut);display:grid;place-items:center;flex:none;font-size:14px;color:transparent}.cb-var.sel .cb-pick{background:var(--cbacc);border-color:var(--cbacc);color:#fff}' +
    '.cb-f{margin:8px 0}.cb-f small{display:block;font-size:11px;font-weight:700;letter-spacing:.07em;color:var(--cbmut);text-transform:uppercase;margin-bottom:2px}.cb-f .hl{font-size:18px;font-weight:800}.cb-f .tx{white-space:pre-wrap;line-height:1.55}' +
    '.cb-vb{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.cb-vb button{flex:1 1 110px;min-height:46px;border-radius:10px;border:1px solid var(--cbline);background:none;color:var(--cbtx);font-weight:700;font-size:14px;cursor:pointer}.cb-vb .use{background:var(--cbacc);border-color:transparent;color:#fff}.cb-var.sel .cb-vb .use{background:transparent;border-color:var(--cbacc);color:var(--cbacc)}' +
    '.cb-ins{border:1px solid rgba(245,158,11,.4);background:rgba(245,158,11,.06);border-radius:14px;padding:14px 18px;margin-bottom:14px}.cb-ins h4{margin:0 0 8px;font-size:13px;letter-spacing:.06em}.cb-ins li{margin:5px 0 5px 18px;font-size:14px}.cb-learn{font-size:12.5px;color:var(--cbmut);margin:0 0 12px}' +
    '.cb-act{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.cb-act button{flex:1 1 150px;min-height:52px;border-radius:12px;border:1px solid var(--cbline);background:none;color:var(--cbtx);font-weight:800;font-size:15px;cursor:pointer}.cb-act .go{background:#1877f2;border-color:transparent;color:#fff}.cb-act .go:disabled{opacity:.45;cursor:not-allowed}.cb-act .pri{background:var(--cbacc);border-color:transparent;color:#fff}' +
    '.cb-launch{background:rgba(24,119,242,.1);border:1px solid rgba(24,119,242,.5);border-radius:14px;padding:18px;font-size:15px;line-height:1.6}.cb-launch h3{margin:0 0 8px;font-size:18px}.cb-launch .b{margin-top:12px;display:flex;gap:8px;flex-wrap:wrap}.cb-launch .b button{border:1px solid currentColor;background:none;color:inherit;border-radius:10px;padding:11px 16px;font-weight:700;cursor:pointer;min-height:46px}' +
    '.cb-fil{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;align-items:center}.cb-fil select,.cb-fil input{flex:1 1 140px;width:auto}.cb-fil label{display:flex;gap:6px;align-items:center;font-size:13px;color:var(--cbmut)}.cb-fil label input{width:auto;flex:none}' +
    '.cb-badge{display:inline-block;border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700}.cb-badge.draft{background:rgba(148,163,184,.2);color:var(--cbmut)}.cb-badge.launched{background:rgba(24,119,242,.2);color:#60a5fa}.cb-badge.ang{background:rgba(124,58,237,.18);color:#c4b5fd}' +
    '.cb-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--cbline);border-radius:12px;margin-bottom:8px;background:var(--cbbg);cursor:pointer}.cb-h:hover{border-color:var(--cbacc)}.cb-h .t{flex:1 1 240px;min-width:0}.cb-h .t b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cb-h .m{font-size:12.5px;color:var(--cbmut)}.cb-h button,.cb-lib button{border:1px solid var(--cbline);background:none;color:var(--cbtx);border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer;min-height:40px}' +
    '.cb-lib{border:1px solid var(--cbline);border-radius:12px;padding:14px;margin-bottom:10px;background:var(--cbbg)}.cb-lib .top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}.cb-lib .m{font-size:12px;color:var(--cbmut);margin-top:8px}.cb-lib .b{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}.cb-lib .b button{flex:1 1 100px}' +
    '@media(max-width:767px){.cb .card{padding:16px 14px}.cb-steps{font-size:11px}.cb-row{flex-direction:column;gap:2px}.cb-row>span:first-child{flex:none;font-size:12px}.cb select,.cb input,.cb textarea{font-size:16px!important;min-height:48px}.cb textarea{min-height:110px}.cb-seg label{flex:1 1 100%!important}.cb-act{position:sticky;bottom:calc(var(--mtab-h,0px) + var(--safe-b,0px) + 6px);z-index:6;background:var(--bg,#0d0d0d);padding:10px 0;margin:8px 0 0}.cb-act button{flex:1 1 100%}.cb-vb button{flex:1 1 100%;min-height:52px}.cb-pick{width:30px;height:30px}.ads-tabs button{padding:12px 12px;font-size:14px}.cb-page{min-height:calc(100dvh - 190px)}.cb-fil select,.cb-fil input{flex:1 1 100%}.cb-f .hl{font-size:19px}}';
  function injectCss() { if (document.getElementById('cb-css')) return; var s = document.createElement('style'); s.id = 'cb-css'; s.textContent = css; document.head.appendChild(s); }
  var toast = function (m) { if (MB && MB.toast) MB.toast(m); else if (window.toast) window.toast(m); };
  var money = function (n) { return '₨' + Math.round(+n || 0).toLocaleString('en-US'); };
  function nowTime() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(11, 16); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var dateLong = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? MONTHS[+m[2] - 1] + ' ' + (+m[3]) + ', ' + m[1] : String(d || ''); };
  var dateShort = function (d) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); return m ? MONTHS[+m[2] - 1].slice(0, 3) + ' ' + (+m[3]) + ', ' + m[1] : String(d || ''); };
  var FORMATS = { SINGLE_IMAGE: 'Image', VIDEO: 'Video', CAROUSEL: 'Carousel' };
  function today() { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); }
  function copyText(t) { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(fb); return fb(); function fb() { var a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); return Promise.resolve(); } }
  var copyOf = function (c) { return (c.headline + '\n\n' + c.primary_text + '\n\n' + c.description).trim(); };
  var rtl = function (s) { return /[؀-ۿ]/.test(s) ? ' dir="rtl" style="text-align:right"' : ''; };

  /* ============================================================ shell */
  function mount(target, o) {
    el = target; opts = o || {}; injectCss();
    el.innerHTML = '<div class="cb"><div id="cbBanner"></div><div class="ads-tabs"><button type="button" data-t="build">🚀 Campaign Builder</button><button type="button" data-t="saved">📁 Saved Campaigns</button><button type="button" data-t="library">✍️ Ad Library</button></div><div id="adsBody"></div></div>';
    el.querySelectorAll('.ads-tabs button').forEach(function (b) { b.onclick = function () { setTab(b.dataset.t); }; });
    root = el.querySelector('#adsBody');
    (cfg ? Promise.resolve() : MB.api('/api/ai/config').then(function (c) { cfg = c; if (!S.form.language) { S.form.language = c.default_language.toUpperCase(); S.form.style = c.default_style; } S.learning = c.learning; }).catch(function (e) { S.err = e.message; })).then(function () {
      if (!S.form.language) { S.form.language = 'ENGLISH'; S.form.style = 'market'; }
      if (pendingOpen) { var id = pendingOpen; pendingOpen = null; S.tab = 'build'; openSaved(id); } else setTab(S.tab);
    });
  }
  function setTab(t) { S.tab = t; ls.set('mb_ads_tab', t); if (t === 'saved' && !S.saved.list) loadSaved(); else if (t === 'library' && !S.lib.list) loadLib(); else paint(); }
  function paint() {
    if (!root || !el.contains(root)) return;
    el.querySelectorAll('.ads-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === S.tab); });
    var ban = el.querySelector('#cbBanner'); ban.innerHTML = cfg && !cfg.has_key ? '<div class="cb-banner">🔑 Add your Claude API key in Settings to use Ads Manager' + (opts.isAdmin && opts.onSettings ? '<button type="button" id="cbSet">Open Settings</button>' : '<span style="font-weight:400"> — ask your admin to add it.</span>') + '</div>' : '';
    var y = window.scrollY; root.innerHTML = S.tab === 'build' ? buildHtml() : S.tab === 'saved' ? savedHtml() : libHtml();
    wire(); window.scrollTo(0, y);
  }


  /* ============================================================ ad sets · placements · Advantage+ creative (shared by the brief and the review editor) */
  var LOC_LABEL = { PAKISTAN: '🇵🇰 Pakistan (whole country)', MAJOR_CITIES: '🏙️ Major Cities (Karachi, Lahore, Islamabad, Faisalabad, Rawalpindi, Peshawar, Quetta, Multan)' };
  var LOC_SHORT = { PAKISTAN: '🇵🇰 Pakistan', MAJOR_CITIES: '🏙️ Major Cities' };
  var newAdSet = function (m) { var last = m.ad_sets[m.ad_sets.length - 1] || {}; return { name: 'Ad Set ' + (m.ad_sets.length + 1), location_type: 'PAKISTAN', targeting_type: 'BROAD', interest: '', ads: 1, start_date: today(), start_time: nowTime(), budget: m.budget_type === 'ABO' ? (+last.budget || 500) : null }; };
  function budgetTypeHtml(m, ns) {
    var r = function (v, label, sub) { return '<label class="' + (m.budget_type === v ? 'on' : '') + '"><input type="radio" name="bt-' + ns + '" data-bt value="' + v + '" ' + (m.budget_type === v ? 'checked' : '') + '><span>' + label + '<small>' + sub + '</small></span></label>'; };
    return '<div class="cb-seg" data-ns="' + ns + '">' + r('CBO', 'CBO — Campaign Budget Optimization', 'Meta distributes budget') + r('ABO', 'ABO — Ad Set Budget Optimization', 'I set budget per ad set') + '</div>';
  }
  function adSetsHtml(m, ns) {
    var abo = m.budget_type === 'ABO', h = '<div id="cbAS-' + ns + '" data-ns="' + ns + '">';
    m.ad_sets.forEach(function (a, i) {
      var rd = function (field, v, label) { return '<label class="' + (a[field] === v ? 'on' : '') + '"><input type="radio" name="' + field + '-' + ns + '-' + i + '" data-asf="' + field + '" data-i="' + i + '" value="' + v + '" ' + (a[field] === v ? 'checked' : '') + '><span>' + label + '</span></label>'; };
      h += '<div class="cb-as"><div class="cb-ash"><b>AD SET ' + (i + 1) + '</b>' + (ns === 'f' && m.ad_sets.length > 1 ? '<button type="button" data-asrm="' + i + '" aria-label="Remove ad set ' + (i + 1) + '">🗑️ Remove</button>' : '') + '</div>' +
        '<label class="cb-lbl">Name</label><input type="text" data-asf="name" data-i="' + i + '" maxlength="60" value="' + esc(a.name) + '">' +
        '<label class="cb-lbl">Location</label><div class="cb-seg">' + rd('location_type', 'PAKISTAN', LOC_LABEL.PAKISTAN) + rd('location_type', 'MAJOR_CITIES', LOC_LABEL.MAJOR_CITIES) + '</div>' +
        '<label class="cb-lbl">Targeting</label><div class="cb-seg">' + rd('targeting_type', 'BROAD', '📊 Broad Targeting') + rd('targeting_type', 'INTEREST', '🎯 Interest Targeting') + '</div>' +
        (a.targeting_type === 'INTEREST' ? '<label class="cb-lbl">Suggested interest</label><input type="text" data-asf="interest" data-i="' + i + '" maxlength="80" value="' + esc(a.interest) + '" placeholder="AI picks the most relevant one — or type your own"><div class="cb-hint">Only 1 interest — the AI picks the most relevant one to the product. You can edit it.</div>' : '') +
        (ns === 'f' ? '<label class="cb-lbl">Number of ads</label><input type="number" data-asf="ads" data-i="' + i + '" min="1" step="1" inputmode="numeric" value="' + esc(a.ads === undefined ? 1 : a.ads) + '"><div class="cb-hint">Each ad gets its own unique ad copy.</div>' : '') +
        (abo ? '<label class="cb-lbl">Daily budget</label><div class="cb-money"><span>₨</span><input type="number" data-asf="budget" data-i="' + i + '" min="1" step="1" inputmode="numeric" value="' + esc(a.budget) + '"><span>/ day</span></div>' : '') + '<div class="cb-agr"><div><small>Start date</small><input type="date" data-asf="start_date" data-i="' + i + '" min="' + today() + '" value="' + esc(a.start_date || today()) + '"></div><div><small>Start time (PKT)</small><input type="time" data-asf="start_time" data-i="' + i + '" value="' + esc(a.start_time || nowTime()) + '"></div></div></div>';
    });
    return h + (ns === 'f' ? '<button type="button" class="cb-addas" data-asadd>＋ Add Ad Set</button>' : '<div class="cb-hint">To change the number of ad sets or ads, edit the brief and regenerate.</div>') + '</div>';
  }
  function placementsHtml(m, ns) {
    var adv = m.placements_type !== 'MANUAL', r = function (v, label, on) { return '<label class="' + (on ? 'on' : '') + '"><input type="radio" name="pt-' + ns + '" data-pt value="' + v + '" ' + (on ? 'checked' : '') + '><span>' + label + '</span></label>'; };
    return '<div class="cb-seg" data-ns="' + ns + '">' + r('ADVANTAGE', 'Advantage+ Placements <small>Recommended — all placements, automatic</small>', adv) + r('MANUAL', 'Manual Placements', !adv) + '</div>' +
      (adv ? '' : '<div class="pl cb-pl" data-ns="' + ns + '">' + PLACES.map(function (p) { return '<label><input type="checkbox" data-pl="' + esc(p) + '" ' + (m.placements.indexOf(p) > -1 ? 'checked' : '') + '>' + p + '</label>'; }).join('') + '</div>');
  }
  function ageHtml(m, ns) {
    var cu = m.age_mode === 'CUSTOM', r = function (v, label, on) { return '<label class="' + (on ? 'on' : '') + '"><input type="radio" name="age-' + ns + '" data-age value="' + v + '" ' + (on ? 'checked' : '') + '><span>' + label + '</span></label>'; };
    return '<div class="cb-seg" data-ns="' + ns + '">' + r('DEFAULT', 'Default <small>Meta optimizes — recommended</small>', !cu) + r('CUSTOM', 'Custom <small>Set my own age range</small>', cu) + '</div>' +
      (cu ? '<div class="cb-agr" data-ns="' + ns + '"><div><small>Min age</small><input type="number" data-agef="audience_age_min" min="13" max="65" inputmode="numeric" value="' + esc(m.audience_age_min) + '"></div><div><small>Max age</small><input type="number" data-agef="audience_age_max" min="13" max="65" inputmode="numeric" value="' + esc(m.audience_age_max) + '"></div></div>' : '');
  }
  function creativeHtml(m, ns) { return '<label class="cb-chk" data-ns="' + ns + '"><input type="checkbox" data-adv ' + (m.advantage_creative ? 'checked' : '') + '><span>Enable AI creative enhancements<small>Meta may modify your creative when enabled</small></span></label>'; }
  /** one set of listeners for either the brief form (ns "f") or the review editor (ns "e"): `model()` returns the object being edited */
  function bindAdvanced(scope, model, redraw) {
    scope.querySelectorAll('[data-ns]').forEach(function (box) {
      box.addEventListener('click', function (e) {
        var b = e.target.closest('[data-asadd],[data-asrm]'); if (!b || !box.contains(b)) return; var m = model();
        if (b.hasAttribute('data-asadd')) m.ad_sets.push(newAdSet(m)); else if (m.ad_sets.length > 1) m.ad_sets.splice(+b.dataset.asrm, 1);
        redraw();
      });
      box.addEventListener('input', function (e) { var af = e.target.closest('[data-agef]'); if (af) model()[af.dataset.agef] = af.value; var n = e.target.closest('[data-asf]'); if (n && n.type !== 'radio') model().ad_sets[+n.dataset.i][n.dataset.asf] = n.value; });
      box.addEventListener('change', function (e) {
        var t = e.target, m = model();
        if (t.matches('[data-asf][type=radio]') && t.checked) { m.ad_sets[+t.dataset.i][t.dataset.asf] = t.value; redraw(); }
        else if (t.matches('[data-bt]') && t.checked) { m.budget_type = t.value; m.ad_sets.forEach(function (a) { a.budget = t.value === 'ABO' ? (+a.budget || +m.budget || +m.budget_daily || 500) : null; }); redraw(); }
        else if (t.matches('[data-age]') && t.checked) { m.age_mode = t.value; if (t.value === 'CUSTOM' && !(+m.audience_age_min >= 13)) { m.audience_age_min = 18; m.audience_age_max = 45; } redraw(); }
        else if (t.matches('[data-pt]') && t.checked) { m.placements_type = t.value; if (t.value === 'MANUAL' && !m.placements.length) m.placements = ['Facebook Feed', 'Instagram Feed']; redraw(); }
        else if (t.matches('[data-pl]')) { var i = m.placements.indexOf(t.dataset.pl); if (t.checked && i < 0) m.placements.push(t.dataset.pl); if (!t.checked && i > -1) m.placements.splice(i, 1); }
        else if (t.matches('[data-adv]')) m.advantage_creative = t.checked;
      });
    });
  }
  var adLine = function (a, i, bt) { return 'Ad Set ' + (i + 1) + (a.name && a.name !== 'Ad Set ' + (i + 1) ? ' “' + a.name + '”' : '') + ': ' + (a.targeting_type === 'INTEREST' ? 'Interest' + (a.interest ? ' (' + a.interest + ')' : '') : 'Broad') + ' | ' + (LOC_SHORT[a.location_type] || a.location_type) + (bt === 'ABO' ? ' | ' + money(a.budget) + '/day (ABO)' : '') + ' | Starts ' + dateShort(a.start_date) + ' at ' + (a.start_time || ''); };
  var dailyTotal = function (c) { return c.budget_type === 'ABO' ? c.ad_sets.reduce(function (t, a) { return t + (+a.budget || 0); }, 0) : +c.budget_daily || 0; };

  /* ============================================================ step 1 — brief */
  function stepBar() {
    var st = S.busy ? 2 : S.launched ? 4 : S.run ? 3 : 1;
    return '<div class="cb-steps">' + ['1 · Brief', '2 · Build', '3 · Review', '4 · Launch'].map(function (l, i) { var n = i + 1; return '<span class="' + (n === st ? 'on' : n < st ? 'done' : '') + '">' + (n < st ? '✓ ' : '') + l + '</span>'; }).join('') + '</div>';
  }
  function briefHtml() {
    var f = S.form, c = cfg || { clients: [] };
    var radio = function (name, val, label, cur, sub) { return '<label class="' + (cur === val ? 'on' : '') + '"><input type="radio" name="' + name + '" value="' + val + '" ' + (cur === val ? 'checked' : '') + '><span>' + label + (sub ? '<small>' + sub + '</small>' : '') + '</span></label>'; };
    return '<form id="cbForm" class="card cb-page" novalidate>' +
      '<label class="cb-lbl">Budget optimization</label>' + budgetTypeHtml(f, 'f') +
      '<label class="cb-lbl" for="cbUrl">Product / service link <em>*</em></label><input type="url" id="cbUrl" inputmode="url" placeholder="https://..." value="' + esc(f.url) + '" autocomplete="off"><div class="cb-hint ' + (S.urlNote.indexOf('✓') === 0 ? 'ok' : S.urlNote ? 'bad' : '') + '" id="cbUrlNote">' + esc(S.urlNote || 'We read the page automatically so the copy uses your real offer.') + '</div>' +
      '<label class="cb-lbl" for="cbDesc">Short description <em>*</em></label><textarea id="cbDesc" rows="4" placeholder="e.g. Teeth whitening powder, removes stains in 7 days, PKR 1,200">' + esc(f.description) + '</textarea>' + ideasHtml() +
      (f.budget_type === 'CBO' ? '<label class="cb-lbl" for="cbBud">Campaign budget</label><div class="cb-money"><span>₨</span><input type="number" id="cbBud" min="1" step="1" inputmode="numeric" value="' + esc(f.budget) + '"><span>/ day</span></div><div class="cb-hint">Meta distributes this across your ad sets.</div>' : '<div class="cb-hint" style="margin-top:14px">ABO: there is no campaign budget — set a daily budget on each ad set below.</div>') +
      '<label class="cb-lbl">Campaign goal</label><div class="cb-seg">' + Object.keys(GOALS).map(function (k) { return radio('goal', k, GOALS[k], f.goal); }).join('') + '</div>' +
      '<label class="cb-lbl">Language</label><div class="cb-seg">' + Object.keys(LANGS).map(function (k) { return radio('language', k, LANGS[k], f.language); }).join('') + '</div>' +
      '<label class="cb-lbl">Ad style</label><div class="cb-seg">' + radio('style', 'market', 'Market Style', f.style, 'Direct, offer-focused, emoji-driven') + radio('style', 'premium', 'Premium Style', f.style, 'Identity, emotion, psychology') + '</div>' +
      '<label class="cb-lbl">Ad sets</label>' + adSetsHtml(f, 'f') +
      '<label class="cb-lbl">Age targeting</label>' + ageHtml(f, 'f') +
      '<label class="cb-lbl">Placements</label>' + placementsHtml(f, 'f') +
      '<label class="cb-lbl">Advantage+ creative enhancements</label>' + creativeHtml(f, 'f') +
      '<label class="cb-lbl" for="cbClient">Linked client <span style="font-weight:400;text-transform:none;letter-spacing:0">(optional)</span></label><select id="cbClient"><option value="">— None —</option>' + c.clients.map(function (x) { return '<option value="' + esc(x.id) + '" ' + (f.client_id === x.id ? 'selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      (S.err ? '<div class="cb-err">' + esc(S.err) + '</div>' : '') +
      '<button class="cb-go" id="cbBuild" type="submit" ' + (cfg && !cfg.has_key ? 'disabled' : '') + '>✨ Build Campaign + Ad Copies</button></form>';
  }
  function ideasHtml() {
    var I = S.ideas || {}, h = '<button type="button" class="cb-ideabtn" id="cbIdeas" ' + (I.busy || (cfg && !cfg.has_key) ? 'disabled' : '') + '>' + (I.busy ? '<span class="cb-sp2"></span>✨ Analysing your product and finding the best angles...' : '✨ Generate Brief Ideas') + '</button>' + (I.err ? '<div class="cb-err" style="margin:10px 0 0">' + esc(I.err) + '</div>' : '');
    if (I.list && I.list.length) {
      if (I.note) h += '<div class="cb-note" style="margin-top:10px">' + esc(I.note) + '</div>';
      h += '<div class="cb-ideas"><div class="cb-ih">💡 BRIEF IDEAS — pick one or edit your own</div>' + I.list.map(function (x, i) {
        return '<div class="cb-idea ' + (I.sel === i ? 'sel' : '') + '" data-idea="' + i + '" role="button" tabindex="0"><div class="cb-vh"><span class="cb-pick">✓</span><b>Angle ' + (i + 1) + ' — ' + esc(x.angle) + '</b></div><div class="cb-itx" dir="auto">' + esc(x.brief) + '</div>' + (x.target ? '<div class="cb-itg">For: ' + esc(x.target) + '</div>' : '') + '</div>';
      }).join('') + (I.claude ? '<div class="cb-hint" style="margin-top:8px">✓ Written live by Claude (' + esc(I.claude.model) + (I.claude.output_tokens ? ' · ' + I.claude.output_tokens + ' tokens' : '') + ')</div>' : '') + '</div>';
    }
    return h;
  }
  function getIdeas() {
    readForm(); var f = S.form, I = S.ideas = Object.assign({ list: null, sel: null }, S.ideas || {}); I.err = '';
    if (!f.url || !/^https?:\/\//i.test(f.url)) { I.err = 'Please enter your product link first'; return paint(); }
    I.busy = true; paint();
    MB.api('/api/ai/campaign/brief-ideas', { method: 'POST', body: { url: f.url, description: f.description } }).then(function (r) { S.ideas = { list: r.briefs, sel: null, busy: false, err: '', note: r.page_note || '', claude: r.claude || null, url: f.url }; paint(); var n = $q('.cb-ideas'); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); })
      .catch(function (e) { S.ideas = Object.assign(S.ideas || {}, { busy: false, err: e.message }); paint(); });
  }
  function useIdea(i) { readForm(); var I = S.ideas; if (!I || !I.list[i]) return; I.sel = i; S.form.description = I.list[i].brief; paint(); var d = $q('#cbDesc'); if (d) { d.focus({ preventScroll: true }); d.setSelectionRange(d.value.length, d.value.length); } }

  function loadHtml() {
    var msgs = ['Reading your product page…', 'Designing the audience and placements…', 'Writing your ad copies…', 'Polishing headlines…'];
    return '<div class="card cb-load cb-page"><div class="sp"></div><b>Building your campaign…</b><span id="cbLoadMsg">' + msgs[S.loadMsg % msgs.length] + '</span><div class="cb-hint" style="margin-top:14px">One Claude call writes the settings and all 3 ad copies — usually 10–20 seconds.</div></div>';
  }

  /* ============================================================ step 3 — review */
  function settingsHtml() {
    var c = S.editSet || S.run.campaign, ed = !!S.editSet;
    var row = function (l, v) { return '<div class="cb-row"><span>' + l + '</span><div>' + v + '</div></div>'; };
    var h = '<details class="cb-box ' + (ed ? 'cb-edit' : '') + '" id="cbSettings"><summary class="cb-bh"><span>📢 CAMPAIGN SETTINGS</span></summary><div class="cb-bb">';
    if (ed) {
      var inp = function (k, type, extra) { return '<input type="' + type + '" data-k="' + k + '" value="' + esc(c[k]) + '" ' + (extra || '') + '>'; }, sel = function (k, map) { return '<select data-k="' + k + '">' + Object.keys(map).map(function (v) { return '<option value="' + v + '" ' + (c[k] === v ? 'selected' : '') + '>' + map[v] + '</option>'; }).join('') + '</select>'; };
      h += row('Name', inp('campaign_name', 'text')) + row('Objective', sel('objective', OBJ)) + row('Budget optimization', budgetTypeHtml(c, 'e')) +
        (c.budget_type === 'CBO' ? row('Campaign budget (₨/day)', inp('budget_daily', 'number', 'min="1" inputmode="numeric"')) : '') + 
        row('Gender', sel('audience_gender', GEN)) + row('Age targeting', ageHtml(c, 'e')) +
        '<div class="cb-lbl" style="margin-top:14px">Ad sets</div>' + adSetsHtml(c, 'e') + '<div class="cb-lbl">Placements</div>' + placementsHtml(c, 'e') + '<div class="cb-lbl">Advantage+ creative enhancements</div>' + creativeHtml(c, 'e');
      h += '<div class="cb-act" style="position:static;margin:12px 0 0"><button type="button" id="cbCancelSet">Cancel</button><button type="button" class="pri" id="cbDoneSet">✓ Apply changes</button></div>';
    } else {
      var daily = dailyTotal(c), abo = c.budget_type === 'ABO';
      h += '<p class="cb-name">' + esc(c.campaign_name) + '</p>' + row('Objective', esc(OBJ[c.objective] || c.objective)) +
        row('Budget', '<b>' + (abo ? 'ABO — ' + money(daily) + '/day across ' + c.ad_sets.length + ' ad set' + (c.ad_sets.length > 1 ? 's' : '') : 'CBO — ' + money(daily) + '/day') + '</b>') +
        row('Audience', esc(GEN[c.audience_gender] + ' · Age ' + (c.age_mode === 'CUSTOM' ? c.audience_age_min + '-' + c.audience_age_max : 'Default (Meta optimizes)'))) + row('Language', esc(LANGS[c.language] || c.language));
      h += '<div class="cb-sec">AD SETS</div><div class="cb-asum">' + c.ad_sets.map(function (a, i) { return '<div dir="auto">' + esc(adLine(a, i, c.budget_type)) + '</div>'; }).join('') +
        '<div class="cb-tot"><div>' + (abo ? 'Total Daily Budget' : 'Campaign Budget') + ': <b>' + money(daily) + '/day</b></div></div></div>';
      h += '<div class="cb-sec">PLACEMENTS</div><div class="cb-asum">' + (c.placements_type === 'MANUAL' ? 'Manual: ' + esc(c.placements.join(', ')) : 'Advantage+ (all placements)') + '</div>' +
        '<div class="cb-sec">ADVANTAGE+ CREATIVE</div><div class="cb-asum">' + (c.advantage_creative ? '<b>On</b> — Meta may modify your creative' : 'Off') + '</div>';
      h += '<div style="margin-top:12px"><button type="button" class="btn ghost" id="cbEditSet" style="border:1px solid var(--cbline);background:none;color:var(--cbtx);border-radius:10px;padding:10px 16px;font-weight:700;cursor:pointer;min-height:44px">✏️ Edit any field</button></div>';
    }
    return h + '</div></details>';
  }
  var setOf = function (c) { return +c.set || 0; };
  var fmtOf = function (c) { return FORMATS[c.format] ? c.format : 'SINGLE_IMAGE'; };
  function varHtml(c, i, n) {
    var sel = (S.run.sel[setOf(c)] || []).indexOf(i) > -1, ed = S.editCopy === i;
    var h = '<div class="cb-var ' + (sel ? 'sel' : '') + '" data-i="' + i + '"><div class="cb-vh"><span class="cb-pick">✓</span><b>Ad ' + n + '</b>' + (sel ? '<span class="cb-badge ang">✅ Selected</span>' : '') + '</div>';
    h += '<div class="cb-f"><small>Format</small><div class="cb-fmt">' + Object.keys(FORMATS).map(function (k) { return '<label class="' + (fmtOf(c) === k ? 'on' : '') + '"><input type="radio" name="fmt-' + i + '" data-fmt value="' + k + '" ' + (fmtOf(c) === k ? 'checked' : '') + '>' + FORMATS[k] + '</label>'; }).join('') + '</div></div>';
    if (ed) {
      h += '<div class="cb-f"><small>Headline</small><input type="text" data-cf="headline" maxlength="120" value="' + esc(c.headline) + '"></div><div class="cb-f"><small>Primary text</small><textarea data-cf="primary_text" rows="9">' + esc(c.primary_text) + '</textarea></div><div class="cb-f"><small>Description</small><input type="text" data-cf="description" maxlength="150" value="' + esc(c.description) + '"></div>' +
        '<div class="cb-vb"><button type="button" data-a="cancel-copy">Cancel</button><button type="button" class="use" data-a="done-copy">✓ Save changes</button></div></div>';
      return h;
    }
    h += '<div class="cb-f"><small>Angle</small><div>' + esc(c.angle) + '</div></div><div class="cb-f"><small>Headline</small><div class="hl"' + rtl(c.headline) + '>“' + esc(c.headline) + '”</div></div><div class="cb-f"><small>Primary text</small><div class="tx" style="white-space:pre-wrap"' + rtl(c.primary_text) + '>' + esc(c.primary_text) + '</div></div><div class="cb-f"><small>Description</small><div' + rtl(c.description) + '>“' + esc(c.description) + '”</div></div>' +
      '<div class="cb-vb"><button type="button" class="use" data-a="pick">' + (sel ? '✅ Selected — tap to remove' : '✅ Use This Ad') + '</button><button type="button" data-a="copy">📋 Copy</button><button type="button" data-a="edit-copy">✏️ Edit</button></div></div>';
    return h;
  }
  /** ads grouped by ad set; every ad is picked or un-picked on its own */
  function copiesHtml() {
    var r = S.run, c = r.campaign;
    return c.ad_sets.map(function (a, si) {
      var mine = []; r.copies.forEach(function (x, i) { if (setOf(x) === si) mine.push(i); });
      var tgt = (a.targeting_type === 'INTEREST' ? 'Interest' + (a.interest ? ' (' + a.interest + ')' : '') : 'Broad') + ' | ' + (LOC_SHORT[a.location_type] || a.location_type) + (c.budget_type === 'ABO' ? ' | ' + money(a.budget) + '/day' : '');
      var h = '<div class="cb-sh" dir="auto">AD SET ' + (si + 1) + ' — ' + esc(tgt) + '</div><div class="cb-hint" style="margin:2px 0 4px">Starts: ' + esc(dateShort(a.start_date)) + ' at ' + esc(a.start_time || '') + '</div><div class="cb-rule"></div>';
      if (!mine.length) return h + '<div class="cb-hint">This ad set uses the ads you pick in Ad Set 1.</div>';
      return h + mine.map(function (i, n) { return varHtml(r.copies[i], i, n + 1); }).join('');
    }).join('');
  }
  var needsPick = function (r) { return r.campaign.ad_sets.some(function (a, si) { return r.copies.some(function (x) { return setOf(x) === si; }) && !(r.sel[si] || []).length; }); };
  /** the ads that go to Meta for an ad set (an ad set without its own ads — saved before this feature — reuses Ad Set 1's) */
  var adsFor = function (r, si) { var l = r.sel[si] || []; if (!l.length && !r.copies.some(function (x) { return setOf(x) === si; })) l = r.sel[0] || []; return l.slice().sort(function (x, y) { return x - y; }).map(function (i) { return r.copies[i]; }); };
  function reviewHtml() {
    var r = S.run, h = (S.err ? '<div class="cb-err">' + esc(S.err) + '</div>' : '') + (r.page_note ? '<div class="cb-note">' + esc(r.page_note) + ' — the copy is based on your description.</div>' : '');
    h += '<div class="cb-page">' + settingsHtml();
    h += '<div class="cb-lbl" style="margin-top:6px">✍️ Choose the ads to launch — one or more per ad set</div>' + learnChip() + copiesHtml();
    if (r.insights.length) h += '<div class="cb-ins"><h4>💡 INSIGHTS</h4><ul>' + r.insights.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="cb-act"><button type="button" id="cbRegen">🔄 Regenerate</button><button type="button" id="cbSave">💾 ' + (S.id && !S.dirty ? 'Saved ✓' : 'Save Draft') + '</button><button type="button" class="go" id="cbLaunch" ' + (needsPick(r) ? 'disabled title="Select at least one ad in every ad set first"' : '') + '>🚀 Launch in Meta</button></div>';
    if (needsPick(r)) h += '<div class="cb-hint" style="text-align:center">Select at least one ad in every ad set to enable Launch.</div>';
    return h + '<div style="text-align:center;margin-top:10px"><button type="button" id="cbBack" style="background:none;border:0;color:var(--cbmut);text-decoration:underline;cursor:pointer;min-height:44px">← Edit the brief</button></div></div>';
  }
  function learnChip() { var l = S.learning; if (!l) return ''; var n = l.approved + l.rejected; return '<p class="cb-learn">🧠 ' + (l.active ? 'Personalised from your past picks (' + n + ' saved choices)' : 'Pick the copy you like — after ' + l.needed + ' choices the builder starts learning your taste (' + n + '/' + l.needed + ')') + '</p>'; }

  /* ============================================================ meta brief + step 4 */
  function metaPrompt(c, adsOf, url) {
    var abo = c.budget_type === 'ABO', daily = dailyTotal(c), U = url || '(none given)';
    var mediaOf = function (f) { return f === 'VIDEO' ? 'Select first available VIDEO from media library' : f === 'CAROUSEL' ? 'Select the first 3 available IMAGES from media library (carousel cards)' : 'Select first available IMAGE from media library'; };
    var sets = c.ad_sets.map(function (a, i) {
      var tgt = a.targeting_type === 'INTEREST' ? 'Interest (' + (a.interest || 'none given') + ')' : 'Broad', loc = a.location_type === 'PAKISTAN' ? 'Pakistan' : 'Major Cities';
      var h = 'AD SET ' + (i + 1) + ' — ' + tgt + ' | ' + loc + '\nName: ' + a.name + '\nSchedule: ' + dateLong(a.start_date) + ' at ' + (a.start_time || '00:00') + ' PKT\n' + (abo ? 'Budget: PKR ' + Math.round(a.budget) + '/day (ABO)\n' : '') +
        'Locations: ' + (a.location_type === 'PAKISTAN' ? 'Pakistan (whole country)' : MAJOR_CITIES.join(', ') + ' (Pakistan)') + '\nTargeting: ' + (a.targeting_type === 'INTEREST' ? 'Interest targeting — exactly ONE detailed-targeting interest: ' + (a.interest || '(none given)') + '. NO behaviors.' : 'Broad — NO interests, NO behaviors (leave detailed targeting empty)') + '\n';
      return h + adsOf(i).map(function (x, n) {
        return '\n  AD ' + (n + 1) + ' — ' + (FORMATS[x.format] || 'Image') + '\n  Website URL: ' + U + '\n  Headline: ' + x.headline + '\n  Primary Text:\n' + x.primary_text.replace(/^/gm, '    ') + '\n  Description: ' + x.description + '\n  CTA: Shop Now\n  Creative: ' + mediaOf(x.format) + '\n';
      }).join('');
    }).join('\n');
    return 'You are helping me set up a Meta (Facebook/Instagram) ad campaign in Ads Manager (https://adsmanager.facebook.com/). Fill in the campaign below, and STOP at the final Review step. Do NOT click Publish or Confirm — I will review and publish it myself.\n\nIf the ad account currency is not PKR, or something below cannot be set exactly, stop and tell me instead of guessing.\n\n' +
      'CAMPAIGN\n- Campaign name: ' + c.campaign_name + '\n- Objective: ' + META_OBJ[c.objective] + ' (' + (OBJ[c.objective] || c.objective) + ')\n- Budget type: ' + (abo ? 'ABO — Ad Set Budget Optimization. Turn Advantage+ campaign budget OFF and set a budget on each ad set.' : 'CBO — Campaign Budget Optimization. Turn Advantage+ campaign budget ON and set it once on the campaign.') + '\n' +
      (abo ? '- Total daily budget across ad sets: PKR ' + Math.round(daily) : '- Campaign daily budget: PKR ' + Math.round(daily) + ' (no budget on the individual ad sets)') + '\n- No end date — leave the end date off so each ad set runs continuously from its own start date and time (shown per ad set below).\n\n' +
      'AUDIENCE (applies to every ad set)\n- Age: ' + (c.age_mode === 'CUSTOM' ? c.audience_age_min + ' to ' + c.audience_age_max : 'Default — leave Meta\'s default age settings untouched (Meta optimizes the age)') + '\n- Gender: ' + (GEN[c.audience_gender] || c.audience_gender) + '\n\n' +
      'PLACEMENTS\n- ' + (c.placements_type === 'MANUAL' ? 'Manual placements: ' + c.placements.join(', ') : 'Advantage+ placements (leave Meta\'s automatic placements selected — do not pick placements manually)') + '\n\n' +
      'AD SETS (' + c.ad_sets.length + ' — create exactly these, each with its own schedule, and exactly the ads listed under it)\n\n' + sets + '\n\n' +
      'FOR EVERY AD\n- At the ad creative section, click \'Add Media\' → \'Select from library\' and pick the media described in that ad\'s Creative line\n- You will replace this media later with the real creative\n- ONLY after selecting media, fill in the text fields\n- Language of copy: ' + (LANGS[c.language] || c.language) + '\n\n' +
      'TURN OFF FOR EVERY AD:\n- Multi-advertiser ads → OFF\n- Prompts and responses → OFF\n' + (c.advantage_creative ? '- Advantage+ creative enhancements → leave ON (I enabled them)' : '- Advantage+ creative enhancements → all OFF') + '\nDo not skip this step.' +
      '\n\nWhen everything is filled in, leave the Review screen open and tell me it is ready.';
  }
  function launchHtml() {
    return '<div class="cb-page"><div class="cb-launch"><h3>🚀 Meta Ads Manager opened and brief copied to clipboard</h3>Paste it into Claude chat (Claude in Chrome on the Ads Manager tab) to auto-fill everything. It fills in the campaign and <b>stops at the Review screen</b> — nothing is published until you press Publish yourself.' +
      '<div class="b"><button type="button" id="cbCopyAgain">📋 Copy brief again</button><button type="button" id="cbOpenMeta">Open Ads Manager ↗</button></div></div>' +
      '<div class="cb-act"><button type="button" id="cbReview">← Back to the campaign</button><button type="button" class="pri" id="cbNew">＋ New campaign</button></div><div class="cb-hint" style="text-align:center">Saved as “Launched” in 📁 Saved Campaigns.</div></div>';
  }
  function buildHtml() {
    var h = stepBar();
    if (S.busy) return h + loadHtml();
    if (S.launched && S.run) return h + launchHtml();
    return h + (S.run ? reviewHtml() : briefHtml());
  }

  /* ============================================================ saved campaigns + library */
  function savedHtml() {
    var f = S.saved, c = cfg || { clients: [] }, l = f.list;
    var h = '<div class="cb-fil"><select id="fsCl"><option value="">All clients</option>' + c.clients.map(function (x) { return '<option value="' + esc(x.id) + '" ' + (f.client_id === x.id ? 'selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select><select id="fsSt"><option value="">All statuses</option><option value="draft" ' + (f.status === 'draft' ? 'selected' : '') + '>Draft</option><option value="launched" ' + (f.status === 'launched' ? 'selected' : '') + '>Launched</option></select>' +
      '<input type="date" id="fsFrom" value="' + esc(f.from) + '" title="From"><input type="date" id="fsTo" value="' + esc(f.to) + '" title="To">' + (opts.isAdmin ? '<label><input type="checkbox" id="fsAll" ' + (f.all ? 'checked' : '') + '> Whole team</label>' : '') + '</div>';
    if (!l) return h + '<div class="card">Loading…</div>';
    if (!l.length) return h + '<div class="card" style="text-align:center;color:var(--cbmut)">No campaigns match. Build one in 🚀 Campaign Builder and press 💾 Save Draft.</div>';
    return h + l.map(function (x) { return '<div class="cb-h" data-id="' + esc(x.id) + '"><div class="t"><b>' + esc(x.campaign_name) + '</b><div class="m">' + esc((x.created_at || '').slice(0, 10)) + (x.client_name ? ' · ' + esc(x.client_name) : '') + (x.user_name && opts.isAdmin ? ' · ' + esc(x.user_name) : '') + ' · ' + money(x.budget_daily) + '/day</div>' + (x.ad_headline ? '<div class="m" dir="auto">“' + esc(x.ad_headline) + '”</div>' : '') + '</div><span class="cb-badge ' + x.status + '">' + (x.status === 'launched' ? 'Launched' : 'Draft') + '</span>' +
      '<button type="button" data-a="open">Open</button><button type="button" data-a="edit">Edit</button><button type="button" data-a="dup">Duplicate</button><button type="button" data-a="del" title="Delete">🗑</button></div>'; }).join('');
  }
  function libHtml() {
    var f = S.lib, c = cfg || { clients: [] }, l = f.list;
    var h = '<div class="cb-fil"><input type="search" id="flQ" placeholder="🔍 Search headlines and copy…" value="' + esc(f.q) + '"><select id="flCl"><option value="">All clients</option>' + c.clients.map(function (x) { return '<option value="' + esc(x.id) + '" ' + (f.client_id === x.id ? 'selected' : '') + '>' + esc(x.name) + '</option>'; }).join('') + '</select>' +
      '<select id="flLa"><option value="">All languages</option>' + Object.keys(LANGS).map(function (k) { return '<option value="' + k + '" ' + (f.language === k ? 'selected' : '') + '>' + LANGS[k] + '</option>'; }).join('') + '</select><select id="flSt"><option value="">All styles</option><option value="market" ' + (f.style === 'market' ? 'selected' : '') + '>Market</option><option value="premium" ' + (f.style === 'premium' ? 'selected' : '') + '>Premium</option></select>' +
      '<select id="flAn"><option value="">All angles</option>' + f.angles.map(function (a) { return '<option ' + (f.angle === a ? 'selected' : '') + '>' + esc(a) + '</option>'; }).join('') + '</select><input type="date" id="flFrom" value="' + esc(f.from) + '" title="From"><input type="date" id="flTo" value="' + esc(f.to) + '" title="To">' + (opts.isAdmin ? '<label><input type="checkbox" id="flAll" ' + (f.all ? 'checked' : '') + '> Whole team</label>' : '') + '</div>';
    return h + '<div id="flList">' + libList() + '</div>';
  }
  function libList() {
    var l = S.lib.list;
    if (!l) return '<div class="card">Loading…</div>';
    if (!l.length) return '<div class="card" style="text-align:center;color:var(--cbmut)">No ad copies match. Copies appear here when you 💾 Save a campaign.</div>';
    return l.map(function (x) { return '<div class="cb-lib" data-id="' + esc(x.id) + '"><div class="top"><span class="cb-badge ang">' + esc(x.angle || 'Copy') + '</span>' + (x.selected ? '<span class="cb-badge launched">✅ Used</span>' : '') + (x.source === 'legacy' ? '<span class="cb-badge draft">Old studio</span>' : '') + '</div>' +
      (x.headline ? '<div class="cb-f"><small>Headline</small><div class="hl"' + rtl(x.headline) + '>“' + esc(x.headline) + '”</div></div>' : '') + (x.primary_text ? '<div class="cb-f"><small>Primary text</small><div class="tx"' + rtl(x.primary_text) + '>' + esc(x.primary_text) + '</div></div>' : '') + (x.description ? '<div class="cb-f"><small>Description</small><div' + rtl(x.description) + '>“' + esc(x.description) + '”</div></div>' : '') +
      '<div class="m">' + esc((x.created_at || '').slice(0, 10)) + ' · ' + esc(LANGS[x.language] || x.language || '') + ' · ' + esc(STY[x.style] || '') + (x.client_name ? ' · ' + esc(x.client_name) : '') + (x.campaign_name ? ' · ' + esc(x.campaign_name) : '') + '</div>' +
      '<div class="b"><button type="button" data-a="copy">📋 Copy</button>' + (x.campaign_id ? '<button type="button" data-a="campaign">Open campaign</button>' : '') + '<button type="button" data-a="del">🗑 Delete</button></div></div>'; }).join('');
  }

  /* ============================================================ actions */
  function qs(o) { return '?' + Object.keys(o).filter(function (k) { return o[k]; }).map(function (k) { return k + '=' + encodeURIComponent(o[k] === true ? 'all' : o[k]); }).join('&'); }
  function loadSaved() { var f = S.saved; f.list = null; paint(); return MB.api('/api/ai/campaigns/list' + qs({ client_id: f.client_id, status: f.status, from: f.from, to: f.to, scope: f.all })).then(function (r) { f.list = r.campaigns; paint(); }).catch(function (e) { f.list = []; toast(e.message); paint(); }); }
  var libTimer = null;
  function loadLib(keepFocus) {
    var f = S.lib; if (!keepFocus) { f.list = null; paint(); }
    return MB.api('/api/ai/library' + qs({ client_id: f.client_id, language: f.language, style: f.style, angle: f.angle, from: f.from, to: f.to, q: f.q, scope: f.all })).then(function (r) {
      f.list = r.copies; f.angles = r.angles;
      if (keepFocus) { var box = $q('#flList'); if (box) { box.innerHTML = libList(); wireLib(); } } else paint();
    }).catch(function (e) { f.list = []; toast(e.message); paint(); });
  }
  function build(regen) {
    readForm(); var f = S.form; S.err = '';
    if (!f.url || !/^https?:\/\//i.test(f.url)) { S.err = 'Paste the full product or service link (https://…).'; return paint(); }
    if (f.description.trim().length < 10) { S.err = 'Add a short description: product, offer and key benefit.'; return paint(); }
    if (f.budget_type === 'CBO' && !(+f.budget >= 1)) { S.err = 'Enter the campaign budget in PKR per day.'; return paint(); }
    if (!f.ad_sets.length) { S.err = 'Add at least one ad set.'; return paint(); }
    var bad = f.ad_sets.findIndex(function (a) { var n = +a.ads; return !(n >= 1) || Math.round(n) !== n; });
    if (bad > -1) { S.err = 'Ad set ' + (bad + 1) + ': enter a whole number of ads, 1 or more.'; return paint(); }
    f.ad_sets.forEach(function (a) { a.ads = Math.round(+a.ads); if (!/^\d{4}-\d{2}-\d{2}$/.test(a.start_date || '')) a.start_date = today(); if (a.start_date < today()) a.start_date = today(); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.start_time || '')) a.start_time = nowTime(); });
    if (f.age_mode === 'CUSTOM') { var lo = Math.round(+f.audience_age_min), hi = Math.round(+f.audience_age_max); if (!(lo >= 13 && lo <= 65 && hi >= 13 && hi <= 65)) { S.err = 'Enter a minimum and maximum age between 13 and 65.'; return paint(); } }
    if (f.budget_type === 'ABO' && f.ad_sets.some(function (a) { return !(+a.budget >= 1); })) { S.err = 'Enter a daily budget for every ad set.'; return paint(); }
    if (f.placements_type === 'MANUAL' && !f.placements.length) { S.err = 'Pick at least one placement, or use Advantage+ placements.'; return paint(); }
    var avoid = regen && S.run ? S.run.copies.map(function (c) { return '- ' + c.headline; }).join('\n') : '';
    S.busy = true; S.launched = false; S.loadMsg = 0; paint(); clearInterval(loadTimer); loadTimer = setInterval(function () { S.loadMsg++; var m = $q('#cbLoadMsg'); if (m) m.textContent = ['Reading your product page…', 'Designing the audience and placements…', 'Writing three ad copy angles…', 'Polishing headlines…'][S.loadMsg % 4]; }, 3500);
    MB.api('/api/ai/campaign/generate', { method: 'POST', body: { url: f.url, description: f.description, budget_type: f.budget_type, budget_daily: f.budget, ad_sets: f.ad_sets, age_mode: f.age_mode, age_min: f.audience_age_min, age_max: f.audience_age_max, placements_type: f.placements_type, placements: f.placements, advantage_creative: !!f.advantage_creative, goal: f.goal, language: f.language, style: f.style, client_id: f.client_id, avoid: avoid } }).then(function (r) {
      clearInterval(loadTimer); S.busy = false; S.run = { generation_id: r.generation_id, campaign: r.campaign, copies: r.ad_copies, insights: r.insights, sel: r.campaign.ad_sets.map(function () { return []; }), page_note: r.page_note, product_url: r.product_url, brief: f.description, style: f.style }; S.learning = r.learning || S.learning; S.dirty = true; S.editSet = null; S.editCopy = null; paint(); window.scrollTo(0, 0);
    }).catch(function (e) { clearInterval(loadTimer); S.busy = false; S.err = e.message; paint(); });
  }
  function pick(i) {
    var r = S.run, si = setOf(r.copies[i]), l = r.sel[si] = r.sel[si] || [], at = l.indexOf(i), on = at < 0;
    if (on) l.push(i); else l.splice(at, 1);
    S.dirty = true; paint();
    if (r.generation_id) MB.api('/api/ai/campaign/select', { method: 'POST', body: { generation_id: r.generation_id, index: i, selected: on } }).then(function (x) { if (x.learning) { S.learning = x.learning; var n = $q('.cb-learn'); if (n) { n.outerHTML = learnChip(); } } }).catch(function () {});
  }
  function save(quiet) {
    var r = S.run;
    return MB.api('/api/ai/campaign/save', { method: 'POST', body: { id: S.id, client_id: S.form.client_id, campaign: Object.assign({}, r.campaign, { ad_sets: r.campaign.ad_sets.map(function (a, si) { return Object.assign({}, a, { selected: r.sel[si] || [] }); }) }), ad_copies: r.copies, insights: r.insights, product_url: r.product_url || S.form.url, brief: r.brief || S.form.description, ad_style: r.style || S.form.style, generation_id: r.generation_id } }).then(function (x) {
      S.id = x.id; S.status = x.campaign.status; S.dirty = false; if (!quiet) toast('Draft saved'); S.saved.list = null; S.lib.list = null; paint(); return x;
    }).catch(function (e) { toast(e.message); throw e; });
  }
  function launch() {
    var r = S.run; if (needsPick(r)) return toast('Select at least one ad in every ad set first');
    var w = window.open('https://adsmanager.facebook.com/', '_blank', 'noopener');
    copyText(metaPrompt(r.campaign, function (si) { return adsFor(r, si); }, r.product_url || S.form.url));
    (S.id && !S.dirty ? Promise.resolve() : save(true)).then(function () { return MB.api('/api/ai/campaign/' + encodeURIComponent(S.id) + '/launch', { method: 'POST' }); }).then(function () {
      S.status = 'launched'; S.launched = true; S.saved.list = null; paint(); window.scrollTo(0, 0); toast(w ? '✓ Brief copied — paste it into Claude' : 'Pop-up blocked — use “Open Ads Manager”');
    }).catch(function (e) { toast(e.message || 'Could not launch'); });
  }
  function openSaved(id, edit) {
    return MB.api('/api/ai/campaign/' + encodeURIComponent(id) + '?full=1').then(function (x) {
      var c = x.campaign, copies = c.ad_copies && c.ad_copies.length ? c.ad_copies : [{ angle: 'Saved copy', headline: c.ad_headline, primary_text: c.ad_primary_text, description: c.ad_description }];
      var camp = {}; ['campaign_name', 'objective', 'budget_daily', 'age_mode', 'audience_age_min', 'audience_age_max', 'audience_gender', 'audience_locations', 'audience_interests', 'ad_format', 'placements', 'language', 'budget_type', 'ad_sets', 'placements_type', 'advantage_creative'].forEach(function (k) { camp[k] = c[k]; });
      var sel = c.ad_sets.map(function (a, si) { return (Array.isArray(a.selected) ? a.selected : []).filter(function (v) { return copies[v] && setOf(copies[v]) === si; }); });
      if (sel.every(function (v) { return !v.length; }) && c.selected_copy_index !== null && c.selected_copy_index !== undefined && copies[c.selected_copy_index]) sel[setOf(copies[c.selected_copy_index])] = [c.selected_copy_index];   // saved before ads were chosen per ad set
      S.run = { generation_id: c.generation_id, campaign: camp, copies: copies, insights: c.insights || [], sel: sel, page_note: '', product_url: c.product_url || '', brief: c.brief || '', style: c.ad_style || 'market' };
      S.ideas = null; S.id = c.id; S.status = c.status; S.dirty = false; S.launched = false; S.err = ''; S.editCopy = null; S.editSet = edit ? JSON.parse(JSON.stringify(camp)) : null;
      S.form = { url: c.product_url || '', description: c.brief || '', budget: String(c.budget_type === 'CBO' ? c.budget_daily : 500), goal: c.objective, language: c.language, style: c.ad_style || 'market', client_id: c.client_id || '', budget_type: c.budget_type || 'CBO', ad_sets: JSON.parse(JSON.stringify(c.ad_sets)), placements_type: c.placements_type || 'ADVANTAGE', placements: (c.placements && c.placements.length ? c.placements.slice() : ['Facebook Feed', 'Instagram Feed']), advantage_creative: false, age_mode: c.age_mode === 'CUSTOM' ? 'CUSTOM' : 'DEFAULT', audience_age_min: c.audience_age_min || 18, audience_age_max: c.audience_age_max || 45 };   // the creative toggle always starts unticked on a new brief
      S.tab = 'build'; ls.set('mb_ads_tab', 'build'); paint(); window.scrollTo(0, 0);
    }).catch(function (e) { toast(e.message); });
  }
  function readForm() {
    var u = $q('#cbUrl'); if (!u) return; var f = S.form; f.url = u.value.trim(); f.description = $q('#cbDesc').value; var bd = $q('#cbBud'); if (bd) f.budget = bd.value;
    ['goal', 'language', 'style'].forEach(function (k) { var c = root.querySelector('input[name=' + k + ']:checked'); if (c) f[k] = c.value; }); f.client_id = $q('#cbClient').value;
  }
  function checkUrl() {
    readForm(); var u = S.form.url; if (!/^https?:\/\//i.test(u)) { S.urlNote = ''; return; }
    var n = $q('#cbUrlNote'); if (n) { n.className = 'cb-hint'; n.textContent = 'Reading the page…'; }
    MB.api('/api/ai/fetch-url', { method: 'POST', body: { url: u } }).then(function (r) { S.urlNote = '✓ Read ' + r.chars.toLocaleString() + ' characters' + (r.title ? ' from “' + r.title + '”' : ''); }).catch(function (e) { S.urlNote = '⚠ ' + e.message; }).then(function () { var m = root && $q('#cbUrlNote'); if (m) { m.className = 'cb-hint ' + (S.urlNote.indexOf('✓') === 0 ? 'ok' : 'bad'); m.textContent = S.urlNote; } });
  }
  function readSet() {
    var e = S.editSet, base = S.run.campaign, num = function (k, d, lo, hi) { var v = Math.round(+String(e[k]).replace(/[, ]/g, '')); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    e.budget_daily = num('budget_daily', base.budget_daily, 1, 1e8); e.audience_age_min = num('audience_age_min', 18, 13, 65); e.audience_age_max = num('audience_age_max', 45, 13, 65);
    if (e.age_mode !== 'CUSTOM') { e.age_mode = 'DEFAULT'; e.audience_age_min = 18; e.audience_age_max = 65; }
    if (e.audience_age_min > e.audience_age_max) { var t = e.audience_age_min; e.audience_age_min = e.audience_age_max; e.audience_age_max = t; }
    if (!String(e.campaign_name || '').trim()) e.campaign_name = base.campaign_name;
    if (!e.ad_sets.length) e.ad_sets.push(newAdSet(e));
    e.ad_sets.forEach(function (a, i) { a.name = String(a.name || '').trim() || 'Ad Set ' + (i + 1); if (!/^\d{4}-\d{2}-\d{2}$/.test(a.start_date || '')) a.start_date = today(); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.start_time || '')) a.start_time = nowTime(); a.interest = a.targeting_type === 'INTEREST' ? String(a.interest || '').split(/[,;\n|\/]/)[0].trim() : ''; a.budget = e.budget_type === 'ABO' ? Math.max(1, Math.round(+a.budget) || 500) : null; });
    if (e.budget_type === 'ABO') e.budget_daily = dailyTotal(e);
    if (e.placements_type === 'MANUAL' && !e.placements.length) e.placements = ['Facebook Feed'];
    e.audience_locations = []; e.audience_interests = e.ad_sets.map(function (a) { return a.interest; }).filter(Boolean);
    return e;
  }

  /* ============================================================ wiring */
  function wireLib() {
    root.querySelectorAll('.cb-lib').forEach(function (n) {
      var id = n.dataset.id, x = (S.lib.list || []).filter(function (c) { return c.id === id; })[0]; if (!x) return;
      n.querySelectorAll('[data-a]').forEach(function (b) { b.onclick = function () {
        if (b.dataset.a === 'copy') copyText(copyOf({ headline: x.headline || '', primary_text: x.primary_text || '', description: x.description || '' })).then(function () { toast('✓ Copied'); });
        else if (b.dataset.a === 'campaign') openSaved(x.campaign_id);
        else if (b.dataset.a === 'del' && confirm('Delete this ad copy from the library?')) MB.api('/api/ai/library/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { S.lib.list = S.lib.list.filter(function (c) { return c.id !== id; }); n.remove(); toast('Deleted'); }).catch(function (e) { toast(e.message); });
      }; });
    });
  }
  function wire() {
    var set = $q('#cbSet', el); if (set) set.onclick = opts.onSettings;
    if (S.tab === 'build') {
      var form = $q('#cbForm');
      if (form) {
        form.onsubmit = function (e) { e.preventDefault(); build(false); };
        $q('#cbUrl').onchange = checkUrl; $q('#cbUrl').oninput = function () { S.form.url = this.value.trim(); }; $q('#cbDesc').oninput = function () { S.form.description = this.value; }; var bud = $q('#cbBud'); if (bud) bud.oninput = function () { S.form.budget = this.value; };
        form.querySelectorAll('.cb-seg input').forEach(function (i) { i.onchange = function () { readForm(); form.querySelectorAll('.cb-seg label').forEach(function (l) { l.classList.toggle('on', l.querySelector('input').checked); }); }; });
        $q('#cbClient').onchange = readForm;
        var ib = $q('#cbIdeas'); if (ib) ib.onclick = getIdeas;
        form.querySelectorAll('[data-idea]').forEach(function (n) { n.onclick = function () { useIdea(+n.dataset.idea); }; n.onkeydown = function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); useIdea(+n.dataset.idea); } }; });
        bindAdvanced(form, function () { return S.form; }, function () { readForm(); paint(); });
      }
      var sd = $q('#cbSettings'); if (sd) { sd.open = S.editSet ? true : (S.setOpen === null ? !MQ.matches : S.setOpen); sd.ontoggle = function () { if (!S.editSet) S.setOpen = sd.open; }; }
      var es = $q('#cbEditSet'); if (es) es.onclick = function () { S.editSet = JSON.parse(JSON.stringify(S.run.campaign)); paint(); };
      var cs = $q('#cbCancelSet'); if (cs) cs.onclick = function () { S.editSet = null; paint(); };
      var ds = $q('#cbDoneSet'); if (ds) ds.onclick = function () { S.run.campaign = readSet(); S.editSet = null; S.dirty = true; paint(); toast('Settings updated'); };
      root.querySelectorAll('#cbSettings [data-k]').forEach(function (n) { n.oninput = n.onchange = function () { S.editSet[n.dataset.k] = n.value; }; });
      root.querySelectorAll('#cbSettings [data-l]').forEach(function (n) { n.oninput = function () { S.editSet[n.dataset.l] = n.value.split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }; });
      var ceb = $q('#cbSettings.cb-edit'); if (ceb) bindAdvanced(ceb, function () { return S.editSet; }, function () { paint(); });
      root.querySelectorAll('.cb-var').forEach(function (card) {
        var i = +card.dataset.i;
        card.querySelectorAll('input[data-fmt]').forEach(function (rd) { rd.onchange = function () { S.run.copies[i].format = rd.value; S.dirty = true; paint(); }; });
        card.onclick = function (e) { if (S.editCopy === i || e.target.closest('button,input,textarea,select,a,label')) return; pick(i); };
        card.querySelectorAll('[data-a]').forEach(function (b) { b.onclick = function (e) { e.stopPropagation(); var a = b.dataset.a, c = S.run.copies[i];
          if (a === 'pick') pick(i);
          else if (a === 'copy') copyText(copyOf(c)).then(function () { toast('✓ Copied'); });
          else if (a === 'edit-copy') { S.editCopy = i; paint(); }
          else if (a === 'cancel-copy') { S.editCopy = null; paint(); }
          else if (a === 'done-copy') { card.querySelectorAll('[data-cf]').forEach(function (n) { c[n.dataset.cf] = n.value.trim(); }); S.editCopy = null; S.dirty = true; paint(); toast('Copy updated'); } }; });
      });
      var rg = $q('#cbRegen'); if (rg) rg.onclick = function () { if (S.dirty && S.run && (S.run.sel.some(function (v) { return v.length; }) || S.editSet) && !confirm('Regenerate everything? Unsaved edits and your selection will be replaced.')) return; build(true); };
      var sv = $q('#cbSave'); if (sv) sv.onclick = function () { if (S.id && !S.dirty) return toast('Already saved'); save(false); };
      var lg = $q('#cbLaunch'); if (lg) lg.onclick = launch;
      var bk = $q('#cbBack'); if (bk) bk.onclick = function () { S.run = null; S.id = null; S.status = 'draft'; S.dirty = false; S.err = ''; paint(); };
      var ca = $q('#cbCopyAgain'); if (ca) ca.onclick = function () { copyText(metaPrompt(S.run.campaign, function (si) { return adsFor(S.run, si); }, S.run.product_url || S.form.url)).then(function () { toast('✓ Copied'); }); };
      var om = $q('#cbOpenMeta'); if (om) om.onclick = function () { window.open('https://adsmanager.facebook.com/', '_blank', 'noopener'); };
      var rv = $q('#cbReview'); if (rv) rv.onclick = function () { S.launched = false; paint(); };
      var nw = $q('#cbNew'); if (nw) nw.onclick = function () { S.run = null; S.id = null; S.status = 'draft'; S.dirty = false; S.launched = false; S.err = ''; S.form.url = ''; S.form.description = ''; S.urlNote = ''; S.ideas = null; paint(); window.scrollTo(0, 0); };
    } else if (S.tab === 'saved') {
      [['fsCl', 'client_id'], ['fsSt', 'status'], ['fsFrom', 'from'], ['fsTo', 'to']].forEach(function (p) { var n = $q('#' + p[0]); if (n) n.onchange = function () { S.saved[p[1]] = n.value; loadSaved(); }; });
      var fa = $q('#fsAll'); if (fa) fa.onchange = function () { S.saved.all = fa.checked; loadSaved(); };
      root.querySelectorAll('.cb-h').forEach(function (row) {
        var id = row.dataset.id; row.onclick = function (e) { var a = e.target.closest('[data-a]'); if (!a) return openSaved(id); e.stopPropagation();
          if (a.dataset.a === 'open') openSaved(id); else if (a.dataset.a === 'edit') openSaved(id, true);
          else if (a.dataset.a === 'dup') MB.api('/api/ai/campaign/' + encodeURIComponent(id) + '/duplicate', { method: 'POST' }).then(function (r) { toast('Duplicated as a new draft'); S.saved.list = null; return openSaved(r.id, true); }).catch(function (x) { toast(x.message); });
          else if (a.dataset.a === 'del' && confirm('Delete this campaign and its saved ad copies?')) MB.api('/api/ai/campaign/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { if (S.id === id) { S.id = null; S.run = null; } S.lib.list = null; loadSaved(); toast('Deleted'); }).catch(function (x) { toast(x.message); }); };
      });
    } else {
      [['flCl', 'client_id'], ['flLa', 'language'], ['flSt', 'style'], ['flAn', 'angle'], ['flFrom', 'from'], ['flTo', 'to']].forEach(function (p) { var n = $q('#' + p[0]); if (n) n.onchange = function () { S.lib[p[1]] = n.value; loadLib(); }; });
      var la = $q('#flAll'); if (la) la.onchange = function () { S.lib.all = la.checked; loadLib(); };
      var q = $q('#flQ'); if (q) q.oninput = function () { S.lib.q = q.value.trim(); clearTimeout(libTimer); libTimer = setTimeout(function () { loadLib(true); }, 350); };
      wireLib();
    }
  }
  MB.ads = { mount: mount, openCampaign: function (id) { S.tab = 'build'; ls.set('mb_ads_tab', 'build'); pendingOpen = id; }, reset: function () { cfg = null; } };
})();
