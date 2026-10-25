/* Ads Manager UI: tabs (✍️ Ad Copy · 🚀 Campaign Builder) + the Campaign Builder.
   Shared by the admin app and the employee portal.  MB.ads.mount(el, { isAdmin, onSettings }) */
(function () {
  'use strict';
  var MB = window.MB, esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var OBJ = { CONVERSIONS: 'Conversions', TRAFFIC: 'Traffic', ENGAGEMENT: 'Engagement', LEAD_GENERATION: 'Lead generation', AWARENESS: 'Awareness' };
  var META_OBJ = { CONVERSIONS: 'Sales', TRAFFIC: 'Traffic', ENGAGEMENT: 'Engagement', LEAD_GENERATION: 'Leads', AWARENESS: 'Awareness' };
  var FMT = { SINGLE_IMAGE: 'Single image', VIDEO: 'Video', CAROUSEL: 'Carousel', REELS: 'Reels' };
  var GEN = { ALL: 'All genders', MALE: 'Male', FEMALE: 'Female' };
  var PLACES = ['Facebook Feed', 'Instagram Feed', 'Instagram Reels', 'Facebook Reels', 'Stories'];
  var LANGS = { ENGLISH: 'English', URDU: 'Urdu', HINGLISH: 'Hinglish' };
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var VLANG = { en: 'en-US', ur: 'ur-PK', hi: 'en-IN' };
  var ls = { get: function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } }, set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} } };

  var C = { view: 'build', client_id: '', instructions: [], mode: 'text', campaign: null, summary: '', suggestions: [], changes: [], id: null, status: 'draft', dirty: false, edit: null, busy: false, err: '', launched: false,
    text: '', rec: { on: false, text: '', lang: ls.get('mb_voice_lang', 'en') }, hist: { list: null, all: false } };
  var cfg = null, el = null, opts = {}, root = null, outer = ls.get('mb_ads_tab', 'copy');

  var css = '.cb{--cbbg:var(--panel,var(--card,#1a1a1a));--cbline:var(--line,#2a2a2a);--cbmut:var(--muted,#888);--cbacc:var(--accent,var(--teal,#7c3aed));--cbtx:var(--text,var(--strong,#fff))}' +
    '.cb *{box-sizing:border-box}.cb .card{background:var(--cbbg);border:1px solid var(--cbline);border-radius:14px;padding:18px;margin-bottom:14px}' +
    '.ads-tabs{display:flex;gap:6px;margin-bottom:16px;border-bottom:1px solid var(--line,#2a2a2a)}.ads-tabs button{background:none;border:0;border-bottom:3px solid transparent;color:var(--muted,#888);padding:12px 18px;font-weight:700;font-size:15px;cursor:pointer;margin-bottom:-1px}.ads-tabs button.on{color:var(--text,var(--strong,#fff));border-color:var(--accent,var(--teal,#7c3aed))}' +
    '.cb-top{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:14px}.cb-top select{flex:1 1 220px;max-width:340px}.cb .sub{display:flex;gap:6px;margin-left:auto}.cb .sub button{border:1px solid var(--cbline);background:none;color:var(--cbmut);border-radius:99px;padding:8px 16px;font-weight:600;cursor:pointer}.cb .sub button.on{background:var(--cbacc);border-color:transparent;color:#fff}' +
    '.cb select,.cb input[type=text],.cb input[type=number],.cb input[type=date],.cb textarea{width:100%;background:var(--input,#141414);color:var(--cbtx);border:1px solid var(--cbline);border-radius:10px;padding:10px 12px;font:inherit;font-size:14px;outline:none}.cb textarea{resize:vertical;line-height:1.5}.cb select:focus,.cb input:focus,.cb textarea:focus{border-color:var(--cbacc)}' +
    '.cb-in{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px}.cb-in .card{margin:0;display:flex;flex-direction:column}.cb-in h3{margin:0 0 12px;font-size:15px}' +
    '.cb-mic{display:flex;flex-direction:column;align-items:center;gap:10px;flex:1;justify-content:center;text-align:center}.cb-micbtn{width:104px;height:104px;border-radius:50%;border:0;background:var(--cbacc);color:#fff;font-size:44px;cursor:pointer;touch-action:none;user-select:none;-webkit-user-select:none;box-shadow:0 8px 24px rgba(124,58,237,.4);transition:transform .15s}.cb-micbtn:active{transform:scale(.96)}' +
    '.cb-micbtn.on{background:#ef4444;animation:cb-pulse 1.2s infinite}.cb-micbtn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none}@keyframes cb-pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.55)}100%{box-shadow:0 0 0 26px rgba(239,68,68,0)}}' +
    '.cb-live{min-height:48px;width:100%;border:1px dashed var(--cbline);border-radius:10px;padding:10px 12px;font-size:14px;line-height:1.5;color:var(--cbtx);text-align:left;word-break:break-word}.cb-live:empty:before{content:"Your words appear here as you speak…";color:var(--cbmut)}.cb-live i{color:var(--cbmut);font-style:normal}' +
    '.cb-vl{display:flex;gap:6px;flex-wrap:wrap;justify-content:center}.cb-vl button{border:1px solid var(--cbline);background:none;color:var(--cbmut);border-radius:99px;padding:7px 14px;font-weight:600;font-size:13px;cursor:pointer}.cb-vl button.on{border-color:var(--cbacc);color:var(--cbtx);background:rgba(124,58,237,.14)}' +
    '.cb-hint{font-size:12.5px;color:var(--cbmut)}.cb-chat textarea{flex:1;min-height:150px}.cb-send{margin-top:10px;border:0;background:var(--cbacc);color:#fff;font-weight:700;border-radius:10px;padding:13px;font-size:15px;cursor:pointer;min-height:48px}.cb-send:disabled{opacity:.6}' +
    '.cb-err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.5);color:var(--red,#ef4444);border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:14px}.cb-banner{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.5);color:var(--amber,#f59e0b);border-radius:12px;padding:12px 16px;margin-bottom:14px;font-weight:600}.cb-banner button{margin-left:10px;border:1px solid currentColor;background:none;color:inherit;border-radius:8px;padding:6px 12px;font-weight:600;cursor:pointer}' +
    '.cb-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:cb-sp .8s linear infinite;vertical-align:-2px;margin-right:8px}@keyframes cb-sp{to{transform:rotate(360deg)}}' +
    '.cb-card{border:2px solid var(--cbline);border-radius:16px;padding:0;overflow:hidden;background:var(--cbbg);margin-bottom:14px}.cb-ch{padding:14px 18px;border-bottom:1px solid var(--cbline);background:rgba(124,58,237,.1);font-weight:800;letter-spacing:.05em;font-size:13px}.cb-cb{padding:16px 18px}' +
    '.cb-name{font-size:19px;font-weight:800;margin:0 0 4px}.cb-sum{color:var(--cbmut);font-size:14px;line-height:1.5;margin-bottom:6px;white-space:pre-line}' +
    '.cb-sec{font-size:11.5px;font-weight:800;letter-spacing:.08em;color:var(--cbacc);margin:18px 0 8px;text-transform:uppercase}.cb-row{display:flex;gap:12px;padding:7px 0;border-bottom:1px solid var(--cbline);font-size:14px;align-items:flex-start}.cb-row:last-child{border:0}.cb-row>span:first-child{flex:0 0 120px;color:var(--cbmut)}.cb-row>span:last-child,.cb-row>div:last-child{flex:1;min-width:0;word-break:break-word}.cb-row b{font-weight:700}' +
    '.cb-copy{white-space:pre-wrap;line-height:1.55}.cb-sug{border-top:1px solid var(--cbline);padding:14px 18px;background:rgba(245,158,11,.06)}.cb-sug h4{margin:0 0 8px;font-size:13px;letter-spacing:.06em}.cb-sug li{margin:4px 0 4px 18px;font-size:14px}' +
    '.cb-acts{display:flex;gap:10px;flex-wrap:wrap;padding:14px 18px;border-top:1px solid var(--cbline)}.cb-acts button{flex:1 1 140px;min-height:48px;border-radius:10px;border:1px solid var(--cbline);background:none;color:var(--cbtx);font-weight:700;font-size:14px;cursor:pointer}.cb-acts .go{background:#1877f2;border-color:transparent;color:#fff}.cb-acts .pri{background:var(--cbacc);border-color:transparent;color:#fff}' +
    '.cb-chg{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.45);border-radius:12px;padding:10px 14px;margin-bottom:12px;font-size:14px}.cb-chg div{margin:3px 0}.cb-chg b{color:var(--green,#22c55e)}' +
    '.cb-launch{background:rgba(24,119,242,.1);border:1px solid rgba(24,119,242,.5);border-radius:12px;padding:14px 16px;margin-bottom:14px;font-size:14px;line-height:1.55}.cb-launch h4{margin:0 0 6px;font-size:15px}' +
    '.cb-edit .cb-row{align-items:center}.cb-edit .pl{display:flex;gap:8px;flex-wrap:wrap}.cb-edit .pl label{display:flex;gap:6px;align-items:center;border:1px solid var(--cbline);border-radius:99px;padding:6px 12px;font-size:13px;cursor:pointer}.cb-edit .pl input{width:auto}' +
    '.cb-badge{display:inline-block;border-radius:99px;padding:3px 10px;font-size:11px;font-weight:700}.cb-badge.draft{background:rgba(148,163,184,.2);color:var(--cbmut)}.cb-badge.launched{background:rgba(24,119,242,.2);color:#60a5fa}' +
    '.cb-h{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:12px 14px;border:1px solid var(--cbline);border-radius:12px;margin-bottom:8px;background:var(--cbbg);cursor:pointer}.cb-h:hover{border-color:var(--cbacc)}.cb-h .t{flex:1 1 220px;min-width:0}.cb-h .t b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.cb-h .m{font-size:12.5px;color:var(--cbmut)}.cb-h button{border:1px solid var(--cbline);background:none;color:var(--cbtx);border-radius:8px;padding:8px 12px;font-weight:600;cursor:pointer}' +
    '@media(max-width:767px){.cb-row>div:last-child{width:100%}.cb-edit .cb-row{align-items:stretch}.cb-edit .cb-row input[type=text],.cb-edit .cb-row input[type=number],.cb-edit .cb-row input[type=date],.cb-edit .cb-row select,.cb-edit .cb-row textarea{width:100%}.cb-in{grid-template-columns:1fr}.cb-micbtn{width:128px;height:128px;font-size:54px}.cb-row{flex-direction:column;gap:2px}.cb-row>span:first-child{flex:none;font-size:12px}.cb select,.cb input,.cb textarea{font-size:16px!important;min-height:46px}.cb-acts button{flex:1 1 100%;min-height:52px}.cb .sub{margin-left:0;width:100%}.cb .sub button{flex:1}.cb-top select{max-width:none}.cb .card{padding:16px 14px}.ads-tabs button{flex:1;padding:12px 6px;font-size:14px}}';
  function injectCss() { if (document.getElementById('cb-css')) return; var s = document.createElement('style'); s.id = 'cb-css'; s.textContent = css; document.head.appendChild(s); }
  var toast = function (m) { if (MB && MB.toast) MB.toast(m); else if (window.toast) window.toast(m); };
  var money = function (n) { return '₨ ' + Math.round(+n || 0).toLocaleString('en-US'); };
  var today = function () { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10); };
  function copyText(t) { if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(t).catch(fb); return fb(); function fb() { var a = document.createElement('textarea'); a.value = t; a.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); } catch (e) {} a.remove(); return Promise.resolve(); } }

  /* ============================================================ outer shell (tabs) */
  function mount(target, o) {
    el = target; opts = o || {}; injectCss();
    el.innerHTML = '<div class="cb"><div class="ads-tabs"><button type="button" data-t="copy">✍️ Ad Copy</button><button type="button" data-t="camp">🚀 Campaign Builder</button></div><div id="adsBody"></div></div>';
    el.querySelectorAll('.ads-tabs button').forEach(function (b) { b.onclick = function () { outer = b.dataset.t; ls.set('mb_ads_tab', outer); show(); }; });
    show();
  }
  var pendingOpen = null;
  function show() {
    el.querySelectorAll('.ads-tabs button').forEach(function (b) { b.classList.toggle('on', b.dataset.t === outer); });
    var body = el.querySelector('#adsBody'); stopVoice(true);
    if (outer === 'copy') { root = null; MB.adStudio.mount(body, opts); return; }
    root = body; (cfg ? Promise.resolve() : MB.api('/api/ai/config').then(function (c) { cfg = c; }).catch(function (e) { C.err = e.message; })).then(function () { paint(); if (pendingOpen) { var id = pendingOpen; pendingOpen = null; openSaved(id); } });
  }

  /* ============================================================ Campaign Builder */
  function paint() {
    if (!root) return;
    var y = window.scrollY, h = '';
    if (cfg && !cfg.has_key) h += '<div class="cb-banner">🔑 Add your Claude API key in Settings to use the Campaign Builder' + (opts.isAdmin && opts.onSettings ? '<button type="button" id="cbSet">Open Settings</button>' : '<span style="font-weight:400"> — ask your admin to add it.</span>') + '</div>';
    h += '<div class="cb-top"><select id="cbClient"><option value="">Link to client (optional)</option>' + ((cfg && cfg.clients) || []).map(function (c) { return '<option value="' + esc(c.id) + '" ' + (C.client_id === c.id ? 'selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</select>' +
      '<div class="sub"><button type="button" data-v="build" class="' + (C.view === 'build' ? 'on' : '') + '">Builder</button><button type="button" data-v="hist" class="' + (C.view === 'hist' ? 'on' : '') + '">History</button></div></div>';
    h += C.view === 'build' ? buildHtml() : histHtml();
    root.innerHTML = h; wire(); window.scrollTo(0, y);
  }
  function inputHtml() {
    var follow = !!C.campaign, rec = C.rec, hasSR = !!SR;
    return '<div class="cb-in"><div class="card"><h3>🎤 Voice Input</h3><div class="cb-mic">' +
      '<button type="button" class="cb-micbtn ' + (rec.on ? 'on' : '') + '" id="cbMic" ' + (hasSR && !C.busy ? '' : 'disabled') + ' aria-label="Hold to speak, or tap to start and stop">🎤</button>' +
      '<div style="font-weight:700">' + (rec.on ? 'Listening… release to send' : 'Hold to speak') + '</div><div class="cb-hint">or tap once to start, tap again to send</div>' +
      '<div class="cb-vl" role="group" aria-label="Speaking language">' + [['en', 'English'], ['ur', 'اردو Urdu'], ['hi', 'Hinglish']].map(function (l) { return '<button type="button" data-vl="' + l[0] + '" class="' + (rec.lang === l[0] ? 'on' : '') + '">' + l[1] + '</button>'; }).join('') + '</div>' +
      '<div class="cb-live" id="cbLive" dir="auto">' + esc(rec.text) + '</div>' +
      (hasSR ? '<div class="cb-hint">Browsers can’t auto-detect the spoken language, so pick the one you’ll speak — Claude understands English, Urdu and Hinglish either way.</div>' : '<div class="cb-hint" style="color:var(--amber,#f59e0b)">Voice input needs Chrome or Edge. Use the chat box instead →</div>') +
      '</div></div>' +
      '<div class="card cb-chat"><h3>💬 Chat Command</h3><textarea id="cbText" placeholder="' + (follow ? 'Follow-up: &quot;Change budget to 1000&quot;, &quot;Add Lahore to locations&quot;, &quot;Make copy more emotional&quot;, &quot;Change to traffic objective&quot;' : '&quot;Run an ad for Core Beauty lip oil, target women in Karachi aged 18-35, budget 500 rupees daily, 7 days, focus on conversions&quot;') + '">' + esc(C.text) + '</textarea>' +
      '<button type="button" class="cb-send" id="cbSend" ' + (C.busy ? 'disabled' : '') + '>' + (C.busy ? '<span class="cb-spin"></span>Building…' : follow ? '➤ Send follow-up' : '➤ Build campaign') + '</button><div class="cb-hint" style="margin-top:6px">Enter to send · Shift+Enter for a new line</div></div></div>';
  }
  function buildHtml() {
    var h = (C.err ? '<div class="cb-err">' + esc(C.err) + '</div>' : '') + inputHtml();
    if (C.changes.length) h += '<div class="cb-chg">' + C.changes.map(function (c) { return '<div>✅ <b>Updated:</b> ' + esc(c.label) + ' ' + esc(c.from || '—') + ' → ' + esc(c.to || '—') + '</div>'; }).join('') + '</div>';
    if (C.launched) h += launchPanel();
    if (C.campaign) h += cardHtml();
    return h;
  }
  function dateLabel(d) { return d === today() ? 'Today' : d; }
  function cardHtml() {
    var c = C.edit || C.campaign, ed = !!C.edit, row = function (l, v) { return '<div class="cb-row"><span>' + l + '</span><div>' + v + '</div></div>'; };
    var h = '<div class="cb-card ' + (ed ? 'cb-edit' : '') + '"><div class="cb-ch">📢 ' + (ed ? 'EDITING CAMPAIGN' : 'CAMPAIGN READY') + ' <span class="cb-badge ' + C.status + '" style="margin-left:8px">' + (C.status === 'launched' ? 'Launched' : 'Draft') + '</span></div><div class="cb-cb">';
    if (ed) {
      var inp = function (k, type, extra) { return '<input type="' + type + '" data-k="' + k + '" value="' + esc(c[k]) + '" ' + (extra || '') + '>'; }, sel = function (k, map) { return '<select data-k="' + k + '">' + Object.keys(map).map(function (v) { return '<option value="' + v + '" ' + (c[k] === v ? 'selected' : '') + '>' + map[v] + '</option>'; }).join('') + '</select>'; }, lst = function (k, ph) { return '<input type="text" data-l="' + k + '" value="' + esc((c[k] || []).join(', ')) + '" placeholder="' + ph + '">'; };
      h += '<div class="cb-sec" style="margin-top:0">Campaign</div>' + row('Name', inp('campaign_name', 'text')) + row('Objective', sel('objective', OBJ));
      h += '<div class="cb-sec">Budget & timing</div>' + row('Daily budget (₨)', inp('budget_daily', 'number', 'min="1" inputmode="numeric"')) + row('Duration (days)', inp('duration_days', 'number', 'min="1" max="365" inputmode="numeric"')) + row('Start date', inp('start_date', 'date', 'min="' + today() + '"'));
      h += '<div class="cb-sec">Target audience</div>' + row('Age', '<div style="display:flex;gap:8px;align-items:center">' + inp('audience_age_min', 'number', 'min="13" max="65" inputmode="numeric"') + '<span style="flex:none">to</span>' + inp('audience_age_max', 'number', 'min="13" max="65" inputmode="numeric"') + '</div>') + row('Gender', sel('audience_gender', GEN)) + row('Locations', lst('audience_locations', 'Karachi, Lahore…')) + row('Interests', lst('audience_interests', 'Beauty, Skincare…')) + row('Behaviors', lst('audience_behaviors', 'Online shoppers…'));
      h += '<div class="cb-sec">Ad copy</div>' + row('Headline', inp('ad_headline', 'text', 'maxlength="120"')) + row('Primary text', '<textarea data-k="ad_primary_text" rows="7">' + esc(c.ad_primary_text) + '</textarea>') + row('Description', inp('ad_description', 'text', 'maxlength="150"')) + row('Language', sel('language', LANGS));
      h += '<div class="cb-sec">Format & placements</div>' + row('Format', sel('ad_format', FMT)) + row('Placements', '<div class="pl">' + PLACES.map(function (p) { return '<label><input type="checkbox" data-p="' + p + '" ' + (c.placements.indexOf(p) > -1 ? 'checked' : '') + '>' + p + '</label>'; }).join('') + '</div>');
      return h + '</div><div class="cb-acts"><button type="button" id="cbCancelEdit">Cancel</button><button type="button" class="pri" id="cbDoneEdit">✓ Apply changes</button></div></div>';
    }
    h += '<p class="cb-name">📋 ' + esc(c.campaign_name) + '</p>' + (C.summary ? '<div class="cb-sum">' + esc(C.summary) + '</div>' : '');
    h += '<div class="cb-sec">Budget & timing</div>' + row('Objective', esc(OBJ[c.objective] || c.objective)) + row('Daily budget', '<b>' + money(c.budget_daily) + '</b>') + row('Duration', c.duration_days + ' day' + (c.duration_days > 1 ? 's' : '')) + row('Total spend', '<b>' + money(c.budget_daily * c.duration_days) + '</b>') + row('Start date', esc(dateLabel(c.start_date)));
    h += '<div class="cb-sec">Target audience</div>' + row('Age', c.audience_age_min + '–' + c.audience_age_max + ' · ' + (GEN[c.audience_gender] || c.audience_gender)) + row('Locations', esc(c.audience_locations.join(', ') || '—')) + row('Interests', esc(c.audience_interests.join(', ') || '—')) + row('Behaviors', esc(c.audience_behaviors.join(', ') || '—'));
    h += '<div class="cb-sec">Ad copy</div>' + row('Headline', '<b dir="auto">“' + esc(c.ad_headline) + '”</b>') + row('Primary text', '<div class="cb-copy" dir="auto">' + esc(c.ad_primary_text) + '</div>') + row('Description', '<span dir="auto">“' + esc(c.ad_description) + '”</span>') + row('Language', esc(LANGS[c.language] || c.language));
    h += '<div class="cb-sec">Format & placements</div>' + row('Format', esc(FMT[c.ad_format] || c.ad_format)) + row('Placements', esc(c.placements.join(', ')));
    h += '</div>';
    if (C.suggestions.length) h += '<div class="cb-sug"><h4>💡 SUGGESTIONS</h4><ul>' + C.suggestions.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul></div>';
    return h + '<div class="cb-acts"><button type="button" id="cbEdit">✏️ Edit</button><button type="button" id="cbSave">💾 ' + (C.id ? (C.dirty ? 'Save changes' : 'Saved ✓') : 'Save Draft') + '</button><button type="button" class="go" id="cbLaunch">🚀 Launch in Meta</button></div>' +
      '<div class="cb-acts" style="border-top:0;padding-top:0"><button type="button" id="cbNew">＋ New campaign</button></div></div>';
  }
  function metaPrompt(c) {
    var L = function (a) { return a.length ? a.join(', ') : '(none)'; };
    return 'You are helping me set up a Meta (Facebook/Instagram) ad campaign in Ads Manager (https://adsmanager.facebook.com/). Fill in the campaign below, and STOP at the final Review step. Do NOT click Publish or Confirm — I will review and publish it myself.\n\n' +
      'If the ad account currency is not PKR, or something below cannot be set exactly, stop and tell me instead of guessing.\n\n' +
      'CAMPAIGN\n- Campaign name: ' + c.campaign_name + '\n- Objective: ' + META_OBJ[c.objective] + ' (' + (OBJ[c.objective] || c.objective) + ')\n\n' +
      'BUDGET & SCHEDULE\n- Daily budget: PKR ' + Math.round(c.budget_daily) + '\n- Start date: ' + c.start_date + '\n- End date: ' + endDate(c) + ' (' + c.duration_days + ' days)\n\n' +
      'AUDIENCE\n- Locations: ' + L(c.audience_locations) + ' (Pakistan)\n- Age: ' + c.audience_age_min + ' to ' + c.audience_age_max + '\n- Gender: ' + (GEN[c.audience_gender] || c.audience_gender) + '\n- Detailed targeting (interests): ' + L(c.audience_interests) + '\n- Behaviors: ' + L(c.audience_behaviors) + '\n\n' +
      'PLACEMENTS\n- Manual placements: ' + L(c.placements) + '\n\n' +
      'AD\n- Format: ' + (FMT[c.ad_format] || c.ad_format) + '\n- Headline: ' + c.ad_headline + '\n- Primary text:\n' + c.ad_primary_text + '\n- Description: ' + c.ad_description + '\n- Language of copy: ' + (LANGS[c.language] || c.language) + '\n\n' +
      'When everything is filled in, leave the Review screen open and tell me it is ready.';
  }
  function endDate(c) { var d = new Date(c.start_date + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + c.duration_days - 1); return d.toISOString().slice(0, 10); }
  function launchPanel() {
    return '<div class="cb-launch"><h4>🚀 Campaign ready in Meta Ads Manager — review and click Publish</h4>Ads Manager opened in a new tab and the setup instructions are on your clipboard. To auto-fill it, open <b>Claude in Chrome</b> on that tab and paste them — it fills everything in and <b>stops at the Review screen</b>; nothing is published until you press Publish yourself.' +
      '<div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" id="cbCopyAgain" style="border:1px solid currentColor;background:none;color:inherit;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer">📋 Copy instructions again</button><button type="button" id="cbOpenMeta" style="border:1px solid currentColor;background:none;color:inherit;border-radius:8px;padding:9px 14px;font-weight:600;cursor:pointer">Open Ads Manager ↗</button></div></div>';
  }
  function histHtml() {
    var l = C.hist.list;
    var h = opts.isAdmin ? '<div style="margin-bottom:10px"><label style="display:flex;gap:6px;align-items:center;font-size:13px;color:var(--cbmut)"><input type="checkbox" id="hcAll" style="width:auto;min-height:0" ' + (C.hist.all ? 'checked' : '') + '> Whole team</label></div>' : '';
    if (!l) return h + '<div class="card">Loading…</div>';
    if (!l.length) return h + '<div class="card" style="text-align:center;color:var(--cbmut)">No saved campaigns yet. Build one and press 💾 Save Draft.</div>';
    return h + l.map(function (c) { return '<div class="cb-h" data-id="' + esc(c.id) + '"><div class="t"><b>' + esc(c.campaign_name) + '</b><div class="m">' + esc((c.created_at || '').slice(0, 10)) + (c.client_name ? ' · ' + esc(c.client_name) : '') + (c.user_name && opts.isAdmin ? ' · ' + esc(c.user_name) : '') + ' · ' + money(c.budget_daily) + '/day × ' + c.duration_days + 'd = ' + money(c.budget_daily * c.duration_days) + '</div></div><span class="cb-badge ' + c.status + '">' + (c.status === 'launched' ? 'Launched' : 'Draft') + '</span><button type="button" data-a="open">Open</button><button type="button" data-a="dup">Duplicate</button><button type="button" data-a="del" title="Delete">🗑</button></div>'; }).join('');
  }

  /* ---- actions ---- */
  function loadHist() { C.hist.list = null; paint(); return MB.api('/api/ai/campaigns' + (C.hist.all ? '?scope=all' : '')).then(function (r) { C.hist.list = r.campaigns; paint(); }).catch(function (e) { C.hist.list = []; toast(e.message); paint(); }); }
  function submit(text, mode) {
    text = String(text || '').trim(); if (text.length < 3 || C.busy) return;
    C.busy = true; C.err = ''; C.launched = false; if (mode === 'text') C.text = ''; C.rec.text = ''; paint();
    MB.api('/api/ai/campaign/build', { method: 'POST', body: { instruction: text, mode: mode, campaign: C.campaign ? Object.assign({}, C.campaign, { summary: C.summary }) : null } }).then(function (r) {
      if (!C.campaign) C.mode = mode;
      C.instructions.push(text); C.campaign = r.campaign; C.summary = r.summary; C.suggestions = r.suggestions; C.changes = r.changes || []; C.dirty = true; C.busy = false; C.edit = null;
      if (!C.id) C.status = 'draft'; paint(); var card = root.querySelector('.cb-card'); if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) { C.busy = false; C.err = e.message; if (mode === 'text') C.text = text; paint(); });
  }
  function save(quiet) {
    return MB.api('/api/ai/campaign', { method: 'POST', body: { id: C.id, client_id: C.client_id, campaign: C.campaign, summary: C.summary, suggestions: C.suggestions, instructions: C.instructions, mode: C.mode } }).then(function (r) {
      C.id = r.id; C.campaign = normFromServer(r.campaign); C.status = r.campaign.status; C.dirty = false; if (!quiet) toast('Draft saved'); C.hist.list = null; paint(); return r;
    }).catch(function (e) { toast(e.message); throw e; });
  }
  function normFromServer(r) { var c = {}; ['campaign_name', 'objective', 'budget_daily', 'duration_days', 'start_date', 'audience_age_min', 'audience_age_max', 'audience_gender', 'audience_locations', 'audience_interests', 'audience_behaviors', 'ad_headline', 'ad_primary_text', 'ad_description', 'ad_format', 'placements', 'language'].forEach(function (k) { c[k] = r[k]; }); return c; }
  function openSaved(id) {
    return MB.api('/api/ai/campaign/' + encodeURIComponent(id)).then(function (r) { var c = r.campaign; C.campaign = normFromServer(c); C.id = c.id; C.status = c.status; C.client_id = c.client_id || ''; C.summary = c.summary || ''; C.suggestions = c.suggestions || []; C.instructions = c.instructions || []; C.changes = []; C.dirty = false; C.edit = null; C.launched = false; C.view = 'build'; C.err = ''; paint(); }).catch(function (e) { toast(e.message); });
  }
  function launch() {
    var go = function () {
      var w = window.open('https://adsmanager.facebook.com/', '_blank', 'noopener');
      copyText(metaPrompt(C.campaign));
      return MB.api('/api/ai/campaign/' + encodeURIComponent(C.id) + '/launch', { method: 'POST' }).then(function () { C.status = 'launched'; C.launched = true; C.hist.list = null; paint(); if (!w) toast('Pop-up blocked — use “Open Ads Manager” below'); else toast('✓ Instructions copied — paste them into Claude in Chrome'); var p = root.querySelector('.cb-launch'); if (p) p.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    };
    (C.id && !C.dirty ? Promise.resolve() : save(true)).then(go).catch(function (e) { toast(e.message || 'Could not launch'); });
  }
  function readEdit() {
    var e = C.edit, num = function (k, d, lo, hi) { var v = Math.round(+String(e[k]).replace(/[, ]/g, '')); return isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d; };
    e.budget_daily = num('budget_daily', C.campaign.budget_daily, 1, 1e8); e.duration_days = num('duration_days', C.campaign.duration_days, 1, 365); e.audience_age_min = num('audience_age_min', 18, 13, 65); e.audience_age_max = num('audience_age_max', 45, 13, 65);
    if (e.audience_age_min > e.audience_age_max) { var t = e.audience_age_min; e.audience_age_min = e.audience_age_max; e.audience_age_max = t; }
    if (!e.campaign_name || !String(e.campaign_name).trim()) e.campaign_name = C.campaign.campaign_name;
    if (!e.start_date || e.start_date < today()) e.start_date = today(); if (!e.placements.length) e.placements = ['Facebook Feed'];
    return e;
  }
  var FL = { campaign_name: 'Name', objective: 'Objective', budget_daily: 'Daily budget', duration_days: 'Duration', start_date: 'Start date', audience_age_min: 'Min age', audience_age_max: 'Max age', audience_gender: 'Gender', audience_locations: 'Locations', audience_interests: 'Interests', audience_behaviors: 'Behaviors', ad_headline: 'Headline', ad_primary_text: 'Primary text', ad_description: 'Description', ad_format: 'Format', placements: 'Placements', language: 'Language' };
  function show1(k, v) { return Array.isArray(v) ? v.join(', ') : k === 'budget_daily' ? money(v) : k === 'duration_days' ? v + ' days' : String(v == null ? '' : v); }
  function diffLocal(a, b) { var o = []; Object.keys(FL).forEach(function (k) { if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) o.push({ label: FL[k], from: show1(k, a[k]), to: show1(k, b[k]) }); }); return o; }

  /* ---- voice (Web Speech API; hold-to-talk or tap-to-toggle) ---- */
  var recog = null, finalText = '', pressAt = 0, tapMode = false, sendOnEnd = false, cancelled = false;
  function liveUpdate(interim) { C.rec.text = (finalText + ' ' + (interim || '')).trim(); var n = root && root.querySelector('#cbLive'); if (n) n.innerHTML = esc(finalText) + (interim ? ' <i>' + esc(interim) + '</i>' : ''); }
  function startVoice() {
    if (!SR || C.rec.on || C.busy) return;
    finalText = ''; C.rec.text = ''; cancelled = false; sendOnEnd = false;
    try {
      recog = new SR(); recog.lang = VLANG[C.rec.lang] || 'en-US'; recog.continuous = true; recog.interimResults = true; recog.maxAlternatives = 1;
      recog.onresult = function (e) { var interim = ''; for (var i = e.resultIndex; i < e.results.length; i++) { if (e.results[i].isFinal) finalText += (finalText ? ' ' : '') + e.results[i][0].transcript.trim(); else interim += e.results[i][0].transcript; } liveUpdate(interim); };
      recog.onerror = function (e) { var m = { 'not-allowed': 'Microphone access was blocked — allow it in the browser’s address bar and try again.', 'service-not-allowed': 'Microphone access was blocked — allow it in the browser’s address bar and try again.', 'no-speech': 'I didn’t hear anything — try again.', 'audio-capture': 'No microphone found.', network: 'Speech recognition needs an internet connection.' }[e.error]; if (m && e.error !== 'aborted') { C.err = m; } };
      recog.onend = function () { var was = C.rec.on; C.rec.on = false; var t = (C.rec.text || finalText || '').trim(); recog = null; if (!was) return; if (sendOnEnd && !cancelled && t.length >= 3) { paint(); submit(t, 'voice'); } else { if (!cancelled && !C.err && t.length < 3) C.err = 'I didn’t catch that — hold the mic and speak, then release.'; paint(); } };
      recog.start(); C.rec.on = true; C.err = ''; micUi();   // update in place — repainting would replace the button the finger is holding
    } catch (e) { C.rec.on = false; C.err = 'Could not start the microphone.'; paint(); }
  }
  function micUi() { var b = root && root.querySelector('#cbMic'); if (!b) return; b.classList.toggle('on', C.rec.on); var l = b.parentNode.children[1]; if (l) l.textContent = C.rec.on ? 'Listening… release to send' : 'Hold to speak'; var e = root.querySelector('.cb-err'); if (e) e.remove(); var live = root.querySelector('#cbLive'); if (live && !C.rec.on) live.textContent = C.rec.text; }
  function stopVoice(abort) { if (!recog) return; if (abort) { cancelled = true; sendOnEnd = false; try { recog.abort(); } catch (e) {} } else { sendOnEnd = true; try { recog.stop(); } catch (e) {} } }
  function wireMic(btn) {
    btn.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    btn.addEventListener('pointerdown', function (e) { e.preventDefault(); try { btn.setPointerCapture(e.pointerId); } catch (x) {} if (C.rec.on && tapMode) { stopVoice(false); tapMode = false; pressAt = 0; return; } pressAt = Date.now(); tapMode = false; startVoice(); });
    var up = function () { if (!pressAt) return; var held = Date.now() - pressAt; pressAt = 0; if (!C.rec.on && !recog) return; if (held >= 450) { stopVoice(false); } else { tapMode = true; } };
    btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
    btn.addEventListener('keydown', function (e) { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (e.repeat) return; if (C.rec.on) stopVoice(false); else { tapMode = true; startVoice(); } } });
  }

  function wire() {
    var q = function (s) { return root.querySelector(s); };
    var set = q('#cbSet'); if (set) set.onclick = opts.onSettings;
    var cl = q('#cbClient'); if (cl) cl.onchange = function () { C.client_id = cl.value; if (C.id) C.dirty = true; };
    root.querySelectorAll('.sub button').forEach(function (b) { b.onclick = function () { C.view = b.dataset.v; if (C.view === 'hist' && !C.hist.list) loadHist(); else paint(); }; });
    var t = q('#cbText'); if (t) { t.oninput = function () { C.text = t.value; }; t.onkeydown = function (e) { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); submit(t.value, 'text'); } }; }
    var s = q('#cbSend'); if (s) s.onclick = function () { submit(C.text, 'text'); };
    var mic = q('#cbMic'); if (mic) wireMic(mic);
    root.querySelectorAll('[data-vl]').forEach(function (b) { b.onclick = function () { C.rec.lang = b.dataset.vl; ls.set('mb_voice_lang', C.rec.lang); paint(); }; });
    var ed = q('#cbEdit'); if (ed) ed.onclick = function () { C.edit = JSON.parse(JSON.stringify(C.campaign)); paint(); };
    var sv = q('#cbSave'); if (sv) sv.onclick = function () { if (C.id && !C.dirty) return toast('Already saved'); save(false); };
    var lg = q('#cbLaunch'); if (lg) lg.onclick = launch;
    var nw = q('#cbNew'); if (nw) nw.onclick = function () { if ((C.dirty || !C.id) && !confirm('Start a new campaign? Unsaved changes to this one will be lost.')) return; var k = C.client_id; C = Object.assign(C, { instructions: [], campaign: null, summary: '', suggestions: [], changes: [], id: null, status: 'draft', dirty: false, edit: null, err: '', launched: false, text: '' }); C.client_id = k; paint(); };
    var ce = q('#cbCancelEdit'); if (ce) ce.onclick = function () { C.edit = null; paint(); };
    var de = q('#cbDoneEdit'); if (de) de.onclick = function () { var a = C.campaign, b = readEdit(); C.changes = diffLocal(a, b); C.campaign = b; C.edit = null; C.dirty = true; paint(); };
    root.querySelectorAll('.cb-edit [data-k]').forEach(function (n) { n.oninput = n.onchange = function () { C.edit[n.dataset.k] = n.value; }; });
    root.querySelectorAll('.cb-edit [data-l]').forEach(function (n) { n.oninput = function () { C.edit[n.dataset.l] = n.value.split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean); }; });
    root.querySelectorAll('.cb-edit [data-p]').forEach(function (n) { n.onchange = function () { var p = C.edit.placements, i = p.indexOf(n.dataset.p); if (n.checked && i < 0) p.push(n.dataset.p); if (!n.checked && i > -1) p.splice(i, 1); }; });
    var ca = q('#cbCopyAgain'); if (ca) ca.onclick = function () { copyText(metaPrompt(C.campaign)).then(function () { toast('✓ Copied'); }); };
    var om = q('#cbOpenMeta'); if (om) om.onclick = function () { window.open('https://adsmanager.facebook.com/', '_blank', 'noopener'); };
    var ha = q('#hcAll'); if (ha) ha.onchange = function () { C.hist.all = ha.checked; loadHist(); };
    root.querySelectorAll('.cb-h').forEach(function (row) {
      var id = row.dataset.id; row.onclick = function (e) { var a = e.target.closest('[data-a]'); if (!a) return openSaved(id); e.stopPropagation();
        if (a.dataset.a === 'open') openSaved(id);
        else if (a.dataset.a === 'dup') MB.api('/api/ai/campaign/' + encodeURIComponent(id) + '/duplicate', { method: 'POST' }).then(function (r) { toast('Duplicated as a new draft'); C.hist.list = null; return openSaved(r.id); }).catch(function (x) { toast(x.message); });
        else if (a.dataset.a === 'del' && confirm('Delete this campaign?')) MB.api('/api/ai/campaign/' + encodeURIComponent(id), { method: 'DELETE' }).then(function () { if (C.id === id) { C.id = null; C.campaign = null; } loadHist(); toast('Deleted'); }).catch(function (x) { toast(x.message); }); };
    });
  }
  MB.ads = { mount: mount, openCampaign: function (id) { outer = 'camp'; ls.set('mb_ads_tab', 'camp'); pendingOpen = id; }, reset: function () { cfg = null; } };
})();
