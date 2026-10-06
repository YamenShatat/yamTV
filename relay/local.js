// yamTV relay for this PC: hands the IPTV server's video to the website (https://yamenshatat.github.io/yamTV/).
//
// Why: the website is HTTPS, the server sends video from a plain-HTTP host, and browsers refuse
// plain-HTTP video on an HTTPS page. Addresses on this PC (127.0.0.1) are trusted, so the page
// may get video from here. (A Cloudflare Worker cannot do this job: for requests from Cloudflare
// the server redirects to a bare IP address, which Workers may not fetch: error 1003.)
//
//   node local.js            listens on http://127.0.0.1:8770 (this PC only)
//
//   GET /s?u=<url>           u must be on the IPTV server (allowHost); its redirects are followed.
//   GET /s?u=<url>&k=<sig>   an address this relay wrote into a playlist, signed with a local secret.
//
// Settings: relay/local.json (not committed): {"allowHost": "your-iptv-server.example"}; the
// signing secret is made on first start and kept there too.
'use strict';
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = 8770;
const CONFIG = path.join(__dirname, 'local.json');
const config = fs.existsSync(CONFIG) ? JSON.parse(fs.readFileSync(CONFIG, 'utf8')) : {};
if (!config.secret) {
  config.secret = crypto.randomBytes(24).toString('hex');
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2));
}
if (!config.allowHost) {
  console.error('Set "allowHost" (the IPTV server\'s host name) in ' + CONFIG);
  process.exit(1);
}
const allowed = config.allowHost.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const agentHttp = new http.Agent({ keepAlive: true });
const agentHttps = new https.Agent({ keepAlive: true });

const sign = v => crypto.createHmac('sha256', config.secret).update(v).digest('hex').slice(0, 32);

function cors(res, extra) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  // Chrome and Brave ask before an internet page reaches this PC (Private Network Access).
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  for (const k in extra || {}) res.setHeader(k, extra[k]);
}

