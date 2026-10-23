/* Media Beem — mobile helpers shared by the admin, employee and client portals.
   Adds: bottom tab bar + quick sheets, drawer close/lock, full-screen modal close button,
   table→card labels, board column tabs, week-view calendar, chat back arrows,
   keyboard-aware viewport height and swipe-back. Everything is inert above 767px. */
(function () {
  'use strict';
  var MQ = window.matchMedia('(max-width:767px)');
  var portal = document.documentElement.getAttribute('data-portal') || '';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var navKey = portal === 'admin' ? 'view' : 'k';
  var navSel = function (k) { return $('#nav button[data-' + navKey + '="' + k + '"]'); };
  var curKey = function () { var b = $('#nav button.' + (portal === 'admin' ? 'active' : 'on')); return b ? b.dataset[navKey] : ''; };
  var go = function (k) { var b = navSel(k); if (b) b.click(); };

  /* ------------------------------------------------------------ tab bar */
  var TABS = {
    admin: [
      { i: '🏠', l: 'Home', keys: ['dashboard'], go: 'dashboard' },
      { i: '✅', l: 'Tasks', keys: ['tasks'], go: 'tasks' },
      { i: '💰', l: 'Finance', keys: ['income', 'expenses', 'invoices', 'allah', 'reports', 'personal'], title: 'Finance', sheet: [['income', '💰', 'Income / Cash Flow'], ['expenses', '💸', 'Expenses'], ['invoices', '🧾', 'Invoices'], ['allah', '🤲', "Allah's Share"], ['reports', '📈', 'Reports'], ['personal', '👤', 'Personal Finance']] },
      { i: '👥', l: 'Team', keys: ['clients', 'employees', 'attendance', 'onboarding'], title: 'Team & clients', sheet: [['clients', '🤝', 'Clients'], ['employees', '🧑‍💼', 'Employees'], ['attendance', '🕘', 'Attendance'], ['onboarding', '📝', 'Onboarding Requests']] },
      { i: '☰', l: 'More', keys: ['settings'], more: true },
    ],
    employee: [
      { i: '🏠', l: 'Home', keys: ['attendance'], go: 'attendance' },
      { i: '✅', l: 'Tasks', keys: ['tasks'], go: 'tasks' },
      { i: '💬', l: 'Chat', keys: ['channels', 'dms'], go: 'channels' },
      { i: '👤', l: 'Profile', keys: ['profile'], go: 'profile' },
    ],
    client: [
      { i: '🏠', l: 'Dashboard', keys: ['dashboard'], go: 'dashboard' },
      { i: '📄', l: 'Invoices', keys: ['invoices'], go: 'invoices' },
      { i: '📋', l: 'Projects', keys: ['projects'], go: 'projects' },
      { i: '💬', l: 'Messages', keys: ['messages'], go: 'messages' },
    ],
  };
  var sheet = null, sheetBg = null;
  function closeSheet() { if (sheet) { sheet.classList.remove('open'); sheetBg.classList.remove('open'); } }
  function openSheet(t) {
    closeSheet();
    sheet.innerHTML = '<div class="grab"></div><h4>' + t.title + '</h4>' + t.sheet.map(function (s) { return '<button data-g="' + s[0] + '" class="' + (curKey() === s[0] ? 'on' : '') + '"><i>' + s[1] + '</i>' + s[2] + '</button>'; }).join('');
    sheet.classList.add('open'); sheetBg.classList.add('open');
  }
  function buildTabs() {
    var cfg = TABS[portal]; if (!cfg || !$('#nav')) return;
    if ($('.mtabs')) return;
    var bar = document.createElement('nav'); bar.className = 'mtabs'; bar.setAttribute('aria-label', 'Main');
    bar.innerHTML = cfg.map(function (t, n) { return '<button data-n="' + n + '" type="button"><i>' + t.i + '</i><span>' + t.l + '</span></button>'; }).join('');
    document.body.appendChild(bar);
    sheetBg = document.createElement('div'); sheetBg.className = 'msheet-bg'; sheetBg.onclick = closeSheet;
    sheet = document.createElement('div'); sheet.className = 'msheet';
    sheet.addEventListener('click', function (e) { var b = e.target.closest('button[data-g]'); if (b) { closeSheet(); go(b.dataset.g); } });
    document.body.appendChild(sheetBg); document.body.appendChild(sheet);
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-n]'); if (!b) return;
      var t = cfg[+b.dataset.n];
      if (t.more) { closeSheet(); var m = $('#menuBtn'); if (m) m.click(); return; }
      if (t.sheet) { sheet.classList.contains('open') ? closeSheet() : openSheet(t); return; }
      closeSheet(); go(t.go);
    });
    paintTabs();
  }
  function paintTabs() {
    var bar = $('.mtabs'); if (!bar) return;
    var k = curKey(), cfg = TABS[portal];
    $$('button', bar).forEach(function (b, n) {
      var t = cfg[n]; b.classList.toggle('on', t.keys.indexOf(k) > -1);
      var sum = 0; t.keys.forEach(function (key) { var nb = navSel(key); var c = nb && $('.nbadge,.nb', nb); if (c && c.offsetParent !== null) sum += parseInt(c.textContent, 10) || 0; });
      var el = $('.mt-n', b);
      if (sum) { if (!el) { el = document.createElement('span'); el.className = 'mt-n'; b.appendChild(el); } el.textContent = sum > 99 ? '99+' : sum; } else if (el) el.remove();
    });
  }

  /* ------------------------------------------------------------ drawer */
  function wireDrawer() {
    var side = $('#sidebar') || $('#side'); if (!side) return;
    if (!$('.drawer-x', side)) {
      var x = document.createElement('button'); x.className = 'drawer-x'; x.type = 'button'; x.setAttribute('aria-label', 'Close menu'); x.textContent = '✕';
      x.onclick = closeDrawer; side.appendChild(x);
      var sx = 0, sy = 0;
      side.addEventListener('touchstart', function (e) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
      side.addEventListener('touchend', function (e) { var t = e.changedTouches[0]; if (sx - t.clientX > 60 && Math.abs(t.clientY - sy) < 50) closeDrawer(); }, { passive: true });
      new MutationObserver(function () { document.body.classList.toggle('mb-drawer', side.classList.contains('open') && MQ.matches); }).observe(side, { attributes: true, attributeFilter: ['class'] });
    }
  }
  function closeDrawer() { var side = $('#sidebar') || $('#side'), sc = $('#scrim'); if (side) side.classList.remove('open'); if (sc) sc.classList.remove('open'); document.body.classList.remove('mb-drawer'); }
  function openDrawer() { var m = $('#menuBtn'); if (m) m.click(); }

  /* ------------------------------------------------------------ modals */
  function wireModal() {
    var m = $('#modal'); if (!m || m.__mb) return; m.__mb = 1;
    var add = function () {
      if (!m.firstElementChild || m.firstElementChild.classList.contains('mob-mh')) return;
      var h = document.createElement('div'); h.className = 'mob-mh'; h.innerHTML = '<span></span><button type="button" class="mob-x" aria-label="Close">✕</button>';
      h.querySelector('button').onclick = function () { (window.closeModal || (window.MB && MB.closeModal) || function () {})(); };
      m.insertBefore(h, m.firstChild);
    };
    new MutationObserver(add).observe(m, { childList: true });
    add();
  }

  /* ------------------------------------------------------------ tables → cards */
  var MONEY = /amount|total|salary|balance|remaining|retainer|invoiced|paid|received|hours/i, STATE = /status|state|type/i, WHEN = /date|due|month|submitted|period/i;
  function cardify(root) {
    $$('.tablewrap table, .tbl-wrap table', root).forEach(function (t) {
      if (t.__mc === t.rows.length + ':' + (t.tHead ? t.tHead.textContent.length : 0)) return;
      t.__mc = t.rows.length + ':' + (t.tHead ? t.tHead.textContent.length : 0);
      t.classList.add('mcards');
      var heads = t.tHead ? $$('th', t.tHead).map(function (th) { return th.textContent.trim(); }) : [];
      var n = heads.length, key = [];
      if (n) {
        var pick = function (re) { for (var i = 1; i < n; i++) if (heads[i] && re.test(heads[i]) && key.indexOf(i) < 0) return i; return -1; };
        [pick(MONEY), pick(STATE), pick(WHEN)].forEach(function (i) { if (i > 0 && key.length < 2) key.push(i); });
        if (!key.length && n > 1) key.push(1);
      }
      $$('tr', t).forEach(function (tr) {
        if (tr.parentNode === t.tHead) return;
        var tds = $$(':scope > td', tr); if (!tds.length) return;
        var hasHidden = false;
        tds.forEach(function (td, i) {
          td.classList.remove('m-first', 'm-key', 'm-act', 'm-empty');
          var lab = heads[i] || ''; if (lab) td.setAttribute('data-label', lab); else td.removeAttribute('data-label');
          if (i === 0) td.classList.add('m-first');
          else if (!n || key.indexOf(i) > -1) td.classList.add('m-key');
          else hasHidden = true;
          if (!lab && i > 0 && $('button,a.btn', td)) td.classList.add('m-act');
          if (!td.textContent.trim() && !$('button,a,input,select,img,svg', td)) td.classList.add('m-empty');
          if (i > 0 && lab && !td.classList.contains('m-act') && !(td.firstElementChild && td.firstElementChild.classList.contains('m-v') && td.children.length === 1)) { var w = document.createElement('span'); w.className = 'm-v'; while (td.firstChild) w.appendChild(td.firstChild); td.appendChild(w); }
        });
        if (!n) tr.classList.add('m-open');
        var tog = $(':scope > .m-tog', tr);
        if (hasHidden || tds.some(function (td) { return td.classList.contains('m-act'); })) {
          if (!tog) { tog = document.createElement('button'); tog.type = 'button'; tog.className = 'm-tog'; tog.setAttribute('aria-label', 'Show details'); tog.textContent = '▾'; tr.appendChild(tog); }
        } else if (tog) tog.remove();
      });
    });
  }
  document.addEventListener('click', function (e) {
    if (!MQ.matches) return;
    var tog = e.target.closest('.m-tog'), tr = e.target.closest('table.mcards tr');
    if (tog) { e.preventDefault(); e.stopPropagation(); tr.classList.toggle('m-open'); return; }
    if (tr && !tr.hasAttribute('onclick') && !e.target.closest('button,a,input,select,textarea,label,[onclick]') && tr.querySelector('.m-tog')) tr.classList.toggle('m-open');
  }, true);

  /* ------------------------------------------------------------ board: one column at a time */
  var colIdx = {};
  function boards(root) {
    $$('.cu-board, .tk-board', root).forEach(function (b, bi) {
      var cols = $$(':scope > .cu-col, :scope > .tk-col', b); if (!cols.length) return;
      var sig = cols.map(function (c) { return (c.textContent || '').length; }).join(','), prev = b.previousElementSibling;
      if (prev && prev.classList.contains('col-tabs') && prev.__sig === sig) return;
      if (prev && prev.classList.contains('col-tabs')) prev.remove();
      var tabs = document.createElement('div'); tabs.className = 'col-tabs'; tabs.__sig = sig;
      tabs.innerHTML = cols.map(function (c, i) {
        var nm = $('.pill,.spill,.cu-ch b,.tk-ch b', c); var name = nm ? nm.textContent.trim().replace(/\s*\d+\s*$/, '') : (c.dataset.col || 'Column ' + (i + 1));
        var cnt = $$('.cu-card,.tk-card', c).length;
        return '<button type="button" data-i="' + i + '">' + name.replace(/</g, '&lt;') + ' <b>' + cnt + '</b></button>';
      }).join('');
      b.parentNode.insertBefore(tabs, b);
      var mark = function () {
        if (!MQ.matches) return;
        var w = b.clientWidth || 1, i = Math.max(0, Math.min(cols.length - 1, Math.round(b.scrollLeft / w)));
        colIdx[bi] = i; $$('button', tabs).forEach(function (x, n) { x.classList.toggle('on', n === i); });
        var on = $('button.on', tabs); if (on) tabs.scrollTo({ left: on.offsetLeft - 12, behavior: 'smooth' });
      };
      tabs.addEventListener('click', function (e) { var x = e.target.closest('button[data-i]'); if (x) b.scrollTo({ left: cols[+x.dataset.i].offsetLeft - b.offsetLeft, behavior: 'smooth' }); });
      b.addEventListener('scroll', function () { clearTimeout(b.__t); b.__t = setTimeout(mark, 60); }, { passive: true });
      var i0 = colIdx[bi] || 0; if (MQ.matches && i0) { b.scrollLeft = cols[i0].offsetLeft - b.offsetLeft; }
      mark();
    });
  }

  /* ------------------------------------------------------------ calendar: week view */
  var DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], wk = { key: '', idx: -1, pend: '' };
  function calendars(root) {
    $$('.cu-cal .cal, .ac-grid', root).forEach(function (g) {
      var cells = Array.prototype.slice.call(g.children).filter(function (c) { return !c.classList.contains('calh') && !c.classList.contains('ac-h'); });
      if (!cells.length) return;
      var host = g.closest('.cu-cal') || g.parentNode, title = $('.calbar b,.ac-nav b', host); title = title ? title.textContent : '';
      var weeks = Math.ceil(cells.length / 7);
      if (wk.key !== title) {
        wk.key = title; var t = cells.findIndex(function (c) { return c.classList.contains('today'); });
        wk.idx = wk.pend === 'last' ? weeks - 1 : wk.pend === 'first' ? 0 : (t > -1 ? Math.floor(t / 7) : 0); wk.pend = '';
      }
      wk.idx = Math.max(0, Math.min(weeks - 1, wk.idx));
      cells.forEach(function (c, i) {
        var blank = c.classList.contains('ac-blank') || c.classList.contains('empty-cell');
        var dn = $('.dn,b', c); c.setAttribute('data-wk', blank ? '' : DOW[i % 7] + ' ' + (dn ? dn.textContent.trim() : ''));
        c.classList.toggle('wk-on', !blank && Math.floor(i / 7) === wk.idx);
      });
      var nav = g.previousElementSibling, first = cells.slice(wk.idx * 7, wk.idx * 7 + 7).filter(function (c) { return c.getAttribute('data-wk'); }), lab = first.length ? first[0].getAttribute('data-wk') + ' – ' + first[first.length - 1].getAttribute('data-wk') : '';
      if (nav && nav.classList.contains('wk-nav')) { if (nav.__sig === title + '|' + wk.idx + '|' + weeks) return; nav.remove(); }
      nav = document.createElement('div'); nav.className = 'wk-nav'; nav.__sig = title + '|' + wk.idx + '|' + weeks;
      nav.innerHTML = '<button type="button" data-d="-1" aria-label="Previous week">‹</button><b>' + lab + '</b><button type="button" data-d="1" aria-label="Next week">›</button>';
      nav.addEventListener('click', function (e) {
        var b = e.target.closest('button[data-d]'); if (!b) return; var d = +b.dataset.d, ni = wk.idx + d;
        if (ni < 0 || ni >= weeks) { wk.pend = d < 0 ? 'last' : 'first'; var mb = d < 0 ? ($('[data-cm="-1"]', host) || $('button[onclick="cuNav(-1)"]', host)) : ($('[data-cm="1"]', host) || $('button[onclick="cuNav(1)"]', host)); if (mb) mb.click(); }
        else { wk.idx = ni; calendars(root); }
      });
      g.parentNode.insertBefore(nav, g);
    });
  }

  /* ------------------------------------------------------------ chat back arrows */
  function chatBack(root) {
    $$('.chat:not(.single) > .chat-pane .rc-head', root).forEach(function (h) {
      if ($('.mback', h)) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mback'; b.setAttribute('aria-label', 'Back to conversations'); b.textContent = '←';
      b.onclick = function () { var c = h.closest('.chat'); if (c) c.classList.remove('open'); };
      h.insertBefore(b, h.firstChild);
    });
    $$('.chat.single > .chat-pane .rc-head', root).forEach(function (h) {
      if ($('.mback', h)) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mback'; b.setAttribute('aria-label', 'Back'); b.textContent = '←';
      b.onclick = function () { go(TABS[portal][0].go); };
      h.insertBefore(b, h.firstChild);
    });
    $$('.chat-head .chat-id', root).forEach(function (h) {
      if ($('.mback', h)) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'mback'; b.setAttribute('aria-label', 'Back'); b.textContent = '←';
      b.onclick = function () { try { cuTreeOpen = true; render(); } catch (e) {} };
      h.insertBefore(b, h.firstChild);
    });
    $$('.cu-tree.open', root).forEach(function (t) {
      if ($('.tree-x', t)) return;
      var b = document.createElement('button'); b.type = 'button'; b.className = 'btn ghost tree-x'; b.style.cssText = 'width:100%;margin-bottom:10px'; b.textContent = '✕ Close';
      b.onclick = function () { try { cuTreeOpen = false; render(); } catch (e) {} };
      t.insertBefore(b, t.firstChild);
    });
  }
  document.addEventListener('click', function (e) {
    if (!MQ.matches) return;
    var b = e.target.closest('#clist button'); if (b) { var c = b.closest('.chat'); if (c) c.classList.add('open'); }
  });

  /* ------------------------------------------------------------ employee tasks: spaces drawer */
  function sideTog(root) {
    $$('.tk-side', root).forEach(function (side) {
      var cur = $('.tk-sp.sel,.tk-li.sel', side), label = cur ? cur.textContent.replace(/\s*\d+\s*$/, '').replace(/[▾▸☰📋]/g, '').trim() : 'All spaces';
      if (!side.__mb) { side.__mb = 1; side.classList.add('m-collapsed'); side.addEventListener('click', function (e) { if (e.target.closest('button')) setTimeout(function () { side.classList.add('m-collapsed'); queue(); }, 0); }); }
      var t = side.previousElementSibling;
      if (!t || !t.classList.contains('m-sidetog')) { t = document.createElement('button'); t.type = 'button'; t.className = 'm-sidetog'; side.parentNode.insertBefore(t, side); t.onclick = function () { side.classList.toggle('m-collapsed'); }; }
      var html = '<i style="font-style:normal">📂</i><span>' + label.replace(/</g, '&lt;') + '</span><b>▾</b>';
      if (t.__h !== html) { t.__h = html; t.innerHTML = html; }
    });
  }

  /* ------------------------------------------------------------ keyboard-aware height */
  function vv() {
    var h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vvh', Math.round(h) + 'px');
    var tb = $('.topbar'); if (tb) document.documentElement.style.setProperty('--topbar-h', tb.offsetHeight + 'px');
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', function () { vv(); var f = $('.rc-feed,.chat-feed'); var a = document.activeElement; if (f && a && /TEXTAREA|INPUT/.test(a.tagName)) setTimeout(function () { f.scrollTop = f.scrollHeight; a.scrollIntoView({ block: 'nearest' }); }, 60); }); window.visualViewport.addEventListener('scroll', vv); }
  window.addEventListener('resize', vv);
  document.addEventListener('focusout', function () { if (MQ.matches) setTimeout(function () { if (!/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) window.scrollTo(0, window.scrollY); vv(); }, 120); });

  /* ------------------------------------------------------------ back gesture (swipe right from the left edge) */
  function goBack() {
    if (sheet && sheet.classList.contains('open')) { closeSheet(); return true; }
    var ov = $('#overlay.open'); if (ov) { (window.closeModal || (window.MB && MB.closeModal) || function () {})(); return true; }
    var side = $('#sidebar.open,#side.open'); if (side) { closeDrawer(); return true; }
    var px = $('.tk-panel.open #pX'); if (px) { px.click(); return true; }
    var ch = $('.chat.open'); if (ch && !ch.classList.contains('single')) { ch.classList.remove('open'); return true; }
    var tb = $('.chat-head .mback'); if (tb) { tb.click(); return true; }
    var sb = $('.chat.single .rc-head .mback'); if (sb) { sb.click(); return true; }
    var tree = $('.cu-tree.open .tree-x'); if (tree) { tree.click(); return true; }
    var cr = $('.cu-crumb .back'); if (cr) { cr.click(); return true; }
    var v = $('#view,main'); if (v) { var bb = $$('button', v).filter(function (b) { return /^\s*←/.test(b.textContent) && b.offsetParent !== null; })[0]; if (bb) { bb.click(); return true; } }
    return false;
  }
  var tx = 0, ty = 0, tEdge = false;
  document.addEventListener('touchstart', function (e) { var t = e.touches[0]; tx = t.clientX; ty = t.clientY; tEdge = MQ.matches && tx < 24 && e.touches.length === 1; }, { passive: true });
  document.addEventListener('touchend', function (e) {
    if (!tEdge) return; tEdge = false; var t = e.changedTouches[0];
    if (t.clientX - tx > 70 && Math.abs(t.clientY - ty) < 60) { if (!goBack()) openDrawer(); }
  }, { passive: true });

  /* ------------------------------------------------------------ run + keep in sync with re-renders */
  var queued = false;
  function sync() {
    queued = false;
    buildTabs(); wireDrawer(); wireModal(); paintTabs(); vv();
    if (!MQ.matches) return;
    var root = $('#view') || $('main') || document;
    cardify(root); sideTog(root); boards(root); calendars(root); chatBack(document);
  }
  function queue() { if (!queued) { queued = true; requestAnimationFrame(sync); } }
  function start() {
    new MutationObserver(queue).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    MQ.addEventListener ? MQ.addEventListener('change', queue) : MQ.addListener(queue);
    queue();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.MBMobile = { goBack: goBack, sync: sync };
})();
