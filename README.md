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

### Two backend types

Voice Studio detects which one you're running from `backend-config.json`:

- **Job API** (`"tts_mode": "async-job"`, the recommended setup): the page sends `POST /jobs`, checks `GET /jobs/{id}` every few seconds, then downloads `GET /jobs/{id}/audio`. Every request is short, so Cloudflare's ~100-second limit never applies, however long the CPU takes. You can leave the page mid-job; it picks the job back up when you return.
- **Direct Chatterbox** (no `tts_mode`): the page calls `POST /tts`. **Stream (WAV)** is the default here because it starts sending audio right away; **Single file** (MP3/Opus) can time out on long scripts through Cloudflare.

### Voice cloning through the job API

The job API only forwards `/jobs`, `/health` and `/model-info`, so predefined voices work out of the box (the page falls back to Chatterbox's standard voice list). To enable **Voice Clone**, add these pass-through routes to `chatterbox_job_api.py` and restart it:

```python
# --- add near the other imports ---
from fastapi import UploadFile, File
from fastapi.responses import JSONResponse
from typing import List

def _proxy_get(path):
    try:
        r = requests.get(f"{CHATTERBOX}{path}", timeout=20)
        return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception:
        raise HTTPException(status_code=503, detail="Chatterbox is busy or unreachable.")

@app.get("/get_predefined_voices")
def get_predefined_voices():
    return _proxy_get("/get_predefined_voices")

@app.get("/get_reference_files")
def get_reference_files():
    return _proxy_get("/get_reference_files")

@app.post("/upload_reference")
async def upload_reference(files: List[UploadFile] = File(...)):
    parts = [("files", (f.filename, await f.read(), f.content_type or "application/octet-stream")) for f in files]
    try:
        r = requests.post(f"{CHATTERBOX}/upload_reference", files=parts, timeout=180)
        return JSONResponse(status_code=r.status_code, content=r.json())
    except Exception:
        raise HTTPException(status_code=503, detail="Chatterbox is busy or unreachable.")
```

File uploads in FastAPI need `python-multipart`: run `pip install python-multipart` in Colab before starting the job API.

### Notes

- Chunk size must be 50–500 (server limit).
- Uploaded references live only in the current Colab session; re-upload after a restart.
- The job API can't cancel a job that's already running. **Cancel Generation** stops waiting, and Chatterbox finishes that job in the background.
- Story Studio → **Send to Voice Studio** imports the spoken lines. In Voice Studio you can also import one character's lines at a time to voice each with a different voice.
- The **Manual backend override** is for recovery only; **Back to automatic** returns to `backend-config.json`.
- No tokens or secrets live in this site. The GitHub token stays in Colab secrets.

## Data

Everything is saved in the browser on each device. Use **Home → Download backup** to move work between devices.

## Logo note

The logo is an original design (play mark + wave) and is not YouTube's logo, which is a Google trademark. YouTube's brand rules also restrict using "YouTube" in app names, so if you ever publish or sell this, consider a name like "Tube Blue" or "Creator Blue".
