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

Voice Studio talks to your own Chatterbox TTS server (running in Google Colab).

1. Run the Colab startup cell. It starts Chatterbox, opens a tunnel, and writes the live address into `backend-config.json` in this repo.
2. Open Voice Studio. It reads `backend-config.json` automatically and shows **Online** only after the server actually answers.
3. Pick a predefined voice, or switch to **Voice Clone** and upload a 5–30 second WAV/MP3 of one speaker.
4. Generate, listen, and tap **Download Audio**.

Notes:

- **Stream (WAV)** delivery is the default. It sends audio as each chunk finishes, shows live progress, and avoids Cloudflare's ~100-second tunnel timeout on long CPU jobs. **Single file** gives MP3/Opus but may time out on long scripts.
- Chunk size must be 50–500 (server limit).
- Uploaded references live only in the current Colab session; re-upload after a restart.
- Story Studio → **Send to Voice Studio** imports the spoken lines. In Voice Studio you can also import one character's lines at a time to voice each with a different voice.
- The **Manual backend override** is for recovery only; **Back to automatic** returns to `backend-config.json`.
- No tokens or secrets live in this site. The GitHub token stays in Colab secrets.

## Data

Everything is saved in the browser on each device. Use **Home → Download backup** to move work between devices.

## Logo note

The logo is an original design (play mark + wave) and is not YouTube's logo, which is a Google trademark. YouTube's brand rules also restrict using "YouTube" in app names, so if you ever publish or sell this, consider a name like "Tube Blue" or "Creator Blue".
