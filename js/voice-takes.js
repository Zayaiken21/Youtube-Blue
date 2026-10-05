/* =========================================================
   Youtube Blue — voice-takes.js
   "Your audio": every take generated in Voice Studio is kept on this
   device until the user presses Clear all — single-voice speech, each
   Story line as soon as it finishes, and every full story track. Survives
   reloads and closing the app (blobs in IndexedDB, list in localStorage).

   Also the shared play/pause manager used everywhere on the page:
   one clip plays at a time; every button for that clip shows ▶ / ❚❚ and a
   progress ring; tapping again pauses, tapping again resumes.
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB, V = window.YBVoice;
  if (!YB || !V) return;

  var META_KEY = 'voiceTakes';
  var takes = YB.store.get(META_KEY, []);
  if (!Array.isArray(takes)) takes = [];
  var openGroups = {};

  function $(id) { return document.getElementById(id); }
  function save() { YB.store.set(META_KEY, takes); }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function when(t) {
    var d = new Date(t), today = new Date();
    var time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    return d.toDateString() === today.toDateString() ? time : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + time;
  }

  /* ---------- Player (one at a time) ---------- */
  var audio = new Audio();
  audio.preload = 'auto';
  var P = { key: '', url: '', loading: false };

  var ICONS = '<svg class="pi-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.2-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>' +
    '<svg class="pi-pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="4" height="14" rx="1.2"/><rect x="13.5" y="5" width="4" height="14" rx="1.2"/></svg>';
  function playButton(key, label, extraClass) {
    return '<button type="button" class="play-btn' + (extraClass ? ' ' + extraClass : '') + '" data-play-key="' + YB.esc(key) + '" data-play-label="' + YB.esc(label) + '" aria-label="Play ' + YB.esc(label) + '" aria-pressed="false">' + ICONS + '</button>';
  }

  function stateOf(key) {
    if (key !== P.key) return 'idle';
    if (P.loading) return 'loading';
    return audio.paused ? (audio.currentTime > 0 && !audio.ended ? 'paused' : 'idle') : 'playing';
  }
  function sync() {
    document.querySelectorAll('[data-play-key]').forEach(function (b) {
      var k = b.getAttribute('data-play-key'), s = stateOf(k), label = b.getAttribute('data-play-label') || 'audio';
      b.classList.toggle('is-playing', s === 'playing');
      b.classList.toggle('is-loading', s === 'loading');
      b.classList.toggle('is-active', s !== 'idle');
      b.setAttribute('aria-pressed', s === 'playing' ? 'true' : 'false');
      b.setAttribute('aria-label', (s === 'playing' ? 'Pause ' : 'Play ') + label);
      var pct = k === P.key && audio.duration ? Math.min(100, (audio.currentTime / audio.duration) * 100) : 0;
      b.style.setProperty('--p', pct.toFixed(1));
    });
  }
  ['play', 'playing', 'pause', 'ended', 'timeupdate', 'loadedmetadata'].forEach(function (ev) { audio.addEventListener(ev, sync); });
  audio.addEventListener('ended', function () { audio.currentTime = 0; sync(); });
  audio.addEventListener('error', function () { if (P.key) { P.loading = false; YB.toast('Couldn\'t play that clip'); stop(); } });

  function stop() {
    audio.pause();
    if (P.url) { URL.revokeObjectURL(P.url); }
    P.key = ''; P.url = ''; P.loading = false;
    audio.removeAttribute('src'); audio.load();
    sync();
  }
  function pauseMain() { var m = $('audioPreview'); if (m && !m.paused) m.pause(); }

  // getBlob: () => Blob | Promise<Blob>
  function toggle(key, getBlob) {
    if (P.key === key && (P.url || P.loading)) {
      if (P.loading) return;
      if (audio.paused) { pauseMain(); audio.play().catch(function () {}); } else audio.pause();
      return;
    }
    stop();
    P.key = key; P.loading = true; sync();
    Promise.resolve().then(getBlob).then(function (blob) {
      if (P.key !== key) return;
      if (!blob) throw new Error('missing');
      P.url = URL.createObjectURL(blob); P.loading = false;
      audio.src = P.url;
      pauseMain();
      return audio.play();
    }).catch(function (err) {
      if (P.key !== key) return;
      console.warn('[Your audio] play', err);
      YB.toast(err && err.userMessage ? err.userMessage : err && err.message === 'missing' ? 'That audio isn\'t on this device any more' : 'Couldn\'t play that clip');
      stop();
    });
  }
  // Something else stopped existing (cleared, regenerated): stop if it was playing.
  function release(prefix) { if (P.key && P.key.indexOf(prefix) === 0) stop(); }

  /* ---------- Saved takes ---------- */
  // Length from the WAV header (data = rest of the file); other formats via the browser.
  function measure(blob, ext) {
    if (String(ext).toLowerCase() === 'wav') {
      return blob.slice(0, Math.min(blob.size, 1 << 16)).arrayBuffer().then(function (head) {
        var dv = new DataView(head), off = 12, rate = 0, bpf = 0;
        if (head.byteLength < 44 || dv.getUint32(0, false) !== 0x52494646) return 0;
        while (off + 8 <= head.byteLength) {
          var id = dv.getUint32(off, false), size = dv.getUint32(off + 4, true);
          if (id === 0x666d7420) { rate = dv.getUint32(off + 12, true); bpf = dv.getUint16(off + 20, true); }
          else if (id === 0x64617461) return rate && bpf ? (blob.size - off - 8) / (rate * bpf) : 0;
          off += 8 + size + (size & 1);
        }
        return 0;
      }).catch(function () { return 0; });
    }
    return new Promise(function (resolve) {
      var a = new Audio(), u = URL.createObjectURL(blob);
      a.preload = 'metadata';
      a.onloadedmetadata = function () { URL.revokeObjectURL(u); resolve(isFinite(a.duration) ? a.duration : 0); };
      a.onerror = function () { URL.revokeObjectURL(u); resolve(0); };
      a.src = u;
    });
  }

  // t: { id?, kind: 'single'|'line'|'story', title, text?, blob, ext, group?, groupTitle?, idx?, note? }
  function add(t) {
    if (!t || !t.blob) return Promise.resolve(null);
    var id = t.id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    return measure(t.blob, t.ext).then(function (dur) {
      return V.db.put('take:' + id, t.blob).then(function (ok) {
        if (!ok) { YB.toast('Couldn\'t save this audio on the device (storage full or private browsing)'); return null; }
        release('take:' + id);
        takes = takes.filter(function (x) { return x.id !== id; });
        takes.unshift({ id: id, kind: t.kind || 'single', title: String(t.title || 'Speech'), text: String(t.text || '').slice(0, 160), ext: t.ext || 'wav',
          size: t.blob.size, dur: dur || 0, at: Date.now(), group: t.group || '', groupTitle: t.groupTitle || '', idx: t.idx == null ? -1 : t.idx, note: t.note || '' });
        save(); render();
        return id;
      });
    });
  }

  function blobFor(id) { return V.db.get('take:' + id).then(function (b) { if (!b) throw new Error('missing'); return b; }); }

  function fileName(t) {
    var base = (t.groupTitle ? t.groupTitle + ' - ' : '') + t.title;
    return 'youtube-blue-' + base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) + '.' + t.ext;
  }
  function download(id) {
    var t = takes.find(function (x) { return x.id === id; }); if (!t) return;
    blobFor(id).then(function (blob) {
      var url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = fileName(t); document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    }, function () { YB.toast('That audio isn\'t on this device any more'); });
  }

  // Clears every saved take, the main player and Story mode's finished lines — all at once.
  function clearAll(skipConfirm) {
    if (!skipConfirm && !confirm('Clear all generated audio from this device?\n\nThis removes every saved take, line and story track. Download anything you want to keep first.')) return false;
    stop();
    takes = []; save();
    V.db.delPrefix('take:');
    render();
    window.dispatchEvent(new Event('yb-audio-cleared'));
    YB.toast('All generated audio cleared');
    return true;
  }

  /* ---------- List ---------- */
  function itemHtml(t) {
    var label = (t.groupTitle && t.kind !== 'single' ? t.groupTitle + ' — ' : '') + t.title;
    return '<li class="take" data-take="' + YB.esc(t.id) + '">' +
      playButton('take:' + t.id, label) +
      '<div class="take-main"><div class="take-title">' + YB.esc(t.title) + '</div>' +
      '<div class="take-meta">' + (t.dur ? mmss(t.dur) + ' · ' : '') + V.bytesLabel(t.size) + ' · ' + String(t.ext).toUpperCase() + ' · ' + when(t.at) + (t.note ? ' · ' + YB.esc(t.note) : '') + '</div>' +
      (t.text ? '<div class="take-text">' + YB.esc(t.text) + '</div>' : '') + '</div>' +
      '<button type="button" class="take-dl" data-take-dl="' + YB.esc(t.id) + '" aria-label="Download ' + YB.esc(label) + '" title="Download"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v10m0 0-4-4m4 4 4-4M5 19h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button></li>';
  }

  function render() {
    var card = $('takesCard'), list = $('takesList'); if (!card || !list) return;
    card.hidden = !takes.length;
    $('takesCount').textContent = takes.length ? takes.length + ' saved' : '';
    // Story runs become one group (full track first, then lines in order); single takes stand alone. Newest first.
    var blocks = [], byGroup = {};
    takes.forEach(function (t) {
      if (t.group && t.kind !== 'single') {
        var g = byGroup[t.group];
        if (!g) { g = byGroup[t.group] = { group: t.group, title: t.groupTitle || 'Story', at: t.at, items: [] }; blocks.push(g); }
        g.items.push(t); if (t.at > g.at) g.at = t.at;
      } else blocks.push({ single: t, at: t.at });
    });
    blocks.sort(function (a, b) { return b.at - a.at; });
    var firstGroup = true;
    list.innerHTML = blocks.map(function (b) {
      if (b.single) return '<ul class="take-list">' + itemHtml(b.single) + '</ul>';
      b.items.sort(function (x, y) { return (x.kind === 'story' ? -1 : 0) - (y.kind === 'story' ? -1 : 0) || x.idx - y.idx; });
      var open = openGroups[b.group] !== undefined ? openGroups[b.group] : firstGroup;
      firstGroup = false;
      var lines = b.items.filter(function (t) { return t.kind === 'line'; }).length, track = b.items.some(function (t) { return t.kind === 'story'; });
      return '<details class="take-group" data-group="' + YB.esc(b.group) + '"' + (open ? ' open' : '') + '><summary><span class="tg-title">🎭 ' + YB.esc(b.title) + '</span>' +
        '<span class="tg-meta">' + (track ? 'Full track + ' : '') + lines + ' line' + (lines === 1 ? '' : 's') + ' · ' + when(b.at) + '</span></summary>' +
        '<ul class="take-list">' + b.items.map(itemHtml).join('') + '</ul></details>';
    }).join('');
    sync();
  }

  function bind() {
    var list = $('takesList'); if (!list) return;
    list.addEventListener('click', function (e) {
      var p = e.target.closest('[data-play-key]');
      if (p) { var id = p.getAttribute('data-play-key').slice(5); toggle('take:' + id, function () { return blobFor(id); }); return; }
      var d = e.target.closest('[data-take-dl]');
      if (d) download(d.getAttribute('data-take-dl'));
    });
    list.addEventListener('toggle', function (e) {
      var g = e.target.closest && e.target.closest('details[data-group]');
      if (g) openGroups[g.getAttribute('data-group')] = g.open;
    }, true);
    $('takesClearBtn').addEventListener('click', function () { clearAll(false); });
    // The main player and these buttons never play over each other.
    var main = $('audioPreview');
    if (main) main.addEventListener('play', function () { if (!audio.paused) audio.pause(); });
    // Keep "4 min ago"-style times fresh-ish and buttons right after tab switches.
    document.addEventListener('visibilitychange', function () { if (!document.hidden) render(); });
  }

  window.YBTakes = {
    add: add, clearAll: clearAll, render: render,
    player: { toggle: toggle, stop: stop, sync: sync, release: release, button: playButton, isPlaying: function (k) { return stateOf(k) === 'playing'; } }
  };

  function init() {
    // Drop list entries whose audio is gone (e.g. the browser cleared storage) —
    // only when the database itself is working, so a blocked DB never wipes the list.
    V.db.put('__probe__', 1).then(function (works) {
      if (!works) return;
      Promise.all(takes.map(function (t) { return V.db.get('take:' + t.id).then(function (b) { return b ? t : null; }); })).then(function (ok) {
        var kept = ok.filter(Boolean);
        if (kept.length !== takes.length) { takes = kept; save(); render(); }
      });
    });
    bind();
    render();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
