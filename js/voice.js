/* =========================================================
   Youtube Blue — voice.js
   Controls the Voice Studio page only: backend discovery + health,
   predefined voices, voice-clone references, script editor,
   async speech jobs, playback and download.

   Backend (see README): the Youtube Blue job API in Colab, reached
   through a temporary Cloudflare address published in
   backend-config.json. The browser never calls Chatterbox's /tts:
     POST /jobs → poll GET /jobs/{id} → GET /jobs/{id}/audio
   Saved under storage keys "voice", "voiceScript", "voiceList",
   "voiceJob" (job in progress) and "voiceOverride" (manual fallback).
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;

  /* ---------- Constants ---------- */
  var DEFAULT_TAGS = ['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan', 'shush'];
  var SETTINGS_VERSION = 8;
  var DEFAULTS = {
    voiceKey: '',          // 'builtin:<file>' | 'preset:<file>' | 'shared:<file>' | 'mine:<id>' (js/voice-library.js)
    format: 'wav', chunk: 400, temperature: 0.8, speed: 1, seed: 42, split: true, level: false,   // Chatterbox's own defaults; fixed seed = same voice in every chunk
    exaggeration: 0.5, cfg: 0.5, language: 'en', preferredModel: ''
  };
  var CHUNK_MIN = 200, CHUNK_MAX = 500;         // user-facing range (server accepts 50–500)
  var TEMP_MIN = 0.05, TEMP_MAX = 1.5;          // 0 would divide by zero in sampling
  var EXAG_MIN = 0.25, EXAG_MAX = 2, CFG_MIN = 0.2, CFG_MAX = 1;
  var SWITCH_POLL_MS = 3000, STATE_POLL_MS = 5000;
  var MODEL_NAMES = { turbo: 'Turbo', original: 'Original Chatterbox', multilingual: 'Multilingual' };
  // What each model accepts. Turbo: reaction tags. Original: exaggeration + CFG.
  // Multilingual: language + exaggeration (no CFG).
  var MODEL_CAPS = {
    turbo: { tags: true, exaggeration: false, cfg: false, language: false },
    original: { tags: false, exaggeration: true, cfg: true, language: false },
    multilingual: { tags: false, exaggeration: true, cfg: false, language: true }
  };
  var PRESETS = {
    turbo: [
      ['Natural', { temperature: 0.80, speed: 1.00, chunk: 400 }],
      ['Stable', { temperature: 0.55, speed: 1.00, chunk: 350 }],
      ['Energetic', { temperature: 0.95, speed: 1.00, chunk: 400 }],
      ['Comedy', { temperature: 0.90, speed: 1.00, chunk: 350 }],
      ['Narration', { temperature: 0.65, speed: 1.00, chunk: 400 }]],
    original: [
      ['Natural', { temperature: 0.80, exaggeration: 0.50, cfg: 0.50, speed: 1.00, chunk: 400 }],
      ['Expressive', { temperature: 0.80, exaggeration: 0.70, cfg: 0.30, speed: 1.00, chunk: 400 }],
      ['Dramatic', { temperature: 0.90, exaggeration: 1.30, cfg: 0.60, speed: 1.00, chunk: 400 }],
      ['Subtle', { temperature: 0.60, exaggeration: 0.35, cfg: 0.50, speed: 1.00, chunk: 400 }]],
    multilingual: [
      ['Natural', { temperature: 0.80, exaggeration: 0.50, speed: 1.00, chunk: 400 }],
      ['Expressive', { temperature: 0.85, exaggeration: 1.00, speed: 1.00, chunk: 400 }],
      ['Narration', { temperature: 0.65, exaggeration: 0.40, speed: 1.00, chunk: 400 }]]
  };
  // How the reaction-tag chips are grouped (any extra tags from the server go in "More").
  var TAG_GROUPS = [['Laughter', ['laugh', 'chuckle']], ['Reaction', ['sigh', 'gasp', 'groan']], ['Vocal sounds', ['cough', 'clear throat', 'sniff', 'shush']]];
  // Speed is a time-stretch: outside this band it audibly distorts the voice.
  var SPEED_MIN = 0.97, SPEED_MAX = 1.05;
  var REF_SHORT_SEC = 5, REF_LONG_SEC = 30;     // reference clip guidance (server rejects > 30 s)
  var LIST_STALE_MS = 15000;                    // re-fetch voice/reference lists when older than this
  var HEALTH_INTERVAL_MS = 60000;               // gentle background check while idle
  var HEALTH_TIMEOUT_MS = 45000;                // one health/list request — never generation
  var CONFIG_TIMEOUT_MS = 20000;
  var UPLOAD_TIMEOUT_MS = 180000;
  var SHORT_TIMEOUT_MS = 60000;                 // job create / job status (each returns at once)
  var AUDIO_TIMEOUT_MS = 600000;                // fetching a finished audio file
  var JOB_POLL_MS = 1500, JOB_POLL_MAX_MS = 15000, JOB_MAX_FAILS = 25;

  // Where each backend route lives. backend-config.json's own URL wins when it
  // points at the active backend; otherwise backend_url + path.
  var ROUTES = {
    health: ['health_endpoint', '/health'],
    info: ['model_info', '/model-info'],
    jobs: ['job_endpoint', '/jobs'],
    voices: ['predefined_voices_endpoint', '/get_predefined_voices'],
    refs: ['reference_files_endpoint', '/get_reference_files'],
    upload: ['reference_upload_endpoint', '/upload_reference'],
    models: ['models_endpoint', '/models'],
    state: ['backend_state_endpoint', '/state'],
    modelSwitch: ['model_switch_job_endpoint', '/model-switch-jobs'],
    share: ['voice_share_endpoint', '/share-voice']     // Cell 2: commits a shared voice to Voices/Our Voices
  };

  /* ---------- State ---------- */
  var settings = loadSettings();
  var app = {
    state: 'connecting',
    backend: '',
    source: '',          // 'config' | 'manual'
    config: null,
    info: null,
    generating: false,
    uploading: false,
    audioUrl: null,
    healthTimer: null,
    healthBusy: false,
    healthFails: 0,
    elapsedTimer: null,
    startedAt: 0,
    voicesLoaded: false,
    busy: false,         // job API is up but Chatterbox is busy
    job: null,           // active job { id, ext, fails, delay, audioTries }
    pollTimer: null,
    orphanJob: null,     // a job we stopped waiting for that may still be running
    jobToken: 0,
    preparing: false,
    prepToken: 0,
    cloneAvailable: true,
    models: null,        // GET /models list (null = not loaded / route missing)
    switching: null,     // active model switch { id, model, fails, startedAt }
    switchTimer: null,
    remoteSwitching: false,   // /state says a switch is running that this page didn't start
    remoteBusy: false,   // /state says a generation is running that this page isn't waiting for (another user)
    ownBg: false,        // …except it's our own stopped job finishing in the background
    lastOwnEnd: 0,       // when this page's own generation ended (server may still report it for a moment)
    refFiles: null,      // last reference list the server returned (null = not loaded yet)
    voices: [],          // last predefined voice list [{display_name, filename}]
    voicesAt: 0, refsAt: 0
  };

  function loadSettings() {
    var saved = YB.store.get('voice', {});
    var v = Number(saved.v) || 0;
    if (v < 2) {
      // Earlier versions defaulted to MP3 + chunk 240 for the old /tts path.
      if (saved.format === 'mp3') saved.format = DEFAULTS.format;
      if (saved.chunk === 240) saved.chunk = DEFAULTS.chunk;
      delete saved.delivery;
    }
    if (v < 3 && saved.temperature === 0.8) saved.temperature = DEFAULTS.temperature; // new safer default
    // v6: any speed other than exactly 1.00 is time-stretched on the server, which sounds
    // echoey / far away. Old presets left 0.99–1.02 behind, so start everyone back at 1.00.
    if (v < 6) saved.speed = 1;
    // v7: follow Chatterbox's recommended defaults (temperature 0.8) and a fixed seed so every chunk sounds like the same voice.
    if (v < 7) { if (saved.temperature === 0.75) saved.temperature = 0.8; if (!saved.seed) saved.seed = 42; }
    // v8: clips are always kept exactly as Chatterbox made them; volume matching is off unless chosen again (story track only).
    if (v < 8) saved.level = false;
    // v5: one voice picker. A built-in voice carries over; old server references don't.
    if (!saved.voiceKey && saved.voiceId && saved.mode !== 'clone') saved.voiceKey = 'builtin:' + saved.voiceId;
    delete saved.mode; delete saved.voiceId; delete saved.reference;
    saved.v = SETTINGS_VERSION;
    var s = Object.assign({}, DEFAULTS, saved);
    s.speed = clampSpeed(s.speed);   // e.g. an old 0.90 / 0.95 becomes 0.97
    s.chunk = clampChunk(s.chunk);   // 200–500 (never back to 240 by default)
    s.temperature = clampTo(s.temperature, TEMP_MIN, TEMP_MAX, 0.05);
    s.exaggeration = clampTo(s.exaggeration, EXAG_MIN, EXAG_MAX, 0.05);
    s.cfg = clampTo(s.cfg, CFG_MIN, CFG_MAX, 0.05);
    if (typeof s.language !== 'string' || !s.language) s.language = 'en';
    return s;
  }

  function clampTo(v, lo, hi, step) {
    v = Number(v); if (!isFinite(v)) v = lo;
    v = Math.round(v / step) * step;
    return Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
  }
  function tempLabel(v) { v = Number(v); return v.toFixed(2) + ' · ' + (v < 0.5 ? 'Steady' : v < 1 ? 'Natural' : 'More varied'); }
  function exagLabel(v) {
    v = Number(v);
    return v.toFixed(2) + ' · ' + (v < 0.4 ? 'Subtle' : v < 0.8 ? 'Natural' : v < 1.25 ? 'Expressive' : v < 1.75 ? 'Dramatic' : 'Maximum');
  }
  function chunkLabel(v) {
    v = Number(v);
    return v + ' · ' + (v < 280 ? 'Short / Stability' : v < 360 ? 'Conservative' : v < 440 ? 'Balanced' : 'Long');
  }

  function clampSpeed(v) {
    v = Math.round((Number(v) || 1) * 100) / 100;
    return Math.min(SPEED_MAX, Math.max(SPEED_MIN, v));
  }
  function speedLabel(v) {
    v = clampSpeed(v);
    var name = v <= 0.97 ? 'Slower' : v < 1 ? 'Slightly slower' : v === 1 ? 'Natural' : v < 1.03 ? 'Slightly faster' : v < 1.05 ? 'Faster' : 'Fast';
    return v.toFixed(2) + '× · ' + name;
  }

  function $(id) { return document.getElementById(id); }
  var saveSettings = YB.debounce(function () { YB.store.set('voice', settings); }, 250);
  function saveSettingsNow() { YB.store.set('voice', settings); }   // closing the app must never drop a change
  var saveScript = YB.debounce(function () { YB.store.set('voiceScript', $('scriptText').value); }, 400);

  /* ---------- Small helpers ---------- */
  function normalizeUrl(u) { return String(u || '').trim().replace(/\/+$/, ''); }
  function isHttpUrl(u) { return /^https?:\/\/[^\s/]+/i.test(u); }
  function hostOf(u) { try { return new URL(u).host; } catch (e) { return ''; } }
  function isLocalTunnel(u) { return /(^|\.)loca\.lt(:\d+)?$/i.test(hostOf(u)); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function bytesLabel(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function apiHeaders(extra) {
    var h = Object.assign({}, extra || {});
    // LocalTunnel only: asks it to skip its reminder page. It cannot bypass the
    // tunnel password screen — that still needs "Authorize Tunnel" once.
    if (isLocalTunnel(app.backend)) h['bypass-tunnel-reminder'] = 'true';
    return h;
  }

  // fetch with a per-request timeout (health, lists, upload, job create/status,
  // audio). The overall generation has no time limit. opts.signal is optional.
  function timedFetch(url, opts, ms) {
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, ms);
    opts = Object.assign({}, opts, { signal: ctl.signal });
    return fetch(url, opts).then(function (r) { clearTimeout(timer); return r; }, function (err) {
      clearTimeout(timer);
      if (err && err.name === 'AbortError') throw makeErr('timeout', 'The backend took too long to answer.');
      throw err;
    });
  }

  function route(name) {
    var r = ROUTES[name];
    var fromConfig = app.source === 'config' && app.config && app.config[r[0]];
    if (fromConfig && isHttpUrl(fromConfig) && hostOf(fromConfig) === hostOf(app.backend)) return normalizeUrl(fromConfig);
    return app.backend + r[1];
  }

  function jobRoute(id, audio) {
    var key = audio ? 'job_audio_template' : 'job_status_template';
    var tpl = app.source === 'config' && app.config && app.config[key];
    if (tpl && isHttpUrl(tpl) && hostOf(tpl) === hostOf(app.backend) && tpl.indexOf('{job_id}') !== -1) {
      return tpl.replace('{job_id}', encodeURIComponent(id));
    }
    return app.backend + '/jobs/' + encodeURIComponent(id) + (audio ? '/audio' : '');
  }

  function switchRoute(id) {
    var tpl = app.source === 'config' && app.config && app.config.model_switch_status_template;
    if (tpl && isHttpUrl(tpl) && hostOf(tpl) === hostOf(app.backend) && tpl.indexOf('{switch_id}') !== -1) {
      return tpl.replace('{switch_id}', encodeURIComponent(id));
    }
    return app.backend + '/model-switch-jobs/' + encodeURIComponent(id);
  }

  // The model actually loaded on the server (never a saved preference).
  function activeModel() { return (app.info && app.info.type) || ''; }
  function caps() { return MODEL_CAPS[activeModel()] || MODEL_CAPS.turbo; }

  function call(url, opts, ms) {
    opts = opts || {};
    return timedFetch(url, Object.assign({ cache: 'no-store', mode: 'cors' }, opts, { headers: apiHeaders(opts.headers) }), ms || HEALTH_TIMEOUT_MS);
  }

  // Parse a JSON body safely — a Cloudflare HTML page becomes a readable error,
  // never "Unexpected token '<'".
  function readJson(res) {
    return res.text().then(function (text) {
      try { return JSON.parse(text); } catch (e) {
        console.error('[Voice Studio] expected JSON, got:', text.slice(0, 600));
        if (/^\s*</.test(text) && isLocalTunnel(app.backend)) throw makeErr('tunnel-auth', 'The LocalTunnel access page answered instead of the server.');
        throw makeErr('unavailable', 'Backend temporarily unavailable.');
      }
    });
  }

  /* ---------- Errors ---------- */
  function makeErr(kind, message, extra) { var e = new Error(message); e.kind = kind; if (extra) Object.assign(e, extra); return e; }

  // Turns a failed HTTP response into a typed error with a readable message.
  function httpError(res, ctx) {
    return res.text().then(function (text) {
      var detail = '', looksHtml = /^\s*</.test(text);
      try {
        var j = JSON.parse(text);
        if (typeof j.detail === 'string') detail = j.detail;
        else if (Array.isArray(j.detail) && j.detail[0]) detail = j.detail.map(function (d) { return (d.loc ? d.loc[d.loc.length - 1] + ': ' : '') + d.msg; }).join('; ');
        else if (j.errors && j.errors[0]) detail = j.errors[0].error;
        else if (j.error) detail = String(j.error);
        else if (j.message) detail = j.message;
      } catch (e) { /* not JSON */ }
      console.error('[Voice Studio] HTTP ' + res.status + ' on ' + ctx, text.slice(0, 2000));
      var s = res.status;
      if (s === 511 || (looksHtml && isLocalTunnel(app.backend))) return makeErr('tunnel-auth', 'The LocalTunnel address needs to be authorized in this browser.');
      if (s === 530 || s === 1033) return makeErr('tunnel', 'Cloudflare tunnel is still connecting or disconnected.');
      if (s === 524) return makeErr('cf-timeout', 'A synchronous backend request exceeded Cloudflare\'s timeout.');
      if (s === 409 && ctx === 'switch') return makeErr('switch-busy', 'Finish the current generation before switching models.');
      if (s === 502 || s === 504) return makeErr('unavailable', 'Backend temporarily unavailable.');
      if (looksHtml) return makeErr('unavailable', 'Backend temporarily unavailable.');
      if (s === 503) return makeErr('model', detail || 'The Chatterbox model is not loaded yet.');
      if (s === 422) {
        if (/output_format/i.test(detail)) return makeErr('format', 'That output format isn\'t supported by this server.');
        return makeErr('validation', detail || 'The server rejected one of the settings.');
      }
      if (ctx === 'upload') return makeErr('upload', detail || ('Upload failed (HTTP ' + s + ').'));
      return makeErr(ctx === 'job' ? 'tts' : 'http', detail || ('The server returned an error (HTTP ' + s + ').'));
    }).then(function (e) { e.status = res.status; return e; });
  }

  // Network-level failures (fetch throws) — no HTTP status available.
  function networkError(err) {
    if (err && err.kind) return err;
    console.error('[Voice Studio] network error', err);
    if (isLocalTunnel(app.backend)) return makeErr('tunnel-auth', 'The browser was blocked by the LocalTunnel access page (or the tunnel is down).');
    return makeErr('offline', 'Could not reach the live backend.');
  }

  var RESTART = 'Start the Colab backend and wait for automatic reconnection.';
  var HELP = {
    'config-missing': 'Run the Colab startup cell — it publishes the live address to backend-config.json. You can also enter an address under “Manual backend override”.',
    'offline': RESTART + ' The page checks for a newly published address every minute (or press Refresh Backend).',
    'tunnel': 'Wait a moment for the tunnel, or restart the Colab backend. The page reconnects automatically.',
    'switch-busy': 'Wait for the speech job to finish, then choose the model again.',
    'switch': 'Try the switch again. If it keeps failing, restart the Colab backend.',
    'unavailable': 'Cloudflare answered with an error page. ' + RESTART,
    'not-job-api': 'Use the address of the Youtube Blue job server (its /health returns ok:true).',
    'tunnel-auth': 'Click Authorize Tunnel, complete the LocalTunnel page in the new tab, then come back and click Test Connection.',
    'timeout': 'The server is slow to respond. If it\'s finishing a long job, wait a moment and press Test Connection.',
    'model': 'The server is up but the voice model hasn\'t finished loading. Wait a minute and press Test Connection.',
    'cf-timeout': 'Speech generation uses background jobs, so this shouldn\'t happen during generation. ' + RESTART,
    'ref-missing': 'A new Colab session starts without your uploads. Upload the reference file again.',
    'voice-missing': 'Press Refresh Voices and pick a voice from the updated list.',
    'format': 'Choose WAV, MP3 or Opus.',
    'upload': 'Use a clean WAV or MP3 clip of one speaker, about 10–20 seconds long.',
    'ref-pending': 'Wait a moment and press Refresh References. If it still isn\'t listed, upload it again.',
    'validation': 'Check the voice settings (chunk size must be 50–500).',
    'lost': 'The connection dropped while waiting — the tunnel or Colab may have restarted. Press Refresh Backend, then try again.',
    'job-lost': 'The job server no longer knows this job — it was probably restarted. Press Refresh Backend and generate again.',
    'busy': 'It\'s probably still finishing an earlier job. New jobs wait and run slower until it\'s done.',
    'clone-unavailable': 'Your job server needs the /upload_reference and /get_reference_files routes (see the README).',
    'tts': 'Try: set speed to 1.00 · use chunk size 300–400 · shorten the script · check the clone reference (10–20 s of clean speech) · try another seed.',
    'http': 'Details are in the browser console.'
  };

  // err.raw (e.g. a failed job's exact job.error) is shown in an expandable
  // details area with a Copy Error button.
  function showNotice(el, err, level) {
    if (!err) { el.hidden = true; el.innerHTML = ''; return; }
    el.className = 'notice ' + (level || 'error');
    el.innerHTML = '<b>' + YB.esc(err.message) + '</b>' + YB.esc(HELP[err.kind] || '') + errorDetailsHtml(err.raw);
    el.hidden = false;
  }

  function errorDetailsHtml(raw) {
    raw = raw == null ? '' : String(raw).trim();
    if (!raw) return '';
    return '<details class="err-details"><summary>Backend error details</summary>' +
      '<pre class="err-raw">' + YB.esc(raw) + '</pre>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-copy-error>📋 Copy Error</button></details>';
  }

  /* ---------- Status / UI state ---------- */
  var STATE_LABEL = { connecting: 'Connecting…', online: 'Online', offline: 'Backend Offline', generating: 'Generating', switching: 'Switching Model', error: 'Error' };

  function setState(state, label) {
    if (state === 'online' && app.remoteBusy && !app.generating) { state = 'busy'; label = app.ownBg ? 'Busy · finishing' : 'In use · another user'; }
    app.state = state;
    var el = $('connectionStatus');
    el.setAttribute('data-state', state);
    el.textContent = label || STATE_LABEL[state];
    updateControls();
  }
  function onlineLabel() { return app.source === 'manual' ? 'Connected' : 'Online'; }

  function isSwitching() { return !!app.switching || app.remoteSwitching; }

  function updateControls() {
    var busy = app.generating;
    var switching = isSwitching();
    var locked = busy || switching;                      // no voice/model changes mid-job or mid-switch
    var story = storyHooks && storyHooks.active();
    var blocked = story ? !storyHooks.canGenerate() : !settings.voiceKey;
    var remote = app.remoteBusy && !busy;                // someone else's generation is using the server
    $('generateBtn').disabled = locked || remote || app.uploading || app.preparing || blocked;
    $('generateBtn').textContent = busy ? '⏳ Generating…' : switching ? '⏳ Switching model…' : remote ? (app.ownBg ? '⏳ Server finishing…' : '⏳ Another user is generating…') : story ? '🎭 Generate Story Audio' : '🎙️ Generate Speech';
    $('cancelBtn').disabled = !busy && !app.preparing;
    $('testBtn').disabled = locked;
    $('refreshBackendBtn').disabled = busy;
    $('refreshVoicesBtn').disabled = locked || remote;
    $('againBtn').disabled = locked || remote;
    $('authTunnelBtn').hidden = !isLocalTunnel(app.backend);
    $('openBackendBtn').disabled = !app.backend;
    $('openDocsBtn').disabled = !app.backend;
    $('voicePick').disabled = locked || app.preparing;
    document.querySelectorAll('#presetChips button').forEach(function (b) { b.disabled = locked; });
    renderEngineCards();
  }

  function renderBackendFacts() {
    $('backendDisplay').textContent = app.backend ? app.backend + (app.source === 'manual' ? '  (manual)' : '') : 'Not set';
    var info = app.info || {};
    $('modelType').textContent = info.type ? info.type.charAt(0).toUpperCase() + info.type.slice(1) : '—';
    $('modelDevice').textContent = info.device ? String(info.device).toUpperCase() : '—';
    $('modelSampleRate').textContent = info.sample_rate ? Number(info.sample_rate) + ' Hz' : '—';
    $('outSampleRate').textContent = info.sample_rate ? Number(info.sample_rate) + ' Hz' : '—';
    if (info.type && MODEL_NAMES[info.type]) $('modelType').textContent = MODEL_NAMES[info.type].replace(' Chatterbox', '');
    var up = app.source === 'config' && app.config && app.config.updated_at;
    if (up) {
      var d = new Date(up);
      $('backendUpdatedAt').textContent = isNaN(d) ? up : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) +
        ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) + ' (' + ago(d) + ')';
    } else $('backendUpdatedAt').textContent = app.source === 'manual' ? 'Manual address' : '—';
  }
  function ago(d) {
    var m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60); return h < 48 ? h + ' h ago' : Math.round(h / 24) + ' days ago';
  }

  // Model details from backend-config.json (written by Colab at startup) —
  // shown while Chatterbox is too busy to answer /model-info.
  function infoFromConfig() {
    var c = app.config;
    if (!c || !c.model_type) return null;
    return { loaded: c.model_loaded !== false, type: c.model_type, device: c.device, sample_rate: c.sample_rate,
      supports_paralinguistic_tags: c.supports_paralinguistic_tags, available_paralinguistic_tags: c.available_paralinguistic_tags };
  }

  /* ---------- Backend discovery ---------- */
  // Startup and "Refresh Backend": backend-config.json first (always fresh);
  // the manual override is only a fallback when the published backend fails.
  function loadBackendConfig() {
    if (app.generating) return Promise.resolve(false);
    showNotice($('backendNotice'), null);
    setState('connecting');
    var override = normalizeUrl(YB.store.get('voiceOverride', ''));

    return timedFetch('./backend-config.json?ts=' + Date.now(), { cache: 'no-store' }, CONFIG_TIMEOUT_MS)
      .then(function (res) {
        if (res.status === 404) throw makeErr('config-missing', 'Live backend configuration is unavailable.');
        if (!res.ok) throw makeErr('config-missing', 'Couldn\'t load backend-config.json (HTTP ' + res.status + ').');
        return res.json().catch(function () { throw makeErr('config-missing', 'backend-config.json is not valid JSON.'); });
      })
      .then(function (cfg) {
        var url = normalizeUrl(cfg && cfg.backend_url);
        if (!isHttpUrl(url)) throw makeErr('config-missing', 'backend_url is missing from backend-config.json.');
        useBackend(url, 'config', cfg);
        return resumeOrCheck({ loadLists: true }).then(function (ok) {
          if (ok || !override || override === url) return ok;
          return tryOverride(override, 'The published backend didn\'t answer — using your manual address.').then(function (ok2) {
            if (ok2) return true;
            // Neither answers: keep showing the published address (the one Colab
            // will update), not an old manual tunnel that no longer exists.
            useBackend(url, 'config', cfg);
            setState('offline');
            showNotice($('backendNotice'), makeErr('offline', 'Could not reach the live backend — neither the published address nor your saved manual address is answering.'));
            return false;
          });
        });
      }, function (err) {
        console.error('[Voice Studio] backend config', err);
        if (override) return tryOverride(override, err.message + ' Trying your manual address.');
        app.backend = ''; app.source = ''; app.config = null;
        renderBackendFacts(); updateControls();
        setState('offline');
        showNotice($('backendNotice'), err.kind ? err : makeErr('config-missing', 'Backend configuration is missing.'));
        return false;
      });
  }

  function useBackend(url, source, cfg) {
    if (url !== app.backend) { app.voicesLoaded = false; app.cloneAvailable = true; app.info = null; clearRemoteGen(false); }   // busy state belonged to the old server
    app.backend = url; app.source = source; app.config = cfg || null;
    $('backendUrlInput').value = url;
    renderBackendFacts(); updateControls();
  }

  function tryOverride(url, note) {
    useBackend(url, 'manual', null);
    return resumeOrCheck({ loadLists: true }).then(function (ok) {
      if (ok && note) showNotice($('backendNotice'), makeErr('config-missing', note), 'warn');
      return ok;
    });
  }

  /* ---------- Health ---------- */
  // GET /health (must be ok:true) then GET /model-info. Resolves true when the
  // backend is usable. Never runs during generation: Chatterbox is CPU-bound
  // then, and a slow /model-info must not be reported as "Offline".
  function checkHealth(opts) {
    opts = opts || {};
    if (app.generating) return Promise.resolve(true);
    if (isSwitching() && !opts.afterSwitch) return Promise.resolve(true);   // never "offline" mid-switch
    if (!app.backend) { setState('offline'); return Promise.resolve(false); }
    if (app.healthBusy) return Promise.resolve(app.state === 'online');
    app.healthBusy = true;
    if (!opts.silent) setState('connecting');

    return call(route('health'), {}, HEALTH_TIMEOUT_MS)
      .then(function (res) {
        if (res.status === 404) return res.text().then(function () { throw makeErr('not-job-api', 'This address doesn\'t have a /health route — it isn\'t the Youtube Blue job server.'); });
        if (!res.ok) return httpError(res, 'health').then(function (e) { throw e; });
        return readJson(res);
      })
      .then(function (h) {
        if (!h || h.ok !== true) throw makeErr('not-job-api', 'The server answered /health without ok: true.');
        return getBackendState();
      })
      .then(function (st) {
        if (st && st.model_switching === true && !app.switching) { observeRemoteSwitch(); return 'switching'; }
        if (st && st.generation_active === true) observeRemoteGen();
        // A generation is already running (another tab/device): don't poke /model-info.
        // Another user's job: Chatterbox won't answer /model-info until it's done, so use
        // what Colab published and load the lists once the server is free.
        if (st && st.generation_active === true && (app.info || infoFromConfig()) && (!opts.loadLists || app.remoteBusy)) return { busy_or_unreachable: true };
        return call(route('info'), {}, HEALTH_TIMEOUT_MS).then(function (res) {
          if (!res.ok) return httpError(res, 'health').then(function (e) { throw e; });
          return readJson(res);
        });
      })
      .then(function (info) {
        if (info === 'switching') return true;
        if (app.generating) return true; // a generation started meanwhile — ignore
        app.healthFails = 0;
        app.busy = info.busy_or_unreachable === true;
        if (app.busy) {
          // The job server answered; Chatterbox is just busy finishing a job. Not offline.
          if (!app.info) app.info = infoFromConfig();
          renderBackendFacts(); applyModelUI();
          setState('online', onlineLabel() + ' · busy');
          showNotice($('backendNotice'), makeErr('busy', 'Chatterbox is busy right now.'), 'warn');
          if (!app.voicesLoaded) useCachedVoices();
          return true;
        }
        app.info = info;
        renderBackendFacts(); applyModelUI();
        if (info.loaded !== true) {
          setState('error', 'Model not loaded');
          showNotice($('backendNotice'), makeErr('model', 'Chatterbox is running but the model is not loaded.'));
          return false;
        }
        setState('online', onlineLabel());
        if (!opts.keepNotice) showNotice($('backendNotice'), null);
        var work = [loadModels()];
        if (opts.loadLists || !app.voicesLoaded) work.push(loadVoices(true), loadReferences(true));
        return Promise.all(work).then(function () { return true; });
      })
      .catch(function (err) {
        if (app.generating) return true;
        err = networkError(err);
        app.healthFails++;
        // a single slow background check is not enough to call it offline
        if (opts.silent && app.healthFails < 2 && err.kind === 'timeout') return app.state === 'online';
        setState(err.kind === 'tunnel-auth' ? 'error' : 'offline', err.kind === 'tunnel-auth' ? 'Tunnel locked' : undefined);
        showNotice($('backendNotice'), err);
        return false;
      })
      .then(function (ok) { app.healthBusy = false; return ok; }, function () { app.healthBusy = false; return false; });
  }

  // GET /state → { generation_active, model_switching }. Optional: null if the
  // server doesn't have it or it can't be read right now.
  function getBackendState() {
    return call(route('state') + '?ts=' + Date.now(), {}, 20000)
      .then(function (res) { return res.ok ? res.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } }) : null; })
      .catch(function () { return null; });
  }

  // GET /models → { active, models: [{ id, name, available, ... }] }. Optional.
  function loadModels() {
    return call(route('models'), {}, HEALTH_TIMEOUT_MS)
      .then(function (res) { return res.ok ? res.text().then(function (t) { try { return JSON.parse(t); } catch (e) { return null; } }) : null; })
      .catch(function () { return null; })
      .then(function (data) {
        if (data && Array.isArray(data.models)) app.models = data.models;
        renderEngineCards();
      });
  }

  /* ---------- Model engine (async switching: POST /model-switch-jobs → poll) ---------- */
  function modelAvailable(id) {
    var m = Array.isArray(app.models) && app.models.find(function (x) { return x.id === id; });
    if (m) return m.available === true;
    var c = app.config || {};
    if (id === 'turbo') return c.turbo_available !== false;
    if (id === 'multilingual') return c.multilingual_available === true;
    return id === 'original';
  }

  function renderEngineCards() {
    var host = $('engineCards'); if (!host) return;
    var active = activeModel(), target = app.switching && app.switching.model;
    var offline = !app.backend || app.state === 'offline' || app.state === 'connecting' && !app.info;
    host.querySelectorAll('[data-model]').forEach(function (b) {
      var id = b.getAttribute('data-model'), avail = modelAvailable(id), isActive = id === active, pending = id === target;
      b.classList.toggle('active', isActive);
      b.classList.toggle('pending', pending);
      b.classList.toggle('unavailable', !avail);
      b.setAttribute('aria-checked', isActive ? 'true' : 'false');
      var badge = b.querySelector('.engine-badge');
      badge.hidden = !isActive && !pending && avail;
      badge.textContent = isActive ? 'ACTIVE' : pending ? 'LOADING…' : avail ? '' : 'NOT AVAILABLE';
      b.disabled = !avail || isActive || offline || app.generating || isSwitching() || app.remoteBusy;
    });
    $('engineActive').textContent = active ? 'Active: ' + (MODEL_NAMES[active] || active) : '';
  }

  function setSwitchPhase(status) {
    var name = MODEL_NAMES[app.switching ? app.switching.model : ''] || 'model';
    var text = status === 'switching' ? 'Unloading current model…' : status === 'loading' ? 'Loading ' + name + '…' : 'Preparing ' + name + '…';
    $('switchProgress').hidden = false;
    $('switchStatusText').textContent = text;
    setState('switching', 'Switching Model');
  }

  function tickSwitch() {
    var t0 = (app.switching && app.switching.startedAt) || app.remoteSince;
    if (t0) $('switchElapsed').textContent = mmss((Date.now() - t0) / 1000) + ' elapsed';
  }

  function saveSwitch() {
    if (app.switching && app.switching.id) YB.store.set('voiceSwitch', { id: app.switching.id, model: app.switching.model, backend: app.backend, startedAt: app.switching.startedAt });
    else YB.store.remove('voiceSwitch');
  }

  function switchModel(id) {
    if (!app.backend || app.generating || isSwitching() || app.preparing) return;
    if (app.remoteBusy) { YB.toast('Another user is generating — switch models once the server is free'); return; }
    if (id === activeModel()) { YB.toast((MODEL_NAMES[id] || id) + ' is already active'); return; }
    if (!modelAvailable(id)) { YB.toast((MODEL_NAMES[id] || id) + ' isn\'t available on this server'); return; }
    var cur = MODEL_NAMES[activeModel()] || 'the current model', next = MODEL_NAMES[id] || id;
    if (!window.confirm('Switch the server from ' + cur + ' to ' + next + '?\n\nThis changes the voice model for everyone using the server' + (id === 'original' ? ', and Original is slower than Turbo.' : '.'))) return;
    settings.preferredModel = id; saveSettings();   // a preference only — /model-info decides
    showNotice($('modelNotice'), null);
    app.switching = { id: null, model: id, fails: 0, startedAt: Date.now() };
    stopPolling();
    setSwitchPhase('queued');
    clearInterval(app.switchTick); app.switchTick = setInterval(tickSwitch, 1000); tickSwitch();
    updateControls();
    call(route('modelSwitch'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: id }) }, SHORT_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) return httpError(res, 'switch').then(function (e) { throw e; });
        return readJson(res);
      })
      .then(function (data) {
        if (!app.switching) return;
        if (!data.switch_id && data.status === 'complete') { finishSwitch(null); return; }   // already active
        if (!data.switch_id) throw makeErr('switch', 'The server did not return a switch ID.', { raw: JSON.stringify(data) });
        app.switching.id = data.switch_id;
        saveSwitch();
        setSwitchPhase(data.status || 'queued');
        scheduleSwitchPoll();
      })
      .catch(function (err) { if (app.switching) finishSwitch(networkError(err)); });
  }

  function scheduleSwitchPoll() {
    clearTimeout(app.switchTimer);
    if (app.switching && app.switching.id) app.switchTimer = setTimeout(pollSwitch, SWITCH_POLL_MS);
  }

  function pollSwitch() {
    var sw = app.switching; if (!sw || !sw.id) return;
    call(switchRoute(sw.id) + '?ts=' + Date.now(), {}, SHORT_TIMEOUT_MS)
      .then(function (res) {
        if (res.status === 404) return res.text().then(function (t) {
          if (/not found/i.test(t) && !/^\s*</.test(t)) throw makeErr('switch', 'The server no longer has this model switch.', { raw: t });
          throw Object.assign(makeErr('unavailable', 'Switch status not found.'), { transient: true });
        });
        if (!res.ok) return httpError(res, 'switch-status').then(function (e) { e.transient = true; throw e; });
        return readJson(res);
      })
      .then(function (data) {
        if (app.switching !== sw) return;
        sw.fails = 0;
        if (data.status === 'complete') { finishSwitch(null); return; }
        if (data.status === 'failed') {
          finishSwitch(makeErr('switch', 'Couldn\'t switch to ' + (MODEL_NAMES[sw.model] || sw.model) + '.', { raw: data.error || JSON.stringify(data) }));
          return;
        }
        setSwitchPhase(data.status);
        scheduleSwitchPoll();
      })
      .catch(function (err) {
        if (app.switching !== sw) return;
        err = networkError(err);
        var transient = err.transient || /offline|timeout|unavailable|tunnel/.test(err.kind);
        // Chatterbox loading can stall the tunnel briefly — keep waiting, never mark offline.
        if (transient && ++sw.fails < 60) { scheduleSwitchPoll(); return; }
        finishSwitch(transient ? makeErr('lost', 'Lost contact with the server while the model was switching.') : err);
      });
  }

  function finishSwitch(err) {
    var sw = app.switching;
    clearTimeout(app.switchTimer); clearInterval(app.switchTick);
    app.switching = null; saveSwitch();
    $('switchProgress').hidden = true;
    if (err) showNotice($('modelNotice'), err);
    updateControls();
    startPolling();
    return checkHealth({ loadLists: true, afterSwitch: true }).then(function (ok) {
      if (err || !ok || !sw) return;
      var name = MODEL_NAMES[activeModel()] || activeModel();
      var box = $('modelNotice');
      box.className = 'notice'; box.hidden = false;
      box.innerHTML = '<b>' + YB.esc(name) + ' ready</b>' + YB.esc(activeModel() === sw.model ? '' : 'The server reports ' + name + ' is loaded.');
      YB.toast(name + ' ready');
    });
  }

  // A switch started elsewhere (another tab or device): follow GET /state.
  function observeRemoteSwitch() {
    if (app.remoteSwitching) return;
    app.remoteSwitching = true; app.remoteSince = Date.now();
    stopPolling();
    $('switchProgress').hidden = false;
    $('switchStatusText').textContent = 'Switching voice model…';
    clearInterval(app.switchTick); app.switchTick = setInterval(tickSwitch, 1000); tickSwitch();
    setState('switching', 'Switching Model');
    (function wait() {
      setTimeout(function () {
        getBackendState().then(function (st) {
          if (st && st.model_switching === true) { wait(); return; }
          app.remoteSwitching = false; clearInterval(app.switchTick);
          $('switchProgress').hidden = true;
          updateControls(); startPolling();
          checkHealth({ loadLists: true, afterSwitch: true });
        });
      }, STATE_POLL_MS);
    })();
    updateControls();
  }

  // Reopened the page during a switch this page started? Keep following it.
  function resumeSwitch() {
    var saved = YB.store.get('voiceSwitch', null);
    if (!saved || !saved.id) return false;
    if (normalizeUrl(saved.backend) !== app.backend) { YB.store.remove('voiceSwitch'); return false; }
    app.switching = { id: saved.id, model: saved.model, fails: 0, startedAt: saved.startedAt || Date.now() };
    stopPolling();
    setSwitchPhase('loading');
    clearInterval(app.switchTick); app.switchTick = setInterval(tickSwitch, 1000); tickSwitch();
    updateControls();
    pollSwitch();
    return true;
  }

  // Someone else's generation is running (another user / device): lock the
  // buttons that would compete for the server, show who has it, and unlock by
  // itself once GET /state says the server is free.
  function observeRemoteGen() {
    if (app.remoteBusy || app.generating || app.job || app.preparing || app.previewing) return;
    if (Date.now() - app.lastOwnEnd < 8000) return;      // our own job is just wrapping up
    app.remoteBusy = true; app.remoteSince = Date.now(); app.remoteMiss = 0;
    var mark = YB.store.get('voiceOwnBg', null);   // our stopped job, remembered across reloads
    app.ownBg = !!app.orphanJob || app.ownBg || !!(mark && normalizeUrl(mark.backend) === app.backend && Date.now() - mark.at < 3600000);
    renderRemoteBusy();
    if (app.state === 'online' || app.state === 'busy') setState('online'); else updateControls();
    if (storyHooks) storyHooks.listsChanged();
    (function wait() {
      clearTimeout(app.remoteTimer);
      app.remoteTimer = setTimeout(function () {
        if (!app.remoteBusy) return;
        if (app.generating) { clearRemoteGen(false); return; }
        getBackendState().then(function (st) {
          if (!app.remoteBusy) return;
          if (st && st.generation_active === true) { app.remoteMiss = 0; renderRemoteBusy(); wait(); return; }
          if (!st && ++app.remoteMiss < 3) { wait(); return; }   // can't read /state right now — keep waiting a little
          clearRemoteGen(true);
        });
      }, STATE_POLL_MS);
    })();
  }

  // Our own stopped job is still running on the server (not another user).
  function markOwnBg() { app.ownBg = true; YB.store.set('voiceOwnBg', { backend: app.backend, at: Date.now() }); }

  function clearRemoteGen(announce) {
    if (announce) YB.store.remove('voiceOwnBg');   // server seen free
    if (!app.remoteBusy) return;
    app.remoteBusy = false; app.ownBg = false;
    clearTimeout(app.remoteTimer);
    $('remoteBusy').hidden = true;
    if (app.state === 'busy') setState('online', onlineLabel()); else updateControls();
    if (storyHooks) storyHooks.listsChanged();
    if (announce) { YB.toast('The server is free — you can generate now'); checkHealth({ silent: true }); }
  }

  function renderRemoteBusy() {
    var box = $('remoteBusy'), wait = mmss((Date.now() - app.remoteSince) / 1000);
    box.hidden = false;
    box.innerHTML = app.ownBg
      ? '<b>Your stopped generation is still finishing on the server.</b>Generate unlocks by itself when it\'s done (waiting ' + wait + ').'
      : '<b>Another user is generating right now.</b>The server makes one voice at a time, so Generate, model switching and uploads unlock by themselves when it\'s free (waiting ' + wait + '). You can keep editing your script, voices and settings meanwhile.';
  }

  function startPolling() {
    stopPolling();
    app.healthTimer = setInterval(function () {
      if (app.generating || document.hidden) return;
      if (isDown()) loadBackendConfig();                 // look for a newly published address
      else if (app.backend) checkHealth({ silent: true });
    }, HEALTH_INTERVAL_MS);
    // Light GET /state check while idle (job server only, never Chatterbox):
    // notices another user's generation or model switch within a few seconds.
    app.stateTimer = setInterval(function () {
      if (app.generating || app.job || app.preparing || app.previewing || app.remoteBusy || isSwitching() || document.hidden || !app.backend || isDown() || app.stateBusy) return;
      app.stateBusy = true;
      getBackendState().then(function (st) {
        app.stateBusy = false;
        if (!st || app.generating) return;
        if (st.model_switching === true && !app.switching) observeRemoteSwitch();
        else if (st.generation_active === true) observeRemoteGen();
        else { app.ownBg = false; YB.store.remove('voiceOwnBg'); }   // server idle: nothing of ours is still running
      });
    }, STATE_POLL_MS);
  }
  function stopPolling() {
    if (app.healthTimer) { clearInterval(app.healthTimer); app.healthTimer = null; }
    if (app.stateTimer) { clearInterval(app.stateTimer); app.stateTimer = null; }
  }
  function isDown() { return app.state === 'offline' || (app.state === 'error' && !app.info); }

  /* ---------- Predefined voices ---------- */
  function loadVoices(quiet) {
    if (!app.backend || app.generating) return Promise.resolve();
    return call(route('voices'), {}, HEALTH_TIMEOUT_MS)
      .then(function (res) { if (!res.ok) return httpError(res, 'voices').then(function (e) { throw e; }); return readJson(res); })
      .then(function (voices) {
        voices = (Array.isArray(voices) ? voices : []).map(function (v) {
          return typeof v === 'string' ? { display_name: v.replace(/\.(wav|mp3)$/i, ''), filename: v } : { display_name: v.display_name || v.filename, filename: v.filename };
        }).filter(function (v) { return v.filename; });
        YB.store.set('voiceList', voices);
        app.voicesAt = Date.now();
        renderVoices(voices, voices.length + ' voices');
        if (!quiet) YB.toast('Voices updated');
      })
      .catch(function (err) {
        err = networkError(err);
        // Chatterbox busy (or a hiccup): keep the last list this server gave us.
        if (useCachedVoices()) { if (!quiet) YB.toast('Couldn\'t refresh — showing the last loaded voice list'); return; }
        app.voicesFailed = true; renderPicker();
        $('voiceCount').textContent = '';
        if (!quiet) showNotice($('genError'), err);
      });
  }

  function renderVoices(voices, note) {
    app.voices = voices;
    app.voicesLoaded = true; app.voicesFailed = false;
    $('voiceCount').textContent = voices.length ? note : 'No Chatterbox Voices on the server';
    renderPicker();
    if (storyHooks) storyHooks.listsChanged();
  }

  /* ---------- Voice picker: Presets · Our Voices · My Voices · Chatterbox built-in ---------- */
  var library = null;   // js/voice-library.js
  function renderPicker() {
    var sel = $('voicePick');
    if (!library) {    // library script missing: built-in voices only
      sel.innerHTML = app.voices.map(function (v) { return '<option value="builtin:' + YB.esc(v.filename) + '">' + YB.esc(v.display_name) + '</option>'; }).join('') || '<option value="">Connect to load voices…</option>';
    } else sel.innerHTML = library.optionsHtml(settings.voiceKey);
    // Keep the saved voice; if it's definitely gone, fall back to the first one listed.
    if (settings.voiceKey && library && library.has(settings.voiceKey) === false) settings.voiceKey = '';
    if (!settings.voiceKey || !sel.querySelector('option[value="' + cssEsc(settings.voiceKey) + '"]')) {
      var first = sel.querySelector('option[value]:not([value=""]):not([disabled])');
      if (first && (!settings.voiceKey || (library && library.has(settings.voiceKey) === false))) settings.voiceKey = first.value;
    }
    if (settings.voiceKey) sel.value = settings.voiceKey;
    if (library && library.counts()) $('voiceCount').textContent = library.counts();
    updatePreviewBtn();
    saveSettings();
    renderPickNote();
    renderSummary(); updateControls();
  }
  // ▶ next to the picker plays the selected voice (js/voice-library.js previewBlob).
  function updatePreviewBtn() {
    var b = $('voicePreviewBtn'); if (!b) return;
    b.setAttribute('data-play-key', settings.voiceKey ? 'voice:' + settings.voiceKey : '');
    b.setAttribute('data-play-label', settings.voiceKey && library ? library.label(settings.voiceKey).replace(/ · .*$/, '') : 'this voice');
    b.disabled = !settings.voiceKey;
    // Chatterbox Voices have no sample file; making one on the server made the page lag, so no ▶ for them.
    b.hidden = !settings.voiceKey || /^builtin:/.test(settings.voiceKey);
    if (window.YBTakes) window.YBTakes.player.sync();
  }
  function cssEsc(v) { return String(v).replace(/["\\]/g, '\\$&'); }
  function renderPickNote(text) {
    var el = $('voicePickNote'); if (!el) return;
    el.textContent = text || (library ? library.note(settings.voiceKey) : '');
  }
  function selectVoice(key) {
    settings.voiceKey = key || ''; saveSettingsNow();
    renderPicker();
  }

  function useCachedVoices() {
    var cached = YB.store.get('voiceList', null);
    if (!Array.isArray(cached) || !cached.length) return false;
    renderVoices(cached, 'Last loaded list');
    return true;
  }

  /* ---------- Reference files (voice clone) ---------- */
  // Resolves to the server's list (array), or null if it couldn't be fetched.
  function loadReferences(quiet) {
    if (!app.backend) return Promise.resolve(null);
    return call(route('refs'), {}, HEALTH_TIMEOUT_MS)
      .then(function (res) { if (!res.ok) return httpError(res, 'refs').then(function (e) { throw e; }); return readJson(res); })
      .then(function (files) {
        files = (Array.isArray(files) ? files : []).map(String);
        app.cloneAvailable = true;
        app.refFiles = files; app.refsAt = Date.now();
        renderReferences(files);
        updateControls();
        if (!quiet) YB.toast('References updated');
        return files;
      })
      .catch(function (err) {
        err = networkError(err);
        if (err.status === 404 || err.status === 405) {
          app.cloneAvailable = false; app.refFiles = []; updateControls(); renderPicker();
          return null;
        }
        if (!quiet) showNotice($('genError'), err);
        return null;
      });
  }

  // Server reference files aren't listed for picking any more (the voice
  // library uploads what it needs); the list is still used to verify uploads.
  function renderReferences() { if (storyHooks) storyHooks.listsChanged(); }

  // Lists change on the server (uploads from elsewhere, a Colab restart), so
  // re-fetch them whenever they're about to be used and are a little old.
  function refreshListsIfStale(which) {
    if (!app.backend || app.generating || app.state === 'offline' || app.busy) return;
    var now = Date.now();
    if (which !== 'voices' && now - app.refsAt > LIST_STALE_MS) { app.refsAt = now; loadReferences(true); }
    if (which !== 'refs' && now - app.voicesAt > LIST_STALE_MS) { app.voicesAt = now; loadVoices(true); }
  }

  // POST multipart "files" → server stores it under a (sanitized) filename →
  // refresh GET /get_reference_files and select that filename.
  // Shared upload used by the single-script clone section and by Story mode's
  // per-character "Upload reference": POST multipart "files" → server stores it
  // under a (sanitized) filename → GET /get_reference_files must list it.
  // Resolves to the server filename; rejects with a typed error.
  function sendReference(file, onStep, own) {
    if (!app.backend) return Promise.reject(makeErr('config-missing', 'No backend is connected yet.'));
    if (!file) return Promise.reject(makeErr('upload', 'Choose a WAV or MP3 file first.'));
    if (!/\.(wav|mp3)$/i.test(file.name)) return Promise.reject(makeErr('upload', 'Only .wav and .mp3 files are accepted.'));
    if (app.uploading || (app.generating && !own) || isSwitching()) return Promise.reject(makeErr('upload', 'Wait for the current task to finish, then upload again.'));
    if (app.remoteBusy) return Promise.reject(makeErr('upload', 'Another user is generating — upload once the server is free.'));
    app.uploading = true; updateControls();
    if (onStep) onStep('Uploading ' + file.name + ' (' + bytesLabel(file.size) + ')…');
    var form = new FormData();
    form.append('files', file, file.name); // the multipart field must be "files"

    return call(route('upload'), { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS)
      .then(function (res) {
        if (res.status === 404 || res.status === 405) {
          app.cloneAvailable = false;
          throw makeErr('clone-unavailable', 'This job server doesn\'t accept reference uploads.');
        }
        return res.text().then(function (text) {
          var data = null; try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
          if (!data) {
            console.error('[Voice Studio] upload response', res.status, text.slice(0, 1000));
            throw res.ok ? makeErr('upload', 'Upload returned an unexpected response.')
              : res.status === 530 ? makeErr('tunnel', 'Cloudflare tunnel is still connecting or disconnected.')
              : makeErr('unavailable', 'Backend temporarily unavailable.');
          }
          var uploaded = data.uploaded_files || [];
          if (!uploaded.length) {
            var msg = (data.errors && data.errors[0] && data.errors[0].error) || data.detail || 'The server did not accept the file.';
            throw makeErr('upload', 'Reference upload failed: ' + msg, { raw: text });
          }
          return uploaded[0]; // server-side (sanitized) filename
        });
      })
      .then(function (serverName) {
        // Only use the file once the TTS engine's own list includes it.
        if (onStep) onStep('Uploaded — checking the server can use ' + serverName + '…');
        return loadReferences(true).then(function (files) {
          if (!files || files.indexOf(serverName) === -1) {
            throw makeErr('ref-pending', 'Reference audio was uploaded but is not available to the TTS engine yet.');
          }
          return serverName;
        });
      })
      .then(function (name) { app.uploading = false; updateControls(); return name; },
        function (err) { app.uploading = false; updateControls(); throw networkError(err); });
  }

  /* ---------- Voice mode / settings ---------- */
  function fillSettings() {
    $('outputFormat').value = settings.format;
    $('chunkSize').value = settings.chunk;
    $('temperature').value = settings.temperature;
    $('speedFactor').value = settings.speed;
    $('generationSeed').value = settings.seed;
    $('splitText').checked = !!settings.split;
    $('levelLoudness').checked = settings.level !== false;
    $('exaggeration').value = settings.exaggeration;
    $('cfgWeight').value = settings.cfg;
    $('tempVal').textContent = tempLabel(settings.temperature);
    $('speedVal').textContent = speedLabel(settings.speed);
    $('exagVal').textContent = exagLabel(settings.exaggeration);
    $('cfgVal').textContent = Number(settings.cfg).toFixed(2);
    $('chunkVal').textContent = chunkLabel(settings.chunk);
    $('chunkSize').disabled = !settings.split;
    $('chunkField').classList.toggle('is-off', !settings.split);
  }

  function clampChunk(v) { v = Math.round((Number(v) || 400) / 10) * 10; return Math.min(CHUNK_MAX, Math.max(CHUNK_MIN, v)); }

  /* ---------- Script editor ---------- */
  function updateScriptMeta() {
    var text = $('scriptText').value;
    var len = text.length;
    var words = (text.replace(/\[[^\]]*\]/g, ' ').match(/[\w'’-]+/g) || []).length;
    var chunks = !text.trim() ? 0 : settings.split ? Math.max(1, Math.ceil(text.trim().length / clampChunk(settings.chunk))) : 1;
    $('characterCount').textContent = len.toLocaleString() + ' characters';
    $('scriptMeta').textContent = words.toLocaleString() + ' words · ~' + mmss((words / 150) * 60) + ' of speech · ' + chunks + ' chunk' + (chunks === 1 ? '' : 's');
    renderSummary();
  }

  function insertAtCursor(snippet) {
    var ta = $('scriptText');
    var focused = document.activeElement === ta;
    // Use the live cursor, or the one saved while typing (phones may blur the box on tap).
    var start = focused && ta.selectionStart != null ? ta.selectionStart : (tagUi.start != null ? tagUi.start : ta.value.length);
    var end = focused && ta.selectionEnd != null ? ta.selectionEnd : (tagUi.end != null ? tagUi.end : start);
    start = Math.min(start, ta.value.length); end = Math.min(Math.max(end, start), ta.value.length);
    var before = ta.value.slice(0, start), after = ta.value.slice(end);
    if (/^\[/.test(snippet)) {
      if (before && !/\s$/.test(before)) snippet = ' ' + snippet;
      if (!after || !/^\s/.test(after)) snippet = snippet + ' ';
    }
    if (ta.setRangeText) ta.setRangeText(snippet, start, end, 'end');
    else { ta.value = before + snippet + after; ta.selectionStart = ta.selectionEnd = start + snippet.length; }
    ta.focus();
    tagUi.start = tagUi.end = ta.selectionEnd;
    updateScriptMeta(); saveScript();
  }

  // Reaction tags: the active model's own list (/model-info) is authoritative,
  // then backend-config.json, then the standard Turbo set.
  function tagList() {
    var info = app.info, c = app.source === 'config' && app.config;
    var list;
    if (info && info.type && Array.isArray(info.available_paralinguistic_tags) && info.available_paralinguistic_tags.length) list = info.available_paralinguistic_tags;
    else if (info && info.type && !caps().tags) list = [];
    else if (c && Array.isArray(c.available_paralinguistic_tags) && c.available_paralinguistic_tags.length) list = c.available_paralinguistic_tags;
    else list = DEFAULT_TAGS;
    return list.map(function (t) { return String(t).replace(/^\[|\]$/g, '').trim().toLowerCase(); }).filter(Boolean);
  }
  function tagsAllowed() { return !activeModel() || caps().tags; }
  function knownTags() { return tagList(); }

  function renderTags() {
    var tags = tagList(), used = {}, html = '';
    function group(name, items) {
      return '<div class="tag-group"><span class="tag-group-name">' + YB.esc(name) + '</span><div class="tag-row">' +
        items.map(function (t) { return '<button type="button" data-tag="' + YB.esc(t) + '" title="Adds [' + YB.esc(t) + '] at your cursor">[' + YB.esc(t) + ']</button>'; }).join('') +
        '</div></div>';
    }
    TAG_GROUPS.forEach(function (g) {
      var items = g[1].filter(function (t) { return tags.indexOf(t) !== -1; });
      items.forEach(function (t) { used[t] = 1; });
      if (items.length) html += group(g[0], items);
    });
    var extra = tags.filter(function (t) { return !used[t]; });
    if (extra.length) html += group('More', extra);
    $('tagButtons').innerHTML = html;
    if (tags.length && tagsAllowed()) YB.store.set('voiceTags', tags);   // Story Studio shows the same chips
    updateTagVisibility();
  }

  // The tag panel shows while you're typing in the script (and stays while you tap chips).
  var tagUi = { open: false, start: null, end: null, hideTimer: 0, chipAt: 0 };
  function updateTagVisibility() {
    var allowed = tagsAllowed() && tagList().length > 0;
    $('tagBox').hidden = !(allowed && tagUi.open);
    $('tagHint').hidden = !allowed || tagUi.open;
    var off = $('tagOff');
    off.hidden = allowed || !activeModel();
    if (!allowed && activeModel()) off.textContent = '😄 Reaction tags like [laugh] work with Turbo. ' + (MODEL_NAMES[activeModel()] || activeModel()) + ' uses the Exaggeration slider for emotion instead — any tags in your script are left out when it generates.';
  }
  function openTags() { clearTimeout(tagUi.hideTimer); tagUi.open = true; updateTagVisibility(); }
  function maybeCloseTags() {
    clearTimeout(tagUi.hideTimer);
    tagUi.hideTimer = setTimeout(function () {
      var ae = document.activeElement;
      if (ae === $('scriptText') || $('tagBox').contains(ae)) return;
      if (Date.now() - tagUi.chipAt < 300) { maybeCloseTags(); return; }   // just tapped a chip — check again shortly
      tagUi.open = false; updateTagVisibility();
    }, 250);
  }
  function saveCursor() {
    var ta = $('scriptText');
    if (ta.selectionStart != null) { tagUi.start = ta.selectionStart; tagUi.end = ta.selectionEnd; }
  }

  // Non-Turbo models would read "[laugh]" out loud, so tags are removed for them.
  function prepareText(text) {
    text = String(text || '');
    if (tagsAllowed()) return text.trim();
    var names = DEFAULT_TAGS.concat(tagList());
    return text.replace(/\[([^\]]{1,24})\]/g, function (m, inner) {
      return names.indexOf(inner.trim().toLowerCase()) !== -1 ? ' ' : m;
    }).replace(/[ \t]{2,}/g, ' ').replace(/ +\n/g, '\n').trim();
  }

  /* ---------- Model-aware controls ---------- */
  function applyModelUI() {
    var t = activeModel(), c = caps();
    renderTags();
    if (storyHooks && storyHooks.modelChanged) storyHooks.modelChanged();   // character settings follow the model
    $('exaggerationField').hidden = !c.exaggeration;
    $('cfgField').hidden = !c.cfg;
    $('expressionNote').textContent = !t ? '' :
      t === 'turbo' ? 'Turbo uses reaction tags for expression. Exaggeration and CFG Weight are available in Original Chatterbox.' :
      t === 'multilingual' ? 'Multilingual supports Exaggeration. CFG Weight is available in Original Chatterbox.' : '';
    $('languageGroup').hidden = !c.language;
    if (c.language) renderLanguages();
    renderPresets();
    renderEngineCards();
    renderSummary();
  }

  function renderLanguages() {
    var langs = (app.info && app.info.supported_languages) || (app.config && app.config.supported_languages) || { en: 'English' };
    var codes = Object.keys(langs).sort(function (a, b) { return String(langs[a]).localeCompare(String(langs[b])); });
    $('languageSelect').innerHTML = codes.map(function (k) { return '<option value="' + YB.esc(k) + '">' + YB.esc(langs[k]) + '</option>'; }).join('');
    if (codes.indexOf(settings.language) === -1) { settings.language = codes.indexOf('en') !== -1 ? 'en' : codes[0]; saveSettings(); }
    $('languageSelect').value = settings.language;
  }

  function renderPresets() {
    var t = activeModel() || 'turbo', list = PRESETS[t] || PRESETS.turbo;
    $('presetModel').textContent = '· for ' + (MODEL_NAMES[t] || t);
    $('presetChips').innerHTML = list.map(function (p, i) {
      var on = Object.keys(p[1]).every(function (k) { return Math.abs(Number(settings[k]) - p[1][k]) < 0.001; });
      return '<button type="button" class="chip-btn' + (on ? ' on' : '') + '" data-preset="' + i + '">' + YB.esc(p[0]) + '</button>';
    }).join('');
    var locked = app.generating || isSwitching();
    $('presetChips').querySelectorAll('button').forEach(function (b) { b.disabled = locked; });
  }

  function applyPreset(i) {
    var t = activeModel() || 'turbo', p = (PRESETS[t] || PRESETS.turbo)[i];
    if (!p || app.generating || isSwitching()) return;
    var v = p[1];
    if (v.temperature != null) settings.temperature = clampTo(v.temperature, TEMP_MIN, TEMP_MAX, 0.05);
    if (v.speed != null) settings.speed = clampSpeed(v.speed);
    if (v.chunk != null) settings.chunk = clampChunk(v.chunk);
    if (v.exaggeration != null) settings.exaggeration = clampTo(v.exaggeration, EXAG_MIN, EXAG_MAX, 0.05);
    if (v.cfg != null) settings.cfg = clampTo(v.cfg, CFG_MIN, CFG_MAX, 0.05);
    saveSettings(); fillSettings(); updateScriptMeta(); renderPresets();
    YB.toast('Preset: ' + p[0]);
  }

  // One place builds every /jobs payload — single script and story lines alike.
  // Only fields the active model accepts are sent; no null/undefined values.
  function buildGenerationPayload(text, voice, overrides) {
    var c = caps();
    var body = {
      text: prepareText(text),
      voice_mode: voice.mode === 'clone' ? 'clone' : 'predefined',
      output_format: settings.format,
      split_text: !!settings.split,
      chunk_size: clampChunk(settings.chunk),
      temperature: clampTo(settings.temperature, TEMP_MIN, TEMP_MAX, 0.05),
      seed: Math.max(0, Math.round(Number(settings.seed) || 0)),
      speed_factor: clampSpeed(settings.speed)
    };
    if (body.voice_mode === 'clone') body.reference_audio_filename = voice.id;
    else body.predefined_voice_id = voice.id;
    if (c.exaggeration) body.exaggeration = clampTo(settings.exaggeration, EXAG_MIN, EXAG_MAX, 0.05);
    if (c.cfg) body.cfg_weight = clampTo(settings.cfg, CFG_MIN, CFG_MAX, 0.05);
    body.language = c.language ? (settings.language || 'en') : 'en';
    Object.assign(body, overrides || {});
    Object.keys(body).forEach(function (k) { if (body[k] === null || body[k] === undefined || body[k] === '') delete body[k]; });
    return body;
  }

  /* ---------- Story Studio import ---------- */
  function storiesList() { return YB.store.get('stories', []); }

  function renderImport(selectedStory) {
    var stories = storiesList();
    var sSel = $('importStory');
    if (!stories.length) {
      sSel.innerHTML = '<option value="">No stories yet — write one in Story Studio</option>';
      $('importSpeaker').innerHTML = '<option value="all">All spoken lines</option>';
      $('importBtn').disabled = true;
      return;
    }
    $('importBtn').disabled = false;
    sSel.innerHTML = stories.map(function (s) { return '<option value="' + YB.esc(s.id) + '">' + YB.esc(s.title || 'Untitled') + '</option>'; }).join('');
    if (selectedStory) sSel.value = selectedStory;
    renderImportSpeakers();
  }

  function renderImportSpeakers() {
    var story = storiesList().find(function (s) { return s.id === $('importStory').value; });
    if (!story) return;
    var cast = [{ id: 'narrator', name: 'Narrator' }].concat(story.characters || []);
    $('importSpeaker').innerHTML = '<option value="all">All spoken lines</option>' + cast.map(function (c) {
      var n = (story.blocks || []).filter(function (b) { return b.type === 'line' && (b.speaker === c.id || (story.mode === 'multi' && (b.with || []).indexOf(c.id) !== -1)) && b.text.trim(); }).length;
      return n ? '<option value="' + YB.esc(c.id) + '">' + YB.esc(c.name) + ' only (' + n + ' lines)</option>' : '';
    }).join('');
  }

  // Spoken text only: drops scene headings, directions and [placeholder] notes,
  // keeps real expression tags like [laugh].
  function storyText(storyId, speaker) {
    var story = storiesList().find(function (s) { return s.id === storyId; });
    if (!story) return '';
    var tags = knownTags();
    return (story.blocks || []).filter(function (b) {
      return b.type === 'line' && (speaker === 'all' || b.speaker === speaker || (story.mode === 'multi' && (b.with || []).indexOf(speaker) !== -1));   // group lines count for everyone in them
    }).map(function (b) {
      return b.text.replace(/\[([^\]]*)\]/g, function (m, inner) { return tags.indexOf(inner.trim().toLowerCase()) !== -1 ? '[' + inner.trim().toLowerCase() + ']' : ' '; })
        .replace(/[ \t]+/g, ' ').trim();
    }).map(function (t) { return t && window.YBGrammar ? window.YBGrammar.fixLine(t, (story.characters || []).map(function (c) { return c.name; })) : t; })   // tidy grammar (js/voice-grammar.js)
      .filter(Boolean).join('\n\n');
  }

  function importFromStory(storyId, speaker, silent) {
    var text = storyText(storyId, speaker);
    if (!text) { YB.toast('Those lines are empty — write some dialogue first'); return; }
    var ta = $('scriptText');
    if (!silent && ta.value.trim() && ta.value.trim() !== text && !confirm('Replace the current script with the imported lines?')) return;
    ta.value = text;
    updateScriptMeta(); YB.store.set('voiceScript', text);
    YB.toast(window.YBGrammar ? 'Imported from Story Studio · grammar tidied' : 'Imported from Story Studio');
  }

  /* ---------- Generation (async jobs only — never POST /tts) ---------- */
  function renderSummary() {
    var el = $('genSummary'); if (!el) return;
    if (storyHooks && storyHooks.active()) { el.textContent = storyHooks.summary(); return; }
    var voice = settings.voiceKey ? (library ? library.label(settings.voiceKey) : settings.voiceKey.replace(/^builtin:/, '')) : 'No voice selected';
    el.textContent = voice + ' · ' + String(settings.format).toUpperCase() + (activeModel() ? ' · ' + (MODEL_NAMES[activeModel()] || activeModel()) : '');
  }

  // `voice` is what the library resolved: { mode: 'predefined'|'clone', id }.
  function buildRequest(voice) {
    return buildGenerationPayload($('scriptText').value, voice);
  }

  var PHASES = {
    submit: ['Queued', 'Submitting job…', 'Sending your script to the server.'],
    queued: ['Queued', 'Queued…', 'Waiting for Chatterbox to start this job.'],
    running: ['Generating', 'Generating speech…', 'Generating chunked speech on CPU. Longer scripts can take several minutes. You can leave this page — it picks the job back up when you return.'],
    processing: ['Generating', 'Downloading audio…', 'Speech is ready — downloading the audio file.']
  };

  function setPhase(name, detail) {
    var p = PHASES[name];
    setState('generating', p[0]);
    $('genStatusText').textContent = p[1];
    $('genDetail').textContent = detail || p[2];
  }

  // Progress bar while a library voice is sent to the server before the job.
  function prepProgress(on, detail) {
    clearInterval(app.elapsedTimer);
    if (!on) { $('genProgress').hidden = true; if (app.state === 'generating') setState(app.info && app.info.loaded ? 'online' : 'connecting', app.info && app.info.loaded ? onlineLabel() : undefined); updateControls(); return; }
    app.startedAt = Date.now();
    showNotice($('genError'), null);
    $('genProgress').hidden = false;
    setState('generating', 'Preparing');
    $('genStatusText').textContent = 'Getting your voice ready…';
    $('genDetail').textContent = detail || '';
    tickElapsed(); app.elapsedTimer = setInterval(tickElapsed, 1000);
  }

  function startGenerating() {
    app.generating = true;
    clearRemoteGen(false);
    stopPolling();                       // no health / model-info checks during a job
    app.startedAt = Date.now();
    showNotice($('genError'), null);
    $('genProgress').hidden = false;
    setPhase('submit');
    tickElapsed();
    clearInterval(app.elapsedTimer);
    app.elapsedTimer = setInterval(tickElapsed, 1000);
  }

  function tickElapsed() { $('genElapsed').textContent = mmss((Date.now() - app.startedAt) / 1000) + ' elapsed'; }

  function stopGenerating() {
    app.generating = false;
    app.lastOwnEnd = Date.now();
    clearInterval(app.elapsedTimer);
    $('genProgress').hidden = true;
    // Resume health checks. Show the last known good state right away; the
    // follow-up check (once the CPU has had a moment) confirms it.
    var known = app.info && app.info.loaded;
    setState(known ? 'online' : 'connecting', known ? onlineLabel() : undefined);
    startPolling();
    // Never checked yet (we went straight into a resumed job): check now and load lists.
    setTimeout(function () { if (!app.generating) checkHealth(known ? { silent: true } : { loadLists: true }); }, known ? 4000 : 0);
  }

  // Confirms a clone reference is in the server's list right now. Uses a fresh
  // GET /get_reference_files; if that can't be fetched (Chatterbox busy), the
  // last list the server returned this session.
  function verifyReferences(names) {
    return loadReferences(true).then(function (files) {
      var list = files || app.refFiles || [];
      return names.filter(function (n) { return list.indexOf(n) === -1; });
    });
  }

  function generate() {
    if (app.generating || app.job || app.preparing) return;   // never two jobs at once
    if (isSwitching()) { YB.toast('Wait for the model switch to finish'); return; }
    if (app.remoteBusy) { YB.toast('Another user is generating — this unlocks when the server is free'); return; }
    if (storyHooks && storyHooks.active()) { storyHooks.generate(); return; }
    showNotice($('genError'), null);
    var text = $('scriptText').value.trim();
    if (!app.backend) { showNotice($('genError'), makeErr('offline', 'Backend is not connected.')); return; }
    if (!text) { showNotice($('genError'), makeErr('validation', 'Add some narration to the script first.'), 'warn'); $('scriptText').focus(); return; }
    if (!prepareText(text)) { showNotice($('genError'), makeErr('validation', 'The script only has reaction tags — add some words to say.'), 'warn'); return; }

    if (!settings.voiceKey) { showNotice($('genError'), makeErr('voice-missing', 'Choose a voice first.'), 'warn'); return; }

    var key = settings.voiceKey, resolved = null, token = ++app.prepToken;
    var upload = library && library.groupOf(key) !== 'builtin';
    app.preparing = true; updateControls();
    if (upload) prepProgress(true, 'Sending "' + library.label(key) + '" to the server so it can be cloned.');
    var ready = library ? library.resolve(key, function (msg) { if (token === app.prepToken) { renderPickNote(msg); if (upload) $('genDetail').textContent = msg; } })
      : Promise.resolve({ mode: 'predefined', id: key.replace(/^builtin:/, '') });
    ready.then(function (voice) {
      if (token !== app.prepToken) return false;
      resolved = voice; renderPickNote();
      return checkOrphan();
    }, function (err) {
      if (token !== app.prepToken) return false;
      renderPickNote(); prepProgress(false);
      showNotice($('genError'), networkError(err), err.kind === 'validation' ? 'warn' : undefined);
      return false;
    }).then(function (ok) {
      if (token !== app.prepToken) return;      // cancelled while preparing
      app.preparing = false; updateControls();
      if (!ok) prepProgress(false);
      if (!ok || app.generating || !resolved) return;
      app.jobVoiceKey = key;
      runJob(buildRequest(resolved));
    });
  }

  // The job API has no cancel route today, so Cancel stops waiting and says so.
  // If backend-config.json ever publishes "job_cancel_template"
  // (e.g. ".../jobs/{job_id}/cancel"), Cancel also asks the server to stop.
  function requestServerCancel(id) {
    var tpl = app.source === 'config' && app.config && app.config.job_cancel_template;
    if (!tpl || !isHttpUrl(tpl) || tpl.indexOf('{job_id}') === -1) return false;
    call(tpl.replace('{job_id}', encodeURIComponent(id)), { method: 'POST' }, SHORT_TIMEOUT_MS)
      .then(function (res) { if (!res.ok) console.warn('[Voice Studio] cancel request HTTP ' + res.status); },
        function (err) { console.warn('[Voice Studio] cancel request failed', err); });
    return true;
  }

  function cancelGeneration() {
    if (!app.generating && app.preparing) {      // still getting the voice ready: nothing was sent yet
      app.prepToken++; app.preparing = false; prepProgress(false); renderPickNote();
      var b = $('genError'); b.className = 'notice warn'; b.hidden = false;
      b.innerHTML = '<b>Stopped before anything was sent.</b>Nothing is generating on the server.';
      updateControls(); return;
    }
    if (!app.generating) return;
    if (storyHooks && storyHooks.running()) { storyHooks.cancel(); return; }
    app.jobToken++;                          // ignore any reply still in flight
    var id = app.job && app.job.id;
    var serverCancel = id ? requestServerCancel(id) : false;
    if (id && !serverCancel) { app.orphanJob = id; markOwnBg(); }
    clearTimeout(app.pollTimer);
    app.job = null; saveActiveJob();
    stopGenerating();
    var el = $('genError');
    el.className = 'notice warn'; el.hidden = false;
    el.innerHTML = serverCancel
      ? '<b>Stopped waiting for this generation.</b>A cancel request was sent to the server.'
      : '<b>Stopped waiting for this generation.</b>The server can\'t cancel a running job, so Chatterbox will finish it in the background — the CPU stays busy until then.';
  }

  /* ---------- Job flow: POST /jobs → poll GET /jobs/{id} → GET /jobs/{id}/audio ---------- */
  function saveActiveJob() {
    if (app.job) YB.store.set('voiceJob', { id: app.job.id, ext: app.job.ext, backend: app.backend, startedAt: app.startedAt });
    else YB.store.remove('voiceJob');
  }

  function runJob(body) {
    var token = ++app.jobToken;
    startGenerating();
    console.info('[Voice Studio] POST /jobs', Object.assign({}, body, { text: body.text.length + ' chars' }));
    call(route('jobs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, SHORT_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) return httpError(res, 'job').then(function (e) { throw e; });
        return readJson(res);
      })
      .then(function (data) {
        if (!data || !data.job_id) throw makeErr('tts', 'Backend did not return a job ID.');
        if (token !== app.jobToken) { app.orphanJob = data.job_id; return; } // cancelled while submitting
        app.job = { id: data.job_id, ext: body.output_format, fails: 0, delay: JOB_POLL_MS, audioTries: 0 };
        saveActiveJob();
        setPhase(data.status === 'running' ? 'running' : 'queued');
        scheduleJobPoll();
      })
      .catch(function (err) {
        if (token !== app.jobToken) return;
        finishJob(networkError(err));
      });
  }

  function scheduleJobPoll() {
    clearTimeout(app.pollTimer);
    if (app.job) app.pollTimer = setTimeout(pollJob, app.job.delay);
  }

  // One short status request every ~3 s. The overall job has no time limit;
  // only repeated connection failures (tunnel gone) end the wait.
  function pollJob() {
    var job = app.job; if (!job) return;
    call(jobRoute(job.id) + '?ts=' + Date.now(), {}, SHORT_TIMEOUT_MS)
      .then(function (res) {
        if (res.status === 404) {
          return res.text().then(function (t) {
            if (/job not found/i.test(t)) throw makeErr('job-lost', 'The server no longer has this job.');
            throw Object.assign(makeErr('unavailable', 'Job status page not found.'), { transient: true });
          });
        }
        if (!res.ok) return httpError(res, 'status').then(function (e) { e.transient = true; throw e; });
        return readJson(res);
      })
      .then(function (data) {
        if (app.job !== job) return;
        job.fails = 0; job.delay = JOB_POLL_MS;
        if (data.status === 'complete') return fetchJobAudio(job, data.format);
        if (data.status === 'failed') { finishJob(jobFailure(data.error)); return; }
        if (data.status === 'cancelled' || data.status === 'canceled') { finishJob(makeErr('http', 'The server cancelled this job.')); return; }
        setPhase(data.status === 'queued' ? 'queued' : 'running');
        scheduleJobPoll();
      })
      .catch(function (err) {
        if (app.job !== job) return;
        err = networkError(err);
        var transient = err.transient || err.kind === 'offline' || err.kind === 'timeout' || err.kind === 'unavailable' || err.kind === 'tunnel';
        if (!transient) { finishJob(err); return; }
        // Tunnel hiccups are normal on long jobs — keep waiting with backoff.
        job.fails++;
        job.delay = Math.min(JOB_POLL_MAX_MS, Math.round(job.delay * 1.5));
        if (job.fails >= JOB_MAX_FAILS) { finishJob(makeErr('lost', 'Lost contact with the job server while waiting for the audio.')); return; }
        $('genDetail').textContent = 'Connection hiccup — still waiting for the server (retry ' + job.fails + ')…';
        scheduleJobPoll();
      });
  }

  function fetchJobAudio(job, fmt) {
    setPhase('processing');
    return call(jobRoute(job.id, true), {}, AUDIO_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) return httpError(res, 'audio').then(function (e) { e.transient = res.status >= 500 || res.status === 409; throw e; });
        var ct = (res.headers.get('content-type') || '').toLowerCase();
        if (/json|html/.test(ct)) return res.text().then(function (t) { console.error('[Voice Studio] audio endpoint returned', t.slice(0, 600)); throw makeErr('tts', 'The server sent something other than audio.'); });
        return res.blob();
      })
      .then(function (blob) {
        if (app.job !== job) return;
        if (!blob || blob.size < 100) throw makeErr('tts', 'The server returned an empty audio file.');
        var ext = fmt || job.ext;
        // Kept exactly as Chatterbox made it — never re-processed.
        return Promise.resolve({ blob: blob, gainDb: null }).then(function (r) {
          if (app.job !== job) return;
          showAudio(r.blob, ext, null, null, gainNote(r));
          if (window.YBTakes) {
            var vk = app.jobVoiceKey || settings.voiceKey;
            window.YBTakes.add({ kind: 'single', title: 'Speech · ' + (library && vk ? library.label(vk).replace(/ · .*$/, '') : 'voice'), text: $('scriptText').value.trim(), blob: r.blob, ext: ext, note: gainNote(r) });
          }
          YB.toast('Complete — speech ready');
          finishJob(null);
        });
      })
      .catch(function (err) {
        if (app.job !== job) return;
        err = networkError(err);
        if ((err.transient || err.kind === 'offline' || err.kind === 'timeout' || err.kind === 'unavailable') && ++job.audioTries < 4) {
          $('genDetail').textContent = 'Download interrupted — retrying (' + job.audioTries + ')…';
          setTimeout(function () { if (app.job === job) fetchJobAudio(job, fmt); }, 3000);
          return;
        }
        finishJob(err);
      });
  }

  // The job API reports Chatterbox failures as text like:
  //   Chatterbox HTTP 500: {"detail":"TTS engine failed to synthesize audio for chunk 1."}
  // The summary is made readable; the exact job.error is always kept in err.raw
  // so it shows in the expandable details (with Copy Error).
  function jobFailure(text, voiceMode) {
    text = String(text || '');
    console.error('[Voice Studio] job failed:', text.slice(0, 4000));
    var e = summarizeFailure(text, voiceMode || (/^builtin:/.test(settings.voiceKey) ? 'predefined' : 'clone'));
    e.raw = text || '(the server returned no error text)';
    return e;
  }

  function summarizeFailure(text, voiceMode) {
    var m = /HTTP (\d{3}):\s*([\s\S]*)$/.exec(text);
    var status = m ? Number(m[1]) : 0, detail = '';
    if (m) {
      try {
        var j = JSON.parse(m[2]);
        detail = typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? j.detail.map(function (d) { return (d.loc ? d.loc[d.loc.length - 1] + ': ' : '') + d.msg; }).join('; ') : '';
      } catch (err) { detail = /^\s*</.test(m[2]) ? '' : m[2].slice(0, 200); }
    }
    if (status === 404) return voiceMode === 'clone' ? makeErr('ref-missing', detail || 'Reference file not found on the server.') : makeErr('voice-missing', detail || 'That voice was not found on the server.');
    if (status === 503) return makeErr('model', detail || 'The Chatterbox model is not loaded.');
    if (status === 422) return /output_format/i.test(detail) ? makeErr('format', 'That output format isn\'t supported.') : makeErr('validation', detail || 'The server rejected one of the settings.');
    if (status) return makeErr('tts', 'Speech generation failed: ' + (detail || ('Chatterbox returned HTTP ' + status + '.')));
    if (/connection|refused|max retries|timed out/i.test(text)) return makeErr('tts', 'The job server couldn\'t reach Chatterbox — it may have crashed or restarted.');
    return makeErr('tts', 'Speech generation failed on the server.');
  }

  function finishJob(err) {
    clearTimeout(app.pollTimer);
    app.job = null; saveActiveJob();
    if (err) {
      if (err.kind === 'ref-missing' && library && app.jobVoiceKey) library.forget(app.jobVoiceKey);   // re-uploaded next time
      if (err.kind === 'voice-missing') loadVoices(true);
      showNotice($('genError'), err);
    }
    stopGenerating();
  }

  // Before a new job: if a job we stopped waiting for is still running, ask first.
  function checkOrphan() {
    if (!app.orphanJob) return Promise.resolve(true);
    var id = app.orphanJob;
    return call(jobRoute(id) + '?ts=' + Date.now(), {}, SHORT_TIMEOUT_MS)
      .then(function (res) { return res.ok ? readJson(res) : null; })
      .catch(function () { return null; })
      .then(function (d) {
        if (d && (d.status === 'queued' || d.status === 'running')) {
          return confirm('A generation you stopped waiting for is still running on the server. Starting another now makes both slower on the CPU.\n\nStart a new one anyway?');
        }
        app.orphanJob = null;
        return true;
      });
  }

  // Reopened the page mid-job? Re-attach straight away (before any health
  // check — a busy CPU makes /model-info slow, and Generate must stay locked).
  function resumeJob() {
    var saved = YB.store.get('voiceJob', null);
    if (!saved || !saved.id) return false;
    if (normalizeUrl(saved.backend) !== app.backend) { YB.store.remove('voiceJob'); return false; }
    startGenerating();
    app.startedAt = saved.startedAt || Date.now();
    tickElapsed();
    app.job = { id: saved.id, ext: saved.ext || settings.format, fails: 0, delay: 500, audioTries: 0 };
    setPhase('running', 'Picking up your generation where it left off…');
    scheduleJobPoll();
    return true;
  }

  function resumeOrCheck(opts) {
    if (!app.generating && !app.switching && resumeSwitch()) { app.preparing = false; return Promise.resolve(true); }
    if (!app.generating && resumeJob()) { app.preparing = false; return Promise.resolve(true); }
    if (!app.generating && storyHooks && storyHooks.resume && storyHooks.resume(app.backend)) { app.preparing = false; return Promise.resolve(true); }
    return checkHealth(opts);
  }

  /* ---------- Loudness levelling (WAV) ----------
     GENTLE MODE (current): one volume change per clip, ±6 dB at most, never above the
     clip's own peak — no limiter, no compression. The notes below describe the earlier,
     stronger version; limit() is kept but no longer used.
     Brings every clip to one speaking level so it sounds right on YouTube and
     every voice/character matches. Volume only: one gain for the whole clip,
     plus a gentle look-ahead limiter on the rare loudest peaks (at most 3 dB,
     never above -1 dBFS). Tuned on real output: tone stays within ~0.15 dB in
     every band. If reaching the target would need more limiting, the clip is
     raised less instead. Within 1 dB of the target → returned untouched.
     Anything unexpected → original kept as is. */
  var LEVEL_TARGET_DB = -16.5;      // speech level of the good reference story
  var LEVEL_CEIL = Math.pow(10, -1 / 20), LEVEL_MAX_LIMIT_DB = 3, LEVEL_MIN_DB = -6, LEVEL_MAX_DB = 6, LEVEL_DEADBAND_DB = 1.5;
  var LEVEL_NOISE_CEIL_DB = -55;    // background level of the good reference story

  function parseWav(buf) {
    var dv = new DataView(buf);
    if (buf.byteLength < 44 || dv.getUint32(0, false) !== 0x52494646 || dv.getUint32(8, false) !== 0x57415645) return null;
    var off = 12, fmt = null, data = null;
    while (off + 8 <= buf.byteLength) {
      var id = dv.getUint32(off, false), size = dv.getUint32(off + 4, true), body = off + 8;
      if (id === 0x666d7420) {
        var tag = dv.getUint16(body, true);
        if (tag === 0xFFFE && size >= 40) tag = dv.getUint16(body + 24, true);   // WAVE_FORMAT_EXTENSIBLE
        fmt = { tag: tag, ch: dv.getUint16(body + 2, true), rate: dv.getUint32(body + 4, true), bits: dv.getUint16(body + 14, true) };
      } else if (id === 0x64617461) { data = { off: body, size: Math.min(size, buf.byteLength - body) }; break; }
      off = body + size + (size & 1);
    }
    if (!fmt || !data || !fmt.ch || !fmt.rate) return null;
    var B = fmt.bits / 8, ch = fmt.ch, n = Math.floor(data.size / (B * ch));
    if (!((fmt.tag === 1 && (fmt.bits === 16 || fmt.bits === 24 || fmt.bits === 32)) || (fmt.tag === 3 && fmt.bits === 32))) return null;
    var chans = [];
    for (var c = 0; c < ch; c++) chans.push(new Float32Array(n));
    for (var i = 0, o = data.off; i < n; i++) {
      for (c = 0; c < ch; c++, o += B) {
        var v;
        if (fmt.tag === 3) v = dv.getFloat32(o, true);
        else if (B === 2) v = dv.getInt16(o, true) / 32768;
        else if (B === 3) { v = dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16); v /= 8388608; }
        else v = dv.getInt32(o, true) / 2147483648;
        chans[c][i] = v;
      }
    }
    return { rate: fmt.rate, bits: fmt.tag === 3 ? 32 : fmt.bits, float: fmt.tag === 3, chans: chans };
  }

  function encodeWavPcm(chans, rate, bits, isFloat) {
    var ch = chans.length, n = chans[0].length, B = isFloat ? 4 : (bits === 24 ? 3 : 2);
    var buf = new ArrayBuffer(44 + n * ch * B), dv = new DataView(buf);
    function str(o, t) { for (var i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); }
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * ch * B, true); str(8, 'WAVE'); str(12, 'fmt ');
    dv.setUint32(16, 16, true); dv.setUint16(20, isFloat ? 3 : 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * ch * B, true); dv.setUint16(32, ch * B, true); dv.setUint16(34, B * 8, true);
    str(36, 'data'); dv.setUint32(40, n * ch * B, true);
    for (var i = 0, o = 44; i < n; i++) {
      for (var c = 0; c < ch; c++, o += B) {
        var v = Math.max(-1, Math.min(1, chans[c][i]));
        if (isFloat) dv.setFloat32(o, v, true);
        else if (B === 2) dv.setInt16(o, Math.round(v < 0 ? v * 32768 : v * 32767), true);
        else { var q = Math.round(v < 0 ? v * 8388608 : v * 8388607); dv.setUint8(o, q & 255); dv.setUint8(o + 1, (q >> 8) & 255); dv.setUint8(o + 2, (q >> 16) & 255); }
      }
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // Speech level: power mean of 20 ms frames that carry speech (ignores pauses).
  function speechLevelDb(chans, rate) {
    var n = chans[0].length, fl = Math.max(1, Math.round(rate * 0.02)), frames = [], loud = 0;
    for (var s = 0; s + fl <= n; s += fl) {
      var p = 0;
      for (var i = s; i < s + fl; i++) { var m = 0; for (var c = 0; c < chans.length; c++) m += chans[c][i]; m /= chans.length; p += m * m; }
      p /= fl; frames.push(p); if (p > loud) loud = p;
    }
    var gate = Math.max(Math.pow(10, -50 / 10), loud * Math.pow(10, -30 / 10)), sum = 0, k = 0;
    frames.forEach(function (p) { if (p >= gate) { sum += p; k++; } });
    if (k * fl < rate * 0.3) return null;           // under 0.3 s of speech: leave it alone
    var sorted = frames.slice().sort(function (a, b) { return a - b; });
    var floor = sorted[Math.floor(sorted.length * 0.1)] || 0;   // quietest 10 %: room / background noise
    return { db: 10 * Math.log10(sum / k), floorDb: floor > 0 ? 10 * Math.log10(floor) : -120 };
  }

  // Look-ahead limiter: gain envelope reaches the needed reduction before each peak, recovers smoothly.
  function limit(chans, rate) {
    var n = chans[0].length, L = Math.max(1, Math.round(rate * 0.002)), rel = 1 - Math.exp(-1 / (rate * 0.03));
    var need = new Float32Array(n), any = false, i, c;
    for (i = 0; i < n; i++) {
      var pk = 0; for (c = 0; c < chans.length; c++) { var a = Math.abs(chans[c][i]); if (a > pk) pk = a; }
      need[i] = pk > LEVEL_CEIL ? LEVEL_CEIL / pk : 1; if (need[i] < 1) any = true;
    }
    if (!any) return 0;
    // sliding minimum over [i-L, i+L]
    var mn = new Float32Array(n), dq = new Int32Array(n), h = 0, t = 0, j = 0;
    for (i = 0; i < n; i++) {
      for (; j < n && j <= i + L; j++) { while (t > h && need[dq[t - 1]] >= need[j]) t--; dq[t++] = j; }
      while (dq[h] < i - L) h++;
      mn[i] = need[dq[h]];
    }
    // Box average of that minimum over [i-L, i+L] (outside the clip counts as 1).
    // Every value in a peak's window is ≤ the gain that peak needs, so the average
    // is too: the ceiling always holds, and the gain glides in over ~2 ms.
    var P = new Float64Array(n + 1), w = 2 * L + 1;
    for (i = 0; i < n; i++) P[i + 1] = P[i] + mn[i];
    var env = new Float32Array(n), prev = 1, deepest = 1;
    for (i = 0; i < n; i++) {
      var lo = i - L, hi = i + L, inside = P[Math.min(n, hi + 1)] - P[Math.max(0, lo)];
      var outside = Math.max(0, -lo) + Math.max(0, hi - (n - 1));
      var e = Math.min((inside + outside) / w, prev + (1 - prev) * rel);   // smooth ~30 ms recovery
      env[i] = e; prev = e; if (e < deepest) deepest = e;
    }
    for (c = 0; c < chans.length; c++) for (i = 0; i < n; i++) {
      var v = chans[c][i] * env[i];
      chans[c][i] = v > LEVEL_CEIL ? LEVEL_CEIL : v < -LEVEL_CEIL ? -LEVEL_CEIL : v;   // rounding guard only
    }
    return -20 * Math.log10(deepest);
  }

  // In-place on float channels. Returns { gainDb, limitDb } or null when nothing was changed.
  function levelChannels(chans, rate) {
    var m = speechLevelDb(chans, rate);
    if (!m || !isFinite(m.db)) return null;
    var lvl = m.db;
    if (Math.abs(LEVEL_TARGET_DB - lvl) < LEVEL_DEADBAND_DB) return null;   // already right: leave every sample as is
    var gainDb = Math.max(LEVEL_MIN_DB, Math.min(LEVEL_MAX_DB, LEVEL_TARGET_DB - lvl));
    // Never pull background hiss / room sound up past a clean recording's floor:
    // a noisy clip is raised less (or not at all) so it stays clear, not loud-and-distant.
    if (gainDb > 0) gainDb = Math.min(gainDb, Math.max(0, LEVEL_NOISE_CEIL_DB - m.floorDb));
    var peak = 0, c, i;
    for (c = 0; c < chans.length; c++) for (i = 0; i < chans[c].length; i++) { var a = Math.abs(chans[c][i]); if (a > peak) peak = a; }
    if (!peak) return null;
    // Gentle: Chatterbox's own sound is kept. Only one volume change for the whole clip,
    // never past the loudest peak (no limiter, no compression), at most ±6 dB.
    var headroom = 20 * Math.log10(LEVEL_CEIL) - 20 * Math.log10(peak);
    if (gainDb > headroom) gainDb = Math.max(0, headroom);
    if (Math.abs(gainDb) < 0.5) return null;
    var g = Math.pow(10, gainDb / 20);
    for (c = 0; c < chans.length; c++) for (i = 0; i < chans[c].length; i++) chans[c][i] *= g;
    return { gainDb: gainDb, limitDb: 0 };
  }

  // Blob → Promise<{ blob, gainDb }>. Only WAV is processed; when off, not WAV,
  // or anything goes wrong, the original blob comes back untouched.
  function levelBlob(blob, ext) {
    if (!settings.level || String(ext || '').toLowerCase() !== 'wav') return Promise.resolve({ blob: blob, gainDb: null });
    return blob.arrayBuffer().then(function (buf) {
      var w = parseWav(buf);
      if (!w || !w.chans[0].length) return { blob: blob, gainDb: null };
      var r = levelChannels(w.chans, w.rate);
      if (!r) return { blob: blob, gainDb: 0 };
      return { blob: encodeWavPcm(w.chans, w.rate, w.bits, w.float), gainDb: r.gainDb, limitDb: r.limitDb };
    }).catch(function (err) {
      console.warn('[Voice Studio] loudness levelling skipped', err);
      return { blob: blob, gainDb: null };
    });
  }
  // Gain (linear) that would bring one line to the common speaking level — used only
  // while stitching the full story track; the saved line clips are never changed.
  function matchGain(samples, rate) {
    var chans = [Float32Array.from(samples)], r = levelChannels(chans, rate);
    return r ? Math.pow(10, r.gainDb / 20) : 1;
  }
  // Undo an earlier volume change (pure gain) so a clip sounds exactly as generated again.
  function unlevelBlob(blob, gainDb) {
    return blob.arrayBuffer().then(function (buf) {
      var w = parseWav(buf); if (!w || !isFinite(gainDb) || !gainDb) return null;
      var g = Math.pow(10, -gainDb / 20);
      w.chans.forEach(function (ch) { for (var i = 0; i < ch.length; i++) ch[i] *= g; });
      return encodeWavPcm(w.chans, w.rate, w.bits, w.float);
    }).catch(function () { return null; });
  }
  function gainNote(r) {
    if (!r || r.gainDb === null) return '';
    return r.gainDb === 0 ? 'level already right' : 'levelled ' + (r.gainDb > 0 ? '+' : '') + r.gainDb.toFixed(1) + ' dB';
  }

  /* ---------- Output ---------- */
  function fileStamp(d) {
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  // The latest output is kept in this browser (IndexedDB) so it's still on the
  // Voice screen after a reload or closing the app, until a new one replaces it
  // or Clear Output is pressed. `saved` = { name, at } when restoring.
  function showAudio(blob, ext, prefix, saved, note) {
    if (app.audioUrl) URL.revokeObjectURL(app.audioUrl);   // no Blob URL leaks
    app.audioUrl = URL.createObjectURL(blob);
    app.audioSeq = (app.audioSeq || 0) + 1;
    var player = $('audioPreview');
    player.src = app.audioUrl;
    var dl = $('downloadAudioBtn');
    var name = saved ? saved.name : (prefix || 'youtube-blue-voice') + '-' + fileStamp(new Date()) + '.' + ext;
    dl.href = app.audioUrl;
    dl.download = name;
    var when = (saved && saved.note ? ' · ' + saved.note : note ? ' · ' + note : '') + (saved && saved.at ? ' · made ' + ago(new Date(saved.at)) : '');
    $('audioInfo').textContent = ext.toUpperCase() + ' · ' + bytesLabel(blob.size) + when;
    player.onloadedmetadata = function () {
      if (isFinite(player.duration)) $('audioInfo').textContent = ext.toUpperCase() + ' · ' + mmss(player.duration) + ' · ' + bytesLabel(blob.size) + when;
    };
    $('audioOutputSection').hidden = false;
    if (!saved) {
      $('audioOutputSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      idb.put('lastAudio', { blob: blob, ext: ext, name: name, at: Date.now(), note: note || '' });
    }
  }

  function syncMainToggle() {
    var a = $('audioPreview'), b = $('mainPlayToggle'); if (!b) return;
    var playing = !a.paused && !a.ended;
    b.classList.toggle('is-playing', playing);
    b.classList.toggle('is-active', playing || (a.currentTime > 0 && !a.ended));
    b.setAttribute('aria-pressed', playing ? 'true' : 'false');
    b.setAttribute('aria-label', (playing ? 'Pause' : 'Play') + ' generated audio');
    b.style.setProperty('--p', a.duration ? Math.min(100, a.currentTime / a.duration * 100).toFixed(1) : 0);
  }

  function clearAudio() {
    var p = $('audioPreview');
    p.pause(); p.removeAttribute('src'); p.load();
    if (app.audioUrl) { URL.revokeObjectURL(app.audioUrl); app.audioUrl = null; }
    app.audioSeq = (app.audioSeq || 0) + 1;
    $('downloadAudioBtn').href = '#';
    $('audioOutputSection').hidden = true;
    idb.del('lastAudio');
  }

  function restoreAudio() {
    var seq = app.audioSeq || 0;
    idb.get('lastAudio').then(function (rec) {
      var m = rec && rec.blob && /levelled ([+-]?\d+(?:\.\d+)?) dB/.exec(rec.note || '');
      if (!m) return rec;
      // made with "Match volume" on: put it back to how Chatterbox made it
      return unlevelBlob(rec.blob, Number(m[1])).then(function (b) {
        if (!b) return rec;
        rec.blob = b; rec.note = 'original sound restored'; idb.put('lastAudio', rec); return rec;
      });
    }).then(function (rec) {
      if (!rec || !rec.blob || (app.audioSeq || 0) !== seq) return;   // a newer result already showed
      showAudio(rec.blob, rec.ext || 'wav', '', { name: rec.name || 'youtube-blue-voice.' + (rec.ext || 'wav'), at: rec.at, note: rec.note });
    });
  }

  /* ---------- Tiny IndexedDB store (audio blobs) ----------
     Every call resolves (null / false on failure) so a browser without
     IndexedDB — or private mode — just skips saving. */
  var idb = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (resolve) {
        try {
          var req = indexedDB.open('youtube-blue-voice', 1);
          req.onupgradeneeded = function () { req.result.createObjectStore('kv'); };
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = req.onblocked = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
      return dbp;
    }
    function tx(mode, fn) {
      return open().then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve) {
          try {
            var t = db.transaction('kv', mode), store = t.objectStore('kv'), out = { v: null };
            fn(store, out);
            t.oncomplete = function () { resolve(out.v); };
            t.onerror = t.onabort = function () { resolve(null); };
          } catch (e) { resolve(null); }
        });
      });
    }
    return {
      get: function (k) { return tx('readonly', function (s, out) { var r = s.get(k); r.onsuccess = function () { out.v = r.result || null; }; }); },
      put: function (k, v) { return tx('readwrite', function (s, out) { s.put(v, k); out.v = true; }); },
      del: function (k) { return tx('readwrite', function (s, out) { s.delete(k); out.v = true; }); },
      delPrefix: function (p) { return tx('readwrite', function (s, out) { s.delete(IDBKeyRange.bound(p, p + '￿')); out.v = true; }); }
    };
  })();

  // Reads the chosen reference clip's length in the browser and warns when it's
  // outside what cloning handles well.
  // Measures a reference clip in the browser. Resolves { seconds, level, text }
  // (level: 'warn' | 'info' | 'ok' | '' when it can't be read).
  function clipLength(file) {
    return new Promise(function (resolve) {
      var url = URL.createObjectURL(file), probe = new Audio();
      function done(r) { URL.revokeObjectURL(url); resolve(r); }
      probe.preload = 'metadata';
      probe.onloadedmetadata = function () {
        var d = probe.duration;
        if (!isFinite(d)) return done({ seconds: 0, level: '', text: '' });
        if (d < REF_SHORT_SEC) done({ seconds: d, level: 'warn', text: '⚠️ ' + d.toFixed(1) + ' s — Very short references may produce unstable voice cloning. Aim for 10–20 seconds.' });
        else if (d > REF_LONG_SEC) done({ seconds: d, level: 'warn', text: '⚠️ ' + Math.round(d) + ' s — the server may reject references longer than 30 seconds. Trim it to 10–20 seconds.' });
        else done(d < 10 ? { seconds: d, level: 'info', text: 'ℹ️ ' + d.toFixed(1) + ' s — usable, but 10–20 seconds gives better results.' }
          : { seconds: d, level: 'ok', text: '✓ ' + Math.round(d) + ' s — a good length.' });
      };
      probe.onerror = function () { done({ seconds: 0, level: '', text: '' }); };
      probe.src = url;
    });
  }

  /* ---------- Shared core for Story (multi-voice) mode — js/voice-story.js ---------- */
  var storyHooks = null;
  window.YBVoice = {
    registerStory: function (hooks) { storyHooks = hooks; updateControls(); },
    registerLibrary: function (lib) { library = lib; renderPicker(); },
    library: function () { return library; },
    selectVoice: selectVoice, renderPicker: renderPicker, bytesLabel: bytesLabel,
    call: call, route: route, jobRoute: jobRoute, readJson: readJson, httpError: httpError,
    networkError: networkError, makeErr: makeErr, jobFailure: jobFailure, showNotice: showNotice,
    verifyReferences: verifyReferences, refreshListsIfStale: refreshListsIfStale,
    loadVoices: loadVoices, loadReferences: loadReferences,
    settings: function () { return settings; },
    pendingStory: function () { return app.pendingStory || ''; },
    clampChunk: clampChunk, knownTags: knownTags, storiesList: storiesList,
    voices: function () { return app.voices; },
    refFiles: function () { return app.refFiles; },
    cloneAvailable: function () { return app.cloneAvailable; },
    backend: function () { return app.backend; },
    isBusy: function () { return app.generating || app.preparing || !!app.job || app.uploading || isSwitching(); },
    buildPayload: buildGenerationPayload, prepareText: prepareText, activeModel: activeModel,
    sendReference: sendReference, clipLength: clipLength,
    updateControls: updateControls,
    // Story runs use the same locks as single generation: no health polling,
    // Generate disabled, Cancel enabled, status pill shows progress.
    remoteBusy: function () { return app.remoteBusy && !app.generating; },
    online: function () { return app.state === 'online'; },
    setPreviewing: function (on) { app.previewing = !!on; if (!on) app.lastOwnEnd = Date.now(); },
    noteOwnBackground: function () { markOwnBg(); },
    cancelServerJob: function (id) { return requestServerCancel(id); },   // only if backend-config.json publishes job_cancel_template
    begin: function (label, startedAt) { if (app.generating) return false; clearRemoteGen(false); app.generating = true; stopPolling(); app.startedAt = startedAt || Date.now();
      showNotice($('genError'), null); $('genProgress').hidden = false; setState('generating', label || 'Generating');
      tickElapsed(); clearInterval(app.elapsedTimer); app.elapsedTimer = setInterval(tickElapsed, 1000); return true; },
    progress: function (pill, title, detail) { setState('generating', pill); $('genStatusText').textContent = title; $('genDetail').textContent = detail; },
    end: function () { stopGenerating(); },
    showAudio: function (blob, ext, prefix, note) { showAudio(blob, ext, prefix, null, note); },
    levelBlob: levelBlob, gainNote: gainNote, levelOn: function () { return !!settings.level; }, unlevelBlob: unlevelBlob, matchGain: matchGain,
    db: idb, normalizeUrl: function (u) { return normalizeUrl(u); },
    // Per-character voice settings (Story mode): defaults, ranges, model caps, labels.
    caps: function () { return caps(); },
    voiceDefaults: function () { return { temperature: DEFAULTS.temperature, speed: DEFAULTS.speed, exaggeration: DEFAULTS.exaggeration, cfg: DEFAULTS.cfg, seed: DEFAULTS.seed,
      language: DEFAULTS.language, split: DEFAULTS.split, chunk: DEFAULTS.chunk }; },
    ranges: { temperature: [TEMP_MIN, TEMP_MAX, 0.05], speed: [SPEED_MIN, SPEED_MAX, 0.01], exaggeration: [EXAG_MIN, EXAG_MAX, 0.05], cfg: [CFG_MIN, CFG_MAX, 0.05], chunk: [CHUNK_MIN, CHUNK_MAX, 10] },
    clampTo: clampTo, clampSpeed: clampSpeed, tempLabel: tempLabel, speedLabel: speedLabel, exagLabel: exagLabel, chunkLabel: chunkLabel,
    presets: function () { var t = activeModel() || 'turbo'; return PRESETS[t] || PRESETS.turbo; },
    modelName: function () { var t = activeModel() || 'turbo'; return MODEL_NAMES[t] || t; },
    languages: function () { return (app.info && app.info.supported_languages) || (app.config && app.config.supported_languages) || { en: 'English' }; },
    errorBox: function () { return $('genError'); },
    SHORT_TIMEOUT_MS: SHORT_TIMEOUT_MS, AUDIO_TIMEOUT_MS: AUDIO_TIMEOUT_MS, JOB_POLL_MS: JOB_POLL_MS, JOB_MAX_FAILS: JOB_MAX_FAILS
  };

  /* ---------- Events ---------- */
  function bind() {
    // backend
    $('testBtn').addEventListener('click', function () { checkHealth({ loadLists: true }); });
    $('refreshBackendBtn').addEventListener('click', loadBackendConfig);
    $('authTunnelBtn').addEventListener('click', function () { if (app.backend) window.open(app.backend, '_blank', 'noopener'); });
    // The tunnel root answers {"detail":"Not Found"} by design, so open /health.
    $('openBackendBtn').addEventListener('click', function () { if (app.backend) window.open(route('health'), '_blank', 'noopener'); });
    $('openDocsBtn').addEventListener('click', function () {
      if (!app.backend) return;
      var docs = app.source === 'config' && app.config && isHttpUrl(app.config.api_docs) ? app.config.api_docs : app.backend + '/docs';
      window.open(docs, '_blank', 'noopener');
    });
    // Manual override: verify /health (ok:true) + /model-info first; only then keep it.
    $('overrideForm').addEventListener('submit', function (e) {
      e.preventDefault();
      if (app.generating) return;
      var url = normalizeUrl($('backendUrlInput').value);
      if (!isHttpUrl(url)) { YB.toast('Enter a full address starting with https://'); return; }
      showNotice($('backendNotice'), null);
      useBackend(url, 'manual', null);
      checkHealth({ loadLists: true }).then(function (ok) {
        if (ok) { YB.store.set('voiceOverride', url); YB.toast('Connected — saved as your fallback address'); }
        else YB.toast('That address didn\'t pass the checks, so it wasn\'t saved');
      });
    });
    $('clearOverrideBtn').addEventListener('click', function () {
      if (app.generating) return;
      YB.store.remove('voiceOverride');
      loadBackendConfig();
      YB.toast('Manual address cleared — using backend-config.json');
    });

    // script
    var ta = $('scriptText');
    ta.addEventListener('input', function () { updateScriptMeta(); saveScript(); });
    $('clearScriptBtn').addEventListener('click', function () {
      if (ta.value.trim() && !confirm('Clear the whole script?')) return;
      ta.value = ''; updateScriptMeta(); YB.store.set('voiceScript', ''); ta.focus();
    });
    $('pasteBtn').addEventListener('click', function () {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (t) { if (t) insertAtCursor(t); else YB.toast('Clipboard is empty'); },
          function () { YB.toast('Tap and hold in the script box, then choose Paste'); ta.focus(); });
      } else { YB.toast('Tap and hold in the script box, then choose Paste'); ta.focus(); }
    });
    ['focus', 'click'].forEach(function (ev) { ta.addEventListener(ev, function () { saveCursor(); openTags(); }); });
    ['keyup', 'select', 'input'].forEach(function (ev) { ta.addEventListener(ev, saveCursor); });
    ta.addEventListener('blur', function () { saveCursor(); maybeCloseTags(); });
    ['pointerdown', 'mousedown'].forEach(function (ev) {
      $('tagBox').addEventListener(ev, function (e) { tagUi.chipAt = Date.now(); if (e.target.closest('[data-tag]')) e.preventDefault(); }); // keep the cursor in the script
    });
    $('tagBox').addEventListener('focusout', maybeCloseTags);
    $('tagButtons').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tag]'); if (!b) return;
      tagUi.chipAt = Date.now();
      insertAtCursor('[' + b.getAttribute('data-tag') + ']');
      openTags();
    });

    // story import
    $('importStory').addEventListener('change', renderImportSpeakers);
    $('importBox').addEventListener('toggle', function () { if (this.open) renderImport($('importStory').value); });
    $('importBtn').addEventListener('click', function () { importFromStory($('importStory').value, $('importSpeaker').value); });

    // voice
    $('voicePick').addEventListener('change', function () { settings.voiceKey = this.value; saveSettingsNow(); renderPickNote(); renderSummary(); updateControls(); updatePreviewBtn(); });
    $('voicePreviewBtn').addEventListener('click', function () {
      var key = settings.voiceKey;
      if (!key || /^builtin:/.test(key) || !library || !window.YBTakes) return;
      window.YBTakes.player.toggle('voice:' + key, function () { return library.previewBlob(key); });
    });
    ['focus', 'pointerdown'].forEach(function (ev) {
      $('voicePick').addEventListener(ev, function () { refreshListsIfStale('voices'); if (library) library.refreshIfStale(); });
    });
    $('refreshVoicesBtn').addEventListener('click', function () { loadVoices(false); if (library) library.refresh(true); });

    // settings
    $('outputFormat').addEventListener('change', function () { settings.format = this.value; saveSettings(); renderSummary(); });
    $('levelLoudness').addEventListener('change', function () { settings.level = this.checked; saveSettingsNow(); });
    $('chunkSize').addEventListener('input', function () { settings.chunk = clampChunk(this.value); $('chunkVal').textContent = chunkLabel(settings.chunk); saveSettings(); updateScriptMeta(); renderPresets(); });
    $('temperature').addEventListener('input', function () { settings.temperature = clampTo(this.value, TEMP_MIN, TEMP_MAX, 0.05); $('tempVal').textContent = tempLabel(settings.temperature); saveSettings(); renderPresets(); });
    $('exaggeration').addEventListener('input', function () { settings.exaggeration = clampTo(this.value, EXAG_MIN, EXAG_MAX, 0.05); $('exagVal').textContent = exagLabel(settings.exaggeration); saveSettings(); renderPresets(); });
    $('cfgWeight').addEventListener('input', function () { settings.cfg = clampTo(this.value, CFG_MIN, CFG_MAX, 0.05); $('cfgVal').textContent = settings.cfg.toFixed(2); saveSettings(); renderPresets(); });
    $('languageSelect').addEventListener('change', function () { settings.language = this.value; saveSettings(); renderSummary(); });
    $('presetChips').addEventListener('click', function (e) { var b = e.target.closest('[data-preset]'); if (b) applyPreset(Number(b.getAttribute('data-preset'))); });
    $('engineCards').addEventListener('click', function (e) { var b = e.target.closest('[data-model]'); if (b && !b.disabled) switchModel(b.getAttribute('data-model')); });
    $('speedFactor').addEventListener('input', function () { settings.speed = clampSpeed(this.value); $('speedVal').textContent = speedLabel(settings.speed); saveSettings(); renderPresets(); });
    $('generationSeed').addEventListener('change', function () { settings.seed = Math.max(0, Math.round(Number(this.value) || 0)); this.value = settings.seed; saveSettings(); });
    $('splitText').addEventListener('change', function () { settings.split = this.checked; $('chunkSize').disabled = !this.checked; $('chunkField').classList.toggle('is-off', !this.checked); saveSettings(); updateScriptMeta(); });
    $('resetSettingsBtn').addEventListener('click', function () {
      ['format', 'chunk', 'temperature', 'speed', 'seed', 'split'].forEach(function (k) { settings[k] = DEFAULTS[k]; });
      saveSettings(); fillSettings(); updateScriptMeta(); renderSummary(); YB.toast('Settings reset');
    });

    // generate / output
    $('generateBtn').addEventListener('click', generate);
    $('cancelBtn').addEventListener('click', cancelGeneration);
    $('againBtn').addEventListener('click', generate);
    // Round play/pause next to "Generated audio": ▶ turns into ❚❚ while playing.
    $('mainPlayToggle').addEventListener('click', function () {
      var a = $('audioPreview'); if (!a.getAttribute('src')) return;
      if (a.paused) { var p = a.play(); if (p && p.catch) p.catch(function () {}); } else a.pause();
    });
    ['play', 'playing', 'pause', 'ended', 'timeupdate', 'emptied', 'loadedmetadata'].forEach(function (ev) { $('audioPreview').addEventListener(ev, syncMainToggle); });
    $('replayBtn').addEventListener('click', function () { var a = $('audioPreview'); a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () {}); });
    // Clear all: every saved take, this player and Story mode's finished lines, at once.
    $('clearAudioBtn').addEventListener('click', function () { if (window.YBTakes) window.YBTakes.clearAll(false); else clearAudio(); });
    $('removeAudioBtn').addEventListener('click', function () { if (confirm('Remove this audio from the player? (It stays in Your audio below.)')) clearAudio(); });
    window.addEventListener('yb-audio-cleared', clearAudio);
    $('downloadAudioBtn').addEventListener('click', function (e) { if (!app.audioUrl) e.preventDefault(); });

    window.addEventListener('yb-voice-summary', renderSummary);   // story mode switched off

    // Copy Error (any expandable backend-error box on the page)
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy-error]'); if (!b) return;
      var pre = b.closest('.err-details') && b.closest('.err-details').querySelector('.err-raw');
      if (pre) YB.copy(pre.textContent);
    });

    // lifecycle
    window.addEventListener('pagehide', saveSettingsNow);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) saveSettingsNow();
      if (!document.hidden && app.job) { clearTimeout(app.pollTimer); pollJob(); return; }
      if (document.hidden || app.generating || app.state === 'connecting') return;
      if (isDown()) loadBackendConfig(); else if (app.backend) checkHealth({ silent: true });
    });
  }

  function init() {
    YB.store.remove('voiceBackend');   // retired: tunnel addresses change every session
    fillSettings();
    saveSettings();
    $('scriptText').value = YB.store.get('voiceScript', '');
    useCachedVoices() || renderPicker();
    applyModelUI();
    bind();
    renderImport();

    // Arrived from Story Studio's "Send to Voice Studio"
    var pending = YB.store.get('voiceImport', null);
    if (pending && pending.storyId) {
      YB.store.remove('voiceImport');
      app.pendingStory = pending.storyId;
      $('importBox').open = true;
      renderImport(pending.storyId);
      importFromStory(pending.storyId, pending.speaker || 'all', true);
    }

    updateScriptMeta();
    var storyRun = YB.store.get('voiceStoryRun', null);
    if (YB.store.get('voiceJob', null) || (storyRun && storyRun.state === 'running')) app.preparing = true;   // lock Generate until the saved job/run is re-attached
    updateControls();
    restoreAudio();
    loadBackendConfig().then(function () {
      app.preparing = false; updateControls();
      if (!app.generating) startPolling();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
