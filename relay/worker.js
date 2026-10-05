// yamTV relay: a Cloudflare Worker that hands the IPTV server's video to the website over HTTPS.
//
// Why: the website is HTTPS (GitHub Pages) but the server sends every stream from a plain-HTTP
// video host, and browsers refuse plain-HTTP video on an HTTPS page. The API itself is HTTPS with
// CORS, so the page calls it directly; only video comes through here.
//
//   GET /s?u=<url>          u must be on ALLOW_HOST (the IPTV server); its redirect is followed.
//   GET /s?u=<url>&k=<sig>  any address this relay wrote into a playlist, signed with SECRET.
//
// HLS playlists are rewritten so each segment / sub-playlist is fetched through /s as well.
// Everything else (MP4/MKV movies, .ts segments) streams straight through, Range requests included.
//
// Settings (wrangler secret put ...): ALLOW_HOST e.g. "cf.example.com"; SECRET any long random string.

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
    if (request.method !== 'GET' && request.method !== 'HEAD') return text('Method not allowed', 405);
    const url = new URL(request.url);
    if (url.pathname !== '/s') return text('yamTV relay', 200);

    const target = url.searchParams.get('u') || '';
    let parsed;
    try { parsed = new URL(target); } catch { return text('Bad address', 400); }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return text('Bad address', 400);
    const signed = url.searchParams.get('k');
    const allowed = signed ? signed === await sign(target, env.SECRET) : hostAllowed(parsed.hostname, env.ALLOW_HOST);
    if (!allowed) return text('Not allowed', 403);

    const headers = new Headers({ 'User-Agent': 'yamTV/1.0 (web)' });
    const range = request.headers.get('Range');
    if (range) headers.set('Range', range);
    let upstream;
    try {
      upstream = await follow(target, request.method, headers);
    } catch (e) {
      return text('The IPTV server did not answer: ' + e.message, 502);
    }

    const type = upstream.headers.get('Content-Type') || '';
    if (request.method === 'GET' && upstream.ok && isPlaylist(upstream.url, type)) {
      const body = await upstream.text();
      return new Response(await rewrite(body, upstream.url, url.origin, env.SECRET), {
        status: 200,
        headers: cors({ 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-store' })
      });
    }

    const out = cors({ 'Cache-Control': 'no-store' });
    for (const h of ['Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges', 'Last-Modified', 'ETag']) {
      const v = upstream.headers.get(h);
      if (v) out.set(h, v);
    }
    if (!out.has('Accept-Ranges') && upstream.status === 206) out.set('Accept-Ranges', 'bytes');
    return new Response(upstream.body, { status: upstream.status, headers: out });
  }
};

// Redirects are followed here rather than by fetch: the IPTV server redirects to addresses with an
// explicit ":80", which Cloudflare refuses between its own sites (error 1003), so the default port
// is dropped. upstream.url is set to the final address for the playlist rewrite.
async function follow(url, method, headers) {
  for (let hops = 0; hops < 5; hops++) {
    const u = new URL(url);
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
    const res = await fetch(u.href, { method, headers, redirect: 'manual' });
    const loc = res.headers.get('Location');
    if (res.status >= 300 && res.status < 400 && loc) {
      url = new URL(loc, u.href).href;
      continue;
    }
    Object.defineProperty(res, 'url', { value: u.href });
    return res;
  }
  throw new Error('too many redirects');
}

function hostAllowed(host, allow) {
  return !!allow && allow.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).includes(host.toLowerCase());
}

function isPlaylist(finalUrl, type) {
  return /mpegurl/i.test(type) || /\.m3u8(\?|$)/i.test(new URL(finalUrl).pathname);
}

// Every address in the playlist (lines, and URI="..." in tags) becomes a signed relay address.
async function rewrite(body, base, origin, secret) {
  const lines = body.split(/\r?\n/);
  const out = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t) { out.push(line); continue; }
    if (t.startsWith('#')) {
      const m = t.match(/URI="([^"]+)"/);
      out.push(m ? t.replace(m[1], await relay(new URL(m[1], base).href, origin, secret)) : t);
    } else {
      out.push(await relay(new URL(t, base).href, origin, secret));
    }
  }
  return out.join('\n');
}

async function relay(abs, origin, secret) {
  return origin + '/s?u=' + encodeURIComponent(abs) + '&k=' + await sign(abs, secret);
}

async function sign(value, secret) {
  if (!secret) throw new Error('SECRET is not set');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
  return [...mac.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function cors(extra) {
  const h = new Headers(extra || {});
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Headers', 'Range');
  h.set('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
  return h;
}

function text(msg, status) {
  return new Response(msg, { status, headers: cors({ 'Content-Type': 'text/plain; charset=utf-8' }) });
}
