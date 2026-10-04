/* =========================================================
   Youtube Blue — voice-library.js
   Our own voice library for Voice Studio (single voice + Story cast).

   One picker, four groups:
     • Presets      — files in  Voices/Preset Voices/  on GitHub (we add these)
     • Our Voices   — files in  Voices/Our Voices/     on GitHub (voices people shared)
     • My Voices    — voices imported in this app; kept in this device's own
                      storage (IndexedDB), private to this device
     • Built-in voices — the server's built-in voices

   Keys: 'preset:<file>' · 'shared:<file>' · 'mine:<id>' · 'builtin:<file>'

   The GitHub lists come from Voices/index.json (rebuilt by the
   "Voice library index" GitHub Action whenever a file is added), with the
   public GitHub API as a fallback. Picking a library voice needs no setup:
   right before generating, resolve() uploads it to the server once per
   server session (the server's reference list must show it before any job
   uses it), then the job clones that voice. Built-in voices are used as is.

   Sharing: the site has no GitHub write access (no tokens in the frontend),
   so "Share with everyone" prepares the file and the owner adds it to
   Voices/Our Voices on GitHub — it then appears for everyone.
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB, V = window.YBVoice;
  if (!YB || !V) return;

  var DIRS = { preset: 'Voices/Preset Voices', shared: 'Voices/Our Voices' };
  var GROUPS = [['preset', 'Presets'], ['shared', 'Our Voices'], ['mine', 'My Voices'], ['builtin', 'Built-in voices']];
  var CACHE_KEY = 'voiceLibCache', MINE_KEY = 'myVoices', REFMAP_KEY = 'voiceRefMap';
  var STALE_MS = 10 * 60 * 1000, MAX_SEC = 30, SHORT_SEC = 5, MAX_BYTES = 15 * 1024 * 1024;

  var cache = YB.store.get(CACHE_KEY, null);
  var lib = {
    preset: cache && Array.isArray(cache.preset) ? cache.preset : null,   // null = not loaded yet
    shared: cache && Array.isArray(cache.shared) ? cache.shared : null,
    at: (cache && cache.at) || 0,
    loading: null
  };
  var mine = YB.store.get(MINE_KEY, []);
  if (!Array.isArray(mine)) mine = [];

  function $(id) { return document.getElementById(id); }
  function niceName(file) { return String(file).replace(/\.(wav|mp3)$/i, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim() || file; }
  function slug(t) { return String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32) || 'voice'; }
  function hash(t) { var h = 5381; t = String(t); for (var i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); }
  function fileUrl(dir, file) { return './' + dir.split('/').map(encodeURIComponent).join('/') + '/' + encodeURIComponent(file); }
  function isAudio(name) { return /\.(wav|mp3)$/i.test(name || ''); }
  function repoInfo() {
    // https://<owner>.github.io/<repo>/ → owner/repo (falls back to this project's repo)
    var m = /^([^.]+)\.github\.io$/i.exec(location.hostname), seg = location.pathname.split('/').filter(Boolean)[0];
    return m && seg ? { owner: m[1], repo: seg } : { owner: 'Zayaiken21', repo: 'Youtube-Blue' };
  }
  function cleanList(arr) {
    return (Array.isArray(arr) ? arr : []).filter(function (x) { return x && isAudio(x.file); })
      .map(function (x) { return { file: String(x.file), name: String(x.name || niceName(x.file)), size: Number(x.size) || 0 }; });
  }

  /* ---------- GitHub lists ---------- */
  function fromIndex() {
    return fetch('./Voices/index.json?ts=' + Date.now(), { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('index HTTP ' + res.status);
      return res.json();
    }).then(function (j) { return { preset: cleanList(j.preset), shared: cleanList(j.shared) }; });
  }
  function fromApi() {
    var r = repoInfo();
    function list(dir) {
      var url = 'https://api.github.com/repos/' + r.owner + '/' + r.repo + '/contents/' + dir.split('/').map(encodeURIComponent).join('/') + '?ref=main';
      return fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (res) {
        if (res.status === 404) return [];
        if (!res.ok) throw new Error('GitHub API HTTP ' + res.status);
        return res.json();
      }).then(function (items) {
        return cleanList((Array.isArray(items) ? items : []).filter(function (i) { return i.type === 'file'; })
          .map(function (i) { return { file: i.name, name: niceName(i.name), size: i.size }; }));
      });
    }
    return Promise.all([list(DIRS.preset), list(DIRS.shared)]).then(function (x) { return { preset: x[0], shared: x[1] }; });
  }
  function refresh(force) {
    if (lib.loading) return lib.loading;
    if (!force && lib.preset && Date.now() - lib.at < STALE_MS) return Promise.resolve(true);
    lib.loading = fromIndex().catch(function (err) {
      console.warn('[Voice library] Voices/index.json unavailable, using the GitHub API', err);
      return fromApi();
    }).then(function (data) {
      lib.preset = data.preset; lib.shared = data.shared; lib.at = Date.now(); lib.failed = false;
      YB.store.set(CACHE_KEY, { at: lib.at, preset: lib.preset, shared: lib.shared });
      return true;
    }, function (err) {
      console.warn('[Voice library] could not load Presets / Our Voices', err);
      if (!lib.preset) { lib.preset = []; lib.shared = []; lib.failed = true; }
      return false;
    }).then(function (ok) { lib.loading = null; changed(); return ok; });
    return lib.loading;
  }
  function refreshIfStale() { if (Date.now() - lib.at > STALE_MS) refresh(false); }

  /* ---------- Lookup ---------- */
  function parse(key) { var i = String(key || '').indexOf(':'); return i < 0 ? { source: '', id: '' } : { source: key.slice(0, i), id: key.slice(i + 1) }; }
  function entry(key) {
    var k = parse(key);
    if (k.source === 'preset' || k.source === 'shared') {
      var list = lib[k.source]; if (!list || lib.failed) return undefined;   // unknown, not gone
      var f = list.find(function (x) { return x.file === k.id; });
      return f ? { key: key, source: k.source, name: f.name, file: f.file, size: f.size, url: fileUrl(DIRS[k.source], f.file) } : null;
    }
    if (k.source === 'mine') {
      var m = mine.find(function (x) { return x.id === k.id; });
      return m ? { key: key, source: 'mine', name: m.name, file: m.id + '.' + m.ext, size: m.size, ext: m.ext } : null;
    }
    if (k.source === 'builtin') {
      var voices = V.voices() || [];
      if (!voices.length) return undefined;
      var v = voices.find(function (x) { return x.filename === k.id; });
      return v ? { key: key, source: 'builtin', name: v.display_name, file: v.filename } : null;
    }
    return null;
  }
  // true = available, false = definitely gone, null = list not loaded yet
  function has(key) { var e = entry(key); return e === undefined ? null : !!e; }
  function label(key) {
    var e = entry(key), k = parse(key), g = GROUPS.find(function (x) { return x[0] === k.source; });
    return (e ? e.name : k.id.replace(/\.(wav|mp3)$/i, '')) + (g ? ' · ' + g[1] : '');
  }
  function keys() {   // every pickable voice, library first, in picker order
    var out = [];
    (lib.preset || []).forEach(function (x) { out.push('preset:' + x.file); });
    (lib.shared || []).forEach(function (x) { out.push('shared:' + x.file); });
    mine.forEach(function (x) { out.push('mine:' + x.id); });
    (V.voices() || []).forEach(function (x) { out.push('builtin:' + x.filename); });
    return out;
  }

  function optionsHtml(selected) {
    var html = '', any = false;
    function opt(key, name) { any = true; return '<option value="' + YB.esc(key) + '"' + (key === selected ? ' selected' : '') + '>' + YB.esc(name) + '</option>'; }
    GROUPS.forEach(function (g) {
      var items;
      if (g[0] === 'preset' || g[0] === 'shared') items = (lib[g[0]] || []).map(function (x) { return opt(g[0] + ':' + x.file, x.name); });
      else if (g[0] === 'mine') items = mine.map(function (x) { return opt('mine:' + x.id, x.name); });
      else items = (V.voices() || []).map(function (x) { return opt('builtin:' + x.filename, x.display_name); });
      if (items.length) html += '<optgroup label="' + g[1] + '">' + items.join('') + '</optgroup>';
    });
    // Keep a saved choice visible while its list is still loading.
    if (selected && has(selected) === null) html = '<option value="' + YB.esc(selected) + '" selected>' + YB.esc(label(selected)) + ' (loading…)</option>' + html;
    if (!any && !selected) html = '<option value="">' + (lib.loading ? 'Loading voices…' : 'No voices yet — connect the backend or import one') + '</option>' + html;
    return html;
  }

  function note(key) {
    var k = parse(key);
    if (!key) return '';
    if (k.source === 'builtin') return 'Built-in voice on the server.';
    if (!V.cloneAvailable()) return '⚠️ This server can\'t take voice uploads, so only built-in voices work right now.';
    var on = serverName(key);
    var where = k.source === 'preset' ? 'From Presets' : k.source === 'shared' ? 'From Our Voices' : 'From My Voices (this device)';
    return where + ' — ' + (on ? 'ready on the server.' : 'sent to the server automatically the first time you generate with it.');
  }

  /* ---------- Getting a library voice onto the server ---------- */
  function refMap() { var m = YB.store.get(REFMAP_KEY, {}); return m && typeof m === 'object' ? m : {}; }
  function serverName(key) {
    var m = refMap()[V.backend()] || {}, name = m[key], files = V.refFiles();
    if (!name) return '';
    return !Array.isArray(files) || files.indexOf(name) !== -1 ? name : '';
  }
  function remember(key, name) {
    var all = refMap(), b = V.backend();
    Object.keys(all).forEach(function (k) { if (k !== b) delete all[k]; });   // old Colab sessions are gone
    (all[b] = all[b] || {})[key] = name;
    YB.store.set(REFMAP_KEY, all);
  }
  function forget(key) { var all = refMap(), b = V.backend(); if (all[b]) { delete all[b][key]; YB.store.set(REFMAP_KEY, all); } changed(); }

  function blobFor(e) {
    if (e.source === 'mine') {
      return V.db.get('myvoice:' + parse(e.key).id).then(function (rec) {
        if (!rec || !rec.blob) throw V.makeErr('validation', '"' + e.name + '" isn\'t stored on this device any more — import it again.');
        return rec.blob;
      });
    }
    return fetch(e.url, { cache: 'no-cache' }).then(function (res) {
      if (!res.ok) throw V.makeErr('validation', 'Couldn\'t download "' + e.name + '" from the voice library (HTTP ' + res.status + ').');
      return res.blob();
    }).then(function (b) {
      if (!b || b.size < 1000) throw V.makeErr('validation', '"' + e.name + '" in the voice library is empty or broken.');
      return b;
    });
  }

  // → Promise<{ mode: 'predefined'|'clone', id }> ready for a job payload.
  function resolve(key, onStep) {
    var e = entry(key), k = parse(key);
    if (!key) return Promise.reject(V.makeErr('voice-missing', 'Choose a voice first.'));
    if (e === undefined) {
      // A list is still loading: finish it, then try once more.
      return (k.source === 'builtin' ? V.loadVoices(true) : refresh(true)).then(function () {
        if (entry(key) === undefined) {
          if (k.source === 'builtin') return { mode: 'predefined', id: k.id };   // server list unreadable right now; let the server decide
          throw V.makeErr('validation', 'The voice library couldn\'t be loaded — check your connection and press Refresh Voices.');
        }
        return resolve(key, onStep);
      });
    }
    if (!e) return Promise.reject(V.makeErr('voice-missing', 'That voice isn\'t available any more — pick another one.'));
    if (e.source === 'builtin') return Promise.resolve({ mode: 'predefined', id: e.file });
    if (!V.cloneAvailable()) return Promise.reject(V.makeErr('clone-unavailable', 'This server can\'t take voice uploads, so only built-in voices work right now.'));
    var known = (refMap()[V.backend()] || {})[key];
    return V.loadReferences(true).then(function (files) {
      if (known && (!files || files.indexOf(known) !== -1)) return { mode: 'clone', id: known };
      if (onStep) onStep('Getting "' + e.name + '" ready on the server…');
      return blobFor(e).then(function (blob) {
        var ext = (/\.mp3$/i.test(e.file) || /mpeg/.test(blob.type)) ? 'mp3' : 'wav';
        var file = new File([blob], 'yb-' + e.source + '-' + slug(e.name) + '-' + hash(e.key + ':' + (e.size || blob.size)) + '.' + ext, { type: ext === 'mp3' ? 'audio/mpeg' : 'audio/wav' });
        return V.sendReference(file, onStep);
      }).then(function (name) {
        remember(key, name);
        changed();
        return { mode: 'clone', id: name };
      });
    });
  }

  /* ---------- My Voices (this device) ---------- */
  function saveMine() { YB.store.set(MINE_KEY, mine); }
  function inOurVoices(name) {
    var n = String(name).trim().toLowerCase();
    return (lib.shared || []).some(function (x) { return x.name.trim().toLowerCase() === n; });
  }
  function shareFileName(m) { return (m.name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'My voice') + '.' + m.ext; }

  // Import: checks the file, stores it on this device, returns its key.
  function importVoice(file, name, share) {
    if (!file) return Promise.reject(V.makeErr('upload', 'Choose a WAV or MP3 file first.'));
    if (!isAudio(file.name)) return Promise.reject(V.makeErr('upload', 'Only .wav and .mp3 files can be imported.'));
    if (file.size > MAX_BYTES) return Promise.reject(V.makeErr('upload', 'That file is too big (' + V.bytesLabel(file.size) + '). Use a 10–20 second clip.'));
    name = String(name || '').trim() || niceName(file.name);
    name = name.slice(0, 40);
    var ext = /\.mp3$/i.test(file.name) ? 'mp3' : 'wav';
    return V.clipLength(file).then(function (r) {
      if (r.seconds && r.seconds > MAX_SEC + 0.5) throw V.makeErr('upload', 'That clip is ' + Math.round(r.seconds) + ' seconds — the server only accepts up to 30. Trim it to 10–20 seconds and import again.');
      var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      return V.db.put('myvoice:' + id, { blob: file, name: name, ext: ext }).then(function (ok) {
        if (!ok) throw V.makeErr('upload', 'This browser wouldn\'t let the app save the voice (private browsing or storage full).');
        var m = { id: id, name: name, ext: ext, size: file.size, seconds: r.seconds || 0, at: Date.now(), share: !!share };
        mine.push(m); saveMine();
        changed();
        return { key: 'mine:' + id, voice: m, length: r };
      });
    });
  }

  function removeMine(id) {
    var m = mine.find(function (x) { return x.id === id; }); if (!m) return;
    if (!confirm('Remove "' + m.name + '" from My Voices on this device?')) return;
    mine = mine.filter(function (x) { return x.id !== id; }); saveMine();
    V.db.del('myvoice:' + id);
    forget('mine:' + id);
    YB.toast('Removed ' + m.name);
    changed();
  }

  // Sharing goes through the owner: download the file, then it's added to
  // Voices/Our Voices on GitHub and appears for everyone.
  function shareMine(id) {
    var m = mine.find(function (x) { return x.id === id; }); if (!m) return;
    V.db.get('myvoice:' + id).then(function (rec) {
      if (!rec || !rec.blob) { YB.toast('That voice isn\'t stored on this device any more'); return; }
      m.share = true; saveMine();
      var url = URL.createObjectURL(rec.blob), a = document.createElement('a');
      a.href = url; a.download = shareFileName(m); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
      showShareHelp(m);
      changed();
    });
  }
  function showShareHelp(m) {
    var box = $('shareHelp'); if (!box) return;
    var r = repoInfo(), up = 'https://github.com/' + r.owner + '/' + r.repo + '/upload/main/' + DIRS.shared.split('/').map(encodeURIComponent).join('/');
    box.hidden = false;
    box.innerHTML = '<b>Ready to share "' + YB.esc(m.name) + '"</b>' +
      'The file <b>' + YB.esc(shareFileName(m)) + '</b> was saved to your downloads. To put it in <b>Our Voices</b> for everyone, add it to the <b>' + YB.esc(DIRS.shared) +
      '</b> folder of the Youtube Blue GitHub repo (or send it to the owner). It shows up for everyone a minute or two after it\'s added.' +
      '<div class="row" style="margin-top:8px"><a class="btn btn-sm" href="' + up + '" target="_blank" rel="noopener">↗ Open the Our Voices upload page</a>' +
      '<button class="btn btn-ghost btn-sm" type="button" data-share-close>Done</button></div>';
  }

  function renderMine() {
    var box = $('myVoicesBox'), list = $('myVoicesList'); if (!box || !list) return;
    box.hidden = !mine.length;
    list.innerHTML = mine.map(function (m) {
      var live = inOurVoices(m.name);
      var badge = live ? '<span class="mv-badge live">In Our Voices</span>' : m.share ? '<span class="mv-badge pending">Shared · waiting to be added</span>' : '<span class="mv-badge">Private</span>';
      return '<li data-mv="' + YB.esc(m.id) + '"><div class="mv-main"><b>' + YB.esc(m.name) + '</b>' +
        '<span class="mv-meta">' + (m.seconds ? m.seconds.toFixed(1) + ' s · ' : '') + V.bytesLabel(m.size) + ' · ' + m.ext.toUpperCase() + '</span>' + badge + '</div>' +
        '<div class="mv-actions"><button type="button" class="btn btn-ghost btn-xs" data-mv-play="' + YB.esc(m.id) + '" aria-label="Play ' + YB.esc(m.name) + '">▶</button>' +
        (live ? '' : '<button type="button" class="btn btn-ghost btn-xs" data-mv-share="' + YB.esc(m.id) + '">' + (m.share ? '⬇ Share file' : '🌐 Share') + '</button>') +
        '<button type="button" class="btn btn-ghost btn-xs" data-mv-del="' + YB.esc(m.id) + '" aria-label="Remove ' + YB.esc(m.name) + '">🗑</button></div></li>';
    }).join('');
  }

  var preview = new Audio(), previewUrl = '';
  function playMine(id) {
    V.db.get('myvoice:' + id).then(function (rec) {
      if (!rec || !rec.blob) { YB.toast('That voice isn\'t stored on this device any more'); return; }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(rec.blob);
      preview.src = previewUrl; preview.play().catch(function () {});
    });
  }

  /* ---------- Import form (single-voice card) ---------- */
  var listeners = [];
  function onChange(fn) { listeners.push(fn); }
  function changed() {
    renderMine();
    V.renderPicker();
    listeners.forEach(function (fn) { try { fn(); } catch (e) { console.error(e); } });
  }

  function setImportState(state, text) { var el = $('uploadState'); if (!el) return; el.setAttribute('data-state', state); el.textContent = text; }
  function importReady() {
    var f = $('voiceSampleFile').files && $('voiceSampleFile').files[0];
    var shareOk = !$('importShare').checked || $('importConsent').checked;
    $('importVoiceBtn').disabled = !f || !shareOk || importing;
  }
  var importing = false;
  function bindImport() {
    if (!$('voiceSampleFile')) return;
    $('voiceSampleFile').addEventListener('change', function () {
      var f = this.files && this.files[0];
      $('localFileName').textContent = f ? f.name + ' (' + V.bytesLabel(f.size) + ')' : 'None';
      $('refDurationNote').hidden = true;
      // The name follows the file until the person types their own.
      if (f && (!$('importVoiceName').value.trim() || $('importVoiceName').dataset.auto === '1')) { $('importVoiceName').value = niceName(f.name).slice(0, 40); $('importVoiceName').dataset.auto = '1'; }
      setImportState('idle', f ? 'Ready — press Import voice.' : 'Choose an audio file to import.');
      importReady();
      if (!f) return;
      V.clipLength(f).then(function (r) {
        if (!r.text) return;
        var n = $('refDurationNote'); n.textContent = r.text; n.hidden = false;
      });
    });
    $('importVoiceName').addEventListener('input', function () { this.dataset.auto = ''; });
    $('importShare').addEventListener('change', function () {
      $('importConsentRow').hidden = !this.checked;
      if (!this.checked) $('importConsent').checked = false;
      importReady();
    });
    $('importConsent').addEventListener('change', importReady);
    $('importVoiceBtn').addEventListener('click', function () {
      var f = $('voiceSampleFile').files && $('voiceSampleFile').files[0], share = $('importShare').checked;
      if (!f || importing) return;
      importing = true; importReady();
      setImportState('busy', 'Saving "' + ($('importVoiceName').value.trim() || niceName(f.name)) + '" on this device…');
      importVoice(f, $('importVoiceName').value, share).then(function (res) {
        importing = false;
        setImportState(res.length.level === 'warn' ? 'error' : 'done', '✓ Imported "' + res.voice.name + '" to My Voices and selected it.' + (res.length.text ? '  ' + res.length.text : ''));
        $('voiceSampleFile').value = ''; $('localFileName').textContent = 'None'; $('importVoiceName').value = ''; $('importVoiceName').dataset.auto = ''; $('refDurationNote').hidden = true;
        $('importShare').checked = false; $('importConsent').checked = false; $('importConsentRow').hidden = true;
        V.selectVoice(res.key);
        if (share) shareMine(res.voice.id);
        importReady();
      }, function (err) {
        importing = false; importReady();
        setImportState('error', err.message);
      });
    });
    $('myVoicesList').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-mv-play')) playMine(b.getAttribute('data-mv-play'));
      else if (b.hasAttribute('data-mv-share')) shareMine(b.getAttribute('data-mv-share'));
      else if (b.hasAttribute('data-mv-del')) removeMine(b.getAttribute('data-mv-del'));
    });
    $('shareHelp').addEventListener('click', function (e) { if (e.target.closest('[data-share-close]')) $('shareHelp').hidden = true; });
  }

  var L = {
    refresh: refresh, refreshIfStale: refreshIfStale,
    optionsHtml: optionsHtml, has: has, label: label, note: note, keys: keys, entry: entry,
    resolve: resolve, forget: forget, onChange: onChange,
    importVoice: importVoice, shareMine: shareMine,
    groupOf: function (key) { return parse(key).source; },
    counts: function () {
      var parts = [], n;
      if ((n = (lib.preset || []).length)) parts.push(n + ' preset' + (n === 1 ? '' : 's'));
      if ((n = (lib.shared || []).length)) parts.push(n + ' shared');
      if ((n = mine.length)) parts.push(n + ' mine');
      if ((n = (V.voices() || []).length)) parts.push(n + ' built-in');
      return parts.join(' · ');
    }
  };
  window.YBLibrary = L;

  function init() {
    bindImport();
    renderMine();
    V.registerLibrary(L);
    refresh(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
