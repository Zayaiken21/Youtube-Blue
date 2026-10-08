# Youtube Blue

A blue creator toolkit for designing a YouTube channel, tracking analytics, and writing narrated stories with a cast of characters. Plain HTML, CSS and vanilla JavaScript — no frameworks, no libraries, no build step. Installs to the home screen on iPhone, iPad and Android and works offline.

## Pages

| Page | File | Script |
|---|---|---|
| Home — stats, install help, backup/restore | `index.html` | `js/home.js` |
| Channel Design — banner, profile picture, thumbnail, About, keywords, checklist | `design.html` | `js/design.js` |
| Analytics — video log, KPIs, goals, charts, insights, CSV import/export | `analytics.html` | `js/analytics.js` |
| Story Studio — templates, characters (+), one-voice / multi-voice, teleprompter | `stories.html` | `js/stories.js` |
| Prompts — ready-made AI prompts (copy / PDF) that answer in the YouTube Blue format | `prompts.html` | `js/prompts.js`, `prompts/` |
| Voice Studio — Chatterbox text-to-speech, predefined voices, voice cloning, download | `voice.html` | `js/voice.js` |
| Voice Studio · Story mode — multi-voice story narration in script order | `voice.html` | `js/voice-story.js` |

Shared pieces:

- `css/style.css` — all styling (blue theme, menu, layouts for every screen size)
- `js/core.js` — shared helpers only: menu, saving, toasts, downloads, install button, offline
- `sw.js` — offline cache; `manifest.webmanifest` — home-screen app settings
- `icons/` — original logo (`logo.svg`) and app icons

Each page script only touches its own page, so you can edit one without affecting the others. Each page also saves to its own storage key (`design`, `analytics`, `stories`).

## Upload Scheduler

`scheduler.html` + `js/scheduler.js`: a niche analyzer and weekly upload planner.

- **17 built-in niches** (gaming, tech, finance, comedy, education, fitness, cooking, fashion, travel, music, DIY, automotive, kids/animation, news, pets, motivation, sports), each with weekly Shorts/long-form volume, best days, peak time windows and audience behaviour. Saturation and retention are planning estimates.
- **＋ Add niche** to create your own (name, volumes, two peak windows, best days, behaviour, saturation, retention). Custom niches can be edited or deleted and are saved on the device.
- **7-day × 4-block calendar** (Morning, Midday, Afternoon, Night Peak) with an audience-activity heatmap: darker = more viewers, ★ = the niche's best day + time window.
- **Tap a slot** to add a Short or a Long-Form upload; tap again to remove. Days with more than 3 uploads get a ⚠ badge and a warning (YouTube notifies subscribers about at most 3 uploads per channel in 24 hours).
- **Live metrics**: weekly uploads, notifications sent (capped per day), Schedule Optimization Rating (% of uploads in best windows) and fit vs. the niche's recommended volume.
- **✨ Auto-plan** fills the niche's minimum weekly volume into the best slots without breaking the 3-a-day cap.

## Comic to Video
`comic.html` turns comic pages into a video for YouTube Shorts (2D comics, AI comic grids, animation stills).

