/* =========================================================
   Youtube Blue — voice-story.js
   Story mode for Voice Studio: voices a whole Story Studio script
   with a different voice per character, in script order.

   • Each character gets a built-in voice or a clone reference
     (saved per story under storage key "voiceCast").
   • Every spoken line (or a speaker's back-to-back lines) becomes one
     async job: POST /jobs → poll GET /jobs/{id} → GET /jobs/{id}/audio.
     Several jobs are in flight at once; results are kept by position.
   • When every line is done, the clips are decoded in the browser and
     stitched into one WAV in story order, with pauses between lines
     and at scene changes.
   Uses the shared core exposed by voice.js (window.YBVoice); never
   calls /tts.
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB, V = window.YBVoice;
  if (!YB || !V) return;

  var SAMPLE_RATE = 24000;                  // Chatterbox Turbo output rate
  var NARRATOR = { id: 'narrator', name: 'Narrator', color: '#7dd3fc' };
  var opts = Object.assign({ pause: 400, scenePause: 800, parallel: 2, merge: true }, YB.store.get('voiceStoryOpts', {}));
  var castMap = YB.store.get('voiceCast', {});          // { storyId: { charId: { mode, id } } }
  var st = {
    active: YB.store.get('voiceGenMode', 'single') === 'story',
    storyId: '',
    segs: [],        // [{ type:'scene'|'line', text, speaker, lines, status, jobId, blob, url, error, fails, mode, voice }]
    run: null        // active run { token, queue:[i], inflight:[i], timer }
  };
  var player = new Audio();

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
  function voiceFor(charId) {
    var m = castMap[st.storyId] || (castMap[st.storyId] = {});
    if (!m[charId]) {
      // Sensible start: narrator gets the single-mode voice, others get distinct built-in voices.
      var voices = V.voices() || [], used = Object.keys(m).map(function (k) { return m[k].id; });
      var pick = charId === 'narrator' && V.settings().voiceId ? V.settings().voiceId : '';
      if (!pick) { var free = voices.find(function (v) { return used.indexOf(v.filename) === -1; }); pick = free ? free.filename : (voices[0] && voices[0].filename) || ''; }
      if (pick) { m[charId] = { mode: 'predefined', id: pick }; saveCast(); }
      else return { mode: 'predefined', id: '' };
    }
    return m[charId];
  }

  // '' when usable, otherwise why not.
  function voiceProblem(v) {
    if (!v || !v.id) return 'Choose a voice.';
    if (v.mode === 'clone') {
      if (!V.cloneAvailable()) return 'Voice cloning isn\'t available on this job server.';
      var refs = V.refFiles();
      if (Array.isArray(refs) && refs.indexOf(v.id) === -1) return 'This reference isn\'t on the server right now — upload it again or pick another.';
    } else {
      var voices = V.voices() || [];
      if (voices.length && !voices.some(function (x) { return x.filename === v.id; })) return 'This voice isn\'t on the server — pick another.';
    }
    return '';
  }

  function renderCast() {
    var s = story(), host = $('castRows');
    if (!s) { host.innerHTML = '<p class="muted small">Pick a story first.</p>'; return; }
    var ids = speakersUsed();
    if (!ids.length) { host.innerHTML = '<p class="muted small">This story has no spoken lines yet.</p>'; return; }
    var voices = V.voices() || [], refs = V.refFiles(), cloneOk = V.cloneAvailable();
    host.innerHTML = ids.map(function (id) {
      var c = who(s, id), v = voiceFor(id), problem = voiceProblem(v);
      var n = lineSegs().filter(function (g) { return g.speaker === id; }).reduce(function (t, g) { return t + g.lines; }, 0);
      var options;
      if (v.mode === 'clone') {
        options = !cloneOk ? '<option value="">Not available on this server</option>'
          : !Array.isArray(refs) ? '<option value="' + YB.esc(v.id) + '">Loading references…</option>'
          : '<option value="">Choose a reference…</option>' + refs.map(function (f) { return '<option value="' + YB.esc(f) + '"' + (f === v.id ? ' selected' : '') + '>' + YB.esc(f) + '</option>'; }).join('');
      } else {
        options = !voices.length ? '<option value="' + YB.esc(v.id) + '">' + YB.esc(v.id || 'Loading voices…') + '</option>'
          : voices.map(function (x) { return '<option value="' + YB.esc(x.filename) + '"' + (x.filename === v.id ? ' selected' : '') + '>' + YB.esc(x.display_name) + '</option>'; }).join('');
      }
      return '<div class="cast-voice" style="--c:' + YB.esc(c.color || '#1e7bff') + '">' +
        '<div class="cv-head"><span class="cv-name">' + YB.esc(c.name) + '</span><span class="cv-meta">' + n + ' line' + (n === 1 ? '' : 's') + '</span></div>' +
        '<div class="cv-row">' +
        '<select data-cv-mode="' + YB.esc(id) + '" aria-label="Voice type for ' + YB.esc(c.name) + '"><option value="predefined"' + (v.mode === 'predefined' ? ' selected' : '') + '>Built-in voice</option><option value="clone"' + (v.mode === 'clone' ? ' selected' : '') + '>Clone</option></select>' +
        '<select data-cv-voice="' + YB.esc(id) + '" aria-label="Voice for ' + YB.esc(c.name) + '">' + options + '</select>' +
        '</div>' + (problem && v.id ? '<div class="cv-warn">' + YB.esc(problem) + '</div>' : '') +
        uploadHtml(id, c.name, cloneOk) + '</div>';
    }).join('');
  }

  // Per-character "Upload reference" — same upload + checks as the single-narrator clone section.
  var upNotes = {};   // charId → { text, level }
  function uploadHtml(id, name, cloneOk) {
    var busy = !!st.run || V.isBusy(), note = upNotes[id];
    return '<div class="cv-upload">' +
      '<label class="btn btn-ghost btn-sm cv-up-btn' + (busy || !cloneOk ? ' is-disabled' : '') + '">⬆️ Upload reference' +
      '<input type="file" accept=".wav,.mp3,audio/wav,audio/x-wav,audio/mpeg" data-cv-file="' + YB.esc(id) + '" aria-label="Upload a reference voice for ' + YB.esc(name) + '"' + (busy || !cloneOk ? ' disabled' : '') + ' hidden></label>' +
      (note ? '<span class="cv-up-note" data-level="' + YB.esc(note.level) + '">' + YB.esc(note.text) + '</span>' : '') +
      '</div>';
  }

  function setUpNote(id, text, level) { upNotes[id] = { text: text, level: level || '' }; renderCast(); V.updateControls(); }

  function uploadFor(id, file) {
    if (!file || st.run || V.isBusy()) return;
    var lenText = '';
    V.clipLength(file).then(function (r) {
      lenText = r.text || '';
      return V.sendReference(file, function (msg) { setUpNote(id, msg + (lenText ? '  ' + lenText : ''), 'busy'); });
    }).then(function (serverName) {
      var map = castMap[st.storyId] || (castMap[st.storyId] = {});
      map[id] = { mode: 'clone', id: serverName };     // this character now uses the new clone
      saveCast();
      setUpNote(id, '✓ Uploaded and ready: ' + serverName + (lenText ? '  ' + lenText : ''), lenText.indexOf('⚠️') === 0 ? 'warn' : 'ok');
      renderAll();
    }, function (err) {
      setUpNote(id, err.message, 'error');
      if (err.raw || err.kind !== 'upload') V.showNotice(V.errorBox(), err);
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
    renderAll();
  }

  function renderStats() {
    var lines = lineSegs(), s = story();
    if (!s) { $('storyStats').textContent = ''; return; }
    var spoken = lines.reduce(function (t, g) { return t + g.lines; }, 0);
    var words = lines.reduce(function (t, g) { return t + (g.text.replace(/\[[^\]]*\]/g, ' ').match(/[\w'’-]+/g) || []).length; }, 0);
    $('storyStats').textContent = spoken + ' spoken line' + (spoken === 1 ? '' : 's') + ' → ' + lines.length + ' job' + (lines.length === 1 ? '' : 's') +
      ' · ' + speakersUsed().length + ' voice' + (speakersUsed().length === 1 ? '' : 's') + ' · about ' + mmss((words / 150) * 60) + ' of speech';
  }

  var STATUS_LABEL = { idle: 'Waiting', queued: 'Queued', running: 'Generating', done: 'Done', failed: 'Failed' };

  function renderSegments() {
    var s = story(), n = 0;
    if (!st.segs.length) { $('storySegments').innerHTML = '<li class="scene">' + (s ? 'No spoken lines in this story yet.' : 'Choose a story.') + '</li>'; return; }
    $('storySegments').innerHTML = st.segs.map(function (g, i) {
      if (g.type === 'scene') return '<li class="scene">— ' + YB.esc(g.text) + ' —</li>';
      n++;
      var c = who(s, g.speaker), status = g.status || 'idle';
      var actions = '';
      if (g.status === 'done' && g.url) {
        actions = '<div class="seg-actions"><button type="button" data-seg-play="' + i + '">▶ Play</button>' +
          '<a href="' + g.url + '" download="' + YB.esc(fileBase() + '-line-' + n + '-' + slug(c.name)) + '.wav">⬇ Clip</a></div>';
      } else if (g.status === 'failed' && g.error) {
        actions = '<div class="seg-actions"><span class="small" style="color:#fecaca">' + YB.esc(g.error.message) + '</span></div>';
      }
      return '<li style="--c:' + YB.esc(c.color || '#1e7bff') + '" data-i="' + i + '"><span class="num">' + n + '</span>' +
        '<div><div class="who">' + YB.esc(c.name) + (g.lines > 1 ? ' <span class="muted small">(' + g.lines + ' lines)</span>' : '') + '</div>' +
        '<div class="say">' + YB.esc(g.text.length > 220 ? g.text.slice(0, 217) + '…' : g.text) + '</div>' + actions + '</div>' +
        '<span class="st" data-s="' + status + '">' + STATUS_LABEL[status] + '</span></li>';
    }).join('');
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
  function payload(g) {
    return V.buildPayload(g.text, g.voice, { output_format: 'wav' });
  }

  function generate(onlyFailed) {
    if (st.run || V.isBusy()) return;
    var box = V.errorBox();
    V.showNotice(box, null);
    if (!V.backend()) { V.showNotice(box, V.makeErr('offline', 'Backend is not connected.')); return; }
    if (!onlyFailed) rebuild();
    var bad = problems();
    if (bad.length) { V.showNotice(box, V.makeErr('validation', bad[0]), 'warn'); return; }

    // Clone references must be in the server's list right now.
    var clones = [];
    speakersUsed().forEach(function (id) { var v = voiceFor(id); if (v.mode === 'clone' && clones.indexOf(v.id) === -1) clones.push(v.id); });
    var check = clones.length ? V.verifyReferences(clones) : Promise.resolve([]);
    $('generateBtn').disabled = true;
    check.then(function (missing) {
      if (missing.length) {
        renderCast(); V.updateControls();
        V.showNotice(box, V.makeErr('ref-missing', 'Reference file "' + missing[0] + '" isn\'t on the server right now.'));
        return;
      }
      start(onlyFailed);
    });
  }

  function start(onlyFailed) {
    var queue = [];
    st.segs.forEach(function (g, i) {
      if (g.type !== 'line') return;
      if (onlyFailed && g.status !== 'failed') return;
      if (!onlyFailed) { if (g.url) URL.revokeObjectURL(g.url); g.url = null; g.blob = null; }
      if (g.status === 'done' && onlyFailed) return;
      g.voice = Object.assign({}, voiceFor(g.speaker));
      g.status = 'idle'; g.error = null; g.jobId = null; g.fails = 0;
      queue.push(i);
    });
    if (!queue.length) return;
    if (!V.begin('Queued')) return;
    st.run = { token: Date.now(), queue: queue, inflight: [], timer: null, total: lineSegs().length };
    YB.store.set('voiceStorySel', st.storyId);
    renderSegments(); updateRetry();
    progress();
    pump();
  }

  function progress() {
    var lines = lineSegs(), done = lines.filter(function (g) { return g.status === 'done'; }).length;
    var running = lines.filter(function (g) { return g.status === 'running'; });
    var s = story();
    var title = done === lines.length ? 'Processing audio…' : 'Generating speech… ' + done + ' of ' + lines.length + ' lines done';
    var detail = running.length
      ? 'Now voicing: ' + running.map(function (g) { return who(s, g.speaker).name; }).join(', ') + '. ' + st.run.inflight.length + ' job' + (st.run.inflight.length === 1 ? '' : 's') + ' in flight; Chatterbox works through them on CPU.'
      : st.run.inflight.length ? 'Jobs queued on the server — waiting for Chatterbox to start.' : 'Sending the next lines…';
    V.progress(running.length ? 'Generating' : 'Queued', title, detail);
  }

  // Keep up to opts.parallel jobs in flight, in script order.
  function pump() {
    var run = st.run; if (!run) return;
    while (run.inflight.length < Number(opts.parallel) && run.queue.length) submit(run.queue.shift());
    if (!run.inflight.length && !run.queue.length) { finish(); return; }
    schedulePoll();
  }

  function submit(i) {
    var run = st.run, g = st.segs[i];
    run.inflight.push(i);
    g.status = 'queued';
    renderSegments(); progress();
    V.call(V.route('jobs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload(g)) }, V.SHORT_TIMEOUT_MS)
      .then(function (res) {
        if (!res.ok) return V.httpError(res, 'job').then(function (e) { throw e; });
        return V.readJson(res);
      })
      .then(function (data) {
        if (st.run !== run) return;
        if (!data || !data.job_id) throw V.makeErr('tts', 'Backend did not return a job ID.');
        g.jobId = data.job_id;
        if (data.status === 'running') g.status = 'running';
        renderSegments(); progress();
      })
      .catch(function (err) {
        if (st.run !== run) return;
        fail(i, V.networkError(err));
      });
  }

  function schedulePoll() {
    var run = st.run; if (!run) return;
    clearTimeout(run.timer);
    run.timer = setTimeout(pollAll, V.JOB_POLL_MS);
  }

  // One status request per job in flight, every ~3 s.
  function pollAll() {
    var run = st.run; if (!run) return;
    var ids = run.inflight.filter(function (i) { return st.segs[i].jobId && st.segs[i].status !== 'fetching'; });
    var chain = Promise.resolve();
    ids.forEach(function (i) { chain = chain.then(function () { return pollOne(run, i); }); });
    chain.then(function () { if (st.run === run) { progress(); if (run.inflight.length || run.queue.length) schedulePoll(); else finish(); } });
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
        if (data.status === 'failed') { fail(i, V.jobFailure(data.error, g.voice.mode)); return; }
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
        g.blob = blob; g.url = URL.createObjectURL(blob); g.status = 'done';
        done(i);
      })
      .catch(function (err) {
        if (st.run !== run) return;
        if (++g.fails < 4) { g.status = 'running'; return; }   // retried on the next poll
        fail(i, V.networkError(err));
      });
  }

  function done(i) {
    var run = st.run;
    run.inflight = run.inflight.filter(function (x) { return x !== i; });
    renderSegments();
    pump();
  }

  function fail(i, err) {
    var run = st.run, g = st.segs[i];
    g.status = 'failed'; g.error = err;
    if (run) run.inflight = run.inflight.filter(function (x) { return x !== i; });
    renderSegments();
    if (run) pump();
  }

  function finish() {
    var run = st.run; if (!run) return;
    clearTimeout(run.timer);
    var lines = lineSegs(), failed = lines.filter(function (g) { return g.status === 'failed'; });
    if (failed.length) {
      st.run = null;
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
      V.end();
      V.showAudio(wav, 'wav', fileBase());
      $('storyRunNote').textContent = 'Story track ready — ' + lines.length + ' lines in script order. Each line\'s clip can also be played or downloaded above.';
      YB.toast('Complete — story audio ready');
      updateRetry(); V.updateControls();
    }, function (err) {
      console.error('[Voice Studio] stitching failed', err);
      st.run = null;
      V.end();
      V.showNotice(V.errorBox(), V.makeErr('tts', 'Couldn\'t combine the clips in this browser.', { raw: String(err && err.message || err) }));
      $('storyRunNote').textContent = 'Every line finished — download the clips individually above.';
      updateRetry(); V.updateControls();
    });
  }

  function cancel() {
    var run = st.run; if (!run) return;
    clearTimeout(run.timer);
    var sent = run.inflight.filter(function (i) { return st.segs[i].jobId; }).length;
    run.inflight.concat(run.queue).forEach(function (i) { var g = st.segs[i]; if (g.status !== 'done') g.status = 'idle'; });
    st.run = null;
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
    $('storyParallel').addEventListener('change', function () { opts.parallel = Number(this.value); saveOpts(); });
    $('storyMerge').addEventListener('change', function () { opts.merge = this.checked; saveOpts(); rebuild(); });
    $('storyRetryBtn').addEventListener('click', function () { generate(true); });
    $('castRefreshBtn').addEventListener('click', function () {
      Promise.all([V.loadVoices(true), V.loadReferences(true)]).then(function () { renderCast(); V.updateControls(); YB.toast('Voice lists refreshed'); });
    });

    var castHost = $('castRows');
    castHost.addEventListener('change', function (e) {
      var up = e.target.getAttribute('data-cv-file');
      if (up) { var f = e.target.files && e.target.files[0]; e.target.value = ''; uploadFor(up, f); return; }
      var m = e.target.getAttribute('data-cv-mode'), v = e.target.getAttribute('data-cv-voice');
      var map = castMap[st.storyId] || (castMap[st.storyId] = {});
      if (m) {
        var mode = e.target.value;
        var first = mode === 'clone' ? ((V.refFiles() || [])[0] || '') : ((V.voices() || [])[0] || {}).filename || '';
        map[m] = { mode: mode, id: first };
        if (mode === 'clone') V.refreshListsIfStale('refs');
      } else if (v) {
        map[v] = { mode: (map[v] && map[v].mode) || 'predefined', id: e.target.value };
      } else return;
      saveCast(); renderAll();
    });
    castHost.addEventListener('focusin', function (e) {
      if (e.target.matches('[data-cv-voice]')) V.refreshListsIfStale('both');
    });

    $('storySegments').addEventListener('click', function (e) {
      var b = e.target.closest('[data-seg-play]'); if (!b) return;
      var g = st.segs[Number(b.getAttribute('data-seg-play'))];
      if (g && g.url) { player.src = g.url; player.play().catch(function () {}); }
    });

    window.addEventListener('beforeunload', function (e) { if (st.run) { e.preventDefault(); e.returnValue = ''; } });
  }

  function init() {
    $('storyPause').value = String(opts.pause);
    $('storyScenePause').value = String(opts.scenePause);
    $('storyParallel').value = String(opts.parallel);
    $('storyMerge').checked = !!opts.merge;
    bind();
    V.registerStory({
      active: function () { return st.active; },
      running: function () { return !!st.run; },
      canGenerate: function () { return !st.run && problems().length === 0; },
      generate: function () { generate(false); },
      cancel: cancel,
      summary: summary,
      listsChanged: function () { if (st.active && !st.run) renderAll(); }
    });
    setActive(st.active);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
