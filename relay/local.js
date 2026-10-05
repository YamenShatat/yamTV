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

http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/s') return text(res, 200, 'yamTV relay');
  const target = url.searchParams.get('u') || '';
  let parsed;
  try { parsed = new URL(target); } catch { return text(res, 400, 'Bad address'); }
  const k = url.searchParams.get('k');
  const ok = k ? k === sign(target) : allowed.includes(parsed.hostname.toLowerCase());
  if (!ok || !/^https?:$/.test(parsed.protocol)) return text(res, 403, 'Not allowed');

  let r;
  try { r = await get(target, req.headers.range); } catch (e) { return text(res, 502, 'The IPTV server did not answer: ' + e.message); }
  const { up, finalUrl } = r;
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
  // The account allows one connection: when the page lets go, close the upstream at once.
  res.on('close', () => up.destroy());
}).listen(PORT, '127.0.0.1', () => console.log('yamTV relay on http://127.0.0.1:' + PORT));