1. **Add pages.** Choose *Comic pages* (panels are found) or *Single images* (each picture is one slide, formatted with the same templates). Choose one or more images. Panels are found automatically (`js/comic-panels.js`). The page's gutter colour is read from the page itself, so white, off-white or cream, black and coloured gutters all work, as do JPEG scans, transparent PNGs and phone screenshots with bars around the comic. Panels are numbered in story order: row by row, left to right, and a tall panel reads with the row it starts in.
2. **Check panels.** Tools: **🔍 Find panels** (run detection again), **✏️ Draw** (drag a box) and **＋ Whole page**. Tap a box to select it, then **✂ Split top / bottom**, **✂ Split left / right** (cuts along the most gutter-like line) or **🗑 Remove**. *Order & timing* lists every panel with ↑ ↓, seconds and its own camera motion.
3. **Sound & style.** Use a story or take from Voice Studio (*Your audio*) or any audio file; the voice plays exactly as made.
   - **Camera style:** *One panel at a time* (each panel framed on its own), *Moving camera* (glides from panel to panel, showing only the panel, never the rest of the page) or *One panel at a time · full screen*. Tall panels and whole pages are read top to bottom.
   - **Templates:** Classic, Comic pop, Cinema, Neon night, Scrapbook, Sunburst and Storybook set the background, panel frame and overlay in one tap. Each can also be changed on its own:
     - Backgrounds: soft blur, solid, gradient, comic dots, paper, sunburst.
     - Frames: white comic border, clean, bold comic outline, Polaroid, neon, none.
     - Overlays: vignette, film grain, comic dots, warm light leak.
   - **Your own background or overlay (PNG):** upload it and it's fitted to the video shape automatically, keeping its proportions. It's saved on the device.
   - Shape (9:16, 1:1, 16:9), transition and an optional channel tag.
4. **Preview & export.** Play the preview, then **🎬 Make the video**. Chrome, Edge and new Safari build the MP4 directly (WebCodecs + `js/vendor/mp4-muxer.min.js`, MIT), usually much faster than the video's length, with a progress bar and time left. Other browsers, or a device that turns out slower than real time, record in real time instead. Shorts can be up to 3 minutes; the page warns when a Short runs longer.

**Narrate & dub (Voice track → 🗣 Narrate & dub).** Each panel's caption is spoken as its own clip, so panels and captions are timed to the real speech: a panel lasts as long as its clip plus a short breath, and each caption appears as its words are spoken. Pick a language and press *Make narration*. Missing translations are made first, automatically and instantly on the device in Chrome or Edge on a computer.

