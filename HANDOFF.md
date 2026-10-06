# yamTV: handoff and onboarding (written 2026-10-06)

Read this first in a new chat. It describes three related things: the **yamTV Android TV app**,
the **yamTV website**, and the **yamDrive** website that shares the GitHub Pages address.
Nothing secret is in this file: the IPTV login lives only in the user's browser and on the TV,
the relay's settings in `relay/local.json` (not committed). Ask the user for the login if a test
needs it, and never commit it.

---

## 1. Who you are working with

- Yamen Shatat (GitHub `YamenShatat`). Pronouns not stated: use they/them or "the user".
- Windows 11, PowerShell 5.1, Brave browser (also has Chrome). Node v24.18.0 and .NET 8 SDK installed,
  JDK 17 and the Android SDK (platform 36) installed. `gh` is logged in.
- Every PowerShell call: refresh PATH first:
  `$env:Path = [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')`
- PowerShell 5.1 traps met this session: `git commit -m` with double quotes breaks (write the
  message to a file, `git commit -F`); variables are case-insensitive (`$R` and `$r` are the same);
  `Invoke-WebRequest` uses old TLS (use `curl.exe` for HTTPS checks against Cloudflare sites).
- **Smart App Control is OFF** on this PC (the user turned it off for the old Windows app).

### How the user likes to work
- Short messages, often several in a row while you work; read them all and fold them in.
- **"If you can't get my idea 100%, ask before doing it."** Ask with concrete options (mockups help).
- Show, don't claim: test in the real thing, report what was and was not tested.
- They iterate on looks quickly (logo went through ~15 versions); show options side by side.
- Explain in plain language; avoid jargon. They are not reviewing code.
- Be careful with their data: in this project a deleted app folder took their watch history with
  it, and they were upset. **Before deleting anything, list exactly what it holds and ask.**

---

## 2. The IPTV provider (facts that shape everything)

- Xtream Codes API, server behind Cloudflare. API works over **HTTPS with CORS `*`**.
- Live/movie/episode URLs redirect (302) to a **plain-HTTP video host** with no HTTPS.
  For requests that come *from Cloudflare* (Workers), the redirect goes to a **bare IP address**,
  which Workers may not fetch (Cloudflare error 1003). So a Cloudflare Worker relay cannot work.
- Account allows **1 connection** at a time (switching channels fast can briefly fail; downloads
  and streaming must take turns).
- Library size: ~16,357 live channels, ~67,800 movies, ~17,350 series. Full movie/series lists are
  26-27 MB of JSON each.
- Movies: ~81% MKV, ~19% MP4. No HLS for movies/episodes (`.m3u8` returns 551). Live has HLS.
- Live channels checked offer a single quality each (media playlists, not master playlists).

---

## 3. yamTV website (this repo) — the current focus

- Repo: https://github.com/YamenShatat/yamTV (public, GPL-3.0). Local: `C:\Users\yamen\OneDrive\Desktop\yamTV-web`.
- Site: https://yamenshatat.github.io/yamTV/ (GitHub Pages, branch `main`, root).
- Scope (user's decision): **this Windows PC only, Chrome/Brave**. iPhone was dropped.

### Files
- `app.js`, `app.css`: the TV app's page (copied from the Android project, then changed: a `WEB`
  flag, `DLS` flag for downloads, `N.apiBase`, no exit dialog, `App.toast`). **It is a copy**; the
  TV app has its own `app.js`. Changes must be made in both if both should get them.
- `native.js`: plays the Android side's role behind the same `window.Native` API: storage
  (localStorage under **`yamtv:` prefixes**: yamDrive shares the origin and uses the same key
  names), library index (Cache API, 12 h), player (`<video>`; hls.js 1.5.20 from jsdelivr for
  HLS wherever MediaSource exists, locked to the highest level and the audio with most
  channels), resume points, downloads (talks to the relay).
- `web.css`: player overlay, "can't play / Open in VLC" box, small-window layout.
- `relay/local.js`: **the relay, a Node server on `127.0.0.1:8770`** (this PC only). Why: video
  is plain HTTP and the site is HTTPS; browsers allow an HTTPS page to use addresses on the same
  PC. It only opens the IPTV host from `relay/local.json` (`allowHost`) and follows/rewrites
  HLS playlists with HMAC-signed addresses (secret in `local.json`). Also the **download
  manager**: `/dl/list|add|cancel|delete|retry|open`, files to `%USERPROFILE%\Downloads\yamTV`,
  one at a time, held while anything streams through `/s` (resumes 20 s after the last stream,
  with Range), list in `relay/downloads.json` (not committed). `/f?p=` serves finished files.
- `relay/worker.js` + `wrangler.toml`: the Cloudflare Worker version. **Does not work with this
  provider** (error 1003, see §2). Still deployed at `https://yamtv-relay.yamenshatat.workers.dev`
  on the user's Cloudflare account (workers.dev subdomain `yamenshatat` was registered).
  Asked the user whether to delete it: no answer yet.
