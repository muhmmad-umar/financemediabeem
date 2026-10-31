/* AI Settings card (Admin → Settings): Claude API key, default language / style, model, and a live connection test.
   The Ads Manager UI itself lives in campaigns.js. */
(function () {
  'use strict';
  var MB = window.MB, esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var toast = function (m) { if (MB && MB.toast) MB.toast(m); else if (window.toast) window.toast(m); };
  var S = { cfg: null };
  function settingsCard(box, onDone) {
    box.innerHTML = '<div class="muted">Loading…</div>';
    MB.api('/api/ai/config').then(function (c) {
      box.innerHTML = '<div class="field"><label>Claude API key</label><input id="aiKey" type="password" autocomplete="off" placeholder="' + (c.has_key ? 'Saved (' + esc(c.key_hint || '') + ') — paste a new key to replace' : 'sk-ant-…') + '"><div class="muted" style="font-size:12px;margin-top:6px">' + (c.key_source === 'secret' ? '✓ A Worker secret <code>CLAUDE_API_KEY</code> is set and is used first.' : c.has_key ? '✓ Key saved. Employees use it automatically; it is never shown to them.' : 'Not set — Ad Copy Studio stays locked until you add one.') + ' You can also set it as a Worker secret: <code>npx wrangler secret put CLAUDE_API_KEY</code>.</div></div>' +
        '<div class="row2"><div class="field"><label>Default language</label><select id="aiLang">' + ['English', 'Urdu', 'Hinglish'].map(function (l) { return '<option ' + (c.default_language === l ? 'selected' : '') + '>' + l + '</option>'; }).join('') + '</select></div>' +
        '<div class="field"><label>Default style</label><select id="aiStyle"><option value="market" ' + (c.default_style === 'market' ? 'selected' : '') + '>Market Style</option><option value="premium" ' + (c.default_style === 'premium' ? 'selected' : '') + '>Premium Style</option></select></div></div>' +
        '<div class="field" style="max-width:340px"><label>Model</label><select id="aiModel">' + c.models.map(function (m) { return '<option value="' + m + '" ' + (c.model === m ? 'selected' : '') + '>' + m + (m === 'claude-opus-5-5' ? ' (best quality)' : m === 'claude-sonnet-5-5' ? ' (cheaper)' : ' (cheapest)') + '</option>'; }).join('') + '</select></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="aiSave">Save AI settings</button><button class="btn ghost" id="aiTest" ' + (c.has_key ? '' : 'disabled') + '>Test connection</button>' + (c.key_source === 'settings' ? '<button class="btn ghost" id="aiClear">Remove saved key</button>' : '') + '</div>';
      box.querySelector('#aiSave').onclick = function () {
        var body = { default_language: box.querySelector('#aiLang').value, default_style: box.querySelector('#aiStyle').value, model: box.querySelector('#aiModel').value }, k = box.querySelector('#aiKey').value.trim(); if (k) body.claude_api_key = k;
        MB.api('/api/ai/settings', { method: 'PUT', body: body }).then(function () { S.cfg = null; toast('AI settings saved'); settingsCard(box, onDone); if (onDone) onDone(); }).catch(function (e) { toast(e.message); });
      };
      box.insertAdjacentHTML('beforeend', '<div id="aiTestOut" class="muted" style="margin-top:10px;font-size:13px"></div>');
      var tb = box.querySelector('#aiTest'); if (tb) tb.onclick = function () { var out = box.querySelector('#aiTestOut'); out.textContent = 'Testing…'; tb.disabled = true; MB.api('/api/ai/test', { method: 'POST' }).then(function (r) { out.innerHTML = '✅ Connected — <b>' + esc(r.model) + '</b> answered in ' + r.ms + ' ms (key from ' + (r.key_source === 'secret' ? 'Worker secret' : 'Settings') + ').'; }).catch(function (e) { out.innerHTML = '❌ ' + esc(e.message); }).then(function () { tb.disabled = false; }); };
      var cl = box.querySelector('#aiClear'); if (cl) cl.onclick = function () { if (confirm('Remove the saved API key? Ad Copy Studio will stop working until a new one is added.')) MB.api('/api/ai/settings', { method: 'PUT', body: { claude_api_key: '' } }).then(function () { S.cfg = null; settingsCard(box, onDone); toast('Key removed'); }); };
    }).catch(function (e) { box.innerHTML = '<div class="muted">' + esc(e.message) + '</div>'; });
  }
  /** Admin → Settings → Apify Settings: the token used to transcribe Instagram Reels */
  function apifyCard(box, onDone) {
    box.innerHTML = '<div class="muted">Loading…</div>';
    MB.api('/api/ai/config').then(function (c) {
      box.innerHTML = '<div class="field"><label>Apify API Token</label><input id="apKey" type="password" autocomplete="off" placeholder="' + (c.apify_has_key ? 'Saved (' + esc(c.apify_key_hint || '') + ') — paste a new token to replace' : 'apify_api_…') + '"><div class="muted" style="font-size:12px;margin-top:6px">' + (c.apify_key_source === 'secret' ? '✓ A Worker secret <code>APIFY_API_TOKEN</code> is set and is used first.' : c.apify_has_key ? '✓ Token saved. Reel transcription is on for you and your employees.' : 'Not set — reel URL fields still show in Campaign Builder, but auto-transcription stays off.') + ' You can also set it as a Worker secret: <code>npx wrangler secret put APIFY_API_TOKEN</code>.</div></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" id="apSave">Save Apify token</button>' + (c.apify_key_source === 'settings' ? '<button class="btn ghost" id="apClear">Remove saved token</button>' : '') + '</div>';
      box.querySelector('#apSave').onclick = function () {
        var k = box.querySelector('#apKey').value.trim(); if (!k) return toast('Paste your Apify API token first');
        MB.api('/api/ai/settings', { method: 'PUT', body: { apify_api_token: k } }).then(function () { S.cfg = null; if (MB.ads && MB.ads.reset) MB.ads.reset(); toast('Apify token saved'); apifyCard(box, onDone); if (onDone) onDone(); }).catch(function (e) { toast(e.message); });
      };
      var cl = box.querySelector('#apClear'); if (cl) cl.onclick = function () { if (confirm('Remove the saved Apify token? Reel transcription will stop working until a new one is added.')) MB.api('/api/ai/settings', { method: 'PUT', body: { apify_api_token: '' } }).then(function () { if (MB.ads && MB.ads.reset) MB.ads.reset(); apifyCard(box, onDone); toast('Token removed'); }); };
    }).catch(function (e) { box.innerHTML = '<div class="muted">' + esc(e.message) + '</div>'; });
  }
  MB.adStudio = { apifyCard: apifyCard, settingsCard: settingsCard, reset: function () { S.cfg = null; if (MB.ads && MB.ads.reset) MB.ads.reset(); } };
})();
