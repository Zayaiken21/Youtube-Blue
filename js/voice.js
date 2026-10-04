/* =========================================================
   Youtube Blue — voice.js
   Controls the Voice Studio page only: Chatterbox backend
   discovery + health, predefined voices, voice-clone references,
   script editor, generation, playback and download.
   Two backend types:
     job    — Youtube Blue job API (backend-config "tts_mode": "async-job"):
              POST /jobs → poll GET /jobs/{id} → GET /jobs/{id}/audio
     direct — Chatterbox itself: POST /tts (streamed WAV or single file)
   Saved under storage keys "voice", "voiceScript",
   "voiceBackend" (last good address) and "voiceOverride".
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;

  /* ---------- Constants ---------- */
  var DEFAULT_TAGS = ['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan', 'shush'];
  var DEFAULTS = {
    mode: 'predefined', voiceId: '', reference: '', delivery: 'stream',
    format: 'mp3', chunk: 240, temperature: 0.8, speed: 1, seed: 0, split: true
  };
  var CHUNK_MIN = 50, CHUNK_MAX = 500;          // server-side limits for chunk_size
  var HEALTH_INTERVAL_MS = 60000;               // background health check while idle
  var HEALTH_TIMEOUT_MS = 45000;                // health checks only — never /tts
  var CONFIG_TIMEOUT_MS = 20000;
  var UPLOAD_TIMEOUT_MS = 180000;
  var SHORT_TIMEOUT_MS = 60000;                 // job API calls that return immediately
  var AUDIO_TIMEOUT_MS = 600000;                // fetching a finished audio file
  var JOB_POLL_MS = 3000, JOB_POLL_MAX_MS = 15000, JOB_MAX_FAILS = 25;
  // Chatterbox's bundled voices — used when the job API doesn't pass the list through.
  var FALLBACK_VOICES = ['Abigail', 'Adrian', 'Alexander', 'Alice', 'Austin', 'Axel', 'Connor', 'Cora', 'Elena', 'Eli',
    'Emily', 'Everett', 'Gabriel', 'Gianna', 'Henry', 'Ian', 'Jade', 'Jeremiah', 'Jordan', 'Julian', 'Layla',
    'Leonardo', 'Michael', 'Miles', 'Olivia', 'Ryan', 'Taylor', 'Thomas'];

  /* ---------- State ---------- */
  var settings = Object.assign({}, DEFAULTS, YB.store.get('voice', {}));
  var app = {
    state: 'connecting',
    backend: '',
    source: '',          // 'config' | 'saved' | 'manual'
    config: null,
    info: null,
    generating: false,
    controller: null,    // AbortController for the active /tts request (user cancel only)
    uploading: false,
    audioUrl: null,
    healthTimer: null,
    healthBusy: false,
    healthFails: 0,
    elapsedTimer: null,
    startedAt: 0,
    voicesLoaded: false,
    mode: 'direct',      // 'job' = async job API (POST /jobs + polling), 'direct' = Chatterbox /tts
    modeKnown: false,
    busy: false,         // job API is up but Chatterbox is busy
    job: null,           // active job { id, ext, polls, fails }
    pollTimer: null,
    orphanJob: null,     // a job we stopped waiting for that may still be running
    jobToken: 0,
    preparing: false,
    cloneAvailable: true
  };

  function $(id) { return document.getElementById(id); }
  var saveSettings = YB.debounce(function () { YB.store.set('voice', settings); }, 250);
  var saveScript = YB.debounce(function () { YB.store.set('voiceScript', $('scriptText').value); }, 400);

  /* ---------- Small helpers ---------- */
  function normalizeUrl(u) { return String(u || '').trim().replace(/\/+$/, ''); }
  function isHttpUrl(u) { return /^https?:\/\/[^\s/]+/i.test(u); }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
  function isLocalTunnel(u) { return /(^|\.)loca\.lt$/i.test(hostOf(u)); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }
  function bytesLabel(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }

  function apiHeaders(extra) {
    var h = Object.assign({}, extra || {});
    // LocalTunnel only: asks it to skip its reminder page. It cannot bypass the
    // tunnel password screen — that still needs "Authorize Tunnel" once.
    if (isLocalTunnel(app.backend)) h['bypass-tunnel-reminder'] = 'true';
    return h;
  }

  // fetch with an internal timeout (used for health/config/lists/upload — NOT for /tts)
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

  function infoPath() { return app.mode === 'job' ? '/model-info' : '/api/model-info'; }
  function isJobMode() { return app.mode === 'job'; }

  // Parse a JSON body, or throw a typed error when a tunnel/HTML page came back instead.
  function readJson(res) {
    return res.text().then(function (text) {
      try { return JSON.parse(text); } catch (e) {
        console.error('[Voice Studio] expected JSON, got:', text.slice(0, 600));
        if (/^\s*</.test(text) && isLocalTunnel(app.backend)) throw makeErr('tunnel-auth', 'The LocalTunnel access page answered instead of the server.');
        throw makeErr('offline', 'The tunnel answered with a web page instead of the server (it may be restarting).');
      }
    });
  }

  function api(path, opts, ms) {
    opts = opts || {};
    return timedFetch(app.backend + path, Object.assign({ cache: 'no-store', mode: 'cors' }, opts, { headers: apiHeaders(opts.headers) }), ms || HEALTH_TIMEOUT_MS);
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
        else if (j.message) detail = j.message;
      } catch (e) { /* not JSON */ }
      console.error('[Voice Studio] HTTP ' + res.status + ' on ' + ctx, text.slice(0, 2000));
      var s = res.status;
      if (s === 511 || (looksHtml && isLocalTunnel(app.backend))) return makeErr('tunnel-auth', 'The LocalTunnel address needs to be authorized in this browser.');
      if (s === 524) return makeErr('cf-timeout', 'The Cloudflare tunnel gave up waiting (about 100 seconds) for the server to start answering.');
      if (s === 502 || s === 503 && looksHtml || s === 530 || s === 404 && looksHtml) return makeErr('offline', 'The tunnel is up but the Chatterbox server behind it isn\'t answering.');
      if (s === 503) return makeErr('model', detail || 'The Chatterbox model is not loaded yet.');
      if (s === 422) {
        if (/output_format/i.test(detail)) return makeErr('format', 'That output format isn\'t supported by this server.');
        return makeErr('validation', detail || 'The server rejected one of the settings.');
      }
      if (s === 404 && ctx === 'tts') {
        if (settings.mode === 'clone') return makeErr('ref-missing', detail || 'Reference file not found on the server.');
        return makeErr('voice-missing', detail || 'That voice was not found on the server.');
      }
      if (ctx === 'upload') return makeErr('upload', detail || ('Upload failed (HTTP ' + s + ').'));
      return makeErr(ctx === 'tts' ? 'tts' : 'http', detail || ('The server returned an error (HTTP ' + s + ').'));
    }).then(function (e) { e.status = res.status; return e; });
  }

  // Network-level failures (fetch throws) — no HTTP status available.
  function networkError(err) {
    if (err && err.kind) return err;
    console.error('[Voice Studio] network error', err);
    if (isLocalTunnel(app.backend)) return makeErr('tunnel-auth', 'The browser was blocked by the LocalTunnel access page (or the tunnel is down).');
    return makeErr('offline', 'Couldn\'t reach the Chatterbox server. It may be stopped, the tunnel address may have changed, or the browser blocked the request (CORS).');
  }

  var HELP = {
    'config-missing': 'Run the Colab startup cell — it writes the live address into backend-config.json. You can also paste the address under “Manual backend override”.',
    'offline': 'Check that the Colab startup cell is still running, then click Refresh Backend to pick up the newest address.',
    'tunnel-auth': 'Click Authorize Tunnel, complete the LocalTunnel page in the new tab, then come back and click Test Connection.',
    'timeout': 'The server is slow to respond. If a long generation is running elsewhere, wait for it to finish and test again.',
    'model': 'The server is up but the voice model hasn\'t finished loading. Wait a minute and click Test Connection.',
    'cf-timeout': 'Switch Delivery to “Stream (WAV)” — it starts sending audio right away so the tunnel doesn\'t time out — or shorten the script.',
    'ref-missing': 'A new Colab session starts without your uploads. Upload the reference file again.',
    'voice-missing': 'Click Refresh Voices and pick a voice from the updated list.',
    'format': 'Choose MP3, WAV or Opus, or use Stream (WAV).',
    'upload': 'Use a clean WAV or MP3 clip of one speaker, about 5–30 seconds long.',
    'validation': 'Check the voice settings (chunk size must be 50–500).',
    'lost': 'The connection dropped mid-generation — the tunnel or Colab may have restarted. Click Refresh Backend, then try again.',
    'job-lost': 'The job server no longer knows this job — it was probably restarted. Click Refresh Backend and generate again.',
    'busy': 'It\'s probably still finishing an earlier job. New jobs will wait and run slower until it\'s done.',
    'clone-unavailable': 'Add the voice-clone pass-through routes to your job API (see the README), restart it, then click Refresh References.',
    'tts': 'Try again, or shorten the script. Details are in the browser console.',
    'http': 'Details are in the browser console.'
  };

  function showNotice(el, err, level) {
    if (!err) { el.hidden = true; el.innerHTML = ''; return; }
    el.className = 'notice ' + (level || 'error');
    el.innerHTML = '<b>' + YB.esc(err.message) + '</b>' + YB.esc(HELP[err.kind] || '');
    el.hidden = false;
  }

  /* ---------- Status / UI state ---------- */
  var STATE_LABEL = { connecting: 'Connecting…', online: 'Online', offline: 'Offline', generating: 'Generating', error: 'Error' };

  function setState(state, label) {
    app.state = state;
    var el = $('connectionStatus');
    el.setAttribute('data-state', state);
    el.textContent = label || STATE_LABEL[state];
    updateControls();
  }

  function updateControls() {
    var busy = app.generating;
    $('generateBtn').disabled = busy || app.uploading || app.preparing;
    $('generateBtn').textContent = busy ? '⏳ Generating…' : '🎙️ Generate Speech';
    $('cancelBtn').disabled = !busy;
    $('testBtn').disabled = busy;
    $('refreshBackendBtn').disabled = busy;
    $('refreshVoicesBtn').disabled = busy;
    $('refreshRefsBtn').disabled = busy;
    $('againBtn').disabled = busy;
    $('authTunnelBtn').hidden = !isLocalTunnel(app.backend);
    $('openBackendBtn').disabled = !app.backend;
    $('openDocsBtn').disabled = !app.backend;
    // Job API returns finished files, so streaming doesn't apply there.
    $('deliveryField').hidden = isJobMode();
    $('outputFormat').disabled = !isJobMode() && settings.delivery === 'stream';
    var cloneOff = isJobMode() && !app.cloneAvailable;
    $('uploadRefBtn').disabled = busy || app.uploading || cloneOff;
    $('cloneUnavailable').hidden = !cloneOff;
  }

  function renderBackendFacts() {
    $('backendDisplay').textContent = app.backend
      ? app.backend + (app.source === 'manual' ? '  (manual)' : app.source === 'saved' ? '  (last known)' : '') + (app.modeKnown ? (isJobMode() ? ' · job API' : ' · direct') : '')
      : 'Not set';
    var info = app.info || {};
    $('modelType').textContent = info.type ? info.type.charAt(0).toUpperCase() + info.type.slice(1) + (info.sample_rate ? ' · ' + (info.sample_rate / 1000) + ' kHz' : '') : '—';
    $('modelDevice').textContent = info.device ? String(info.device).toUpperCase() : '—';
    var up = app.config && app.config.updated_at;
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

  /* ---------- Backend discovery ---------- */
  function loadBackendConfig() {
    if (app.generating) return Promise.resolve();
    showNotice($('backendNotice'), null);
    setState('connecting');

    var override = normalizeUrl(YB.store.get('voiceOverride', ''));
    if (override) {
      app.backend = override; app.source = 'manual'; app.config = null; app.modeKnown = false;
      $('backendUrlInput').value = override;
      renderBackendFacts();
      return resumeOrCheck({ loadLists: true });
    }

    return timedFetch('./backend-config.json?ts=' + Date.now(), { cache: 'no-store' }, CONFIG_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) throw makeErr('config-missing', 'backend-config.json was not found (HTTP ' + res.status + ').');
        return res.json().catch(function () { throw makeErr('config-missing', 'backend-config.json is not valid JSON.'); });
      })
      .then(function (cfg) {
        var url = normalizeUrl(cfg && cfg.backend_url);
        if (!isHttpUrl(url)) throw makeErr('config-missing', 'backend-config.json has no usable backend_url.');
        var changed = url !== app.backend;
        app.config = cfg; app.backend = url; app.source = 'config';
        if (cfg.tts_mode) { app.mode = cfg.tts_mode === 'async-job' ? 'job' : 'direct'; app.modeKnown = true; }
        else app.modeKnown = false;
        if (changed) { app.voicesLoaded = false; app.cloneAvailable = true; }
        YB.store.set('voiceBackend', url);
        $('backendUrlInput').value = url;
        renderBackendFacts();
        return resumeOrCheck({ loadLists: true });
      })
      .catch(function (err) {
        console.error('[Voice Studio] backend config', err);
        var fallback = normalizeUrl(YB.store.get('voiceBackend', ''));
        if (fallback) {
          app.backend = fallback; app.source = 'saved'; app.config = null; app.modeKnown = false;
          renderBackendFacts();
          showNotice($('backendNotice'), makeErr('config-missing', 'Couldn\'t read backend-config.json — trying the last address that worked.'), 'warn');
          return resumeOrCheck({ loadLists: true, keepNotice: true });
        }
        app.backend = ''; app.source = '';
        renderBackendFacts();
        setState('offline', 'No backend');
        showNotice($('backendNotice'), err.kind ? err : makeErr('config-missing', 'Backend configuration is missing.'));
      });
  }

  /* ---------- Backend type ---------- */
  // backend-config.json says "tts_mode": "async-job" for the job API. Without
  // that hint (manual override / last-known address) we ask the server.
  function detectMode() {
    if (app.modeKnown) return Promise.resolve(app.mode);
    return api('/health', {}, 20000)
      .then(function (res) { return res.ok ? res.json().catch(function () { return null; }) : null; })
      .catch(function () { return null; })
      .then(function (j) {
        app.mode = j && (j.ok === true || /job/i.test(String(j.service || ''))) ? 'job' : 'direct';
        app.modeKnown = true;
        renderBackendFacts(); updateControls(); renderSummary();
        return app.mode;
      });
  }

  /* ---------- Health ---------- */
  // Never runs while /tts is active: a busy CPU makes /api/model-info slow,
  // and that must not be reported as "Offline".
  function checkHealth(opts) {
    opts = opts || {};
    if (app.generating) return Promise.resolve();
    if (!app.backend) { setState('offline', 'No backend'); return Promise.resolve(); }
    if (app.healthBusy) return Promise.resolve();
    app.healthBusy = true;
    if (!opts.silent) setState('connecting');

    return detectMode()
      .then(function () {
        // Job API: /health proves the job server + tunnel are up; /model-info then
        // reports Chatterbox itself (it may be busy finishing a job).
        if (!isJobMode()) return null;
        return api('/health', {}, HEALTH_TIMEOUT_MS).then(function (res) {
          if (!res.ok) return httpError(res, 'health').then(function (e) { throw e; });
          return readJson(res);
        });
      })
      .then(function () { return api(infoPath(), {}, HEALTH_TIMEOUT_MS); })
      .then(function (res) {
        if (!res.ok) return httpError(res, 'health').then(function (e) { throw e; });
        return readJson(res);
      })
      .then(function (info) {
        if (app.generating) return; // a generation started meanwhile — ignore
        app.healthFails = 0;
        app.busy = isJobMode() && info.busy_or_unreachable === true;
        if (app.busy) {
          // Job server is fine; Chatterbox is just busy (or briefly slow). Not offline.
          // Show the model details Colab recorded in backend-config.json meanwhile.
          var cfg = app.config;
          if (!app.info && cfg && cfg.model_type) {
            app.info = { loaded: true, type: cfg.model_type, device: cfg.device, sample_rate: cfg.sample_rate,
              supports_paralinguistic_tags: cfg.supports_paralinguistic_tags, available_paralinguistic_tags: cfg.available_paralinguistic_tags };
            renderTags();
          }
          renderBackendFacts();
          setState('online', 'Online · busy');
          showNotice($('backendNotice'), makeErr('busy', 'Chatterbox is busy right now.'), 'warn');
          // A busy Chatterbox answers nothing until it's done, so don't wait on lists.
          if (!app.voicesLoaded) useFallbackVoices();
          return;
        }
        app.info = info;
        renderBackendFacts(); renderTags();
        if (info.loaded !== true) {
          setState('error', 'Model not loaded');
          showNotice($('backendNotice'), makeErr('model', 'Chatterbox is running but the model is not loaded.'));
          return;
        }
        setState('online');
        if (!opts.keepNotice) showNotice($('backendNotice'), null);
        if (opts.loadLists || !app.voicesLoaded) return Promise.all([loadVoices(true), loadReferences(true)]);
      })
      .catch(function (err) {
        if (app.generating) return;
        err = networkError(err);
        app.healthFails++;
        // a single slow background check is not enough to call it offline
        if (opts.silent && app.healthFails < 2 && err.kind === 'timeout') return;
        setState(err.kind === 'tunnel-auth' ? 'error' : 'offline', err.kind === 'tunnel-auth' ? 'Tunnel locked' : 'Offline');
        showNotice($('backendNotice'), err);
      })
      .then(function () { app.healthBusy = false; }, function () { app.healthBusy = false; });
  }

  function startPolling() {
    stopPolling();
    app.healthTimer = setInterval(function () {
      if (!app.generating && !document.hidden && app.backend) checkHealth({ silent: true });
    }, HEALTH_INTERVAL_MS);
  }
  function stopPolling() { if (app.healthTimer) { clearInterval(app.healthTimer); app.healthTimer = null; } }

  /* ---------- Predefined voices ---------- */
  function loadVoices(quiet) {
    if (!app.backend || app.generating) return Promise.resolve();
    var sel = $('predefinedVoiceSelect');
    return api('/get_predefined_voices', {}, HEALTH_TIMEOUT_MS)
      .then(function (res) { if (!res.ok) return httpError(res, 'voices').then(function (e) { throw e; }); return res.json(); })
      .then(function (voices) {
        voices = Array.isArray(voices) ? voices : [];
        app.voicesLoaded = true;
        if (!voices.length) {
          sel.innerHTML = '<option value="">No predefined voices on the server</option>';
          $('voiceCount').textContent = '';
          return;
        }
        sel.innerHTML = voices.map(function (v) {
          var file = typeof v === 'string' ? v : v.filename;
          var name = typeof v === 'string' ? v : (v.display_name || v.filename);
          return '<option value="' + YB.esc(file) + '">' + YB.esc(name) + '</option>';
        }).join('');
        var ids = voices.map(function (v) { return typeof v === 'string' ? v : v.filename; });
        if (settings.voiceId && ids.indexOf(settings.voiceId) !== -1) sel.value = settings.voiceId;
        else { settings.voiceId = sel.value; saveSettings(); }
        $('voiceCount').textContent = voices.length + ' voices';
        if (!quiet) YB.toast('Voices updated');
      })
      .catch(function (err) {
        err = networkError(err);
        // Job API without a voice-list route (or Chatterbox busy behind it):
        // use the standard voices rather than leaving the menu empty.
        if (isJobMode()) {
          if (!app.voicesLoaded || /404|405|Not Found/i.test(err.message + ' ' + (err.status || ''))) useFallbackVoices();
          if (!quiet) YB.toast('Using the standard voice list');
          return;
        }
        if (!quiet) showNotice($('genError'), err);
      });
  }

  // The job API doesn't expose /get_predefined_voices — offer Chatterbox's standard set.
  function useFallbackVoices() {
    var sel = $('predefinedVoiceSelect');
    sel.innerHTML = FALLBACK_VOICES.map(function (n) { return '<option value="' + n + '.wav">' + n + '</option>'; }).join('');
    var ids = FALLBACK_VOICES.map(function (n) { return n + '.wav'; });
    sel.value = ids.indexOf(settings.voiceId) !== -1 ? settings.voiceId : 'Emily.wav';
    settings.voiceId = sel.value; saveSettings();
    app.voicesLoaded = true;
    $('voiceCount').textContent = 'Standard Chatterbox voices';
    renderSummary();
  }

  /* ---------- Reference files (voice clone) ---------- */
  function loadReferences(quiet) {
    if (!app.backend || app.generating) return Promise.resolve();
    return api('/get_reference_files', {}, HEALTH_TIMEOUT_MS)
      .then(function (res) { if (!res.ok) return httpError(res, 'refs').then(function (e) { throw e; }); return res.json(); })
      .then(function (files) {
        app.cloneAvailable = true; updateControls();
        renderReferences(Array.isArray(files) ? files : []);
        if (!quiet) YB.toast('References updated');
      })
      .catch(function (err) {
        err = networkError(err);
        if (isJobMode() && /404|405|Not Found/i.test(err.message + ' ' + (err.status || ''))) {
          app.cloneAvailable = false; updateControls();
          $('referenceSelect').innerHTML = '<option value="">Not available through the job API yet</option>';
          return;
        }
        if (!quiet) showNotice($('genError'), err);
      });
  }

  function renderReferences(files) {
    var sel = $('referenceSelect');
    sel.innerHTML = '<option value="">' + (files.length ? 'Choose a saved reference…' : 'No references on the server yet') + '</option>' +
      files.map(function (f) { return '<option value="' + YB.esc(f) + '">' + YB.esc(f) + '</option>'; }).join('');
    if (settings.reference && files.indexOf(settings.reference) !== -1) sel.value = settings.reference;
    else if (settings.reference && app.state === 'online') {
      // the stored filename is gone (new Colab session) — forget it
      setReference('');
      setUploadState('idle', 'Your previous reference isn\'t on this server session. Upload it again.');
    }
  }

  function setReference(name) {
    settings.reference = name || '';
    saveSettings();
    $('uploadedReferenceName').textContent = settings.reference || 'None';
    if ($('referenceSelect').value !== settings.reference) $('referenceSelect').value = settings.reference;
  }

  function setUploadState(state, text) {
    var el = $('uploadState');
    el.setAttribute('data-state', state);
    el.textContent = text;
  }

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
    form.append('files', file, file.name); // Chatterbox expects the multipart field "files"

    return api('/upload_reference', { method: 'POST', body: form }, UPLOAD_TIMEOUT_MS)
      .then(function (res) {
        if (isJobMode() && (res.status === 404 || res.status === 405)) {
          app.cloneAvailable = false;
          throw makeErr('clone-unavailable', 'Your job server doesn\'t accept reference uploads yet.');
        }
        return res.text().then(function (text) {
          var data = null; try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
          if (!data) { console.error('[Voice Studio] upload response', res.status, text.slice(0, 1000)); throw res.ok ? makeErr('upload', 'Upload returned an unexpected response.') : (res.status === 511 || isLocalTunnel(app.backend) ? makeErr('tunnel-auth', 'The LocalTunnel address needs to be authorized in this browser.') : makeErr('upload', 'Upload failed (HTTP ' + res.status + ').')); }
          var uploaded = data.uploaded_files || [];
          if (!uploaded.length) {
            var msg = (data.errors && data.errors[0] && data.errors[0].error) || data.detail || 'The server did not accept the file.';
            throw makeErr('upload', 'Reference upload failed: ' + msg);
          }
          if (Array.isArray(data.all_reference_files)) renderReferences(data.all_reference_files);
          return uploaded[0]; // server-side (sanitized) filename
        });
      })
      .then(function (serverName) {
        setReference(serverName);
        setUploadState('done', '✓ Uploaded as ' + serverName);
        showNotice($('genError'), null);
        return serverName;
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
  }

  /* ---------- Voice mode / delivery ---------- */
  function setMode(mode) {
    settings.mode = mode === 'clone' ? 'clone' : 'predefined'; saveSettings();
    $('voiceModeSeg').querySelectorAll('[data-mode]').forEach(function (b) {
      var on = b.getAttribute('data-mode') === settings.mode;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    $('predefinedVoiceSection').hidden = settings.mode !== 'predefined';
    $('cloneVoiceSection').hidden = settings.mode !== 'clone';
    renderSummary();
  }

  function setDelivery(d) {
    settings.delivery = d === 'file' ? 'file' : 'stream'; saveSettings();
    $('deliverySeg').querySelectorAll('[data-delivery]').forEach(function (b) {
      var on = b.getAttribute('data-delivery') === settings.delivery;
      b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    var stream = settings.delivery === 'stream';
    updateControls(); // sets the Format lock (only direct mode + stream locks it to WAV)
    $('deliveryNote').textContent = stream
      ? 'Sends WAV audio as each chunk finishes — shows live progress and keeps the tunnel from timing out on long CPU jobs. Format is always WAV.'
      : 'Returns one file in your chosen format when everything is done. Through a Cloudflare tunnel, jobs that take longer than about 100 seconds can time out — use Stream for long scripts.';
    renderSummary();
  }

  function fillSettings() {
    $('outputFormat').value = settings.format;
    $('chunkSize').value = settings.chunk;
    $('temperature').value = settings.temperature;
    $('speedFactor').value = settings.speed;
    $('generationSeed').value = settings.seed;
    $('splitText').checked = !!settings.split;
    $('tempVal').textContent = Number(settings.temperature).toFixed(2);
    $('speedVal').textContent = Number(settings.speed).toFixed(2) + '×';
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

  function renderTags() {
    var info = app.info;
    var known = info && info.type;
    var supports = !known || info.supports_paralinguistic_tags;
    $('tagBox').hidden = !supports;
    var tags = (info && Array.isArray(info.available_paralinguistic_tags) && info.available_paralinguistic_tags.length) ? info.available_paralinguistic_tags : DEFAULT_TAGS;
    tags = tags.map(function (t) { return String(t).replace(/^\[|\]$/g, ''); });
    $('tagNote').textContent = known ? '(inserted at your cursor)' : '(Turbo model — inserted at your cursor)';
    $('tagButtons').innerHTML = tags.map(function (t) {
      return '<button type="button" data-tag="' + YB.esc(t) + '">[' + YB.esc(t) + ']</button>';
    }).join('');
  }

  function knownTags() {
    var info = app.info;
    var tags = (info && info.available_paralinguistic_tags && info.available_paralinguistic_tags.length) ? info.available_paralinguistic_tags : DEFAULT_TAGS;
    return tags.map(function (t) { return String(t).replace(/^\[|\]$/g, '').toLowerCase(); });
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

  /* ---------- Generation ---------- */
  function renderSummary() {
    var el = $('genSummary'); if (!el) return;
    var voice = settings.mode === 'clone'
      ? (settings.reference ? 'Clone: ' + settings.reference : 'Clone: no reference yet')
      : ($('predefinedVoiceSelect').selectedOptions[0] && $('predefinedVoiceSelect').value ? $('predefinedVoiceSelect').selectedOptions[0].textContent : 'No voice selected');
    var fmt = !isJobMode() && settings.delivery === 'stream' ? 'WAV (streamed)' : settings.format.toUpperCase();
    el.textContent = voice + ' · ' + fmt;
  }

  function buildRequest() {
    var text = $('scriptText').value.trim();
    var stream = !isJobMode() && settings.delivery === 'stream';
    var body = {
      text: text,
      voice_mode: settings.mode,
      output_format: stream ? 'wav' : settings.format,
      split_text: !!settings.split,
      chunk_size: clampChunk(settings.chunk),
      temperature: Number(settings.temperature),
      speed_factor: Number(settings.speed),
      seed: Math.max(0, Math.round(Number(settings.seed) || 0))
    };
    if (!isJobMode()) body.stream = stream;   // the job API only takes the fields above
    if (settings.mode === 'predefined') body.predefined_voice_id = $('predefinedVoiceSelect').value;
    else body.reference_audio_filename = settings.reference;
    return body;
  }

  function startGenerating() {
    app.generating = true;
    stopPolling();                       // no health polling during /tts
    app.startedAt = Date.now();
    setState('generating', 'Generating');
    showNotice($('genError'), null);
    $('genProgress').hidden = false;
    $('genStatusText').textContent = 'Generating speech — CPU generation may take several minutes';
    $('genDetail').textContent = 'Generating chunked speech on CPU. Longer scripts can take several minutes.';
    tickElapsed();
    app.elapsedTimer = setInterval(tickElapsed, 1000);
  }

  function tickElapsed() { $('genElapsed').textContent = mmss((Date.now() - app.startedAt) / 1000) + ' elapsed'; }

  function stopGenerating() {
    app.generating = false;
    app.controller = null;
    clearInterval(app.elapsedTimer);
    $('genProgress').hidden = true;
    // Resume health checks. Show the last known good state right away; the
    // follow-up check (once the CPU has had a moment) confirms it.
    var known = app.info && app.info.loaded;
    setState(known ? 'online' : 'connecting');
    startPolling();
    // Known-good server: give the CPU a moment first. Never checked yet (we went
    // straight into a resumed job): check now and load the voice lists.
    setTimeout(function () { if (!app.generating) checkHealth(known ? { silent: true } : { loadLists: true }); }, known ? 4000 : 0);
  }

  // Reads a streamed WAV body, reporting how much audio has arrived.
  function readStream(res) {
    if (!res.body || !res.body.getReader) return res.blob();
    var reader = res.body.getReader(), parts = [], total = 0, sr = 0;
    $('genStatusText').textContent = 'Generating speech — CPU generation may take several minutes';
    $('genDetail').textContent = 'Waiting for the first chunk of audio…';
    function pump() {
      return reader.read().then(function (r) {
        if (r.done) return;
        parts.push(r.value); total += r.value.length;
        if (!sr && total >= 28) {
          var head = concat(parts, Math.min(total, 64));
          sr = new DataView(head.buffer).getUint32(24, true);
        }
        if (sr) $('genDetail').textContent = 'Streaming: ' + mmss(Math.max(0, total - 44) / (sr * 2)) + ' of audio received so far. Longer scripts can take several minutes.';
        return pump();
      });
    }
    return pump().then(function () {
      if (total <= 44) throw makeErr('tts', 'The server finished without returning any audio.');
      var bytes = concat(parts, total);
      // The streamed header has unknown sizes; write the real ones so every
      // player and editor reads the saved file correctly.
      if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) {
        var dv = new DataView(bytes.buffer);
        dv.setUint32(4, total - 8, true);
        dv.setUint32(40, total - 44, true);
      }
      return new Blob([bytes], { type: 'audio/wav' });
    });
  }

  function concat(parts, limit) {
    var out = new Uint8Array(limit), off = 0;
    for (var i = 0; i < parts.length && off < limit; i++) {
      var p = parts[i], n = Math.min(p.length, limit - off);
      out.set(n === p.length ? p : p.subarray(0, n), off); off += n;
    }
    return out;
  }

  function generate() {
    if (app.generating || app.controller || app.job || app.preparing) return;   // never two at once
    showNotice($('genError'), null);
    var text = $('scriptText').value.trim();
    if (!app.backend) { showNotice($('genError'), makeErr('config-missing', 'No backend is connected.')); return; }
    if (!text) { showNotice($('genError'), makeErr('validation', 'Add some narration to the script first.'), 'warn'); $('scriptText').focus(); return; }

    var ready = Promise.resolve(true);
    if (settings.mode === 'predefined') {
      if (!$('predefinedVoiceSelect').value) { showNotice($('genError'), makeErr('voice-missing', 'Choose a predefined voice first.'), 'warn'); return; }
    } else if (isJobMode() && !app.cloneAvailable) {
      showNotice($('genError'), makeErr('clone-unavailable', 'Voice cloning isn\'t available through your job server yet.'), 'warn'); return;
    } else if (!settings.reference) {
      // a file is chosen but not uploaded yet — upload it first
      if ($('voiceSampleFile').files && $('voiceSampleFile').files[0]) ready = uploadReference().then(Boolean);
      else { showNotice($('genError'), makeErr('ref-missing', 'Upload a reference recording (or pick a saved one) first.'), 'warn'); return; }
    }

    app.preparing = true; updateControls();
    ready.then(function (ok) {
      if (!ok) return false;
      return isJobMode() ? checkOrphan() : true;
    }).then(function (ok) {
      app.preparing = false; updateControls();
      if (!ok || app.generating) return;
      var body = buildRequest();
      if (isJobMode()) { runJob(body); return; }
      var stream = body.stream;
      var ext = stream ? 'wav' : body.output_format;
      app.controller = new AbortController();               // user cancel only — no timeout
      startGenerating();
      console.info('[Voice Studio] POST /tts', Object.assign({}, body, { text: body.text.length + ' chars' }));

      fetch(app.backend + '/tts', {
        method: 'POST',
        mode: 'cors',
        cache: 'no-store',
        headers: apiHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
        signal: app.controller.signal
      })
        .then(function (res) {
          if (!res.ok) return httpError(res, 'tts').then(function (e) { throw e; });
          var ct = (res.headers.get('content-type') || '').toLowerCase();
          if (/json|html|text\//.test(ct)) return res.text().then(function (t) { console.error('[Voice Studio] /tts non-audio', t.slice(0, 1000)); throw makeErr('tts', 'The server answered without audio.'); });
          $('genDetail').textContent = stream ? 'Waiting for the first chunk of audio…' : 'Server is working — the file arrives when every chunk is finished.';
          return stream ? readStream(res) : res.blob();
        })
        .then(function (blob) {
          if (!blob || blob.size < 100) throw makeErr('tts', 'The server returned an empty audio file.');
          showAudio(blob, ext);
          YB.toast('Speech ready');
        })
        .catch(function (err) {
          if (err && err.name === 'AbortError') {
            showNotice($('genError'), makeErr('http', 'Generation cancelled.'), 'warn');
            $('genError').innerHTML = '<b>Generation cancelled.</b>The server may keep working on the current chunk for a little while before it\'s free again.';
            return;
          }
          if (err && err.kind === 'ref-missing') { setReference(''); setUploadState('error', 'Reference missing on the server — upload it again.'); }
          if (err && err.kind === 'voice-missing') loadVoices(true);
          if (!err.kind) { console.error('[Voice Studio] /tts failed', err); err = makeErr('lost', 'The connection to the server was lost during generation.'); }
          showNotice($('genError'), err);
        })
        .then(stopGenerating);
    });
  }

  function cancelGeneration() {
    if (isJobMode() && app.generating) {
      // The job API has no cancel endpoint: stop waiting here and remember the
      // job so we can warn before stacking another one on the CPU.
      app.jobToken++;
      if (app.job) app.orphanJob = app.job.id;
      clearTimeout(app.pollTimer);
      app.job = null; saveActiveJob();
      stopGenerating();
      var el = $('genError');
      el.className = 'notice warn'; el.hidden = false;
      el.innerHTML = '<b>Stopped waiting for this job.</b>The job server can\'t cancel a running job, so Chatterbox will finish it in the background — the CPU stays busy until then.';
      return;
    }
    if (app.controller) app.controller.abort();
  }

  /* ---------- Job API generation (POST /jobs → poll → GET audio) ---------- */
  function saveActiveJob() {
    if (app.job) YB.store.set('voiceJob', { id: app.job.id, ext: app.job.ext, backend: app.backend, startedAt: app.startedAt });
    else YB.store.remove('voiceJob');
  }

  function setJobText(status) {
    $('genStatusText').textContent = 'Generating speech — CPU generation may take several minutes';
    $('genDetail').textContent = status === 'queued'
      ? 'Job queued — waiting for Chatterbox to start…'
      : 'Generating chunked speech on CPU. Longer scripts can take several minutes. You can leave this page — it picks the job back up when you return.';
  }

  function runJob(body) {
    var token = ++app.jobToken;
    startGenerating();
    $('genDetail').textContent = 'Sending the job to the server…';
    console.info('[Voice Studio] POST /jobs', Object.assign({}, body, { text: body.text.length + ' chars' }));
    api('/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, SHORT_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) return httpError(res, 'tts').then(function (e) { throw e; });
        return readJson(res);
      })
      .then(function (data) {
        if (!data || !data.job_id) throw makeErr('tts', 'The job server did not return a job ID.');
        if (token !== app.jobToken) { app.orphanJob = data.job_id; return; } // cancelled while submitting
        app.job = { id: data.job_id, ext: body.output_format, fails: 0, delay: JOB_POLL_MS, audioTries: 0 };
        saveActiveJob();
        setJobText(data.status || 'queued');
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

  function pollJob() {
    var job = app.job; if (!job) return;
    api('/jobs/' + encodeURIComponent(job.id) + '?ts=' + Date.now(), {}, SHORT_TIMEOUT_MS)
      .then(function (res) {
        if (res.status === 404) {
          return res.text().then(function (t) {
            if (/job not found/i.test(t)) throw makeErr('job-lost', 'The server no longer has this job.');
            throw Object.assign(makeErr('offline', 'Job status page not found.'), { transient: true });
          });
        }
        if (!res.ok) return httpError(res, 'job').then(function (e) { e.transient = true; throw e; });
        return readJson(res);
      })
      .then(function (data) {
        if (app.job !== job) return;
        job.fails = 0; job.delay = JOB_POLL_MS;
        if (data.status === 'complete') return fetchJobAudio(job, data.format);
        if (data.status === 'failed') { finishJob(jobFailure(data.error)); return; }
        setJobText(data.status);
        scheduleJobPoll();
      })
      .catch(function (err) {
        if (app.job !== job) return;
        err = networkError(err);
        var transient = err.transient || err.kind === 'offline' || err.kind === 'timeout';
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
    $('genDetail').textContent = 'Speech is ready — downloading the audio…';
    return api('/jobs/' + encodeURIComponent(job.id) + '/audio', {}, AUDIO_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) return httpError(res, 'audio').then(function (e) { e.transient = res.status >= 500; throw e; });
        var ct = (res.headers.get('content-type') || '').toLowerCase();
        if (/json|html/.test(ct)) return res.text().then(function (t) { console.error('[Voice Studio] audio endpoint returned', t.slice(0, 600)); throw makeErr('tts', 'The server sent something other than audio.'); });
        return res.blob();
      })
      .then(function (blob) {
        if (app.job !== job) return;
        if (!blob || blob.size < 100) throw makeErr('tts', 'The server returned an empty audio file.');
        showAudio(blob, fmt || job.ext);
        YB.toast('Speech ready');
        finishJob(null);
      })
      .catch(function (err) {
        if (app.job !== job) return;
        err = networkError(err);
        if ((err.transient || err.kind === 'offline' || err.kind === 'timeout') && ++job.audioTries < 4) {
          $('genDetail').textContent = 'Download interrupted — retrying (' + job.audioTries + ')…';
          setTimeout(function () { if (app.job === job) fetchJobAudio(job, fmt); }, 3000);
          return;
        }
        finishJob(err);
      });
  }

  // The job API reports Chatterbox failures as text like:
  //   Chatterbox HTTP 404: {"detail":"Reference audio file 'x.wav' not found."}
  function jobFailure(text) {
    text = String(text || '');
    console.error('[Voice Studio] job failed:', text.slice(0, 2000));
    var m = /HTTP (\d{3}):\s*([\s\S]*)$/.exec(text);
    var status = m ? Number(m[1]) : 0, detail = '';
    if (m) {
      try {
        var j = JSON.parse(m[2]);
        detail = typeof j.detail === 'string' ? j.detail : Array.isArray(j.detail) ? j.detail.map(function (d) { return (d.loc ? d.loc[d.loc.length - 1] + ': ' : '') + d.msg; }).join('; ') : '';
      } catch (e) { detail = /^\s*</.test(m[2]) ? '' : m[2].slice(0, 200); }
    }
    if (status === 404) return settings.mode === 'clone' ? makeErr('ref-missing', detail || 'Reference file not found on the server.') : makeErr('voice-missing', detail || 'That voice was not found on the server.');
    if (status === 503) return makeErr('model', detail || 'The Chatterbox model is not loaded.');
    if (status === 422) return /output_format/i.test(detail) ? makeErr('format', 'That output format isn\'t supported.') : makeErr('validation', detail || 'The server rejected one of the settings.');
    if (status) return makeErr('tts', detail || ('Chatterbox returned an error (HTTP ' + status + ').'));
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

  // Before a new job: if a cancelled one is still running, ask first.
  function checkOrphan() {
    if (!app.orphanJob) return Promise.resolve(true);
    var id = app.orphanJob;
    return api('/jobs/' + encodeURIComponent(id) + '?ts=' + Date.now(), {}, SHORT_TIMEOUT_MS)
      .then(function (res) { return res.ok ? res.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        if (d && (d.status === 'queued' || d.status === 'running')) {
          return confirm('A job you stopped waiting for is still running on the server. Starting another now makes both slower on the CPU.\n\nStart a new one anyway?');
        }
        app.orphanJob = null;
        return true;
      });
  }

  // Reopened the page mid-job? Re-attach to it straight away (before any health
  // check — a busy CPU makes /model-info slow, and Generate must stay locked).
  function resumeJob() {
    var saved = YB.store.get('voiceJob', null);
    if (!saved || !saved.id) return false;
    if (normalizeUrl(saved.backend) !== app.backend || !isJobMode()) { YB.store.remove('voiceJob'); return false; }
    startGenerating();
    app.startedAt = saved.startedAt || Date.now();
    tickElapsed();
    app.job = { id: saved.id, ext: saved.ext || settings.format, fails: 0, delay: 500, audioTries: 0 };
    $('genDetail').textContent = 'Picking up your job where it left off…';
    scheduleJobPoll();
    return true;
  }

  function resumeOrCheck(opts) {
    var saved = YB.store.get('voiceJob', null);
    if (!saved || !saved.id || app.generating) return checkHealth(opts);
    if (normalizeUrl(saved.backend) !== app.backend) { YB.store.remove('voiceJob'); return checkHealth(opts); }
    return detectMode().then(function () {
      app.preparing = false;
      if (resumeJob()) { setState('generating', 'Generating'); return; }
      return checkHealth(opts);
    });
  }

  /* ---------- Output ---------- */
  function showAudio(blob, ext) {
    if (app.audioUrl) URL.revokeObjectURL(app.audioUrl);
    app.audioUrl = URL.createObjectURL(blob);
    var player = $('audioPreview');
    player.src = app.audioUrl;
    var stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[:.]/g, '-');
    var dl = $('downloadAudioBtn');
    dl.href = app.audioUrl;
    dl.download = 'youtube-voice-' + stamp + '.' + ext;
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

  /* ---------- Events ---------- */
  function bind() {
    // backend
    $('testBtn').addEventListener('click', function () { checkHealth({ loadLists: true }); });
    $('refreshBackendBtn').addEventListener('click', loadBackendConfig);
    $('authTunnelBtn').addEventListener('click', function () { if (app.backend) window.open(app.backend, '_blank', 'noopener'); });
    $('openBackendBtn').addEventListener('click', function () {
      if (app.backend) window.open(app.backend + (isJobMode() ? '/health' : ''), '_blank', 'noopener');
    });
    $('openDocsBtn').addEventListener('click', function () {
      if (!app.backend) return;
      var docs = app.source === 'config' && app.config && isHttpUrl(app.config.api_docs) ? app.config.api_docs : app.backend + '/docs';
      window.open(docs, '_blank', 'noopener');
    });
    $('overrideForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var url = normalizeUrl($('backendUrlInput').value);
      if (!isHttpUrl(url)) { YB.toast('Enter a full address starting with https://'); return; }
      YB.store.set('voiceOverride', url);
      app.voicesLoaded = false;
      loadBackendConfig();
    });
    $('clearOverrideBtn').addEventListener('click', function () {
      YB.store.remove('voiceOverride');
      app.voicesLoaded = false;
      loadBackendConfig();
      YB.toast('Back to automatic backend');
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
    $('refreshVoicesBtn').addEventListener('click', function () { loadVoices(false); });
    $('voiceSampleFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      $('localFileName').textContent = f ? f.name + ' (' + bytesLabel(f.size) + ')' : 'None';
      if (f) setUploadState('idle', 'Ready to upload — click Upload Reference.');
    });
    $('uploadRefBtn').addEventListener('click', uploadReference);
    $('clearRefBtn').addEventListener('click', clearReference);
    $('refreshRefsBtn').addEventListener('click', function () { loadReferences(false); });
    $('referenceSelect').addEventListener('change', function () {
      setReference(this.value);
      if (this.value) setUploadState('done', '✓ Using saved reference ' + this.value);
      renderSummary();
    });

    // settings
    $('deliverySeg').addEventListener('click', function (e) { var b = e.target.closest('[data-delivery]'); if (b) setDelivery(b.getAttribute('data-delivery')); });
    $('outputFormat').addEventListener('change', function () { settings.format = this.value; saveSettings(); renderSummary(); });
    $('chunkSize').addEventListener('change', function () { settings.chunk = clampChunk(this.value); this.value = settings.chunk; saveSettings(); updateScriptMeta(); });
    $('temperature').addEventListener('input', function () { settings.temperature = Number(this.value); $('tempVal').textContent = settings.temperature.toFixed(2); saveSettings(); });
    $('speedFactor').addEventListener('input', function () { settings.speed = Number(this.value); $('speedVal').textContent = settings.speed.toFixed(2) + '×'; saveSettings(); });
    $('generationSeed').addEventListener('change', function () { settings.seed = Math.max(0, Math.round(Number(this.value) || 0)); this.value = settings.seed; saveSettings(); });
    $('splitText').addEventListener('change', function () { settings.split = this.checked; $('chunkSize').disabled = !this.checked; saveSettings(); updateScriptMeta(); });
    $('resetSettingsBtn').addEventListener('click', function () {
      ['format', 'chunk', 'temperature', 'speed', 'seed', 'split'].forEach(function (k) { settings[k] = DEFAULTS[k]; });
      saveSettings(); fillSettings(); setDelivery('stream'); updateScriptMeta(); YB.toast('Settings reset');
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

    // lifecycle
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden && app.job) { clearTimeout(app.pollTimer); pollJob(); return; }
      if (!document.hidden && !app.generating && app.backend && app.state !== 'connecting') checkHealth({ silent: true });
    });
    window.addEventListener('beforeunload', function (e) {
      if (app.generating && !isJobMode()) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function init() {
    fillSettings();
    setMode(settings.mode);
    setDelivery(settings.delivery);
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
      $('importBox').open = true;
      renderImport(pending.storyId);
      importFromStory(pending.storyId, pending.speaker || 'all', true);
    }

    updateScriptMeta();
    updateControls();
    if (YB.store.get('voiceJob', null)) { app.preparing = true; updateControls(); }
    loadBackendConfig().then(function () {
      app.preparing = false; updateControls();
      if (!app.generating) startPolling();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