Two voice engines:
- **📱 On this device, no server (default):** Piper neural voices run in the browser (`js/comic-voice.js`: espeak-ng phonemizer in WebAssembly, ONNX Runtime Web, Piper voice models from Hugging Face). Each voice downloads once (about 20–75 MB) into the browser cache, then works instantly and offline. Voices are available for English, Spanish, Portuguese, French, German, Italian, Russian, Arabic, Turkish, Vietnamese and Chinese. You can pick one voice, or *A different voice for each character*.
- **☁️ Chatterbox, my cloned voices:** your own voices (each character's Voice Studio voice), the same voice in every language via Chatterbox Multilingual (23 languages). Needs the Colab server; the page asks before switching its model.

Clips are saved on the device per language, so only changed panels are made again. *Make one video per language* gives each language its own dubbed voice.

**Auto-sync to the voice (no button).** As soon as a voice track is added — from Voice Studio or an audio file — the page listens to it, finds where the speech and the pauses are (`js/comic-sync.js`), and times everything to it: each panel gets the part of the talking that matches how much its caption says (counted in syllables), every cut lands in a real pause just before the next words, and panels with no caption get a short moment in the pause. Captions appear as their words are spoken and wait through pauses. A **Voice Studio story track** goes further: it carries the exact start and end of every line, so each panel's caption is matched to its own lines and the panel is fully on screen just before its first line, with every caption starting on its line. Audio files from anywhere else sync automatically from their pauses. Picture-only panels never delay a speaking panel. Exported videos keep the voice exactly on the pictures (the MP4 sound-padding value some browsers get wrong is corrected, and the real-time recorder follows the audio clock). It re-syncs by itself when you add, remove, reorder or re-caption panels; the panel list shows *🎯 timed to the voice* and the seconds boxes are locked while a voice is on. With *No sound*, panels go back to their own times. *Narrate & dub* was already timed clip by clip and works as before.

**Each line on the panel that shows it.** *Fill captions* reads the words in every panel's speech bubbles on your device (Tesseract OCR from jsDelivr, ~3 MB the first time, then cached; each panel is read once and remembered) and puts each story line on the panel whose bubble shows it, keeping the story order. Lines it can't read (a stylised sign, a scribble) go on the panel between their neighbours that has words nobody matched; panels with no words get no line and show in the pauses — never over someone's words. Choosing a Voice Studio story track for panels with no captions fills them this way by itself. Captions that were filled from a story before this (spread evenly) are re-matched to the bubbles by themselves when the page opens or a voice is added — captions you typed are never changed. Lines spoken between two panels' bubbles go with the panel they talk about. A note under *Fill captions* says how the lines were placed, and **◀ line / line ▶** on a panel move a line to the panel before or after. Offline or on comics without bubbles, lines are spread in order as before.

**Subtitles (on by default).** Every panel has its own caption, so a subtitle never runs across two panels. *Fill captions* shares a Story Studio story's spoken lines across the panels in order (grammar tidied, `[tags]` and scene headings left out), and any caption can be edited under *Order & timing*.
- **Styles:** Bold pop, Karaoke, Clean box, Minimal, Highlight bar, Comic bubble, Neon and Typewriter. You can change the size, text and highlight colours, words per caption (2–8) and ALL CAPS.
- **Smart position:** for 9:16 the panel moves up a little and the caption sits just under it, above the area YouTube covers with the title and buttons. 1:1 and 16:9 get the same treatment. Top, middle and bottom are there too.
- **Steady pace:** captions change at a reading pace (Relaxed, Steady or Quick, in characters a second), not squeezed into a panel's time. A panel stays up until its caption has been read. Captions fade in gently and never run off the screen.
- **Languages:** pick up to 10 of 16 popular languages and press *Translate captions*. In Chrome or Edge on a computer, translation runs on the device with the browser's built-in translator: instant, private and unlimited. If it isn't ready within a few seconds, or on phones and other browsers, the free MyMemory service is used: about 5,000 characters a day per device, or about 50,000 with an email under *Translation limit*. Translations are saved and can be edited. Choose the subtitle language for the video, or press *Make one video per language*. After exporting, download an `.srt` file per language to upload in YouTube Studio → Subtitles.

Pages, panels, captions and settings are saved on the device (IndexedDB `youtube-blue-comic`).

## Put it on GitHub Pages

1. Create a new repository (for example `youtube-blue`).
2. Upload everything in this folder to the repository root (keep the `css`, `js` and `icons` folders).
3. Go to **Settings → Pages**, set **Source** to *Deploy from a branch*, choose `main` and `/ (root)`, and save.
4. After a minute the site is live at `https://<your-username>.github.io/youtube-blue/`.

## Works offline

The service worker saves the whole app the first time it's opened. Every page then opens with no connection, or on a weak one: if the network doesn't answer in about 3 seconds, the saved copy opens. Story Studio, Channel Design, Analytics, sending a story to Voice Studio, and Voice Studio's scripts, Story mode and character settings all work offline (everything is stored on the device). Only generating speech needs the server; Voice Studio shows "Backend Offline" and reconnects by itself when the connection returns.

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

Switch to **Story · multiple voices** to voice a Story Studio script. Give each character a built-in voice or a clone reference (saved per story). Story mode has no shared settings card: each character has its own **🎚️ Voice settings** dropdown with everything — presets for the active model, temperature, speed, seed, exaggeration / CFG (when the model supports them), language (Multilingual), and text splitting / chunk size. The controls change with Turbo, Original or Multilingual. Every character starts at the defaults, and their lines are generated with whatever you set. Story audio is always WAV. A character set to **Clone** also gets a small **Choose file → Upload** row to add a new reference, with the same checks as the single-narrator upload. Each spoken line — or a speaker's back-to-back lines — becomes its own job. **Lines per run**: *All lines* voices the whole story; pick 1, 2, 3, 5, 10 or type any number to make just that many lines and stop — pressing Generate again continues with the next ones (finished lines are kept, and a *Story so far* track is saved after each run). Generating always keeps going by itself if you close or swipe away the app (whatever the setting — there's nothing to turn on), and the timer keeps counting from when you pressed Generate. **Stop** sends nothing more; a line the server is already making is still collected and becomes the last line (press Stop again to leave it). Every clip keeps its place in the script. When all lines are done, the browser stitches them into one WAV in story order, with your chosen pause between lines and at scene changes. Each line's clip can also be played or downloaded on its own, and **Retry failed lines** re-sends only the lines that failed. The server has one CPU, so sending several jobs keeps it busy without gaps; it doesn't make each line faster.

