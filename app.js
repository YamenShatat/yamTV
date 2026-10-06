/* yamTV (rebuilt from Extreme InfiniTV) for one Android 7.1 TV box (1 GB RAM, old system WebView).
   Plain ES5 on purpose: that WebView predates arrow functions, async/await and ?.
   Video plays natively (window.Native, see MainActivity.java); this page is the UI. */
(function () {
  'use strict';

  var VERSION = '1.6.3';
  var CHUNK = 40; // grid/list items rendered per step; keeps the DOM small on 1 GB of RAM

  // In a desktop browser (no Android side) everything still renders; playback is a no-op.
  // The page background is transparent for the app (see app.css); a desktop browser needs one.
  if (!window.Native) document.documentElement.style.background = '#0b0f14';
  var N = window.Native || {
    play: function () {}, setPane: function () {}, clearPane: function () {}, fullscreen: function () {},
    stop: function () {}, exit: function () {}, liveInfo: function () {}, toast: function () {}, keyboard: function () {}, loadCatalog: function () {},
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage full */ } },
    search: function () { return '{}'; }, recent: function () { return '[]'; },
    counts: function () { return '{"l":0,"m":0,"s":0}'; }
  };

  // ---------- small helpers ----------

  function $(s, root) { return (root || document).querySelector(s); }
  function each(list, fn) { for (var i = 0; i < list.length; i++) fn(list[i], i); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function clock(d) {
    var h = d.getHours(), ap = h < 12 ? 'AM' : 'PM';
    h = h % 12 || 12;
    return h + ':' + pad(d.getMinutes()) + ' ' + ap;
  }
  function hms(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60;
    return (h ? h + ':' + pad(m) : m) + ':' + pad(s % 60);
  }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function date(sec) {
    var d = new Date(sec * 1000);
    return MONTHS[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }
  function b64(s) {
    try { return decodeURIComponent(escape(atob(s))); } catch (e) { return s || ''; }
  }
  function isArr(a) { return Object.prototype.toString.call(a) === '[object Array]'; }
  function rating(r) { var f = parseFloat(r); return f > 0 ? f.toFixed(1) : ''; }
  // tmdb serves any size; the provider links 600-1280px originals, too heavy to decode by the dozen.
  function img(u, w) {
    return u ? String(u).replace(/(image\.tmdb\.org\/t\/p\/)[^\/]+\//, '$1w' + (w || 342) + '/') : '';
  }

  // The Windows app (yamTV.exe) adds downloads and mouse styling; the TV and a browser do not.
  var WIN = false;
  try { WIN = !!(window.Native && N.platform && N.platform() === 'windows'); } catch (e) { WIN = false; }
  if (WIN) document.documentElement.className += ' win';
  // The website (native.js): no exit, no live format choice (the web always plays HLS).
  var WEB = false;
  try { WEB = !!(window.Native && N.platform && N.platform() === 'web'); } catch (e) { WEB = false; }
  if (WEB) document.documentElement.className += ' web';
  // Downloads: the website does them through the relay on this PC (relay/local.js).
  var DLS = WIN || WEB;

  // Saved state lives on the Android side (written to disk at once, so a power cut loses nothing).
  // Values saved by version 1.0.0 in WebView localStorage are moved over on first read.
  var store = {
    get: function (k, d) {
      try {
        var v = N.get(k);
        if (v == null && !WEB) { // the website must not pick up another app's data
          v = localStorage.getItem(k);
          if (v != null) N.set(k, v);
        }
        return v ? JSON.parse(v) : d;
      } catch (e) { return d; }
    },
    set: function (k, v) { N.set(k, JSON.stringify(v)); }
  };

  // Tabler icons (MIT), outline set, as used by upstream.
  var P = {
    home: '<path d="M5 12l-2 0l9 -9l9 9l-2 0"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-7"/><path d="M9 21v-6a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v6"/>',
    tv: '<path d="M3 9a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -9"/><path d="M16 3l-4 4l-4 -4"/>',
    movie: '<path d="M4 6a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12"/><path d="M8 4l0 16"/><path d="M16 4l0 16"/><path d="M4 8l4 0"/><path d="M4 16l4 0"/><path d="M4 12l16 0"/><path d="M16 8l4 0"/><path d="M16 16l4 0"/>',
    download: '<path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2"/><path d="M7 11l5 5l5 -5"/><path d="M12 4l0 12"/>',
    check: '<path d="M5 12l5 5l10 -10"/>',
    x: '<path d="M18 6l-12 12"/><path d="M6 6l12 12"/>',
    folder: '<path d="M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2"/>',
    down: '<path d="M12 5l0 14"/><path d="M18 13l-6 6"/><path d="M6 13l6 6"/>',
    stack: '<path d="M12 4l-8 4l8 4l8 -4l-8 -4"/><path d="M4 12l8 4l8 -4"/><path d="M4 16l8 4l8 -4"/>',
    star: '<path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873l-6.158 -3.245"/>',
    bookmark: '<path d="M18 7v14l-6 -4l-6 4v-14a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4"/>',
    sparkles: '<path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6"/>',
    settings: '<path d="M10.325 4.317c.426 -1.756 2.924 -1.756 3.35 0a1.724 1.724 0 0 0 2.573 1.066c1.543 -.94 3.31 .826 2.37 2.37a1.724 1.724 0 0 0 1.065 2.572c1.756 .426 1.756 2.924 0 3.35a1.724 1.724 0 0 0 -1.066 2.573c.94 1.543 -.826 3.31 -2.37 2.37a1.724 1.724 0 0 0 -2.572 1.065c-.426 1.756 -2.924 1.756 -3.35 0a1.724 1.724 0 0 0 -2.573 -1.066c-1.543 .94 -3.31 -.826 -2.37 -2.37a1.724 1.724 0 0 0 -1.065 -2.572c-1.756 -.426 -1.756 -2.924 0 -3.35a1.724 1.724 0 0 0 1.066 -2.573c-.94 -1.543 .826 -3.31 2.37 -2.37c1 .608 2.296 .07 2.572 -1.065"/><path d="M9 12a3 3 0 1 0 6 0a3 3 0 0 0 -6 0"/>',
    search: '<path d="M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M21 21l-6 -6"/>',
    chev: '<path d="M6 9l6 6l6 -6"/>',
    play: '<path d="M7 4v16l13 -8l-13 -8"/>',
    refresh: '<path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/>',
    logout: '<path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2"/><path d="M9 12h12l-3 -3"/><path d="M18 15l3 -3"/>',
    plus: '<path d="M12 5l0 14"/><path d="M5 12l14 0"/>',
    trash: '<path d="M4 7l16 0"/><path d="M10 11l0 6"/><path d="M14 11l0 6"/><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12"/><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3"/>'
  };
  function ic(n, cls) {
    return '<svg class="ic ' + (cls || '') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">' + P[n] + '</svg>';
  }
  // The yamTV mark (Desktop\yamtv_logo.svg): a play button with a comet circling it and a swoosh y
  // cut through the button (a real see-through cut, via the mask). Colours read --lg* (button) and
  // --lr* (comet), which applyAccent sets from the accent;
  // app.css holds the default cyan. The #0b0f14 strokes are the gap where the comet passes in front.
  var LOGO = '<svg viewBox="0 0 512 512"><defs>' +
    '<linearGradient id="ytA" gradientUnits="userSpaceOnUse" x1="80" y1="60" x2="440" y2="470"><stop style="stop-color:var(--lg1)"/><stop offset=".55" style="stop-color:var(--lg2)"/><stop offset="1" style="stop-color:var(--lg3)"/></linearGradient>' +
    '<linearGradient id="ytB" gradientUnits="userSpaceOnUse" x1="40" y1="120" x2="470" y2="400"><stop style="stop-color:var(--lr1)"/><stop offset=".55" style="stop-color:var(--lr2)"/><stop offset="1" style="stop-color:var(--lr3)"/></linearGradient>' +
    '<linearGradient id="ytC" gradientUnits="userSpaceOnUse" x1="-222" y1="0" x2="222" y2="0"><stop style="stop-color:var(--lr1);stop-opacity:0"/><stop offset=".6" style="stop-color:var(--lr2);stop-opacity:.7"/><stop offset="1" style="stop-color:var(--lr2)"/></linearGradient>' +
    '<mask id="ytM" maskUnits="userSpaceOnUse" x="0" y="0" width="512" height="512"><rect width="512" height="512" fill="#fff"/><path d="M146 136L246 278L342 136M246 278Q214 330 150 372" fill="none" stroke="#000" stroke-width="18"/></mask></defs>' +
    '<g transform="translate(256 262) rotate(-24)"><path d="M-222 0A222 74 0 0 1 222 0" fill="none" stroke="url(#ytC)" stroke-width="22" stroke-linecap="round"/></g>' +
    '<path d="M186 142L186 382L372 262Z" fill="url(#ytA)" stroke="url(#ytA)" stroke-width="48" stroke-linejoin="round" mask="url(#ytM)"/>' +
    '<g transform="translate(256 262) rotate(-24)"><path d="M222 0A222 74 0 0 1 60 71" fill="none" stroke="#0b0f14" stroke-width="44" stroke-linecap="round"/>' +
    '<path d="M222 0A222 74 0 0 1 60 71" fill="none" stroke="url(#ytB)" stroke-width="22" stroke-linecap="round"/>' +
    '<circle cx="60" cy="71" r="30" fill="#0b0f14"/><circle cx="60" cy="71" r="20" style="fill:var(--lr1)"/></g></svg>';

  // ---------- state ----------

  var acct = store.get('acct', null);          // { name, server, user, pass }
  var info = store.get('info', null);          // user_info from the last successful login
  var prefs = store.get('prefs', { fmt: 'ts' });

  // Accent colour (Settings > Appearance). All light enough for the dark text used on accent fills.
  // The native parts (player bar, dialogs, live info) read prefs.accent from the same saved prefs.
  var ACCENTS = [
    ['#66d9e8', 'Cyan (default)'], ['#ec92e5', 'Purple'], ['#b197fc', 'Violet'], ['#74c0fc', 'Blue'],
    ['#63e6be', 'Teal'], ['#8ce99a', 'Green'], ['#ffd43b', 'Yellow'], ['#ffa94d', 'Orange'], ['#ff8787', 'Red']
  ];
  function applyAccent(hex) {
    var n = parseInt(hex.slice(1), 16), rgb = (n >> 16 & 255) + ', ' + (n >> 8 & 255) + ', ' + (n & 255);
    var s = document.documentElement.style;
    s.setProperty('--accent', hex);
    s.setProperty('--accent-rgb', rgb);
    s.setProperty('--accent-soft', 'rgba(' + rgb + ', 0.18)');
    // Logo: light-to-deep shades of the accent, which read as that colour in every case.
    var h = hueOf(n), sat = Math.max(satOf(n), 70), L = { lg1: 73, lg2: 61, lg3: 51, lr1: 80, lr2: 69, lr3: 63 };
    for (var k in L) {
      s.setProperty('--' + k, 'hsl(' + h + ', ' + sat + '%, ' + L[k] + '%)');
    }
  }
  function rgbOf(n) { return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
  function hueOf(n) {
    var c = rgbOf(n), M = Math.max(c[0], c[1], c[2]), d = M - Math.min(c[0], c[1], c[2]);
    if (!d) return 0;
    var h = M === c[0] ? ((c[1] - c[2]) / d) % 6 : M === c[1] ? (c[2] - c[0]) / d + 2 : (c[0] - c[1]) / d + 4;
    return Math.round((h * 60 + 360) % 360);
  }
  function satOf(n) {
    var c = rgbOf(n), M = Math.max(c[0], c[1], c[2]), m = Math.min(c[0], c[1], c[2]), l = (M + m) / 2;
    return M === m ? 0 : Math.round(100 * (M - m) / (1 - Math.abs(2 * l - 1)));
  }
  if (/^#[0-9a-f]{6}$/i.test(prefs.accent || '')) applyAccent(prefs.accent);
  var favs = store.get('favs', []);            // [{ k, id, n, i, e, c }]
  var later = store.get('later', []);
  // 'm<id>' | 'e<id>' -> { p, d } in ms. Written by MainActivity every few seconds while playing.
  var progress = {};
  var lastEp = store.get('lastEp', {});        // series id -> { s, id, num }
  var cw = store.get('cw', []);                // continue watching: slim items + t, newest first
  function reloadWatch() { progress = store.get('progress', {}); }
  reloadWatch();
  var catalogReady = false;
  var counts = { l: 0, m: 0, s: 0 };
  var cats = {};    // 'live' | 'vod' | 'series' -> category list
  var lists = {};   // same keys -> { key, items } for the most recent category only
  var nowPlaying = null; // { item, eps? } of the movie/series in the player

  var main, side, modal;
  var cur = { v: null, a: null };
  var hist = [];
  var gen = 0; // bumped on every render; late network replies for an old view are dropped

  // ---------- server ----------

  function base() { return acct.server.replace(/\/+$/, ''); }
  function apiUrl() {
    return (N.apiBase ? N.apiBase(base()) : base()) + '/player_api.php?username=' + encodeURIComponent(acct.user) + '&password=' + encodeURIComponent(acct.pass);
  }
  function xget(url, cb) {
    var x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.timeout = 45000;
    x.onload = function () {
      var d = null;
      try { d = JSON.parse(x.responseText); } catch (e) { /* not JSON */ }
      if (x.status >= 200 && x.status < 300 && d !== null) cb(null, d);
      else cb('Server replied ' + x.status);
    };
    x.onerror = function () { cb('Cannot reach the server'); };
    x.ontimeout = function () { cb('The server took too long to answer'); };
    x.send();
  }
  function api(action, extra, cb) { xget(apiUrl() + (action ? '&action=' + action : '') + (extra || ''), cb); }

  function categories(kind, cb) {
    if (cats[kind]) return cb(null, cats[kind]);
    api('get_' + kind + '_categories', '', function (err, d) {
      if (err) return cb(err);
      cats[kind] = isArr(d) ? d : [];
      cb(null, cats[kind]);
    });
  }
  var LIST = { live: ['get_live_streams', 'l'], vod: ['get_vod_streams', 'm'], series: ['get_series', 's'] };
  var CW = '__cw'; // the "Continue watching" category, built locally
  function items(kind, cat, cb) {
    if (cat === CW) return cb(null, cwItems(LIST[kind][1]));
    var key = kind + ':' + cat;
    if (lists[kind] && lists[kind].key === key) return cb(null, lists[kind].items);
    api(LIST[kind][0], '&category_id=' + encodeURIComponent(cat), function (err, d) {
      if (err) return cb(err);
      var out = [];
      each(isArr(d) ? d : [], function (o) { out.push(norm(LIST[kind][1], o)); });
      lists[kind] = { key: key, items: out };
      cb(null, out);
    });
  }
  // One item shape everywhere: API rows, catalog search results, favorites.
  function norm(k, o) {
    return {
      k: k,
      id: +(o.stream_id || o.series_id || 0),
      n: String(o.name || ''),
      i: o.stream_icon || o.cover || '',
      e: o.container_extension || '',
      c: String(o.category_id || ''),
      r: rating(o.rating),
      num: o.num || 0,
      y: String(o.releaseDate || o.release_date || '').slice(0, 10),
      g: o.genre || '',
      t: +(o.added || o.last_modified || 0)
    };
  }
  function catName(kind, id) {
    if (id === CW) return 'Continue watching';
    var l = cats[kind] || [];
    for (var i = 0; i < l.length; i++) if (String(l[i].category_id) === String(id)) return l[i].category_name;
    return '';
  }

  function userPath() { return encodeURIComponent(acct.user) + '/' + encodeURIComponent(acct.pass) + '/'; }
  function liveUrl(id) { return base() + '/live/' + userPath() + id + (prefs.fmt === 'hls' ? '.m3u8' : '.ts'); }
  function movieUrl(id, ext) { return base() + '/movie/' + userPath() + id + '.' + (ext || 'mp4'); }
  function episodeUrl(id, ext) { return base() + '/series/' + userPath() + id + '.' + (ext || 'mp4'); }

  function loadCatalog(force) {
    catalogReady = false;
    N.loadCatalog(apiUrl(), base() + '|' + acct.user, !!force);
  }

  // ---------- favorites / watch later ----------

  function keyOf(it) { return it.k + it.id; }
  function slim(it) { return { k: it.k, id: it.id, n: it.n, i: it.i, e: it.e, c: it.c, r: it.r }; }
  function has(list, it) {
    for (var i = 0; i < list.length; i++) if (keyOf(list[i]) === keyOf(it)) return i;
    return -1;
  }
  function toggle(name, it) {
    var list = name === 'favs' ? favs : later, i = has(list, it);
    if (i >= 0) list.splice(i, 1); else list.unshift(slim(it));
    store.set(name, list);
    return i < 0;
  }

  // ---------- continue watching ----------

  function touchCw(it) {
    var i = has(cw, it);
    if (i >= 0) cw.splice(i, 1);
    var s = slim(it);
    s.t = Date.now();
    cw.unshift(s);
    if (cw.length > 60) cw.length = 60;
    store.set('cw', cw);
  }
  function dropCw(it) {
    var i = has(cw, it);
    if (i >= 0) { cw.splice(i, 1); store.set('cw', cw); }
  }
  // Movies stay while they have a resume point; series until their last episode is finished.
  function cwItems(k) {
    var out = [];
    each(cw, function (it) { if (it.k === k && (k !== 'm' || progress['m' + it.id])) out.push(it); });
    return out;
  }

  // ---------- toast / modal ----------

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.className = ''; }, 2600);
  }

  var modalCb = null, modalReturn = null;
  function pick(title, opts, current, cb) {
    // On Windows the video is a window above the page, so on Live TV the list opens beside it.
    var h = '<div class="sheet' + (WIN && cur.v === 'live' ? ' beside' : '') + '"><div class="h">' + esc(title) + '</div><div class="opts scroller">';
    each(opts, function (o, i) {
      h += '<button class="f opt' + (String(o.v) === String(current) ? ' on' : '') + '" data-o="' + i + '">' + esc(o.t) + '</button>';
    });
    modal.innerHTML = h + '</div></div>';
    showModal();
    modalReturn = document.activeElement;
    modalCb = function (i) { closeModal(); cb(opts[i].v); };
    focus($('.opt.on', modal) || $('.opt', modal));
  }
  function showModal() {
    modal.style.display = 'block';
  }
  function closeModal() {
    modal.style.display = 'none';
    modal.innerHTML = '';
    modalCb = null;
    if (modalReturn && document.body.contains(modalReturn)) focus(modalReturn);
  }

  // ---------- focus and the remote's arrow keys ----------

  function visible(el) { return el.offsetParent !== null && !el.disabled; }
  function focus(el) {
    if (!el) return;
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    reveal(el);
  }
  // Scroll the nearest scrolling ancestor just enough to show el (and the page header near the top).
  function reveal(el) {
    var p = el.parentNode, pad = 28;
    while (p && p !== document.body) {
      var cs = window.getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth) {
        var r = el.getBoundingClientRect(), s = p.getBoundingClientRect();
        if (r.right > s.right - 4) p.scrollLeft += r.right - s.right + 16;
        else if (r.left < s.left + 4) p.scrollLeft -= s.left - r.left + 16;
      }
      if (/(auto|scroll)/.test(cs.overflowY) && p.scrollHeight > p.clientHeight) {
        var r2 = el.getBoundingClientRect(), s2 = p.getBoundingClientRect();
        var offset = r2.top - s2.top + p.scrollTop;
        if (p === main && offset < 330) p.scrollTop = 0;
        else if (r2.bottom > s2.bottom - pad) p.scrollTop += r2.bottom - s2.bottom + pad;
        else if (r2.top < s2.top + pad) p.scrollTop -= s2.top + pad - r2.top;
        return;
      }
      p = p.parentNode;
    }
  }

  var lastMainFocus = null;
  // The last focused item, to put focus back when the page gets it back from the video player.
  var lastFocused = null;
  document.addEventListener('focus', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('f')) lastFocused = t;
  }, true);
  function restoreFocus() {
    var a = document.activeElement;
    if ((!a || a === document.body) && lastFocused && document.body.contains(lastFocused) && visible(lastFocused)) {
      focus(lastFocused);
      return true;
    }
    return false;
  }
  window.addEventListener('focus', function () { setTimeout(restoreFocus, 0); });

  // Nearest focusable in the pressed direction, by distance along it plus off-axis offset.
  function move(dir) {
    var a = document.activeElement;
    var scope = modalCb ? modal : document;
    var list = scope.querySelectorAll('.f');
    if (!a || !a.classList || !a.classList.contains('f') || !scope.contains(a)) {
      if (!(scope === document && restoreFocus())) focus(defaultFocus());
      return;
    }
    var ar = a.getBoundingClientRect(), best = null, bestScore = Infinity;
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el === a || !visible(el)) continue;
      var r = el.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      var along, off, overlap;
      if (dir === 'left' || dir === 'right') {
        along = dir === 'right' ? r.left - ar.right : ar.left - r.right;
        if (along < -Math.min(ar.width, r.width) / 2) continue;
        overlap = r.top < ar.bottom - 2 && r.bottom > ar.top + 2;
        off = overlap ? 0 : Math.abs((r.top + r.bottom) / 2 - (ar.top + ar.bottom) / 2);
      } else {
        along = dir === 'down' ? r.top - ar.bottom : ar.top - r.bottom;
        if (along < -Math.min(ar.height, r.height) / 2) continue;
        overlap = r.left < ar.right - 2 && r.right > ar.left + 2;
        off = overlap ? Math.abs(r.left - ar.left) / 4 : Math.abs((r.left + r.right) / 2 - (ar.left + ar.right) / 2);
      }
      var score = Math.max(0, along) + off * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    }
    if (!best) return;
    // Entering the sidebar lands on the current page's entry; leaving it returns where you were.
    var inSide = side.contains(a), toSide = side.contains(best);
    if (!inSide && toSide) {
      lastMainFocus = a;
      best = $('.nav.on', side) || best;
    } else if (inSide && !toSide && dir === 'right' && lastMainFocus && main.contains(lastMainFocus) && visible(lastMainFocus)) {
      best = lastMainFocus;
    } else if (inSide && !toSide && dir === 'right' && $('.af', main) && visible($('.af', main))) {
      best = $('.af', main); // first visit from the sidebar: the page's main control
    }
    focus(best);
  }
  function defaultFocus() {
    if (modalCb) return $('.f', modal);
    return $('.af', main) || $('.f', main) || $('.nav.on', side) || $('.f', side);
  }

  var DIRS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
  document.addEventListener('keydown', function (e) {
    var k = e.keyCode, t = e.target;
    var typing = t && t.tagName === 'INPUT';
    if (DIRS[k]) {
      if (typing && (k === 37 || k === 39)) {
        var p = t.selectionStart;
        if (k === 37 && p > 0) return;
        if (k === 39 && p < t.value.length) return;
      }
      e.preventDefault();
      move(DIRS[k]);
      return;
    }
    if (k === 13) {
      if (typing) { N.keyboard(); if (t.onenter) t.onenter(); return; }
      if (t && t.classList && t.classList.contains('f') && t.tagName !== 'BUTTON') { e.preventDefault(); t.click(); }
      return;
    }
    // Desktop-browser testing only; on the TV the Back key is handled by MainActivity.
    if (k === 27 || (k === 8 && !typing)) { e.preventDefault(); App.back(); }
  });

  // ---------- routing ----------

  var NAV = [
    ['home', 'Home', 'home'], ['live', 'Live TV', 'tv'], ['movies', 'Movies', 'movie'], ['series', 'Series', 'stack'],
    ['favorites', 'Favorites', 'star'], ['later', 'Watch later', 'bookmark'], ['recent', 'Recently added', 'sparkles']
  ];
  if (DLS) NAV.push(['downloads', 'Downloads', 'download']);
  var NAV_OF = { movie: 'movies', show: 'series', login: 'settings' };

  function go(v, a) {
    if (cur.v) hist.push({ v: cur.v, a: cur.a, r: snapshot() });
    if (hist.length > 30) hist.shift();
    show(v, a, null);
  }
  function show(v, a, restore) {
    if (cur.v === 'live' && v !== 'live') leaveLive();
    var fromSide = side.contains(document.activeElement);
    cur = { v: v, a: a, fromSide: fromSide };
    gen++;
    var nav = NAV_OF[v] || v;
    each(side.querySelectorAll('.nav'), function (el) {
      el.classList.toggle('on', el.getAttribute('data-go') === nav);
    });
    main.className = 'v-' + v;
    main.scrollTop = 0;
    reloadWatch();
    VIEWS[v](a, restore);
  }
  function snapshot() {
    var l = main.querySelectorAll('.f'), a = document.activeElement, idx = -1;
    for (var i = 0; i < l.length; i++) if (l[i] === a) idx = i;
    var inner = $('.list', main);
    return { idx: idx, top: main.scrollTop, inner: inner ? inner.scrollTop : 0 };
  }
  // Views call this once their content is on screen.
  function settle(r) {
    if (r) {
      main.scrollTop = r.top;
      var inner = $('.list', main);
      if (inner) inner.scrollTop = r.inner;
      var l = main.querySelectorAll('.f');
      if (r.idx >= 0 && l[r.idx]) { focus(l[r.idx]); return; }
    }
    if (cur.fromSide && side.contains(document.activeElement)) return;
    if (!main.contains(document.activeElement)) focus(defaultFocus());
  }

  // ---------- shared markup ----------

  function head(title, sub) {
    return '<h1 class="ttl"><span>' + esc(title.charAt(0)) + '</span>' + esc(title.slice(1)) + '</h1>' +
      (sub ? '<p class="sub">' + sub + '</p>' : '');
  }
  function selBtn(id, label, value, cls) {
    return '<button class="f sel ' + (cls || '') + '" id="' + id + '"><span class="lbl">' + esc(label) +
      '</span><span class="val">' + esc(value) + '</span>' + ic('chev') + '</button>';
  }
  function searchBox(id, ph, cls) {
    return '<div class="box ' + (cls || '') + '">' + ic('search') + '<input class="f" id="' + id + '" type="text" placeholder="' +
      esc(ph) + '" autocomplete="off" spellcheck="false"></div>';
  }
  function setVal(id, text) { var b = document.getElementById(id); if (b) $('.val', b).textContent = text; }

  function card(it, i, act, opts) {
    opts = opts || {};
    var sq = it.k === 'l', le = it.k === 's' && opts.cw ? lastEp[it.id] : null;
    var pr = it.k === 'm' ? progress['m' + it.id] : le ? progress['e' + le.id] : null;
    var sub = le && le.num ? 'Season ' + le.s + ' · Episode ' + le.num
      : opts.cw && pr && pr.d ? Math.max(1, Math.round((pr.d - pr.p) / 60000)) + ' min left'
      : opts.sub != null ? opts.sub : (it.y ? it.y.slice(0, 4) : '') || catName(it.k === 'm' ? 'vod' : it.k === 's' ? 'series' : 'live', it.c);
    return '<div class="f card' + (sq ? ' sq' : '') + '" tabindex="-1" data-act="' + act + '" data-i="' + i + '">' +
      '<div class="poster"><span class="ph">' + esc(it.n.replace(/^[^\wÀ-ɏ؀-ۿ]+/, '').charAt(0)) + '</span>' +
      (it.i ? '<img src="' + esc(img(it.i)) + '" onerror="this.style.display=\'none\'">' : '') +
      (opts.badge ? '<span class="badge">' + (it.k === 'm' ? 'MOVIE' : it.k === 's' ? 'SERIES' : 'LIVE') + '</span>' : '') +
      (it.r && !sq ? '<span class="rate">' + ic('star', 'fill') + it.r + '</span>' : '') +
      (pr && pr.d ? '<span class="prog"><i style="width:' + Math.round(100 * pr.p / pr.d) + '%"></i></span>' : '') +
      '</div><div class="meta"><div class="t" dir="auto">' + esc(it.n) + '</div><div class="s">' + esc(sub || ' ') + '</div></div></div>';
  }

  // A grid that renders CHUNK cards at a time and adds more as focus nears the end.
  var grid = null;
  function mountGrid(el, list, act, opts, restoreIdx) {
    grid = { el: el, list: list, act: act, opts: opts, shown: 0 };
    el.innerHTML = '';
    growGrid(Math.max(CHUNK, (restoreIdx || 0) + 10));
  }
  function growGrid(upTo) {
    if (!grid || !document.body.contains(grid.el)) return;
    var end = Math.min(grid.list.length, upTo), h = '';
    for (var i = grid.shown; i < end; i++) h += card(grid.list[i], i, grid.act, grid.opts);
    if (h) grid.el.insertAdjacentHTML('beforeend', h);
    grid.shown = end;
  }
  document.addEventListener('focus', function (e) {
    var t = e.target;
    if (grid && t && t.getAttribute && grid.el.contains(t)) {
      var i = +t.getAttribute('data-i');
      if (i > grid.shown - 12) growGrid(grid.shown + CHUNK);
    }
    if (liveList && t && t.getAttribute && liveList.el.contains(t)) {
      var j = +t.getAttribute('data-i');
      if (j > liveList.shown - 15) growLive(liveList.shown + CHUNK);
    }
  }, true);

  // Clicks (Enter on the remote) are routed by data-act.
  var ACTS = {};
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('[data-act],[data-go],[data-o]') : null;
    if (!el) return;
    if (el.hasAttribute('data-o') && modalCb) { modalCb(+el.getAttribute('data-o')); return; }
    if (el.hasAttribute('data-go')) {
      hist = [];
      show(el.getAttribute('data-go'), null, null);
      return;
    }
    var fn = ACTS[el.getAttribute('data-act')];
    if (fn) fn(el, +el.getAttribute('data-i'));
  });

  function open(it, list) {
    if (it.k === 'l') playLive(list || [it], Math.max(0, has(list || [it], it)), true);
    else go(it.k === 'm' ? 'movie' : 'show', it);
  }

  // ---------- views ----------

  var VIEWS = {};

  // Home: the three hero tiles and "Recently added", as in the desktop screenshots.
  VIEWS.home = function (a, r) {
    if (!acct) return VIEWS.login('welcome', r);
    var d = new Date(), h = d.getHours();
    var greet = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : h < 22 ? 'Good evening' : 'Good night';
    main.innerHTML =
      '<div class="hero">' +
      '<button class="f tile big af" data-go="live"><div class="eyebrow">' + greet + ' · ' + clock(d) +
      (counts.l ? ' · ' + num(counts.l) + ' channels' : '') + '</div>' + ic('tv', 'big-ic') +
      '<div class="h">Live TV</div><div class="p">Channels, and what’s on right now.</div></button>' +
      '<div class="side">' +
      '<button class="f tile" data-go="movies">' + ic('movie') + '<div class="h">Movies</div><div class="p">Browse the library.</div></button>' +
      '<button class="f tile" data-go="series">' + ic('stack') + '<div class="h">Series</div><div class="p">Shows and full seasons.</div></button>' +
      '</div></div>' + homeCwRow() +
      '<div class="sec-h"><h2>Recently added</h2><button class="f link" data-go="recent">View all ›</button></div>' +
      '<div id="homerail"></div>';
    homeRail();
    settle(r);
  };
  // "Continue watching" above "Recently added": movies with a saved place and started series,
  // most recently watched first. Hidden when there is nothing to continue.
  var homeCw = [];
  function homeCwRow() {
    homeCw = [];
    each(cw, function (it) { if (it.k === 's' || progress['m' + it.id]) homeCw.push(it); });
    if (!homeCw.length) return '';
    var h = '';
    each(homeCw, function (it, i) { h += card(it, i, 'homecw', { badge: true, cw: true }); });
    return '<div class="sec-h"><h2>Continue watching</h2></div><div class="rail">' + h + '</div>';
  }
  ACTS.homecw = function (el, i) { open(homeCw[i]); };
  var homeItems = [];
  function homeRail() {
    var el = $('#homerail');
    if (!el) return;
    if (!catalogReady) { el.innerHTML = '<div class="spin">Loading your library… (the first start takes a minute)</div>'; return; }
    homeItems = JSON.parse(N.recent('ms', 20));
    var h = '';
    each(homeItems, function (it, i) { h += card(it, i, 'home', { badge: true, sub: '' }); });
    el.className = 'rail';
    el.innerHTML = h || '<div class="spin">Nothing yet.</div>';
  }
  ACTS.home = function (el, i) { open(homeItems[i]); };

  // Welcome card and the playlist form.
  VIEWS.login = function (a, r) {
    if (a === 'welcome' || (!acct && a !== 'form')) {
      main.innerHTML = '<div class="panel welcome"><div class="eyebrow">WELCOME</div>' +
        '<div class="big">Pick something to<br>watch.</div>' +
        '<p>Connect an IPTV subscription. Channels, movies, and series will appear here.</p>' +
        '<button class="f btn primary af" data-act="addpl">' + ic('plus') + 'Add a playlist</button>' +
        '<div class="fine">This app does not provide any content.</div></div>';
      settle(r);
      return;
    }
    var v = acct || {};
    main.innerHTML = head('Add a playlist', 'Xtream Codes login from your provider. It stays on this TV.') +
      '<div class="panel form">' +
      '<label>Playlist name</label><div class="box"><input class="f" id="fname" type="text" value="' + esc(v.name || 'My IPTV') + '"></div>' +
      '<label>Server URL</label><div class="box"><input class="f af" id="fserver" type="text" placeholder="http://example.com:80" value="' + esc(v.server || '') + '"></div>' +
      '<label>Username</label><div class="box"><input class="f" id="fuser" type="text" autocomplete="off" value="' + esc(v.user || '') + '"></div>' +
      '<label>Password</label><div class="box"><input class="f" id="fpass" type="password" value="' + esc(v.pass || '') + '"></div>' +
      '<div class="err" id="ferr"></div>' +
      '<button class="f btn primary" data-act="connect">Connect</button></div>';
    settle(r);
  };
  ACTS.addpl = function () { go('login', 'form'); };
  ACTS.connect = function () {
    var server = $('#fserver').value.replace(/\s+/g, ''), user = $('#fuser').value.trim(), pass = $('#fpass').value;
    var err = $('#ferr');
    if (!/^https?:\/\//i.test(server)) server = 'http://' + server;
    if (!user || !pass || server.length < 10) { err.textContent = 'Fill in the server, username and password.'; return; }
    err.textContent = 'Connecting…';
    var trial = { name: $('#fname').value.trim() || 'My IPTV', server: server, user: user, pass: pass };
    var saved = acct;
    acct = trial;
    api('', '', function (e, d) {
      if (e || !d || !d.user_info || String(d.user_info.auth) !== '1') {
        acct = saved;
        err.textContent = e ? e : 'Login refused: check the username and password.';
        return;
      }
      store.set('acct', acct);
      info = d.user_info;
      store.set('info', info);
      cats = {};
      lists = {};
      renderSide();
      loadCatalog(true);
      hist = [];
      show('home', null, null);
      focus($('.af', main));
    });
  };

  // Live TV: channel list on the left, preview player and guide on the right.
  var liveState = { cat: store.get('liveCat', null), q: '', sort: 'src', all: [], list: [] };
  var liveList = null, zap = { list: [], i: 0 }, playingId = 0;
  // s: the short name shown on the narrow Sort button (the picker lists the full name).
  var LSORT = [{ v: 'src', t: 'Source order', s: 'Source' }, { v: 'az', t: 'A → Z', s: 'A → Z' }, { v: 'za', t: 'Z → A', s: 'Z → A' }];
  function liveSortName(v) { for (var i = 0; i < LSORT.length; i++) if (LSORT[i].v === v) return LSORT[i].s; return ''; }

  VIEWS.live = function (a, r) {
    var my = gen;
    main.innerHTML = '<div class="live">' +
      '<section class="panel lp"><div class="filters">' + searchBox('lq', 'Search all channels…') + '</div>' +
      '<div class="filters">' + selBtn('lcat', 'Category', '…', 'cat af') + selBtn('lsort', 'Sort', liveSortName(liveState.sort), 'sort') + '</div>' +
      '<div class="list scroller" id="llist"><div class="spin">Loading channels…</div></div><div class="lfoot" id="lcount">&nbsp;</div></section>' +
      '<section class="panel rp"><div class="pane" id="pane"><div class="in" id="panein"></div></div>' +
      '<div class="nowline" id="lnow"><span class="pill">OFF</span><span class="t">-</span></div>' +
      '<div class="epg"><div class="h">EPG</div><div id="lepg"></div></div></section></div>';
    paneIdle();
    var p = $('#pane').getBoundingClientRect();
    N.setPane(p.left, p.top, p.width, p.height, document.documentElement.clientWidth);
    var q = $('#lq');
    q.value = liveState.q;
    q.oninput = debounce(function () { liveState.q = q.value; applyLive(null); }, 300);
    $('#lcat').onclick = function () {
      var opts = [];
      each(cats.live || [], function (c) { opts.push({ v: c.category_id, t: c.category_name }); });
      pick('Category', opts, liveState.cat, function (v) {
        liveState.cat = v; store.set('liveCat', v); liveState.q = ''; show('live', null, null); focus($('#lcat'));
      });
    };
    $('#lsort').onclick = function () {
      pick('Sort', LSORT, liveState.sort, function (v) { liveState.sort = v; setVal('lsort', liveSortName(v)); applyLive(null); });
    };
    if (playingId) { markPlaying(); nowLine('live', currentName()); loadEpg(playingId); }
    categories('live', function (err, list) {
      if (my !== gen) return;
      if (err) return fail('#llist', err);
      if (!list.length) return fail('#llist', 'No live categories.');
      if (!catName('live', liveState.cat)) liveState.cat = list[0].category_id;
      setVal('lcat', catName('live', liveState.cat));
      items('live', liveState.cat, function (err2, arr) {
        if (my !== gen) return;
        if (err2) return fail('#llist', err2);
        liveState.all = arr;
        applyLive(r);
      });
    });
  };
  // The search box on Live TV / Movies / Series: once the library index has loaded, the query runs
  // over the whole playlist of that type (every category); until then, over the open category.
  var SEARCH_MAX = 500;
  function searchAll(q, k) {
    if (!q || !catalogReady) return null;
    var r = JSON.parse(N.search(q, k, SEARCH_MAX))[k] || { total: 0, items: [] };
    each(r.items, function (it) { it.r = rating(it.r); });
    return r;
  }
  function foundText(all, noun) {
    return num(all.total) + (all.total === 1 ? ' match' : ' matches') + ' in all ' + noun + (all.total > all.items.length ? ', showing the first ' + num(all.items.length) : '');
  }

  function applyLive(r) {
    var q = liveState.q.trim().toLowerCase(), out = [], all = searchAll(q, 'l');
    if (all) out = all.items;
    else each(liveState.all, function (it) { if (!q || it.n.toLowerCase().indexOf(q) >= 0) out.push(it); });
    if (liveState.sort !== 'src') {
      out.sort(function (x, y) { return x.n.localeCompare(y.n); });
      if (liveState.sort === 'za') out.reverse();
    }
    liveState.list = out;
    var el = $('#llist');
    liveList = { el: el, shown: 0 };
    el.innerHTML = out.length ? '' : '<div class="spin">No channels match.</div>';
    growLive(Math.max(CHUNK, r && r.idx > 0 ? r.idx : 0));
    $('#lcount').textContent = all ? foundText(all, 'channels') : num(out.length) + ' of ' + num(liveState.all.length) + ' channels';
    markPlaying();
    settle(r);
  }
  function growLive(upTo) {
    if (!liveList || !document.body.contains(liveList.el)) return;
    var l = liveState.list, end = Math.min(l.length, upTo), h = '', cname = catName('live', liveState.cat);
    for (var i = liveList.shown; i < end; i++) {
      var it = l[i];
      h += '<div class="chrow"><div class="f ch" tabindex="-1" data-act="ch" data-i="' + i + '" data-id="' + it.id + '">' +
        '<span class="logo">' + (it.i ? '<img src="' + esc(it.i) + '" onerror="this.style.display=\'none\'">' : '') + '</span>' +
        '<span class="tx"><div class="nm" dir="auto">' + esc(it.n) + '</div><div class="sb">Ch ' + (it.num || i + 1) + ' (#' + it.id + ') · ' + esc(catName('live', it.c) || cname) + '</div></span></div>' +
        '<button class="f star' + (has(favs, it) >= 0 ? ' on' : '') + '" data-act="lfav" data-i="' + i + '">' + ic('star', has(favs, it) >= 0 ? 'fill' : '') + '</button></div>';
    }
    if (h) liveList.el.insertAdjacentHTML('beforeend', h);
    liveList.shown = end;
  }
  ACTS.ch = function (el, i) {
    var it = liveState.list[i];
    if (it.id === playingId) { N.fullscreen(); return; }
    playLive(liveState.list, i, false);
  };
  ACTS.lfav = function (el, i) {
    var on = toggle('favs', liveState.list[i]);
    el.className = 'f star' + (on ? ' on' : '');
    el.innerHTML = ic('star', on ? 'fill' : '');
    toast(on ? 'Added to favorites' : 'Removed from favorites');
  };
  function playLive(list, i, full) {
    var it = list[i];
    zap = { list: list, i: i };
    playingId = it.id;
    nowPlaying = null;
    N.play(JSON.stringify({ live: true, full: !!full, items: [{ url: liveUrl(it.id), id: 'l' + it.id, title: it.n }] }));
    markPlaying();
    if (cur.v === 'live') {
      paneState('Connecting', it.n, 'Starting the stream…');
      nowLine('', it.n);
      loadEpg(it.id);
    }
  }
  function currentName() { var it = zap.list[zap.i]; return it ? it.n : ''; }
  function markPlaying() {
    each(main.querySelectorAll('.ch.playing'), function (el) { el.classList.remove('playing'); });
    var el = playingId && $('.ch[data-id="' + playingId + '"]', main);
    if (el) el.classList.add('playing');
    setHole(!!playingId);
  }
  // While a channel plays, the preview box is see-through onto the native video under the page.
  function setHole(on) {
    var rp = $('.rp', main);
    if (rp) rp.classList.toggle('holed', on);
  }
  function leaveLive() {
    N.stop();
    N.clearPane();
    playingId = 0;
    liveList = null;
  }
  function paneIdle() {
    paneState('Idle', 'Pick a channel.', 'Choose from the list, or change category.');
  }
  function paneState(st, big, p) {
    var el = $('#panein');
    if (el) el.innerHTML = ic('tv') + '<div class="st"><i></i>' + esc(st.toUpperCase()) + '</div><div class="big">' + esc(big) + '</div><div class="p">' + esc(p) + '</div>';
  }
  function nowLine(state, text) {
    var el = $('#lnow');
    if (el) el.innerHTML = '<span class="pill' + (state === 'live' ? ' live' : '') + '">' + (state === 'live' ? 'LIVE' : state ? state.toUpperCase() : 'OFF') + '</span><span class="t">' + esc(text || '-') + '</span>';
  }
  // Short guide per channel, kept for 2 minutes; shared by the side panel and the fullscreen info.
  var epgCache = {};
  function fetchEpg(id, cb) {
    var c = epgCache[id];
    if (c && Date.now() - c.t < 120000) return cb(c.l);
    api('get_short_epg', '&stream_id=' + id + '&limit=6', function (err, d) {
      var l = (!err && d && d.epg_listings) || [];
      epgCache[id] = { t: Date.now(), l: l };
      cb(l);
    });
  }
  function loadEpg(id) {
    var my = gen, box = $('#lepg');
    if (!box) return;
    box.innerHTML = '<div class="muted">Loading guide…</div>';
    fetchEpg(id, function (l) {
      if (my !== gen || id !== playingId) return;
      if (!l.length) { box.innerHTML = '<div class="muted">No guide data for this channel.</div>'; return; }
      var now = Date.now() / 1000, h = '';
      each(l, function (p, i) {
        var s = +p.start_timestamp, e = +p.stop_timestamp, on = s <= now && now < e;
        h += '<div class="prg' + (on ? ' now' : '') + '"><span class="tm">' + clock(new Date(s * 1000)) + ' – ' + clock(new Date(e * 1000)) +
          '</span><span class="ti">' + esc(b64(p.title)) + '</span></div>';
        if (i === 0 && p.description) h += '<div class="prg-desc">' + esc(b64(p.description)) + '</div>';
      });
      box.innerHTML = h;
    });
  }

  // Movies and Series: category, search and sort over a poster grid.
  var gridState = { vod: { cat: store.get('vodCat', null), q: '', sort: 'def', all: [] }, series: { cat: store.get('seriesCat', null), q: '', sort: 'def', all: [] } };
  var GSORT = [{ v: 'def', t: 'Default' }, { v: 'new', t: 'Recently added' }, { v: 'az', t: 'A → Z' }, { v: 'rate', t: 'Rating' }];
  function sortName(list, v) { for (var i = 0; i < list.length; i++) if (list[i].v === v) return list[i].t; return ''; }

  var keepCat = false; // set when the user picked a category, so it is not replaced below
  function catalogView(kind, r) {
    var st = gridState[kind], my = gen, title = kind === 'vod' ? 'Movies' : 'Series', noun = kind === 'vod' ? 'movies' : 'series';
    var total = kind === 'vod' ? counts.m : counts.s;
    // "Continue watching" comes first and opens by default whenever it has something in it.
    var hasCw = cwItems(LIST[kind][1]).length > 0;
    if (!r && !keepCat && hasCw) st.cat = CW;
    keepCat = false;
    if (st.cat === CW && !hasCw) st.cat = store.get(kind + 'Cat', null);
    main.innerHTML = head(title, (total ? '<b>' + num(total) + '</b> in catalogue<i class="sep"></i>' : '') + '<span id="gcatname">…</span>') +
      '<div class="filters">' + selBtn('gcat', 'Category', '…', 'w1') + searchBox('gq', 'Search all ' + noun + '…') +
      selBtn('gsort', 'Sort', sortName(GSORT, st.sort)) + '</div><div class="count" id="gcount">&nbsp;</div><div class="grid" id="grid"><div class="spin">Loading…</div></div>';
    var q = $('#gq');
    q.value = st.q;
    q.oninput = debounce(function () { st.q = q.value; applyGrid(kind, null); }, 350);
    $('#gcat').onclick = function () {
      var opts = hasCw ? [{ v: CW, t: catName(kind, CW) }] : [];
      each(cats[kind] || [], function (c) { opts.push({ v: c.category_id, t: c.category_name }); });
      pick('Category', opts, st.cat, function (v) {
        st.cat = v;
        if (v !== CW) store.set(kind + 'Cat', v);
        st.q = '';
        keepCat = true;
        show(cur.v, null, null);
        focus($('#gcat'));
      });
    };
    $('#gsort').onclick = function () {
      pick('Sort', GSORT, st.sort, function (v) { st.sort = v; setVal('gsort', sortName(GSORT, v)); applyGrid(kind, null); });
    };
    categories(kind, function (err, list) {
      if (my !== gen) return;
      if (err) return fail('#grid', err);
      if (!list.length) return fail('#grid', 'No categories.');
      if (!catName(kind, st.cat)) st.cat = list[0].category_id;
      setVal('gcat', catName(kind, st.cat));
      $('#gcatname').textContent = catName(kind, st.cat);
      items(kind, st.cat, function (err2, arr) {
        if (my !== gen) return;
        if (err2) return fail('#grid', err2);
        st.all = arr;
        applyGrid(kind, r);
      });
    });
    if (!r) settle(null);
  }
  function applyGrid(kind, r) {
    var st = gridState[kind], q = st.q.trim().toLowerCase(), out = [], all = searchAll(q, LIST[kind][1]);
    if (all) out = all.items;
    else each(st.all, function (it) { if (!q || it.n.toLowerCase().indexOf(q) >= 0) out.push(it); });
    if (st.sort === 'new') out.sort(function (a, b) { return b.t - a.t; });
    if (st.sort === 'az') out.sort(function (a, b) { return a.n.localeCompare(b.n); });
    if (st.sort === 'rate') out.sort(function (a, b) { return (parseFloat(b.r) || 0) - (parseFloat(a.r) || 0); });
    st.list = out;
    $('#gcount').textContent = all ? foundText(all, kind === 'vod' ? 'movies' : 'series') : num(out.length) + ' of ' + num(st.all.length) + (kind === 'vod' ? ' movies' : ' series');
    var g = $('#grid');
    // Search results come from every category, so each card shows its own category.
    var isCw = st.cat === CW && !all;
    mountGrid(g, out, 'g' + kind, { sub: kind === 'vod' && !isCw && !all ? catName('vod', st.cat) : null, cw: isCw }, r ? r.idx : 0);
    if (!out.length) g.innerHTML = '<div class="spin">Nothing matches.</div>';
    settle(r);
  }
  VIEWS.movies = function (a, r) { catalogView('vod', r); };
  VIEWS.series = function (a, r) { catalogView('series', r); };
  ACTS.gvod = function (el, i) { go('movie', gridState.vod.list[i]); };
  ACTS.gseries = function (el, i) { go('show', gridState.series.list[i]); };

  // Movie detail.
  VIEWS.movie = function (it, r) {
    var my = gen;
    detailFrame(it, '');
    movieButtons(it);
    settle(r);
    api('get_vod_info', '&vod_id=' + it.id, function (err, d) {
      if (my !== gen) return;
      if (err || !d || !d.info) return;
      var inf = d.info, md = d.movie_data || {};
      if (md.container_extension) it.e = md.container_extension;
      fillDetail(inf, [inf.releasedate ? String(inf.releasedate).slice(0, 4) : '', inf.duration || '', inf.genre || '']);
    });
  };
  function movieButtons(it) {
    var pr = progress['m' + it.id], el = $('#dacts');
    if (!el) return;
    el.innerHTML = (pr ? '<button class="f btn primary af" data-act="mplay" data-i="1">' + ic('play') + 'Resume ' + hms(pr.p) + '</button>' +
      '<button class="f btn" data-act="mplay" data-i="0">' + ic('refresh') + 'From start</button>'
      : '<button class="f btn primary af" data-act="mplay" data-i="0">' + ic('play') + 'Play</button>') + dlButton('m' + it.id) + listButtons(it);
  }
  ACTS.mplay = function (el, resume) {
    var it = cur.a, pr = progress['m' + it.id];
    nowPlaying = { item: it };
    touchCw(it);
    N.play(JSON.stringify({
      full: true, index: 0, start: resume && pr ? pr.p : 0,
      items: [{ url: localFile('m' + it.id) || movieUrl(it.id, it.e), id: 'm' + it.id, title: it.n }]
    }));
  };
  function listButtons(it) {
    var f = has(favs, it) >= 0, w = has(later, it) >= 0;
    return '<button class="f btn' + (f ? ' on' : '') + '" data-act="dfav">' + ic('star', f ? 'fill' : '') + 'Favorite</button>' +
      '<button class="f btn' + (w ? ' on' : '') + '" data-act="dlater">' + ic('bookmark', w ? 'fill' : '') + 'Watch later</button>';
  }
  ACTS.dfav = function (el) {
    var on = toggle('favs', cur.a);
    el.className = 'f btn' + (on ? ' on' : '');
    el.innerHTML = ic('star', on ? 'fill' : '') + 'Favorite';
  };
  ACTS.dlater = function (el) {
    var on = toggle('later', cur.a);
    el.className = 'f btn' + (on ? ' on' : '');
    el.innerHTML = ic('bookmark', on ? 'fill' : '') + 'Watch later';
  };
  function detailFrame(it, extra) {
    main.innerHTML = '<div class="detail"><div class="backdrop" id="dback"></div><div class="dwrap">' +
      '<div class="dposter"><div class="poster">' + (it.i ? '<img src="' + esc(img(it.i, 500)) + '" onerror="this.style.display=\'none\'">' : '') + '</div></div>' +
      '<div class="dinfo"><h1 dir="auto">' + esc(it.n) + '</h1><div class="dmeta" id="dmeta">' + (it.r ? '<span>' + ic('star', 'fill') + ' ' + it.r + '</span>' : '') + '</div>' +
      '<div class="dacts" id="dacts"></div><div class="plot" id="dplot" dir="auto"></div><div class="facts" id="dfacts"></div></div></div></div>' + extra;
  }
  function fillDetail(inf, meta) {
    var m = $('#dmeta');
    if (m) {
      var h = m.innerHTML;
      each(meta, function (x) { if (x) h += '<span>' + esc(x) + '</span>'; });
      m.innerHTML = h;
    }
    if ($('#dplot')) $('#dplot').textContent = inf.plot || inf.description || '';
    var f = '';
    if (inf.cast) f += '<div><b>Cast</b> ' + esc(inf.cast) + '</div>';
    if (inf.director) f += '<div><b>Director</b> ' + esc(inf.director) + '</div>';
    if ($('#dfacts')) $('#dfacts').innerHTML = f;
    var bd = isArr(inf.backdrop_path) ? inf.backdrop_path[0] : inf.backdrop_path;
    if (bd && $('#dback')) $('#dback').innerHTML = '<img src="' + esc(img(bd, 780)) + '" onerror="this.style.display=\'none\'">';
  }

  // Series detail: seasons and episodes.
  var showState = { seasons: [], eps: {}, season: null };
  VIEWS.show = function (it, r) {
    var my = gen;
    detailFrame(it, '<div class="seasons" id="seasons"></div><div id="eps"><div class="spin">Loading episodes…</div></div>');
    $('#dacts').innerHTML = seriesActs(it);
    settle(r && r.idx < 3 ? r : null);
    api('get_series_info', '&series_id=' + it.id, function (err, d) {
      if (my !== gen) return;
      if (err || !d) return fail('#eps', err || 'No episodes.');
      var inf = d.info || {}, eps = d.episodes || {}, seasons = [], map = {};
      if (isArr(eps)) each(eps, function (l, i) { map[String(i + 1)] = l; }); else map = eps;
      for (var s in map) if (map.hasOwnProperty(s) && isArr(map[s]) && map[s].length) seasons.push(s);
      seasons.sort(function (a, b) { return a - b; });
      showState = { seasons: seasons, eps: map, season: null };
      var le = lastEp[it.id];
      showState.season = le && map[le.s] ? le.s : seasons[0];
      fillDetail(inf, [String(inf.releaseDate || inf.release_date || '').slice(0, 4), seasons.length + (seasons.length === 1 ? ' season' : ' seasons'), inf.genre || '']);
      var acts = $('#dacts'), hadFocus = acts.contains(document.activeElement);
      acts.innerHTML = seriesActs(it);
      if (hadFocus) focus($('.af', main));
      renderSeasons();
      if (r && r.idx >= 3) settle(r);
    });
  };
  function epById(id) {
    var found = null;
    each(showState.seasons, function (s) { each(showState.eps[s], function (e) { if (+e.id === +id) found = e; }); });
    return found;
  }
  function renderSeasons() {
    var h = '';
    each(showState.seasons, function (s) {
      h += '<button class="f chip' + (s === showState.season ? ' on' : '') + '" data-act="season" data-s="' + esc(s) + '">Season ' + esc(s) + '</button>';
    });
    if (DLS) h += '<button class="f chip dlall" data-act="dlseason">' + ic('download') + 'Download season ' + esc(showState.season) + '</button>';
    $('#seasons').innerHTML = h;
    var le = lastEp[cur.a.id], out = '';
    each(showState.eps[showState.season] || [], function (e, i) {
      var inf = e.info || {}, pr = progress['e' + e.id];
      out += '<div class="f ep' + (le && +le.id === +e.id ? ' last' : '') + '" tabindex="-1" data-act="ep" data-i="' + i + '">' +
        '<div class="th">' + (inf.movie_image ? '<img src="' + esc(img(inf.movie_image, 300)) + '" onerror="this.style.display=\'none\'">' : '') +
        (pr && pr.d ? '<span class="prog"><i style="width:' + Math.round(100 * pr.p / pr.d) + '%"></i></span>' : '') + '</div>' +
        '<div><div class="no">EPISODE ' + esc(e.episode_num) + (inf.duration ? ' · ' + esc(inf.duration) : '') + '</div>' +
        '<div class="nm" dir="auto">' + esc(e.title || 'Episode ' + e.episode_num) + '</div><div class="pl" dir="auto">' + esc(inf.plot || '') + '</div></div>' + epDlButton(e, i) + '</div>';
    });
    $('#eps').innerHTML = out || '<div class="spin">No episodes in this season.</div>';
  }
  ACTS.season = function (el) {
    showState.season = el.getAttribute('data-s');
    renderSeasons();
    focus($('.chip.on', main));
  };
  ACTS.ep = function (el, i) { playEpisode(showState.season, showState.eps[showState.season][i]); };
  // Series buttons: Play/Continue, then (when an episode was watched) Go to episode, then the lists.
  function seriesActs(it) {
    var le = lastEp[it.id], e = le && epById(le.id);
    var h = '<button class="f btn primary af" data-act="splay">' + ic('play') +
      (le && e ? 'Continue S' + le.s + ' E' + e.episode_num : 'Play') + '</button>';
    if (le && e) h += '<button class="f btn" data-act="goep">' + ic('down') + 'Go to episode</button>';
    return h + listButtons(it);
  }
  // Jump to the episode being watched: open its season and put the cursor on it (no playback).
  ACTS.goep = function () {
    var le = lastEp[cur.a.id];
    if (!le || !showState.eps[le.s]) return;
    showState.season = le.s;
    renderSeasons();
    focus($('.ep.last', main));
  };
  ACTS.splay = function () {
    var le = lastEp[cur.a.id], e = le && epById(le.id);
    if (e) return playEpisode(le.s, e);
    var s = showState.seasons[0];
    if (s) playEpisode(s, showState.eps[s][0]);
  };
  // The whole series goes to the player as one playlist, season after season, so the on-screen
  // and remote previous/next buttons, and the automatic next episode, cross season boundaries.
  function playEpisode(season, e) {
    var it = cur.a, pr = progress['e' + e.id], list = [], eps = [], index = 0;
    each(showState.seasons, function (s) {
      each(showState.eps[s], function (x) {
        if (+x.id === +e.id) index = list.length;
        eps.push({ s: s, id: x.id, num: x.episode_num });
        list.push({
          url: localFile('e' + x.id) || episodeUrl(x.id, x.container_extension), id: 'e' + x.id,
          title: it.n + '\nSeason ' + s + ' · Episode ' + x.episode_num
        });
      });
    });
    nowPlaying = { item: it, eps: eps };
    touchCw(it);
    setLastEp(it.id, eps[index]);
    N.play(JSON.stringify({ full: true, index: index, start: pr ? pr.p : 0, items: list }));
  }
  function setLastEp(seriesId, ep) {
    lastEp[seriesId] = ep;
    store.set('lastEp', lastEp);
  }

  // ---------- downloads (Windows app only) ----------
  // The Windows app keeps the list (Downloads.cs) and reports every change to App.onDownloads.
  // Keys are the resume-point keys ('m<id>' movie, 'e<id>' episode), so a downloaded file keeps
  // the same "continue watching" place as the stream.

  var dls = {};
  function setDownloads(list) { dls = {}; each(list || [], function (d) { dls[d.key] = d; }); }
  if (DLS) { try { setDownloads(JSON.parse(N.downloads())); } catch (e) { dls = {}; } }
  function localFile(key) { var d = dls[key]; return d && d.status === 'done' ? d.file : null; }
  function pct(d) { return d.size > 0 ? Math.min(100, Math.floor(100 * d.done / d.size)) : 0; }
  function size(n) { return n >= 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : Math.max(1, Math.round(n / 1048576)) + ' MB'; }
  function dlText(d) {
    if (d.status === 'done') return 'Downloaded · ' + size(d.size);
    if (d.status === 'downloading') return pct(d) + '% · ' + size(d.done) + (d.size ? ' of ' + size(d.size) : '') + (d.speed ? ' · ' + d.speed.toFixed(1) + ' Mbps' : '');
    if (d.status === 'error') return 'Failed: ' + (d.error || 'unknown error');
    return 'Queued' + (d.done ? ' · ' + size(d.done) + ' so far' : '') + ' (downloads pause while you stream)';
  }
  function dlButton(key) {
    if (!DLS) return '';
    var d = dls[key];
    var t = !d ? 'Download' : d.status === 'done' ? 'Downloaded' : d.status === 'error' ? 'Retry download'
      : d.status === 'downloading' ? 'Downloading ' + pct(d) + '%' : 'Queued';
    return '<button class="f btn' + (d && d.status === 'done' ? ' on' : '') + '" data-act="dl" data-k="' + key + '">' +
      ic(d && d.status === 'done' ? 'check' : 'download') + esc(t) + '</button>';
  }
  function epDlButton(e, i) {
    if (!DLS) return '';
    var d = dls['e' + e.id], cls = !d ? '' : d.status === 'done' ? ' done' : d.status === 'error' ? ' err' : ' busy';
    var label = !d ? '' : d.status === 'done' ? '' : d.status === 'error' ? 'Retry' : d.status === 'downloading' ? pct(d) + '%' : 'Queued';
    return '<button class="f epdl' + cls + '" data-act="dlep" data-i="' + i + '" data-k="e' + e.id + '" title="Download">' +
      ic(d && d.status === 'done' ? 'check' : d && d.status === 'error' ? 'x' : 'download') + (label ? '<span>' + label + '</span>' : '') + '</button>';
  }
  function pad2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  // Name for folders and files on disk: without the "AR-SUBS:" tag, and no "/" (it would nest folders).
  function diskName(n) { return n.replace(/^AR-SUBS\s*:\s*/i, '').replace(/\//g, ' '); }
  function queueMovie(it) {
    N.download(JSON.stringify({
      key: 'm' + it.id, url: movieUrl(it.id, it.e), title: it.n, sub: 'Movie', poster: it.i, ext: it.e || 'mp4',
      folder: 'Movies/' + diskName(it.n), name: diskName(it.n), meta: JSON.stringify({ item: slim(it) })
    }));
  }
  function queueEpisode(it, season, e) {
    var code = 'S' + pad2(season) + 'E' + pad2(e.episode_num);
    N.download(JSON.stringify({
      key: 'e' + e.id, url: episodeUrl(e.id, e.container_extension), title: it.n, sub: code + (e.title ? ' · ' + e.title : ''),
      poster: it.i, ext: e.container_extension || 'mp4', folder: 'Series/' + diskName(it.n) + '/Season ' + (+season), name: code + (e.title ? ' - ' + e.title : ''),
      meta: JSON.stringify({ item: slim(it), ep: { s: season, id: e.id, num: e.episode_num } })
    }));
  }
  // A finished or running download opens the Downloads page; a failed one tries again.
  function dlOpen(key, start) {
    var d = dls[key];
    if (!d) return start();
    if (d.status === 'error') return N.dlRetry(key);
    go('downloads');
  }
  ACTS.dl = function (el) { dlOpen(el.getAttribute('data-k'), function () { queueMovie(cur.a); toast('Download started'); }); };
  ACTS.dlep = function (el, i) {
    var e = showState.eps[showState.season][i];
    dlOpen('e' + e.id, function () { queueEpisode(cur.a, showState.season, e); toast('Download started'); });
  };
  ACTS.dlseason = function () {
    var n = 0;
    each(showState.eps[showState.season] || [], function (e) {
      var d = dls['e' + e.id];
      if (!d) { queueEpisode(cur.a, showState.season, e); n++; }
      else if (d.status === 'error') { N.dlRetry('e' + e.id); n++; }
    });
    toast(n ? 'Queued ' + n + (n === 1 ? ' episode' : ' episodes') + ' of season ' + showState.season : 'This season is already downloaded or queued');
  };

  VIEWS.downloads = function (a, r) {
    main.innerHTML = head('Downloads', 'Saved on this PC in D:\\. Downloads pause while you stream (your account allows one connection) and continue afterwards.') +
      '<div class="dlbar"><button class="f btn af" data-act="dlfolder">' + ic('folder') + 'Open folder</button></div><div id="dllist"></div>';
    renderDownloads();
    settle(r);
  };
  function renderDownloads() {
    var box = $('#dllist');
    if (!box) return;
    var list = [], h = '';
    for (var k in dls) if (dls.hasOwnProperty(k)) list.push(dls[k]);
    list.sort(function (x, y) { return y.added - x.added; });
    each(list, function (d) {
      var done = d.status === 'done';
      h += '<div class="f ep dlrow" tabindex="-1" data-act="dlplay" data-k="' + esc(d.key) + '">' +
        '<div class="th">' + (d.poster ? '<img src="' + esc(img(d.poster, 300)) + '" onerror="this.style.display=\'none\'">' : '') + '</div>' +
        '<div class="dtx"><div class="no">' + esc(d.sub) + '</div><div class="nm" dir="auto">' + esc(d.title) + '</div>' +
        '<div class="st">' + esc(dlText(d)) + '</div>' +
        (done ? '' : '<div class="bar"><i style="width:' + pct(d) + '%"></i></div>') + '</div><div class="acts">' +
        (done ? '<button class="f btn" data-act="dlplay" data-k="' + esc(d.key) + '">' + ic('play') + 'Play</button>' +
          '<button class="f btn danger" data-act="dldel" data-k="' + esc(d.key) + '">' + ic('trash') + 'Delete</button>'
          : (d.status === 'error' ? '<button class="f btn" data-act="dlretry" data-k="' + esc(d.key) + '">' + ic('refresh') + 'Retry</button>' : '') +
            '<button class="f btn danger" data-act="dlcancel" data-k="' + esc(d.key) + '">' + ic('x') + 'Cancel</button>') +
        '</div></div>';
    });
    box.innerHTML = h || '<div class="panel empty">Nothing downloaded yet. Use Download on a movie, or on an episode or a whole season of a series.</div>';
  }
  ACTS.dlfolder = function () { N.openDownloads(); };
  ACTS.dldel = function (el) { N.dlDelete(el.getAttribute('data-k')); toast('Deleted from this PC'); };
  ACTS.dlcancel = function (el) { N.dlCancel(el.getAttribute('data-k')); };
  ACTS.dlretry = function (el) { N.dlRetry(el.getAttribute('data-k')); };
  // Play a downloaded file, keeping its resume point and continue-watching entry.
  ACTS.dlplay = function (el) {
    var d = dls[el.getAttribute('data-k')], meta;
    if (!d || d.status !== 'done') return;
    try { meta = JSON.parse(d.meta || '{}'); } catch (e) { meta = {}; }
    var pr = progress[d.key], title = d.title;
    if (meta.item) touchCw(meta.item);
    if (meta.ep) {
      nowPlaying = { item: meta.item, eps: [meta.ep] };
      title += '\nSeason ' + meta.ep.s + ' · Episode ' + meta.ep.num;
    } else {
      nowPlaying = { item: meta.item || { k: 'm', id: 0 } };
    }
    N.play(JSON.stringify({ full: true, index: 0, start: pr ? pr.p : 0, items: [{ url: d.file, id: d.key, title: title }] }));
  };
  // Keep what is on screen in step with the download list, without moving the cursor.
  function refreshDownloads() {
    var a = document.activeElement, key = a && a.getAttribute ? a.getAttribute('data-k') : null, act = a && a.getAttribute ? a.getAttribute('data-act') : null;
    if (cur.v === 'downloads') {
      renderDownloads();
      var back = key && $('[data-act="' + act + '"][data-k="' + key + '"]', main);
      if (back) focus(back); else if (!main.contains(document.activeElement) && !side.contains(document.activeElement)) focus(defaultFocus());
    }
    if (cur.v === 'movie') {
      var b = $('[data-act="dl"]', main);
      if (b) { var had = b === a; b.outerHTML = dlButton(b.getAttribute('data-k')); if (had) focus($('[data-act="dl"]', main)); }
    }
    if (cur.v === 'show') {
      each(main.querySelectorAll('.epdl'), function (el) {
        var i = +el.getAttribute('data-i'), e = showState.eps[showState.season] && showState.eps[showState.season][i];
        if (!e) return;
        var had = el === a, tmp = document.createElement('div');
        tmp.innerHTML = epDlButton(e, i);
        el.parentNode.replaceChild(tmp.firstChild, el);
        if (had) focus($('.epdl[data-i="' + i + '"]', main));
      });
    }
  }

  // Search across everything, via the native catalog index.
  var srch = { q: '', f: 'lms', res: {} };
  VIEWS.search = function (a, r) {
    main.innerHTML = head('Find anything', 'Channels, movies, and series from your playlist.') +
      searchBox('sq', 'Search channels, movies, series…', 'bigsearch') +
      '<div class="chips" id="schips"></div><div id="sres"></div>';
    var q = $('#sq');
    q.value = srch.q;
    q.oninput = debounce(function () { srch.q = q.value; runSearch(); }, 450);
    q.onenter = function () { srch.q = q.value; runSearch(); };
    q.className += ' af';
    runSearch();
    settle(r);
  };
  function runSearch() {
    var chips = [['lms', 'All'], ['l', 'Live TV'], ['m', 'Movies'], ['s', 'Series']], h = '';
    each(chips, function (c) { h += '<button class="f chip' + (srch.f === c[0] ? ' on' : '') + '" data-act="sfilter" data-f="' + c[0] + '">' + c[1] + '</button>'; });
    $('#schips').innerHTML = h;
    var box = $('#sres'), q = srch.q.trim();
    if (!q) { box.innerHTML = '<div class="hint">Search the active playlist.<small>Type with the on-screen keyboard, then use the arrows to pick a result.</small></div>'; return; }
    if (!catalogReady) { box.innerHTML = '<div class="hint">Your library is still loading…<small>Search works as soon as it is ready.</small></div>'; return; }
    srch.res = JSON.parse(N.search(q, srch.f, srch.f.length > 1 ? 10 : 60));
    var out = '', names = { l: 'Live TV', m: 'Movies', s: 'Series' };
    each(['l', 'm', 's'], function (k) {
      var r = srch.res[k];
      if (!r || !r.items.length) return;
      out += '<div class="sres-h"><h2>' + names[k] + '</h2><span>' + num(r.total) + (r.total > r.items.length ? ' matches, showing ' + r.items.length : ' matches') + '</span></div><div class="grid">';
      each(r.items, function (it, i) { out += card(it, i, 's' + k, { sub: '' }); });
      out += '</div>';
    });
    box.innerHTML = out || '<div class="hint">No matches for “' + esc(q) + '”.</div>';
  }
  ACTS.sfilter = function (el) { srch.f = el.getAttribute('data-f'); runSearch(); focus($('.chip.on', main)); };
  ACTS.sl = function (el, i) { open(srch.res.l.items[i], srch.res.l.items); };
  ACTS.sm = function (el, i) { open(srch.res.m.items[i]); };
  ACTS.ss = function (el, i) { open(srch.res.s.items[i]); };

  // Favorites, Watch later and Recently added share one layout: chips over a grid.
  var pageFilter = { favorites: '', later: '', recent: '' };
  var pageItems = [];
  function listPage(v, title, sub, all, kinds, emptyText, r) {
    var f = pageFilter[v], h = '<div class="chips">';
    var names = { '': 'All', l: 'Live TV', m: 'Movies', s: 'Series' };
    each([''].concat(kinds), function (k) {
      var n = 0;
      each(all, function (it) { if (!k || it.k === k) n++; });
      h += '<button class="f chip' + (f === k ? ' on' : '') + '" data-act="pfilter" data-f="' + k + '">' + names[k] + '<span class="n">' + n + '</span></button>';
    });
    pageItems = [];
    each(all, function (it) { if (!f || it.k === f) pageItems.push(it); });
    main.innerHTML = head(title, sub) + h + '</div>' +
      (pageItems.length ? '<div class="grid" id="grid"></div>' : '<div class="panel empty">' + emptyText + '</div>');
    if (pageItems.length) mountGrid($('#grid'), pageItems, 'page', { badge: v === 'recent', sub: '' }, r ? r.idx : 0);
    settle(r);
  }
  ACTS.pfilter = function (el) { pageFilter[cur.v] = el.getAttribute('data-f'); show(cur.v, null, null); focus($('.chip.on', main)); };
  ACTS.page = function (el, i) {
    var lives = [];
    each(pageItems, function (x) { if (x.k === 'l') lives.push(x); });
    open(pageItems[i], lives);
  };
  VIEWS.favorites = function (a, r) {
    listPage('favorites', 'Favorites', 'Every starred channel, movie, and series.', favs, ['l', 'm', 's'],
      'No favorites yet. Star a channel, movie, or series to see it here.', r);
  };
  VIEWS.later = function (a, r) {
    listPage('later', 'Watch later', 'Movies and series you saved for later.', later, ['m', 's'],
      'Nothing saved yet. Use “Watch later” on a movie or series.', r);
  };
  VIEWS.recent = function (a, r) {
    if (!catalogReady) {
      main.innerHTML = head('Recently added', 'The newest movies and series on your playlist.') + '<div class="panel empty">Your library is still loading…</div>';
      return settle(r);
    }
    listPage('recent', 'Recently added', 'The newest movies and series on your playlist.', JSON.parse(N.recent('ms', 100)), ['m', 's'], 'Nothing yet.', r);
  };

  // Settings.
  VIEWS.settings = function (a, r) {
    var exp = info && +info.exp_date ? date(+info.exp_date) : 'unknown';
    main.innerHTML = head('Settings', 'Playlist, playback, and the app itself.') + '<div class="set">' +
      '<h2>Playlist</h2><div class="panel">' +
      (acct ? '<div class="acct"><span class="xt">XT</span><div style="flex:1"><div class="n">' + esc(acct.name) + '</div>' +
        '<div class="u">' + esc(acct.server) + ' · ' + esc(acct.user) + '</div><div class="e">Expires ' + esc(exp) +
        (info ? ' · ' + esc(info.max_connections) + ' connection(s)' : '') + '</div></div></div>' : '') +
      '<button class="f btn af" data-act="refresh">' + ic('refresh') + 'Refresh library</button>' +
      '<button class="f btn" data-act="addpl">' + ic('plus') + 'Change playlist</button>' +
      '<button class="f btn danger" data-act="logout">' + ic('logout') + 'Log out</button></div>' +
      '<h2>Appearance</h2><div class="panel"><div class="setrow"><div class="l"><b>Accent color</b><small>Used everywhere: highlights, focus rings, the player and dialogs.</small></div>' +
      '<div class="swatches">' + ACCENTS.map(function (c) {
        var on = (prefs.accent || ACCENTS[0][0]).toLowerCase() === c[0];
        return '<button class="f sw' + (on ? ' on' : '') + '" data-act="accent" data-c="' + c[0] + '" title="' + c[1] + '" style="background:' + c[0] + '"></button>';
      }).join('') + '</div></div></div>' +
      (WEB ? '' : '<h2>Watching</h2><div class="panel"><div class="setrow"><div class="l"><b>Live stream format</b><small>Try HLS if live channels stutter or fail to start.</small></div>' +
      '<div class="seg"><button class="f btn' + (prefs.fmt === 'ts' ? ' on' : '') + '" data-act="fmt" data-f="ts">MPEG-TS</button>' +
      '<button class="f btn' + (prefs.fmt === 'hls' ? ' on' : '') + '" data-act="fmt" data-f="hls">HLS</button></div></div></div>') +
      '<h2>Data</h2><div class="panel">' +
      '<button class="f btn danger" data-act="clear" data-f="favs">' + ic('trash') + 'Clear favorites</button>' +
      '<button class="f btn danger" data-act="clear" data-f="later">' + ic('trash') + 'Clear watch later</button>' +
      '<button class="f btn danger" data-act="clear" data-f="cw">' + ic('trash') + 'Clear watching now</button></div>' +
      '<h2>About</h2><div class="panel">' +
      '<div class="kv"><b>yamTV</b> ' + VERSION + ' — ' + (WEB ? 'the website' : 'rebuilt for this TV') + ' from infinitel8p/Extreme-InfiniTV (GPL-3.0)</div>' +
      '<div class="kv"><b>Library</b> ' + (catalogReady ? num(counts.l) + ' channels · ' + num(counts.m) + ' movies · ' + num(counts.s) + ' series' : 'loading…') + '</div>' +
      '<div class="kv"><b>' + (WEB ? 'Browser' : 'WebView') + '</b> ' + esc(navigator.userAgent) + '</div></div></div>';
    settle(r);
  };
  ACTS.refresh = function () { cats = {}; lists = {}; loadCatalog(true); toast('Refreshing the library…'); };
  ACTS.logout = function () {
    acct = null; info = null;
    store.set('acct', null); store.set('info', null);
    cats = {}; lists = {}; catalogReady = false;
    renderSide();
    hist = [];
    show('home', null, null);
    focus($('.af', main));
  };
  ACTS.accent = function (el) {
    var c = el.getAttribute('data-c');
    prefs.accent = c;
    store.set('prefs', prefs);
    applyAccent(c);
    each(main.querySelectorAll('.sw'), function (b) { b.classList.toggle('on', b === el); });
    for (var i = 0; i < ACCENTS.length; i++) if (ACCENTS[i][0] === c) toast('Accent: ' + ACCENTS[i][1]);
  };
  ACTS.fmt = function (el) {
    prefs.fmt = el.getAttribute('data-f');
    store.set('prefs', prefs);
    each(main.querySelectorAll('[data-act="fmt"]'), function (b) { b.classList.toggle('on', b === el); });
  };
  // Settings > Data: a box listing Favorites, Watch later or Watching now, searchable by name and
  // filterable by type; OK ticks items and "Clear selected" removes only the ticked ones.
  var MGR = {
    favs: { title: 'Favorites', kinds: ['l', 'm', 's'], list: function () { return favs; } },
    later: { title: 'Watch later', kinds: ['m', 's'], list: function () { return later; } },
    cw: { title: 'Watching now', kinds: ['m', 's'], list: function () { reloadWatch(); return cwItems('m').concat(cwItems('s')); } }
  };
  var KIND_NAME = { l: 'Live TV', m: 'Movie', s: 'Series' };
  var mgr = null;
  ACTS.clear = function (el) {
    var f = el.getAttribute('data-f'), def = MGR[f];
    mgr = { f: f, all: def.list().slice(), kinds: def.kinds, q: '', kind: '', sel: {}, shown: [] };
    modal.innerHTML = '<div class="sheet mgr"><div class="h">' + esc(def.title) + '</div>' +
      searchBox('mq', 'Search by name…') + '<div class="chips" id="mchips"></div>' +
      '<div class="opts scroller" id="mlist"></div><div class="dlg-btns">' +
      '<button class="f btn" data-act="mall" id="mall">Select all</button>' +
      '<button class="f btn danger" data-act="mclear" id="mclear">Clear selected (0)</button>' +
      '<button class="f btn" data-act="mclose">Cancel</button></div></div>';
    showModal();
    modalReturn = el;
    modalCb = function () {};
    var q = $('#mq');
    q.oninput = debounce(function () { mgr.q = q.value; mgrList(); }, 250);
    mgrList();
    focus($('.mrow', modal) || $('#mclose') || q);
  };
  function mgrList() {
    var q = mgr.q.trim().toLowerCase(), chips = '', rows = '';
    each([''].concat(mgr.kinds), function (k) {
      var n = 0;
      each(mgr.all, function (it) { if (!k || it.k === k) n++; });
      chips += '<button class="f chip' + (mgr.kind === k ? ' on' : '') + '" data-act="mkind" data-f="' + k + '">' +
        (k ? KIND_NAME[k] : 'All') + '<span class="n">' + n + '</span></button>';
    });
    mgr.shown = [];
    each(mgr.all, function (it) {
      if ((mgr.kind && it.k !== mgr.kind) || (q && it.n.toLowerCase().indexOf(q) < 0)) return;
      mgr.shown.push(it);
      var key = keyOf(it);
      rows += '<div class="f mrow ' + it.k + (mgr.sel[key] ? ' on' : '') + '" tabindex="-1" data-act="mrow" data-k="' + esc(key) + '">' +
        '<span class="ck">✓</span><span class="mth">' + (it.i ? '<img src="' + esc(img(it.i, 92)) + '" onerror="this.style.display=\'none\'">' : '') +
        '</span><span class="mnm" dir="auto">' + esc(it.n) + '</span><span class="mkd">' + KIND_NAME[it.k] + '</span></div>';
    });
    $('#mchips').innerHTML = chips;
    $('#mlist').innerHTML = rows || '<div class="spin">' + (mgr.all.length ? 'Nothing matches.' : 'Nothing here yet.') + '</div>';
    mgrCount();
  }
  function mgrCount() {
    var n = 0, all = mgr.shown.length > 0;
    for (var k in mgr.sel) if (mgr.sel.hasOwnProperty(k)) n++;
    each(mgr.shown, function (it) { if (!mgr.sel[keyOf(it)]) all = false; });
    $('#mclear').textContent = 'Clear selected (' + n + ')';
    $('#mall').textContent = all ? 'Unselect all' : 'Select all';
  }
  ACTS.mrow = function (el) {
    var key = el.getAttribute('data-k');
    if (mgr.sel[key]) delete mgr.sel[key]; else mgr.sel[key] = true;
    el.classList.toggle('on', !!mgr.sel[key]);
    mgrCount();
  };
  ACTS.mkind = function (el) {
    mgr.kind = el.getAttribute('data-f');
    mgrList();
    focus($('.chip.on', modal));
  };
  ACTS.mall = function () {
    var all = true;
    each(mgr.shown, function (it) { if (!mgr.sel[keyOf(it)]) all = false; });
    each(mgr.shown, function (it) { if (all) delete mgr.sel[keyOf(it)]; else mgr.sel[keyOf(it)] = true; });
    each(modal.querySelectorAll('.mrow'), function (r) { r.classList.toggle('on', !!mgr.sel[r.getAttribute('data-k')]); });
    mgrCount();
  };
  ACTS.mclose = function () { closeModal(); };
  ACTS.mclear = function () {
    var sel = mgr.sel, n = 0;
    function keep(it) { return !sel[keyOf(it)]; }
    for (var k in sel) if (sel.hasOwnProperty(k)) n++;
    if (!n) { toast('Tick something to clear first.'); return; }
    if (mgr.f === 'favs') { favs = favs.filter(keep); store.set('favs', favs); }
    if (mgr.f === 'later') { later = later.filter(keep); store.set('later', later); }
    if (mgr.f === 'cw') {
      // Leaving "Watching now" also forgets the saved minute and, for a series, the last episode.
      reloadWatch();
      each(cw, function (it) {
        if (keep(it)) return;
        if (it.k === 'm') delete progress['m' + it.id];
        if (it.k === 's' && lastEp[it.id]) { delete progress['e' + lastEp[it.id].id]; delete lastEp[it.id]; }
      });
      cw = cw.filter(keep);
      store.set('cw', cw);
      store.set('lastEp', lastEp);
      store.set('progress', progress);
    }
    closeModal();
    toast('Removed ' + n + (n === 1 ? ' item.' : ' items.'));
  };

  function fail(sel, msg) {
    var el = $(sel);
    if (el) el.innerHTML = '<div class="spin">' + esc(msg) + '</div>';
  }
  function debounce(fn, ms) {
    var t;
    return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  // ---------- sidebar ----------

  function renderSide() {
    var h = '<div class="brand">' + LOGO + '<b>yam<span>TV</span></b></div>' +
      '<button class="f nav search-btn" data-go="search">' + ic('search') + 'Search</button>';
    each(NAV, function (n) { h += '<button class="f nav" data-go="' + n[0] + '">' + ic(n[2]) + n[1] + '</button>'; });
    h += '<div class="side-fill"></div>';
    if (acct) {
      if (info && +info.exp_date) h += '<div class="expiry">Account expires ' + date(+info.exp_date) + '</div>';
      h += '<button class="f nav provider" data-go="settings"><span class="xt">XT</span><span class="name">' + esc(acct.name) + '</span>' + ic('chev') + '</button>';
    }
    h += '<div class="side-sep"></div><button class="f nav" data-go="settings">' + ic('settings') + 'Settings</button>';
    side.innerHTML = h;
    each(side.querySelectorAll('.nav'), function (el) {
      el.classList.toggle('on', el.getAttribute('data-go') === (NAV_OF[cur.v] || cur.v));
    });
  }

  // ---------- called by MainActivity ----------

  // Back on Home asks first; Back (or the remote's Exit key) while it is open just closes it.
  function confirmExit() {
    modal.innerHTML = '<div class="sheet dlg"><div class="h">Exit yamTV?</div>' +
      '<p>Are you sure you want to exit?</p><div class="dlg-btns">' +
      '<button class="f btn primary" data-act="exitok">OK</button>' +
      '<button class="f btn" data-act="exitno">Cancel</button></div></div>';
    showModal();
    modalReturn = document.activeElement;
    modalCb = function () {};
    focus($('.btn', modal));
  }
  ACTS.exitok = function () { N.exit(); };
  ACTS.exitno = function () { closeModal(); };

  var App = window.App = {
    toast: function (msg) { toast(msg); },
    back: function () {
      if (modalCb) { closeModal(); return true; }
      if (hist.length) {
        var h = hist.pop();
        show(h.v, h.a, h.r);
        return true;
      }
      if (cur.v !== 'home') {
        show('home', null, null);
        focus($('.nav.on', side));
        return true;
      }
      if (!WEB) confirmExit(); // a website cannot close itself
      return true;
    },
    zap: function (d) {
      var l = zap.list;
      if (!l.length) return;
      var i = (zap.i + d + l.length) % l.length;
      playLive(l, i, true);
      if (cur.v === 'live' && l === liveState.list) {
        if (i >= liveList.shown) growLive(i + 10);
        var row = $('.ch[data-i="' + i + '"]', main);
        if (row) focus(row);
      }
    },
    // Fullscreen Live TV info (OK, entering fullscreen, changing channel): channel details at
    // once, then the guide when it arrives.
    liveInfo: function () {
      var it = zap.list[zap.i];
      if (!it) return;
      var cat = catName('live', it.c);
      var info = { name: it.n, line: 'Ch ' + (it.num || zap.i + 1) + (cat ? ' · ' + cat : ''), clock: clock(new Date()) };
      N.liveInfo(JSON.stringify(info));
      fetchEpg(it.id, function (l) {
        if (it.id !== playingId || !l.length) return;
        var now = Date.now() / 1000, on = null, next = null;
        each(l, function (p) {
          var s = +p.start_timestamp, e = +p.stop_timestamp;
          if (s <= now && now < e) on = p;
          else if (s >= now && (!next || s < +next.start_timestamp)) next = p;
        });
        if (!on && !next) return;
        if (on) {
          var s0 = +on.start_timestamp, e0 = +on.stop_timestamp;
          info.now = {
            time: clock(new Date(s0 * 1000)) + ' – ' + clock(new Date(e0 * 1000)),
            title: b64(on.title), pct: Math.round(100 * (now - s0) / Math.max(1, e0 - s0))
          };
        }
        if (next) info.next = { time: clock(new Date(+next.start_timestamp * 1000)), title: b64(next.title) };
        info.update = true;
        N.liveInfo(JSON.stringify(info));
      });
    },
    onFullscreen: function (on) {
      if (!on && cur.v === 'live') {
        var row = playingId && $('.ch[data-id="' + playingId + '"]', main);
        if (row) focus(row);
      }
    },
    onPlayerState: function (st) {
      if (cur.v !== 'live') return;
      if (st === 'playing') nowLine('live', currentName());
      else if (st === 'buffering') nowLine('buffering', currentName());
      else if (st === 'idle') { playingId = 0; markPlaying(); paneIdle(); nowLine('', '-'); }
    },
    onPlayerError: function (msg) {
      toast('Playback failed. ' + msg);
      if (cur.v === 'live') setHole(false);
      if (cur.v === 'live') paneState('Error', 'Can’t play this.', 'Try again, or switch the live format in Settings.');
    },
    // The player moved to another item of the playlist (next/previous episode, or on its own).
    onItem: function (index) {
      var np = nowPlaying;
      if (np && np.eps && np.eps[index]) setLastEp(np.item.id, np.eps[index]);
    },
    // Played to the very end: a finished series leaves Continue watching (a finished movie
    // leaves by itself, since its resume point is removed).
    onEnded: function () {
      if (nowPlaying && nowPlaying.eps) dropCw(nowPlaying.item);
    },
    onStopped: function () {
      if (!nowPlaying) return;
      nowPlaying = null;
      reloadWatch();
      if (cur.v === 'movie') {
        movieButtons(cur.a);
        focus($('.af', main));
      }
      if (cur.v === 'show' && $('#eps')) {
        var le = lastEp[cur.a.id];
        if (le && showState.eps[le.s]) showState.season = le.s;
        $('#dacts').innerHTML = seriesActs(cur.a);
        renderSeasons();
        focus($('.ep.last', main) || $('.af', main));
      }
    },
    onDownloads: function (list) {
      setDownloads(list);
      refreshDownloads();
    },
    onCatalog: function (ok, msg) {
      catalogReady = ok;
      if (!ok) { toast('Could not load the library: ' + msg); return; }
      counts = JSON.parse(N.counts());
      if (cur.v === 'home') {
        var e = $('.tile .eyebrow', main);
        if (e && counts.l && e.textContent.indexOf('channels') < 0) e.textContent += ' · ' + num(counts.l) + ' channels';
        homeRail();
      }
      if (cur.v === 'search') runSearch();
      if (cur.v === 'recent') show('recent', null, null);
    }
  };

  // ---------- start ----------

  function boot() {
    main = $('#main');
    side = $('#side');
    modal = $('#modal');
    renderSide();
    show('home', null, null);
    focus($('.af', main) || $('.nav.on', side));
    if (!acct) return;
    loadCatalog(false);
    api('', '', function (err, d) {
      if (err || !d || !d.user_info) { if (err) toast(err); return; }
      if (String(d.user_info.auth) !== '1') { toast('The server refused the saved login.'); return; }
      info = d.user_info;
      store.set('info', info);
      var f = document.activeElement;
      renderSide();
      if (f && side.contains(f)) focus($('.nav.on', side));
    });
  }
  boot();
})();
