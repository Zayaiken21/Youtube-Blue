/* =========================================================
   Youtube Blue — voice-story.js
   Story mode for Voice Studio: voices a whole Story Studio script
   with a different voice per character, in script order.

   • Each character picks a voice from the voice library (Presets, Our
     Voices, My Voices, built-in — js/voice-library.js) or imports one, plus its
     own voice settings (temperature, speed, seed, and exaggeration / CFG
     when the model has them). Every character starts at the defaults;
     whatever you set is what that character's lines are generated with.
     Saved per story under storage key "voiceCast".
   • Every spoken line (or a speaker's back-to-back lines) becomes one
     async job: POST /jobs → poll GET /jobs/{id} → GET /jobs/{id}/audio.
     Several jobs are in flight at once; results are kept by position.
   • When every line is done, the clips are decoded in the browser and
     stitched into one WAV in story order, with pauses between lines
     and at scene changes.
   • The run is saved as it goes (job IDs in "voiceStoryRun", finished
     clips in IndexedDB). The moment the page is hidden, closed or swiped
     away, every line not yet sent is handed to the service worker, which
     sends it to the job server and saves the job IDs (keepalive requests
     when there's no service worker), so the whole story keeps generating
     in the background.
     Reopen Voice Studio: it picks up the same jobs, collects the audio
     and builds the track.
   Uses the shared core exposed by voice.js (window.YBVoice); never
   calls /tts.
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB, V = window.YBVoice;
  if (!YB || !V) return;

  var SAMPLE_RATE = 24000;                  // Chatterbox Turbo output rate
  var NARRATOR = { id: 'narrator', name: 'Narrator', color: '#7dd3fc' };
  var RUN_KEY = 'voiceStoryRun';
  var opts = Object.assign({ pause: 400, scenePause: 800, parallel: 2, merge: true }, YB.store.get('voiceStoryOpts', {}));
  if ([1, 2, 3].indexOf(Number(opts.parallel)) === -1) { opts.parallel = 2; YB.store.set('voiceStoryOpts', opts); }
  opts.parallel = Number(opts.parallel);
  var castMap = YB.store.get('voiceCast', {});          // { storyId: { charId: { key, set? } } }
  var st = {
    active: YB.store.get('voiceGenMode', 'single') === 'story',
    storyId: '',
    segs: [],        // [{ type:'scene'|'line', text, speaker, lines, status, jobId, blob, url, error, fails, mode, voice }]
    run: null,       // active run { token, queue:[i], inflight:[i], timer, posting, hold, cycle }
    runId: ''        // names this run's saved clips in IndexedDB ("clip:<runId>:<i>")
  };
  function takes() { return window.YBTakes; }
  function lineKey(i) { return 'line:' + st.runId + ':' + i; }
  var swReg = null;                 // service worker that finishes sending lines after the page closes
  var HANDOFF_WAIT_MS = 120000;     // no word from the worker after this → send the line again

  function $(id) { return document.getElementById(id); }
  function saveOpts() { YB.store.set('voiceStoryOpts', opts); }
  function saveCast() { YB.store.set('voiceCast', castMap); }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

  /* ---------- Story data ---------- */
  function story() { return V.storiesList().find(function (s) { return s.id === st.storyId; }) || null; }
  function cast(s) { return [NARRATOR].concat((s && s.characters) || []); }
  function who(s, id) { return cast(s).find(function (c) { return c.id === id; }) || NARRATOR; }

  // Spoken text only: keeps real expression tags like [laugh], drops [placeholder] notes.
  function clean(text) {
    var tags = V.knownTags();
    return String(text || '').replace(/\[([^\]]*)\]/g, function (m, inner) {
      var t = inner.trim().toLowerCase();
      return tags.indexOf(t) !== -1 ? '[' + t + ']' : ' ';
    }).replace(/\s+/g, ' ').trim();
  }

  function buildSegments() {
    var s = story(), out = [];
    if (!s) return out;
    var pendingScene = '';
    (s.blocks || []).forEach(function (b) {
      if (b.type === 'scene') { if (b.text.trim()) pendingScene = b.text.trim(); return; }
      if (b.type !== 'line') return;
      var text = clean(b.text);
      if (!text || !/[\w]/.test(V.prepareText(text).replace(/\[[^\]]*\]/g, ''))) return;   // nothing speakable
      var speaker = cast(s).some(function (c) { return c.id === b.speaker; }) ? b.speaker : 'narrator';
      if (pendingScene) { out.push({ type: 'scene', text: pendingScene }); pendingScene = ''; }
      var last = out[out.length - 1];
      if (opts.merge && last && last.type === 'line' && last.speaker === speaker) { last.text += ' ' + text; last.lines++; return; }
      out.push({ type: 'line', speaker: speaker, text: text, lines: 1, status: 'idle' });
    });
    return out;
  }

  function lineSegs() { return st.segs.filter(function (g) { return g.type === 'line'; }); }
  function speakersUsed() {
    var ids = [];
    lineSegs().forEach(function (g) { if (ids.indexOf(g.speaker) === -1) ids.push(g.speaker); });
    return ids;
  }

  /* ---------- Cast voices ---------- */
  function lib() { return V.library(); }
  function allKeys() { var L = lib(); return L ? L.keys() : (V.voices() || []).map(function (b) { return 'builtin:' + b.filename; }); }
  function voiceFor(charId) {
    var m = castMap[st.storyId] || (castMap[st.storyId] = {}), cur = m[charId];
    if (cur && !cur.key && cur.id) {          // older saves: built-in voices carry over, old server references don't
      if (cur.mode !== 'clone') cur.key = 'builtin:' + cur.id;
      delete cur.mode; delete cur.id; saveCast();
    }
    if (!cur || !cur.key) {
      // Sensible start: narrator gets the single-voice choice, others get distinct voices (Presets first).
      var keys = allKeys(), used = Object.keys(m).map(function (k) { return m[k] && m[k].key; }).filter(Boolean);
      var pick = charId === 'narrator' && V.settings().voiceKey ? V.settings().voiceKey : '';
      if (!pick) pick = keys.find(function (k) { return used.indexOf(k) === -1; }) || keys[0] || '';
      if (!pick) return { key: '', set: cur && cur.set };
      m[charId] = Object.assign(cur || {}, { key: pick }); saveCast();
    }
    return m[charId];
  }

  // '' when usable, otherwise why not.
  function voiceProblem(v) {
    if (!v || !v.key) return 'Choose a voice.';
    var L = lib(), ok = L ? L.has(v.key) : null;
    if (ok === false) return 'This voice isn\'t available any more — pick another one.';
    if (L && L.groupOf(v.key) !== 'builtin' && !V.cloneAvailable()) return 'This server can\'t take voice uploads — pick a built-in voice.';
    return '';
  }

  /* ---------- Per-character voice settings ----------
     Story mode has no shared settings card: every setting lives on the
     character (presets, delivery, expression, language, text processing).
     Each character starts at the defaults; the controls follow the active
     model (Turbo / Original / Multilingual). */
  var openSet = {};   // charId → settings panel open
  function langs() { return V.languages() || { en: 'English' }; }
  function fullSet(set) {
    var d = V.voiceDefaults(), r = V.ranges, x = Object.assign({}, d, set || {});
    var codes = Object.keys(langs());
    return {
      temperature: V.clampTo(x.temperature, r.temperature[0], r.temperature[1], r.temperature[2]),
      speed: V.clampSpeed(x.speed),
      exaggeration: V.clampTo(x.exaggeration, r.exaggeration[0], r.exaggeration[1], r.exaggeration[2]),
      cfg: V.clampTo(x.cfg, r.cfg[0], r.cfg[1], r.cfg[2]),
      seed: Math.max(0, Math.round(Number(x.seed) || 0)),
      language: codes.indexOf(x.language) !== -1 ? x.language : (codes.indexOf('en') !== -1 ? 'en' : codes[0] || 'en'),
      split: x.split !== false,
      chunk: V.clampChunk(x.chunk)
    };
  }
  // Keys that matter for the active model.
  function liveKeys() {
    var c = V.caps(), k = ['temperature', 'speed', 'seed', 'split', 'chunk'];
    if (c.exaggeration) k.push('exaggeration');
    if (c.cfg) k.push('cfg');
    if (c.language) k.push('language');
    return k;
  }
  function isDefaultSet(set) {
    var a = fullSet(set), d = fullSet(null);
    return liveKeys().every(function (k) { return a[k] === d[k]; });
  }
  function presetOn(set, p) {
    var a = fullSet(set);
    return Object.keys(p[1]).every(function (k) { return Math.abs(Number(a[k]) - p[1][k]) < 0.001; });
  }
  function setSummary(set) {
    if (isDefaultSet(set)) return 'Default';
    var preset = V.presets().find(function (p) { return presetOn(set, p); });
    var a = fullSet(set), d = fullSet(null), c = V.caps(), out = [];
    if (preset) out.push(preset[0]);
    else {
      if (a.temperature !== d.temperature) out.push('Temp ' + a.temperature.toFixed(2));
      if (a.speed !== d.speed) out.push('Speed ' + a.speed.toFixed(2) + '×');
      if (c.exaggeration && a.exaggeration !== d.exaggeration) out.push('Exag ' + a.exaggeration.toFixed(2));
      if (c.cfg && a.cfg !== d.cfg) out.push('CFG ' + a.cfg.toFixed(2));
      if (a.chunk !== d.chunk && a.split) out.push('Chunk ' + a.chunk);
    }
    if (c.language && a.language !== d.language) out.push(langs()[a.language] || a.language);
    if (!a.split) out.push('No split');
    if (a.seed) out.push('Seed ' + a.seed);
    return out.join(' · ') || 'Custom';
  }
  // Only what the active model accepts goes into the job.
  function setOverrides(set) {
    var a = fullSet(set), c = V.caps();
    var o = { temperature: a.temperature, speed_factor: a.speed, seed: a.seed, split_text: a.split, chunk_size: a.chunk };
    if (c.exaggeration) o.exaggeration = a.exaggeration;
    if (c.cfg) o.cfg_weight = a.cfg;
    if (c.language) o.language = a.language;
    return o;
  }
  function labelFor(key, a) {
    return key === 'temperature' ? V.tempLabel(a.temperature) : key === 'speed' ? V.speedLabel(a.speed)
      : key === 'exaggeration' ? V.exagLabel(a.exaggeration) : key === 'cfg' ? a.cfg.toFixed(2) : key === 'chunk' ? V.chunkLabel(a.chunk) : '';
  }
  function slider(id, key, label, a, help, off) {
    var r = V.ranges[key];
    return '<label class="field cs-field' + (off ? ' is-off' : '') + '"><span>' + label + ' <b data-cs-val="' + key + '">' + YB.esc(labelFor(key, a)) + '</b></span>' +
      '<input type="range" min="' + r[0] + '" max="' + r[1] + '" step="' + r[2] + '" value="' + a[key] + '" data-cs="' + key + '" data-cs-char="' + YB.esc(id) + '"' + (off ? ' disabled' : '') + '>' +
      (help ? '<small class="muted">' + help + '</small>' : '') + '</label>';
  }
  function group(title, body) { return '<div class="cs-group"><div class="cs-head">' + title + '</div>' + body + '</div>'; }
  function settingsHtml(id, name, v) {
    var open = !!openSet[id], a = fullSet(v.set), c = V.caps(), locked = !!st.run || V.isBusy(), cid = YB.esc(id);
    var head = '<button type="button" class="cs-toggle" data-cs-toggle="' + cid + '" aria-expanded="' + open + '">' +
      '<span>🎚️ Voice settings</span><span class="cs-sum">' + YB.esc(setSummary(v.set)) + '</span><span class="cs-caret" aria-hidden="true">' + (open ? '▴' : '▾') + '</span></button>';
    if (!open) return '<div class="cs">' + head + '</div>';
    var chips = V.presets().map(function (p, i) {
      return '<button type="button" class="chip-btn' + (presetOn(v.set, p) ? ' on' : '') + '" data-cs-preset="' + i + '" data-cs-char="' + cid + '">' + YB.esc(p[0]) + '</button>';
    }).join('');
    var expression = c.exaggeration
      ? slider(id, 'exaggeration', 'Exaggeration', a, 'Higher sounds more emotional and dramatic.') + (c.cfg ? slider(id, 'cfg', 'CFG Weight', a, 'Lower is looser and faster-paced; higher sticks closer to the voice.') : '')
      : '<p class="cs-note">' + YB.esc(V.modelName()) + ' takes its emotion from the tags in the lines ([laugh], [sigh]…). Exaggeration and CFG Weight are in Original Chatterbox.</p>';
    var lang = c.language ? group('Language', '<label class="field cs-field"><span>Spoken language</span><select data-cs="language" data-cs-char="' + cid + '">' +
      Object.keys(langs()).sort(function (x, y) { return String(langs()[x]).localeCompare(String(langs()[y])); })
        .map(function (k) { return '<option value="' + YB.esc(k) + '"' + (k === a.language ? ' selected' : '') + '>' + YB.esc(langs()[k]) + '</option>'; }).join('') +
      '</select></label>') : '';
    return '<div class="cs">' + head + '<fieldset class="cs-panel"' + (locked ? ' disabled' : '') + ' aria-label="Voice settings for ' + YB.esc(name) + '">' +
      group('Presets <span class="cs-model">· for ' + YB.esc(V.modelName()) + '</span>', '<div class="chips cs-chips">' + chips + '</div>') +
      group('Delivery',
        slider(id, 'temperature', 'Temperature', a, 'Lower is steadier. Higher adds more variation.') +
        slider(id, 'speed', 'Speed', a, 'Big speed changes distort speech — use punctuation for slower delivery.') +
        '<label class="field cs-field"><span>Seed (0 = random)</span><input type="number" min="0" step="1" inputmode="numeric" value="' + a.seed + '" data-cs="seed" data-cs-char="' + cid + '"><small class="muted">Reuse a fixed seed for repeatable results.</small></label>') +
      group('Expression', expression) +
      lang +
      group('Text processing',
        '<label class="field check-field cs-check"><input type="checkbox" data-cs="split" data-cs-char="' + cid + '"' + (a.split ? ' checked' : '') + '><span>Split long lines into chunks</span></label>' +
        slider(id, 'chunk', 'Chunk size', a, 'Smaller chunks are more stable; larger ones flow more naturally.', !a.split)) +
      '<p class="cs-note">Story audio is always WAV so every line stitches cleanly.</p>' +
      '<button type="button" class="btn btn-ghost btn-xs" data-cs-reset="' + cid + '"' + (isDefaultSet(v.set) ? ' disabled' : '') + '>↺ Reset to default</button>' +
      '</fieldset></div>';
  }
  function charEntry(id) {
    var map = castMap[st.storyId] || (castMap[st.storyId] = {});
    if (!map[id]) map[id] = Object.assign({}, voiceFor(id));
    return map[id];
  }
  // Slider/number changes update in place (no re-render, so dragging stays smooth).
  function updateSetting(input) {
    var id = input.getAttribute('data-cs-char'), key = input.getAttribute('data-cs'), v = charEntry(id);
    var set = fullSet(v.set);
    if (key === 'split') set.split = input.checked;
    else if (key === 'language') set.language = input.value;
    else if (key === 'seed') set.seed = Math.max(0, Math.round(Number(input.value) || 0));
    else set[key] = Number(input.value);
    v.set = fullSet(set); saveCast();
    if (key === 'split' || key === 'language') { renderCast(); return; }
    var card = input.closest('.cast-voice'), lab = card.querySelector('[data-cs-val="' + key + '"]');
    if (lab) lab.textContent = labelFor(key, v.set);
    refreshCard(card, v.set);
  }
  function refreshCard(card, set) {
    card.querySelector('.cs-sum').textContent = setSummary(set);
    var rb = card.querySelector('[data-cs-reset]'); if (rb) rb.disabled = isDefaultSet(set);
    card.querySelectorAll('[data-cs-preset]').forEach(function (b) { b.classList.toggle('on', presetOn(set, V.presets()[Number(b.getAttribute('data-cs-preset'))])); });
  }
  function applyCharPreset(id, i) {
    var p = V.presets()[i]; if (!p) return;
    var v = charEntry(id), set = fullSet(v.set);
    Object.keys(p[1]).forEach(function (k) { set[k] = p[1][k]; });
    v.set = fullSet(set); saveCast(); renderCast();
  }

  function renderCast() {
    var s = story(), host = $('castRows');
    if (!s) { host.innerHTML = '<p class="muted small">Pick a story first.</p>'; return; }
    var ids = speakersUsed();
    if (!ids.length) { host.innerHTML = '<p class="muted small">This story has no spoken lines yet.</p>'; return; }
    var L = lib();
    host.innerHTML = ids.map(function (id) {
      var c = who(s, id), v = voiceFor(id), problem = voiceProblem(v);
      var n = lineSegs().filter(function (g) { return g.speaker === id; }).reduce(function (t, g) { return t + g.lines; }, 0);
      var options = L ? L.optionsHtml(v.key) : (V.voices() || []).map(function (x) { var k = 'builtin:' + x.filename; return '<option value="' + YB.esc(k) + '"' + (k === v.key ? ' selected' : '') + '>' + YB.esc(x.display_name) + '</option>'; }).join('');
      return '<div class="cast-voice" style="--c:' + YB.esc(c.color || '#1e7bff') + '">' +
        '<div class="cv-head"><span class="cv-name">' + YB.esc(c.name) + '</span><span class="cv-meta">' + n + ' line' + (n === 1 ? '' : 's') + '</span></div>' +
        '<select data-cv-voice="' + YB.esc(id) + '" aria-label="Voice for ' + YB.esc(c.name) + '"' + (st.run || st.preparing ? ' disabled' : '') + '>' + (options || '<option value="">Loading voices…</option>') + '</select>' +
        (problem && v.key ? '<div class="cv-warn">' + YB.esc(problem) + '</div>' : '') +
        importHtml(id, c.name) +
        settingsHtml(id, c.name, v) + '</div>';
    }).join('');
  }

  // Per-character "Import a voice": choose file → Import (saved to My Voices on
  // this device and picked for this character). Optional share with everyone.
  var upNotes = {};    // charId → { text, level }
  var picked = {};     // charId → File chosen, not imported yet
  var openImport = {}; // charId → import row open
  var shareFor = {};   // charId → share checkbox
  function sizeLabel(n) { return n < 1048576 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
  function importHtml(id, name) {
    var cid = YB.esc(id);
    if (!openImport[id]) return '<button type="button" class="cv-import-toggle" data-cv-import-open="' + cid + '">➕ Import a voice for ' + YB.esc(name) + '</button>';
    var off = !!st.run || !!importing[id], note = upNotes[id], f = picked[id];
    return '<div class="cv-upload">' +
      '<div class="cv-up-row">' +
      '<label class="btn btn-ghost btn-xs cv-pick' + (off ? ' is-disabled' : '') + '">📁 Choose file' +
      '<input class="cv-file-input" type="file" accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg" data-cv-file="' + cid + '" aria-label="Choose a voice clip for ' + YB.esc(name) + '"' + (off ? ' disabled' : '') + '></label>' +
      '<button type="button" class="btn btn-xs cv-send" data-cv-upload="' + cid + '" aria-label="Import voice for ' + YB.esc(name) + '"' + (off || !f ? ' disabled' : '') + '>⬆️ Import</button>' +
      '<button type="button" class="btn btn-ghost btn-xs" data-cv-import-close="' + cid + '" aria-label="Close import">✕</button>' +
      '</div>' +
      '<div class="cv-file-name">Selected: <b>' + (f ? YB.esc(f.name) + ' (' + sizeLabel(f.size) + ')' : 'None') + '</b></div>' +
      '<label class="cv-share"><input type="checkbox" data-cv-share="' + cid + '"' + (shareFor[id] ? ' checked' : '') + (off ? ' disabled' : '') + '> 🌐 Share with everyone — it\'s my voice or I have permission</label>' +
      (note ? '<div class="cv-up-note" data-level="' + YB.esc(note.level) + '">' + YB.esc(note.text) + '</div>' : '') +
      '</div>';
  }

  function setUpNote(id, text, level) { upNotes[id] = { text: text, level: level || '' }; renderCast(); V.updateControls(); }

  function pickFor(id, file) {
    if (!file) return;
    picked[id] = file;
    setUpNote(id, 'Ready — tap Import. Off-share voices stay private on this device.', '');
    V.clipLength(file).then(function (r) {
      if (picked[id] !== file || !r.text) return;
      setUpNote(id, 'Ready — tap Import. ' + r.text, r.level === 'warn' ? 'warn' : '');
    });
  }

  var importing = {};
  function importFor(id, file) {
    var L = lib();
    if (!file || st.run || !L || importing[id]) return;
    var share = !!shareFor[id];
    importing[id] = true;
    setUpNote(id, 'Saving "' + file.name + '" to My Voices…', 'busy');
    L.importVoice(file, '', share).then(function (res) {
      importing[id] = false;
      var map = castMap[st.storyId] || (castMap[st.storyId] = {});
      map[id] = Object.assign(map[id] || {}, { key: res.key });     // this character now uses the new voice
      saveCast();
      if (picked[id] === file) delete picked[id];
      shareFor[id] = false;
      setUpNote(id, '✓ Imported "' + res.voice.name + '" to My Voices and picked it.' + (res.length.text ? '  ' + res.length.text : ''), res.length.level === 'warn' ? 'warn' : 'ok');
      if (share) L.shareMine(res.voice.id);
      renderAll();
    }, function (err) {
      importing[id] = false;
      setUpNote(id, err.message, 'error');
    });
  }

  /* ---------- Story picker + line list ---------- */
  function renderStoryPicker() {
    var stories = V.storiesList(), sel = $('storySelect');
    if (!stories.length) {
      sel.innerHTML = '<option value="">No stories yet — write one in Story Studio</option>';
      st.storyId = ''; return;
    }
    var want = st.storyId || V.pendingStory() || YB.store.get('voiceStorySel', '');
    if (!stories.some(function (s) { return s.id === want; })) want = stories[0].id;
    sel.innerHTML = stories.map(function (s) { return '<option value="' + YB.esc(s.id) + '">' + YB.esc(s.title || 'Untitled') + '</option>'; }).join('');
    sel.value = want; st.storyId = want;
  }

  function resetRunData() {
    st.segs.forEach(function (g) { if (g.url) URL.revokeObjectURL(g.url); });
  }

  function rebuild() {
    if (st.run) return;               // never reshuffle lines mid-run
    resetRunData();
    st.segs = buildSegments();
    adoptSaved();
    renderAll();
  }

  /* ---------- Saved run (survives reloads and closing the app) ---------- */
  function clipKey(i) { return 'clip:' + st.runId + ':' + i; }
  function signature(segs) {
    var t = segs.map(function (g) { return g.type + '|' + (g.speaker || '') + '|' + g.text; }).join('\n'), h = 5381;
    for (var i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0;
    return t.length + ':' + h.toString(36);
  }
  function errLite(e) { return e ? { kind: e.kind || 'tts', message: e.message || String(e), raw: e.raw } : null; }

  function saveRun(state) {
    YB.store.set(RUN_KEY, {
      state: state || (st.run ? 'running' : 'stopped'), runId: st.runId, storyId: st.storyId, backend: V.backend(),
      startedAt: st.run ? st.run.startedAt : Date.now(), sig: signature(st.segs),
      segs: st.segs.map(function (g) {
        return g.type === 'scene' ? { type: 'scene', text: g.text }
          : { type: 'line', speaker: g.speaker, text: g.text, lines: g.lines, status: g.status, jobId: g.jobId || null, voice: g.voice || null, error: errLite(g.error), handedAt: g.handedAt || 0 };
      })
    });
  }

  // Same story, same lines as a finished/stopped run → show its clips and
  // failed lines again (so Retry failed lines still works after a reload).
  function adoptSaved() {
    var rec = YB.store.get(RUN_KEY, null), segs = st.segs;
    if (!rec || rec.state === 'running' || rec.storyId !== st.storyId || !rec.runId || rec.sig !== signature(segs)) return;
    st.runId = rec.runId;
    var keep = [];
    rec.segs.forEach(function (r, i) {
      var g = segs[i]; if (!g || g.type !== 'line') return;
      if (r.status === 'failed') { g.status = 'failed'; g.error = r.error; g.voice = r.voice; }
      else if (r.status === 'done') keep.push(i);
    });
    if (!keep.length) return;
    Promise.all(keep.map(function (i) { return V.db.get(clipKey(i)); })).then(function (blobs) {
      if (st.segs !== segs || st.run) return;
      keep.forEach(function (i, k) {
        if (!blobs[k]) return;
        var g = segs[i]; g.blob = blobs[k]; g.url = URL.createObjectURL(blobs[k]); g.status = 'done';
      });
      renderSegments(); updateRetry();
    });
  }

  // Called by voice.js once the backend address is known. Re-attaches to a
  // run that was in progress when the page/app closed.
  function resume(backend) {
    var rec = YB.store.get(RUN_KEY, null);
    if (!rec || rec.state !== 'running' || st.run) return false;
    var storyOk = V.storiesList().some(function (s) { return s.id === rec.storyId; });
    if (V.normalizeUrl(rec.backend) !== backend || !storyOk || !Array.isArray(rec.segs)) {
      // New Colab session (old jobs are gone) or the story was deleted: keep finished clips, stop the run.
      rec.state = 'stopped';
      (rec.segs || []).forEach(function (r) { if (r.type === 'line' && r.status !== 'done' && r.status !== 'failed') { r.status = 'idle'; r.jobId = null; } });
      YB.store.set(RUN_KEY, rec);
      if (st.active && st.storyId === rec.storyId) rebuild();
      return false;
    }
    if (!V.begin('Generating', rec.startedAt)) return false;
    st.storyId = rec.storyId; st.runId = rec.runId;
    YB.store.set('voiceStorySel', rec.storyId);
    resetRunData();
    st.segs = rec.segs.map(function (r) {
      return r.type === 'scene' ? { type: 'scene', text: r.text }
        : { type: 'line', speaker: r.speaker, text: r.text, lines: r.lines || 1, status: r.status === 'fetching' ? 'running' : (r.status || 'idle'), jobId: r.jobId || null, voice: r.voice, error: r.error, fails: 0, handedAt: r.handedAt || 0 };
    });
    var run = st.run = { token: Date.now(), queue: [], inflight: [], timer: null, total: lineSegs().length, posting: false, hold: 0, cycle: 0, startedAt: rec.startedAt || Date.now(), resumed: true };
    if (!st.active) setActive(true); else { renderStoryPicker(); }
    renderAll();
    V.progress('Generating', 'Picking up your story where it left off…', 'Checking the lines that were sent to the server.');
    var segs = st.segs;
    var wanted = segs.map(function (g, i) { return g.type === 'line' && g.status === 'done' ? V.db.get(clipKey(i)) : Promise.resolve(null); });
    Promise.all(wanted).then(function (blobs) {
      if (st.run !== run) return;
      segs.forEach(function (g, i) {
        if (g.type !== 'line' || g.status === 'failed') return;
        if (g.status === 'done' && blobs[i]) { g.blob = blobs[i]; g.url = URL.createObjectURL(blobs[i]); return; }
        if (!g.voice || !g.voice.id) { g.status = 'failed'; g.error = V.makeErr('validation', 'This line lost its voice — press Retry failed lines.'); return; }
        if (g.jobId) { g.status = g.status === 'queued' ? 'queued' : 'running'; run.inflight.push(i); }
        else if (g.handedAt) { g.status = 'queued'; run.inflight.push(i); }   // job ID comes from the worker (checked on the next poll)
        else { g.status = 'idle'; run.queue.push(i); }
      });
      saveRun();
      renderSegments(); progress();
      clearTimeout(run.timer);
      run.timer = setTimeout(pollAll, 300);
    });
    return true;
  }

  function renderStats() {
    var lines = lineSegs(), s = story();
    if (!s) { $('storyStats').textContent = ''; return; }
    var spoken = lines.reduce(function (t, g) { return t + g.lines; }, 0);
    var words = lines.reduce(function (t, g) { return t + (g.text.replace(/\[[^\]]*\]/g, ' ').match(/[\w'’-]+/g) || []).length; }, 0);
    $('storyStats').textContent = spoken + ' spoken line' + (spoken === 1 ? '' : 's') + ' → ' + lines.length + ' job' + (lines.length === 1 ? '' : 's') +
      ' · ' + speakersUsed().length + ' voice' + (speakersUsed().length === 1 ? '' : 's') + ' · about ' + mmss((words / 150) * 60) + ' of speech';
  }

  var STATUS_LABEL = { idle: 'Waiting', queued: 'Queued', running: 'Generating', fetching: 'Downloading', done: 'Done', failed: 'Failed' };
  function statusLabel(s) { return STATUS_LABEL[s] || 'Working'; }

  function renderSegments() {
    var s = story(), n = 0;
    if (!st.segs.length) { $('storySegments').innerHTML = '<li class="scene">' + (s ? 'No spoken lines in this story yet.' : 'Choose a story.') + '</li>'; return; }
    $('storySegments').innerHTML = st.segs.map(function (g, i) {
      if (g.type === 'scene') return '<li class="scene">— ' + YB.esc(g.text) + ' —</li>';
      n++;
      var c = who(s, g.speaker), status = g.status || 'idle';
      var actions = '', play = '';
      if (g.status === 'done' && g.url) {
        // Small play/pause right next to the name — works while other lines are still generating.
        play = takes() ? takes().player.button(lineKey(i), (c.name || 'Narrator') + ', line ' + n, 'play-btn-sm').replace('<button ', '<button data-seg-play="' + i + '" ')
          : '<button type="button" class="play-btn play-btn-sm" data-seg-play="' + i + '" aria-label="Play line ' + n + '">▶</button>';
        actions = '<div class="seg-actions"><a href="' + g.url + '" download="' + YB.esc(fileBase() + '-line-' + n + '-' + slug(c.name)) + '.wav">⬇ Clip</a></div>';
      } else if (g.status === 'failed' && g.error) {
        actions = '<div class="seg-actions"><span class="small" style="color:#fecaca">' + YB.esc(g.error.message) + '</span></div>';
      }
      return '<li style="--c:' + YB.esc(c.color || '#1e7bff') + '" data-i="' + i + '"><span class="num">' + n + '</span>' +
        '<div><div class="who">' + play + '<span class="who-name">' + YB.esc(c.name) + '</span>' + (g.lines > 1 ? ' <span class="muted small">(' + g.lines + ' lines)</span>' : '') + '</div>' +
        '<div class="say">' + YB.esc(g.text.length > 220 ? g.text.slice(0, 217) + '…' : g.text) + '</div>' + actions + '</div>' +
        '<span class="st" data-s="' + status + '">' + statusLabel(status) + '</span></li>';
    }).join('');
    if (takes()) takes().player.sync();
  }

  function renderAll() {
    renderStats(); renderCast(); renderSegments(); updateRetry(); V.updateControls(); renderSummary();
    if (!st.run) { var p = problems(); $('storyRunNote').textContent = p.length ? '⚠️ ' + p[0] : ''; }
  }

  function summary() {
    var s = story();
    return s ? 'Story: ' + (s.title || 'Untitled') + ' · ' + speakersUsed().length + ' voice' + (speakersUsed().length === 1 ? '' : 's') + ' · WAV' : 'Story mode — choose a story';
  }
  function renderSummary() { var el = $('genSummary'); if (el && st.active) el.textContent = summary(); }

  function slug(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story'; }
  function fileBase() { var s = story(); return 'youtube-blue-story-' + slug(s && s.title); }

  function updateRetry() {
    var failed = lineSegs().some(function (g) { return g.status === 'failed'; });
    $('storyRetryBtn').hidden = !failed || !!st.run;
    $('storyRetryBtn').disabled = V.remoteBusy();
  }

  /* ---------- Mode switch ---------- */
  function setActive(on) {
    st.active = !!on;
    YB.store.set('voiceGenMode', st.active ? 'story' : 'single');
    $('genModeSeg').querySelectorAll('[data-gen]').forEach(function (b) {
      var sel = (b.getAttribute('data-gen') === 'story') === st.active;
      b.classList.toggle('on', sel); b.setAttribute('aria-checked', sel ? 'true' : 'false');
    });
    $('scriptCard').hidden = st.active;
    $('voiceCard').hidden = st.active;
    $('storyCard').hidden = !st.active;
    $('castCard').hidden = !st.active;
    $('settingsCard').hidden = st.active;          // Story mode: every setting lives on the character
    $('genModeNote').textContent = st.active
      ? 'Voices a Story Studio script with a voice per character, in script order, and stitches it into one WAV track.'
      : 'Type or paste a script and narrate it with one voice.';
    if (st.active) { renderStoryPicker(); rebuild(); V.refreshListsIfStale('both'); }
    V.updateControls();
    if (!st.active) { var el = $('genSummary'); if (el) el.textContent = ''; window.dispatchEvent(new Event('yb-voice-summary')); }
  }

  /* ---------- Validation ---------- */
  function problems() {
    var out = [];
    if (!story()) out.push('Choose a story.');
    if (!lineSegs().length) out.push('This story has no spoken lines.');
    speakersUsed().forEach(function (id) {
      var p = voiceProblem(voiceFor(id));
      if (p) out.push(who(story(), id).name + ': ' + p);
    });
    return out;
  }

  /* ---------- Run ---------- */
  // Same builder as single scripts (model-aware fields, exactly one voice
  // field); clips are always WAV so they can be stitched losslessly.
  // Each line uses its character's own settings (snapshotted when the run starts).
  function payload(g) {
    return V.buildPayload(g.text, g.voice, Object.assign(setOverrides(g.voice && g.voice.set), { output_format: 'wav' }));
  }

  function generate(onlyFailed) {
    if (st.run || st.preparing || V.isBusy()) return;
    if (V.remoteBusy()) { YB.toast('Another user is generating — this unlocks when the server is free'); return; }
    var box = V.errorBox();
    V.showNotice(box, null);
    if (!V.backend()) { V.showNotice(box, V.makeErr('offline', 'Backend is not connected.')); return; }
    if (!onlyFailed) rebuild();
    var bad = problems();
    if (bad.length) { V.showNotice(box, V.makeErr('validation', bad[0]), 'warn'); return; }

    // Get every voice ready on the server first (library voices are uploaded
    // once per server session); built-in voices need nothing. This runs inside
    // the generation, so the progress bar, timer and Cancel all work during it.
    var used = [], L = lib(), resolved = {};
    speakersUsed().forEach(function (id) { var k = voiceFor(id).key; if (used.indexOf(k) === -1) used.push(k); });
    var needUpload = used.filter(function (k) { return L && L.groupOf(k) !== 'builtin'; }).length;
    if (!V.begin('Preparing')) return;
    var token = ++prepToken;
    st.preparing = true; renderCast(); V.updateControls();
    V.progress('Generating', needUpload ? 'Getting voices ready…' : 'Starting…', needUpload ? 'Sending ' + needUpload + ' voice' + (needUpload === 1 ? '' : 's') + ' to the server so they can be cloned.' : 'Sending the first lines to the server.');
    var chain = Promise.resolve(), n = 0;
    used.forEach(function (k) {
      chain = chain.then(function () {
        if (token !== prepToken) return;
        var label = L ? L.label(k) : k;
        if (L && L.groupOf(k) !== 'builtin') { n++; V.progress('Generating', 'Getting voices ready… (' + n + ' of ' + needUpload + ')', label); }
        return (L ? L.resolve(k, function (msg) { if (token === prepToken) V.progress('Generating', 'Getting voices ready… (' + n + ' of ' + needUpload + ')', msg); }, true)
          : Promise.resolve({ mode: 'predefined', id: k.replace(/^builtin:/, '') }))
          .then(function (r) { resolved[k] = r; });
      });
    });
    chain.then(function () {
      if (token !== prepToken) return;          // cancelled meanwhile
      st.preparing = false;
      start(onlyFailed, resolved, true);
      renderCast(); V.updateControls();
    }, function (err) {
      if (token !== prepToken) return;
      st.preparing = false;
      V.end();
      renderCast(); V.updateControls();
      V.showNotice(box, V.networkError(err), err.kind === 'validation' || err.kind === 'voice-missing' ? 'warn' : undefined);
    });
  }

  var prepToken = 0;
  function start(onlyFailed, resolved, begun) {
    var queue = [];
    st.segs.forEach(function (g, i) {
      if (g.type !== 'line') return;
      if (onlyFailed && g.status !== 'failed') return;
      if (!onlyFailed) { if (g.url) URL.revokeObjectURL(g.url); g.url = null; g.blob = null; }
      if (g.status === 'done' && onlyFailed) return;
      var v = voiceFor(g.speaker);
      g.voice = Object.assign({}, resolved[v.key], { key: v.key, set: v.set ? JSON.parse(JSON.stringify(v.set)) : undefined });   // { mode, id, key, set }
      g.status = 'idle'; g.error = null; g.jobId = null; g.fails = 0; g.handedAt = 0;
      queue.push(i);
    });
    if (!queue.length) { if (begun) V.end(); return; }
    if (!begun && !V.begin('Queued')) return;
    if (!onlyFailed || !st.runId) {
      var keepDone = onlyFailed ? st.segs.map(function (g, i) { return g.status === 'done' && g.blob ? i : -1; }).filter(function (i) { return i >= 0; }) : [];
      if (takes()) takes().player.release('line:');
      st.runId = Date.now().toString(36);
      V.db.delPrefix('sent:');
      V.db.delPrefix('clip:').then(function () { keepDone.forEach(function (i) { V.db.put(clipKey(i), st.segs[i].blob); }); });
    }
    st.run = { token: Date.now(), queue: queue, inflight: [], timer: null, total: lineSegs().length, posting: false, hold: 0, cycle: 0, startedAt: Date.now() };
    YB.store.set('voiceStorySel', st.storyId);
    saveRun();
    renderSegments(); updateRetry();
    progress();
    pump();
  }

  function progress() {
    var lines = lineSegs(), done = lines.filter(function (g) { return g.status === 'done'; }).length;
    var running = lines.filter(function (g) { return g.status === 'running' || g.status === 'fetching'; });
    var s = story();
    var title = done === lines.length ? 'Processing audio…' : 'Generating speech… ' + done + ' of ' + lines.length + ' lines done';
    if (!st.run) return;
    var detail = running.length
      ? 'Now voicing: ' + running.map(function (g) { return who(s, g.speaker).name || 'Narrator'; }).join(', ') + '. ' + st.run.inflight.length + ' job' + (st.run.inflight.length === 1 ? '' : 's') + ' in flight; Chatterbox works through them on CPU.'
      : st.run.inflight.length ? 'Jobs queued on the server — waiting for Chatterbox to start.' : 'Sending the next lines…';
    V.progress(running.length ? 'Generating' : 'Queued', title, detail);
  }

  // While the page is open: keep up to opts.parallel (1–3) jobs on the server,
  // sent one POST at a time so the server queue stays in script order.
  function limit() { return Math.max(1, Math.min(3, Number(opts.parallel) || 2)); }

  // Page hidden / closing / swiped away: hand every remaining line to the
  // server now so the story finishes in the background. keepalive lets the
  // requests complete even if the page is torn down.
  function flushAll() {
    var run = st.run; if (!run || run.finishing || !run.queue.length) return;
    var idx = run.queue.splice(0), sw = swReg && swReg.active, now = Date.now();
    if (sw) {
      idx.forEach(function (i) { var g = st.segs[i]; g.status = 'queued'; g.jobId = null; g.handedAt = now; run.inflight.push(i); });
      saveRun();                       // saved first: a reopened page knows these went to the worker
      try {
        sw.postMessage({ type: 'yb-submit-jobs', url: V.route('jobs'), runId: st.runId,
          jobs: idx.map(function (i) { return { i: i, body: payload(st.segs[i]) }; }) });
        return;
      } catch (err) {
        console.warn('[Voice Studio] service worker hand-off failed', err);
        run.inflight = run.inflight.filter(function (x) { return idx.indexOf(x) === -1; });
        idx.forEach(function (i) { st.segs[i].handedAt = 0; });
      }
    }
    idx.forEach(function (i) { submit(i, true); });
    saveRun();
  }

  // The worker reports each line it sent (also saved in IndexedDB as "sent:<runId>:<i>").
  function applySent(run, i, rec) {
    var g = st.segs[i];
    if (!g || g.jobId || !g.handedAt || !rec) return;
    g.handedAt = 0;
    if (rec.job_id) { g.jobId = rec.job_id; g.status = rec.status === 'running' ? 'running' : 'queued'; g.fails = 0; }
    else if (rec.retry) {
      run.inflight = run.inflight.filter(function (x) { return x !== i; });
      g.status = 'idle'; run.queue.push(i); run.queue.sort(function (a, b) { return a - b; });
    } else { fail(i, V.makeErr('tts', 'The server rejected this line: ' + (rec.error || 'unknown error'), { raw: rec.error })); return; }
    saveRun(); renderSegments();
  }

  function onSwMessage(e) {
    var d = e.data || {}, run = st.run;
    if (d.type !== 'yb-job-sent' || !run || d.runId !== st.runId) return;
    applySent(run, d.i, d.rec);
    if (st.run === run) { progress(); pump(); }
  }

  // Lines handed to the worker but with no job ID yet: look in IndexedDB; if
  // nothing has turned up after a while (worker stopped), send them again.
  function checkHanded(run) {
    var waiting = run.inflight.filter(function (i) { var g = st.segs[i]; return g.handedAt && !g.jobId; });
    if (!waiting.length) return Promise.resolve();
    return Promise.all(waiting.map(function (i) { return V.db.get('sent:' + st.runId + ':' + i); })).then(function (recs) {
      if (st.run !== run) return;
      waiting.forEach(function (i, k) {
        var g = st.segs[i];
        if (recs[k]) applySent(run, i, recs[k]);
        else if (g.handedAt && Date.now() - g.handedAt > HANDOFF_WAIT_MS) applySent(run, i, { retry: true });
      });
    });
  }
  function pump() {
    var run = st.run; if (!run || run.finishing) return;
    if (!run.posting && Date.now() >= run.hold && run.inflight.length < limit() && run.queue.length) submit(run.queue.shift());
    if (!run.inflight.length && !run.queue.length) { finish(); return; }
    schedulePoll();
  }

  function submit(i, keep) {
    var run = st.run, g = st.segs[i];
    run.inflight.push(i);
    run.posting = true;
    run.sending = (run.sending || 0) + 1;
    g.status = 'queued';
    renderSegments(); progress();
    V.call(V.route('jobs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(g)), keepalive: !!keep }, V.SHORT_TIMEOUT_MS)
      .then(function (res) {
        run.sending--;
        if (!res.ok) return V.httpError(res, 'job').then(function (e) { throw e; });
        return V.readJson(res);
      }, function (err) { run.sending--; throw err; })
      .then(function (data) {
        if (st.run !== run) return;
        if (!data || !data.job_id) throw V.makeErr('tts', 'Backend did not return a job ID.');
        g.jobId = data.job_id; g.fails = 0;
        if (data.status === 'running') g.status = 'running';
        run.posting = false;
        saveRun();
        renderSegments(); progress();
        pump();
      })
      .catch(function (err) {
        if (st.run !== run) return;
        run.posting = false;
        err = V.networkError(err);
        // Tunnel hiccup or a busy server: put the line back and try again shortly.
        var transient = err.status === 429 || /offline|timeout|unavailable|tunnel|cf-timeout/.test(err.kind || '');
        if (transient && ++g.fails < 6) {
          run.inflight = run.inflight.filter(function (x) { return x !== i; });
          g.status = 'idle'; run.queue.unshift(i); run.hold = Date.now() + 5000;
          renderSegments(); schedulePoll();
          return;
        }
        fail(i, err);
      });
  }

  function schedulePoll() {
    var run = st.run; if (!run) return;
    clearTimeout(run.timer);
    run.timer = setTimeout(pollAll, V.JOB_POLL_MS);
  }

  // One status request per job in flight, every ~3 s.
  // With every line on the server, most are waiting in its queue: check them
  // in order and stop after two that are still queued (a full sweep every 5th time).
  function pollAll() {
    var run = st.run; if (!run || run.finishing) return;
    run.cycle++;
    var full = run.cycle % 5 === 0, queuedSeen = 0;
    var ids = run.inflight.filter(function (i) { return st.segs[i].status !== 'fetching'; }).sort(function (a, b) { return a - b; });
    var chain = checkHanded(run);
    ids.forEach(function (i) {
      chain = chain.then(function () {
        if (st.run !== run || (!full && queuedSeen >= 2) || !st.segs[i].jobId) return;
        return pollOne(run, i).then(function () { if (st.segs[i].status === 'queued') queuedSeen++; });
      });
    });
    chain.then(function () { if (st.run === run) { progress(); pump(); } });
  }

  function pollOne(run, i) {
    var g = st.segs[i];
    return V.call(V.jobRoute(g.jobId) + '?ts=' + Date.now(), {}, V.SHORT_TIMEOUT_MS)
      .then(function (res) {
        if (res.status === 404) return res.text().then(function (t) {
          if (/job not found/i.test(t)) throw V.makeErr('job-lost', 'The server no longer has this job.');
          throw Object.assign(V.makeErr('unavailable', 'Job status page not found.'), { transient: true });
        });
        if (!res.ok) return V.httpError(res, 'status').then(function (e) { e.transient = true; throw e; });
        return V.readJson(res);
      })
      .then(function (data) {
        if (st.run !== run) return;
        g.fails = 0;
        if (data.status === 'complete') { g.status = 'fetching'; return fetchAudio(run, i); }
        if (data.status === 'failed') { fail(i, V.jobFailure(data.error, g.voice && g.voice.mode)); return; }
        if (data.status === 'cancelled' || data.status === 'canceled') { fail(i, V.makeErr('http', 'The server cancelled this line.')); return; }
        g.status = data.status === 'queued' ? 'queued' : 'running';
        renderSegments();
      })
      .catch(function (err) {
        if (st.run !== run) return;
        err = V.networkError(err);
        var transient = err.transient || /offline|timeout|unavailable|tunnel/.test(err.kind);
        if (!transient || ++g.fails >= V.JOB_MAX_FAILS) fail(i, transient ? V.makeErr('lost', 'Lost contact with the job server while waiting for this line.') : err);
      });
  }

  function fetchAudio(run, i) {
    var g = st.segs[i];
    return V.call(V.jobRoute(g.jobId, true), {}, V.AUDIO_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) return V.httpError(res, 'audio').then(function (e) { throw e; });
        return res.blob();
      })
      .then(function (blob) {
        if (st.run !== run) return;
        if (!blob || blob.size < 100) throw V.makeErr('tts', 'The server returned an empty audio file.');
        // Each line is levelled on its own, so every character comes out at the same volume.
        return V.levelBlob(blob, 'wav').then(function (r) {
          if (st.run !== run) return;
          g.blob = r.blob; g.url = URL.createObjectURL(r.blob); g.status = 'done'; g.gainDb = r.gainDb;
          V.db.put(clipKey(i), r.blob);
          saveTake(i);
          done(i);
        });
      })
      .catch(function (err) {
        if (st.run !== run) return;
        if (++g.fails < 4) { g.status = 'running'; return; }   // retried on the next poll
        fail(i, V.networkError(err));
      });
  }

  // Every finished line goes to "Your audio" right away (kept until Clear all).
  function lineNumber(i) { var n = 0; for (var k = 0; k <= i; k++) if (st.segs[k] && st.segs[k].type === 'line') n++; return n; }
  function saveTake(i) {
    var g = st.segs[i], s = story(); if (!takes() || !g || !g.blob) return;
    var n = lineNumber(i), name = who(s, g.speaker).name || 'Narrator';
    takes().add({ id: st.runId + '-' + i, kind: 'line', group: st.runId, groupTitle: (s && s.title) || 'Story', idx: n,
      title: 'Line ' + n + ' · ' + name, text: g.text, blob: g.blob, ext: 'wav' });
  }

  function done(i) {
    var run = st.run;
    run.inflight = run.inflight.filter(function (x) { return x !== i; });
    saveRun();
    renderSegments();
    pump();
  }

  function fail(i, err) {
    var run = st.run, g = st.segs[i];
    if (err && err.kind === 'ref-missing' && g.voice && g.voice.key && lib()) lib().forget(g.voice.key);
    g.status = 'failed'; g.error = err;
    if (run) run.inflight = run.inflight.filter(function (x) { return x !== i; });
    saveRun();
    renderSegments();
    if (run) pump();
  }

  function finish() {
    var run = st.run; if (!run || run.finishing) return;
    run.finishing = true;
    clearTimeout(run.timer);
    var lines = lineSegs(), failed = lines.filter(function (g) { return g.status === 'failed'; });
    if (failed.length) {
      st.run = null;
      saveRun('stopped');
      V.end();
      var first = failed[0].error || V.makeErr('tts', 'A line failed.');
      var who1 = who(story(), failed[0].speaker).name;
      var e = V.makeErr(first.kind, failed.length + ' of ' + lines.length + ' lines failed. First: ' + who1 + ' — ' + first.message, { raw: first.raw });
      V.showNotice(V.errorBox(), e);
      $('storyRunNote').textContent = 'Finished lines are kept. Fix the voice or text, then press Retry failed lines.';
      updateRetry(); V.updateControls();
      return;
    }
    V.progress('Generating', 'Processing audio…', 'Stitching ' + lines.length + ' clips into one track in story order.');
    stitch().then(function (wav) {
      st.run = null;
      saveRun('finished');
      V.end();
      V.showAudio(wav, 'wav', fileBase(), V.levelOn() ? 'every line levelled' : '');
      if (takes()) takes().add({ id: st.runId + '-track', kind: 'story', group: st.runId, groupTitle: (story() && story().title) || 'Story', idx: -1,
        title: 'Full story track', text: lines.length + ' lines in script order', blob: wav, ext: 'wav' });
      $('storyRunNote').textContent = 'Story track ready — ' + lines.length + ' lines in script order. Each line\'s clip can also be played or downloaded above.';
      YB.toast(run.resumed ? 'Your story finished in the background — audio ready' : 'Complete — story audio ready');
      updateRetry(); V.updateControls();
    }, function (err) {
      console.error('[Voice Studio] stitching failed', err);
      st.run = null;
      saveRun('stopped');
      V.end();
      V.showNotice(V.errorBox(), V.makeErr('tts', 'Couldn\'t combine the clips in this browser.', { raw: String(err && err.message || err) }));
      $('storyRunNote').textContent = 'Every line finished — download the clips individually above.';
      updateRetry(); V.updateControls();
    });
  }

  function cancel() {
    if (st.preparing) {
      prepToken++; st.preparing = false; V.end();
      var b = V.errorBox(); b.className = 'notice warn'; b.hidden = false;
      b.innerHTML = '<b>Stopped before any lines were sent.</b>Nothing is generating on the server.';
      renderCast(); V.updateControls();
      return;
    }
    var run = st.run; if (!run) return;
    clearTimeout(run.timer);
    var sent = run.inflight.filter(function (i) { return st.segs[i].jobId; }).length;
    run.inflight.concat(run.queue).forEach(function (i) { var g = st.segs[i]; if (g.status !== 'done') { g.status = 'idle'; g.jobId = null; g.handedAt = 0; } });
    st.run = null;
    saveRun('stopped');
    if (sent) V.noteOwnBackground();   // those jobs are ours, not another user's
    V.end();
    var box = V.errorBox();
    box.className = 'notice warn'; box.hidden = false;
    box.innerHTML = '<b>Stopped waiting for this generation.</b>' + (sent ? sent + ' job' + (sent === 1 ? '' : 's') + ' already sent will finish on the server in the background — the CPU stays busy until then. ' : '') + 'Finished lines are kept.';
    renderSegments(); updateRetry(); V.updateControls();
  }

  /* ---------- Stitching (browser-side, no libraries) ---------- */
  function decode(blob) {
    return blob.arrayBuffer().then(function (buf) {
      var Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      var ctx = new Ctx(1, 1, SAMPLE_RATE);   // decodes and resamples to 24 kHz
      return new Promise(function (resolve, reject) {
        var p = ctx.decodeAudioData(buf, resolve, reject);
        if (p && p.then) p.then(resolve, reject);
      });
    });
  }

  function mono(buffer) {
    var n = buffer.length, out = new Float32Array(n), ch = buffer.numberOfChannels;
    for (var c = 0; c < ch; c++) { var d = buffer.getChannelData(c); for (var i = 0; i < n; i++) out[i] += d[i] / ch; }
    return out;
  }

  // Trims near-silent edges so the chosen pauses are what you hear.
  function trim(data) {
    var th = 0.004, s = 0, e = data.length - 1, pad = Math.round(SAMPLE_RATE * 0.03);
    while (s < e && Math.abs(data[s]) < th) s++;
    while (e > s && Math.abs(data[e]) < th) e--;
    return data.subarray(Math.max(0, s - pad), Math.min(data.length, e + pad + 1));
  }

  function stitch() {
    var order = [];
    st.segs.forEach(function (g) { order.push(g); });
    var decodes = order.map(function (g) { return g.type === 'line' ? decode(g.blob) : Promise.resolve(null); });
    return Promise.all(decodes).then(function (buffers) {
      var parts = [], gap = Math.round(SAMPLE_RATE * Number(opts.pause) / 1000), sceneGap = Math.round(SAMPLE_RATE * Number(opts.scenePause) / 1000);
      var pendingScene = false, first = true;
      order.forEach(function (g, i) {
        if (g.type === 'scene') { pendingScene = true; return; }
        if (!first) parts.push(new Float32Array(gap + (pendingScene ? sceneGap : 0)));
        parts.push(trim(mono(buffers[i])));
        first = false; pendingScene = false;
      });
      parts.push(new Float32Array(Math.round(SAMPLE_RATE * 0.3)));
      return encodeWav(parts, SAMPLE_RATE);
    });
  }

  function encodeWav(parts, rate) {
    var total = parts.reduce(function (t, p) { return t + p.length; }, 0);
    var buf = new ArrayBuffer(44 + total * 2), dv = new DataView(buf);
    function str(o, t) { for (var i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); }
    str(0, 'RIFF'); dv.setUint32(4, 36 + total * 2, true); str(8, 'WAVE');
    str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, total * 2, true);
    var o = 44;
    parts.forEach(function (p) {
      for (var i = 0; i < p.length; i++, o += 2) { var v = Math.max(-1, Math.min(1, p[i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
    });
    return new Blob([buf], { type: 'audio/wav' });
  }

  /* ---------- Events ---------- */
  function bind() {
    $('genModeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-gen]'); if (!b || V.isBusy()) return;
      setActive(b.getAttribute('data-gen') === 'story');
    });
    $('storySelect').addEventListener('change', function () { st.storyId = this.value; YB.store.set('voiceStorySel', st.storyId); rebuild(); });
    $('storySelect').addEventListener('focus', function () {
      if (st.run) return;    // pick up stories edited in another tab
      var cur = st.storyId; renderStoryPicker(); if (st.storyId !== cur) rebuild();
    });
    $('storyPause').addEventListener('change', function () { opts.pause = Number(this.value); saveOpts(); });
    $('storyScenePause').addEventListener('change', function () { opts.scenePause = Number(this.value); saveOpts(); });
    $('storyParallel').addEventListener('change', function () { opts.parallel = Number(this.value) || 2; saveOpts(); });
    $('storyMerge').addEventListener('change', function () { opts.merge = this.checked; saveOpts(); rebuild(); });
    $('storyRetryBtn').addEventListener('click', function () { generate(true); });
    $('castRefreshBtn').addEventListener('click', function () {
      Promise.all([V.loadVoices(true), lib() ? lib().refresh(true) : null]).then(function () { renderCast(); V.updateControls(); YB.toast('Voice lists refreshed'); });
    });

    var castHost = $('castRows');
    castHost.addEventListener('change', function (e) {
      if (e.target.matches('[data-cs]')) { updateSetting(e.target); if (e.target.type === 'number') e.target.value = fullSet(charEntry(e.target.getAttribute('data-cs-char')).set).seed; return; }
      var up = e.target.getAttribute('data-cv-file');
      if (up) { var f = e.target.files && e.target.files[0]; e.target.value = ''; pickFor(up, f); return; }
      var sh = e.target.getAttribute('data-cv-share');
      if (sh) { shareFor[sh] = e.target.checked; return; }
      var v = e.target.getAttribute('data-cv-voice');
      if (!v) return;
      var map = castMap[st.storyId] || (castMap[st.storyId] = {});
      map[v] = Object.assign(map[v] || {}, { key: e.target.value });
      saveCast(); renderAll();
    });
    castHost.addEventListener('input', function (e) { if (e.target.matches('input[type=range][data-cs]')) updateSetting(e.target); });
    castHost.addEventListener('click', function (e) {
      var pr = e.target.closest('[data-cs-preset]');
      if (pr && !pr.disabled) { applyCharPreset(pr.getAttribute('data-cs-char'), Number(pr.getAttribute('data-cs-preset'))); return; }
      var t = e.target.closest('[data-cs-toggle]');
      if (t) { var cid = t.getAttribute('data-cs-toggle'); openSet[cid] = !openSet[cid]; renderCast(); return; }
      var rs = e.target.closest('[data-cs-reset]');
      if (rs && !rs.disabled) {
        var rid = rs.getAttribute('data-cs-reset'), rmap = castMap[st.storyId] || {};
        if (rmap[rid]) { delete rmap[rid].set; saveCast(); }
        renderCast(); return;
      }
      var io = e.target.closest('[data-cv-import-open]');
      if (io) { openImport[io.getAttribute('data-cv-import-open')] = true; renderCast(); return; }
      var ic = e.target.closest('[data-cv-import-close]');
      if (ic) { var xid = ic.getAttribute('data-cv-import-close'); openImport[xid] = false; delete picked[xid]; delete upNotes[xid]; renderCast(); return; }
      var b = e.target.closest('[data-cv-upload]'); if (!b || b.disabled) return;
      var id = b.getAttribute('data-cv-upload');
      importFor(id, picked[id]);
    });
    castHost.addEventListener('focusin', function (e) {
      if (e.target.matches('[data-cv-voice]')) { V.refreshListsIfStale('voices'); if (lib()) lib().refreshIfStale(); }
    });

    $('storySegments').addEventListener('click', function (e) {
      var b = e.target.closest('[data-seg-play]'); if (!b) return;
      var i = Number(b.getAttribute('data-seg-play')), g = st.segs[i];
      if (!g || !g.blob) return;
      if (takes()) takes().player.toggle(lineKey(i), function () { return g.blob; });
      else { var a = new Audio(g.url); a.play().catch(function () {}); }
    });

    // Leaving (app switcher, swipe away, tab closed): send every remaining line
    // so the server finishes the story without the page. Coming back: check now.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { flushAll(); return; }
      if (st.run && !st.run.finishing) { clearTimeout(st.run.timer); st.run.timer = setTimeout(pollAll, 200); }
    });
    window.addEventListener('pagehide', flushAll);
    window.addEventListener('yb-audio-cleared', function () {
      if (st.run || st.preparing) return;            // a running story keeps going; its lines arrive fresh
      st.segs.forEach(function (g) { if (g.type === 'line') { if (g.url) URL.revokeObjectURL(g.url); g.url = null; g.blob = null; if (g.status === 'done' || g.status === 'failed') { g.status = 'idle'; g.error = null; } } });
      V.db.delPrefix('clip:'); V.db.delPrefix('sent:');
      YB.store.remove(RUN_KEY);
      $('storyRunNote').textContent = '';
      renderAll();
    });
    // Desktop tab/window closing: send the rest now, and only if those sends are
    // still on their way, show the browser's "Leave site?" prompt so they land.
    window.addEventListener('beforeunload', function (e) {
      flushAll();
      if (st.run && st.run.sending > 0) { e.preventDefault(); e.returnValue = ''; }
    });
    document.addEventListener('freeze', flushAll);
  }

  function init() {
    $('storyPause').value = String(opts.pause);
    $('storyScenePause').value = String(opts.scenePause);
    $('storyParallel').value = String(opts.parallel);
    $('storyMerge').checked = !!opts.merge;
    bind();
    if (lib()) lib().onChange(function () { if (st.active && !st.run && !st.preparing) renderAll(); });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(function (r) { swReg = r; }, function () {});
      navigator.serviceWorker.addEventListener('message', onSwMessage);
    }
    V.registerStory({
      active: function () { return st.active; },
      running: function () { return !!st.run || !!st.preparing; },
      canGenerate: function () { return !st.run && !st.preparing && problems().length === 0; },
      generate: function () { generate(false); },
      cancel: cancel,
      summary: summary,
      listsChanged: function () { if (st.active && !st.run) renderAll(); else updateRetry(); },
      resume: resume,
      modelChanged: function () { if (st.active) renderCast(); }
    });
    setActive(st.active);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
