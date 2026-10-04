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
| Voice Studio · Story mode — multi-voice story narration in script order | `voice.html` | `js/voice-story.js` |

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

Best results: 10–20 seconds of clean speech, one speaker, no music, no reverb, no background noise (the page warns about very short or over-30-second clips). The file goes to `POST /upload_reference` as multipart field `files`. The page then re-reads `GET /get_reference_files` and only selects the file — and only enables Generate — once it's in that list; otherwise it says the reference isn't available to the TTS engine yet. Before every clone job it checks the list again. Clone jobs send only `reference_audio_filename`; predefined jobs send only `predefined_voice_id`.

If a job fails, the exact `job.error` from the server is shown in an expandable details area with a **Copy Error** button.

**Story mode (multiple voices)**

Switch to **Story · multiple voices** to voice a Story Studio script. Give each character a built-in voice or a clone reference (saved per story). A character set to **Clone** also gets a small **Choose file → Upload** row to add a new reference, with the same checks as the single-narrator upload. Each spoken line — or a speaker's back-to-back lines — becomes its own job. By default **All lines** are sent to the server one after another (or pick 1–3 at a time), and every clip keeps its place in the script. When all lines are done, the browser stitches them into one WAV in story order, with your chosen pause between lines and at scene changes. Each line's clip can also be played or downloaded on its own, and **Retry failed lines** re-sends only the lines that failed. The server has one CPU, so sending several jobs keeps it busy without gaps; it doesn't make each line faster.

**Keeps going when you close the app**

Jobs run on the server, not in the browser. The page saves what it's waiting for (job IDs, plus finished clips in the browser's IndexedDB), so closing the browser or the home-screen app doesn't lose anything. Reopen Voice Studio and it picks the single job or story run back up, collects the finished audio and builds the story track. With **All lines**, every line is already on the server, so nothing waits for the app. A run from an older Colab session (different backend address) is dropped, because those jobs are gone.

The latest generated audio stays on the Voice screen, after reloads too, until a new generation replaces it or you press **Clear Output**.

**Model engine**

Pick ⚡ Turbo, 🎙 Original or 🌍 Multilingual (only models the server reports as available can be chosen). Switching runs in the background: the page sends `POST /model-switch-jobs` and checks `GET /model-switch-jobs/{id}` every ~3 s (Preparing → Unloading → Loading), then refreshes model info, voices and references. The model the server reports in `/model-info` always wins over the saved preference. The controls follow the active model:

- **Turbo:** reaction tags; no Exaggeration/CFG.
- **Original:** Exaggeration + CFG Weight; reaction tags are left out of the text.
- **Multilingual:** Language (from the server's list) + Exaggeration; no CFG.

Each model has its own presets, and presets change settings only, never the voice.

**Emotion tags**

While you type a script in Voice Studio — or a character line in Story Studio — the reaction tags appear grouped (Laughter, Reaction, Vocal sounds) with an example of what to type. Tap one to insert it at your cursor.

**Settings**

Defaults are WAV, chunk size 400 (range 200–500), temperature 0.75, speed 1.00, exaggeration 0.50, CFG 0.50 and seed 0 (random). Speed is limited to 0.97–1.05 (Slower · Natural · Faster · Fast) because stronger time-stretching distorts the voice; for slower speech, use punctuation and pauses instead.

**Notes**

- **Refresh Backend** re-reads `backend-config.json` and reconnects. Use it after restarting Colab.
- **Manual backend override** is a fallback only. An address is saved only after it passes `/health` and `/model-info`. The page still prefers `backend-config.json`, uses the saved address only if that fails, and **Back to automatic** clears it.
- **Cancel Generation** stops waiting. The job API has no cancel route, so Chatterbox finishes that job in the background. If a future backend publishes `"job_cancel_template"` (e.g. `…/jobs/{job_id}/cancel`) in `backend-config.json`, Cancel will also call it.
- Uploaded references live only in the current Colab session; re-upload after a restart.
- The service worker never caches `backend-config.json` or any tunnel request, and always checks GitHub Pages for newer site files, so a reload shows the latest version.
- Story Studio → **Send to Voice Studio** imports the spoken lines. In Voice Studio you can also import one character's lines at a time to voice each with a different voice.
- No tokens or secrets live in this site. The GitHub token stays in Colab secrets.

## Data

Everything is saved in the browser on each device. Use **Home → Download backup** to move work between devices.

## Logo note

The logo is an original design (play mark + wave) and is not YouTube's logo, which is a Google trademark. YouTube's brand rules also restrict using "YouTube" in app names, so if you ever publish or sell this, consider a name like "Tube Blue" or "Creator Blue".
