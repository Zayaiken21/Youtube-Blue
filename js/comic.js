/* =========================================================
   Youtube Blue — comic.js · Comic to Video
   1. Add comic pages → panels are found by their white borders (js/comic-panels.js)
      and put in story order. Fix anything by hand: reorder, delete, draw a panel.
   2. Pick a voice track (Voice Studio audio or a file) and a style.
   3. Preview, then record a real video (MediaRecorder: MP4 where the browser can,
      otherwise WebM — YouTube takes both).
   Everything stays on this device (IndexedDB 'youtube-blue-comic').
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;
  if (!YB) return;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Settings ---------- */
  var FORMATS = { short: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] };
  var DEFAULTS = { light: 228, dark: false, minPanel: 6, format: 'short', fit: 'frame', motion: 'auto', transition: 'fade', transLen: 0.35, tag: '', audioMode: 'none', takeId: '', fitAudio: true, dur: 2.5 };
  var S = Object.assign({}, DEFAULTS, YB.store.get('comicSettings', {}));
  function saveSettings() { YB.store.set('comicSettings', S); }

  var pages = [];     // { id, name, blob, url, img, w, h }
  var panels = [];    // { id, pageId, x, y, w, h, dur, motion }
  var audio = { blob: null, url: '', dur: 0, name: '' };
  var view = { pageId: '', sel: '', tab: 'page', drawing: false };

  /* ---------- Storage (IndexedDB) ---------- */
  function openDb(name) {
    return new Promise(function (res) {
      if (!window.indexedDB) return res(null);
      try {
        var r = indexedDB.open(name, 1);
        r.onupgradeneeded = function () { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = r.onblocked = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function kv(dbName, mode, fn) {
    return openDb(dbName).then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        try {
          var t = db.transaction('kv', mode), out = { v: null };
          fn(t.objectStore('kv'), out);
          t.oncomplete = function () { db.close(); res(out.v); };
          t.onerror = t.onabort = function () { db.close(); res(null); };
        } catch (e) { db.close(); res(null); }
      });
    });
  }
  var DB = 'youtube-blue-comic';
  var saveProject = YB.debounce(function () {
    var data = {
      pages: pages.map(function (p) { return { id: p.id, name: p.name, blob: p.blob }; }),
      panels: panels.map(function (q) { return { id: q.id, pageId: q.pageId, x: q.x, y: q.y, w: q.w, h: q.h, dur: q.dur, motion: q.motion || '' }; })
    };
    kv(DB, 'readwrite', function (st) { st.put(data, 'project'); });
  }, 400);

  /* ---------- Images & panel detection ---------- */
  function loadImg(blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), img = new Image();
      img.onload = function () { res({ img: img, url: url }); };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('That file isn\'t an image this browser can open.')); };
      img.src = url;
    });
  }

  function detect(page) {
    if (!window.YBPanels) return [];
    var scale = Math.min(1, 1400 / Math.max(page.w, page.h));
    var w = Math.max(1, Math.round(page.w * scale)), h = Math.max(1, Math.round(page.h * scale));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(page.img, 0, 0, w, h);
    var found = window.YBPanels.find(x.getImageData(0, 0, w, h), { light: S.light, dark: !!S.dark, minPanel: S.minPanel / 100 });
    if (!found.length) found = [{ x: 0, y: 0, w: w, h: h }];
    return found.map(function (r) {
      return { id: YB.uid(), pageId: page.id, x: Math.round(r.x / scale), y: Math.round(r.y / scale), w: Math.round(r.w / scale), h: Math.round(r.h / scale), dur: S.dur, motion: '' };
    });
  }

  function addPage(file) {
    if (!file || !/^image\//.test(file.type || '') && !/\.(png|jpe?g|webp|gif|bmp)$/i.test(file.name || '')) return Promise.resolve(false);
    return loadImg(file).then(function (o) {
      var page = { id: YB.uid(), name: (file.name || 'Page').replace(/\.[a-z0-9]+$/i, ''), blob: file, url: o.url, img: o.img, w: o.img.naturalWidth, h: o.img.naturalHeight };
      pages.push(page);
      panels = panels.concat(detect(page));
      if (!view.pageId) view.pageId = page.id;
      return true;
    });
  }

  function addFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    var before = panels.length;
    files.reduce(function (p, f) { return p.then(function () { return addPage(f).catch(function (e) { YB.toast(e.message); }); }); }, Promise.resolve())
      .then(function () {
        var n = panels.length - before;
        YB.toast(n ? 'Found ' + n + ' panel' + (n === 1 ? '' : 's') + ' — check the order below' : 'No pages added');
        dropCaches(); saveProject(); renderAll();
      });
  }

  function redetect() {
    var order = [];
    pages.forEach(function (p) { order = order.concat(detect(p)); });
    panels = order; view.sel = '';
    dropCaches(); saveProject(); renderAll();
    YB.toast('Found ' + panels.length + ' panels');
  }

  /* ---------- Rendering: lists & stage ---------- */
  function pageOf(q) { return pages.find(function (p) { return p.id === q.pageId; }); }
  function pageNo(id) { return pages.findIndex(function (p) { return p.id === id; }) + 1; }

  function renderPages() {
    $('pageList').innerHTML = pages.map(function (p, i) {
      var n = panels.filter(function (q) { return q.pageId === p.id; }).length;
      return '<li data-id="' + p.id + '"><img src="' + p.url + '" alt=""><div class="cx-pg-meta"><b>' + YB.esc('Page ' + (i + 1)) + '</b><span class="muted small">' + YB.esc(p.name) + ' · ' + n + ' panel' + (n === 1 ? '' : 's') + '</span></div>' +
        '<div class="cx-pg-btns"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-pg-up aria-label="Move page up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-pg-down aria-label="Move page down"' + (i === pages.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn btn-danger btn-icon btn-sm" data-pg-del aria-label="Remove page">✕</button></div></li>';
    }).join('');
    $('pageSelect').innerHTML = pages.map(function (p, i) { return '<option value="' + p.id + '">Page ' + (i + 1) + ' · ' + YB.esc(p.name) + '</option>'; }).join('');
    if (!pages.some(function (p) { return p.id === view.pageId; })) view.pageId = pages[0] ? pages[0].id : '';
    $('pageSelect').value = view.pageId;
    $('pageSelect').hidden = pages.length < 2;
  }

  function renderStage() {
    var p = pages.find(function (x) { return x.id === view.pageId; });
    var img = $('stageImg');
    if (!p) { img.removeAttribute('src'); $('boxes').innerHTML = ''; return; }
    if (img.getAttribute('src') !== p.url) img.src = p.url;
    $('boxes').innerHTML = panels.map(function (q, i) {
      if (q.pageId !== p.id) return '';
      return '<div class="cx-box' + (q.id === view.sel ? ' on' : '') + '" data-id="' + q.id + '" style="left:' + (q.x / p.w * 100) + '%;top:' + (q.y / p.h * 100) + '%;width:' + (q.w / p.w * 100) + '%;height:' + (q.h / p.h * 100) + '%">' +
        '<span class="cx-box-n">' + (i + 1) + '</span><button type="button" class="cx-box-x" data-box-del aria-label="Remove panel ' + (i + 1) + '">✕</button></div>';
    }).join('');
    $('stage').classList.toggle('drawing', view.drawing);
  }

  var MOTIONS = [['', 'Motion: video setting'], ['zoomin', 'Zoom in'], ['zoomout', 'Zoom out'], ['pan', 'Pan across'], ['still', 'Still']];
  function renderList() {
    var t = timeline();
    $('panelList').innerHTML = panels.map(function (q, i) {
      var eff = t.durs[i], fitted = Math.abs(eff - q.dur) > 0.05;
      return '<li class="cx-panel' + (q.id === view.sel ? ' on' : '') + '" data-id="' + q.id + '">' +
        '<span class="cx-pnum">' + (i + 1) + '</span><canvas class="cx-thumb" width="120" height="120" data-thumb="' + q.id + '"></canvas>' +
        '<div class="cx-pmeta"><span class="muted small">Page ' + pageNo(q.pageId) + (fitted ? ' · plays ' + eff.toFixed(1) + ' s' : '') + '</span>' +
        '<span class="cx-pctl"><input type="number" min="0.5" max="20" step="0.5" value="' + q.dur + '" data-dur aria-label="Seconds for panel ' + (i + 1) + '"><span class="muted small">s</span>' +
        '<select data-motion aria-label="Motion for panel ' + (i + 1) + '">' + MOTIONS.map(function (m) { return '<option value="' + m[0] + '"' + ((q.motion || '') === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></span></div>' +
        '<div class="cx-pbtns"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-up aria-label="Move earlier"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-down aria-label="Move later"' + (i === panels.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn btn-danger btn-icon btn-sm" data-del aria-label="Remove panel ' + (i + 1) + '">✕</button></div></li>';
    }).join('') || '<li class="muted small">No panels yet.</li>';
    panels.forEach(function (q) {
      var c = document.querySelector('[data-thumb="' + q.id + '"]'), p = pageOf(q); if (!c || !p) return;
      var x = c.getContext('2d'), s = Math.min(120 / q.w, 120 / q.h), w = q.w * s, h = q.h * s;
      x.drawImage(p.img, q.x, q.y, q.w, q.h, (120 - w) / 2, (120 - h) / 2, w, h);
    });
  }

  function renderSteps() {
    var has = pages.length > 0, ready = panels.length > 0;
    $('panelsCard').hidden = !has;
    $('styleCard').hidden = !ready;
    $('exportCard').hidden = !ready;
    $('panelCount').textContent = ready ? '· ' + panels.length + ' in order' : '';
    document.querySelectorAll('.cx-steps li').forEach(function (li) {
      var n = +li.getAttribute('data-step');
      li.classList.toggle('done', n === 1 ? has : n === 2 ? ready : n === 3 ? ready : !!lastVideo);
    });
    $('fitAudioBtn').disabled = !audio.dur || !panels.length;
  }

  function renderAll() {
    renderPages(); renderStage(); renderList(); renderSteps(); renderFacts(); sizePreview(); drawPreview();
  }

  /* ---------- Editing ---------- */
  function move(arr, i, d) { var j = i + d; if (j < 0 || j >= arr.length) return; var t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
  function removePanel(id) { panels = panels.filter(function (q) { return q.id !== id; }); if (view.sel === id) view.sel = ''; changed(); }
  function changed() { saveProject(); renderAll(); }

  function wire() {
    $('pageFiles').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
    var dz = $('dropZone');
    ['dragenter', 'dragover'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { dz.addEventListener(ev, function (e) { e.preventDefault(); dz.classList.remove('over'); }); });
    dz.addEventListener('drop', function (e) { addFiles(e.dataTransfer && e.dataTransfer.files); });

    $('pageList').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]'); if (!li) return;
      var i = pages.findIndex(function (p) { return p.id === li.getAttribute('data-id'); });
      if (e.target.closest('[data-pg-up]')) move(pages, i, -1);
      else if (e.target.closest('[data-pg-down]')) move(pages, i, 1);
      else if (e.target.closest('[data-pg-del]')) {
        var p = pages[i]; pages.splice(i, 1); panels = panels.filter(function (q) { return q.pageId !== p.id; }); URL.revokeObjectURL(p.url);
      } else { view.pageId = li.getAttribute('data-id'); setTab('page'); renderStage(); return; }
      // panels follow the page order
      panels = pages.reduce(function (acc, p) { return acc.concat(panels.filter(function (q) { return q.pageId === p.id; })); }, []);
      dropCaches(); changed();
    });

    // detection settings
    $('gutterColor').value = S.dark ? 'dark' : 'light';
    $('gutterLight').value = S.light; $('minPanel').value = S.minPanel; labels();
    $('gutterColor').addEventListener('change', function () { S.dark = this.value === 'dark'; saveSettings(); });
    $('gutterLight').addEventListener('input', function () { S.light = +this.value; labels(); saveSettings(); });
    $('minPanel').addEventListener('input', function () { S.minPanel = +this.value; labels(); saveSettings(); });
    $('redetectBtn').addEventListener('click', function () {
      if (panels.length && !confirm('Find panels again? Your order, timing and hand-drawn panels on these pages will be replaced.')) return;
      redetect();
    });

    // tabs
    document.querySelectorAll('[data-view]').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-view')); }); });
    $('pageSelect').addEventListener('change', function () { view.pageId = this.value; renderStage(); });

    // stage: select / delete / draw
    $('boxes').addEventListener('click', function (e) {
      if (view.drawing) return;
      var box = e.target.closest('.cx-box'); if (!box) return;
      if (e.target.closest('[data-box-del]')) { removePanel(box.getAttribute('data-id')); return; }
      view.sel = view.sel === box.getAttribute('data-id') ? '' : box.getAttribute('data-id');
      renderStage(); renderList();
      var i = panels.findIndex(function (q) { return q.id === view.sel; });
      if (i >= 0) seekTo(timeline().starts[i] + 0.05);
    });
    $('drawBtn').addEventListener('click', function () {
      view.drawing = !view.drawing;
      this.setAttribute('aria-pressed', view.drawing ? 'true' : 'false');
      this.classList.toggle('on', view.drawing);
      $('pageHint').textContent = view.drawing ? 'Drag across the page to draw a panel. Tap “Draw a panel” again when done.' : 'Tap a box to select it. Numbers show the playing order.';
      renderStage();
    });
    $('wholePageBtn').addEventListener('click', function () {
      var p = pages.find(function (x) { return x.id === view.pageId; }); if (!p) return;
      insertPanel({ id: YB.uid(), pageId: p.id, x: 0, y: 0, w: p.w, h: p.h, dur: S.dur, motion: '' });
    });
    wireDraw();

    // list
    $('panelList').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]'); if (!li) return;
      var id = li.getAttribute('data-id'), i = panels.findIndex(function (q) { return q.id === id; });
      if (e.target.closest('[data-up]')) { move(panels, i, -1); changed(); }
      else if (e.target.closest('[data-down]')) { move(panels, i, 1); changed(); }
      else if (e.target.closest('[data-del]')) removePanel(id);
      else if (!e.target.closest('input,select')) { view.sel = id; renderList(); seekTo(timeline().starts[i] + 0.05); }
    });
    $('panelList').addEventListener('change', function (e) {
      var li = e.target.closest('li[data-id]'); if (!li) return;
      var q = panels.find(function (x) { return x.id === li.getAttribute('data-id'); }); if (!q) return;
      if (e.target.matches('[data-dur]')) q.dur = clamp(+e.target.value || S.dur, 0.5, 20);
      if (e.target.matches('[data-motion]')) q.motion = e.target.value;
      changed();
    });
    $('allDur').value = S.dur;
    $('allDurBtn').addEventListener('click', function () {
      S.dur = clamp(+$('allDur').value || 2.5, 0.5, 20); $('allDur').value = S.dur; saveSettings();
      panels.forEach(function (q) { q.dur = S.dur; }); changed();
    });
    $('fitAudioBtn').addEventListener('click', function () {
      if (!audio.dur) return;
      var t = timeline(true); panels.forEach(function (q, i) { q.dur = Math.round(t.durs[i] * 10) / 10; });
      S.fitAudio = true; $('fitAudio').checked = true; saveSettings(); changed();
      YB.toast('Panel timing now matches the voice track');
    });

    // sound
    document.querySelectorAll('[data-audio]').forEach(function (b) { b.addEventListener('click', function () { setAudioMode(b.getAttribute('data-audio')); }); });
    $('voiceTake').addEventListener('change', function () { S.takeId = this.value; saveSettings(); loadVoiceTake(); });
    $('audioInput').addEventListener('change', function () { var f = this.files && this.files[0]; if (f) useAudio(f, f.name); });
    $('fitAudio').checked = !!S.fitAudio;
    $('fitAudio').addEventListener('change', function () { S.fitAudio = this.checked; saveSettings(); renderAll(); });

    // style
    ['format', 'fit', 'motion', 'transition', 'tag'].forEach(function (k) {
      var el = $(k); el.value = S[k];
      el.addEventListener(k === 'tag' ? 'input' : 'change', function () { S[k] = el.value; saveSettings(); if (k === 'format') { dropCaches(); sizePreview(); } renderFacts(); drawPreview(); });
    });
    $('transLen').value = S.transLen; labels();
    $('transLen').addEventListener('input', function () { S.transLen = +this.value; labels(); saveSettings(); renderFacts(); drawPreview(); });

    // preview + export
    $('playBtn').addEventListener('click', togglePlay);
    $('scrub').addEventListener('input', function () { seekTo(+this.value / 1000 * timeline().total); });
    $('exportBtn').addEventListener('click', exportVideo);
    $('cancelBtn').addEventListener('click', function () { if (rec) rec.cancelled = true; });
    window.addEventListener('resize', YB.debounce(function () { sizePreview(); drawPreview(); }, 150));
    document.addEventListener('visibilitychange', function () { if (document.hidden && rec && !rec.cancelled) YB.toast('Keep this screen open — the video is still recording'); });
  }

  function labels() {
    $('lightVal').textContent = S.light;
    $('minVal').textContent = S.minPanel + '%';
    $('transVal').textContent = Number(S.transLen).toFixed(2) + ' s';
  }
  function setTab(t) {
    view.tab = t;
    document.querySelectorAll('[data-view]').forEach(function (b) { var on = b.getAttribute('data-view') === t; b.classList.toggle('on', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
    $('viewPage').hidden = t !== 'page'; $('viewList').hidden = t !== 'list';
  }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }

  // New panel goes right after the last panel of its page that sits above/left of it.
  function insertPanel(q) {
    var idx = -1;
    panels.forEach(function (o, i) { if (o.pageId === q.pageId && (o.y + o.h * 0.5 < q.y || (Math.abs(o.y - q.y) < q.h * 0.33 && o.x < q.x))) idx = i; });
    if (idx === -1) { var first = panels.findIndex(function (o) { return o.pageId === q.pageId; }); idx = first === -1 ? panels.length - 1 : first - 1; }
    panels.splice(idx + 1, 0, q); view.sel = q.id; changed();
  }

  function wireDraw() {
    var stage = $('stage'), start = null, ghost = null;
    function pt(e) {
      var r = $('stageImg').getBoundingClientRect(), p = pages.find(function (x) { return x.id === view.pageId; });
      return { x: clamp((e.clientX - r.left) / r.width, 0, 1) * p.w, y: clamp((e.clientY - r.top) / r.height, 0, 1) * p.h, p: p };
    }
    stage.addEventListener('pointerdown', function (e) {
      if (!view.drawing || !pages.length) return;
      e.preventDefault(); stage.setPointerCapture(e.pointerId);
      start = pt(e); ghost = document.createElement('div'); ghost.className = 'cx-box ghost'; $('boxes').appendChild(ghost);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!start) return;
      var c = pt(e), p = start.p, x = Math.min(start.x, c.x), y = Math.min(start.y, c.y);
      ghost.style.cssText = 'left:' + (x / p.w * 100) + '%;top:' + (y / p.h * 100) + '%;width:' + (Math.abs(c.x - start.x) / p.w * 100) + '%;height:' + (Math.abs(c.y - start.y) / p.h * 100) + '%';
    });
    function end(e) {
      if (!start) return;
      var c = pt(e), p = start.p, x = Math.min(start.x, c.x), y = Math.min(start.y, c.y), w = Math.abs(c.x - start.x), h = Math.abs(c.y - start.y);
      start = null; if (ghost) ghost.remove(); ghost = null;
      if (w < p.w * 0.03 || h < p.h * 0.03) { YB.toast('Drag a bigger box to add a panel'); return; }
      insertPanel({ id: YB.uid(), pageId: p.id, x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), dur: S.dur, motion: '' });
    }
    stage.addEventListener('pointerup', end);
    stage.addEventListener('pointercancel', function () { start = null; if (ghost) ghost.remove(); ghost = null; });
  }

  /* ---------- Sound ---------- */
  function setAudioMode(m) {
    S.audioMode = m; saveSettings();
    document.querySelectorAll('[data-audio]').forEach(function (b) { var on = b.getAttribute('data-audio') === m; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    $('audioVoice').hidden = m !== 'voice'; $('audioFile').hidden = m !== 'file';
    if (m === 'none') clearAudio();
    if (m === 'voice') fillVoiceTakes();
    if (m === 'file') { clearAudio(); var f = $('audioInput').files && $('audioInput').files[0]; if (f) useAudio(f, f.name); }
  }
  function clearAudio() {
    stopPreview();
    if (audio.url) URL.revokeObjectURL(audio.url);
    audio = { blob: null, url: '', dur: 0, name: '' };
    $('audioRow').hidden = true; $('audioCheck').removeAttribute('src');
    renderAll();
  }
  function useAudio(blob, name) {
    stopPreview();
    if (audio.url) URL.revokeObjectURL(audio.url);
    audio = { blob: blob, url: URL.createObjectURL(blob), dur: 0, name: name || 'Voice track' };
    var a = $('audioCheck'); a.src = audio.url; $('audioRow').hidden = false;
    a.onloadedmetadata = function () { audio.dur = isFinite(a.duration) ? a.duration : 0; renderAll(); };
    a.onerror = function () { YB.toast('That audio file couldn\'t be opened'); };
  }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function fillVoiceTakes() {
    var takes = (YB.store.get('voiceTakes', []) || []).filter(function (t) { return t.kind !== 'line'; });
    var opts = takes.map(function (t) {
      var name = (t.kind === 'story' ? '📖 ' + (t.groupTitle || 'Story') + ' — full story' : '🎙️ ' + t.title) + (t.dur ? ' · ' + mmss(t.dur) : '');
      return '<option value="take:' + YB.esc(t.id) + '">' + YB.esc(name) + '</option>';
    });
    opts.push('<option value="lastAudio">Latest audio on the Voice Studio player</option>');
    $('voiceTake').innerHTML = opts.join('');
    if (S.takeId && $('voiceTake').querySelector('option[value="' + S.takeId.replace(/"/g, '') + '"]')) $('voiceTake').value = S.takeId;
    S.takeId = $('voiceTake').value; saveSettings();
    loadVoiceTake();
  }
  function loadVoiceTake() {
    var key = $('voiceTake').value;
    $('voiceTakeNote').textContent = 'Loading…';
    kv('youtube-blue-voice', 'readonly', function (st, out) { var r = st.get(key); r.onsuccess = function () { out.v = r.result; }; }).then(function (v) {
      var blob = v && (v instanceof Blob ? v : v.blob);
      if (!blob) {
        $('voiceTakeNote').textContent = key === 'lastAudio' ? 'Nothing on the Voice Studio player yet — make some audio there first.' : 'That audio isn\'t saved on this device any more.';
        clearAudio(); return;
      }
      $('voiceTakeNote').textContent = 'Using this audio from Voice Studio.';
      useAudio(blob, $('voiceTake').selectedOptions[0] ? $('voiceTake').selectedOptions[0].textContent : 'Voice Studio audio');
    });
  }

  /* ---------- Timeline ---------- */
  // durs: seconds each panel is on screen (fitted to the voice track when chosen). Transitions overlap the end of a panel.
  function timeline(forceFit) {
    var durs = panels.map(function (q) { return q.dur || S.dur; });
    var sum = durs.reduce(function (a, b) { return a + b; }, 0);
    if ((forceFit || S.fitAudio) && audio.dur > 0 && sum > 0) {
      var k = (audio.dur + 0.6) / sum;   // a short breath after the last word
      durs = durs.map(function (d) { return d * k; });
      sum = audio.dur + 0.6;
    }
    var starts = [], t = 0;
    durs.forEach(function (d) { starts.push(t); t += d; });
    return { durs: durs, starts: starts, total: Math.max(t, audio.dur || 0) };
  }

  function renderFacts() {
    if (!panels.length) return;
    var t = timeline(), f = FORMATS[S.format], mime = pickMime();
    $('facts').innerHTML = '<span><b>' + panels.length + '</b> panels</span><span><b>' + mmss(t.total) + '</b> long</span><span><b>' + f[0] + '×' + f[1] + '</b></span><span><b>' + (mime ? (/mp4/.test(mime) ? 'MP4' : 'WebM') : '—') + '</b> video</span>' + (audio.dur ? '<span>🎙️ voice ' + mmss(audio.dur) + '</span>' : '');
    var w = $('lenWarn');
    if (S.format === 'short' && t.total > 180) { w.hidden = false; w.textContent = 'This runs ' + mmss(t.total) + '. YouTube Shorts can be up to 3 minutes; longer videos upload as regular videos. Shorten panel times or split the story.'; }
    else if (!mime) { w.hidden = false; w.textContent = 'This browser can\'t record video. Use Chrome, Edge or Safari (iOS 14.5+).'; }
    else w.hidden = true;
    $('exportBtn').disabled = !mime || !panels.length || !!rec;
  }

  /* ---------- Drawing ---------- */
  var bitmaps = {}, bgs = {};
  function dropCaches() { bitmaps = {}; bgs = {}; }
  function rectKey(q) { return q.id + ':' + q.x + ',' + q.y + ',' + q.w + ',' + q.h; }
  function bitmap(q) {
    var k = rectKey(q); if (bitmaps[k]) return bitmaps[k];
    var p = pageOf(q); if (!p) return null;
    var c = document.createElement('canvas'), s = Math.min(1, 2200 / Math.max(q.w, q.h));
    c.width = Math.max(1, Math.round(q.w * s)); c.height = Math.max(1, Math.round(q.h * s));
    var x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
    x.drawImage(p.img, q.x, q.y, q.w, q.h, 0, 0, c.width, c.height);
    return (bitmaps[k] = c);
  }
  // Soft blurred backdrop: shrink hard, then grow back smoothly (works in every browser, no canvas filters needed).
  function backdrop(q, W, H) {
    var k = rectKey(q) + '@' + W + 'x' + H; if (bgs[k]) return bgs[k];
    var src = bitmap(q); if (!src) return null;
    var tiny = document.createElement('canvas'); tiny.width = Math.max(4, Math.round(W / 40)); tiny.height = Math.max(4, Math.round(H / 40));
    var tx = tiny.getContext('2d'), s = Math.max(tiny.width / src.width, tiny.height / src.height) * 1.15;
    tx.imageSmoothingQuality = 'high';
    tx.drawImage(src, (tiny.width - src.width * s) / 2, (tiny.height - src.height * s) / 2, src.width * s, src.height * s);
    var mid = document.createElement('canvas'); mid.width = Math.round(W / 6); mid.height = Math.round(H / 6);
    var mx = mid.getContext('2d'); mx.imageSmoothingQuality = 'high'; mx.drawImage(tiny, 0, 0, mid.width, mid.height);
    mx.fillStyle = 'rgba(6,16,31,0.42)'; mx.fillRect(0, 0, mid.width, mid.height);
    return (bgs[k] = mid);
  }
  function ease(p) { return 0.5 - Math.cos(Math.PI * clamp(p, 0, 1)) / 2; }
  function easeCubic(p) { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function roundRect(x, X, Y, w, h, r) {
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
  }

  // One panel at motion progress p (0–1). o = { alpha, dx, zoom } for transitions.
  function drawPanel(x, W, H, i, p, o) {
    var q = panels[i]; if (!q) return;
    var src = bitmap(q), bg = backdrop(q, W, H); if (!src) return;
    var u = Math.min(W, H) / 1080;
    x.save();
    x.globalAlpha = o.alpha;
    x.translate(o.dx || 0, 0);
    if (bg) { x.imageSmoothingQuality = 'high'; x.drawImage(bg, -2, -2, W + 4, H + 4); }

    var mode = q.motion || S.motion, fill = S.fit === 'fill', e = ease(p);
    var boxW = fill ? W : W * 0.9, boxH = fill ? H : H * (S.format === 'short' ? 0.70 : 0.84);
    var base = fill ? Math.max(boxW / src.width, boxH / src.height) : Math.min(boxW / src.width, boxH / src.height);
    var dw = src.width * base, dh = src.height * base, overX = dw - W, overY = dh - H;
    if (mode === 'auto') mode = fill && (overX > W * 0.08 || overY > H * 0.08) ? 'pan' : (i % 2 ? 'zoomout' : 'zoomin');
    var z = 1, px = 0, py = 0;
    if (mode === 'zoomin' || mode === 'zoom') z = 1 + 0.07 * e;
    else if (mode === 'zoomout') z = 1.07 - 0.07 * e;
    else if (mode === 'pan') {
      if (fill && overX > 1) px = overX / 2 - overX * e;          // reveal left → right
      else if (fill && overY > 1) py = overY / 2 - overY * e;     // top → bottom
      else { z = 1.04; px = (0.5 - e) * W * 0.035; }
    }
    z *= o.zoom || 1;
    dw *= z; dh *= z;
    var cx = W / 2 + px, cy = (fill ? H / 2 : H * (S.format === 'short' ? 0.47 : 0.5)) + py;
    var X = cx - dw / 2, Y = cy - dh / 2;
    if (fill) {
      x.drawImage(src, X, Y, dw, dh);
    } else {
      var r = 22 * u, b = 7 * u;
      x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 40 * u; x.shadowOffsetY = 14 * u;
      x.fillStyle = '#ffffff'; roundRect(x, X - b, Y - b, dw + 2 * b, dh + 2 * b, r + b); x.fill();
      x.shadowColor = 'transparent';
      x.save(); roundRect(x, X, Y, dw, dh, r); x.clip(); x.drawImage(src, X, Y, dw, dh); x.restore();
    }
    x.restore();
  }

  function drawFrame(x, W, H, t) {
    x.fillStyle = '#06101f'; x.fillRect(0, 0, W, H);
    if (!panels.length) return;
    var tl = timeline(), n = panels.length, T = S.transition === 'cut' ? 0 : Math.max(0.05, S.transLen);
    var i = 0; while (i < n - 1 && t >= tl.starts[i + 1]) i++;
    var startI = tl.starts[i], endI = startI + tl.durs[i];
    var prog = function (j) { var s = tl.starts[j] - (j > 0 ? T : 0), d = tl.durs[j] + (j > 0 ? T : 0); return (t - s) / d; };
    var k = (i < n - 1 && T > 0 && t > endI - T) ? (t - (endI - T)) / T : 0;
    if (k <= 0) drawPanel(x, W, H, i, prog(i), { alpha: 1 });
    else {
      var kk = easeCubic(k);
      if (S.transition === 'slide') {
        drawPanel(x, W, H, i, prog(i), { alpha: 1, dx: -W * kk });
        drawPanel(x, W, H, i + 1, prog(i + 1), { alpha: 1, dx: W * (1 - kk) });
      } else if (S.transition === 'zoom') {
        drawPanel(x, W, H, i, prog(i), { alpha: 1 - kk, zoom: 1 + 0.25 * kk });
        drawPanel(x, W, H, i + 1, prog(i + 1), { alpha: kk, zoom: 0.9 + 0.1 * kk });
      } else {
        drawPanel(x, W, H, i, prog(i), { alpha: 1 });
        drawPanel(x, W, H, i + 1, prog(i + 1), { alpha: kk });
      }
    }
    // channel tag
    if (S.tag) {
      var u = Math.min(W, H) / 1080, fs = Math.round(34 * u);
      x.font = '700 ' + fs + 'px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
      var tw = x.measureText(S.tag).width, ph = fs * 1.9, pw = tw + fs * 1.6, ty = S.format === 'short' ? H * 0.115 : H * 0.07;
      x.fillStyle = 'rgba(6,16,31,0.55)'; roundRect(x, (W - pw) / 2, ty - ph / 2, pw, ph, ph / 2); x.fill();
      x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(S.tag, W / 2, ty + 1);
    }
      // the first frame is the thumbnail YouTube may pick, so no fade-in from black; a soft fade-out at the end
    var f = clamp((t - (tl.total - 0.5)) / 0.5, 0, 1);
    if (f > 0) { x.fillStyle = 'rgba(0,0,0,' + f + ')'; x.fillRect(0, 0, W, H); }
  }

  /* ---------- Preview player ---------- */
  var pv = { t: 0, playing: false, raf: 0, last: 0, el: null };
  function sizePreview() {
    var f = FORMATS[S.format], c = $('preview'), box = $('screen');
    var maxW = Math.min(box.clientWidth || 360, 420), w = f[0] >= f[1] ? maxW : Math.min(maxW, Math.round(520 * f[0] / f[1]));
    var dpr = Math.min(2, window.devicePixelRatio || 1), h = Math.round(w * f[1] / f[0]);
    c.style.width = w + 'px'; c.style.height = h + 'px';
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
  }
  function drawPreview() {
    var c = $('preview'); if (!c.width) return;
    drawFrame(c.getContext('2d'), c.width, c.height, pv.t);
    var total = timeline().total || 0;
    $('scrub').value = total ? Math.round(pv.t / total * 1000) : 0;
    $('timeLabel').textContent = mmss(pv.t) + ' / ' + mmss(total);
  }
  function seekTo(t) {
    pv.t = clamp(t, 0, timeline().total || 0);
    if (pv.el) { try { pv.el.currentTime = Math.min(pv.t, audio.dur || pv.t); } catch (e) { /* not ready */ } }
    drawPreview();
  }
  function togglePlay() { if (pv.playing) stopPreview(); else startPreview(); }
  function startPreview() {
    if (!panels.length || rec) return;
    var total = timeline().total; if (pv.t >= total - 0.05) pv.t = 0;
    pv.playing = true; setPlayBtn(true);
    if (audio.url) {
      pv.el = pv.el || new Audio(); if (pv.el.src !== audio.url) pv.el.src = audio.url;
      try { pv.el.currentTime = Math.min(pv.t, audio.dur || 0); } catch (e) { /* metadata */ }
      if (pv.t < audio.dur) pv.el.play().catch(function () { /* autoplay blocked: silent preview */ });
    }
    pv.last = performance.now();
    var loop = function (now) {
      if (!pv.playing) return;
      var useAudio = pv.el && !pv.el.paused && audio.dur && pv.t < audio.dur;
      pv.t = useAudio ? pv.el.currentTime : pv.t + (now - pv.last) / 1000;
      pv.last = now;
      if (pv.t >= total) { pv.t = total; drawPreview(); stopPreview(); return; }
      drawPreview(); pv.raf = requestAnimationFrame(loop);
    };
    pv.raf = requestAnimationFrame(loop);
  }
  function stopPreview() {
    pv.playing = false; cancelAnimationFrame(pv.raf); setPlayBtn(false);
    if (pv.el) pv.el.pause();
  }
  function setPlayBtn(on) {
    var b = $('playBtn'); b.classList.toggle('is-playing', on); b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? 'Pause preview' : 'Play preview');
  }

  /* ---------- Export ---------- */
  var rec = null, lastVideo = null;
  function pickMime() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return '';
    var list = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1', 'video/mp4',
      'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < list.length; i++) { try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) { /* skip */ } }
    return '';
  }

  function exportVideo() {
    var mime = pickMime(); if (!mime || !panels.length || rec) return;
    stopPreview();
    var f = FORMATS[S.format], W = f[0], H = f[1], total = timeline().total;
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    // warm caches so the first frames don't stutter
    panels.forEach(function (q) { bitmap(q); backdrop(q, W, H); });
    drawFrame(ctx, W, H, 0);

    var stream = canvas.captureStream(30), ac = null, src = null;
    var prep = Promise.resolve();
    if (audio.blob) {
      var AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC();
      prep = audio.blob.arrayBuffer().then(function (buf) {
        return new Promise(function (res, rej) { ac.decodeAudioData(buf, res, rej); });
      }).then(function (decoded) {
        var dest = ac.createMediaStreamDestination();
        src = ac.createBufferSource(); src.buffer = decoded; src.connect(dest);
        dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
      }).catch(function () { YB.toast('The voice track couldn\'t be read — making the video without sound'); src = null; });
    }

    rec = { cancelled: false };
    $('exportProg').hidden = false; $('result').hidden = true; $('exportBtn').disabled = true; $('playBtn').disabled = true;
    $('exportBar').style.width = '0%'; $('exportText').textContent = 'Getting ready…';

    prep.then(function () {
      var chunks = [], mr;
      try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W * H > 2e6 ? 12e6 : 8e6, audioBitsPerSecond: 192000 }); }
      catch (e) { mr = new MediaRecorder(stream); }
      mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      mr.onstop = function () {
        stream.getTracks().forEach(function (tr) { tr.stop(); });
        if (ac) ac.close().catch(function () {});
        var cancelled = rec && rec.cancelled; rec = null;
        $('exportProg').hidden = true; $('playBtn').disabled = false; renderFacts();
        if (cancelled) { YB.toast('Video cancelled'); return; }
        var type = (mr.mimeType || mime).split(';')[0], blob = new Blob(chunks, { type: type });
        showResult(blob, type, total, W, H);
      };
      var t0 = 0, stopped = false;
      function frame() {
        if (stopped) return;
        var t = (performance.now() - t0) / 1000;
        if (rec.cancelled) { stopped = true; try { src && src.stop(); } catch (e) {} mr.stop(); return; }
        drawFrame(ctx, W, H, Math.min(t, total));
        $('exportBar').style.width = Math.min(100, t / total * 100).toFixed(1) + '%';
        $('exportText').textContent = 'Recording ' + mmss(t) + ' of ' + mmss(total);
        if (t >= total) { stopped = true; setTimeout(function () { mr.stop(); }, 200); return; }
        requestAnimationFrame(frame);
      }
      // a hidden tab pauses animation frames; keep frames coming with a timer too
      var keep = setInterval(function () { if (stopped) clearInterval(keep); else if (document.hidden) frame(); }, 1000 / 30);
      var go = function () {
        mr.start(1000);
        t0 = performance.now();
        if (src) src.start(ac.currentTime);
        requestAnimationFrame(frame);
      };
      if (ac && ac.state === 'suspended') ac.resume().then(go, go); else go();
    });
  }

  function showResult(blob, type, total, W, H) {
    if (lastVideo) URL.revokeObjectURL(lastVideo);
    lastVideo = URL.createObjectURL(blob);
    var ext = /mp4/.test(type) ? 'mp4' : 'webm';
    var v = $('resultVideo'); v.src = lastVideo;
    var a = $('downloadBtn'); a.href = lastVideo;
    var first = pages[0] ? pages[0].name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() : 'comic';
    a.download = (first || 'comic') + '-' + (S.format === 'short' ? 'short' : S.format) + '.' + ext;
    $('resultInfo').textContent = ext.toUpperCase() + ' · ' + W + '×' + H + ' · ' + mmss(total) + ' · ' + (blob.size / 1048576).toFixed(1) + ' MB';
    $('result').hidden = false;
    renderSteps();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    YB.toast('Your video is ready');
  }

  /* ---------- Start ---------- */
  function restore() {
    return kv(DB, 'readonly', function (st, out) { var r = st.get('project'); r.onsuccess = function () { out.v = r.result; }; }).then(function (data) {
      if (!data || !data.pages || !data.pages.length) return;
      return data.pages.reduce(function (p, pg) {
        return p.then(function () {
          if (!pg.blob) return;
          return loadImg(pg.blob).then(function (o) {
            pages.push({ id: pg.id, name: pg.name, blob: pg.blob, url: o.url, img: o.img, w: o.img.naturalWidth, h: o.img.naturalHeight });
          }).catch(function () { /* unreadable page skipped */ });
        });
      }, Promise.resolve()).then(function () {
        var ids = pages.map(function (p) { return p.id; });
        panels = (data.panels || []).filter(function (q) { return ids.indexOf(q.pageId) !== -1; });
        view.pageId = pages[0] ? pages[0].id : '';
      });
    });
  }

  wire();
  setTab('page');
  restore().then(function () {
    renderAll();
    setAudioMode(S.audioMode === 'file' ? 'none' : S.audioMode);   // a picked file can't be reopened after a reload
  });
})();
