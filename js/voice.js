/* =========================================================
   Youtube Blue — voice.js
   Controls the Voice Studio page only: Chatterbox backend
   discovery + health, predefined voices, voice-clone references,
   script editor, /tts generation (streamed or single file),
   playback and download.
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
    voicesLoaded: false
  };

  function $(id) { return document.getElementById(id); }
  var saveSettings = YB.debounce(function () { YB.store.set('voice', settings); }, 250);
  var saveScript = YB.debounce(function () { YB.store.set('voiceScript', $('scriptText').value); }, 400);

  /* ---------- Small helpers ---------- */
  function normalizeUrl(u) { return String(u || '').trim().replace(/\/+$/, ''); }
  function isHttpUrl(u) { return /^https?:\/\/[^\s/]+/i.test(u); }
  function hostOf(u) { try { return new URL(u).hostname; } catch (e) { return ''; } }
  function isLocalTunnel(u) { return /(^|\.)loca\.lt$/i.test(hostOf(u)); }
  function isCloudflare(u) { return /\.trycloudflare\.com$/i.test(hostOf(u)); }
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
    });
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
    $('generateBtn').disabled = busy || app.uploading;
    $('generateBtn').textContent = busy ? '⏳ Generating…' : '🎙️ Generate Speech';
    $('cancelBtn').disabled = !busy;
    $('testBtn').disabled = busy;
    $('refreshBackendBtn').disabled = busy;
    $('refreshVoicesBtn').disabled = busy;
    $('refreshRefsBtn').disabled = busy;
    $('uploadRefBtn').disabled = busy || app.uploading;
    $('againBtn').disabled = busy;
    $('authTunnelBtn').hidden = !isLocalTunnel(app.backend);
    $('openBackendBtn').disabled = !app.backend;
    $('openDocsBtn').disabled = !app.backend;
  }

  function renderBackendFacts() {
    $('backendDisplay').textContent = app.backend ? app.backend + (app.source === 'manual' ? '  (manual)' : app.source === 'saved' ? '  (last known)' : '') : 'Not set';
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
      app.backend = override; app.source = 'manual'; app.config = null;
      $('backendUrlInput').value = override;
      renderBackendFacts();
      return checkHealth({ loadLists: true });
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
        if (changed) app.voicesLoaded = false;
        YB.store.set('voiceBackend', url);
        $('backendUrlInput').value = url;
        renderBackendFacts();
        return checkHealth({ loadLists: true });
      })
      .catch(function (err) {
        console.error('[Voice Studio] backend config', err);
        var fallback = normalizeUrl(YB.store.get('voiceBackend', ''));
        if (fallback) {
          app.backend = fallback; app.source = 'saved'; app.config = null;
          renderBackendFacts();
          showNotice($('backendNotice'), makeErr('config-missing', 'Couldn\'t read backend-config.json — trying the last address that worked.'), 'warn');
          return checkHealth({ loadLists: true, keepNotice: true });
        }
        app.backend = ''; app.source = '';
        renderBackendFacts();
        setState('offline', 'No backend');
        showNotice($('backendNotice'), err.kind ? err : makeErr('config-missing', 'Backend configuration is missing.'));
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

    return api('/api/model-info', {}, HEALTH_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) return httpError(res, 'health').then(function (e) { throw e; });
        return res.json().catch(function () {
          throw isLocalTunnel(app.backend) ? makeErr('tunnel-auth', 'The LocalTunnel access page answered instead of Chatterbox.') : makeErr('http', 'The server answered with something that isn\'t Chatterbox.');
        });
      })
      .then(function (info) {
        if (app.generating) return; // a generation started meanwhile — ignore
        app.info = info; app.healthFails = 0;
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
        if (!quiet) showNotice($('genError'), err);
      });
  }

  /* ---------- Reference files (voice clone) ---------- */
  function loadReferences(quiet) {
    if (!app.backend || app.generating) return Promise.resolve();
    return api('/get_reference_files', {}, HEALTH_TIMEOUT_MS)
      .then(function (res) { if (!res.ok) return httpError(res, 'refs').then(function (e) { throw e; }); return res.json(); })
      .then(function (files) { renderReferences(Array.isArray(files) ? files : []); if (!quiet) YB.toast('References updated'); })
      .catch(function (err) { if (!quiet) showNotice($('genError'), networkError(err)); });
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
    $('outputFormat').disabled = stream;
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
    var fmt = settings.delivery === 'stream' ? 'WAV (streamed)' : settings.format.toUpperCase();
    el.textContent = voice + ' · ' + fmt;
  }

  function buildRequest() {
    var text = $('scriptText').value.trim();
    var stream = settings.delivery === 'stream';
    var body = {
      text: text,
      voice_mode: settings.mode,
      output_format: stream ? 'wav' : settings.format,
      split_text: !!settings.split,
      chunk_size: clampChunk(settings.chunk),
      temperature: Number(settings.temperature),
      speed_factor: Number(settings.speed),
      seed: Math.max(0, Math.round(Number(settings.seed) || 0)),
      stream: stream
    };
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
    setState(app.info && app.info.loaded ? 'online' : 'connecting');
    startPolling();
    setTimeout(function () { if (!app.generating) checkHealth({ silent: true }); }, 4000);
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
    if (app.generating || app.controller) return;          // never two /tts at once
    showNotice($('genError'), null);
    var text = $('scriptText').value.trim();
    if (!app.backend) { showNotice($('genError'), makeErr('config-missing', 'No backend is connected.')); return; }
    if (!text) { showNotice($('genError'), makeErr('validation', 'Add some narration to the script first.'), 'warn'); $('scriptText').focus(); return; }

    var ready = Promise.resolve(true);
    if (settings.mode === 'predefined') {
      if (!$('predefinedVoiceSelect').value) { showNotice($('genError'), makeErr('voice-missing', 'Choose a predefined voice first.'), 'warn'); return; }
    } else if (!settings.reference) {
      // a file is chosen but not uploaded yet — upload it first
      if ($('voiceSampleFile').files && $('voiceSampleFile').files[0]) ready = uploadReference().then(Boolean);
      else { showNotice($('genError'), makeErr('ref-missing', 'Upload a reference recording (or pick a saved one) first.'), 'warn'); return; }
    }

    ready.then(function (ok) {
      if (!ok || app.generating) return;
      var body = buildRequest();
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
    if (app.controller) app.controller.abort();
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
    $('openBackendBtn').addEventListener('click', function () { if (app.backend) window.open(app.backend, '_blank', 'noopener'); });
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
      if (!document.hidden && !app.generating && app.backend && app.state !== 'connecting') checkHealth({ silent: true });
    });
    window.addEventListener('beforeunload', function (e) {
      if (app.generating) { e.preventDefault(); e.returnValue = ''; }
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
    loadBackendConfig().then(startPolling);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
