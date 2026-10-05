# yamTV

An IPTV player in the browser for an Xtream Codes playlist: Live TV with a guide, Movies, Series,
search across the whole playlist, favorites, watch later, continue watching, accent colours.
Made for Chrome and Brave on one Windows PC.

**Open it:** https://yamenshatat.github.io/yamTV/ with the yamTV relay running on the same PC
(the "Start yamTV relay" shortcut), and add your playlist. The login stays in your browser. The
first time, allow the site to reach localhost / your local network when the browser asks.

It is the web build of the yamTV Android TV app, itself a rebuild of
[infinitel8p/Extreme-InfiniTV](https://github.com/infinitel8p/Extreme-InfiniTV) (GPL-3.0).

## How it works

- `app.js`, `app.css`: the TV app's page (shared design and logic).
- `native.js`: what the TV app's Android side does, in the browser: saved state (localStorage,
  under `yamtv:` names so it never mixes with yamDrive on the same address), the library index
  (cached 12 h), and the player (the browser's own video; live TV as HLS, with
  [hls.js](https://github.com/video-dev/hls.js) where the browser has no HLS of its own).
- `web.css`: the player and the small-window layout.
- `relay/local.js`: a small Node server on `127.0.0.1:8770`. The IPTV server sends video from a
  plain-HTTP host, which browsers will not play on an HTTPS page; addresses on your own PC are
  allowed, so video comes through the relay. It only opens the IPTV server's addresses
  (`relay/local.json`, not committed) and signs every address it writes into a playlist.
- `relay/worker.js`: the same relay for Cloudflare Workers. It does not work with this provider:
  for requests from Cloudflare the server redirects to a bare IP address, which Workers may not
  fetch (error 1003). Kept for providers that redirect to host names.

## Relay setup (once)

`relay/local.json`: `{"allowHost": "your-iptv-server.example"}` (the secret is added on first start).
Run `node relay/local.js`, or the Desktop shortcut that does the same.
## License

GPL-3.0, as the original Extreme InfiniTV. Geist font: SIL Open Font License (`fonts/`).
