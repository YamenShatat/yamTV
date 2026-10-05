# yamTV

An IPTV player in the browser for an Xtream Codes playlist: Live TV with a guide, Movies, Series,
search across the whole playlist, favorites, watch later, continue watching, accent colours.
Works in Chrome, Edge, Brave and Firefox on a computer, and in Safari on iPhone (add it to the
Home Screen and it opens like an app).

**Open it:** https://yamenshatat.github.io/yamTV/ and add your playlist (server, username,
password). The login stays in your browser.

It is the web build of the yamTV Android TV app, itself a rebuild of
[infinitel8p/Extreme-InfiniTV](https://github.com/infinitel8p/Extreme-InfiniTV) (GPL-3.0).

## How it works

- `app.js`, `app.css`: the TV app's page (shared design and logic).
- `native.js`: what the TV app's Android side does, in the browser: saved state (localStorage),
  the library index (cached 12 h), and the player (the browser's own video; live TV as HLS, with
  [hls.js](https://github.com/video-dev/hls.js) where the browser has no HLS of its own).
- `web.css`: the player and the phone layout.
- `relay/`: a Cloudflare Worker. The IPTV server sends video from a plain-HTTP host, which browsers
  will not play on an HTTPS page, so video goes through the relay over HTTPS. It only opens
  addresses on the IPTV server (a secret setting) and signs every address it writes into a
  playlist, so it cannot be used as an open proxy.

## Limits

- **MKV/AVI movies:** Chrome, Edge and Brave play most of them; Safari on iPhone plays none. When a
  browser cannot play a file, the player offers **Open in VLC** (the free VLC app on iPhone).
- The relay runs on Cloudflare's free Workers plan; all video passes through it.
- The account allows one connection: switching channels quickly can need a few seconds' retry.

## Relay setup (once)

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up.
2. In this repo's `relay` folder:
   ```
   npx wrangler login
   npx wrangler secret put ALLOW_HOST   (the IPTV server's host name, e.g. cf.example.com)
   npx wrangler secret put SECRET       (any long random string)
   npx wrangler deploy
   ```
3. Put the address it prints (`https://yamtv-relay.<you>.workers.dev`) in `native.js` (`RELAY`).

## Local testing

Serve the folder (any static server) and run `npx wrangler dev` in `relay` with a `.dev.vars` file
(`ALLOW_HOST=...` and `SECRET=...`, not committed). In the browser: `localStorage['yamtv:relay'] = 'http://127.0.0.1:8787'`.

## License

GPL-3.0, as the original Extreme InfiniTV. Geist font: SIL Open Font License (`fonts/`).