**Keeps going when you close the app**

Jobs run on the server, not in the browser. The page saves what it's waiting for (job IDs, plus finished clips in the browser's IndexedDB), so closing the browser or the home-screen app doesn't lose anything. Reopen Voice Studio and it picks the single job or story run back up, collects the finished audio and builds the story track. The moment the app is hidden, closed or swiped away, every line not yet sent is handed to the server, so the story always finishes in the background. A run from an older Colab session (different backend address) is dropped, because those jobs are gone.

The latest generated audio stays on the Voice screen, after reloads too, until a new generation replaces it or you press **Clear Output**.

**When someone else is generating**

The server makes one voice at a time. While idle, the page checks `GET /state` every few seconds (the job server only, never Chatterbox). If a generation is running that isn't yours, the status shows **In use · another user**, a notice explains it, and Generate, Again, model switching, reference uploads and list refreshes are locked. Your script, voices and character settings stay editable. Everything unlocks by itself when the server is free. A job you stopped waiting for shows as **Busy · finishing** instead, even after a reload.

**Voice library (Presets · Our Voices · My Voices · Chatterbox Voices)**

One **Voice** picker (and the same picker on every Story character) lists:

- **Presets:** audio files in `Voices/Preset Voices/` on GitHub. Add a WAV or MP3 there and it shows for everyone; the file name is the voice name.
- **Our Voices:** files in `Voices/Our Voices/`, voices people chose to share.
- **My Voices:** voices imported with **➕ Import a voice**. They're stored in the app's own storage on that device only: private, never uploaded to GitHub.
- **Chatterbox Voices:** the server's own built-in voices.

**▶ Hear a voice before using it:** a round play button sits next to the Voice picker and next to every Story character's name for Presets, Our Voices and My Voices (imported, private or shared). It plays that voice's own file instantly and turns into ❚❚ while playing. Chatterbox Voices have no sample file, so they have no play button (making a sample on the server made the page lag).

Picking a Preset, Our Voices or My Voices voice needs no setup. Right before generating, the page sends that voice to the server once per server session, confirms the server lists it, then the job clones it. After a Colab restart it's sent again automatically.

**Share with everyone** is off by default. Turning it on (with a "this is my voice / I have permission" check), or tapping **🌐 Share** on a voice in My Voices, sends the voice to the job server's `POST /share-voice` route (Colab Cell 2). The server commits it to `Voices/Our Voices` with the GitHub token that only lives in Colab, so it shows up for everyone a minute or two later. The site never holds a token. If the server is offline, busy, rate-limited or doesn't have the route yet, the share waits and retries by itself, even after the app is closed and reopened. My Voices shows each step: Waiting / Sharing… / Shared · appearing shortly / In Our Voices.

`POST /share-voice` (multipart: `file`, `name`, `client_id`) → `{"ok": true, "status": "published" | "already_shared", "name", "path"}`. A taken name gets " 2", " 3"…; existing voices are never overwritten. `voice_share_endpoint` in `backend-config.json` can point elsewhere; otherwise `backend_url + /share-voice` is used.

`Voices/index.json` lists the library and is rebuilt by the **Voice library index** GitHub Action whenever a file in `Voices/` changes. If it's missing, the page reads the folders through the public GitHub API instead.

**Import or record a voice:** any audio file (MP3, M4A, OGG, WebM, FLAC…) is turned into a WAV in the browser. Anything over 30 seconds is trimmed at the last pause before 29.5 s. **🎙 Record** records from the microphone (up to 30 s, stops by itself) and gives a WAV you can play back before importing. Library voices longer than 30 s are trimmed the same way before they're sent to the server.

