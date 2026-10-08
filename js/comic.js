/* =========================================================
   Youtube Blue — comic.js · Comic to Video
   1. Add comic pages → panels are found by their white borders (js/comic-panels.js)
      and put in story order. Fix anything by hand: reorder, delete, draw a panel.
   2. Pick a voice track (Voice Studio audio or a file) and a style.
   3. Preview, then record a real video (MediaRecorder: MP4 where the browser can,
      otherwise WebM — YouTube takes both).
   4. Subtitles: one caption per panel (never across two panels), word-by-word
      highlight styles, smart placement for the video shape, translation into up
      to 10 languages (MyMemory) and .srt files for YouTube.
   Everything stays on this device (IndexedDB 'youtube-blue-comic').
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;
  if (!YB) return;
  var $ = function (id) { return document.getElementById(id); };

  /* ---------- Settings ---------- */
  var FORMATS = { short: [1080, 1920], square: [1080, 1080], wide: [1920, 1080] };
  var DEFAULTS = { light: 228, dark: false, minPanel: 6, format: 'short', fit: 'guided', motion: 'auto', transition: 'fade', transLen: 0.35, tag: '', audioMode: 'none', takeId: '', dur: 2.5,
    capOn: true, capStyle: 'pop', capSize: 1, capColor: '#ffffff', capHi: '#ffd60a', capPos: 'auto', capWords: 4, capCaps: false,
    capTiming: true, srcLang: 'en', langs: ['en'], showLang: 'en', mmEmail: '',
    bg: 'blur', bgColor: '#10213f', frame: 'white', overlay: 'none', uploadMode: 'comic', capPace: 15 };
  // One-tap looks: background + frame + overlay together.
  var TEMPLATES = [
    { id: 'classic', name: 'Classic', ico: '🎞️', bg: 'blur', frame: 'white', overlay: 'none' },
    { id: 'comic', name: 'Comic pop', ico: '💥', bg: 'halftone', bgColor: '#1e7bff', frame: 'comic', overlay: 'vignette' },
    { id: 'cinema', name: 'Cinema', ico: '🎬', bg: 'solid', bgColor: '#050505', frame: 'clean', overlay: 'grain' },
    { id: 'neon', name: 'Neon night', ico: '🌃', bg: 'gradient', bgColor: '#2a0e5c', frame: 'neon', overlay: 'vignette' },
    { id: 'scrapbook', name: 'Scrapbook', ico: '📒', bg: 'paper', frame: 'polaroid', overlay: 'none' },
    { id: 'sunburst', name: 'Sunburst', ico: '☀️', bg: 'rays', bgColor: '#ff8a00', frame: 'white', overlay: 'vignette' },
    { id: 'storybook', name: 'Storybook', ico: '📖', bg: 'blur', frame: 'clean', overlay: 'leak' }
  ];
  // The most-watched languages on YouTube (pick up to 10).
  var LANGS = [['en', 'English'], ['es', 'Spanish'], ['hi', 'Hindi'], ['pt', 'Portuguese'], ['ar', 'Arabic'], ['fr', 'French'], ['id', 'Indonesian'],
    ['ja', 'Japanese'], ['de', 'German'], ['ru', 'Russian'], ['ko', 'Korean'], ['zh-CN', 'Chinese'], ['it', 'Italian'], ['tr', 'Turkish'], ['vi', 'Vietnamese'], ['bn', 'Bengali']];
  var MAX_LANGS = 10, RTL = ['ar'], NO_SPACES = ['ja', 'zh-CN'];
  function langName(c) { var l = LANGS.find(function (x) { return x[0] === c; }); return l ? l[1] : c; }
  var S = Object.assign({}, DEFAULTS, YB.store.get('comicSettings', {}));
  function saveSettings() { YB.store.set('comicSettings', S); }
  if (!S.lookV2) { S.fit = 'guided'; S.lookV2 = true; saveSettings(); }   // new default look: guided view over the real page

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
  var S_match = null;   // how the captions were placed: { how: 'ocr'|'even', read, panels, lines }
  var saveProject = YB.debounce(function () {
    var data = {
      pages: pages.map(function (p) { return { id: p.id, name: p.name, blob: p.blob }; }),
      panels: panels.map(function (q) { return { id: q.id, pageId: q.pageId, x: q.x, y: q.y, w: q.w, h: q.h, dur: q.dur, motion: q.motion || '', cap: q.cap || {}, who: q.who || '', storyId: q.storyId || '', lines: q.lines || null, capMatch: q.capMatch || '', capEdited: !!q.capEdited }; }),
      match: S_match
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
      // Single images: the whole picture is one slide. Comic pages: find the panels.
      panels = panels.concat(S.uploadMode === 'images' ? [newPanel(page, { x: 0, y: 0, w: page.w, h: page.h })] : detect(page));
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
        var single = n > 0 && n === files.length && S.uploadMode !== 'images';
        if (S.uploadMode === 'images') { YB.toast(n + ' image' + (n === 1 ? '' : 's') + ' added — each is one slide'); dropCaches(); saveProject(); renderAll(); return; }
        YB.toast(!n ? 'No pages added' : single ? 'Couldn\'t see panel borders — use ✏️ Draw or ✂ Split' : 'Found ' + n + ' panels — check the order below');
        dropCaches(); saveProject(); renderAll();
      });
  }

  function curPage() { return pages.find(function (x) { return x.id === view.pageId; }); }
  function pagePanels(id) { return panels.filter(function (q) { return q.pageId === id; }); }
  function newPanel(p, r) { return { id: YB.uid(), pageId: p.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h), dur: S.dur, motion: '' }; }
  // Replace one page's panels, keeping them where that page sits in the video.
  function setPagePanels(pageId, list) {
    var at = panels.findIndex(function (q) { return q.pageId === pageId; });
    if (at === -1) {   // after the panels of earlier pages
      var pi = pageNo(pageId) - 1; at = panels.filter(function (q) { return pageNo(q.pageId) - 1 < pi; }).length;
    }
    panels = panels.filter(function (q) { return q.pageId !== pageId; });
    panels.splice.apply(panels, [at, 0].concat(list));
    view.sel = ''; chunkCache = {}; dropCaches(); changed();
  }
  // Split the selected panel in two along its most gutter-like line near the middle.
  function splitSelected(horizontal) {
    var i = panels.findIndex(function (q) { return q.id === view.sel; }), q = panels[i], p = q && pageOf(q);
    if (!p || !window.YBPanels) return;
    var sc = Math.min(1, 900 / Math.max(q.w, q.h)), w = Math.max(1, Math.round(q.w * sc)), h = Math.max(1, Math.round(q.h * sc));
    var c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(p.img, q.x, q.y, q.w, q.h, 0, 0, w, h);
    var cut = window.YBPanels.splitLine(x.getImageData(0, 0, w, h), { x: 0, y: 0, w: w, h: h }, horizontal) / sc;
    var a = Object.assign({}, q), b = newPanel(p, q);
    if (horizontal) { a.h = Math.round(cut); b.y = q.y + a.h; b.h = q.h - a.h; } else { a.w = Math.round(cut); b.x = q.x + a.w; b.w = q.w - a.w; }
    b.dur = q.dur; b.motion = q.motion;
    panels.splice(i, 1, a, b); view.sel = a.id; chunkCache = {}; dropCaches(); changed();
    YB.toast('Split into two panels');
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
    var si = panels.findIndex(function (q) { return q.id === view.sel; });
    $('selTools').hidden = si === -1;
    $('selNum').textContent = si === -1 ? '' : '#' + (si + 1);
  }

  var MOTIONS = [['', 'Motion: video setting'], ['zoomin', 'Zoom in'], ['zoomout', 'Zoom out'], ['pan', 'Pan across'], ['still', 'Still']];
  function renderList() {
    var t = timeline();
    $('panelList').innerHTML = panels.map(function (q, i) {
      var eff = t.durs[i], fitted = Math.abs(eff - q.dur) > 0.05, synced = !!t.sync;
      return '<li class="cx-panel' + (q.id === view.sel ? ' on' : '') + '" data-id="' + q.id + '">' +
        '<span class="cx-pnum">' + (i + 1) + '</span><canvas class="cx-thumb" width="120" height="120" data-thumb="' + q.id + '"></canvas>' +
        '<div class="cx-pmeta"><span class="muted small">Page ' + pageNo(q.pageId) + (synced ? ' · <b class="cx-synced">🎯 ' + eff.toFixed(1) + ' s, timed to the voice</b>' : fitted ? ' · plays ' + eff.toFixed(1) + ' s' : '') + '</span>' +
        '<span class="cx-pctl"><input type="number" min="0.5" max="20" step="0.5" value="' + (synced ? eff.toFixed(1) : q.dur) + '" data-dur aria-label="Seconds for panel ' + (i + 1) + '"' + (synced ? ' disabled title="Timed to the voice automatically"' : '') + '><span class="muted small">s</span>' +
        '<select data-motion aria-label="Motion for panel ' + (i + 1) + '">' + MOTIONS.map(function (m) { return '<option value="' + m[0] + '"' + ((q.motion || '') === m[0] ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></span></div>' +
        '<div class="cx-pbtns"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-up aria-label="Move earlier"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-down aria-label="Move later"' + (i === panels.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn btn-danger btn-icon btn-sm" data-del aria-label="Remove panel ' + (i + 1) + '">✕</button></div>' +
        '<label class="cx-cap"><span class="muted small">💬 Caption · ' + YB.esc(langName(S.showLang)) + (S.showLang !== S.srcLang && !capOf(q, S.showLang) && capOf(q, S.srcLang) ? ' · not translated yet' : '') +
        (q.lines && q.lines.length && !q.capEdited && q.storyId ? ' <span class="cx-mv">' +
          (i > 0 ? '<button type="button" class="cx-mvbtn" data-mvprev aria-label="Move the first line of panel ' + (i + 1) + ' to the panel before">◀ line</button>' : '') +
          (i < panels.length - 1 ? '<button type="button" class="cx-mvbtn" data-mvnext aria-label="Move the last line of panel ' + (i + 1) + ' to the next panel">line ▶</button>' : '') + '</span>' : '') + '</span>' +
        '<textarea data-cap rows="2" dir="' + (RTL.indexOf(S.showLang) !== -1 ? 'rtl' : 'ltr') + '" placeholder="What\'s said in this panel (optional)">' + YB.esc(capOf(q, S.showLang)) + '</textarea></label></li>';
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
    $('subsCard').hidden = !ready;
    $('exportCard').hidden = !ready;
    $('panelCount').textContent = ready ? '· ' + panels.length + ' in order' : '';
    document.querySelectorAll('.cx-steps li').forEach(function (li) {
      var n = +li.getAttribute('data-step');
      li.classList.toggle('done', n === 1 ? has : n === 2 ? ready : n === 3 ? ready : results.length > 0);
    });
  }

  function renderAll() {
    renderPages(); renderStage(); renderList(); renderSteps(); renderFacts(); sizePreview(); drawPreview();
    if (typeof syncNoteText === "function" && audio.sync) syncNoteText();
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
    // panel tools (current page)
    $('findBtn').addEventListener('click', function () {
      var p = curPage(); if (!p) return;
      if (pagePanels(p.id).length > 1 && !confirm('Find the panels on this page again? Its panels, order and captions are replaced.')) return;
      var found = detect(p); setPagePanels(p.id, found);
      YB.toast(found.length > 1 ? 'Found ' + found.length + ' panels' : 'Couldn\'t see panel borders — use ✏️ Draw or ✂ Split');
    });
    $('splitHBtn').addEventListener('click', function () { splitSelected(true); });
    $('splitVBtn').addEventListener('click', function () { splitSelected(false); });
    $('selDelBtn').addEventListener('click', function () { if (view.sel) removePanel(view.sel); });

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
      insertPanel({ id: YB.uid(), pageId: p.id, x: 0, y: 0, w: p.w, h: p.h, dur: Math.max(S.dur, 5), motion: '' });
      var n = detect(p).length;
      if (n > 1) YB.toast('Added the whole page. Tip: 🔍 Find panels splits it into ' + n + ' panels for a phone-sized video');
    });
    wireDraw();

    // list
    $('panelList').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]'); if (!li) return;
      var id = li.getAttribute('data-id'), i = panels.findIndex(function (q) { return q.id === id; });
      if (e.target.closest('[data-mvprev]')) { e.preventDefault(); moveLine(i, -1); return; }
      if (e.target.closest('[data-mvnext]')) { e.preventDefault(); moveLine(i, 1); return; }
      if (e.target.closest('[data-up]')) { move(panels, i, -1); changed(); }
      else if (e.target.closest('[data-down]')) { move(panels, i, 1); changed(); }
      else if (e.target.closest('[data-del]')) removePanel(id);
      else if (!e.target.closest('input,select,textarea,label')) { view.sel = id; renderList(); seekTo(timeline().starts[i] + 0.05); }
    });
    $('panelList').addEventListener('input', function (e) {
      if (!e.target.matches('[data-cap]')) return;
      var li = e.target.closest('li[data-id]'), q = li && panels.find(function (x) { return x.id === li.getAttribute('data-id'); }); if (!q) return;
      setCap(q, S.showLang, e.target.value);
      if (S.showLang === S.srcLang) q.capEdited = true;   // your own words: never re-placed automatically
      saveProject(); renderFacts(); drawPreview();
    });
    $('panelList').addEventListener('change', function (e) {
      var li = e.target.closest('li[data-id]'); if (!li) return;
      if (e.target.matches('[data-cap]')) { renderList(); return; }
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

    // sound
    document.querySelectorAll('[data-audio]').forEach(function (b) { b.addEventListener('click', function () { setAudioMode(b.getAttribute('data-audio')); }); });
    $('voiceTake').addEventListener('change', function () { S.takeId = this.value; saveSettings(); loadVoiceTake(); });
    $('audioInput').addEventListener('change', function () { var f = this.files && this.files[0]; if (f) useAudio(f, f.name); });

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
    if (typeof renderNarr === 'function') renderNarr();
    if (m === 'narrate') { clearAudio(); loadVoiceLists(); applyNarration(); }
    if (m === 'none') clearAudio();
    if (m === 'voice') fillVoiceTakes();
    if (m === 'file') { clearAudio(); var f = $('audioInput').files && $('audioInput').files[0]; if (f) useAudio(f, f.name); }
  }
  function clearAudio() {
    stopPreview();
    if (audio.url) URL.revokeObjectURL(audio.url);
    audio = { blob: null, url: '', dur: 0, name: '', sync: null };
    $('audioRow').hidden = true; $('syncNote').hidden = true; $('syncNote').textContent = ''; $('audioCheck').removeAttribute('src');
    renderAll();
  }
  function useAudio(blob, name, marks) {
    stopPreview();
    if (audio.url) URL.revokeObjectURL(audio.url);
    audio = { blob: blob, url: URL.createObjectURL(blob), dur: 0, name: name || 'Voice track', sync: null, marks: Array.isArray(marks) && marks.length ? marks : null };
    var a = $('audioCheck'); a.src = audio.url; $('audioRow').hidden = false;
    a.onloadedmetadata = function () { audio.dur = isFinite(a.duration) ? a.duration : 0; renderAll(); };
    analyzeVoice(blob);
    if (typeof autoMatch === 'function') autoMatch();
    a.onerror = function () { YB.toast('That audio file couldn\'t be opened'); };
  }
  /* ---------- Auto-sync: panels and captions follow the voice (js/comic-sync.js) ---------- */
  // Runs by itself whenever audio is added: finds the speech and the pauses, then the timeline
  // places each panel on the words that belong to it and times every caption to its words.
  function analyzeVoice(blob) {
    var mine = audio, note = $('syncNote');
    if (!window.YBAudioSync) return;
    note.hidden = false; note.textContent = '🎯 Lining the pictures and captions up with the voice…';
    blob.arrayBuffer().then(function (buf) {
      function dec(ctx, b) { return new Promise(function (res, rej) { var p = ctx.decodeAudioData(b, res, rej); if (p && p.then) p.then(res, rej); }); }
      var Off = window.OfflineAudioContext || window.webkitOfflineAudioContext, copy = buf.slice(0);
      var first;
      try { first = dec(new Off(1, 22050, 22050), buf); } catch (e) { first = Promise.reject(e); }
      return first.catch(function () {   // some browsers only decode in a normal audio context
        var AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
        return dec(ac, copy).then(function (ab) { try { ac.close(); } catch (e) { /* ignore */ } return ab; });
      });
    }).then(function (ab) {
      if (audio !== mine) return;
      var n = ab.length, mono = new Float32Array(n);
      for (var c = 0; c < ab.numberOfChannels; c++) { var d = ab.getChannelData(c); for (var i = 0; i < n; i++) mono[i] += d[i] / ab.numberOfChannels; }
      audio.sync = window.YBAudioSync.analyze(mono, ab.sampleRate);
      // a Voice Studio story track carries the exact time of every line
      if (audio.marks && audio.marks[audio.marks.length - 1].e <= ab.duration + 1) audio.sync.marks = audio.marks;
      if (!audio.dur) audio.dur = ab.duration;
      syncCache = {};
      renderAll(); syncNoteText();
    }).catch(function () { if (audio === mine) { note.textContent = 'Couldn\'t read this audio to sync it — panels keep their own times.'; } });
  }
  var syncCache = {};
  function syncOn() { return !!(audio.sync && (S.audioMode === 'voice' || S.audioMode === 'file') && panels.length); }
  function syncWeights() {
    return panels.map(function (q) { return window.YBAudioSync.weight(capOf(q, S.srcLang) || capOf(q, S.showLang)); });
  }
  function syncPlan() {
    if (!syncOn()) return null;
    var w = syncWeights(), key = audio.url + '|' + panels.map(function (q, i) { return q.id + ':' + w[i] + ':' + (capOf(q, S.srcLang) || capOf(q, S.showLang)).length; }).join(',');
    if (!syncCache[key]) syncCache = {}, syncCache[key] = window.YBAudioSync.plan(audio.sync, w, panels.map(function (q) { return capOf(q, S.srcLang) || capOf(q, S.showLang); }));
    return syncCache[key];
  }
  function syncNoteText() {
    var note = $('syncNote'); if (!note || !audio.sync) return;
    note.hidden = false;
    var pl = syncPlan();
    if (!panels.length) note.textContent = '🎯 Voice ready — panels will follow it automatically as soon as you add them.';
    else if (!audio.sync.segs.length) note.textContent = 'No speech found in this audio, so the panels share it evenly.';
    else note.textContent = '🎯 Synced automatically' + (pl && pl.exact ? ' to every line of the story track' : '') + ': ' + panels.length + ' panel' + (panels.length === 1 ? '' : 's') + (pl && pl.exact ? ' start right before their lines' : ' change in the pauses') + (hasCaptions() ? ', and captions appear as their words are spoken' : '') + '.';
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
      var meta = key.indexOf('take:') === 0 ? (YB.store.get('voiceTakes', []) || []).find(function (x) { return 'take:' + x.id === key; }) : null;
      useAudio(blob, $('voiceTake').selectedOptions[0] ? $('voiceTake').selectedOptions[0].textContent : 'Voice Studio audio', meta && meta.marks);
      // a story track on panels with no captions yet: put that story's lines on the panels that show them
      if (meta && meta.kind === 'story' && panels.length && !captionedCount()) {
        var st = (YB.store.get('stories', []) || []).find(function (x) { return x.title === meta.groupTitle; });
        if (st) { $('capStory').value = st.id; fillFromStory({ auto: true }); }
      }
    });
  }

  /* ---------- Timeline ---------- */
  // durs: seconds each panel is on screen (your own timing; panels are never stretched to the voice).
  // The voice track always plays untouched; the video runs until both the panels and the voice are done.
  function timeline() {
    var durs = panels.map(function (q) { return q.dur || S.dur; });
    if (typeof narrOn === 'function' && narrOn()) {
      // narration: each panel lasts as long as its own spoken clip (plus a short breath)
      var tlN = panels.map(function (q, i) { var c = clipFor(q); return c ? Math.max(1.2, NARR_LEAD + c.dur + NARR_GAP) : durs[i]; });
      var startsN = [], tN = 0; tlN.forEach(function (d) { startsN.push(tN); tN += d; });
      return { durs: tlN, starts: startsN, total: tN };
    }
    var sp = typeof syncPlan === 'function' ? syncPlan() : null;
    if (sp) {
      // synced to the voice track: panel times come from the speech, not the number boxes
      var dS = sp.ends.map(function (e, i) { return e - sp.starts[i]; });
      return { durs: dS, starts: sp.starts.slice(), total: Math.max(sp.ends[sp.ends.length - 1], (audio.dur || 0) + 0.35), sync: sp };
    }
    // Voice added but not analysed (yet, or this device can't): still fit every panel inside the voice,
    // sharing its length by how much each caption says — never longer than the audio.
    if (audio.dur && (S.audioMode === 'voice' || S.audioMode === 'file') && panels.length && window.YBAudioSync) {
      var wts = panels.map(function (q) { return window.YBAudioSync.weight(capOf(q, S.srcLang) || capOf(q, S.showLang)) || 0; });
      var avgW = wts.reduce(function (a, b) { return a + b; }, 0) / panels.length || 1;
      wts = wts.map(function (v) { return v > 0 ? v : avgW * 0.35; });
      var sumW = wts.reduce(function (a, b) { return a + b; }, 0), span = audio.dur + 0.3;
      var dF = wts.map(function (v) { return span * v / sumW; }), sF = [], tF = 0;
      dF.forEach(function (d) { sF.push(tF); tF += d; });
      return { durs: dF, starts: sF, total: span };
    }
    if (S.capOn && S.capTiming) {
      // every panel stays up long enough to read its caption at the chosen pace
      durs = panels.map(function (q, i) {
        var t = capOf(q, S.showLang); if (!t) return durs[i];
        var need = chunksFor(t, S.showLang).reduce(function (a, c) { return a + Math.max(0.9, (c.words.join(' ').length + 2) / (S.capPace || 15)); }, 0) + 0.35;
        return Math.max(durs[i], need);
      });
    }
    var starts = [], t = 0;
    durs.forEach(function (d) { starts.push(t); t += d; });
    return { durs: durs, starts: starts, total: Math.max(t, audio.dur || 0) };
  }

  function renderFacts() {
    if (!panels.length) return;
    var t = timeline(), f = FORMATS[S.format], mime = pickMime();
    $('facts').innerHTML = '<span><b>' + panels.length + '</b> panels</span><span><b>' + mmss(t.total) + '</b> long</span><span><b>' + f[0] + '×' + f[1] + '</b></span><span><b>' + (fastAvailable() && fastOk !== false ? 'MP4' : mime ? (/mp4/.test(mime) ? 'MP4' : 'WebM') : '—') + '</b> video</span>' + (audio.dur ? '<span>🎙️ voice ' + mmss(audio.dur) + '</span>' : '') + (S.capOn && hasCaptions() ? '<span>💬 ' + YB.esc(langName(S.showLang)) + ' subtitles</span>' : '');
    var w = $('lenWarn');
    if (S.format === 'short' && t.total > 180) { w.hidden = false; w.textContent = 'This runs ' + mmss(t.total) + '. YouTube Shorts can be up to 3 minutes; longer videos upload as regular videos. Shorten panel times or split the story.'; }
    else if (!mime && !fastAvailable()) { w.hidden = false; w.textContent = 'This browser can\'t make videos. Use Chrome, Edge or Safari.'; }
    else w.hidden = true;
    $('exportBtn').disabled = (!mime && !fastAvailable()) || !panels.length || !!rec;
  }

  /* ---------- Drawing ---------- */
  var bitmaps = {}, bgs = {};
  function dropCaches() { bitmaps = {}; bgs = {}; looks = {}; lruStore = {}; lruOrder = []; if (typeof pageCache !== 'undefined') pageCache = {}; }
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
  /* ---------- Looks: backgrounds, frames, overlays ---------- */
  var custom = { bg: null, ov: null }, looks = {};
  // Small "most recently used" cache for big full-size canvases (keeps memory in check).
  var lruStore = {}, lruOrder = [];
  function lru(key, make, max) {
    if (lruStore[key]) { lruOrder = lruOrder.filter(function (k) { return k !== key; }); lruOrder.push(key); return lruStore[key]; }
    var v = make(); lruStore[key] = v; lruOrder.push(key);
    while (lruOrder.length > (max || 6)) delete lruStore[lruOrder.shift()];
    return v;
  }
  function fullCanvas(W, H, paint) { var c = document.createElement('canvas'); c.width = W; c.height = H; var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; paint(x); return c; }
  function lookKey(W, H) { return S.bg + '|' + S.bgColor + '|' + W + 'x' + H; }
  function shade(hex, f) {   // f < 0 darker, > 0 lighter
    var n = parseInt(String(hex || '#10213f').slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    function m(c) { return Math.round(f < 0 ? c * (1 + f) : c + (255 - c) * f); }
    return 'rgb(' + m(r) + ',' + m(g) + ',' + m(b) + ')';
  }
  // Fit an image to W×H like CSS "cover": keeps its proportions, centres it, trims the overflow.
  function coverDraw(x, img, W, H) {
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height, s = Math.max(W / iw, H / ih);
    x.drawImage(img, (W - iw * s) / 2, (H - ih * s) / 2, iw * s, ih * s);
  }
  function lookCanvas(W, H) {
    var k = lookKey(W, H); if (looks[k]) return looks[k];
    var w = Math.round(W / 2), h = Math.round(H / 2), c = document.createElement('canvas'); c.width = w; c.height = h;
    var x = c.getContext('2d'), col = S.bgColor;
    if (S.bg === 'custom' && custom.bg) { c.width = W; c.height = H; x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; coverDraw(x, custom.bg, W, H); }
    else if (S.bg === 'gradient') {
      var g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, shade(col, 0.18)); g.addColorStop(1, shade(col, -0.6));
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      var r = x.createRadialGradient(w * 0.5, h * 0.3, 0, w * 0.5, h * 0.3, Math.max(w, h) * 0.7); r.addColorStop(0, 'rgba(255,255,255,0.18)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = r; x.fillRect(0, 0, w, h);
    } else if (S.bg === 'halftone') {
      x.fillStyle = col; x.fillRect(0, 0, w, h);
      var step = Math.max(10, Math.round(w / 26)); x.fillStyle = shade(col, 0.32);
      for (var yy = 0; yy < h + step; yy += step) for (var xx = 0; xx < w + step; xx += step) {
        var dx = xx - w / 2, dy = yy - h / 2, dd = Math.sqrt(dx * dx + dy * dy) / Math.max(w, h);
        var rad = step * 0.42 * (1 - Math.min(1, dd * 1.4)) + 1;
        x.beginPath(); x.arc(xx + ((yy / step) % 2 ? step / 2 : 0), yy, rad, 0, Math.PI * 2); x.fill();
      }
    } else if (S.bg === 'paper') {
      x.fillStyle = '#f3ead6'; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(70,110,170,0.18)'; x.lineWidth = Math.max(1, w / 400);
      for (var ly = h * 0.08; ly < h; ly += h / 28) { x.beginPath(); x.moveTo(0, ly); x.lineTo(w, ly); x.stroke(); }
      x.strokeStyle = 'rgba(220,80,80,0.25)'; x.beginPath(); x.moveTo(w * 0.1, 0); x.lineTo(w * 0.1, h); x.stroke();
      var pv = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75); pv.addColorStop(0, 'rgba(120,90,40,0)'); pv.addColorStop(1, 'rgba(120,90,40,0.22)');
      x.fillStyle = pv; x.fillRect(0, 0, w, h);
    } else if (S.bg === 'rays') {
      x.fillStyle = shade(col, -0.15); x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h * 0.45); x.fillStyle = shade(col, 0.22);
      var R = Math.max(w, h) * 1.2, n = 18;
      for (var a = 0; a < n; a++) { var a0 = a / n * Math.PI * 2, a1 = a0 + Math.PI / n; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a0) * R, Math.sin(a0) * R); x.lineTo(Math.cos(a1) * R, Math.sin(a1) * R); x.closePath(); x.fill(); }
      x.restore();
    } else { x.fillStyle = col; x.fillRect(0, 0, w, h); }
    return (looks[k] = c);
  }
  function drawBg(x, W, H, q) {
    var blur = S.bg === 'blur' || (S.bg === 'custom' && !custom.bg);
    var key = 'bg|' + (blur ? rectKey(q) : lookKey(W, H)) + '|' + W + 'x' + H;
    var full = lru(key, function () {
      var c = blur ? backdrop(q, W, H) : lookCanvas(W, H);
      return fullCanvas(W, H, function (fx) { if (c) fx.drawImage(c, -2, -2, W + 4, H + 4); });
    }, 8);
    x.drawImage(full, 0, 0);   // one straight copy per frame
  }
  // Draws the frame style around a picture area and the picture itself (paint draws into X,Y,w,h).
  function framed(x, X, Y, w, h, u, idx, paint) {
    var st = S.frame;
    x.save();
    if (st === 'polaroid') {
      var rot = ((idx || 0) % 2 ? 1 : -1) * 1.2 * Math.PI / 180, side = 16 * u, bottom = 56 * u;
      x.translate(X + w / 2, Y + h / 2); x.rotate(rot); x.translate(-(X + w / 2), -(Y + h / 2));
      x.shadowColor = 'rgba(0,0,0,0.45)'; x.shadowBlur = 30 * u; x.shadowOffsetY = 12 * u;
      x.fillStyle = '#fbfaf7'; x.fillRect(X - side, Y - side, w + side * 2, h + side + bottom); x.shadowColor = 'transparent';
      x.save(); x.beginPath(); x.rect(X, Y, w, h); x.clip(); paint(); x.restore();
    } else if (st === 'comic') {
      var b = 9 * u;
      x.fillStyle = '#000'; x.fillRect(X - b + 12 * u, Y - b + 14 * u, w + 2 * b, h + 2 * b);   // hard offset shadow
      x.fillRect(X - b, Y - b, w + 2 * b, h + 2 * b);
      x.save(); x.beginPath(); x.rect(X, Y, w, h); x.clip(); paint(); x.restore();
    } else if (st === 'neon') {
      var r = 20 * u, glow = '#38bdf8';
      x.shadowColor = glow; x.shadowBlur = 38 * u; x.strokeStyle = glow; x.lineWidth = 6 * u;
      roundRect(x, X - 3 * u, Y - 3 * u, w + 6 * u, h + 6 * u, r); x.stroke(); x.stroke();
      x.shadowColor = 'transparent';
      x.save(); roundRect(x, X, Y, w, h, r); x.clip(); paint(); x.restore();
    } else if (st === 'none') {
      x.save(); x.beginPath(); x.rect(X, Y, w, h); x.clip(); paint(); x.restore();
    } else {
      var rr = 22 * u, bb = st === 'clean' ? 0 : 7 * u;
      x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 40 * u; x.shadowOffsetY = 14 * u;
      x.fillStyle = st === 'clean' ? '#000' : '#ffffff'; roundRect(x, X - bb, Y - bb, w + 2 * bb, h + 2 * bb, rr + bb); x.fill();
      x.shadowColor = 'transparent';
      x.save(); roundRect(x, X, Y, w, h, rr); x.clip(); paint(); x.restore();
    }
    x.restore();
  }
  var grainTile = null;
  function drawOverlay(x, W, H, t) {
    var o = S.overlay; if (o === 'none') return;
    if (o === 'vignette' || o === 'dots' || o === 'custom') {
      if (o === 'custom' && !custom.ov) return;
      x.drawImage(lru('ov|' + o + '|' + W + 'x' + H + (o === 'custom' ? '|' + (custom.ov.src || '') : ''), function () {
        return fullCanvas(W, H, function (fx) { paintOverlay(fx, W, H, 0, o); });
      }, 8), 0, 0);
      return;
    }
    paintOverlay(x, W, H, t, o);
  }
  function paintOverlay(x, W, H, t, o) {
    x.save();
    if (o === 'custom' && custom.ov) { x.imageSmoothingQuality = 'high'; coverDraw(x, custom.ov, W, H); }
    else if (o === 'vignette') {
      var v = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.72);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.55)'); x.fillStyle = v; x.fillRect(0, 0, W, H);
    } else if (o === 'grain') {
      if (!grainTile) {
        grainTile = document.createElement('canvas'); grainTile.width = grainTile.height = 192;
        var gx = grainTile.getContext('2d'), id = gx.createImageData(192, 192);
        for (var i = 0; i < id.data.length; i += 4) { var n = Math.random() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = n; id.data[i + 3] = 26; }
        gx.putImageData(id, 0, 0);
      }
      var off = Math.floor(t * 24) % 8, ox = (off * 53) % 192, oy = (off * 97) % 192;
      x.translate(-ox, -oy); x.fillStyle = x.createPattern(grainTile, 'repeat'); x.fillRect(0, 0, W + 192, H + 192);
    } else if (o === 'dots') {
      var step = Math.round(Math.min(W, H) / 40); x.fillStyle = 'rgba(0,0,0,0.16)';
      for (var yy = 0; yy < H; yy += step) for (var xx = 0; xx < W; xx += step) {
        var ex = Math.min(1, Math.max(Math.abs(xx - W / 2) / (W / 2), Math.abs(yy - H / 2) / (H / 2)));
        if (ex < 0.72) continue; x.beginPath(); x.arc(xx, yy, step * 0.38 * (ex - 0.72) / 0.28, 0, Math.PI * 2); x.fill();
      }
    } else if (o === 'leak') {
      x.globalCompositeOperation = 'screen';
      var cx = W * (0.15 + 0.1 * Math.sin(t * 0.4)), lg = x.createRadialGradient(cx, H * 0.1, 0, cx, H * 0.1, Math.max(W, H) * 0.6);
      lg.addColorStop(0, 'rgba(255,150,60,0.35)'); lg.addColorStop(1, 'rgba(255,90,120,0)'); x.fillStyle = lg; x.fillRect(0, 0, W, H);
    }
    x.restore();
  }

  function ease(p) { return 0.5 - Math.cos(Math.PI * clamp(p, 0, 1)) / 2; }
  function easeCubic(p) { p = clamp(p, 0, 1); return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function roundRect(x, X, Y, w, h, r) {
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
  }

  // One panel at motion progress p (0–1). o = { alpha, dx, zoom } for transitions.
  function drawPanel(x, W, H, i, p, o) {
    var q = panels[i]; if (!q) return;
    var src = bitmap(q); if (!src) return;
    var u = Math.min(W, H) / 1080;
    x.save();
    x.globalAlpha = o.alpha;
    x.translate(o.dx || 0, 0);
    drawBg(x, W, H, q);

    var mode = q.motion || S.motion, fill = S.fit === 'fill', e = ease(p);
    var room = capRoom(), short = S.format === 'short';
    var boxW = fill ? W : W * 0.9, boxH = fill ? H : H * (short ? (room ? 0.58 : 0.70) : (room ? (S.format === 'square' ? 0.62 : 0.68) : 0.84));
    var base = fill ? Math.max(boxW / src.width, boxH / src.height) : Math.min(boxW / src.width, boxH / src.height);
    // a tall panel (or a whole page) is shown full width and read top → bottom instead of shrinking
    var scroll = !fill && src.height / src.width > (boxH / boxW) * 1.25;
    if (scroll) base = boxW / src.width;
    var dw = src.width * base, dh = src.height * base, overX = dw - W, overY = dh - H;
    if (mode === 'auto') mode = fill && (overX > W * 0.08 || overY > H * 0.08) ? 'pan' : (i % 2 ? 'zoomout' : 'zoomin');
    if (scroll) mode = 'still';
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
    var cx = W / 2 + px, cy = (fill ? H / 2 : H * (short ? (room ? 0.39 : 0.47) : (room ? (S.format === 'square' ? 0.38 : 0.41) : 0.5))) + py;
    var X = cx - dw / 2, Y = cy - dh / 2;
    if (scroll) {
      var winH = boxH, top = cy - winH / 2, hold = clamp((p - 0.12) / 0.76, 0, 1);
      if (!o.dx) lastRect[i] = { top: top, bottom: top + winH };
      framed(x, X, top, dw, winH, u, i, function () { x.drawImage(src, X, top - (dh - winH) * ease(hold), dw, dh); });
      x.restore();
      return;
    }
    if (!o.dx) lastRect[i] = { top: Math.max(0, Y), bottom: Math.min(H, Y + dh) };
    if (fill) {
      x.drawImage(src, X, Y, dw, dh);
    } else {
      // the framed panel (border, shadow, picture) is drawn once at its largest size and reused every frame
      var zmax = 1.12, dw0 = dw / z, dh0 = dh / z, pad = Math.round(90 * u);
      var sk = 'sp|' + rectKey(q) + '|' + S.frame + '|' + Math.round(dw0) + 'x' + Math.round(dh0) + '|' + (i % 2);
      var sp = lru(sk, function () {
        var sw = Math.ceil(dw0 * zmax + pad * 2), sh = Math.ceil(dh0 * zmax + pad * 2);
        return fullCanvas(sw, sh, function (fx) { framed(fx, pad, pad, dw0 * zmax, dh0 * zmax, u * zmax, i, function () { fx.drawImage(src, pad, pad, dw0 * zmax, dh0 * zmax); }); });
      }, 6);
      var k2 = z / zmax;
      x.imageSmoothingQuality = 'medium';
      x.drawImage(sp, X - pad * k2, Y - pad * k2, sp.width * k2, sp.height * k2);
    }
    x.restore();
  }

  /* Guided view: the real page stays on screen and the camera glides from panel to panel,
     with the current panel lit and the rest of the page softly dimmed. */
  var pageCache = {};
  function pageBitmap(p) {
    if (pageCache[p.id]) return pageCache[p.id];
    var s = Math.min(1, 2600 / Math.max(p.w, p.h)), c = document.createElement('canvas');
    c.width = Math.round(p.w * s); c.height = Math.round(p.h * s);
    var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(p.img, 0, 0, c.width, c.height);
    c.k = s; return (pageCache[p.id] = c);
  }
  function camFor(q, W, H, p) {
    var room = capRoom(), short = S.format === 'short';
    var boxW = W * 0.94, boxH = H * (short ? (room ? 0.6 : 0.76) : (room ? 0.7 : 0.86));
    var pad = Math.min(q.w, q.h) * 0.04, rw = q.w + pad * 2, rh = q.h + pad * 2;
    var s = Math.min(boxW / rw, boxH / rh), cyF = short ? (room ? 0.4 : 0.47) : (room ? 0.42 : 0.5);
    var tall = rh * (boxW / rw) > boxH * 1.25;   // a tall panel / whole page: read it top → bottom at full width
    var cx = q.x + q.w / 2, cy = q.y + q.h / 2;
    if (tall) { s = boxW / rw; var visH = boxH / s, e = ease(clamp((p - 0.12) / 0.76, 0, 1)); cy = q.y - pad + visH / 2 + (rh - visH) * e; }
    else s *= 1 + 0.04 * ease(p);               // gentle push-in
    return { s: s, cx: cx, cy: cy, sx: W / 2, sy: H * cyF, tall: tall, boxH: boxH };
  }
  function drawGuided(x, W, H, i, p, j, pj, k) {
    var q = panels[i], pg = pageOf(q); if (!pg) return;
    var cam = camFor(q, W, H, p);
    if (j != null && k > 0) {
      var q2 = panels[j], pg2 = pageOf(q2);
      if (pg2 && pg2.id === pg.id) {              // same page: the camera travels
        var c2 = camFor(q2, W, H, pj), e = easeCubic(k);
        cam = { s: cam.s + (c2.s - cam.s) * e, cx: cam.cx + (c2.cx - cam.cx) * e, cy: cam.cy + (c2.cy - cam.cy) * e, sx: cam.sx, sy: cam.sy + (c2.sy - cam.sy) * e, boxH: c2.boxH };
        var fx = q.x + (q2.x - q.x) * e, fy = q.y + (q2.y - q.y) * e, fw = q.w + (q2.w - q.w) * e, fh = q.h + (q2.h - q.h) * e;
        paintPage(x, W, H, pg, cam, { x: fx, y: fy, w: fw, h: fh }, 1, i);
        return;
      }
      paintPage(x, W, H, pg, cam, q, 1, i);       // new page: cross-fade
      paintPage(x, W, H, pg2, camFor(q2, W, H, pj), q2, easeCubic(k), j);
      return;
    }
    paintPage(x, W, H, pg, cam, q, 1, i);
  }
  // Moving camera: only the comic inside the panel window is shown (never the rest of the page);
  // the window glides and reshapes from one panel to the next.
  function paintPage(x, W, H, pg, cam, focus, alpha, idx) {
    var bm = pageBitmap(pg), u = Math.min(W, H) / 1080;
    function sx(px) { return cam.sx + (px - cam.cx) * cam.s; }
    function sy(py) { return cam.sy + (py - cam.cy) * cam.s; }
    x.save(); x.globalAlpha = alpha;
    drawBg(x, W, H, panels[idx] || { id: 'page-' + pg.id, pageId: pg.id, x: focus.x, y: focus.y, w: focus.w, h: focus.h });
    var X = sx(focus.x), Y = sy(focus.y), w = focus.w * cam.s, h = focus.h * cam.s;
    var top = Math.max(Y, cam.sy - cam.boxH / 2), bot = Math.min(Y + h, cam.sy + cam.boxH / 2);
    if (bot - top < 4) { top = Y; bot = Y + h; }
    framed(x, X, top, w, bot - top, u, idx, function () { x.drawImage(bm, sx(0), sy(0), pg.w * cam.s, pg.h * cam.s); });
    if (idx != null) lastRect[idx] = { top: top, bottom: bot };
    x.restore();
  }


  function drawFrame(x, W, H, t) {
    x.fillStyle = '#06101f'; x.fillRect(0, 0, W, H);
    if (!panels.length) return;
    var tl = timeline(), n = panels.length, T = S.transition === 'cut' ? 0 : Math.max(0.05, S.transLen);
    var i = 0; while (i < n - 1 && t >= tl.starts[i + 1]) i++;
    var startI = tl.starts[i], endI = startI + tl.durs[i];
    if (S.fit === 'guided') {
      var TG = S.transition === 'cut' ? 0 : Math.max(0.45, S.transLen + 0.2);   // camera moves need a little longer
      var pr = function (j) { return clamp((t - tl.starts[j]) / Math.max(0.2, tl.durs[j]), 0, 1); };
      var kg = (i < n - 1 && TG > 0 && t > endI - TG) ? (t - (endI - TG)) / TG : 0;
      drawGuided(x, W, H, i, pr(i), kg > 0 ? i + 1 : null, 0, kg);
      finishFrame(x, W, H, t, tl, kg > 0.5 ? i + 1 : i);
      return;
    }
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
    finishFrame(x, W, H, t, tl, i);
  }
  function finishFrame(x, W, H, t, tl, i) {
    drawOverlay(x, W, H, t);
    if (S.capOn) drawCaptions(x, W, H, t, tl, i);
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

  /* ---------- Fast export (WebCodecs + MP4) ----------
     Frames are drawn and encoded as fast as the device can (no waiting in real time),
     then packed into an MP4 with the voice track. Falls back to the real-time recorder
     when the browser can't do this. */
  var FPS = 30, fastOk = null;
  function fastAvailable() { return !!(window.VideoEncoder && window.VideoFrame && window.Mp4Muxer); }
  function pickVideoCodec(W, H) {
    var opts = [['avc', 'avc1.640034'], ['avc', 'avc1.4d0034'], ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08']];
    var br = W * H > 2e6 ? 9e6 : 6e6;
    return opts.reduce(function (p, o) {
      return p.then(function (found) {
        if (found) return found;
        var cfg = { codec: o[1], width: W, height: H, bitrate: br, framerate: FPS, latencyMode: 'quality' };
        if (o[0] === 'avc') cfg.avc = { format: 'avc' };
        return VideoEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? { mux: o[0], cfg: cfg } : null; }, function () { return null; });
      });
    }, Promise.resolve(null));
  }
  function pickAudioCodec() {
    if (!window.AudioEncoder || !window.AudioData) return Promise.resolve(null);
    var opts = [['aac', 'mp4a.40.2'], ['opus', 'opus']];
    return opts.reduce(function (p, o) {
      return p.then(function (found) {
        if (found) return found;
        var cfg = { codec: o[1], sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
        return AudioEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? { mux: o[0], cfg: cfg } : null; }, function () { return null; });
      });
    }, Promise.resolve(null));
  }
  // OpusHead: 'OpusHead', version 1, 2 channels, pre-skip, 48 kHz, gain 0, mapping 0
  function opusHead(preSkip) {
    var b = new Uint8Array(19), dv = new DataView(b.buffer);
    'OpusHead'.split('').forEach(function (ch, i) { b[i] = ch.charCodeAt(0); });
    b[8] = 1; b[9] = 2; dv.setUint16(10, preSkip, true); dv.setUint32(12, 48000, true); dv.setInt16(16, 0, true); b[18] = 0;
    return b.buffer;
  }
  function decodeVoice() {
    if (!audio.blob) return Promise.resolve(null);
    var AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
    return audio.blob.arrayBuffer().then(function (buf) { return new Promise(function (res, rej) { ac.decodeAudioData(buf, res, rej); }); })
      .then(function (b) {
        ac.close().catch(function () {});
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, len = Math.ceil(b.duration * 48000);
        var off = new OAC(2, len, 48000), src = off.createBufferSource(); src.buffer = b; src.connect(off.destination); src.start();
        return off.startRendering();
      }).catch(function () { YB.toast('The voice track couldn\'t be read — making the video without sound'); return null; });
  }
  function nextTick() { return new Promise(function (r) { setTimeout(r, 0); }); }

  function exportVideo(done) {
    if (!panels.length || rec) return;
    done = typeof done === 'function' ? done : null;
    if (!fastAvailable() || fastOk === false) return recordVideo(done);
    stopPreview();
    var f = FORMATS[S.format], W = f[0], H = f[1], total = timeline().total, frames = Math.max(1, Math.ceil(total * FPS));
    rec = { cancelled: false };
    $('exportProg').hidden = false; $('result').hidden = true; $('exportBtn').disabled = true; $('playBtn').disabled = true;
    $('exportBar').style.width = '0%'; $('exportText').textContent = 'Getting ready…'; $('exportRealtime').hidden = true;
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    panels.forEach(function (q) { bitmap(q); backdrop(q, W, H); });
    var vEnc = null, aEnc = null, failed = null, t0 = performance.now();
    function fail(e) { if (!failed) failed = e || new Error('encode'); }
    Promise.all([pickVideoCodec(W, H), pickAudioCodec(), decodeVoice()]).then(function (r) {
      var vc = r[0], acodec = r[1], voice = r[2];
      if (!vc) throw new Error('no-video-codec');
      if (voice && !acodec) throw new Error('no-audio-encoder');   // never make a silent video: the recorder keeps the voice
      var target = new Mp4Muxer.ArrayBufferTarget();
      var muxer = new Mp4Muxer.Muxer({ target: target, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
        video: { codec: vc.mux, width: W, height: H, frameRate: FPS },
        audio: voice && acodec ? { codec: acodec.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined });
      vEnc = new VideoEncoder({ output: function (c, m) { muxer.addVideoChunk(c, m); }, error: fail });
      vEnc.configure(vc.cfg);
      var audioDone = Promise.resolve();
      if (voice && acodec) {
        // The MP4 needs the encoder's real start-up padding (Opus "pre-skip"). If the browser doesn't hand over its
        // header, the muxer assumes 80 ms and players cut that much real sound — the voice would run 73 ms early.
        var gotHead = false;
        aEnc = new AudioEncoder({ output: function (c, m) {
          if (acodec.mux === 'opus') {
            if (!gotHead) {
              var dcfg = m && m.decoderConfig, desc = dcfg && dcfg.description;
              if (!desc || desc.byteLength < 18) m = { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: opusHead(312) } };
              gotHead = true;
            } else m = undefined;   // later chunks carry an empty header that would wipe the real one
          }
          muxer.addAudioChunk(c, m);
        }, error: fail });
        aEnc.configure(acodec.cfg);
        var L = voice.getChannelData(0), R = voice.numberOfChannels > 1 ? voice.getChannelData(1) : L, step = 4800;
        for (var o = 0; o < voice.length; o += step) {
          var n = Math.min(step, voice.length - o), data = new Float32Array(n * 2);
          data.set(L.subarray(o, o + n), 0); data.set(R.subarray(o, o + n), n);
          var ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(o / 48000 * 1e6), data: data });
          aEnc.encode(ad); ad.close();
        }
        audioDone = aEnc.flush();
      }
      var fi = 0;
      function batch() {
        if (failed) throw failed;
        if (rec.cancelled) return 'cancel';
        var until = performance.now() + 28;            // keep the page responsive: draw for ~28 ms, then let the UI breathe
        while (fi < frames && performance.now() < until && vEnc.encodeQueueSize < 12) {
          drawFrame(ctx, W, H, Math.min(fi / FPS, total));
          var vf = new VideoFrame(canvas, { timestamp: Math.round(fi * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
          vEnc.encode(vf, { keyFrame: fi % (FPS * 2) === 0 }); vf.close(); fi++;
        }
        var pct = fi / frames, spent = (performance.now() - t0) / 1000, left = pct > 0.03 ? spent / pct - spent : 0;
        // safety net: on a device that encodes slower than real time, the real-time recorder is quicker
        if (fi >= FPS * 3 && spent > 2.5 && spent / pct > total * 1.3 && pickMime()) throw new Error('too-slow');
        $('exportBar').style.width = (pct * 100).toFixed(1) + '%';
        $('exportText').textContent = (S.capOn && hasCaptions() ? langName(S.showLang) + ' · ' : '') + 'Making video ' + Math.round(pct * 100) + '%' + (left > 1 ? ' · about ' + mmss(left) + ' left' : '');
        if (fi < frames) return nextTick().then(batch);
        return 'done';
      }
      return nextTick().then(batch).then(function (state) {
        if (state === 'cancel') throw new Error('cancelled');
        $('exportText').textContent = 'Finishing…';
        return Promise.all([vEnc.flush(), audioDone]).then(function () {
          if (failed) throw failed;
          muxer.finalize();
          return new Blob([target.buffer], { type: 'video/mp4' });
        });
      });
    }).then(function (blob) {
      fastOk = true; cleanup();
      return fixOpusDelay(blob).then(function (b) { showResult(b, 'video/mp4', total, W, H); if (done) done(true); });
    }, function (e) {
      cleanup();
      if (e && e.message === 'cancelled') { YB.toast('Video cancelled'); if (done) done(false); return; }
      console.warn('[Comic] fast export unavailable, using the recorder', e);
      if (e && e.message === 'too-slow') YB.toast('This device is quicker in real time — switching to the recorder');
      fastOk = false; recordVideo(done);           // fall back to real-time recording
    });
    function cleanup() {
      try { if (vEnc && vEnc.state !== 'closed') vEnc.close(); } catch (e) { /* closed */ }
      try { if (aEnc && aEnc.state !== 'closed') aEnc.close(); } catch (e) { /* closed */ }
      rec = null; $('exportProg').hidden = true; $('playBtn').disabled = false; renderFacts();
    }
  }

  // Real-time recorder (any browser with MediaRecorder).
  function recordVideo(done) {
    var mime = pickMime(); if (!mime || !panels.length || rec) return;
    done = typeof done === 'function' ? done : null;
    stopPreview();
    var f = FORMATS[S.format], W = f[0], H = f[1], total = timeline().total;
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    $('exportRealtime').hidden = false;
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
        if (cancelled) { YB.toast('Video cancelled'); if (done) done(false); return; }
        var type = (mr.mimeType || mime).split(';')[0], blob = new Blob(chunks, { type: type });
        fixOpusDelay(blob).then(function (b) { showResult(b, type, total, W, H); if (done) done(true); });
      };
      var t0 = 0, stopped = false, aStart = 0;
      function frame() {
        if (stopped) return;
        // with a voice, the picture follows the audio clock itself, so the two can never drift apart
        var t = src && ac ? Math.max(0, ac.currentTime - aStart) : (performance.now() - t0) / 1000;
        if (rec.cancelled) { stopped = true; try { src && src.stop(); } catch (e) {} mr.stop(); return; }
        drawFrame(ctx, W, H, Math.min(t, total));
        $('exportBar').style.width = Math.min(100, t / total * 100).toFixed(1) + '%';
        $('exportText').textContent = (S.capOn && hasCaptions() ? langName(S.showLang) + ' · ' : '') + 'Recording ' + mmss(t) + ' of ' + mmss(total);
        if (t >= total) { stopped = true; setTimeout(function () { mr.stop(); }, 200); return; }
        requestAnimationFrame(frame);
      }
      // a hidden tab pauses animation frames; keep frames coming with a timer too
      var keep = setInterval(function () { if (stopped) clearInterval(keep); else if (document.hidden) frame(); }, 1000 / 30);
      var go = function () {
        mr.start(1000);
        t0 = performance.now();
        if (src) { aStart = ac.currentTime + 0.05; src.start(aStart); }
        requestAnimationFrame(frame);
      };
      if (ac && ac.state === 'suspended') ac.resume().then(go, go); else go();
    });
  }

  // MP4s with Opus sound record how much start-up padding to skip ("pre-skip"). Some browsers write 80 ms
  // (3840) where the encoder really adds 6.5 ms (312), so players cut 73 ms of real sound and the voice
  // runs ahead of the pictures. Correct that number in the finished file.
  function fixOpusDelay(blob) {
    if (!/mp4/.test(blob.type)) return Promise.resolve(blob);
    return blob.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), fixed = false;
      for (var i = 4; i < u.length - 12; i++) {
        if (u[i] === 0x64 && u[i + 1] === 0x4F && u[i + 2] === 0x70 && u[i + 3] === 0x73) {   // 'dOps'
          var pre = (u[i + 6] << 8) | u[i + 7];
          if (pre === 3840) { u[i + 6] = 312 >> 8; u[i + 7] = 312 & 255; fixed = true; }
          break;
        }
      }
      return fixed ? new Blob([u], { type: blob.type }) : blob;
    }, function () { return blob; });
  }

  function showResult(blob, type, total, W, H) {
    if (lastVideo) URL.revokeObjectURL(lastVideo);
    lastVideo = URL.createObjectURL(blob);
    var ext = /mp4/.test(type) ? 'mp4' : 'webm';
    var v = $('resultVideo'); v.src = lastVideo;
    var a = $('downloadBtn'); a.href = lastVideo;
    var first = pages[0] ? pages[0].name.replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() : 'comic';
    a.download = (first || 'comic') + '-' + (S.format === 'short' ? 'short' : S.format) + '.' + ext;
    var lang = S.capOn && hasCaptions() ? S.showLang : '';
    if (lang) a.download = a.download.replace(/\.(mp4|webm)$/, '-' + lang + '.$1');
    $('resultInfo').textContent = ext.toUpperCase() + ' · ' + W + '×' + H + ' · ' + mmss(total) + ' · ' + (blob.size / 1048576).toFixed(1) + ' MB' + (lang ? ' · ' + langName(lang) + ' subtitles' : '');
    $('result').hidden = false;
    results.unshift({ url: lastVideo, name: a.download, info: $('resultInfo').textContent });
    lastVideo = null;   // kept alive in the results list
    renderResults();
    renderSrt();
    renderSteps();
    $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    YB.toast('Your video is ready');
  }

  /* ---------- Subtitles ---------- */
  var lastRect = {}, chunkCache = {}, results = [];
  function capOf(q, lang) { return (q && q.cap && q.cap[lang]) || ''; }
  function setCap(q, lang, text) {
    q.cap = q.cap || {};
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (lang === S.srcLang && t !== (q.cap[lang] || '')) {
      Object.keys(q.cap).forEach(function (l) { if (l !== lang) delete q.cap[l]; });   // translations are out of date
    }
    if (t) q.cap[lang] = t; else delete q.cap[lang];
    chunkCache = {};
  }
  function hasCaptions() { return panels.some(function (q) { return capOf(q, S.showLang) || capOf(q, S.srcLang); }); }
  function captionedCount() { return panels.filter(function (q) { return capOf(q, S.srcLang); }).length; }
  function capRoom() { return S.capOn && S.capPos !== 'top' && S.capPos !== 'middle' && hasCaptions(); }

  // Split a caption into short "frames" of a few words, breaking after punctuation first.
  function chunksFor(text, lang) {
    var key = lang + '|' + S.capWords + '|' + text;
    if (chunkCache[key]) return chunkCache[key];
    var words, out = [], cur = [];
    if (NO_SPACES.indexOf(lang) !== -1) {
      // no spaces between words: phrases at punctuation, then about 12 characters per frame
      words = text.replace(/([、。！？!?,，])/g, '$1\u0001').split('\u0001').reduce(function (a, ph) {
        for (var k = 0; k < ph.length; k += 12) a.push(ph.slice(k, k + 12)); return a;
      }, []).filter(function (w) { return w.trim(); });
      words.forEach(function (w) { out.push([w.trim()]); });
    } else {
      words = text.split(/\s+/).filter(Boolean);
      var max = S.capWords;
      words.forEach(function (w, i) {
        cur.push(w);
        var soft = /[,;:—–]$/.test(w) && cur.length >= Math.max(2, max - 2), hard = /[.!?…]["')]*$/.test(w);
        if (cur.length >= max || hard || soft || i === words.length - 1) { out.push(cur); cur = []; }
      });
      // never leave a lonely last word
      if (out.length > 1 && out[out.length - 1].length === 1 && out[out.length - 2].length < max + 2 && !/[.!?…]["')]*$/.test(out[out.length - 2].slice(-1)[0])) {
        var last = out.pop(); out[out.length - 1] = out[out.length - 1].concat(last);
      }
    }
    var weights = out.map(function (c) { return c.join(' ').length + 3; }), tot = weights.reduce(function (a, b) { return a + b; }, 0) || 1, acc = 0;
    var res = out.map(function (c, k) { var s0 = acc / tot; acc += weights[k]; return { words: c, from: s0, to: acc / tot }; });
    chunkCache[key] = res;
    return res;
  }
  // The caption shown at time t for panel i: { words, active (index), age (s since it appeared) }
  // Steady pace: every caption frame stays up for the time it takes to read it
  // (characters ÷ pace), in order from the start of its panel; the last one holds to the end.
  function capSchedule(i, tl, lang) {
    var q = panels[i], text = capOf(q, lang); if (!text) return [];
    var clip = lang === S.showLang && typeof clipFor === 'function' ? clipFor(q) : null;
    if (clip) {
      // in time with the voice: each caption frame starts when its first word is spoken
      var chs = chunksFor(text, lang), all = chs.reduce(function (a, c) { return a + c.words.join(' ').length + 1; }, 0), acc = 0, at = tl.starts[i] + NARR_LEAD;
      return chs.map(function (c, n) {
        var a0 = acc / all; acc += c.words.join(' ').length + 1;
        return { words: c.words, start: at + a0 * clip.dur, end: n === chs.length - 1 ? tl.starts[i] + tl.durs[i] - 0.05 : at + acc / all * clip.dur, spoken: clip.dur * (acc / all - a0) };
      });
    }
    if (tl.sync && tl.sync.synced && window.YBAudioSync) {
      // in time with the voice track: each caption frame appears as its first word is spoken and stays until the next one
      var spans = tl.sync.speech[i] || [], p0 = tl.starts[i], p1 = tl.starts[i] + tl.durs[i];
      var ck = chunksFor(text, lang), allc = ck.reduce(function (a, c) { return a + c.words.join(' ').length + 1; }, 0), run = 0;
      var marks = ck.map(function (c) { var a0 = run / allc; run += c.words.join(' ').length + 1; return [a0, run / allc]; });
      var at0 = spans.length ? spans[0][0] : p0 + 0.1;
      return ck.map(function (c, n) {
        var st = n ? window.YBAudioSync.timeAt(spans, marks[n][0], at0, p1) : Math.max(p0 + 0.02, at0 - 0.08);
        var said = window.YBAudioSync.timeAt(spans, marks[n][1], at0, p1);
        var en = n === ck.length - 1 ? p1 - 0.05 : window.YBAudioSync.timeAt(spans, marks[n + 1][0], at0, p1);
        return { words: c.words, start: st, end: Math.max(st + 0.2, en), spoken: Math.max(0.2, said - st) };
      });
    }
    var s0 = tl.starts[i] + 0.1, avail = Math.max(0.3, tl.durs[i] - 0.22), pace = S.capPace || 15;
    var ch = chunksFor(text, lang), need = ch.map(function (c) { return Math.max(0.9, (c.words.join(' ').length + 2) / pace); });
    var sum = need.reduce(function (a, b) { return a + b; }, 0), k = sum > avail ? avail / sum : 1, t = s0;
    return ch.map(function (c, n) { var st = t; t += need[n] * k; return { words: c.words, start: st, end: n === ch.length - 1 ? s0 + avail : t }; });
  }
  function captionAt(t, tl, i, lang) {
    var sc = capSchedule(i, tl, lang); if (!sc.length) return null;
    var c = sc.find(function (x) { return t >= x.start && t < x.end; }); if (!c) return null;
    var reading = c.spoken ? Math.max(0.2, c.spoken) : Math.max(0.6, Math.min(c.end - c.start, (c.words.join(' ').length + 2) / (S.capPace || 15)));
    var prog = Math.min(1, (t - c.start) / reading);
    var lens = c.words.map(function (w) { return w.length + 1; }), sum = lens.reduce(function (a, b) { return a + b; }, 0), run = 0, active = 0;
    for (var k = 0; k < lens.length; k++) { run += lens[k]; active = k; if (prog * sum < run) break; }
    return { words: c.words, active: active, age: t - c.start, prog: prog };
  }


  function capFont(fs) { return '900 ' + fs + 'px "Arial Black", "Segoe UI Black", "Helvetica Neue", system-ui, -apple-system, Roboto, Arial, sans-serif'; }
  function drawCaptions(x, W, H, t, tl, i) {
    var lang = S.showLang, cap = captionAt(t, tl, i, lang); if (!cap) return;
    var short = S.format === 'short', u = (short || S.format === 'square' ? W : H) / 1080;
    var upper = S.capCaps && ['hi', 'ar', 'ja', 'zh-CN', 'ko', 'bn'].indexOf(lang) === -1;
    var words = cap.words.map(function (w) { return upper ? w.toUpperCase() : w; });
    var square = S.format === 'square';
    var style = S.capStyle, small = style === 'minimal' || style === 'typewriter' || style === 'bubble';
    var fs = Math.round((small ? 66 : 82) * u * S.capSize * (square ? 0.8 : 1)), maxW = W * (short ? 0.8 : square ? 0.84 : 0.76) / (style === 'pop' ? 1.06 : 1);
    var rtl = RTL.indexOf(lang) !== -1, sep = NO_SPACES.indexOf(lang) !== -1 ? '' : ' ';
    // fit on at most two lines
    var lines;
    for (var tries = 0; tries < 6; tries++) {
      x.font = capFont(fs);
      var space = x.measureText(sep || ' ').width * (sep ? 1.35 : 0); lines = [[]];   // a little extra room so highlighted words never touch
      var lw = 0;
      words.forEach(function (w, k) {
        var ww = x.measureText(w).width;
        if (lines[lines.length - 1].length && lw + space + ww > maxW) { lines.push([]); lw = 0; }
        lines[lines.length - 1].push({ w: w, k: k, width: ww }); lw += (lw ? space : 0) + ww;
      });
      var widest = lines.reduce(function (m, l) { return Math.max(m, l.reduce(function (a, it) { return a + it.width; }, 0) + space * (l.length - 1)); }, 0);
      if (lines.length <= 2 && widest <= maxW) break;   // never wider than the safe area (one long word shrinks the text)
      fs = Math.round(fs * 0.88);
    }
    var lh = fs * 1.18, blockH = lines.length * lh, padY = fs * 0.32;
    // smart position: below the framed panel, inside the safe area YouTube's buttons don't cover
    var y;
    if (S.capPos === 'top') y = H * (short ? 0.2 : 0.14) + blockH / 2;
    else if (S.capPos === 'middle') y = H * 0.5;
    else if (S.capPos === 'bottom') y = H * (short ? 0.77 : 0.86) - blockH / 2;
    else {
      var r = lastRect[i], limit = H * (short ? 0.815 : 0.94) - blockH / 2 - padY;   // YouTube's title & buttons sit below this
      if (S.fit === 'fill' || !r) y = H * (short ? 0.7 : 0.84);
      else y = Math.min(limit, r.bottom + H * 0.035 + blockH / 2 + padY);
      y = Math.max(y, H * 0.25);
    }
    // gentle entrance: fade in and rise a few pixels (no zooming)
    var enter = Math.min(1, cap.age / 0.16), alpha = enter;
    x.save();
    x.globalAlpha = alpha;
    x.translate(0, (1 - ease(enter)) * 10 * u);
    x.textBaseline = 'middle'; x.textAlign = 'left'; x.lineJoin = 'round';
    if (style === 'bubble') {
      x.font = capFont(fs);
      var sp = sep ? x.measureText(' ').width * 1.35 : 0;
      var bw = lines.reduce(function (m, l) { return Math.max(m, l.reduce(function (a, it) { return a + it.width; }, 0) + sp * (l.length - 1)); }, 0) + fs * 1.2;
      var bh = blockH + fs * 0.6, bx = (W - bw) / 2, by = y - bh / 2;
      x.shadowColor = 'rgba(0,0,0,0.35)'; x.shadowBlur = fs * 0.4; x.shadowOffsetY = fs * 0.08;
      x.fillStyle = '#ffffff'; roundRect(x, bx, by, bw, bh, fs * 0.55); x.fill();
      x.beginPath(); x.moveTo(W / 2 - fs * 0.35, by + 2); x.lineTo(W / 2, by - fs * 0.45); x.lineTo(W / 2 + fs * 0.35, by + 2); x.closePath(); x.fill();
      x.shadowColor = 'transparent'; x.strokeStyle = '#111'; x.lineWidth = Math.max(2, fs * 0.06); roundRect(x, bx, by, bw, bh, fs * 0.55); x.stroke();
    }
    var typed = style === 'typewriter' ? Math.floor(words.join(' ').length * Math.min(1, cap.prog * 1.25)) : Infinity, shown = 0;
    lines.forEach(function (line, li) {
      x.font = capFont(fs);
      var space = sep ? x.measureText(' ').width * 1.35 : 0;
      var total = line.reduce(function (a, it) { return a + it.width; }, 0) + space * (line.length - 1);
      var ly = y - blockH / 2 + lh * (li + 0.5);
      var order = rtl ? line.slice().reverse() : line, cx = (W - total) / 2;
      if (style === 'box') {
        x.fillStyle = 'rgba(6,10,20,0.68)';
        roundRect(x, cx - fs * 0.45, ly - lh / 2 - padY * 0.35, total + fs * 0.9, lh + padY * 0.7, fs * 0.35); x.fill();
      }
      order.forEach(function (it) {
        var on = it.k === cap.active, said = it.k <= cap.active, color = S.capColor, text = it.w;
        if (style === 'pop' && on) color = S.capHi;
        if (style === 'karaoke' && said) color = S.capHi;
        if (style === 'box' && on) color = S.capHi;
        if (style === 'bubble') color = on ? '#1e5bd8' : '#111111';
        if (style === 'typewriter') { var left = typed - shown; shown += it.w.length + 1; if (left <= 0) { cx += it.width + space; return; } text = it.w.slice(0, left); }
        var grow = style === 'pop' && on ? 1.06 : 1;
        x.save();
        x.translate(cx + it.width / 2, ly); x.scale(grow, grow);
        if (style === 'highlight' && on) {
          x.fillStyle = S.capHi; roundRect(x, -it.width / 2 - fs * 0.16, -lh * 0.46, it.width + fs * 0.32, lh * 0.92, fs * 0.22); x.fill();
          color = '#111111';
        }
        if (style === 'minimal' || style === 'typewriter') { x.shadowColor = 'rgba(0,0,0,0.85)'; x.shadowBlur = fs * 0.25; x.shadowOffsetY = fs * 0.05; }
        else if (style === 'neon') { x.shadowColor = S.capHi; x.shadowBlur = fs * (on ? 0.7 : 0.45); color = on ? '#ffffff' : S.capColor; }
        else if (style !== 'box' && style !== 'bubble' && !(style === 'highlight' && on)) { x.lineWidth = fs * 0.17; x.strokeStyle = 'rgba(0,0,0,0.92)'; x.strokeText(text, -it.width / 2, 0); }
        x.fillStyle = color; x.fillText(text, -it.width / 2, 0);
        if (style === 'neon') x.fillText(text, -it.width / 2, 0);
        x.restore();
        cx += it.width + space;
      });
    });
    x.restore();
  }

  // .srt for YouTube Studio, using the same caption frames and timing as the video.
  function srtFor(lang) {
    var tl = timeline(), n = 0, out = [];
    function ts(s) { var ms = Math.max(0, Math.round(s * 1000)), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(sec).padStart(2, '0') + ',' + String(ms % 1000).padStart(3, '0'); }
    panels.forEach(function (q, i) {
      var text = capOf(q, lang); if (!text) return;
      var s0 = tl.starts[i] + 0.08, d = Math.max(0.2, tl.durs[i] - 0.2);
      capSchedule(i, tl, lang).forEach(function (c) {
        out.push(++n + '\n' + ts(c.start) + ' --> ' + ts(c.end) + '\n' + c.words.join(NO_SPACES.indexOf(lang) !== -1 ? '' : ' ') + '\n');
      });
    });
    return out.join('\n');
  }
  function renderSrt() {
    var langs = S.langs.filter(function (l) { return panels.some(function (q) { return capOf(q, l); }); });
    $('srtBox').hidden = !langs.length || $('result').hidden;
    $('srtList').innerHTML = langs.map(function (l) { return '<button type="button" class="btn btn-ghost btn-sm" data-srt="' + l + '">⬇ ' + YB.esc(langName(l)) + ' .srt</button>'; }).join('');
  }
  function renderResults() {
    $('resultList').innerHTML = results.length > 1 ? results.map(function (r, k) {
      return '<li><span class="small">' + YB.esc(r.info) + '</span><a class="btn btn-ghost btn-sm" href="' + r.url + '" download="' + YB.esc(r.name) + '">⬇</a></li>';
    }).join('') : '';
  }

  // Lines from a Story Studio story, shared across the panels in order.
  function storyLines(st) {
    return (st.blocks || []).filter(function (b) { return b.type === 'line' && b.text && b.text.trim(); }).map(function (b) {
      var t = b.text.replace(/\[[^\]]*\]/g, ' ').replace(/\s+/g, ' ').trim();
      if (window.YBGrammar) t = window.YBGrammar.fixLine(t, (st.characters || []).map(function (c) { return c.name; }));
      return t;
    }).filter(Boolean);
  }
  function storyWho(st) {
    return (st.blocks || []).filter(function (b) { return b.type === 'line' && b.text && b.text.trim(); })
      .filter(function (b) { return b.text.replace(/\[[^\]]*\]/g, ' ').trim(); }).map(function (b) { return b.speaker || 'narrator'; });
  }
  // Read the words in every panel's speech bubbles (js/comic-ocr.js); saved per panel so each is read once.
  var ocrMem = {};
  function ocrKey(q) { return 'ocr:' + q.pageId + ':' + [q.x, q.y, q.w, q.h].map(Math.round).join(','); }
  function panelTexts(onProgress) {
    if (!window.YBComicOCR) return Promise.reject(new Error('no-ocr'));
    var keys = panels.map(ocrKey);
    return Promise.all(keys.map(function (k) {
      if (ocrMem[k] != null) return ocrMem[k];
      return kv('youtube-blue-comic', 'readonly', function (st, out) { var r = st.get(k); r.onsuccess = function () { out.v = r.result; }; });
    })).then(function (saved) {
      var todo = [];
      panels.forEach(function (q, i) { if (saved[i] == null) todo.push(i); else ocrMem[keys[i]] = saved[i]; });
      if (!todo.length) return keys.map(function (k) { return ocrMem[k]; });
      var canv = todo.map(function (i) {
        var q = panels[i], p = pageOf(q); if (!p) return null;
        var sc = Math.max(1, Math.min(3, 1100 / Math.max(q.w, q.h)));   // small panels are enlarged so the letters are big enough
        var c = document.createElement('canvas'); c.width = Math.round(q.w * sc); c.height = Math.round(q.h * sc);
        var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(p.img, q.x, q.y, q.w, q.h, 0, 0, c.width, c.height);
        return c;
      });
      return window.YBComicOCR.read(canv, function (n, of) { if (onProgress) onProgress(n, of); }).then(function (texts) {
        todo.forEach(function (i, n) { ocrMem[keys[i]] = texts[n] || ''; });
        kv('youtube-blue-comic', 'readwrite', function (st) { todo.forEach(function (i) { st.put(ocrMem[keys[i]], keys[i]); }); });
        return keys.map(function (k) { return ocrMem[k]; });
      });
    });
  }

  // Story lines → panels. Each line goes on the panel that shows it (matched by the words in its
  // speech bubbles), keeping the story order; if the panels can't be read, lines are spread evenly.
  function renderMatchNote() {
    var el = $('capMatchNote'); if (!el) return;
    var fromStory = panels.some(function (q) { return q.storyId; });
    if (!S_match || !fromStory) { el.hidden = true; return; }
    el.hidden = false;
    el.className = 'small cx-match' + (S_match.how === 'ocr' ? ' ok' : ' warn');
    el.textContent = S_match.how === 'ocr'
      ? '🔎 Lines placed by reading the speech bubbles (' + S_match.read + ' of ' + S_match.panels + ' panels had readable words). Each line plays over the panel that shows it.'
      : S_match.why === 'no-ocr'
        ? '⚠️ The panels couldn\'t be read on this device (no connection to the text reader), so lines were spread in order. They\'ll be re-matched automatically next time it can connect — or move a line with ◀ ▶.'
        : '⚠️ These panels have little readable text, so lines were spread in order. Move a line to the right panel with ◀ ▶.';
  }
  // Captions filled from a story but never matched to the bubbles (an older fill, or the reader couldn't
  // load): match them now, by themselves. Captions you typed are never changed.
  var autoMatchTried = false;
  function autoMatch() {
    if (autoMatchTried || filling || !panels.length || !window.YBComicOCR) return;
    var sid = (panels.find(function (q) { return q.storyId; }) || {}).storyId;
    if (!sid || panels.some(function (q) { return q.capEdited; })) return;
    if (panels.every(function (q) { return q.capMatch === 'ocr' || !q.storyId; })) return;
    var st = (YB.store.get('stories', []) || []).find(function (x) { return x.id === sid; }); if (!st) return;
    autoMatchTried = true;
    $('capStory').value = sid;
    fillFromStory({ auto: true });
  }
  // ◀ ▶ on a panel: move its first line to the panel before, or its last line to the panel after.
  function moveLine(i, dir) {
    var q = panels[i], to = panels[i + dir]; if (!q || !to || !q.lines || !q.lines.length) return;
    var st = (YB.store.get('stories', []) || []).find(function (x) { return x.id === q.storyId; }); if (!st) return;
    var lines = storyLines(st);
    to.lines = to.lines || [];
    if (dir < 0) to.lines.push(q.lines.shift()); else to.lines.unshift(q.lines.pop());
    [q, to].forEach(function (p) {
      p.cap = {}; p.storyId = st.id; p.capEdited = false;
      if (p.lines.length) p.cap[S.srcLang] = p.lines.map(function (k) { return lines[k]; }).join(' ');
    });
    chunkCache = {}; syncCache = {};
    changed();
  }

  var filling = false;
  function fillFromStory(opts) {
    opts = opts && opts.auto ? opts : {};
    if (filling) return Promise.resolve(false);
    var st = (YB.store.get('stories', []) || []).find(function (x) { return x.id === $('capStory').value; });
    if (!st) { if (!opts.auto) YB.toast('Write a story in Story Studio first'); return Promise.resolve(false); }
    var lines = storyLines(st), whos = storyWho(st), n = panels.length; if (!lines.length || !n) { if (!opts.auto) YB.toast('That story has no spoken lines yet'); return Promise.resolve(false); }
    if (!opts.auto && captionedCount() && !confirm('Replace the captions on every panel with lines from "' + st.title + '"?')) return Promise.resolve(false);
    filling = true;
    var btn = $('capFillBtn'), label = btn.textContent; btn.disabled = true;
    btn.textContent = '🔎 Reading the panels…';
    return panelTexts(function (k, of) { btn.textContent = '🔎 Reading the panels… ' + Math.min(k + 1, of) + '/' + of; })
      .then(function (texts) { return window.YBComicOCR.match(lines, texts); }, function (e) { console.warn('[Comic] panel reading unavailable', e); return null; })
      .then(function (res) {
        var groups;
        if (res) groups = res.groups;
        else {
          groups = panels.map(function () { return []; });
          lines.forEach(function (l, k) { groups[lines.length >= n ? Math.min(n - 1, Math.floor(k * n / lines.length)) : Math.round(k * (n - 1) / Math.max(1, lines.length - 1))].push(k); });
        }
        panels.forEach(function (q, i) {
          q.cap = {}; q.storyId = st.id; q.who = ''; q.capAuto = true; q.capEdited = false;
          q.lines = groups[i].slice(); q.capMatch = res && !res.fallback ? 'ocr' : 'even';
          if (!groups[i].length) return;
          q.cap[S.srcLang] = groups[i].map(function (k) { return lines[k]; }).join(' ');
          // the character who says most in this panel voices it
          var tally = {}; groups[i].forEach(function (k) { tally[whos[k]] = (tally[whos[k]] || 0) + lines[k].length; });
          q.who = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; })[0] || '';
        });
        S_match = { how: res && !res.fallback ? 'ocr' : 'even', read: res ? res.readable : 0, panels: panels.length, lines: lines.length, why: res ? (res.fallback ? 'little-text' : '') : 'no-ocr' };
        S.showLang = S.srcLang; chunkCache = {}; syncCache = {}; saveSettings();
        changed(); renderSubs(); renderMatchNote();
        var how = res && !res.fallback ? ' — each line is on the panel whose speech bubble shows it' : res ? ' — the panels have little readable text, so lines are spread in order' : ' — couldn\'t read the panels (offline?), so lines are spread in order';
        YB.toast('Captions filled from "' + st.title + '"' + how);
        return true;
      }).then(function (r) { filling = false; btn.textContent = label; btn.disabled = false; return r; },
        function (e) { filling = false; btn.textContent = label; btn.disabled = false; console.error(e); return false; });
  }

  /* ---------- Translation (MyMemory, free) ---------- */
  var tr = { busy: false };
  function trCache() { return YB.store.get('comicTrCache', {}); }
  /* Instant translation on this device: Chrome / Edge (desktop) include a built-in translator
     that runs locally — no server, no account, no daily limit. Other browsers use MyMemory. */
  var devT = {}, devFail = {}, trUsed = { device: 0, online: 0 };
  function trCode(l) { return l === 'zh-CN' ? 'zh' : l; }
  function deviceTranslator(from, to) {
    if (!('Translator' in self)) return Promise.resolve(null);
    var key = from + '>' + to; if (devT[key]) return devT[key];
    if (devFail[key] && Date.now() - devFail[key] < 120000) return Promise.resolve(null);   // not ready a moment ago: go online
    var opts = { sourceLanguage: trCode(from), targetLanguage: trCode(to) };
    // never wait forever: if it isn't ready in a few seconds (and isn't visibly downloading), use the online translator
    var progressAt = 0;
    var made = Translator.availability(opts).then(function (a) {
      if (a === 'unavailable' || a === 'no') return null;
      return Translator.create(Object.assign({}, opts, { monitor: function (m) {
        m.addEventListener('downloadprogress', function (e) { progressAt = Date.now(); var el = $('translateNote'); if (el) el.textContent = 'Getting the ' + langName(to) + ' translator ready on this device… ' + Math.round((e.loaded || 0) * 100) + '%'; });
      } }));
    }).catch(function () { return null; });
    var started = Date.now();
    var timeout = new Promise(function (res) {
      (function check() {
        var idle = Date.now() - Math.max(started, progressAt);
        if (idle > 6000 || Date.now() - started > 180000) return res(null);
        setTimeout(check, 500);
      })();
    });
    devT[key] = Promise.race([made, timeout]);
    devT[key].then(function (t) { if (!t) { delete devT[key]; devFail[key] = Date.now(); } });   // retried after a while (e.g. it needed a tap to download)
    return devT[key];
  }
  function remember(key, out) { var c = trCache(); c[key] = out; var keys = Object.keys(c); if (keys.length > 3000) delete c[keys[0]]; YB.store.set('comicTrCache', c); return out; }
  function translateOne(text, from, to) {
    var key = from + '>' + to + ':' + text, cache = trCache();
    if (cache[key]) return Promise.resolve(cache[key]);
    return deviceTranslator(from, to).then(function (t) {
      if (!t) return onlineTranslate(text, from, to, key);
      return t.translate(text).then(function (out) { trUsed.device++; return remember(key, String(out || '').trim()); }, function () { return onlineTranslate(text, from, to, key); });
    });
  }
  function onlineTranslate(text, from, to, key) {
    trUsed.online++;
    var url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(text) + '&langpair=' + encodeURIComponent(from + '|' + to) + (S.mmEmail ? '&de=' + encodeURIComponent(S.mmEmail) : '');
    return fetch(url).then(function (r) { if (r.status === 429) throw new Error('limit'); return r.json(); }).then(function (j) {
      var out = j && j.responseData && j.responseData.translatedText;
      if (!out || j.quotaFinished || /MYMEMORY WARNING|USED ALL AVAILABLE FREE/i.test(out)) throw new Error('limit');
      if (Number(j.responseStatus) !== 200) throw new Error(j.responseDetails || 'failed');
      out = String(out).replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').trim();
      return remember(key, out);
    });
  }
  // MyMemory takes up to 500 bytes per request: long captions go sentence by sentence.
  function translateText(text, from, to) {
    var enc = window.TextEncoder ? new TextEncoder() : null, bytes = function (t) { return enc ? enc.encode(t).length : t.length * 3; };
    if (bytes(text) <= 450) return translateOne(text, from, to);   // the device translator takes any length
    var parts = text.match(/[^.!?…]+[.!?…]*["')]*\s*/g) || [text], groups = [], cur = '';
    parts.forEach(function (p) { if (cur && bytes(cur + p) > 450) { groups.push(cur.trim()); cur = ''; } cur += p; });
    if (cur.trim()) groups.push(cur.trim());
    groups = groups.reduce(function (a, g) { while (bytes(g) > 450) { var cut = Math.floor(g.length / 2); a.push(g.slice(0, cut)); g = g.slice(cut); } a.push(g); return a; }, []);
    return groups.reduce(function (pr, g) { return pr.then(function (acc) { return translateOne(g, from, to).then(function (t) { return acc.concat(t); }); }); }, Promise.resolve([]))
      .then(function (arr) { return arr.join(NO_SPACES.indexOf(to) !== -1 ? '' : ' '); });
  }
  // Translate every caption into the given languages. Resolves { done, failed, limit }.
  function translateLangs(targets, note) {
    note = note || function (t) { $('translateNote').textContent = t; };
    targets.forEach(function (l) { deviceTranslator(S.srcLang, l); });   // start right away, while the tap still counts
    var jobs = [];
    panels.forEach(function (q) { var src = capOf(q, S.srcLang); if (!src) return; targets.forEach(function (l) { if (!capOf(q, l)) jobs.push({ q: q, l: l, text: src }); }); });
    if (!jobs.length) return Promise.resolve({ done: 0, failed: 0, limit: false });
    tr.busy = true; $('translateBtn').disabled = true; trUsed = { device: 0, online: 0 };
    var done = 0, failed = 0, limit = false, k = 0;
    function next() {
      if (limit || k >= jobs.length) return Promise.resolve();
      var j = jobs[k++];
      return translateText(j.text, S.srcLang, j.l).then(function (out) { j.q.cap = j.q.cap || {}; j.q.cap[j.l] = out; done++; },
        function (e) { failed++; if (e && e.message === 'limit') limit = true; })
        .then(function () { note('Translating… ' + (done + failed) + ' / ' + jobs.length); return next(); });
    }
    return Promise.all([next(), next(), next()]).then(function () {
      tr.busy = false; $('translateBtn').disabled = false; chunkCache = {};
      saveProject(); renderList(); renderSubs(); drawPreview();
      return { done: done, failed: failed, limit: limit };
    });
  }
  function trWhere() { return trUsed.device && !trUsed.online ? ' on this device (instant)' : trUsed.device ? '' : ''; }
  function translateAll() {
    if (tr.busy) return;
    var targets = S.langs.filter(function (l) { return l !== S.srcLang; });
    if (!targets.length) { YB.toast('Tick at least one other language first'); return; }
    if (!captionedCount()) { YB.toast('Add captions first (fill them from a story, or type them under Order & timing)'); return; }
    translateLangs(targets).then(function (r) {
      if (!r.done && !r.failed) { $('translateNote').textContent = '✓ Every caption is already translated.'; return; }
      $('translateNote').textContent = r.limit ? '⚠️ The free online translator\'s daily limit was reached after ' + r.done + ' captions. Use Chrome or Edge on a computer for unlimited instant translation, add an email under "Translation limit", or try tomorrow — finished ones are saved.'
        : r.failed ? '✓ ' + r.done + ' translated · ' + r.failed + ' couldn\'t be translated (check the internet and try again).' : '✓ Translated ' + r.done + ' captions into ' + targets.map(langName).join(', ') + trWhere() + '.';
    });
  }

  function renderSubs() {
    $('capOn').checked = !!S.capOn;
    document.querySelectorAll('[data-cap-style]').forEach(function (b) { var on = b.getAttribute('data-cap-style') === S.capStyle; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    $('capWordsVal').textContent = S.capWords; $('capSizeVal').textContent = Math.round(S.capSize * 100) + '%';
    $('langCount').textContent = '· ' + S.langs.length + ' of ' + MAX_LANGS;
    $('langList').innerHTML = LANGS.map(function (l) {
      var on = S.langs.indexOf(l[0]) !== -1, src = l[0] === S.srcLang;
      var n = on ? panels.filter(function (q) { return capOf(q, l[0]); }).length : 0, total = captionedCount();
      var stat = !on || !total ? '' : n >= total ? ' ✓' : src ? '' : ' · ' + n + '/' + total;
      return '<label class="cx-lang' + (on ? ' on' : '') + '"><input type="checkbox" value="' + l[0] + '"' + (on ? ' checked' : '') + (src ? ' disabled' : '') + (!on && S.langs.length >= MAX_LANGS ? ' disabled' : '') + '><span>' + l[1] + (src ? ' · original' : '') + stat + '</span></label>';
    }).join('');
    $('srcLang').innerHTML = LANGS.map(function (l) { return '<option value="' + l[0] + '"' + (l[0] === S.srcLang ? ' selected' : '') + '>' + l[1] + '</option>'; }).join('');
    $('showLang').innerHTML = S.langs.map(function (l) { return '<option value="' + l + '"' + (l === S.showLang ? ' selected' : '') + '>' + langName(l) + '</option>'; }).join('');
    $('showLangWrap').hidden = !S.capOn || S.langs.length < 2;
    $('exportAllBtn').hidden = !S.capOn || S.langs.length < 2 || !captionedCount();
    var stories = YB.store.get('stories', []) || [];
    var cur = $('capStory').value;
    $('capStory').innerHTML = stories.length ? stories.map(function (st) { return '<option value="' + YB.esc(st.id) + '">' + YB.esc(st.title || 'Untitled story') + '</option>'; }).join('') : '<option value="">No stories in Story Studio yet</option>';
    if (cur && stories.some(function (st) { return st.id === cur; })) $('capStory').value = cur;
    else {
      // suggest the story whose audio is the voice track
      var take = (YB.store.get('voiceTakes', []) || []).find(function (x) { return 'take:' + x.id === S.takeId; });
      var match = take && stories.find(function (st) { return st.title === take.groupTitle; });
      if (match) $('capStory').value = match.id;
    }
    $('capFillBtn').disabled = !stories.length;
    if (typeof renderNarr === 'function') renderNarr();
  }

  /* ---------- Narrate & dub (your Chatterbox server) ----------
     Each panel's caption is spoken as its own clip, in the video's subtitle language,
     with the same voice (each character's Voice Studio voice, or one you pick).
     Non-English uses Chatterbox Multilingual, which keeps the voice (it clones it from
     the same sample). Because every clip's length is known, panels and captions are
     timed to the real speech. Clips are saved on this device per language. */
  var DUB_LANGS = ['ar', 'da', 'de', 'el', 'en', 'es', 'fi', 'fr', 'he', 'hi', 'it', 'ja', 'ko', 'ms', 'nl', 'no', 'pl', 'pt', 'ru', 'sv', 'sw', 'tr', 'zh'];
  function dubCode(l) { return l === 'zh-CN' ? 'zh' : l; }
  function chatterboxDub(l) { return DUB_LANGS.indexOf(dubCode(l)) !== -1; }
  function onDevice() { return S.voiceEngine !== 'chatterbox' && !!window.YBLocalVoice; }
  function canDub(l) { return onDevice() ? window.YBLocalVoice.supports(l) : chatterboxDub(l); }
  // On-device voice for a panel: one chosen voice, or a different voice per character.
  function devVoiceFor(q, lang) {
    var list = window.YBLocalVoice ? window.YBLocalVoice.voices(lang) : []; if (!list.length) return '';
    var pick = (S.devVoices || {})[lang] || 'mix';
    if (pick !== 'mix' && list.some(function (v) { return v.id === pick; })) return pick;
    var st = (YB.store.get('stories', []) || []).find(function (x) { return x.id === q.storyId; });
    var ids = ['narrator'].concat(((st && st.characters) || []).map(function (c) { return c.id; }));
    var k = Math.max(0, ids.indexOf(q.who || 'narrator'));
    return list[k % list.length].id;
  }
  var narr = { lang: '', clips: {}, busy: false, cancel: false };   // clips: panelId → { blob, dur, sig }
  var NARR_LEAD = 0.15, NARR_GAP = 0.45;
  function strHash(t) { var h = 5381; t = String(t); for (var i = 0; i < t.length; i++) h = ((h * 33) ^ t.charCodeAt(i)) >>> 0; return h.toString(36); }
  function voiceForPanel(q) {
    if (S.dubVoice && S.dubVoice !== 'auto') return S.dubVoice;
    var cast = (YB.store.get('voiceCast', {}) || {})[q.storyId] || {}, c = cast[q.who] || cast.narrator;
    if (c && c.key) return c.key;
    if (c && c.id) return 'builtin:' + c.id;
    return S.dubFallback || '';
  }
  function narrSig(q, lang) { return strHash(capOf(q, lang) + '|' + (onDevice() ? 'dev:' + devVoiceFor(q, lang) : voiceForPanel(q)) + '|' + lang); }
  function narrReady(lang) {
    return panels.length > 0 && narr.lang === lang && Object.keys(narr.clips).length > 0 && panels.some(function (q) { return capOf(q, lang); }) && panels.every(function (q) { return !capOf(q, lang) || (narr.clips[q.id] && narr.clips[q.id].sig === narrSig(q, lang)); });
  }
  function narrOn() { return S.audioMode === 'narrate' && narr.lang === S.showLang && Object.keys(narr.clips).length > 0; }
  function clipFor(q) { var c = narrOn() && narr.clips[q.id]; return c && c.sig === narrSig(q, S.showLang) ? c : null; }

  // server
  var srv = { backend: '', cfg: null };
  function srvRoute(cfgKey, path) { var u = srv.cfg && srv.cfg[cfgKey]; return u && /^https?:/.test(u) && u.indexOf(srv.backend) === 0 ? u : srv.backend + path; }
  function connect() {
    var manual = YB.store.get('voiceOverride', '');
    return fetch('./backend-config.json?ts=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
      .then(function (cfg) {
        srv.cfg = cfg || {};
        srv.backend = String(manual || (cfg && cfg.backend_url) || '').replace(/\/+$/, '');
        if (!srv.backend) throw new Error('Your Chatterbox server isn\'t running. Start it in Colab, then try again.');
        return fetch(srvRoute('health_endpoint', '/health'), { cache: 'no-store' }).then(function (r) { if (!r.ok) throw 0; }, function () { throw 0; })
          .catch(function () { throw new Error('Your Chatterbox server isn\'t answering. Start it in Colab (or wait for it), then try again.'); });
      });
  }
  function getJson(url, opts) { return fetch(url, Object.assign({ cache: 'no-store' }, opts || {})).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.detail || ('HTTP ' + r.status)); return j; }); }); }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function untilFree(note) {
    return getJson(srvRoute('backend_state_endpoint', '/state')).then(function (st) {
      if (narr.cancel) throw new Error('cancelled');
      if (st && (st.generation_active || st.model_switching)) { note('Waiting for the server — someone else is generating…'); return wait(4000).then(function () { return untilFree(note); }); }
    }, function () { /* no /state route: carry on */ });
  }
  function ensureModel(lang, note) {
    return getJson(srvRoute('model_info', '/model-info')).then(function (info) {
      var type = info && info.type, need = dubCode(lang) === 'en' ? null : 'multilingual';
      if (!need || type === need) return type;
      if (!confirm('Speaking ' + langName(lang) + ' needs the Multilingual model on your server.\n\nSwitch the server to Multilingual now? This changes the model for everyone using it (you can switch back in Voice Studio).')) throw new Error('cancelled');
      note('Switching the server to Multilingual…');
      return getJson(srvRoute('model_switch_job_endpoint', '/model-switch-jobs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: need }) }).then(function (j) {
        if (!j.switch_id) return need;
        var poll = function () {
          return wait(3000).then(function () { return getJson(srv.backend + '/model-switch-jobs/' + encodeURIComponent(j.switch_id)); }).then(function (r) {
            if (r.status === 'complete') return need;
            if (r.status === 'failed') throw new Error('The server couldn\'t switch to Multilingual: ' + (r.error || 'unknown error'));
            note('Loading the Multilingual model… (this can take a minute)'); return poll();
          }, function () { return poll(); });
        };
        return poll();
      });
    });
  }
  // voice key → { mode, id } on the server (library voices are uploaded once and remembered, like Voice Studio)
  function voiceBlob(key) {
    var src = key.split(':')[0], id = key.slice(src.length + 1);
    if (src === 'preset' || src === 'shared') {
      var dir = src === 'preset' ? 'Voices/Preset Voices' : 'Voices/Our Voices';
      return fetch('./' + dir.split('/').map(encodeURIComponent).join('/') + '/' + encodeURIComponent(id)).then(function (r) { if (!r.ok) throw new Error('Couldn\'t load the voice ' + id); return r.blob().then(function (b) { return { blob: b, name: id }; }); });
    }
    if (src === 'mine') return kv('youtube-blue-voice', 'readonly', function (st, out) { var r = st.get('myvoice:' + id); r.onsuccess = function () { out.v = r.result; }; }).then(function (v) {
      if (!v || !v.blob) throw new Error('That My Voices voice isn\'t on this device any more.'); return { blob: v.blob, name: (v.name || 'voice') + '.' + (v.ext || 'wav') };
    });
    return Promise.reject(new Error('Unknown voice'));
  }
  var refFiles = null;
  function serverVoice(key) {
    if (!key) return Promise.reject(new Error('Pick a voice for the narration first.'));
    if (/^builtin:/.test(key)) return Promise.resolve({ mode: 'predefined', id: key.slice(8) });
    var map = YB.store.get('voiceRefMap', {}) || {}, mine = (map[srv.backend] || {})[key];
    var list = refFiles ? Promise.resolve(refFiles) : getJson(srvRoute('reference_files_endpoint', '/get_reference_files')).then(function (r) { refFiles = Array.isArray(r) ? r : (r.files || r.reference_files || []); return refFiles; }, function () { return []; });
    return list.then(function (files) {
      if (mine && files.indexOf(mine) !== -1) return { mode: 'clone', id: mine };
      return voiceBlob(key).then(function (v) {
        var ext = /\.mp3$/i.test(v.name) ? 'mp3' : 'wav', fd = new FormData();
        fd.append('files', new File([v.blob], 'yb-' + key.split(':')[0] + '-' + strHash(key + v.blob.size) + '.' + ext, { type: ext === 'mp3' ? 'audio/mpeg' : 'audio/wav' }));
        return getJson(srvRoute('reference_upload_endpoint', '/upload_reference'), { method: 'POST', body: fd }).then(function (j) {
          var name = (j.uploaded_files || [])[0]; if (!name) throw new Error('The server didn\'t accept the voice sample.');
          var all = YB.store.get('voiceRefMap', {}) || {}; Object.keys(all).forEach(function (b) { if (b !== srv.backend) delete all[b]; });
          (all[srv.backend] = all[srv.backend] || {})[key] = name; YB.store.set('voiceRefMap', all);
          if (refFiles) refFiles.push(name);
          return { mode: 'clone', id: name };
        });
      });
    });
  }
  function speak(text, voice, lang, type) {
    var body = { text: text, voice_mode: voice.mode, output_format: 'wav', split_text: true, chunk_size: 300, temperature: 0.8, seed: 42, speed_factor: 1, language: dubCode(lang) };
    if (voice.mode === 'clone') body.reference_audio_filename = voice.id; else body.predefined_voice_id = voice.id;
    if (type !== 'turbo') body.exaggeration = 0.5;
    if (type === 'original') body.cfg_weight = 0.5;
    return getJson(srvRoute('job_endpoint', '/jobs'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (j) {
      if (!j.job_id) throw new Error('The server didn\'t start the job.');
      var tpl = srv.cfg && srv.cfg.job_status_template, st = tpl && tpl.indexOf('{job_id}') !== -1 ? tpl.replace('{job_id}', encodeURIComponent(j.job_id)) : srv.backend + '/jobs/' + encodeURIComponent(j.job_id);
      var atpl = srv.cfg && srv.cfg.job_audio_template, au = atpl && atpl.indexOf('{job_id}') !== -1 ? atpl.replace('{job_id}', encodeURIComponent(j.job_id)) : st + '/audio';
      var poll = function () {
        if (narr.cancel) throw new Error('cancelled');
        return wait(1200).then(function () { return getJson(st); }).then(function (r) {
          if (r.status === 'complete') return fetch(au, { cache: 'no-store' }).then(function (a) { if (!a.ok) throw new Error('Couldn\'t download the clip.'); return a.blob(); });
          if (r.status === 'failed') throw new Error(r.error || 'The server couldn\'t make this clip.');
          return poll();
        });
      };
      return poll();
    });
  }
  function clipDur(blob) {
    var AC = window.AudioContext || window.webkitAudioContext, ac = new AC();
    return blob.arrayBuffer().then(function (b) { return new Promise(function (res, rej) { ac.decodeAudioData(b, res, rej); }); })
      .then(function (buf) { ac.close().catch(function () {}); return buf; }, function (e) { ac.close().catch(function () {}); throw e; });
  }
  function narrKey(lang, id) { return 'narr:' + lang + ':' + id; }
  function loadNarration(lang) {
    narr.lang = lang; narr.clips = {};
    return panels.reduce(function (p, q) {
      return p.then(function () {
        return kv(DB, 'readonly', function (st, out) { var r = st.get(narrKey(lang, q.id)); r.onsuccess = function () { out.v = r.result; }; }).then(function (v) { if (v && v.blob) narr.clips[q.id] = v; });
      });
    }, Promise.resolve());
  }
  // One voice track: every clip placed at the start of its panel (48 kHz, mono WAV).
  function buildNarrationTrack() {
    var tl = timeline(), rate = 48000, len = Math.ceil((tl.total + 0.5) * rate), mix = new Float32Array(len);
    var jobs = panels.map(function (q, i) {
      var c = clipFor(q); if (!c) return null;
      return clipDur(c.blob).then(function (buf) {
        var OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, off = new OAC(1, Math.ceil(buf.duration * rate), rate);
        var sn = off.createBufferSource(); sn.buffer = buf; sn.connect(off.destination); sn.start();
        return off.startRendering().then(function (r) {
          var d = r.getChannelData(0), at = Math.round((tl.starts[i] + NARR_LEAD) * rate);
          for (var k = 0; k < d.length && at + k < len; k++) mix[at + k] += d[k];
        });
      });
    });
    return Promise.all(jobs).then(function () {
      var buf = new ArrayBuffer(44 + len * 2), dv = new DataView(buf);
      function str(o, t) { for (var i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); }
      str(0, 'RIFF'); dv.setUint32(4, 36 + len * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
      dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, len * 2, true);
      for (var i = 0, o = 44; i < len; i++, o += 2) { var v = Math.max(-1, Math.min(1, mix[i])); dv.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
      return new Blob([buf], { type: 'audio/wav' });
    });
  }
  function applyNarration() {
    if (S.audioMode !== 'narrate') return Promise.resolve();
    var lang = S.showLang;
    return (narr.lang === lang ? Promise.resolve() : loadNarration(lang)).then(function () {
      renderNarr();
      if (!Object.keys(narr.clips).length) { clearAudio(); return; }
      return buildNarrationTrack().then(function (wav) { useAudio(wav, 'Narration · ' + langName(lang)); renderNarr(); });
    });
  }
  function makeNarration() {
    if (narr.busy) return;
    var lang = S.showLang;
    if (!canDub(lang)) { YB.toast(langName(lang) + ' can\'t be spoken by Chatterbox yet — subtitles only'); return; }
    var todo = panels.filter(function (q) { return capOf(q, S.srcLang); });
    if (!todo.length) { YB.toast('Add captions first — the narration speaks each panel\'s caption'); return; }
    narr.busy = true; narr.cancel = false; renderNarr();
    var note = function (t) { $('narrText').textContent = t; };
    // On this device: Piper voices in the browser — no server, works offline once a voice is downloaded.
    function speakOnDevice() {
      var list = panels.filter(function (q) { return capOf(q, lang); }), k = 0;
      var next = function () {
        if (narr.cancel) throw new Error('cancelled');
        if (k >= list.length) return 'device';
        var q = list[k++], sig = narrSig(q, lang), have = narr.clips[q.id], vid = devVoiceFor(q, lang);
        bar(k / list.length);
        if (have && have.sig === sig) return next();
        note('Speaking panel ' + (panels.indexOf(q) + 1) + ' of ' + panels.length + ' · ' + langName(lang) + ' · on this device');
        var say = function (t) {
          return window.YBLocalVoice.speak(t, vid, function (f) {
            note('Downloading the ' + (window.YBLocalVoice.find(vid) || {}).name + ' voice (only the first time)… ' + Math.round(f * 100) + '%');
          });
        };
        return say(capOf(q, lang)).catch(function (e) {
          if (/download|internet|engine/i.test(e.message)) throw e;            // can't continue without the voice
          return say(capOf(q, lang).replace(/[^\p{L}\p{N}\s.,!?'’-]/gu, ' ')).catch(function () { skipped++; return null; });   // retry plain text, else leave this panel silent
        }).then(function (blob) {
          if (!blob) return next();
          return clipDur(blob).then(function (buf) { var c = { blob: blob, dur: buf.duration, sig: sig }; narr.clips[q.id] = c; made++; kv(DB, 'readwrite', function (st) { st.put(c, narrKey(lang, q.id)); }); return next(); });
        });
      };
      return Promise.resolve().then(next);
    }
    var bar = function (p) { $('narrBar').style.width = (p * 100).toFixed(1) + '%'; };
    var made = 0, skipped = 0, type = '', translated = false;
    // 1. words: translated here first (instant on Chrome/Edge desktop) — no server needed
    var needTr = lang !== S.srcLang && todo.some(function (q) { return !capOf(q, lang); });
    (needTr ? translateLangs([lang], function (t) { note(t + ' · ' + langName(lang)); }).then(function (r) {
      if (r.failed && todo.some(function (q) { return !capOf(q, lang); })) throw new Error(r.limit ? 'The free online translator\'s daily limit was reached. Use Chrome or Edge on a computer for unlimited instant translation, or try again tomorrow.' : 'Some captions couldn\'t be translated — check the internet and try again.');
      translated = true;
    }) : Promise.resolve()).then(function () {
      return narr.lang === lang ? null : loadNarration(lang);
    }).then(function () {
      if (onDevice()) return speakOnDevice();
      // 2. voice: only this step needs Chatterbox (it's what speaks in your cloned voices)
      note((translated ? '✓ Captions translated · ' : '') + 'Connecting to your Chatterbox server for the voice…'); bar(0.02);
      return connect().catch(function (e) {
        throw new Error((translated ? 'The ' + langName(lang) + ' captions are translated and the subtitles are ready. ' : '') + 'To speak them in your voices, start your Chatterbox server in Colab, then press this again.');
      });
    }).then(function (dev) { if (dev === 'device') return 'device'; return untilFree(note).then(function () { return ensureModel(lang, note); }); }).then(function (t) {
      if (t === 'device') return;
      type = t;
      var list = panels.filter(function (q) { return capOf(q, lang); }), k = 0;
      var next = function () {
        if (narr.cancel) throw new Error('cancelled');
        if (k >= list.length) return;
        var q = list[k++], sig = narrSig(q, lang), have = narr.clips[q.id];
        bar(k / list.length);
        if (have && have.sig === sig) return next();   // already made with this text & voice
        note('Speaking panel ' + (panels.indexOf(q) + 1) + ' of ' + panels.length + ' · ' + langName(lang));
        return untilFree(note).then(function () { return serverVoice(voiceForPanel(q)); }).then(function (v) { return speak(capOf(q, lang), v, lang, type); })
          .then(function (blob) { return clipDur(blob).then(function (buf) { return { blob: blob, dur: buf.duration }; }); })
          .then(function (c) {
            c.sig = sig; narr.clips[q.id] = c; made++;
            kv(DB, 'readwrite', function (st) { st.put(c, narrKey(lang, q.id)); });
            return next();
          });
      };
      return next();
    }).then(function () {
      bar(1); note('Building the voice track…');
      chunkCache = {};
      return applyNarration().then(function () {
        narr.busy = false; note('✓ Narration ready · ' + langName(lang) + (made ? ' · ' + made + ' new clip' + (made === 1 ? '' : 's') : '') + (skipped ? ' · ' + skipped + ' panel' + (skipped === 1 ? '' : 's') + ' couldn\'t be spoken (left silent)' : ''));
      });
    }).then(function () { renderAll(); renderNarr(); }, function (e) {
      narr.busy = false; renderNarr();
      var msg = e && e.message || 'Something went wrong.';
      if (translated && !/captions are translated/.test(msg)) msg = 'The ' + langName(lang) + ' captions are translated and the subtitles are ready. ' + msg;
      note(e && e.message === 'cancelled' ? 'Stopped — finished panels are saved; press Make narration to continue.' : '⚠️ ' + msg);
      if (Object.keys(narr.clips).length) applyNarration();
    });
  }
  function renderNarr() {
    if (!$('audioNarrate')) return;
    $('audioNarrate').hidden = S.audioMode !== 'narrate';
    if (S.audioMode !== 'narrate') return;
    var lang = S.showLang, ready = narrReady(lang), auto = panels.some(function (q) { return q.who; });
    document.querySelectorAll('[data-engine]').forEach(function (b) { var on = (b.getAttribute('data-engine') === 'chatterbox') === !onDevice(); b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    $('engineNote').textContent = onDevice() ? 'Free and private. Runs right here, with no server. Each voice downloads once (about 20–75 MB), then it works instantly, even offline. Ready-made voices, not your cloned ones.' : 'Your own cloned voices, the same voice in every language. Needs your Chatterbox server running in Colab.';
    $('narrLang').innerHTML = S.langs.map(function (l) { var ok = canDub(l), other = onDevice() ? chatterboxDub(l) : (window.YBLocalVoice && window.YBLocalVoice.supports(l)); return '<option value="' + l + '"' + (l === lang ? ' selected' : '') + (ok ? '' : ' disabled') + '>' + langName(l) + (ok ? '' : other ? (onDevice() ? ' (Chatterbox only)' : ' (on-device only)') : ' (subtitles only)') + '</option>'; }).join('');
    if (onDevice()) {
      var dv = window.YBLocalVoice.voices(lang), cur = (S.devVoices || {})[lang] || 'mix';
      $('dubVoice').innerHTML = dv.length ? '<option value="mix">A different voice for each character</option>' + dv.map(function (x) { return '<option value="' + x.id + '"' + (x.id === cur ? ' selected' : '') + '>' + YB.esc(x.name) + '</option>'; }).join('') : '<option value="">No on-device voice for ' + langName(lang) + ' — use Chatterbox</option>';
      if (cur === 'mix') $('dubVoice').value = 'mix';
      $('narrMake').disabled = narr.busy || !dv.length; $('narrStop').hidden = !narr.busy; $('narrProg').hidden = !narr.busy && !$('narrText').textContent;
      $('narrMake').textContent = ready ? '🔁 Make again with changes' : '🎙 Make narration · ' + langName(lang);
      return;
    }
    var opts = [], lib = YB.store.get('voiceLibCache', null) || {}, mine = YB.store.get('myVoices', []) || [], builtin = YB.store.get('voiceList', []) || [];
    if (auto) opts.push('<option value="auto">Each character\'s Voice Studio voice</option>');
    function group(label, items) { if (items.length) opts.push('<optgroup label="' + label + '">' + items.join('') + '</optgroup>'); }
    group('Presets', (lib.preset || []).map(function (e) { return '<option value="preset:' + YB.esc(e.file) + '">' + YB.esc(e.name) + '</option>'; }));
    group('Our Voices', (lib.shared || []).map(function (e) { return '<option value="shared:' + YB.esc(e.file) + '">' + YB.esc(e.name) + '</option>'; }));
    group('My Voices', mine.map(function (m) { return '<option value="mine:' + YB.esc(m.id) + '">' + YB.esc(m.name) + '</option>'; }));
    group('Chatterbox Voices', builtin.map(function (v) { return '<option value="builtin:' + YB.esc(v.filename) + '">' + YB.esc(v.display_name || v.filename) + '</option>'; }));
    $('dubVoice').innerHTML = opts.join('') || '<option value="">Open Voice Studio once to load the voices</option>';
    var want = S.dubVoice || (auto ? 'auto' : '');
    if (want && $('dubVoice').querySelector('option[value="' + want.replace(/"/g, '\\"') + '"]')) $('dubVoice').value = want;
    S.dubVoice = $('dubVoice').value;
    $('narrMake').disabled = narr.busy; $('narrStop').hidden = !narr.busy; $('narrProg').hidden = !narr.busy && !$('narrText').textContent;
    $('narrMake').textContent = ready ? '🔁 Make again with changes' : '🎙 Make narration · ' + langName(lang);
  }
  var listsLoaded = false;
  function loadVoiceLists() {
    if (listsLoaded) return; listsLoaded = true;
    var lib = YB.store.get('voiceLibCache', null);
    var a = lib && lib.preset ? Promise.resolve() : fetch('./Voices/index.json', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (j) YB.store.set('voiceLibCache', { at: Date.now(), preset: j.preset || [], shared: j.shared || [] });
    }, function () {});
    var b = (YB.store.get('voiceList', []) || []).length ? Promise.resolve() : connect().then(function () { return getJson(srvRoute('predefined_voices_endpoint', '/get_predefined_voices')); }).then(function (v) {
      v = (Array.isArray(v) ? v : []).map(function (x) { return typeof x === 'string' ? { display_name: x.replace(/\.(wav|mp3)$/i, ''), filename: x } : { display_name: x.display_name || x.filename, filename: x.filename }; }).filter(function (x) { return x.filename; });
      if (v.length) YB.store.set('voiceList', v);
    }, function () {});
    Promise.all([a, b]).then(renderNarr);
  }
  function wireNarr() {
    if (!$('audioNarrate')) return;
    $('narrLang').addEventListener('change', function () { S.showLang = this.value; saveSettings(); renderSubs(); renderList(); applyNarration().then(function () { renderAll(); }); });
    $('dubVoice').addEventListener('change', function () {
      if (onDevice()) { S.devVoices = S.devVoices || {}; S.devVoices[S.showLang] = this.value; } else S.dubVoice = this.value;
      saveSettings(); renderNarr();
    });
    document.querySelectorAll('[data-engine]').forEach(function (b) {
      b.addEventListener('click', function () { S.voiceEngine = b.getAttribute('data-engine'); saveSettings(); renderNarr(); if (S.audioMode === 'narrate') applyNarration().then(function () { renderAll(); renderNarr(); }); });
    });
    $('narrMake').addEventListener('click', makeNarration);
    $('narrStop').addEventListener('click', function () { narr.cancel = true; });
  }

  /* ---------- Looks UI ---------- */
  function renderLooks() {
    $('templates').innerHTML = TEMPLATES.map(function (t) {
      var on = S.bg === t.bg && S.frame === t.frame && S.overlay === t.overlay && (!t.bgColor || t.bgColor === S.bgColor);
      return '<button type="button" class="cx-tpl' + (on ? ' on' : '') + '" data-tpl="' + t.id + '" role="radio" aria-checked="' + on + '"><span class="cx-tpl-ico">' + t.ico + '</span><span>' + t.name + '</span></button>';
    }).join('');
    ['bg', 'frame', 'overlay', 'bgColor'].forEach(function (k) { $(k).value = S[k]; });
    $('bgColor').closest('label').hidden = ['blur', 'paper', 'custom'].indexOf(S.bg) !== -1;
    $('customClear').hidden = !custom.bg && !custom.ov;
    document.querySelectorAll('[data-umode]').forEach(function (b) { var on = b.getAttribute('data-umode') === S.uploadMode; b.classList.toggle('on', on); b.setAttribute('aria-checked', on ? 'true' : 'false'); });
    $('dropTitle').textContent = S.uploadMode === 'images' ? 'Choose images' : 'Choose comic images';
  }
  function loadCustom(key) {
    return kv(DB, 'readonly', function (st, out) { var r = st.get(key); r.onsuccess = function () { out.v = r.result; }; }).then(function (b) {
      if (!b) return null;
      return loadImg(b).then(function (o) { return o.img; }, function () { return null; });
    });
  }
  function setCustom(which, file) {
    if (!file) return;
    loadImg(file).then(function (o) {
      custom[which] = o.img; looks = {}; lruStore = {}; lruOrder = [];
      kv(DB, 'readwrite', function (st) { st.put(file, which === 'bg' ? 'customBg' : 'customOv'); });
      if (which === 'bg') S.bg = 'custom'; else S.overlay = 'custom';
      saveSettings(); renderLooks(); drawPreview();
      YB.toast(which === 'bg' ? 'Background added — fitted to the video shape' : 'Overlay added — fitted to the video shape');
    }, function (e) { YB.toast(e.message); });
  }
  function wireLooks() {
    $('templates').addEventListener('click', function (e) {
      var b = e.target.closest('[data-tpl]'); if (!b) return;
      var t = TEMPLATES.find(function (x) { return x.id === b.getAttribute('data-tpl'); });
      S.bg = t.bg; S.frame = t.frame; S.overlay = t.overlay; if (t.bgColor) S.bgColor = t.bgColor;
      looks = {}; lruStore = {}; lruOrder = []; saveSettings(); renderLooks(); drawPreview();
    });
    ['bg', 'frame', 'overlay', 'bgColor'].forEach(function (k) {
      $(k).addEventListener(k === 'bgColor' ? 'input' : 'change', function () {
        var v = this.value;
        if (v === 'custom' && ((k === 'bg' && !custom.bg) || (k === 'overlay' && !custom.ov))) { $(k === 'bg' ? 'bgFile' : 'ovFile').click(); this.value = S[k]; return; }
        S[k] = v; looks = {}; lruStore = {}; lruOrder = []; saveSettings(); renderLooks(); drawPreview();
      });
    });
    $('bgFile').addEventListener('change', function () { setCustom('bg', this.files[0]); this.value = ''; });
    $('ovFile').addEventListener('change', function () { setCustom('ov', this.files[0]); this.value = ''; });
    $('customClear').addEventListener('click', function () {
      custom = { bg: null, ov: null }; looks = {}; lruStore = {}; lruOrder = [];
      kv(DB, 'readwrite', function (st) { st.delete('customBg'); st.delete('customOv'); });
      if (S.bg === 'custom') S.bg = 'blur'; if (S.overlay === 'custom') S.overlay = 'none';
      saveSettings(); renderLooks(); drawPreview();
    });
    document.querySelectorAll('[data-umode]').forEach(function (b) {
      b.addEventListener('click', function () { S.uploadMode = b.getAttribute('data-umode'); saveSettings(); renderLooks(); });
    });
  }

  function wireSubs() {
    $('capOn').addEventListener('change', function () { S.capOn = this.checked; saveSettings(); renderSubs(); renderAll(); });
    document.querySelectorAll('[data-cap-style]').forEach(function (b) { b.addEventListener('click', function () { S.capStyle = b.getAttribute('data-cap-style'); saveSettings(); renderSubs(); drawPreview(); }); });
    ['capPos', 'capColor', 'capHi'].forEach(function (k) { var el = $(k); el.value = S[k]; el.addEventListener('input', function () { S[k] = el.value; saveSettings(); drawPreview(); }); });
    $('capWords').value = S.capWords; $('capSize').value = S.capSize;
    $('capWords').addEventListener('input', function () { S.capWords = +this.value; chunkCache = {}; saveSettings(); renderSubs(); drawPreview(); });
    $('capSize').addEventListener('input', function () { S.capSize = +this.value; saveSettings(); renderSubs(); drawPreview(); });
    $('capCaps').checked = !!S.capCaps; $('capCaps').addEventListener('change', function () { S.capCaps = this.checked; saveSettings(); drawPreview(); });
    $('capTiming').checked = !!S.capTiming; $('capTiming').addEventListener('change', function () { S.capTiming = this.checked; saveSettings(); renderAll(); });
    $('capPace').value = String(S.capPace || 15); $('capPace').addEventListener('change', function () { S.capPace = +this.value; saveSettings(); renderAll(); });
    $('capFillBtn').addEventListener('click', function () { fillFromStory(); });
    $('capClearBtn').addEventListener('click', function () {
      if (!captionedCount() || !confirm('Remove every caption (all languages)?')) return;
      panels.forEach(function (q) { q.cap = {}; }); chunkCache = {}; changed(); renderSubs();
    });
    $('langList').addEventListener('change', function (e) {
      var v = e.target.value; if (!v) return;
      if (e.target.checked) { if (S.langs.length >= MAX_LANGS) { e.target.checked = false; YB.toast('Up to ' + MAX_LANGS + ' languages'); return; } S.langs.push(v); }
      else { S.langs = S.langs.filter(function (l) { return l !== v; }); if (S.showLang === v) S.showLang = S.srcLang; }
      saveSettings(); renderSubs(); renderList(); drawPreview();
    });
    $('srcLang').addEventListener('change', function () {
      var v = this.value;
      if (captionedCount() && !confirm('Are your captions written in ' + langName(v) + '? Existing translations will be redone from it.')) { this.value = S.srcLang; return; }
      panels.forEach(function (q) { var t = capOf(q, S.srcLang); q.cap = {}; if (t) q.cap[v] = t; });
      S.srcLang = v; if (S.langs.indexOf(v) === -1) S.langs.unshift(v); if (S.langs.length > MAX_LANGS) S.langs.length = MAX_LANGS;
      S.showLang = v; chunkCache = {}; saveSettings(); changed(); renderSubs();
    });
    $('showLang').addEventListener('change', function () { S.showLang = this.value; saveSettings(); renderList(); renderFacts(); drawPreview(); if (S.audioMode === 'narrate') applyNarration().then(function () { renderAll(); renderNarr(); }); });
    $('translateBtn').addEventListener('click', translateAll);
    $('mmEmail').value = S.mmEmail || '';
    $('mmEmail').addEventListener('change', function () { S.mmEmail = this.value.trim(); saveSettings(); });
    $('srtList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-srt]'); if (!b) return;
      var l = b.getAttribute('data-srt'), first = pages[0] ? pages[0].name.replace(/[^\w-]+/g, '-').toLowerCase() : 'comic';
      YB.download(first + '.' + l + '.srt', srtFor(l), 'application/x-subrip');
    });
    $('exportAllBtn').addEventListener('click', function () {
      var langs = S.langs.filter(function (l) { return panels.some(function (q) { return capOf(q, l); }); });
      if (!langs.length) return;
      var missing = S.langs.filter(function (l) { return langs.indexOf(l) === -1; });
      if (missing.length && !confirm(missing.map(langName).join(', ') + (missing.length === 1 ? ' has' : ' have') + ' no captions yet (press Translate captions first). Make the other ' + langs.length + ' now?')) return;
      var keep = S.showLang, k = 0;
      (function step() {
        if (k >= langs.length) { S.showLang = keep; saveSettings(); renderSubs(); renderList(); drawPreview(); YB.toast('All ' + langs.length + ' videos are ready'); return; }
        S.showLang = langs[k++]; renderSubs(); drawPreview();
        $('exportText').textContent = 'Video ' + k + ' of ' + langs.length + ' · ' + langName(S.showLang);
        // with narration on, each language gets its own dubbed voice track (when it has been made)
        (S.audioMode === 'narrate' ? applyNarration() : Promise.resolve()).then(function () { return new Promise(function (r) { setTimeout(r, 400); }); }).then(function () {
          exportVideo(function (ok) { if (ok) step(); else { S.showLang = keep; saveSettings(); renderSubs(); } });
        });
      })();
    });
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
        S_match = data.match || null;
        view.pageId = pages[0] ? pages[0].id : '';
      });
    });
  }

  window.YBComic = { drawFrame: function (x, W, H, t) { drawFrame(x, W, H, t); }, total: function () { return timeline().total; }, timeline: function () { return timeline(); }, schedule: function (i) { return capSchedule(i, timeline(), S.showLang); }, clips: function () { return panels.map(function (q) { var c = clipFor(q); return c ? c.dur : 0; }); } };   // used by tests
  wire();
  wireSubs();
  wireLooks();
  wireNarr();
  setTab('page');
  Promise.all([loadCustom('customBg'), loadCustom('customOv')]).then(function (c) { custom.bg = c[0]; custom.ov = c[1]; looks = {}; lruStore = {}; lruOrder = []; renderLooks(); drawPreview(); });
  renderLooks();
  restore().then(function () {
    renderAll(); renderSubs(); renderMatchNote();
    setAudioMode(S.audioMode === 'file' ? 'none' : S.audioMode);   // a picked file can't be reopened after a reload
    autoMatch();
  });
})();
