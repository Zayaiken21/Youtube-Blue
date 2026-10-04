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
  var SETTINGS_VERSION = 3;
  var DEFAULTS = {
    mode: 'predefined', voiceId: '', reference: '',
    format: 'wav', chunk: 400, temperature: 0.75, speed: 1, seed: 0, split: true
  };
  var CHUNK_MIN = 50, CHUNK_MAX = 500;          // server-side limits for chunk_size
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
  var JOB_POLL_MS = 3000, JOB_POLL_MAX_MS = 15000, JOB_MAX_FAILS = 25;

  // Where each backend route lives. backend-config.json's own URL wins when it
  // points at the active backend; otherwise backend_url + path.
  var ROUTES = {
    health: ['health_endpoint', '/health'],
    info: ['model_info', '/model-info'],
    jobs: ['job_endpoint', '/jobs'],
    voices: ['predefined_voices_endpoint', '/get_predefined_voices'],
    refs: ['reference_files_endpoint', '/get_reference_files'],
    upload: ['reference_upload_endpoint', '/upload_reference']
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
    cloneAvailable: true,
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
    saved.v = SETTINGS_VERSION;
    var s = Object.assign({}, DEFAULTS, saved);
    s.speed = clampSpeed(s.speed);   // e.g. an old 0.90 / 0.95 becomes 0.97
    return s;
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
      if (s === 530 || s === 1033) return makeErr('tunnel', 'Cloudflare tunnel is not ready or has disconnected.');
      if (s === 524) return makeErr('cf-timeout', 'Request exceeded Cloudflare\'s synchronous request limit.');
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

  var RESTART = 'Start the Colab backend, then press Refresh Backend.';
  var HELP = {
    'config-missing': 'Run the Colab startup cell — it publishes the live address to backend-config.json. You can also enter an address under “Manual backend override”.',
    'offline': RESTART + ' This page also checks for a newly published address every minute and reconnects by itself.',
    'tunnel': 'Restart the Colab backend, then press Refresh Backend.',
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
    'tts': 'If it repeats: try a cleaner 10–20 s reference clip, a different voice, or shorter sentences. The exact error is below.',
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
  var STATE_LABEL = { connecting: 'Connecting…', online: 'Online', offline: 'Backend Offline', generating: 'Generating', error: 'Error' };

  function setState(state, label) {
    app.state = state;
    var el = $('connectionStatus');
    el.setAttribute('data-state', state);
    el.textContent = label || STATE_LABEL[state];
    updateControls();
  }
  function onlineLabel() { return app.source === 'manual' ? 'Connected' : 'Online'; }

  // A clone reference counts only once it's in the list the server returned.
  function refReady() {
    return !!settings.reference && Array.isArray(app.refFiles) && app.refFiles.indexOf(settings.reference) !== -1;
  }

  function updateControls() {
    var busy = app.generating;
    var story = storyHooks && storyHooks.active();
    var blocked = story ? !storyHooks.canGenerate() : (settings.mode === 'clone' && !refReady());
    $('generateBtn').disabled = busy || app.uploading || app.preparing || blocked;
    $('generateBtn').textContent = busy ? '⏳ Generating…' : story ? '🎭 Generate Story Audio' : '🎙️ Generate Speech';
    $('cancelBtn').disabled = !busy;
    $('testBtn').disabled = busy;
    $('refreshBackendBtn').disabled = busy;
    $('refreshVoicesBtn').disabled = busy;
    $('refreshRefsBtn').disabled = busy;
    $('againBtn').disabled = busy;
    $('authTunnelBtn').hidden = !isLocalTunnel(app.backend);
    $('openBackendBtn').disabled = !app.backend;
    $('openDocsBtn').disabled = !app.backend;
    $('uploadRefBtn').disabled = busy || app.uploading || !app.cloneAvailable;
    $('cloneUnavailable').hidden = app.cloneAvailable;
  }

  function renderBackendFacts() {
    $('backendDisplay').textContent = app.backend ? app.backend + (app.source === 'manual' ? '  (manual)' : '') : 'Not set';
    var info = app.info || {};
    $('modelType').textContent = info.type ? info.type.charAt(0).toUpperCase() + info.type.slice(1) : '—';
    $('modelDevice').textContent = info.device ? String(info.device).toUpperCase() : '—';
    $('modelSampleRate').textContent = info.sample_rate ? Number(info.sample_rate) + ' Hz' : '—';
    var up = app.source === 'config' && app.config && app.config.updated_at;
    if (up) {
      var d = new Date(up);
      $('backendUpdatedAt').textContent = isNaN(d) ? up : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) + ' (' + ago(d) + ')';
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
        if (res.status === 404) throw makeErr('config-missing', 'Live backend configuration has not been published yet.');
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
    if (url !== app.backend) { app.voicesLoaded = false; app.cloneAvailable = true; app.info = null; }
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
        return call(route('info'), {}, HEALTH_TIMEOUT_MS);
      })
      .then(function (res) {
        if (!res.ok) return httpError(res, 'health').then(function (e) { throw e; });
        return readJson(res);
      })
      .then(function (info) {
        if (app.generating) return true; // a generation started meanwhile — ignore
        app.healthFails = 0;
        app.busy = info.busy_or_unreachable === true;
        if (app.busy) {
          // The job server answered; Chatterbox is just busy finishing a job. Not offline.
          if (!app.info) app.info = infoFromConfig();
          renderBackendFacts(); renderTags();
          setState('online', onlineLabel() + ' · busy');
          showNotice($('backendNotice'), makeErr('busy', 'Chatterbox is busy right now.'), 'warn');
          if (!app.voicesLoaded) useCachedVoices();
          return true;
        }
        app.info = info;
        renderBackendFacts(); renderTags();
        if (info.loaded !== true) {
          setState('error', 'Model not loaded');
          showNotice($('backendNotice'), makeErr('model', 'Chatterbox is running but the model is not loaded.'));
          return false;
        }
        setState('online', onlineLabel());
        if (!opts.keepNotice) showNotice($('backendNotice'), null);
        if (opts.loadLists || !app.voicesLoaded) return Promise.all([loadVoices(true), loadReferences(true)]).then(function () { return true; });
        return true;
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

  function startPolling() {
    stopPolling();
    app.healthTimer = setInterval(function () {
      if (app.generating || document.hidden) return;
      if (isDown()) loadBackendConfig();                 // look for a newly published address
      else if (app.backend) checkHealth({ silent: true });
    }, HEALTH_INTERVAL_MS);
  }
  function stopPolling() { if (app.healthTimer) { clearInterval(app.healthTimer); app.healthTimer = null; } }
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
        $('predefinedVoiceSelect').innerHTML = '<option value="">Voices unavailable — press Refresh Voices</option>';
        $('voiceCount').textContent = '';
        if (!quiet) showNotice($('genError'), err);
      });
  }

  function renderVoices(voices, note) {
    var sel = $('predefinedVoiceSelect');
    if (!voices.length) {
      sel.innerHTML = '<option value="">No predefined voices on the server</option>';
      $('voiceCount').textContent = '';
      return;
    }
    sel.innerHTML = voices.map(function (v) {
      return '<option value="' + YB.esc(v.filename) + '">' + YB.esc(v.display_name) + '</option>';
    }).join('');
    var ids = voices.map(function (v) { return v.filename; });
    if (settings.voiceId && ids.indexOf(settings.voiceId) !== -1) sel.value = settings.voiceId;
    else { settings.voiceId = sel.value; saveSettings(); }
    app.voices = voices;
    app.voicesLoaded = true;
    $('voiceCount').textContent = note;
    renderSummary();
    if (storyHooks) storyHooks.listsChanged();
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
          app.cloneAvailable = false; app.refFiles = []; updateControls();
          $('referenceSelect').innerHTML = '<option value="">Not available on this job server</option>';
          return null;
        }
        if (!quiet) showNotice($('genError'), err);
        return null;
      });
  }

  function renderReferences(files) {
    var sel = $('referenceSelect');
    sel.innerHTML = '<option value="">' + (files.length ? 'Choose a saved reference…' : 'No references on the server yet') + '</option>' +
      files.map(function (f) { return '<option value="' + YB.esc(f) + '">' + YB.esc(f) + '</option>'; }).join('');
    if (settings.reference && files.indexOf(settings.reference) !== -1) sel.value = settings.reference;
    else if (settings.reference) {
      // the stored filename is gone (new Colab session) — forget it
      setReference('');
      setUploadState('idle', 'Your previous reference isn\'t on this server session. Upload it again.');
    }
    if (storyHooks) storyHooks.listsChanged();
  }

  function setReference(name) {
    settings.reference = name || '';
    saveSettings();
    $('uploadedReferenceName').textContent = settings.reference || 'None';
    if ($('referenceSelect').value !== settings.reference) $('referenceSelect').value = settings.reference;
    renderSummary();
    updateControls();
  }

  // Lists change on the server (uploads from elsewhere, a Colab restart), so
  // re-fetch them whenever they're about to be used and are a little old.
  function refreshListsIfStale(which) {
    if (!app.backend || app.generating || app.state === 'offline' || app.busy) return;
    var now = Date.now();
    if (which !== 'voices' && now - app.refsAt > LIST_STALE_MS) { app.refsAt = now; loadReferences(true); }
    if (which !== 'refs' && now - app.voicesAt > LIST_STALE_MS) { app.voicesAt = now; loadVoices(true); }
  }

  function setUploadState(state, text) {
    var el = $('uploadState');
    el.setAttribute('data-state', state);
    el.textContent = text;
  }

  // POST multipart "files" → server stores it under a (sanitized) filename →
  // refresh GET /get_reference_files and select that filename.
  function uploadReference() {
    var input = $('voiceSampleFile');
    var file = input.files && input.files[0];
    if (!app.backend) { showNotice($('genError'), makeErr('config-missing', 'No backend is connected yet.')); return Promise.resolve(null); }
    if (!file) { setUploadState('error', 'Choose a WAV or MP3 file first.'); return Promise.resolve(null); }
    if (!/\.(wav|mp3)$/i.test(file.name)) { setUploadState('error', 'Only .wav and .mp3 files are accepted.'); return Promise.resolve(null); }
    if (app.uploading || app.generating) return Promise.resolve(null);

    app.uploading = true; updateControls();
    setUploadState('busy', 'Uploading ' + file.name + ' (' + bytesLabel(file.size) + ')…');
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
              : res.status === 530 ? makeErr('tunnel', 'Cloudflare tunnel is not ready or has disconnected.')
              : makeErr('unavailable', 'Backend temporarily unavailable.');
          }
          var uploaded = data.uploaded_files || [];
          if (!uploaded.length) {
            var msg = (data.errors && data.errors[0] && data.errors[0].error) || data.detail || 'The server did not accept the file.';
            throw makeErr('upload', 'Reference upload failed: ' + msg);
          }
          return uploaded[0]; // server-side (sanitized) filename
        });
      })
      .then(function (serverName) {
        // Only use the file once the TTS engine's own list includes it.
        setUploadState('busy', 'Uploaded — checking the server can use ' + serverName + '…');
        return loadReferences(true).then(function (files) {
          if (!files || files.indexOf(serverName) === -1) {
            throw makeErr('ref-pending', 'Reference audio was uploaded but is not available to the TTS engine yet.');
          }
          setReference(serverName); // select the new file in the refreshed list
          setUploadState('done', '✓ Uploaded and ready: ' + serverName);
          showNotice($('genError'), null);
          return serverName;
        });
      })
      .catch(function (err) {
        err = networkError(err);
        setUploadState('error', err.message);
        showNotice($('genError'), err);
        return null;
      })
      .then(function (v) { app.uploading = false; updateControls(); return v; });
  }

  function clearReference() {
    setReference('');
    $('voiceSampleFile').value = '';
    $('localFileName').textContent = 'None';
    setUploadState('idle', 'No reference uploaded yet.');
    renderSummary();
  }

  /* ---------- Voice mode / settings ---------- */
  function setMode(mode) {
    settings.mode = mode === 'clone' ? 'clone' : 'predefined'; saveSettings();
    $('voiceModeSeg').querySelectorAll('[data-mode]').forEach(function (b) {
      var on = b.getAttribute('data-mode') === settings.mode;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $('predefinedVoiceSection').hidden = settings.mode !== 'predefined';
    $('cloneVoiceSection').hidden = settings.mode !== 'clone';
    renderSummary();
    updateControls();
    // Switching modes shows the server's current list, not an old one.
    refreshListsIfStale(settings.mode === 'clone' ? 'refs' : 'voices');
  }

  function fillSettings() {
    $('outputFormat').value = settings.format;
    $('chunkSize').value = settings.chunk;
    $('temperature').value = settings.temperature;
    $('speedFactor').value = settings.speed;
    $('generationSeed').value = settings.seed;
    $('splitText').checked = !!settings.split;
    $('tempVal').textContent = Number(settings.temperature).toFixed(2);
    $('speedVal').textContent = speedLabel(settings.speed);
    $('chunkSize').disabled = !settings.split;
  }

  function clampChunk(v) { v = Math.round(Number(v) || DEFAULTS.chunk); return Math.min(CHUNK_MAX, Math.max(CHUNK_MIN, v)); }

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
    var start = ta.selectionStart == null ? ta.value.length : ta.selectionStart;
    var end = ta.selectionEnd == null ? start : ta.selectionEnd;
    var before = ta.value.slice(0, start);
    if (before && !/\s$/.test(before) && /^\[/.test(snippet)) snippet = ' ' + snippet;
    if (ta.setRangeText) ta.setRangeText(snippet, start, end, 'end');
    else { ta.value = before + snippet + ta.value.slice(end); ta.selectionStart = ta.selectionEnd = start + snippet.length; }
    ta.focus();
    updateScriptMeta(); saveScript();
  }

  // Tag list: backend-config.json first, then /model-info, then the Turbo set.
  function tagList() {
    var c = app.source === 'config' && app.config;
    var list = (c && Array.isArray(c.available_paralinguistic_tags) && c.available_paralinguistic_tags.length) ? c.available_paralinguistic_tags
      : (app.info && Array.isArray(app.info.available_paralinguistic_tags) && app.info.available_paralinguistic_tags.length) ? app.info.available_paralinguistic_tags
      : DEFAULT_TAGS;
    return list.map(function (t) { return String(t).replace(/^\[|\]$/g, '').trim(); }).filter(Boolean);
  }

  function renderTags() {
    var info = app.info;
    var known = info && info.type;
    var supports = !known || info.supports_paralinguistic_tags !== false;
    $('tagBox').hidden = !supports;
    $('tagNote').textContent = known ? '(inserted at your cursor)' : '(Turbo model — inserted at your cursor)';
    $('tagButtons').innerHTML = tagList().map(function (t) {
      return '<button type="button" data-tag="' + YB.esc(t) + '">[' + YB.esc(t) + ']</button>';
    }).join('');
  }

  function knownTags() { return tagList().map(function (t) { return t.toLowerCase(); }); }

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
      var n = (story.blocks || []).filter(function (b) { return b.type === 'line' && b.speaker === c.id && b.text.trim(); }).length;
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
      return b.type === 'line' && (speaker === 'all' || b.speaker === speaker);
    }).map(function (b) {
      return b.text.replace(/\[([^\]]*)\]/g, function (m, inner) { return tags.indexOf(inner.trim().toLowerCase()) !== -1 ? '[' + inner.trim().toLowerCase() + ']' : ' '; })
        .replace(/[ \t]+/g, ' ').trim();
    }).filter(Boolean).join('\n\n');
  }

  function importFromStory(storyId, speaker, silent) {
    var text = storyText(storyId, speaker);
    if (!text) { YB.toast('Those lines are empty — write some dialogue first'); return; }
    var ta = $('scriptText');
    if (!silent && ta.value.trim() && ta.value.trim() !== text && !confirm('Replace the current script with the imported lines?')) return;
    ta.value = text;
    updateScriptMeta(); YB.store.set('voiceScript', text);
    YB.toast('Imported from Story Studio');
  }

  /* ---------- Generation (async jobs only — never POST /tts) ---------- */
  function renderSummary() {
    var el = $('genSummary'); if (!el) return;
    if (storyHooks && storyHooks.active()) { el.textContent = storyHooks.summary(); return; }
    var voice = settings.mode === 'clone'
      ? (settings.reference ? 'Clone: ' + settings.reference : 'Clone: no reference yet')
      : ($('predefinedVoiceSelect').selectedOptions[0] && $('predefinedVoiceSelect').value ? $('predefinedVoiceSelect').selectedOptions[0].textContent : 'No voice selected');
    el.textContent = voice + ' · ' + String(settings.format).toUpperCase();
  }

  function buildRequest() {
    var body = {
      text: $('scriptText').value.trim(),
      voice_mode: settings.mode,
      output_format: settings.format,
      split_text: !!settings.split,
      chunk_size: clampChunk(settings.chunk),
      temperature: Number(settings.temperature),
      speed_factor: Number(settings.speed),
      seed: Math.max(0, Math.round(Number(settings.seed) || 0))
    };
    // Only the field for the chosen voice mode is sent.
    if (settings.mode === 'predefined') body.predefined_voice_id = $('predefinedVoiceSelect').value;
    else body.reference_audio_filename = settings.reference;
    return body;
  }

  var PHASES = {
    submit: ['Queued', 'Submitting job…', 'Sending your script to the server.'],
    queued: ['Queued', 'Queued…', 'Waiting for Chatterbox to start this job.'],
    running: ['Generating', 'Generating speech…', 'Generating chunked speech on CPU. Longer scripts can take several minutes. You can leave this page — it picks the job back up when you return.'],
    processing: ['Generating', 'Processing audio…', 'Speech is ready — downloading the audio file.']
  };

  function setPhase(name, detail) {
    var p = PHASES[name];
    setState('generating', p[0]);
    $('genStatusText').textContent = p[1];
    $('genDetail').textContent = detail || p[2];
  }

  function startGenerating() {
    app.generating = true;
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
    if (storyHooks && storyHooks.active()) { storyHooks.generate(); return; }
    showNotice($('genError'), null);
    var text = $('scriptText').value.trim();
    if (!app.backend) { showNotice($('genError'), makeErr('offline', 'Backend is not connected.')); return; }
    if (!text) { showNotice($('genError'), makeErr('validation', 'Add some narration to the script first.'), 'warn'); $('scriptText').focus(); return; }

    var ready = Promise.resolve(true);
    if (settings.mode === 'predefined') {
      if (!$('predefinedVoiceSelect').value) { showNotice($('genError'), makeErr('voice-missing', 'Choose a predefined voice first.'), 'warn'); return; }
    } else if (!app.cloneAvailable) {
      showNotice($('genError'), makeErr('clone-unavailable', 'Voice cloning isn\'t available on this job server.'), 'warn'); return;
    } else if (!settings.reference) {
      showNotice($('genError'), makeErr('ref-missing', 'Choose a reference file first — upload one or pick a saved one.'), 'warn'); return;
    } else {
      // Clone jobs only go out for a reference the TTS engine can see right now.
      ready = verifyReferences([settings.reference]).then(function (missing) {
        if (!missing.length) return true;
        setReference('');
        setUploadState('error', 'That reference isn\'t on the server any more — upload it again.');
        showNotice($('genError'), makeErr('ref-missing', 'Reference file "' + missing[0] + '" isn\'t on the server right now.'));
        return false;
      });
    }

    app.preparing = true; updateControls();
    ready.then(function (ok) {
      return ok ? checkOrphan() : false;
    }).then(function (ok) {
      app.preparing = false; updateControls();
      if (!ok || app.generating) return;
      runJob(buildRequest());
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
    if (!app.generating) return;
    if (storyHooks && storyHooks.running()) { storyHooks.cancel(); return; }
    app.jobToken++;                          // ignore any reply still in flight
    var id = app.job && app.job.id;
    var serverCancel = id ? requestServerCancel(id) : false;
    if (id && !serverCancel) app.orphanJob = id;
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
        showAudio(blob, fmt || job.ext);
        YB.toast('Complete — speech ready');
        finishJob(null);
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
    var e = summarizeFailure(text, voiceMode || settings.mode);
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
      if (err.kind === 'ref-missing') { setReference(''); setUploadState('error', 'Reference missing on the server — upload it again.'); }
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
    if (!app.generating && resumeJob()) { app.preparing = false; return Promise.resolve(true); }
    return checkHealth(opts);
  }

  /* ---------- Output ---------- */
  function fileStamp(d) {
    function p(n) { return String(n).padStart(2, '0'); }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }

  function showAudio(blob, ext, prefix) {
    if (app.audioUrl) URL.revokeObjectURL(app.audioUrl);   // no Blob URL leaks
    app.audioUrl = URL.createObjectURL(blob);
    var player = $('audioPreview');
    player.src = app.audioUrl;
    var dl = $('downloadAudioBtn');
    dl.href = app.audioUrl;
    dl.download = (prefix || 'youtube-blue-voice') + '-' + fileStamp(new Date()) + '.' + ext;
    $('audioInfo').textContent = ext.toUpperCase() + ' · ' + bytesLabel(blob.size);
    player.onloadedmetadata = function () {
      if (isFinite(player.duration)) $('audioInfo').textContent = ext.toUpperCase() + ' · ' + mmss(player.duration) + ' · ' + bytesLabel(blob.size);
    };
    $('audioOutputSection').hidden = false;
    $('audioOutputSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function clearAudio() {
    var p = $('audioPreview');
    p.pause(); p.removeAttribute('src'); p.load();
    if (app.audioUrl) { URL.revokeObjectURL(app.audioUrl); app.audioUrl = null; }
    $('downloadAudioBtn').href = '#';
    $('audioOutputSection').hidden = true;
  }

  // Reads the chosen reference clip's length in the browser and warns when it's
  // outside what cloning handles well.
  function checkClipLength(file) {
    var url = URL.createObjectURL(file), probe = new Audio(), note = $('refDurationNote');
    function done(msg) { URL.revokeObjectURL(url); if (!msg) return; note.textContent = msg; note.hidden = false; }
    probe.preload = 'metadata';
    probe.onloadedmetadata = function () {
      var d = probe.duration;
      if (!isFinite(d)) return done('');
      if (d < REF_SHORT_SEC) done('⚠️ This clip is only ' + d.toFixed(1) + ' s — very short references usually clone poorly. Aim for 10–20 seconds.');
      else if (d > REF_LONG_SEC) done('⚠️ This clip is ' + Math.round(d) + ' s — the server may reject references longer than 30 seconds. Trim it to 10–20 seconds.');
      else done(d < 10 ? 'ℹ️ ' + d.toFixed(1) + ' s — usable, but 10–20 seconds gives better results.' : '✓ ' + Math.round(d) + ' s — a good length.');
    };
    probe.onerror = function () { done(''); };
    probe.src = url;
  }

  /* ---------- Shared core for Story (multi-voice) mode — js/voice-story.js ---------- */
  var storyHooks = null;
  window.YBVoice = {
    registerStory: function (hooks) { storyHooks = hooks; updateControls(); },
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
    isBusy: function () { return app.generating || app.preparing || !!app.job || app.uploading; },
    updateControls: updateControls,
    // Story runs use the same locks as single generation: no health polling,
    // Generate disabled, Cancel enabled, status pill shows progress.
    begin: function (label) { if (app.generating) return false; app.generating = true; stopPolling(); app.startedAt = Date.now();
      showNotice($('genError'), null); $('genProgress').hidden = false; setState('generating', label || 'Generating');
      tickElapsed(); clearInterval(app.elapsedTimer); app.elapsedTimer = setInterval(tickElapsed, 1000); return true; },
    progress: function (pill, title, detail) { setState('generating', pill); $('genStatusText').textContent = title; $('genDetail').textContent = detail; },
    end: function () { stopGenerating(); },
    showAudio: function (blob, ext, prefix) { showAudio(blob, ext, prefix); },
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
    $('tagButtons').addEventListener('mousedown', function (e) { if (e.target.closest('[data-tag]')) e.preventDefault(); }); // keep cursor in textarea
    $('tagButtons').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tag]'); if (b) insertAtCursor('[' + b.getAttribute('data-tag') + ']');
    });

    // story import
    $('importStory').addEventListener('change', renderImportSpeakers);
    $('importBox').addEventListener('toggle', function () { if (this.open) renderImport($('importStory').value); });
    $('importBtn').addEventListener('click', function () { importFromStory($('importStory').value, $('importSpeaker').value); });

    // voice
    $('voiceModeSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-mode]'); if (b) setMode(b.getAttribute('data-mode')); });
    $('predefinedVoiceSelect').addEventListener('change', function () { settings.voiceId = this.value; saveSettings(); renderSummary(); });
    // Opening a list re-fetches it if it's a little old, so new server files show up without a manual refresh.
    ['focus', 'pointerdown'].forEach(function (ev) {
      $('predefinedVoiceSelect').addEventListener(ev, function () { refreshListsIfStale('voices'); });
      $('referenceSelect').addEventListener(ev, function () { refreshListsIfStale('refs'); });
    });
    $('refreshVoicesBtn').addEventListener('click', function () { loadVoices(false); });
    $('voiceSampleFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      $('localFileName').textContent = f ? f.name + ' (' + bytesLabel(f.size) + ')' : 'None';
      $('refDurationNote').hidden = true;
      if (!f) return;
      setUploadState('idle', 'Ready to upload — click Upload Reference.');
      checkClipLength(f);
    });
    $('uploadRefBtn').addEventListener('click', uploadReference);
    $('clearRefBtn').addEventListener('click', clearReference);
    $('refreshRefsBtn').addEventListener('click', function () { loadReferences(false); });
    $('referenceSelect').addEventListener('change', function () {
      setReference(this.value);
      if (this.value) setUploadState('done', '✓ Using saved reference ' + this.value);
    });

    // settings
    $('outputFormat').addEventListener('change', function () { settings.format = this.value; saveSettings(); renderSummary(); });
    $('chunkSize').addEventListener('change', function () { settings.chunk = clampChunk(this.value); this.value = settings.chunk; saveSettings(); updateScriptMeta(); });
    $('temperature').addEventListener('input', function () { settings.temperature = Number(this.value); $('tempVal').textContent = settings.temperature.toFixed(2); saveSettings(); });
    $('speedFactor').addEventListener('input', function () { settings.speed = clampSpeed(this.value); $('speedVal').textContent = speedLabel(settings.speed); saveSettings(); });
    $('generationSeed').addEventListener('change', function () { settings.seed = Math.max(0, Math.round(Number(this.value) || 0)); this.value = settings.seed; saveSettings(); });
    $('splitText').addEventListener('change', function () { settings.split = this.checked; $('chunkSize').disabled = !this.checked; saveSettings(); updateScriptMeta(); });
    $('resetSettingsBtn').addEventListener('click', function () {
      ['format', 'chunk', 'temperature', 'speed', 'seed', 'split'].forEach(function (k) { settings[k] = DEFAULTS[k]; });
      saveSettings(); fillSettings(); updateScriptMeta(); renderSummary(); YB.toast('Settings reset');
    });

    // generate / output
    $('generateBtn').addEventListener('click', generate);
    $('cancelBtn').addEventListener('click', cancelGeneration);
    $('againBtn').addEventListener('click', generate);
    $('playBtn').addEventListener('click', function () { var p = $('audioPreview').play(); if (p && p.catch) p.catch(function () {}); });
    $('pauseBtn').addEventListener('click', function () { $('audioPreview').pause(); });
    $('replayBtn').addEventListener('click', function () { var a = $('audioPreview'); a.currentTime = 0; var p = a.play(); if (p && p.catch) p.catch(function () {}); });
    $('clearAudioBtn').addEventListener('click', clearAudio);
    $('downloadAudioBtn').addEventListener('click', function (e) { if (!app.audioUrl) e.preventDefault(); });

    window.addEventListener('yb-voice-summary', renderSummary);   // story mode switched off

    // Copy Error (any expandable backend-error box on the page)
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-copy-error]'); if (!b) return;
      var pre = b.closest('.err-details') && b.closest('.err-details').querySelector('.err-raw');
      if (pre) YB.copy(pre.textContent);
    });

    // lifecycle
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && app.job) { clearTimeout(app.pollTimer); pollJob(); return; }
      if (document.hidden || app.generating || app.state === 'connecting') return;
      if (isDown()) loadBackendConfig(); else if (app.backend) checkHealth({ silent: true });
    });
  }

  function init() {
    YB.store.remove('voiceBackend');   // retired: tunnel addresses change every session
    fillSettings();
    setMode(settings.mode);
    saveSettings();
    $('scriptText').value = YB.store.get('voiceScript', '');
    $('uploadedReferenceName').textContent = settings.reference || 'None';
    if (settings.reference) setUploadState('done', '✓ Using ' + settings.reference + ' (checking it\'s still on the server…)');
    renderTags();
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
    if (YB.store.get('voiceJob', null)) app.preparing = true;   // lock Generate until the saved job is re-attached
    updateControls();
    loadBackendConfig().then(function () {
      app.preparing = false; updateControls();
      if (!app.generating) startPolling();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