function text(res, status, msg) {
  cors(res, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.writeHead(status);
  res.end(msg);
}

// GET with redirects followed; resolves with the final response and its address.
function get(url, range, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 5) return reject(new Error('too many redirects'));
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.get(u, {
      agent: u.protocol === 'https:' ? agentHttps : agentHttp,
      headers: Object.assign({ 'User-Agent': 'yamTV/1.0 (web)' }, range ? { Range: range } : {})
    }, up => {
      if (up.statusCode >= 300 && up.statusCode < 400 && up.headers.location) {
        up.resume();
        return resolve(get(new URL(up.headers.location, u).href, range, hops + 1));
      }
      resolve({ up, finalUrl: u.href });
    });
    req.setTimeout(30000, () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

function isPlaylist(finalUrl, type) {
  return /mpegurl/i.test(type || '') || /\.m3u8$/i.test(new URL(finalUrl).pathname);
}

function relayed(abs) { return 'http://127.0.0.1:' + PORT + '/s?u=' + encodeURIComponent(abs) + '&k=' + sign(abs); }

function rewrite(body, base) {
  return body.split(/\r?\n/).map(line => {
    const t = line.trim();
    if (!t) return line;
    if (t.startsWith('#')) return t.replace(/URI="([^"]+)"/, (m, uri) => 'URI="' + relayed(new URL(uri, base).href) + '"');
    return relayed(new URL(t, base).href);
  }).join('\n');
}

// ---------- downloads: one at a time into D:\; streaming holds them ----------
//
// The account allows a single connection, so while anything streams through /s the current
// download stops (its .part file stays) and resumes afterwards with a Range request.
// List kept in relay/downloads.json (not committed). Same entry shape as the page expects.

const ROOT = 'D:\\';
const LIST = path.join(__dirname, 'downloads.json');
let list = [];
try { list = JSON.parse(fs.readFileSync(LIST, 'utf8')); } catch { list = []; }
for (const e of list) if (e.status === 'downloading') e.status = 'queued';
let current = null, currentUp = null, held = false, streams = 0, releaseTimer = null;

function saveList() { fs.writeFileSync(LIST + '.tmp', JSON.stringify(list)); fs.renameSync(LIST + '.tmp', LIST); }
function safe(s) {
  s = String(s || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').trim().replace(/\.+$/, '');
  return !s ? 'untitled' : s.length > 120 ? s.slice(0, 120) : s;
}

function addDownload(spec) {
  if (!spec.key || !spec.url) return;
  if (!allowed.includes(new URL(spec.url).hostname.toLowerCase())) return;
  const old = list.find(e => e.key === spec.key);
  if (old && old.status !== 'error') return;
  if (old) list.splice(list.indexOf(old), 1);
  const folder = path.join(ROOT, ...String(spec.folder || 'Other').split('/').map(safe));
  list.push({
    key: spec.key, url: spec.url, title: spec.title || '', sub: spec.sub || '', poster: spec.poster || '',
    file: path.join(folder, safe(spec.name) + '.' + safe(spec.ext || 'mp4')),
    status: 'queued', size: 0, done: 0, error: null, meta: spec.meta || '', added: Date.now()
  });
  saveList();
  pump();
}

function pump() {
  if (held || current) return;
  const e = list.find(x => x.status === 'queued');
  if (!e) return;
  current = e;
  e.status = 'downloading';
  saveList();
  run(e);
}

function stopCurrent(requeue) {
  const e = current, up = currentUp;
  current = null;
  currentUp = null;
  if (e && requeue && list.includes(e)) e.status = 'queued';
  if (up) { up.aborted = true; up.destroy(); }
  saveList();
}

async function run(e) {
  const part = e.file + '.part';
  try {
    fs.mkdirSync(path.dirname(e.file), { recursive: true });
    let have = fs.existsSync(part) ? fs.statSync(part).size : 0;
    const { up } = await get(e.url, have > 0 ? 'bytes=' + have + '-' : null);
    if (current !== e) { up.destroy(); return; } // cancelled or held meanwhile
    if (up.statusCode === 416 && have > 0) { up.resume(); return finish(e, part); }
    if (up.statusCode >= 400) { up.resume(); throw new Error('The server replied ' + up.statusCode); }
    const resumed = up.statusCode === 206 && have > 0;
    if (!resumed) have = 0;
    e.size = have + (+up.headers['content-length'] || 0);
    e.done = have;
    currentUp = up;
    const out = fs.createWriteStream(part, { flags: resumed ? 'a' : 'w' });
    // Speed in megabits per second, measured over each second.
    let mark = e.done, t0 = Date.now();
    e.speed = 0;
    up.on('data', c => {
      e.done += c.length;
      const ms = Date.now() - t0;
      if (ms >= 1000) { e.speed = (e.done - mark) * 8 / ms / 1000; mark = e.done; t0 = Date.now(); }
    });
    up.pipe(out);
    await new Promise((resolve, reject) => {
      out.on('finish', resolve);
      up.on('error', reject);
      up.on('aborted', () => reject(new Error('aborted')));
      up.on('close', () => { if (up.aborted) reject(new Error('held')); });
    });
    if (current !== e) return;
    if (e.size && e.done < e.size) throw new Error('The connection closed before the end of the file.');
    finish(e, part);
  } catch (err) {
    if (current !== e) return; // held or cancelled: handled there
    e.status = 'error';
    e.error = err.message;
    current = null;
    currentUp = null;
    saveList();
    pump();
  }
}

function finish(e, part) {
  fs.renameSync(part, e.file);
  e.status = 'done';
  e.size = e.done = fs.statSync(e.file).size;
  current = null;
  currentUp = null;
  saveList();
  pump();
}

// Streams through /s hold the downloads; they continue 20 s after the last stream closes
// (live TV fetches a piece every few seconds, so a short gap is not the end).
function streamStarted() {
  streams++;
  clearTimeout(releaseTimer);
  if (!held) { held = true; if (current) stopCurrent(true); }
}
function streamEnded() {
  streams = Math.max(0, streams - 1);
  if (streams) return;
  clearTimeout(releaseTimer);
  releaseTimer = setTimeout(() => { if (!streams) { held = false; pump(); } }, 20000);
}

function readBody(req) {
  return new Promise(resolve => { let b = ''; req.on('data', c => { b += c; }); req.on('end', () => resolve(b)); });
}

// A downloaded file, for playing it in the browser (Range supported). Only finished downloads in the list.
function serveFile(req, res, file) {
  const full = path.resolve(file);
  if (!list.some(x => x.status === 'done' && path.resolve(x.file) === full) || !fs.existsSync(full)) return text(res, 404, 'Not found');
  const size = fs.statSync(full).size;
  const type = /\.mp4$|\.m4v$/i.test(full) ? 'video/mp4' : /\.mkv$/i.test(full) ? 'video/x-matroska' : 'application/octet-stream';
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m) {
    const start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    cors(res, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Range': 'bytes ' + start + '-' + end + '/' + size, 'Content-Length': end - start + 1 });
    res.writeHead(206);
    return fs.createReadStream(full, { start, end }).pipe(res);
  }
  cors(res, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size });
  res.writeHead(200);
  fs.createReadStream(full).pipe(res);
}

async function downloadsApi(req, res, url) {
  const key = url.searchParams.get('key');
  const e = key && list.find(x => x.key === key);
  switch (url.pathname) {
    case '/dl/list':
      cors(res, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.writeHead(200);
      return res.end(JSON.stringify(list.map(x => Object.assign({}, x, { url: undefined }))));
    case '/dl/add':
      try { addDownload(JSON.parse(await readBody(req))); } catch { return text(res, 400, 'Bad download'); }
      break;
    case '/dl/cancel':
      if (e && e.status !== 'done') {
        if (current === e) stopCurrent(false);
        list.splice(list.indexOf(e), 1);
        try { fs.unlinkSync(e.file + '.part'); } catch { /* none */ }
        saveList();
        pump();
      }
      break;
    case '/dl/delete':
      if (e && e.status === 'done') {
        list.splice(list.indexOf(e), 1);
        try { fs.unlinkSync(e.file); } catch { /* gone already */ }
        saveList();
      }
      break;
    case '/dl/retry':
      if (e && e.status === 'error') { e.status = 'queued'; e.error = null; saveList(); pump(); }
      break;
    case '/dl/open':
      require('child_process').spawn('explorer.exe', [ROOT], { detached: true, stdio: 'ignore' }).unref();
      break;
    default:
      return text(res, 404, 'Not found');
  }
  text(res, 200, 'ok');
}

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    cors(res, { 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Range, Content-Type' });
    res.writeHead(204);
    return res.end();
  }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/dl/')) return downloadsApi(req, res, url);
  if (url.pathname === '/f') return serveFile(req, res, url.searchParams.get('p') || '');
  if (url.pathname !== '/s') return text(res, 200, 'yamTV relay');
  const target = url.searchParams.get('u') || '';
  let parsed;
  try { parsed = new URL(target); } catch { return text(res, 400, 'Bad address'); }
  const k = url.searchParams.get('k');
  const ok = k ? k === sign(target) : allowed.includes(parsed.hostname.toLowerCase());
  if (!ok || !/^https?:$/.test(parsed.protocol)) return text(res, 403, 'Not allowed');

  // The page may let go while we wait for the server (fast zapping, seeking); 'close' has then
  // already fired, so note it now or the stream count never drops and downloads stay held.
  let gone = false;
  res.on('close', () => { gone = true; });
  let r;
  try { r = await get(target, req.headers.range); } catch (e) { return text(res, 502, 'The IPTV server did not answer: ' + e.message); }
  const { up, finalUrl } = r;
  if (gone) return up.destroy();
  if (up.statusCode < 300 && isPlaylist(finalUrl, up.headers['content-type'])) {
    let body = '';
    up.setEncoding('utf8');
    up.on('data', c => { body += c; });
    up.on('end', () => {
      cors(res, { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' });
      res.writeHead(200);
      res.end(rewrite(body, finalUrl));
    });
    return;
  }
  const out = { 'Cache-Control': 'no-store' };
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified']) {
    if (up.headers[h]) out[h] = up.headers[h];
  }
  cors(res, out);
  res.writeHead(up.statusCode);
  up.pipe(res);
  streamStarted();
  // The account allows one connection: when the page lets go, close the upstream at once.
  res.on('close', () => { up.destroy(); streamEnded(); });
}).listen(PORT, '127.0.0.1', () => { console.log('yamTV relay on http://127.0.0.1:' + PORT); pump(); });
