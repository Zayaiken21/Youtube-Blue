# Youtube Blue

A blue creator toolkit for designing a YouTube channel, tracking analytics, and writing narrated stories with a cast of characters. Plain HTML, CSS and vanilla JavaScript — no frameworks, no libraries, no build step. Installs to the home screen on iPhone, iPad and Android and works offline.

## Pages

| Page | File | Script |
|---|---|---|
| Home — stats, install help, backup/restore | `index.html` | `js/home.js` |
| Channel Design — banner, profile picture, thumbnail, About, keywords, checklist | `design.html` | `js/design.js` |
| Analytics — video log, KPIs, goals, charts, insights, CSV import/export | `analytics.html` | `js/analytics.js` |
| Story Studio — templates, characters (+), one-voice / multi-voice, teleprompter | `stories.html` | `js/stories.js` |
| Voice Studio — Chatterbox text-to-speech, predefined voices, voice cloning, download | `voice.html` | `js/voice.js` |

Shared pieces:

- `css/style.css` — all styling (blue theme, menu, layouts for every screen size)
- `js/core.js` — shared helpers only: menu, saving, toasts, downloads, install button, offline
- `sw.js` — offline cache; `manifest.webmanifest` — home-screen app settings
- `icons/` — original logo (`logo.svg`) and app icons

Each page script only touches its own page, so you can edit one without affecting the others. Each page also saves to its own storage key (`design`, `analytics`, `stories`).

## Put it on GitHub Pages

1. Create a new repository (for example `youtube-blue`).
2. Upload everything in this folder to the repository root (keep the `css`, `js` and `icons` folders).
3. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/youtube-blue/`.

## Add to home screen

- **iPhone / iPad:** open the site in Safari → Share → *Add to Home Screen*.
- **Android:** open in Chrome → tap *Install app* on the Home page, or ⋮ → *Install app*.

## Updating

The site always loads the newest files when online. If an installed copy seems stuck on an old version, change `CACHE` in `sw.js` (e.g. `yt-blue-v2`) and push.

## Voice Studio + Chatterbox

Voice Studio turns scripts into speech using your own Chatterbox Turbo server in Google Colab.

**How it connects**

1. The Colab startup cell starts Chatterbox (private, port 8004), the Youtube Blue job API (port 8010) and a Cloudflare tunnel to 8010, then writes the live address into `backend-config.json`.
2. Voice Studio loads `backend-config.json?ts=…` with `cache: "no-store"` from this site's own folder, so it works under `/Youtube-Blue/`.
3. It checks `GET /health` (must return `ok: true`), then `GET /model-info`, and only then shows **Online**. The tunnel's bare root returns `{"detail":"Not Found"}` by design and is never used as a health check.
4. Voices come from `GET /get_predefined_voices`, and saved clone references from `GET /get_reference_files`.

**How speech is made**

The browser never calls Chatterbox's `/tts`. It sends `POST /jobs`, checks `GET /jobs/{id}` every ~3 seconds (Queued → Generating speech → Processing audio), then downloads `GET /jobs/{id}/audio`. Every request is short, so Cloudflare's ~100-second limit (HTTP 524) never applies, however long the CPU takes. You can leave the page mid-job; it picks the job back up when you return.

**Voice cloning**

Upload a 5–30 second WAV/MP3 of one speaker. It goes to `POST /upload_reference` as multipart field `files`; the page then refreshes the reference list and selects the new file. Jobs send that filename as `reference_audio_filename`.

**Settings**

Defaults are WAV, chunk size 400 (350–450 works best on CPU; the server accepts 50–500), temperature 0.8, speed 1.0 and seed 0 (random).

**Notes**

- **Refresh Backend** re-reads `backend-config.json` and reconnects. Use it after restarting Colab.
- **Manual backend override** is a fallback only. An address is saved only after it passes `/health` and `/model-info`. The page still prefers `backend-config.json`, uses the saved address only if that fails, and **Back to automatic** clears it.
- **Cancel Generation** stops waiting. The job API has no cancel route, so Chatterbox finishes that job in the background. If a future backend publishes `"job_cancel_template"` (e.g. `…/jobs/{job_id}/cancel`) in `backend-config.json`, Cancel will also call it.
- Uploaded references live only in the current Colab session; re-upload after a restart.
- The service worker never caches `backend-config.json` or any tunnel request.
- Story Studio → **Send to Voice Studio** imports the spoken lines. In Voice Studio you can also import one character's lines at a time to voice each with a different voice.
- No tokens or secrets live in this site. The GitHub token stays in Colab secrets.

## Data

Everything is saved in the browser on each device. Use **Home → Download backup** to move work between devices.

## Logo note

The logo is an original design (play mark + wave) and is not YouTube's logo, which is a Google trademark. YouTube's brand rules also restrict using "YouTube" in app names, so if you ever publish or sell this, consider a name like "Tube Blue" or "Creator Blue".