- `index.html` loads `?v=4` versions: **bump `?v=` on every published change** (cache).

### Running it
- Relay: Desktop shortcut **"Start yamTV relay"** (runs `node relay\local.js`, minimised).
  Not started automatically with Windows (offered; no answer yet).
- First use in Brave/Chrome: the browser asks to let the site reach localhost / local network:
  **Allow**. If the relay is down the player says "Can't reach the yamTV relay".

### Testing (how it was done)
- The in-app browser pane **blocks internet pages from reaching localhost**
  (`ERR_BLOCKED_BY_CLIENT`), so the published site cannot be tested end to end there. Tests ran
  on a local copy: serve the folder on `http://localhost:8765` with a small Node test server
  that injects the real login server-side (page uses fake `test`/`test`; never type the real
  password into a browser), set `localStorage['yamtv:relay']='http://127.0.0.1:8770'`, and for the
  test only add `localhost` to `allowHost` in `relay/local.json` (**put it back to the IPTV host
  only afterwards** and restart the relay from the shortcut).
- Verified this way: live TV (native HLS and hls.js), channel zapping, 4K MP4 and 4K MKV in
  Chromium, resume points, the "can't play" box, the phone layout, downloads (start, held while
  watching then resumed, Download season queued 15 episodes, cancel, playing a file from
  Downloads\yamTV). **Not verified:** the published site in the user's Brave with the relay.

### Open items for yamTV web
1. Check the download that is queued at 0 bytes in the relay (Captain America: The Winter
   Soldier). Probably held by streaming; if it never starts, look at `relay/local.js` hold logic.
2. Offer: import the 21.3 GB of videos already in `Downloads\yamTV` (Heartstopper S1-S3, Leviticus,
   a 32 MB .part) into the Downloads list (they came from the deleted Windows app; keys unknown).
3. Ask: auto-start the relay with Windows? Delete the unused Cloudflare Worker?
4. The first commit (`1816975`) has the IPTV host name in two comments; current files do not.
   Rewriting history was offered, not done.
5. Downloads stop when the relay closes; they resume on the next start.

---

## 4. yamTV Android TV app

- Local: `C:\Users\yamen\OneDrive\Desktop\infinitv-tv` — **not a git repository** (risk: no
  history, no backup beyond OneDrive). Recommend `git init` + a private repo, with the user's OK.
- Built for one TV box: Android 7.1.2, 1 GB RAM, Cortex-A53, Mali-450. App id
  `com.yamen.infinitv` (kept so updates install over the old one), label **yamTV**, version
  **1.6.3** (versionCode 14). APK: `infinitv-tv\yamTV.apk`. Build: `gradlew.bat assembleRelease`
  (Gradle 9.1 + AGP 9.0.1 cached), signed with the debug key, installed by USB stick.
- Design: WebView page (`app/src/main/assets`: `index.html`, `app.js` ES5-only (old WebView),
  `app.css`), native ExoPlayer (Media3 1.8) for video, `Catalog.java` for the big lists,
  `ConfirmDialog.java`, `LiveInfoView.java`. State in SharedPreferences via `Native.get/set`.
- Features built at the user's request (all in the TV app): remote-friendly desktop layout,
  Live TV preview + fullscreen with channel/guide panel on OK, Up = next channel (inverted on
  purpose), Movies/Series grids, search across the whole playlist, Continue watching (category
  in Movies/Series and a Home row), resume points saved every 5 s, playlist of a whole series
  (prev/next, auto-next), subtitles off by default with a CC list, 10 s seeking, "Stop
  watching?" dialog, "Go to episode" button, Settings > Data removal boxes, accent colours
  (Cyan default + 8 others), the comet-orbit logo (`Desktop\yamtv_logo.svg`).
- `README.md` there still has a "Windows app" section that is stale (the Windows app was deleted).
- Note: the TV's `app.js` contains Windows-only download code gated by `WIN` (harmless on the TV).

---

## 5. yamDrive (separate app, not built in this session)

- Repo https://github.com/YamenShatat/yamDrive (renamed from `yamtv` this session at the user's
  request). Site https://yamenshatat.github.io/yamDrive/. A Google Drive video player (Google
  sign-in, data synced to a Drive folder). Its Continue watching lives in Drive too ("Sync now"
  in its Settings brings it back). Shares the origin with yamTV: keep yamTV on `yamtv:` keys.

---

## 6. History in one paragraph

Started as a rebuild of infinitel8p/Extreme-InfiniTV for the TV (upstream needs Android 8; the TV
is 7.1.2). Renamed Extreme InfiniTV → Luma → yamTV. A Windows app (WebView2 + LibVLC) was built and
then deleted at the user's request (Smart App Control blocked it; its data folder, including the
user's watch history, was deleted with it). Then the website: Cloudflare relay failed (§2), the
relay moved to this PC, downloads were added to the website, and streams lock to the best quality.