**Your audio (nothing gets lost)**

Every take is saved quietly on the device: each single-voice generation and every full story track. Story lines stay in the multi-voice story list itself, each with ▶ play and ⬇ Clip, instead of filling Your audio. Nothing is downloaded automatically; it simply stays after a refresh or closing the app. A new generation never wipes earlier ones. **Clear all** removes every saved take, the player and Story mode's finished lines at the same time.

Every clip has a round ▶ button right next to its name that turns into ❚❚ while playing, with a progress ring. Tap to pause, tap again to resume. Only one clip plays at a time. In Story mode, finished lines can be played while the rest are still generating. The ⬇ icon downloads a clip only when tapped.

**Match volume (story track only, off by default)**

Every clip and story line is saved exactly as Chatterbox made it. When *Match volume in the full story track* is on, only the stitched story track gets a light per-line volume step (±6 dB at most, never past a line's own peak). Clips saved earlier while the old setting was on are put back to their original sound automatically.

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

### Group lines — several characters speaking at once
In a multi-voice story, tap **👥 Together** on any line and tick who says it with the main speaker (for example Mom + Dad + Kid shouting "Surprise!"). The button then shows how many are speaking, the cast cards and *Who speaks how much* count the line for everyone in it, the script export labels it `MOM + DAD (together)`, voice sheets mark it "(together with …)", and the teleprompter shows every name. In Voice Studio's Story mode the line becomes one part per person, each made with that character's own voice and settings (tagged "👥 together with …"). When the story track is stitched, the voices are put **in sync**: the main speaker sets the timing and every other voice is lined up with them word by word (`js/voice-sync.js` — dynamic time warping on the sound of each voice, then a gentle WSOLA speed-up/slow-down that keeps pitch and tone; no phase vocoder, so no echo). Everyone starts on the same sample, each voice is matched to the main speaker's loudness, and the mix is kept from clipping. Group lines only apply in multi-voice stories; in one-voice mode they read as a normal line.

### Import a script (paste or PDF / Word)
**📄 Import** (next to *＋ New*) or **📄 Import script** (under the script) opens an import window. Paste a script, or open a **PDF**, **Word** (.docx and old .doc), **.odt**, **.rtf**, **.txt / .md / .fountain** or **.html** file — or drop the file on the box. Everything is read on your device (PDFs use the bundled PDF.js in `js/vendor/pdfjs/`, so no upload anywhere). Characters are created from the names in front of the lines:
- `ALEX: Ugh, the Wi-Fi is down!` — a name and a colon. Times or numbers in front (`00:05 BELLA: …`, `12. MAX: …`), `**Bold:**`, `[Name]:` and `Name (whispering):` all work.
- Screenplay style — a name in CAPITALS on its own line with their words right under it (`(V.O.)`, `(CONT'D)` are ignored, and wrapped lines are joined).
- Two-column tables (name | line) from Word or PDF.
- `MOM & DAD:` / `Mom and Dad:` become a group line; `ALL:`, `EVERYONE:`, `BOTH:` make everyone in the script say it together.
- `NARRATOR:` goes to the Narrator. `Scene 2: …`, `INT. KITCHEN`, and Word headings start scenes. `[SFX: …]`, `Music: …`, `Note: …` become directions. `(laughing)`, `*sighs*` become `[laugh]` / `[sigh]` reaction tags. A `Characters:` list (`Alex – the hero`) fills in each character's role.

**Only labeled lines are spoken.** A list of how each character sounds — under a heading like `CHARACTERS`, `Voice tones` or `Cast`, or a run of short `Name: how they sound` notes before the dialogue (`Customer: Confused, then dramatically outraged.`) — becomes each character's role, never spoken lines. A CAPS title at the top is the title, not a character. Text with no name in front is left out by default whenever the script has named speakers.

**Narrator vs. main character.** `NARRATOR:` lines keep the Narrator's own voice. When the main character tells the story, write `ALEX (narrating): …` or `NARRATOR (Alex): …`, or mark them in the Characters list (`Alex – main character and narrator`); the import window's **Narration is read by** menu picks them automatically, and you can switch any script's narration to a character there.

The preview shows every line with who says it. Untick anything that was mistaken for a name, choose what happens to text with no name (Narrator reads it / Direction / Leave out — when the script labels its own `NARRATOR:` lines, unlabeled headings and instructions are left out by default), set the title, and choose **a new story**, **replace this story's script**, or **add to the end**. Pictures and scanned PDFs have no text to read, so the window says so and asks for the text instead.

### The YouTube Blue Script Format (what the Prompts page asks your AI for)
```
TITLE: The Great Car Packing Disaster
=== CHARACTERS ===
JAYDEN | Main character, 9, narrates his own story | Fast, bright kid voice
=== SCRIPT ===
JAYDEN (narrating): I said I could pack the car in ten minutes.
JAYDEN + AUNT NICOLE: [gasp] We forgot Grandma!
=== END ===
```
When a pasted script has these markers, the importer is strict: only `NAME: words` lines inside `=== SCRIPT ===` are spoken; `NAME | role | voice` lines become each character's role, voice notes and closest voice style; everything after `=== END ===` (storyboards, image prompts, hashtags) is ignored; a name used in the script but missing from CHARACTERS starts unticked. A sheet with only a CHARACTERS block (from the Character Creator prompt) adds those characters to the open story. Scripts without markers still import with the smart rules above, which also skip long character notes, "Narrator: NO / Absent" notes and labels such as "Voice Script:".

## Prompts
`prompts.html` lists prompts by category (📖 Stories, 🎭 Characters). Each has **Copy prompt**, **PDF**, **.txt** and **Show prompt**. The text lives in `prompts/<name>.txt` (everything after the `────` line is what gets copied); the PDFs are built from the same files with `python3 tools/build-prompt-pdfs.py`. To add a prompt: add its .txt, add it to `PROMPTS` in that script and in `js/prompts.js`, and rebuild.

### Characters belong to each story
Every story has its own cast. **＋ New** starts with only the Narrator, an import into a new story brings only the characters in that script, and replacing a story's script replaces its cast (a character with the same name keeps its color and voice). Voice Studio's character voices are saved per story too, and are removed when the story is deleted.

### Grammar tidy-up when a story moves to Voice Studio
Every story line that comes into Voice Studio (Import lines, or Story mode) is tidied on the device first, so the voice reads clean sentences: capitals at the start of sentences and on character names, `i` → `I`, missing apostrophes (`dont` → `don't`, `im` → `I'm`), a full stop or `?` at the end of every line, `!!!` → `!`, `..` → `...`, doubled words (`the the`), and spacing around punctuation. It also keeps speech flowing: a mid-sentence `...` or dash becomes a comma pause, `?!` becomes `?`, emojis, `*whispers*`-style stage directions and trailing #hashtags are dropped, `&` is read as "and", and lines written in ALL CAPS are read normally. It never rewrites your words, and `[laugh]`-style tags stay exactly where they are. Your story in Story Studio isn't changed.

**To remove it:** delete `js/voice-grammar.js` and its `<script>` line in `voice.html` (Voice Studio works without it). **To roll the whole site back** to before this feature, use `backups/youtube-blue-before-grammar-2026-10-06.zip` or git commit `1d82a91` (see `backups/README.md`).

## Data

Everything is saved in the browser on each device. Use **Home → Download backup** to move work between devices.

## Logo note

The logo is an original design (play mark + wave) and is not YouTube's logo, which is a Google trademark. YouTube's brand rules also restrict using "YouTube" in app names, so if you ever publish or sell this, consider a name like "Tube Blue" or "Creator Blue".
