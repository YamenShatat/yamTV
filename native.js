/* yamTV on the web (Chrome, Edge, Brave, Firefox, Safari on iPhone and Mac).
   The page (app.js) is the Android TV app's own; this file does in the browser what the app's
   Java side does there (MainActivity, Catalog), behind the same window.Native calls.

   - Saved state: localStorage. The library index: memory, cached for 12 h in the Cache API.
   - The IPTV API is HTTPS with CORS, so the page calls it directly (apiBase makes it https).
   - Video comes from a plain-HTTP host, which an HTTPS page may not play, so it goes through the
     yamTV relay (relay/worker.js on Cloudflare). Live TV plays as HLS: natively on Safari,
     with hls.js elsewhere. Movies stream as files; MKV only plays where the browser supports it,
     so the player offers "Open in VLC" when it cannot. */
(function () {
  'use strict';

  // The relay's address (relay/README). It can be changed in the browser: localStorage.relay.
  var RELAY = 'https://yamtv-relay.yamenshatat.workers.dev';
  var HLS_JS = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.20/dist/hls.min.js';
  var MAX_AGE_MS = 12 * 60 * 60 * 1000;
  var SAVE_EVERY_MS = 5000;

  var ls = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* full */ } }
  };
  function relayBase() { return (ls.get('relay') || RELAY).replace(/\/+$/, ''); }
  function tell(fn) {
    var args = [].slice.call(arguments, 1);
    setTimeout(function () { if (window.App && window.App[fn]) window.App[fn].apply(null, args); }, 0);
  }

  // ---------- library index (port of Catalog.java) ----------

  var items = []; // [kind, id, added, name, icon, ext, cat, rating]
  var CACHE = 'yamtv-catalog';

  function str(v) { return v == null ? '' : typeof v === 'object' ? '' : String(v); }
  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function fetchJson(url) {
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('The server replied ' + r.status);
      return r.json();
    });
  }
  function collect(list, kind, out) {
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) {
      var o = list[i];
      out.push([kind, +(kind === 's' ? o.series_id : o.stream_id) || 0, Math.max(num(o.added), num(o.last_modified)),
        str(o.name), str(kind === 's' ? o.cover : o.stream_icon), str(o.container_extension), str(o.category_id), str(o.rating)]);
    }
  }
  function cacheGet(account) {
    if (!window.caches) return Promise.resolve(null);
    return caches.open(CACHE).then(function (c) { return c.match('/catalog'); }).then(function (r) {
      return r ? r.json() : null;
    }).then(function (d) {
      return d && d.account === account && Date.now() - d.time < MAX_AGE_MS ? d.items : null;
    }).catch(function () { return null; });
  }
  function cachePut(account, list) {
    if (!window.caches) return;
    caches.open(CACHE).then(function (c) {
      return c.put('/catalog', new Response(JSON.stringify({ account: account, time: Date.now(), items: list })));
    }).catch(function () { /* no room: it is only a cache */ });
  }
  function loadCatalog(api, account, force) {
    api = apiBase(api.split('/player_api.php')[0]) + '/player_api.php' + api.split('/player_api.php')[1];
    (force ? Promise.resolve(null) : cacheGet(account)).then(function (cached) {
      if (cached) return cached;
      var all = [];
      // One list at a time: the movie and series lists are tens of megabytes each.
      return fetchJson(api + '&action=get_live_streams').then(function (d) { collect(d, 'l', all); return fetchJson(api + '&action=get_vod_streams'); })
        .then(function (d) { collect(d, 'm', all); return fetchJson(api + '&action=get_series'); })
        .then(function (d) { collect(d, 's', all); cachePut(account, all); return all; });
    }).then(function (list) {
      items = list;
      tell('onCatalog', true, '');
    }).catch(function (e) {
      tell('onCatalog', false, (e && e.message) || String(e));
    });
  }
  function json(it) { return { k: it[0], id: it[1], n: it[3], i: it[4], e: it[5], c: it[6], r: it[7] }; }
  function search(query, kinds, limit) {
    var q = String(query).trim().toLowerCase(), out = {};
    for (var j = 0; j < kinds.length; j++) {
      var k = kinds.charAt(j), first = [], rest = [], total = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it[0] !== k) continue;
        var at = it[3].toLowerCase().indexOf(q);
        if (at < 0) continue;
        total++;
        if (at === 0) { if (first.length < limit) first.push(it); } else if (rest.length < limit) rest.push(it);
      }
      out[k] = { total: total, items: first.concat(rest).slice(0, limit).map(json) };
    }
    return JSON.stringify(out);
  }
  function recent(kinds, limit) {
    return JSON.stringify(items.filter(function (it) { return kinds.indexOf(it[0]) >= 0; })
      .sort(function (a, b) { return b[2] - a[2]; }).slice(0, limit).map(json));
  }
  function counts() {
    var c = { l: 0, m: 0, s: 0 };
    for (var i = 0; i < items.length; i++) c[items[i][0]]++;
    return JSON.stringify(c);
  }

  // The API works over HTTPS (the server is behind Cloudflare); a plain-http address would be
  // blocked on an HTTPS page, so it is upgraded. Localhost (testing) is left alone.
  function apiBase(b) {
    if (location.protocol === 'https:' && /^http:\/\//i.test(b) && !/^http:\/\/(localhost|127\.)/i.test(b)) {
      b = b.replace(/^http:/i, 'https:').replace(/:80(\/|$)/, '$1');
    }
    return b.replace(/\/+$/, '');
  }

  // ---------- player ----------

  var player, video, titleEl, infoEl, prevBtn, nextBtn, msgEl;
  var list = [], index = 0, live = false, full = false, active = false, currentId = '';
  var paneEl = null, hls = null, saveTimer = 0, idleTimer = 0, retries = 0, retryTimer = 0;

  function build() {
    if (player) return;
    player = document.createElement('div');
    player.id = 'player';
    player.innerHTML =
      '<div class="pbar"><div class="ptitle"></div>' +
      '<button class="pnav pprev" type="button">‹ Previous</button><button class="pnav pnext" type="button">Next ›</button>' +
      '<button class="pclose" type="button" aria-label="Close">✕</button></div>' +
      '<div class="pinfo"></div><div class="pmsg"></div>' +
      '<video playsinline webkit-playsinline controls preload="auto"></video>';
    document.body.appendChild(player);
    video = player.querySelector('video');
    titleEl = player.querySelector('.ptitle');
    infoEl = player.querySelector('.pinfo');
    msgEl = player.querySelector('.pmsg');
    prevBtn = player.querySelector('.pprev');
    nextBtn = player.querySelector('.pnext');
    prevBtn.onclick = function () { go(index - 1); };
    nextBtn.onclick = function () { go(index + 1); };
    player.querySelector('.pclose').onclick = function () { back(); };
    // The bar fades while the video plays; any touch or mouse move brings it back.
    ['mousemove', 'touchstart', 'click'].forEach(function (ev) { player.addEventListener(ev, wake, { passive: true }); });
    video.addEventListener('playing', function () {
      retries = 0;
      msgEl.style.display = 'none';
      tell('onPlayerState', 'playing');
      wake();
    });
    video.addEventListener('waiting', function () { tell('onPlayerState', 'buffering'); });
    video.addEventListener('ended', ended);
    video.addEventListener('error', function () { failed(video.error ? video.error.code : 0); });
    // Subtitles start off, as on the TV; the player's own menu turns one on.
    video.textTracks && video.textTracks.addEventListener && video.textTracks.addEventListener('addtrack', function (e) {
      if (e.track) e.track.mode = 'disabled';
    });
    window.addEventListener('resize', place);
    document.addEventListener('keydown', keys, true);
    document.addEventListener('visibilitychange', function () { if (document.hidden) saveProgress(false); });
    window.addEventListener('pagehide', function () { saveProgress(false); });
  }

  function wake() {
    if (!player) return;
    player.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (!video.paused) player.classList.add('idle'); }, 3000);
  }

  // Where the video goes: over the Live TV preview box, or the whole window.
  function place() {
    if (!player || !active) return;
    var r = paneEl && !full && document.body.contains(paneEl) ? paneEl.getBoundingClientRect() : null;
    if (r && r.width > 40) {
      player.className = 'pane';
      player.style.left = r.left + 'px'; player.style.top = r.top + 'px';
      player.style.width = r.width + 'px'; player.style.height = r.height + 'px';
      video.controls = false;
    } else {
      player.className = 'full';
      player.style.left = player.style.top = player.style.width = player.style.height = '';
      video.controls = true;
    }
    player.style.display = 'flex';
  }

  function relayUrl(u) {
    if (!/^https?:/i.test(u)) return u;
    if (location.protocol === 'http:' && /^http:\/\/(localhost|127\.)/i.test(u) && !ls.get('relay')) return u; // local testing
    return relayBase() + '/s?u=' + encodeURIComponent(u);
  }

  function load(i, startMs) {
    index = i;
    var it = list[i];
    currentId = it.id || '';
    titleEl.textContent = String(it.title || '').replace(/\n/g, '  ·  ');
    prevBtn.style.display = list.length > 1 ? '' : 'none';
    nextBtn.style.display = list.length > 1 ? '' : 'none';
    prevBtn.disabled = i <= 0;
    nextBtn.disabled = i >= list.length - 1;
    msgEl.style.display = 'none';
    infoEl.style.display = 'none';
    var url = it.url;
    // Live TV on the web is HLS (.m3u8): every browser can play it, natively or with hls.js.
    if (live) url = url.replace(/\.ts(\?|$)/i, '.m3u8$1');
    var src = relayUrl(url);
    // Close the previous stream at once: the account allows a single connection.
    if (hls) { hls.destroy(); hls = null; }
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* nothing loaded */ }
    var isHls = /\.m3u8(\?|$)/i.test(url);
    var start = function () {
      if (startMs > 0) {
        var t = startMs / 1000;
        var seek = function () { try { video.currentTime = t; } catch (e) { /* not seekable yet */ } };
        video.addEventListener('loadedmetadata', function once() { video.removeEventListener('loadedmetadata', once); seek(); });
      }
      var p = video.play();
      if (p && p.catch) p.catch(function () { /* autoplay refused: the controls are there */ });
    };
    if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      withHls(function (Hls) {
        if (!Hls || !Hls.isSupported()) { failed(4); return; }
        hls = new Hls({ enableWorker: true, lowLatencyMode: false });
        hls.on(Hls.Events.ERROR, function (ev, d) { if (d && d.fatal) failed(2); });
        hls.loadSource(src);
        hls.attachMedia(video);
        start();
      });
    } else {
      video.src = src;
      start();
    }
    if (!live) tell('onItem', i);
  }

  var hlsWaiters = null;
  function withHls(cb) {
    if (window.Hls) return cb(window.Hls);
    if (hlsWaiters) { hlsWaiters.push(cb); return; }
    hlsWaiters = [cb];
    var s = document.createElement('script');
    s.src = HLS_JS;
    s.onload = s.onerror = function () { var w = hlsWaiters; hlsWaiters = null; w.forEach(function (f) { f(window.Hls); }); };
    document.head.appendChild(s);
  }

  function failed(code) {
    if (!active) return;
    // Live streams drop, and the server briefly refuses while a previous stream is still closing.
    if (live && retries++ < 6) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(function () { if (active) load(index, 0); }, 1000 + 1000 * retries);
      return;
    }
    var it = list[index] || {};
    // First rule out the relay: a failed download looks like an unplayable file to the browser.
    var probe = relayUrl(it.url || '');
    if (probe !== it.url) {
      if (failed.checked) return; // a check is already under way
      failed.checked = true;
      fetch(relayBase() + '/', { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error();
        failed.checked = false;
        report(it, code);
      }).catch(function () {
        failed.checked = false;
        msgEl.innerHTML = '<b>Can’t reach the yamTV relay.</b><span>Video comes through the relay (' + esc(relayBase()) +
          '). It is not set up yet, or it is offline. Try again in a moment.</span>';
        msgEl.style.display = 'flex';
        tell('onPlayerError', 'The yamTV relay cannot be reached.');
      });
      return;
    }
    report(it, code);
  }
  function report(it, code) {
    var unsupported = code === 4 || /\.(mkv|avi)(\?|$)/i.test(it.url || '');
    var vlc = /iPhone|iPad|iPod/.test(navigator.userAgent)
      ? 'vlc-x-callback://x-callback-url/stream?url=' + encodeURIComponent(relayUrl(it.url))
      : relayUrl(it.url);
    msgEl.innerHTML = '<b>' + (unsupported ? 'This browser can’t play this file.' : 'The video could not be played.') + '</b>' +
      '<span>' + (unsupported ? 'It is an ' + esc(((it.url || '').match(/\.(\w+)(\?|$)/) || [, 'unknown'])[1].toUpperCase()) +
        ' file. It opens in the free VLC app.' : 'Try again in a moment.') + '</span>' +
      '<a class="btn primary" href="' + esc(vlc) + '">' + (unsupported ? 'Open in VLC' : 'Open the stream') + '</a>';
    msgEl.style.display = 'flex';
    tell('onPlayerError', unsupported ? 'This browser cannot play this file type.' : 'The stream could not be played.');
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  function ended() {
    if (!active) return;
    if (live) { failed(2); return; }
    forget(currentId); // played to the end: finished
    if (index + 1 < list.length) { load(index + 1, 0); return; }
    tell('onEnded');
    stop();
    tell('onFullscreen', false);
  }

  function go(i) {
    if (!active || live || i < 0 || i >= list.length) return;
    saveProgress(false);
    load(i, 0);
  }

  function play(specJson) {
    build();
    saveProgress(false);
    var s = JSON.parse(specJson);
    live = !!s.live;
    list = s.items || [];
    retries = 0;
    active = true;
    full = !!s.full || !paneEl;
    load(s.index || 0, s.start || 0);
    place();
    if (full) { tell('onFullscreen', true); if (live) tell('liveInfo'); }
    clearInterval(saveTimer);
    if (!live) saveTimer = setInterval(function () { saveProgress(false); }, SAVE_EVERY_MS);
    wake();
  }

  function stop() {
    if (!active) return;
    saveProgress(false);
    active = false;
    clearInterval(saveTimer);
    clearTimeout(retryTimer);
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    try { video.load(); } catch (e) { /* nothing loaded */ }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
    player.style.display = 'none';
    full = false;
    if (!live) tell('onStopped');
  }

  // Close / Esc: like the TV remote's Back. Live fullscreen goes back to the preview box.
  function back() {
    if (!active) return;
    if (live && full && paneEl && document.body.contains(paneEl)) {
      full = false;
      place();
      tell('onFullscreen', false);
      return;
    }
    stop();
    tell('onFullscreen', false);
  }

  function keys(e) {
    if (!active || !full) return;
    var k = e.keyCode, handled = true;
    if (k === 27 || k === 8) back();
    else if (live && k === 38) tell('zap', 1);       // Up: next channel, as on the TV
    else if (live && k === 40) tell('zap', -1);
    else if (live && k === 13) tell('liveInfo');
    else if (!live && k === 37) video.currentTime = Math.max(0, video.currentTime - 10);
    else if (!live && k === 39) video.currentTime = Math.min(video.duration || 1e9, video.currentTime + 10);
    else if (k === 32) { if (video.paused) video.play(); else video.pause(); }
    else if (!live && k === 78) go(index + 1);       // N
    else if (!live && k === 80) go(index - 1);       // P
    else handled = false;
    if (handled) { e.preventDefault(); e.stopPropagation(); wake(); }
  }

  // ---------- resume points (same rules as the TV: kept between 10 s and 2 min before the end) ----------

  function saveProgress(isEnded) {
    if (!active || live || !currentId || !video) return;
    var pos = Math.round(video.currentTime * 1000), dur = Math.round((video.duration || 0) * 1000);
    if (!isFinite(dur) || (dur <= 0 && !isEnded)) return;
    var all;
    try { all = JSON.parse(ls.get('progress') || '{}') || {}; } catch (e) { all = {}; }
    if (!isEnded && pos > 10000 && pos < dur - 120000) all[currentId] = { p: pos, d: dur, t: Date.now() };
    else if (isEnded || pos >= dur - 120000) delete all[currentId];
    ls.set('progress', JSON.stringify(all));
  }
  function forget(id) {
    try {
      var all = JSON.parse(ls.get('progress') || '{}') || {};
      delete all[id];
      ls.set('progress', JSON.stringify(all));
    } catch (e) { /* nothing saved */ }
  }

  function liveInfo(jsonStr) {
    if (!active || !live || !full) return;
    var o = JSON.parse(jsonStr);
    if (o.update && infoEl.style.display === 'none') return;
    var h = '<div class="pl1">LIVE · ' + esc(o.line || '') + '<span>' + esc(o.clock || '') + '</span></div>';
    if (o.now) h += '<div class="pl2">Now · ' + esc(o.now.time) + ' · <b>' + esc(o.now.title) + '</b></div><div class="pbar2"><i style="width:' + (o.now.pct || 0) + '%"></i></div>';
    if (o.next) h += '<div class="pl3">Next · ' + esc(o.next.time) + ' · ' + esc(o.next.title) + '</div>';
    if (!o.now && !o.next) h += '<div class="pl3">No guide for this channel</div>';
    titleEl.textContent = o.name || titleEl.textContent;
    infoEl.innerHTML = h;
    infoEl.style.display = 'block';
    wake();
    if (!o.update) {
      clearTimeout(liveInfo.t);
      liveInfo.t = setTimeout(function () { infoEl.style.display = 'none'; }, 6000);
    }
  }

  window.Native = {
    platform: function () { return 'web'; },
    apiBase: apiBase,
    get: function (k) { return ls.get(k); },
    set: function (k, v) { ls.set(k, v); },
    play: play,
    stop: stop,
    fullscreen: function () { if (active) { full = true; place(); tell('onFullscreen', true); if (live) tell('liveInfo'); } },
    // The Live TV preview box: the page reports it; the video sits over it (wide screens only).
    setPane: function () { paneEl = document.getElementById('pane'); if (paneEl && !paneEl.getBoundingClientRect().width) paneEl = null; place(); },
    clearPane: function () { paneEl = null; },
    liveInfo: liveInfo,
    loadCatalog: loadCatalog,
    search: search,
    recent: recent,
    counts: counts,
    toast: function () {},
    keyboard: function () {}
  };
})();
