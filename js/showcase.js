/* =========================================================
   Youtube Blue — showcase.js · Photo Showcase (barber portfolio)
   1. Add photos → each is cropped by hand (drag, pinch / zoom, straighten,
      rotate, mirror) into the chosen size (Instagram 4:5, square, story 9:16…).
   2. Pro looks: one-tap looks + auto-fix (removes the yellow shop-light tint),
      sharpening for clean lines, background blur and vignette — all done on
      the device, pixel by pixel, so it looks the same in every browser.
   3. Sets: 3+ shots of one cut (front / side / back…) become one collage and
      one part of the slideshow.
   4. Slideshow with barber-style transitions (razor wipe, flash, slide, zoom…),
      intro / "book now" cards, your name on every photo, optional music →
      MP4 video. Photos and sets download one by one or all at once (ZIP).
   Everything stays on this device (IndexedDB "youtube-blue-showcase").
   ========================================================= */
(function () {
  'use strict';

  var FORMATS = {
    ig45: { w: 1080, h: 1350, name: 'Instagram post', sub: '4:5 · Instagram & Facebook feed', ar: 'portrait' },
    square: { w: 1080, h: 1080, name: 'Square', sub: '1:1 · theCut, Instagram, Facebook', ar: 'square' },
    p34: { w: 1080, h: 1440, name: 'Portrait', sub: '3:4 · theCut, phone photos', ar: 'p34' },
    story: { w: 1080, h: 1920, name: 'Vertical video', sub: '9:16 · Reels, TikTok, Shorts, Stories', ar: 'short' },
    wide: { w: 1920, h: 1080, name: 'YouTube', sub: '16:9 · YouTube video, Facebook', ar: 'long' },
    thumb: { w: 1280, h: 720, name: 'YouTube thumbnail', sub: '16:9 · 1280×720', ar: 'long' }
  };
  var LABELS = ['', 'Front', 'Side', 'Left side', 'Right side', 'Back', 'Top', 'Line-up', 'Beard', 'Detail'];
  var STAGES = [['before', 'Before'], ['after', 'After']];
  var ADJ = [  // key, name, min, max (shown ×100)
    ['exposure', 'Brightness', -1, 1], ['contrast', 'Contrast', -0.6, 0.8], ['saturation', 'Colour', -1, 1],
    ['warmth', 'Warmth', -1, 1], ['shine', 'Shine control', 0, 1], ['fade', 'Matte', 0, 1], ['sharpen', 'Sharpness', 0, 1.5],
    ['focus', 'Background blur', 0, 1], ['vignette', 'Vignette', 0, 1]
  ];
  var LOOKS = [
    ['natural', 'Natural', {}],
    ['clean', 'Pro clean', { contrast: 0.12, saturation: 0.05, sharpen: 0.55, vignette: 0.12, shine: 0.45 }],
    ['crisp', 'Crisp fade', { exposure: 0.04, contrast: 0.24, sharpen: 0.95, vignette: 0.2, shine: 0.45 }],
    ['studio', 'Studio', { exposure: 0.08, contrast: 0.16, saturation: 0.06, warmth: 0.08, sharpen: 0.6, vignette: 0.25, focus: 0.4, shine: 0.5 }],
    ['cool', 'Cool steel', { contrast: 0.2, saturation: -0.08, warmth: -0.22, sharpen: 0.65, vignette: 0.22, shine: 0.45 }],
    ['vivid', 'Vivid', { contrast: 0.2, saturation: 0.3, sharpen: 0.55, vignette: 0.15, shine: 0.35 }],
    ['matte', 'Matte', { contrast: -0.06, saturation: -0.12, fade: 0.3, sharpen: 0.35, vignette: 0.15, shine: 0.4 }],
    ['moody', 'Moody', { exposure: -0.12, contrast: 0.32, saturation: -0.18, warmth: 0.05, sharpen: 0.6, vignette: 0.5, focus: 0.5, shine: 0.5 }],
    ['bw', 'Black & white', { bw: 1, contrast: 0.32, sharpen: 0.7, vignette: 0.3, shine: 0.3 }]
  ];
  var LAYOUTS = [['split', 'Before | After'], ['hero', 'Big + small'], ['row', 'Side by side'], ['stack', 'Stacked'], ['grid', 'Grid']];
  var TRANS = [['mix', 'Barber mix (varies)'], ['blade', 'Razor wipe'], ['flash', 'Camera flash'], ['slide', 'Slide'], ['zoom', 'Zoom'], ['fade', 'Fade'], ['wipe', 'Wipe'], ['blur', 'Blur'], ['cut', 'Straight cut']];
  var MIX = ['blade', 'slide', 'flash', 'zoom'];
  var FPS = 30, TR = 0.55, INTRO = 2.4, OUTRO = 3;

  var S = Object.assign({ format: 'ig45', trans: 'mix', dur: 2.5, kenBurns: true, intro: true, outro: true, plain: false, showStage: true, showAngle: true, showBrand: true, showTitle: true, showText: true,
    fx: 'pop', beatSync: true, musicVol: 85, musicStart: null, capStyle: 'box', capPos: 'bottom', capAnim: 'pop', capSize: 1, introTitle: '', introSub: '', outroTitle: '', outroSub: '',
    shop: '', handle: '', book: '', color: '#e11d48', wmPos: 'br', wmStyle: 'tag' }, YB.store.get('scSettings', {}));
  if (!FORMATS[S.format]) S.format = 'ig45';
  var photos = [], sets = [], slides = [], blobs = {}, imgs = {}, music = null, logo = null;
  var cur = '', selecting = false, picked = [], rec = null, lastVideo = null;
  var brush = 'before', target = '';   // while picking: what a tap marks the photo as, and which client it goes to

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function saveSettings() { YB.store.set('scSettings', S); }
  // What goes on the pictures: each can be switched off, and "Plain photos" switches everything off at once.
  function show(k) { return !S.plain && S[k] !== false; }
  function dims() { var f = FORMATS[S.format]; return { W: f.w, H: f.h }; }
  function photoById(id) { return photos.find(function (p) { return p.id === id; }); }
  function setById(id) { return sets.find(function (s) { return s.id === id; }); }
  function setOf(pid) { return sets.find(function (s) { return s.ids.indexOf(pid) !== -1; }); }
  function photoNo(p) { return photos.indexOf(p) + 1; }
  function stageName(p) { return p.stage === 'before' ? 'Before' : p.stage === 'after' ? 'After' : ''; }
  // What a photo says on itself: "BEFORE · SIDE", "AFTER", "FRONT"…
  function chipText(p, withAngle) { return [stageName(p), withAngle === false ? '' : p.label].filter(Boolean).join(' · '); }
  function tagText(p, angle) { return [show('showStage') ? stageName(p) : '', angle && show('showAngle') ? p.label : ''].filter(Boolean).join(' · '); }
  function photoTitle(p) { return 'Photo ' + photoNo(p) + (chipText(p) ? ' · ' + chipText(p) : ''); }

  /* ---------- Storage ---------- */
  var DB = 'youtube-blue-showcase';
  function openDb() {
    return new Promise(function (res) {
      if (!window.indexedDB) return res(null);
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = r.onblocked = function () { res(null); };
    });
  }
  function kv(mode, fn) {
    return openDb().then(function (db) {
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
  function putBlob(id, b) { return kv('readwrite', function (st) { st.put(b, 'blob:' + id); }); }
  function getBlob(id) { return kv('readonly', function (st, out) { var r = st.get('blob:' + id); r.onsuccess = function () { out.v = r.result; }; }); }
  function delBlob(id) { return kv('readwrite', function (st) { st.delete('blob:' + id); }); }
  var unsaved = false, saveSoon = YB.debounce(saveNow, 400);
  function saveProject() { unsaved = true; saveSoon(); }
  document.addEventListener('visibilitychange', function () { if (document.hidden && unsaved) saveNow(); });
  window.addEventListener('pagehide', function () { if (unsaved) saveNow(); });
  function clean(o) { var x = {}; Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') x[k] = o[k]; }); return x; }
  function saveNow() {
    if (!unsaved) return; unsaved = false;
    var data = { photos: photos.map(clean), sets: sets.map(clean), slides: slides.map(clean), music: music ? clean(music) : null, logo: logo ? clean(logo) : null };
    kv('readwrite', function (st) { st.put(data, 'project'); });
  }

  /* ---------- Images ---------- */
  function loadImg(blob) {
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(blob), im = new Image();
      im.onload = function () { res(im); };   // the URL stays alive: the picture is drawn many times
      im.onerror = function () { URL.revokeObjectURL(url); rej(new Error('decode')); };
      im.src = url;
    });
  }
  // Photos are stored upright (phone rotation applied) and at most 2560 px on the long side.
  function normalise(file) {
    return loadImg(file).then(function (im) {
      var w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, 2560 / Math.max(w, h));
      var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
      var x = c.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(im.src);
      return new Promise(function (res) { c.toBlob(function (b) { res({ blob: b, w: c.width, h: c.height }); }, 'image/jpeg', 0.93); });
    });
  }
  function ensureImg(p) {
    if (imgs[p.blobId]) return Promise.resolve(imgs[p.blobId]);
    var b = blobs[p.blobId]; if (!b) return Promise.reject(new Error('missing'));
    return loadImg(b).then(function (im) { imgs[p.blobId] = im; p._lv = p._lv || autoLevels(im); return im; });
  }

  /* ---------- Look: auto-fix ---------- */
  // Per-channel levels (0.4 % / 99.6 %) plus a gentle grey-world balance: whites come out white
  // under yellow shop lights, without crushing skin tones.
  function autoLevels(im) {
    var c = document.createElement('canvas'), k = 220 / Math.max(im.naturalWidth, im.naturalHeight);
    c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
    var x = c.getContext('2d'); x.drawImage(im, 0, 0, c.width, c.height);
    var d = x.getImageData(0, 0, c.width, c.height).data, n = d.length / 4, hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
    for (var i = 0; i < d.length; i += 4) { hist[0][d[i]]++; hist[1][d[i + 1]]++; hist[2][d[i + 2]]++; }
    var lo = [], hi = [];
    hist.forEach(function (h, ch) {
      var a = 0, s = 0; while (a < 255 && s + h[a] < n * 0.004) s += h[a++];
      var b = 255; s = 0; while (b > 0 && s + h[b] < n * 0.004) s += h[b--];
      if (b - a < 60) { var m = (a + b) / 2; a = Math.max(0, m - 30); b = Math.min(255, m + 30); }
      lo[ch] = a; hi[ch] = b;
    });
    // means after levels → balance gains
    var mean = [0, 0, 0];
    for (i = 0; i < d.length; i += 4) for (var q = 0; q < 3; q++) mean[q] += clamp((d[i + q] - lo[q]) / (hi[q] - lo[q]), 0, 1);
    mean = mean.map(function (m) { return m / n; });
    var avg = (mean[0] + mean[1] + mean[2]) / 3;
    var gain = mean.map(function (m) { return clamp(Math.pow(avg / Math.max(0.02, m), 0.5), 0.85, 1.2); });
    return { lo: lo, hi: hi, gain: gain };
  }

  function lookOf(p) {
    var base = (LOOKS.find(function (l) { return l[0] === p.look; }) || LOOKS[1])[2], a = {};
    ADJ.forEach(function (k) { a[k[0]] = base[k[0]] || 0; });
    a.bw = base.bw || 0;
    Object.keys(p.adj || {}).forEach(function (k) { a[k] = p.adj[k]; });
    return a;
  }
  // Tone curve per channel (auto-fix, brightness, warmth, contrast, matte) → three 256-entry tables.
  function luts(a, lv) {
    var out = [new Uint8ClampedArray(256), new Uint8ClampedArray(256), new Uint8ClampedArray(256)];
    var ex = Math.pow(2, a.exposure * 0.9), con = a.contrast, wr = a.warmth;
    var chMul = [1 + wr * 0.09, 1 + wr * 0.01, 1 - wr * 0.1];
    for (var ch = 0; ch < 3; ch++) for (var v = 0; v < 256; v++) {
      var x = v / 255;
      if (lv) { var y = clamp((v - lv.lo[ch]) / (lv.hi[ch] - lv.lo[ch]), 0, 1) * lv.gain[ch]; x = x + (y - x) * 0.85; }
      x = x * ex * chMul[ch];
      x = clamp(x, 0, 1);
      if (con) {   // smooth S-curve around the middle
        var s = x - 0.5, k = con >= 0 ? 1 + con * 1.6 : 1 + con;
        x = 0.5 + Math.tanh(s * 2 * k) / (2 * Math.tanh(k));
      }
      if (a.fade) x = a.fade * 0.09 + x * (1 - a.fade * 0.17);
      out[ch][v] = Math.round(clamp(x, 0, 1) * 255);
    }
    return out;
  }
  function boxBlur(src, w, h, r) {   // one channel, separable box blur
    var tmp = new Float32Array(w * h), out = new Float32Array(w * h), x, y, acc, n = 2 * r + 1;
    for (y = 0; y < h; y++) {
      var row = y * w; acc = 0;
      for (x = -r; x <= r; x++) acc += src[row + clamp(x, 0, w - 1)];
      for (x = 0; x < w; x++) { tmp[row + x] = acc / n; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; }
    }
    for (x = 0; x < w; x++) {
      acc = 0;
      for (y = -r; y <= r; y++) acc += tmp[clamp(y, 0, h - 1) * w + x];
      for (y = 0; y < h; y++) { out[y * w + x] = acc / n; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; }
    }
    return out;
  }
  // Colour + tone + sharpening, in place on the canvas.
  function grade(x, W, H, a, lv, fast) {
    var id = x.getImageData(0, 0, W, H), d = id.data, L = luts(a, lv), sat = a.bw ? -1 : a.saturation, i, n = W * H;
    var R = L[0], G = L[1], B = L[2], shine = a.shine || 0;
    for (i = 0; i < d.length; i += 4) {
      var r = R[d[i]], g = G[d[i + 1]], b = B[d[i + 2]];
      if (sat) {
        var l = 0.299 * r + 0.587 * g + 0.114 * b, f = 1 + (sat > 0 ? sat * 0.8 : sat);
        r = l + (r - l) * f; g = l + (g - l) * f; b = l + (b - l) * f;
      }
      if (shine) {   // shine control: tames the glare / golden hot-spot of shop lights on skin and scalps
        var l2 = 0.299 * r + 0.587 * g + 0.114 * b;
        if (l2 > 140) {
          var tt = (l2 > 255 ? 1 : (l2 - 140) / 115) * shine, keep = 1 - 0.55 * tt, dk = 1 - 0.14 * tt;
          r = (l2 + (r - l2) * keep) * dk; g = (l2 + (g - l2) * keep) * dk; b = (l2 + (b - l2) * keep) * dk;
        }
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    if (a.sharpen > 0.01 && !fast) {   // unsharp mask on brightness: crisp lines, no colour fringes
      var lum = new Float32Array(n);
      for (i = 0; i < n; i++) lum[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
      var rad = Math.max(1, Math.round(Math.max(W, H) / 1100)), bl = boxBlur(lum, W, H, rad), amt = a.sharpen * 1.3;
      for (i = 0; i < n; i++) {
        var diff = (lum[i] - bl[i]) * amt; if (diff > 40) diff = 40; else if (diff < -40) diff = -40;
        var o = i * 4; d[o] += diff; d[o + 1] += diff; d[o + 2] += diff;
      }
    }
    x.putImageData(id, 0, 0);
  }
  var blurC = null;
  function softBlur(src, W, H, k) {   // fast big blur: shrink, then stretch with smoothing
    blurC = blurC || document.createElement('canvas');
    var w = Math.max(4, Math.round(W / k)), h = Math.max(4, Math.round(H / k));
    blurC.width = w; blurC.height = h;
    var bx = blurC.getContext('2d'); bx.imageSmoothingEnabled = true; bx.imageSmoothingQuality = 'high'; bx.drawImage(src, 0, 0, w, h);
    return blurC;
  }
  function finish(x, W, H, a) {
    if (a.focus > 0.01) {   // background blur: sharp in the middle (the cut), soft towards the edges
      var c = x.canvas, tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
      var t = tmp.getContext('2d'); t.imageSmoothingEnabled = true; t.drawImage(softBlur(c, W, H, 14), 0, 0, W, H);
      t.globalCompositeOperation = 'destination-in';
      var g = t.createRadialGradient(W / 2, H * 0.46, Math.min(W, H) * 0.3, W / 2, H * 0.46, Math.max(W, H) * 0.72);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + clamp(a.focus, 0, 1) + ')');
      t.fillStyle = g; t.fillRect(0, 0, W, H);
      x.drawImage(tmp, 0, 0);
    }
    if (a.vignette > 0.01) {
      var v = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.38, W / 2, H / 2, Math.hypot(W, H) * 0.56);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + (a.vignette * 0.7).toFixed(3) + ')');
      x.fillStyle = v; x.fillRect(0, 0, W, H);
    }
  }

  /* ---------- Framing (crop) ---------- */
  function defaultFrame() { return { cx: 0.5, cy: 0.5, zoom: 1, tilt: 0, rot: 0, flip: false }; }
  function geom(p, W, H) {
    var f = p.f, odd = f.rot % 2 === 1, ew = odd ? p.h : p.w, eh = odd ? p.w : p.h, th = f.tilt * Math.PI / 180;
    var s0 = Math.max(W / ew, H / eh) * (Math.abs(Math.cos(th)) + Math.abs(Math.sin(th)) * Math.max(W, H) / Math.min(W, H));
    return { s: s0 * f.zoom, ang: th + f.rot * Math.PI / 2, odd: odd };
  }
  function clampFrame(p, W, H) {
    var f = p.f, g = geom(p, W, H);
    if (f.zoom < 1) { f.cx = clamp(f.cx, 0, 1); f.cy = clamp(f.cy, 0, 1); return; }
    var hw = W / 2 / g.s, hh = H / 2 / g.s, ax = g.odd ? hh : hw, ay = g.odd ? hw : hh;
    f.cx = ax * 2 >= p.w ? 0.5 : clamp(f.cx, ax / p.w, 1 - ax / p.w);
    f.cy = ay * 2 >= p.h ? 0.5 : clamp(f.cy, ay / p.h, 1 - ay / p.h);
  }
  function drawFramed(x, p, im, W, H) {
    var f = p.f, g = geom(p, W, H);
    if (f.zoom < 1 || f.tilt) {   // anything the photo doesn't cover gets a soft blurred copy of it
      var bs = Math.max(W / im.naturalWidth, H / im.naturalHeight);
      var tiny = softBlur(im, im.naturalWidth, im.naturalHeight, Math.max(im.naturalWidth, im.naturalHeight) / 48);
      x.save(); x.imageSmoothingEnabled = true; x.drawImage(tiny, (W - im.naturalWidth * bs) / 2, (H - im.naturalHeight * bs) / 2, im.naturalWidth * bs, im.naturalHeight * bs);
      x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 0, W, H); x.restore();
    }
    x.save(); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.translate(W / 2, H / 2); x.rotate(g.ang); if (f.flip) x.scale(-1, 1); x.scale(g.s, g.s);
    x.drawImage(im, -f.cx * p.w, -f.cy * p.h, p.w, p.h);
    x.restore();
  }
  // A photo, cropped and styled, at W×H. opts: { fast, brand }
  function renderPhoto(p, W, H, opts) {
    opts = opts || {};
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d', { willReadFrequently: true }), im = imgs[p.blobId];
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    if (!im) return c;
    drawFramed(x, p, im, W, H);
    var a = lookOf(p);
    grade(x, W, H, a, p.auto ? p._lv : null, opts.fast);
    finish(x, W, H, a);
    var ct = tagText(p, true); if (opts.chip && ct) labelChip(x, W, H, p, ct);
    if (opts.brand) drawBrand(x, W, H);
    return c;
  }

  /* ---------- Brand ---------- */
  function brandText() { return [S.handle, S.shop].filter(Boolean)[0] || ''; }
  function rr(x, X, Y, w, h, r) { r = Math.min(r, w / 2, h / 2); x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  var FONT = '"Arial Black", "Segoe UI Black", system-ui, -apple-system, sans-serif', FONT2 = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  function drawBrand(x, W, H) {
    var txt = brandText(), lim = logo && logo._img && logo._img.naturalWidth ? logo._img : null;
    if (!show('showBrand') || S.wmPos === 'off' || (!txt && !lim)) return;
    var base = Math.min(W, H), fs = Math.round(base * 0.034), pad = Math.round(base * 0.035), lh = lim ? Math.round(fs * 1.9) : 0;
    x.save();
    x.font = '800 ' + fs + 'px ' + FONT2;
    var tw = txt ? x.measureText(txt).width : 0, lw = lim ? lh * lim.naturalWidth / lim.naturalHeight : 0, gap = txt && lim ? fs * 0.5 : 0;
    var bw = tw + lw + gap + (S.wmStyle === 'tag' ? fs * 1.3 : 0), bh = Math.max(lh, fs * 1.9);
    if (S.wmStyle === 'bar') {
      var bhh = bh + pad * 0.8, gr = x.createLinearGradient(0, H - bhh * 1.6, 0, H);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.78)');
      x.fillStyle = gr; x.fillRect(0, H - bhh * 1.6, W, bhh * 1.6);
      var bx = (W - (tw + lw + gap)) / 2, by = H - bhh / 2 - pad * 0.2;
      if (lim) x.drawImage(lim, bx, by - lh / 2, lw, lh);
      x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(txt, bx + lw + gap, by);
      x.fillStyle = S.color; x.fillRect(W / 2 - base * 0.06, H - pad * 0.45, base * 0.12, Math.max(2, base * 0.004));
      x.restore(); return;
    }
    var pos = S.wmPos, X = pos.charAt(1) === 'r' ? W - pad - bw : pos.charAt(1) === 'l' ? pad : (W - bw) / 2, Y = pos.charAt(0) === 't' ? pad : H - pad - bh;
    if (S.wmStyle === 'tag') {
      x.shadowColor = 'rgba(0,0,0,.4)'; x.shadowBlur = fs * 0.6;
      x.fillStyle = 'rgba(10,10,14,0.72)'; rr(x, X, Y, bw, bh, bh / 2); x.fill(); x.shadowBlur = 0;
      x.fillStyle = S.color; rr(x, X + fs * 0.45, Y + bh * 0.3, Math.max(3, fs * 0.16), bh * 0.4, 2); x.fill();
      X += fs * 0.85;
    } else { x.shadowColor = 'rgba(0,0,0,.75)'; x.shadowBlur = fs * 0.5; }
    if (lim) x.drawImage(lim, X, Y + (bh - lh) / 2, lw, lh);
    x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(txt, X + lw + gap, Y + bh / 2 + fs * 0.04);
    x.restore();
  }

  /* ---------- Sets (collages) ---------- */
  function defaultLayout() { return S.format === 'story' ? 'stack' : S.format === 'wide' ? 'row' : 'hero'; }
  function cells(layout, n, W, H) {
    var g = Math.round(Math.min(W, H) * 0.012), out = [], i;
    function grid(cols, rows) {
      for (i = 0; i < n; i++) {
        var r = Math.floor(i / cols), inRow = r === rows - 1 ? n - r * cols : cols, cc = i - r * cols;
        var cw = (W - g * (inRow + 1)) / inRow, ch = (H - g * (rows + 1)) / rows;
        out.push({ x: g + cc * (cw + g), y: g + r * (ch + g), w: cw, h: ch });
      }
    }
    if (layout === 'row') { grid(n, 1); return out; }
    if (layout === 'stack') { for (i = 0; i < n; i++) { var hh = (H - g * (n + 1)) / n; out.push({ x: g, y: g + i * (hh + g), w: W - 2 * g, h: hh }); } return out; }
    if (layout === 'grid') { var cols = n <= 4 ? 2 : 3; grid(Math.min(cols, n), Math.ceil(n / cols)); return out; }
    // hero: the first shot big, the rest share the other side
    var rest = n - 1; if (rest < 1) { grid(1, 1); return out; }
    if (W > H) {
      var hw = (W - 3 * g) * 0.6; out.push({ x: g, y: g, w: hw, h: H - 2 * g });
      var sh = (H - g * (rest + 1)) / rest;
      for (i = 0; i < rest; i++) out.push({ x: 2 * g + hw, y: g + i * (sh + g), w: W - 3 * g - hw, h: sh });
    } else {
      var hh2 = (H - 3 * g) * (rest > 3 ? 0.55 : 0.62); out.push({ x: g, y: g, w: W - 2 * g, h: hh2 });
      var sw = (W - g * (rest + 1)) / rest;
      for (i = 0; i < rest; i++) out.push({ x: g + i * (sw + g), y: 2 * g + hh2, w: sw, h: H - 3 * g - hh2 });
    }
    return out;
  }
  function setPhotos(s) {
    var ps = s.ids.map(photoById).filter(Boolean);
    if (s.layout === 'split') ps = ps.filter(function (p) { return p.stage !== 'after'; }).concat(ps.filter(function (p) { return p.stage === 'after'; }));
    return ps;
  }
  function splitCells(s, W, H) {   // BEFORE column | AFTER column (top / bottom when the size is wide)
    var ps = setPhotos(s), nb = ps.filter(function (p) { return p.stage !== 'after'; }).length, na = ps.length - nb, g = Math.round(Math.min(W, H) * 0.012), out = [];
    if (!na) { na = Math.floor(ps.length / 2); nb = ps.length - na; }
    if (!nb) { nb = Math.floor(ps.length / 2); na = ps.length - nb; }
    var cols = W < H * 1.4;
    [nb, na].forEach(function (n, side) {
      for (var i = 0; i < n; i++) {
        if (cols) { var cw = (W - 3 * g) / 2, ch = (H - g * (n + 1)) / n; out.push({ x: g + side * (cw + g), y: g + i * (ch + g), w: cw, h: ch }); }
        else { var rh = (H - 3 * g) / 2, rw = (W - g * (n + 1)) / n; out.push({ x: g + i * (rw + g), y: g + side * (rh + g), w: rw, h: rh }); }
      }
    });
    return out;
  }
  function renderSet(s, W, H, opts) {
    opts = opts || {};
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'), ps = setPhotos(s), base = Math.min(W, H);
    x.fillStyle = '#0a0a0d'; x.fillRect(0, 0, W, H);
    var cs = s.layout === 'split' ? splitCells(s, W, H) : cells(s.layout, ps.length, W, H);
    cs.forEach(function (r, i) {
      var p = ps[i], w = Math.round(r.w), h = Math.round(r.h);
      if (!p || w < 4 || h < 4) return;
      x.drawImage(renderPhoto(p, w, h, { fast: opts.fast }), Math.round(r.x), Math.round(r.y));
      // BEFORE / AFTER always shows (unless turned off in Your brand); angles only when the set says so
      var lab = tagText(p, s.labels !== false);
      if (lab) {
        var fs = Math.round(base * (cs.length > 3 ? 0.026 : 0.032)), pd = fs * 0.55;
        tag(x, r.x + pd, r.y + pd + (s.title && r.y < base * 0.12 ? base * 0.1 : 0), fs, p, lab);
      }
    });
    if (s.title && show('showTitle')) {
      var ts = Math.round(base * 0.04);
      x.save(); x.font = '900 ' + ts + 'px ' + FONT;
      var tw2 = Math.min(W * 0.9, x.measureText(s.title.toUpperCase()).width + ts * 1.4), tx = (W - tw2) / 2, ty = Math.round(base * 0.035);
      x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = ts * 0.6;
      x.fillStyle = 'rgba(8,8,12,0.8)'; rr(x, tx, ty, tw2, ts * 1.8, ts * 0.9); x.fill(); x.shadowBlur = 0;
      x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(s.title.toUpperCase(), W / 2, ty + ts * 0.95, W * 0.86);
      x.restore();
    }
    if (opts.brand) drawBrand(x, W, H);
    return c;
  }

  /* ---------- Cards (intro / outro) ---------- */
  function renderCard(kind, W, H) {
    var c = document.createElement('canvas'); c.width = W; c.height = H;
    var x = c.getContext('2d'), base = Math.min(W, H), col = S.color;
    var g = x.createLinearGradient(0, 0, W * 0.3, H); g.addColorStop(0, '#0b0b10'); g.addColorStop(1, '#17171f'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    var r = x.createRadialGradient(W / 2, H * 0.42, 0, W / 2, H * 0.42, Math.max(W, H) * 0.6); r.addColorStop(0, hexA(col, 0.32)); r.addColorStop(1, hexA(col, 0));
    x.fillStyle = r; x.fillRect(0, 0, W, H);
    // barber-pole stripes along the bottom
    x.save(); x.beginPath(); x.rect(0, H - base * 0.03, W, base * 0.03); x.clip();
    for (var sx = -H; sx < W + H; sx += base * 0.06) { x.fillStyle = (Math.round(sx / (base * 0.06)) % 2) ? '#ffffff' : col; x.beginPath(); x.moveTo(sx, H); x.lineTo(sx + base * 0.03, H); x.lineTo(sx + base * 0.06, H - base * 0.03); x.lineTo(sx + base * 0.03, H - base * 0.03); x.fill(); }
    x.restore();
    var lim = logo && logo._img && logo._img.naturalWidth ? logo._img : null, y = H * 0.4;
    if (lim) { var lh = base * 0.2, lw = lh * lim.naturalWidth / lim.naturalHeight; x.drawImage(lim, (W - lw) / 2, H * 0.36 - lh - base * 0.03, lw, lh); y = H * 0.44; }
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
    var big = kind === 'intro' ? (S.introTitle || S.shop || S.handle || 'Fresh cuts') : (S.outroTitle || 'Book now'), small1 = kind === 'intro' ? (S.introSub || (S.shop && S.handle ? S.handle : 'Fresh cuts · clean lines')) : (S.outroSub || S.book || 'Link in bio'), small2 = kind === 'intro' ? '' : (S.handle || S.shop || '');
    fit(x, big.toUpperCase(), '900 {s}px ' + FONT, base * 0.1, W * 0.86); x.fillText(big.toUpperCase(), W / 2, y);
    x.fillStyle = col; x.fillRect(W / 2 - base * 0.08, y + base * 0.075, base * 0.16, Math.max(3, base * 0.008));
    x.fillStyle = 'rgba(255,255,255,0.88)'; fit(x, small1, '700 {s}px ' + FONT2, base * 0.045, W * 0.86); x.fillText(small1, W / 2, y + base * 0.15);
    if (small2) { x.fillStyle = 'rgba(255,255,255,0.7)'; fit(x, small2, '600 {s}px ' + FONT2, base * 0.038, W * 0.86); x.fillText(small2, W / 2, y + base * 0.225); }
    return c;
  }
  function fit(x, t, css, size, max) { var s = size; do { x.font = css.replace('{s}', Math.round(s)); s *= 0.92; } while (x.measureText(t).width > max && s > 8); }
  function hexA(h, a) { var n = parseInt(String(h).slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }

  /* ---------- Music beats ---------- */
  // Finds the song's tempo and where its beats fall (energy onsets + a comb search over 70–180 BPM),
  // so cuts land on the beat and the picture can pulse with the music.
  function findBeats(buf) {
    var sr = buf.sampleRate, n = Math.min(buf.length, Math.floor(sr * 90)), hop = 512, ch = buf.numberOfChannels;
    var a = buf.getChannelData(0), b2 = ch > 1 ? buf.getChannelData(1) : a, frames = Math.floor(n / hop), env = new Float32Array(frames), lp = 0, k = Math.exp(-2 * Math.PI * 160 / sr);
    for (var f = 0; f < frames; f++) {
      var e = 0, el = 0;
      for (var i = f * hop, end = i + hop; i < end; i++) { var v = (a[i] + b2[i]) * 0.5; lp = lp * k + v * (1 - k); e += v * v; el += lp * lp; }
      env[f] = Math.log(1 + 1000 * (e / hop)) + 1.5 * Math.log(1 + 1000 * (el / hop));   // kick drum counts extra
    }
    var on = new Float32Array(frames);
    for (f = 1; f < frames; f++) on[f] = Math.max(0, env[f] - env[f - 1]);
    var fps = sr / hop, best = { score: -1, bpm: 120, phase: 0 };
    for (var bpm = 70; bpm <= 180; bpm += 0.5) {
      var P = fps * 60 / bpm, w = Math.exp(-Math.pow(Math.log2(bpm / 115), 2) / 0.6);   // gently prefer common tempos
      for (var ph = 0; ph < P; ph += 1) {
        var sc = 0, cnt = 0;
        for (var t = ph; t < frames; t += P) { sc += on[Math.round(t)] || 0; cnt++; }
        sc = sc / Math.max(1, cnt) * w;
        if (sc > best.score) best = { score: sc, bpm: bpm, phase: ph };
      }
    }
    // the song's first real beat (skips a quiet intro), so the video starts right on it
    var P2 = fps * 60 / best.bpm, grid = [], f2;
    for (f2 = best.phase; f2 < frames; f2 += P2) grid.push(Math.max(on[Math.round(f2) - 1] || 0, on[Math.round(f2)] || 0, on[Math.round(f2) + 1] || 0));
    var mean = grid.reduce(function (q, v) { return q + v; }, 0) / Math.max(1, grid.length), k2 = 0;
    while (k2 < grid.length - 1 && grid[k2] < mean * 0.4) k2++;
    return { bpm: best.bpm, first: (best.phase + k2 * P2) / fps };
  }
  function decodeMusic() {
    if (!music || !blobs[music.blobId]) return Promise.resolve(null);
    if (music._buf) return Promise.resolve(music._buf);
    var AC = window.AudioContext || window.webkitAudioContext; if (!AC) return Promise.resolve(null);
    var dec = new AC(), m = music;
    return blobs[m.blobId].arrayBuffer().then(function (buf) {
      return new Promise(function (res) { var pr = dec.decodeAudioData(buf, res, function () { res(null); }); if (pr && pr.then) pr.then(res, function () { res(null); }); });
    }).then(function (b) { try { dec.close(); } catch (e) { /* closed */ } if (b && m === music) { m._buf = b; m.dur = b.duration; } return b; }).catch(function () { return null; });
  }
  function analyseMusic() {
    var m = music; if (!m) return;
    decodeMusic().then(function (b) {
      if (!b || m !== music) return;
      if (!m.bpm) { var r = findBeats(b); m.bpm = r.bpm; m.first = r.first; saveProject(); }
      renderMusic(); renderFacts(); if (!pv.playing) drawPreview();
    });
  }
  function songStart() { return music ? (S.musicStart != null ? S.musicStart : (music.first || 0)) : 0; }
  // Beat times in the video: the song starts at songStart(), so the video's beats are offset by its phase.
  function beatInfo() {
    if (!music || !music.bpm) return null;
    var len = 60 / music.bpm, phase = ((music.first || 0) - songStart()) % len; if (phase < 0) phase += len;
    return { len: len, phase: phase };
  }
  function synced() { return !!(S.beatSync && beatInfo()); }

  /* ---------- Slideshow timeline ---------- */
  function segments() {
    var segs = [];
    if (S.intro) segs.push({ key: 'intro', dur: INTRO, card: 'intro' });
    slides.forEach(function (sl) {
      var dur = sl.dur || S.dur;
      if (sl.kind === 'photo') { var p = photoById(sl.ref); if (p) segs.push({ key: 'p:' + p.id, dur: dur, photo: p, trans: sl.trans, sl: sl }); }
      else {
        var s = setById(sl.ref); if (!s || !s.ids.length) return;
        if (s.show === 'each') setPhotos(s).forEach(function (p, i) { segs.push({ key: 's:' + s.id + ':' + p.id, dur: Math.max(1.2, dur * 0.75), photo: p, angle: s.labels !== false, trans: i ? 'slide' : sl.trans, sl: sl, first: i === 0 }); });
        else segs.push({ key: 's:' + s.id, dur: dur + 0.8, set: s, trans: sl.trans, sl: sl, first: true });
      }
    });
    if (S.outro) segs.push({ key: 'outro', dur: OUTRO, card: 'outro' });
    var t = 0, bi = synced() ? beatInfo() : null;
    if (bi) {   // every cut lands on the beat: each part ends on the nearest 2-beat step (4 for fast songs)
      var step = bi.len * (bi.len * 2 < 0.8 ? 4 : 2);
      segs.forEach(function (g) {
        var want = t + g.dur, n = Math.max(1, Math.round((want - bi.phase) / step)), end = bi.phase + n * step;
        while (end - t < Math.max(1, g.dur * 0.55)) end += step;
        g.dur = end - t; t = end;
      });
      t = 0;
    }
    segs.forEach(function (g, i) { g.start = t; t += g.dur; g.i = i; });
    return { segs: segs, total: t };
  }
  var stills = {};   // key|W|H|version → canvas
  function stillFor(g, W, H) {
    var k = g.key + '|' + W + 'x' + H + '|' + (g.photo ? verOf(g.photo) : g.set ? verOfSet(g.set) : brandVer());
    if (stills[k]) return stills[k];
    var c = g.card ? renderCard(g.card, W, H) : g.set ? renderSet(g.set, W, H) : renderPhoto(g.photo, W, H);
    var lab = g.photo ? tagText(g.photo, g.angle === true) : '';
    if (lab) labelChip(c.getContext('2d'), W, H, g.photo, lab);
    stills[k] = c; return c;
  }
  // BEFORE is a dark tag, AFTER is a tag in your brand colour — easy to tell apart at a glance.
  function tag(x, lx, ly, fs, p, lab) {
    lab = lab.toUpperCase();
    x.save(); x.font = '900 ' + fs + 'px ' + FONT;
    var tw = x.measureText(lab).width + fs * 1.3, h = fs * 1.8, after = p && p.stage === 'after';
    x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = fs * 0.5;
    x.fillStyle = after ? S.color : 'rgba(8,8,12,0.78)'; rr(x, lx, ly, tw, h, fs * 0.45); x.fill(); x.shadowBlur = 0;
    if (!after) { x.fillStyle = S.color; x.fillRect(lx, ly, Math.max(3, fs * 0.2), h); }
    x.fillStyle = '#fff'; x.textBaseline = 'middle'; x.fillText(lab, lx + fs * 0.65, ly + fs * 0.93);
    x.restore();
  }
  function labelChip(x, W, H, p, lab) { var base = Math.min(W, H); tag(x, base * 0.04, base * 0.04, Math.round(base * 0.045), p, lab); }
  function verOf(p) { return JSON.stringify([p.f, p.look, p.adj, p.auto, p.stage, p.label, S.plain, S.showStage, S.showAngle, S.color]); }
  function verOfSet(s) { return JSON.stringify([s.layout, s.labels, s.title, S.showTitle, s.ids.map(function (id) { var p = photoById(id); return p ? verOf(p) + p.label : ''; }), S.color]); }
  function brandVer() { return JSON.stringify([S.shop, S.handle, S.book, S.color, logo && logo.blobId, S.introTitle, S.introSub, S.outroTitle, S.outroSub]); }
  function trimStills() { var ks = Object.keys(stills); if (ks.length > 60) ks.slice(0, ks.length - 40).forEach(function (k) { delete stills[k]; }); }

  function ease(p) { return p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2; }
  function transFor(g) {
    var t = g.trans || S.trans;
    if (t === 'mix') t = MIX[g.i % MIX.length];
    return t;
  }
  function drawSeg(x, g, W, H, u, alpha, extraScale, dx) {
    var c = stillFor(g, W, H), k = S.kenBurns && !g.card ? 1 + 0.06 * clamp(u / g.dur, 0, 1) : 1;
    if (g.card) k = 1 + 0.03 * clamp(u / g.dur, 0, 1);
    k *= extraScale || 1;
    x.save(); x.globalAlpha = alpha == null ? 1 : alpha;
    var w = W * k, h = H * k, ox = (g.i % 2 ? -1 : 1) * (k - 1) * W * 0.15;
    x.drawImage(c, (W - w) / 2 + ox + (dx || 0), (H - h) / 2, w, h);
    x.restore();
  }
  function renderFrame(x, W, H, t, tl, opts) {
    tl = tl || segments();
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    if (!tl.segs.length) return;
    var i = 0; while (i < tl.segs.length - 1 && t >= tl.segs[i + 1].start) i++;
    var g = tl.segs[i], u = t - g.start, prev = tl.segs[i - 1], ty = transFor(g);
    if (!prev || u >= TR || ty === 'cut') { drawSeg(x, g, W, H, u); }
    else {
      var p = ease(clamp(u / TR, 0, 1)), pu = prev.dur + u;
      if (ty === 'fade') { drawSeg(x, prev, W, H, pu); drawSeg(x, g, W, H, u, p); }
      else if (ty === 'slide') { drawSeg(x, prev, W, H, pu, 1, 1, -p * W); drawSeg(x, g, W, H, u, 1, 1, (1 - p) * W); }
      else if (ty === 'zoom') { drawSeg(x, prev, W, H, pu, 1 - p, 1 + 0.25 * p); drawSeg(x, g, W, H, u, p, 0.88 + 0.12 * p); }
      else if (ty === 'wipe') { drawSeg(x, prev, W, H, pu); x.save(); x.beginPath(); x.rect(0, 0, W * p, H); x.clip(); drawSeg(x, g, W, H, u); x.restore(); }
      else if (ty === 'flash') {
        if (p < 0.5) drawSeg(x, prev, W, H, pu, 1, 1 + 0.04 * p); else drawSeg(x, g, W, H, u);
        x.fillStyle = 'rgba(255,255,255,' + (1 - Math.abs(p - 0.5) * 2).toFixed(3) + ')'; x.fillRect(0, 0, W, H);
      } else if (ty === 'blur') {
        drawSeg(x, prev, W, H, pu);
        var bc = softBlur(x.canvas, W, H, 4 + 30 * Math.sin(p * Math.PI)); x.save(); x.globalAlpha = Math.sin(p * Math.PI); x.drawImage(bc, 0, 0, W, H); x.restore();
        drawSeg(x, g, W, H, u, Math.max(0, (p - 0.4) / 0.6));
      } else {   // blade: a razor line sweeps diagonally and reveals the new shot
        drawSeg(x, prev, W, H, pu);
        var span = W + H * 0.5, edge = -H * 0.5 + p * (span + H * 0.5);
        x.save(); x.beginPath(); x.moveTo(-10, -10); x.lineTo(edge + H * 0.5, -10); x.lineTo(edge, H + 10); x.lineTo(-10, H + 10); x.closePath(); x.clip();
        drawSeg(x, g, W, H, u); x.restore();
        if (p > 0 && p < 1) {
          x.save(); var lw = Math.max(3, Math.min(W, H) * 0.008);
          x.strokeStyle = '#ffffff'; x.lineWidth = lw; x.shadowColor = S.color; x.shadowBlur = lw * 6;
          x.beginPath(); x.moveTo(edge + H * 0.5, -10); x.lineTo(edge, H + 10); x.stroke(); x.stroke(); x.restore();
        }
      }
    }
    applyFx(x, W, H, t, g, u, prev);
    if (!g.card) drawBrand(x, W, H);   // your name stays put on every photo (not on the intro / outro cards)
    capBox = null;
    if (show('showText')) {
      // the text of a part comes in once its picture is on screen, and the last one fades out during the change
      if (prev && prev.sl && prev.sl.text && u < TR * 0.5 && !(prev.sl === g.sl)) drawCaption(x, W, H, prev.sl, { a: 1 - u / (TR * 0.5), s: 1, dy: 0, chars: 1 });
      if (g.sl && g.sl.text) {
        var from = g.first === false || (prev && prev.sl === g.sl) ? -1 : TR * 0.6, still = opts && opts.still;
        var k = still || from < 0 ? { a: 1, s: 1, dy: 0, chars: 1 } : capAnim(u - from, g.dur - from);
        if (u >= from || still) capBox = { sl: g.sl, b: drawCaption(x, W, H, g.sl, k) };
      }
    }
  }
  var capBox = null;
  var FX = [['pop', 'Pop — pulses with the beat'], ['hype', 'Hype — beat pulse, flash & shake'], ['cine', 'Cinematic — bars, film grain, light'], ['glow', 'Glow — soft bloom & light'], ['none', 'None']];
  var fxC = null, grain = null;
  function grainTile() {
    if (grain) return grain;
    grain = document.createElement('canvas'); grain.width = grain.height = 192;
    var g = grain.getContext('2d'), id = g.createImageData(192, 192), d = id.data, seed = 7;
    for (var i = 0; i < d.length; i += 4) { seed = (seed * 16807) % 2147483647; var v = 128 + ((seed % 120) - 60); d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(id, 0, 0); return grain;
  }
  // how strongly the picture "hits" at time t (1 right on a beat, fading over ~0.18 s)
  function hit(t, g) {
    var bi = beatInfo();
    if (bi) { var since = ((t - bi.phase) % bi.len + bi.len) % bi.len, n = Math.round((t - bi.phase - since) / bi.len); return { k: Math.exp(-since / 0.16), down: ((n % 4) + 4) % 4 === 0, since: since }; }
    var u = t - g.start; return { k: Math.exp(-u / 0.2), down: true, since: u };   // no music: a hit on every cut
  }
  function applyFx(x, W, H, t, g, u, prev) {
    var fx = S.fx || 'none'; if (fx === 'none') return;
    var base = Math.min(W, H), cut = prev && u < 0.25 ? 1 - u / 0.25 : 0;
    if (fx === 'pop' || fx === 'hype') {
      var h = hit(t, g), amp = fx === 'hype' ? 0.045 : 0.022, sc = 1 + amp * h.k * (h.down ? 1.4 : 1);
      var sx = 0, sy = 0;
      if (fx === 'hype' && cut > 0) { sx = Math.sin(t * 97) * base * 0.018 * cut; sy = Math.cos(t * 83) * base * 0.014 * cut; }
      if (sc > 1.001 || sx || sy) {
        fxC = fxC || document.createElement('canvas'); if (fxC.width !== W || fxC.height !== H) { fxC.width = W; fxC.height = H; }
        var c2 = fxC.getContext('2d'); c2.drawImage(x.canvas, 0, 0);
        x.save(); x.imageSmoothingEnabled = true; x.drawImage(fxC, (W - W * sc) / 2 + sx, (H - H * sc) / 2 + sy, W * sc, H * sc); x.restore();
      }
      if (fx === 'hype' && h.down && h.since < 0.12 && !g.card) { x.fillStyle = 'rgba(255,255,255,' + (0.22 * (1 - h.since / 0.12)).toFixed(3) + ')'; x.fillRect(0, 0, W, H); }
      if (fx === 'hype') {   // punchier contrast edge
        var v = x.createRadialGradient(W / 2, H / 2, base * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + (0.25 + 0.15 * h.k).toFixed(3) + ')');
        x.fillStyle = v; x.fillRect(0, 0, W, H);
      }
    }
    if (fx === 'glow') {
      x.save(); x.globalCompositeOperation = 'screen'; x.globalAlpha = 0.32 + 0.12 * hit(t, g).k; x.imageSmoothingEnabled = true;
      x.drawImage(softBlur(x.canvas, W, H, 10), 0, 0, W, H); x.restore();
    }
    if (fx === 'cine' || fx === 'glow') {   // a warm light leak drifting across
      var lx = W * (0.5 + 0.45 * Math.sin(t * 0.35)), ly = H * (0.2 + 0.15 * Math.cos(t * 0.27)), r = Math.max(W, H) * 0.55;
      var lg = x.createRadialGradient(lx, ly, 0, lx, ly, r); lg.addColorStop(0, 'rgba(255,150,70,' + (fx === 'cine' ? 0.22 : 0.16) + ')'); lg.addColorStop(0.5, 'rgba(255,60,90,0.07)'); lg.addColorStop(1, 'rgba(0,0,0,0)');
      x.save(); x.globalCompositeOperation = 'screen'; x.fillStyle = lg; x.fillRect(0, 0, W, H); x.restore();
    }
    if (fx === 'cine') {
      var gt = grainTile(), ox = Math.floor((t * 977) % 192), oy = Math.floor((t * 613) % 192);
      x.save(); x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.16;
      var pat = x.createPattern(gt, 'repeat'), sc2 = Math.max(1, base / 700); x.translate(-ox * sc2, -oy * sc2); x.scale(sc2, sc2); x.fillStyle = pat; x.fillRect(0, 0, (W / sc2) + 400, (H / sc2) + 400); x.restore();
      var bar = Math.round(H * (W >= H ? 0.1 : 0.06)); x.fillStyle = '#000'; x.fillRect(0, 0, W, bar); x.fillRect(0, H - bar, W, bar);
    }
  }
  var CAP_STYLES = [['box', 'White on dark box'], ['bold', 'Bold with outline'], ['brand', 'On your brand colour'], ['neon', 'Neon glow'], ['clean', 'Clean with shadow']];
  var CAP_ANIMS = [['pop', 'Pop'], ['slide', 'Slide up'], ['type', 'Type out'], ['fade', 'Fade'], ['none', 'None']];
  function capAnim(t, len) {
    var p = clamp(t / 0.35, 0, 1), k = { a: 1, s: 1, dy: 0, chars: 1 }, a = S.capAnim;
    if (a === 'fade') k.a = p;
    else if (a === 'pop') { var e = 1 - Math.pow(1 - p, 3); k.s = 0.6 + 0.4 * e + (p > 0.6 && p < 1 ? 0.07 * Math.sin((p - 0.6) / 0.4 * Math.PI) : 0); k.a = Math.min(1, p * 2); }
    else if (a === 'slide') { k.dy = (1 - (1 - Math.pow(1 - p, 3))) * 0.05; k.a = p; }
    else if (a === 'type') k.chars = clamp(t / Math.max(0.5, Math.min(1.4, len * 0.45)), 0, 1);
    return k;
  }
  function capPos(sl) {
    if (sl.tx != null) return { x: sl.tx, y: sl.ty };
    return { x: 0.5, y: S.capPos === 'top' ? 0.17 : S.capPos === 'middle' ? 0.5 : 0.8 };
  }
  function wrapText(x, text, maxW) {
    var out = [];
    String(text || '').split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      words.forEach(function (w) { var t = line ? line + ' ' + w : w; if (line && x.measureText(t).width > maxW) { out.push(line); line = w; } else line = t; });
      if (line || !words.length) out.push(line);
    });
    return out;
  }
  // Text on screen for one part of the slideshow. Returns its box (for dragging on the preview).
  function drawCaption(x, W, H, sl, k) {
    var base = Math.min(W, H), st = S.capStyle, fs = Math.round(base * 0.058 * (S.capSize || 1)), pos = capPos(sl);
    var bold = st === 'bold' || st === 'neon';
    x.save(); x.globalAlpha = k.a;
    x.font = (bold ? '900 ' + fs + 'px ' + FONT : '800 ' + fs + 'px ' + FONT2);
    var lines = wrapText(x, sl.text, W * 0.84), lh = fs * 1.2, widths = lines.map(function (l) { return x.measureText(l).width; });
    var bw = Math.max.apply(null, widths.concat([fs])), bh = lines.length * lh, padX = fs * 0.55, padY = fs * 0.35;
    var cx = pos.x * W, cy = (pos.y + k.dy) * H;
    // keep it on the screen
    cx = clamp(cx, bw / 2 + padX + 4, W - bw / 2 - padX - 4); cy = clamp(cy, bh / 2 + padY + 4, H - bh / 2 - padY - 4);
    x.translate(cx, cy); x.scale(k.s, k.s);
    if (st === 'box' || st === 'brand') {
      x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = fs * 0.5;
      x.fillStyle = st === 'brand' ? S.color : 'rgba(8,8,12,0.82)'; rr(x, -bw / 2 - padX, -bh / 2 - padY, bw + 2 * padX, bh + 2 * padY, fs * 0.35); x.fill(); x.shadowBlur = 0;
    }
    var total = lines.join('\n').length, showN = Math.round(total * k.chars), used = 0;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    lines.forEach(function (l, i) {
      var t = l; if (used + l.length > showN) t = l.slice(0, Math.max(0, showN - used)); used += l.length + 1;
      if (!t) return;
      var ly = -bh / 2 + lh * (i + 0.5);
      if (st === 'bold') { x.lineWidth = Math.max(3, fs * 0.18); x.strokeStyle = '#000'; x.strokeText(t, 0, ly); x.fillStyle = '#fff'; x.fillText(t, 0, ly); }
      else if (st === 'neon') { x.shadowColor = S.color; x.shadowBlur = fs * 0.7; x.fillStyle = S.color; x.fillText(t, 0, ly); x.fillText(t, 0, ly); x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,.9)'; x.fillText(t, 0, ly); }
      else if (st === 'clean') { x.shadowColor = 'rgba(0,0,0,.75)'; x.shadowBlur = fs * 0.35; x.shadowOffsetY = fs * 0.06; x.fillStyle = '#fff'; x.fillText(t, 0, ly); x.shadowBlur = 0; x.shadowOffsetY = 0; }
      else { x.fillStyle = '#fff'; x.fillText(t, 0, ly); }
    });
    x.restore();
    return { x: cx - (bw / 2 + padX) * k.s, y: cy - (bh / 2 + padY) * k.s, w: (bw + 2 * padX) * k.s, h: (bh + 2 * padY) * k.s };
  }

  /* ---------- Preview player ---------- */
  var pv = { t: 0, playing: false, raf: 0, t0: 0, music: null };
  function previewSize() {
    var d = dims(), s = Math.min(360 / d.W, 520 / d.H);
    return { w: Math.round(d.W * s), h: Math.round(d.H * s) };
  }
  var fullBox = null;   // set while the slideshow is full screen
  function sizePreview() {
    var c = $('preview'), ps = previewSize(), dpr = Math.min(2, window.devicePixelRatio || 1), d = dims();
    if (fullBox) { var k = Math.min(fullBox.w / d.W, fullBox.h / d.H); ps = { w: Math.floor(d.W * k), h: Math.floor(d.H * k) }; }
    c.width = Math.min(d.W, Math.round(ps.w * dpr)); c.height = Math.round(c.width * d.H / d.W);
    c.style.width = ps.w + 'px'; c.style.height = fullBox ? ps.h + 'px' : ''; c.style.aspectRatio = ps.w + ' / ' + ps.h;
  }
  function openFull() {
    if (!window.YB.full) return;
    YB.full.open({ stage: $('preview'), bar: document.querySelector('#showCard .cx-transport'),
      fit: function (w, h) { fullBox = { w: w, h: h }; sizePreview(); if (!pv.playing) drawPreview(); },
      onClose: function () { fullBox = null; sizePreview(); if (!pv.playing) drawPreview(); } });
    if (!pv.playing) play();
  }
  function drawPreview() {
    var c = $('preview'); if (!c) return;
    var x = c.getContext('2d'), tl = segments();
    renderFrame(x, c.width, c.height, pv.t, tl, { still: !pv.playing });
    if (!pv.playing && capBox && capDrag) { var b = capBox.b; x.save(); x.setLineDash([6, 4]); x.lineWidth = 2; x.strokeStyle = '#7cc4ff'; x.strokeRect(b.x, b.y, b.w, b.h); x.restore(); }
    $('scrub').value = tl.total ? Math.round(pv.t / tl.total * 1000) : 0;
    $('timeLabel').textContent = mmss(pv.t) + ' / ' + mmss(tl.total);
    trimStills();
  }
  var capDrag = null;
  function wirePreviewPointer() {
    var c = $('preview');
    function pt(e) { var r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; }
    c.addEventListener('pointerdown', function (e) {
      if (pv.playing) stop();
      drawPreview();
      var q = pt(e), b = capBox && capBox.b;
      if (!b || q.x < b.x || q.x > b.x + b.w || q.y < b.y || q.y > b.y + b.h) return;
      var pos = capPos(capBox.sl);
      capDrag = { sl: capBox.sl, dx: q.x - pos.x * c.width, dy: q.y - pos.y * c.height };
      c.setPointerCapture(e.pointerId); e.preventDefault(); drawPreview();
    });
    c.addEventListener('pointermove', function (e) {
      if (!capDrag) return; var q = pt(e);
      capDrag.sl.tx = clamp((q.x - capDrag.dx) / c.width, 0, 1); capDrag.sl.ty = clamp((q.y - capDrag.dy) / c.height, 0, 1); drawPreview();
    });
    var end = function () { if (!capDrag) return; capDrag = null; saveProject(); drawPreview(); renderSlides(); };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  }
  function play() {
    var tl = segments(); if (!tl.segs.length || rec) return;
    if (pv.t >= tl.total - 0.05) pv.t = 0;
    pv.playing = true; setPlayBtn(true); pv.t0 = performance.now() - pv.t * 1000;
    if (music) { pv.music = pv.music || new Audio(); if (pv.music.dataset.id !== music.blobId) { pv.music.src = URL.createObjectURL(blobs[music.blobId]); pv.music.dataset.id = music.blobId; } pv.music.loop = true; pv.music.volume = clamp((S.musicVol == null ? 85 : S.musicVol) / 100, 0, 1); var mst = songStart() + pv.t; var setT = function () { try { pv.music.currentTime = pv.music.duration ? mst % pv.music.duration : mst; } catch (e) { /* not ready */ } }; if (pv.music.readyState >= 1) setT(); else pv.music.addEventListener('loadedmetadata', setT, { once: true }); pv.music.play().catch(function () {}); }
    var loop = function () {
      if (!pv.playing) return;
      pv.t = (performance.now() - pv.t0) / 1000;
      if (pv.t >= tl.total) { pv.t = tl.total; drawPreview(); stop(); return; }
      drawPreview(); pv.raf = requestAnimationFrame(loop);
    };
    pv.raf = requestAnimationFrame(loop);
  }
  function stop() { pv.playing = false; cancelAnimationFrame(pv.raf); setPlayBtn(false); if (pv.music) pv.music.pause(); }
  function setPlayBtn(on) { var b = $('playBtn'); b.classList.toggle('is-playing', on); b.classList.toggle('is-active', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? 'Pause slideshow' : 'Play slideshow'); }

  /* ---------- Import ---------- */
  function addFiles(files, into) {   // into: { setId, stage } puts the new photos straight into a client as before / after
    into = into || {};
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif|gif|bmp)$/i.test(f.name); });
    if (!list.length) { YB.toast('Choose photos'); return; }
    var bad = [], added = 0; $('importNote').hidden = true;
    YB.toast(list.length === 1 ? 'Adding the photo…' : 'Adding ' + list.length + ' photos…');
    var chain = Promise.resolve();
    list.forEach(function (f) {
      chain = chain.then(function () {
        return normalise(f).then(function (n) {
          var id = YB.uid(), blobId = 'p' + id;
          blobs[blobId] = n.blob;
          var p = { id: id, blobId: blobId, name: f.name, w: n.w, h: n.h, f: defaultFrame(), look: 'natural', adj: {}, auto: false, label: '', stage: into.stage || '' };   // photos come in untouched: looks and auto-fix only when you choose them
          var cs = into.setId && setById(into.setId);
          photos.push(p);
          if (cs) { cs.ids.push(id); cs._thumb = null; if (p.stage) cs.layout = 'split'; ensureSetSlide(cs); }
          else slides.push({ id: YB.uid(), kind: 'photo', ref: id });
          added++;
          return putBlob(blobId, n.blob).then(function () { return ensureImg(p); });
        }, function () { bad.push(f.name); });
      });
    });
    chain.then(function () {
      if (bad.length) { $('importNote').hidden = false; $('importNote').textContent = 'This browser couldn\'t open ' + bad.join(', ') + '. iPhone "HEIC" photos open in Safari; elsewhere, save them as JPG (or set the camera to "Most Compatible") and add them again.'; }
      if (added && !photoById(cur)) cur = photos[photos.length - added].id;
      saveProject(); renderAll(); thumbsSoon();
      if (added) YB.toast('Added ' + added + ' ' + (into.stage ? into.stage + ' ' : '') + 'photo' + (added === 1 ? '' : 's') + (into.setId && setById(into.setId) ? ' to ' + clientName(setById(into.setId)) : ''));
    });
  }

  /* ---------- Thumbnails ---------- */
  var thumbQueue = [], thumbBusy = false;
  function thumbW() { var d = dims(); return d.W >= d.H ? 240 : Math.round(240 * d.W / d.H); }
  function thumbH() { var d = dims(); return Math.round(thumbW() * d.H / d.W); }
  function queueThumb(p) { if (thumbQueue.indexOf(p) === -1) thumbQueue.push(p); runThumbs(); }
  function thumbsSoon() { photos.forEach(queueThumb); sets.forEach(function (s) { s._thumb = null; }); }
  function runThumbs() {
    if (thumbBusy || !thumbQueue.length) return;
    thumbBusy = true;
    var p = thumbQueue.shift();
    ensureImg(p).then(function () {
      p._thumb = renderPhoto(p, thumbW(), thumbH()).toDataURL('image/jpeg', 0.8);
      var im = document.querySelector('[data-thumb="' + p.id + '"]'); if (im) im.src = p._thumb;
      var sm = document.querySelectorAll('[data-sthumb="' + p.id + '"]'); sm.forEach(function (e) { e.src = p._thumb; });
    }).catch(function () {}).then(function () {
      thumbBusy = false;
      if (thumbQueue.length) setTimeout(runThumbs, 0); else { renderSets(); renderSlides(); }
    });
  }

  /* ---------- Page rendering ---------- */
  function renderFormats() {
    $('formatSeg').innerHTML = Object.keys(FORMATS).map(function (k) {
      var f = FORMATS[k];
      return '<button type="button" role="radio" data-format="' + k + '" class="fm-format' + (k === S.format ? ' on' : '') + '" aria-checked="' + (k === S.format) + '"><span class="fm-format-ico fm-ar-' + f.ar + '" aria-hidden="true"></span><b>' + f.name + '</b><span class="muted small">' + f.sub + '</span></button>';
    }).join('');
  }
  function renderGrid() {
    $('photoCount').textContent = photos.length ? '· ' + photos.length : '';
    $('photoGrid').innerHTML = photos.map(function (p, i) {
      var s = setOf(p.id), pk = picked.indexOf(p.id), pst = pk !== -1 ? p.stage : '';
      return '<li class="sc-ph' + (p.id === cur ? ' on' : '') + (pk !== -1 ? ' picked' : '') + '" data-id="' + p.id + '">' +
        '<button type="button" class="sc-thumb" data-open aria-label="Edit photo ' + (i + 1) + '" style="aspect-ratio:' + thumbW() + '/' + thumbH() + '">' +
        (p._thumb ? '<img data-thumb="' + p.id + '" src="' + p._thumb + '" alt="">' : '<img data-thumb="' + p.id + '" alt="">') +
        '<span class="sc-n">' + (i + 1) + '</span>' + (pk !== -1 ? '<span class="sc-pick ' + pst + '">' + (pst ? pst.charAt(0).toUpperCase() : pk + 1) + '</span>' : '') +
        (p.stage ? '<span class="sc-stage-badge ' + p.stage + '">' + stageName(p).toUpperCase() + '</span>' : '') +
        (s ? '<span class="sc-inset">👤 ' + YB.esc(clientName(s)) + '</span>' : '') + '</button>' +
        '<div class="sc-ba" role="group" aria-label="Before or after, photo ' + (i + 1) + '">' + STAGES.map(function (st) { return '<button type="button" data-stage="' + st[0] + '" class="' + st[0] + (p.stage === st[0] ? ' on' : '') + '" aria-pressed="' + (p.stage === st[0]) + '">' + st[1] + '</button>'; }).join('') + '</div>' +
        '<div class="sc-ph-ctl"><select data-label aria-label="Shot ' + (i + 1) + '">' + LABELS.map(function (l) { return '<option value="' + l + '"' + (l === p.label ? ' selected' : '') + '>' + (l || 'Angle…') + '</option>'; }).join('') + '</select>' +
        '<span class="sc-ph-btns"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-left aria-label="Move earlier"' + (i ? '' : ' disabled') + '>‹</button>' +
        '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-right aria-label="Move later"' + (i < photos.length - 1 ? '' : ' disabled') + '>›</button>' +
        '<button type="button" class="btn btn-danger btn-icon btn-sm" data-del aria-label="Remove photo ' + (i + 1) + '">✕</button></span></div></li>';
    }).join('');
    $('formatGroup').hidden = $('bulkRow').hidden = !photos.length;
    $('selBar').hidden = !selecting;
    $('selectModeBtn').setAttribute('aria-pressed', selecting); $('selectModeBtn').classList.toggle('on', selecting);
    var ts = setById(target), nb = picked.filter(function (id) { var q = photoById(id); return q && q.stage === 'before'; }).length, na = picked.filter(function (id) { var q = photoById(id); return q && q.stage === 'after'; }).length;
    $('makeSetBtn').disabled = !picked.length;
    $('makeSetBtn').textContent = ts ? '👤 Add to ' + clientName(ts) : '👤 Make this client';
    document.querySelectorAll('#brushSeg [data-brush]').forEach(function (b) { var on = b.getAttribute('data-brush') === brush; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
    $('selText').textContent = picked.length ? picked.length + ' picked · ' + nb + ' before · ' + na + ' after' + (brush === 'before' ? ' — switch to After for the finished shots' : '') : (brush === 'keep' ? 'Tap photos to pick them' : 'Tap the ' + brush.toUpperCase() + ' photos' + (ts ? ' for ' + clientName(ts) : ' of this client'));
  }

  function setStage(p, st) {
    p.stage = p.stage === st ? '' : st;
    var s = setOf(p.id); if (s) s._thumb = null;
    saveProject(); renderGrid(); if (p.id === cur) { renderStage(); drawEditor(); }
    queueThumb(p); renderSets(); refreshShowSoon();
  }
  function renderStage() {
    var p = photoById(cur); if (!p) return;
    document.querySelectorAll('#stageSeg [data-estage]').forEach(function (b) { var on = b.getAttribute('data-estage') === p.stage; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  }

  /* ---------- Editor ---------- */
  var edRaf = 0, edFast = false;
  function edSize() {
    var d = dims(), wrap = $('stage'), maxW = Math.min(440, Math.max(220, (wrap.clientWidth || 360) - 24)), s = Math.min(maxW / d.W, 520 / d.H);
    return { w: Math.round(d.W * s), h: Math.round(d.H * s) };
  }
  function sizeEditor() {
    var c = $('edCanvas'), es = edSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(es.w * dpr); c.height = Math.round(es.h * dpr); c.style.width = es.w + 'px'; c.style.aspectRatio = es.w + ' / ' + es.h;
  }
  function drawEditor(fast) {
    edFast = edFast || !!fast;
    if (edRaf) return;
    edRaf = requestAnimationFrame(function () {
      edRaf = 0; var f = edFast; edFast = false;
      var p = photoById(cur), c = $('edCanvas'); if (!p || !c) return;
      ensureImg(p).then(function () {
        var r = renderPhoto(p, c.width, c.height, { fast: f, brand: S.wmPos !== 'off', chip: true });
        var x = c.getContext('2d'); x.drawImage(r, 0, 0);
        // rule-of-thirds guide while cropping
        if (drag) { x.save(); x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 1; for (var k = 1; k < 3; k++) { x.beginPath(); x.moveTo(c.width * k / 3, 0); x.lineTo(c.width * k / 3, c.height); x.moveTo(0, c.height * k / 3); x.lineTo(c.width, c.height * k / 3); x.stroke(); } x.restore(); }
      });
    });
  }
  function renderEditor() {
    var p = photoById(cur);
    $('editCard').hidden = !p;
    if (!p) return;
    var i = photos.indexOf(p);
    $('edWhich').textContent = '· photo ' + (i + 1) + ' of ' + photos.length;
    $('edPos').textContent = (i + 1) + ' / ' + photos.length;
    $('prevBtn').disabled = i <= 0; $('nextBtn').disabled = i >= photos.length - 1;
    $('zoom').value = Math.round(p.f.zoom * 100); $('zoomVal').textContent = Math.round(p.f.zoom * 100) + '%';
    $('tilt').value = p.f.tilt; $('tiltVal').textContent = (p.f.tilt > 0 ? '+' : '') + p.f.tilt + '°';
    $('labelSel').innerHTML = LABELS.map(function (l) { return '<option value="' + l + '"' + (l === p.label ? ' selected' : '') + '>' + (l || 'Not set') + '</option>'; }).join('');
    $('autoFix').checked = !!p.auto; renderStage();
    $('lookList').innerHTML = LOOKS.map(function (l) {
      return '<button type="button" role="radio" class="sc-look' + (l[0] === p.look ? ' on' : '') + '" data-look="' + l[0] + '" aria-checked="' + (l[0] === p.look) + '"><canvas data-lookprev="' + l[0] + '" width="72" height="72"></canvas><span>' + l[1] + '</span></button>';
    }).join('');
    renderAdj();
    sizeEditor(); drawEditor();
    lookPreviewsSoon();
  }
  function renderAdj() {
    var p = photoById(cur); if (!p) return;
    var a = lookOf(p);
    $('adjList').innerHTML = ADJ.map(function (k) {
      var v = Math.round(a[k[0]] * 100);
      return '<label class="field"><span>' + k[1] + ' <b>' + (k[2] < 0 && v > 0 ? '+' : '') + v + '</b>' + (p.adj && p.adj[k[0]] != null ? ' <i class="sc-mod">changed</i>' : '') + '</span><input type="range" data-adj="' + k[0] + '" min="' + Math.round(k[2] * 100) + '" max="' + Math.round(k[3] * 100) + '" step="1" value="' + v + '"></label>';
    }).join('');
  }
  var lookPreviewsSoon = YB.debounce(function () {
    var p = photoById(cur); if (!p) return;
    ensureImg(p).then(function () {
      LOOKS.forEach(function (l) {
        var cv = document.querySelector('[data-lookprev="' + l[0] + '"]'); if (!cv) return;
        var q = Object.assign({}, p, { look: l[0], adj: {}, _lv: p._lv }), r = renderPhoto(q, 72, 72);
        cv.getContext('2d').drawImage(r, 0, 0);
      });
    });
  }, 120);
  function photoChanged(p, fast) {
    saveProject(); drawEditor(fast);
    if (!fast) { queueThumb(p); sets.forEach(function (s) { if (s.ids.indexOf(p.id) !== -1) s._thumb = null; }); refreshShowSoon(); }
  }
  var refreshShowSoon = YB.debounce(function () { renderSlides(); renderFacts(); if (!pv.playing) drawPreview(); }, 250);

  // Drag to move, pinch / wheel to zoom.
  var drag = null, pointers = {};
  function wireEditorPointer() {
    var c = $('edCanvas');
    function pt(e) { var r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; }
    c.addEventListener('pointerdown', function (e) {
      var p = photoById(cur); if (!p) return;
      pointers[e.pointerId] = pt(e); c.setPointerCapture(e.pointerId); e.preventDefault();
      var ids = Object.keys(pointers);
      if (ids.length === 2) { var a = pointers[ids[0]], b = pointers[ids[1]]; drag = { pinch: true, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: p.f.zoom }; }
      else drag = { last: pointers[e.pointerId] };
    });
    c.addEventListener('pointermove', function (e) {
      if (!drag || !pointers[e.pointerId]) return;
      var p = photoById(cur); if (!p) return;
      pointers[e.pointerId] = pt(e);
      if (drag.pinch) {
        var ids = Object.keys(pointers); if (ids.length < 2) return;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        p.f.zoom = clamp(drag.z0 * Math.hypot(a.x - b.x, a.y - b.y) / drag.d0, 0.5, 4);
      } else {
        var q = pointers[e.pointerId], dx = q.x - drag.last.x, dy = q.y - drag.last.y; drag.last = q;
        var g = geom(p, c.width, c.height), cs = Math.cos(-g.ang), sn = Math.sin(-g.ang);
        var ix = (dx * cs - dy * sn) / g.s, iy = (dx * sn + dy * cs) / g.s; if (p.f.flip) ix = -ix;
        p.f.cx -= ix / p.w; p.f.cy -= iy / p.h;
      }
      clampFrame(p, c.width, c.height);
      $('zoom').value = Math.round(p.f.zoom * 100); $('zoomVal').textContent = Math.round(p.f.zoom * 100) + '%';
      drawEditor(true);
    });
    var up = function (e) {
      delete pointers[e.pointerId];
      if (!Object.keys(pointers).length && drag) { drag = null; photoChanged(photoById(cur)); }
      else if (drag && drag.pinch) { var k = Object.keys(pointers)[0]; drag = { last: pointers[k] }; }
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', function (e) {
      var p = photoById(cur); if (!p) return; e.preventDefault();
      p.f.zoom = clamp(p.f.zoom * Math.pow(1.0015, -e.deltaY), 0.5, 4); clampFrame(p, c.width, c.height);
      $('zoom').value = Math.round(p.f.zoom * 100); $('zoomVal').textContent = Math.round(p.f.zoom * 100) + '%';
      drawEditor(true); wheelEnd();
    }, { passive: false });
  }
  var wheelEnd = YB.debounce(function () { var p = photoById(cur); if (p) photoChanged(p); }, 250);

  /* ---------- Sets UI ---------- */
  function renderSets() {
    $('setCard').hidden = !photos.length;
    if (!sets.length) { $('setList').innerHTML = '<li class="muted small fm-empty">No clients yet — tap ＋ New client.</li>'; return; }
    var d = dims();
    $('setList').innerHTML = sets.map(function (s, si) {
      var ps = setPhotos(s);
      return '<li class="sc-set" data-set="' + s.id + '">' +
        '<div class="sc-set-top"><img class="sc-set-prev" data-setprev="' + s.id + '" alt="Set ' + (si + 1) + ' preview" style="aspect-ratio:' + d.W + '/' + d.H + '"' + (s._thumb ? ' src="' + s._thumb + '"' : '') + '>' +
        '<div class="sc-set-meta"><label class="field"><span>Client or cut (shown on top — optional)</span><input type="text" data-sf="title" maxlength="40" value="' + YB.esc(s.title || '') + '" placeholder="e.g. Marcus · skin fade + beard"></label>' +
        '</div></div>' +
        '<div class="sc-cols">' + [['before', 'Before'], ['after', 'After'], ['', 'Not marked']].map(function (col) {
          var list = ps.filter(function (p) { return (p.stage || '') === col[0]; });
          if (!col[0] && !list.length) return '';
          return '<div class="sc-col ' + (col[0] || 'none') + '" data-col="' + col[0] + '"><div class="sc-col-head"><b>' + col[1] + '</b> <span class="muted small">' + list.length + '</span></div>' +
            '<div class="sc-col-photos">' + (list.length ? list.map(function (p) {
              return '<span class="sc-tile"><img data-sthumb="' + p.id + '" src="' + (p._thumb || '') + '" alt="Photo ' + photoNo(p) + '"><span class="sc-tile-btns">' +
                (col[0] ? '<button type="button" class="sc-x" data-sp-flip="' + p.id + '" title="Move to ' + (col[0] === 'before' ? 'After' : 'Before') + '" aria-label="Move photo ' + photoNo(p) + ' to ' + (col[0] === 'before' ? 'after' : 'before') + '">⇄</button>' : '<button type="button" class="sc-x" data-sp-mark="before" data-p="' + p.id + '" title="Before">B</button><button type="button" class="sc-x" data-sp-mark="after" data-p="' + p.id + '" title="After">A</button>') +
                '<button type="button" class="sc-x" data-sp-del="' + p.id + '" aria-label="Take photo ' + photoNo(p) + ' out of this client">✕</button></span></span>';
            }).join('') : '<span class="muted small sc-col-empty">' + (col[0] ? 'No ' + col[1].toLowerCase() + ' photos yet' : '') + '</span>') + '</div>' +
            (col[0] ? '<div class="sc-col-add"><button type="button" class="btn btn-ghost btn-sm" data-pick="' + col[0] + '">＋ Pick from photos</button><label class="btn btn-ghost btn-sm fm-upload">📷 Upload<input type="file" accept="image/*,.heic,.heif" multiple hidden data-up="' + col[0] + '"></label></div>' : '') + '</div>';
        }).join('') + '</div>' +
        '<div class="label" style="margin-top:10px">Layout</div><div class="seg sc-seg" role="radiogroup">' + LAYOUTS.map(function (l) { return '<button type="button" role="radio" data-layout="' + l[0] + '" class="' + (s.layout === l[0] ? 'on' : '') + '" aria-checked="' + (s.layout === l[0]) + '">' + l[1] + '</button>'; }).join('') + '</div>' +
        '<div class="row" style="gap:14px;margin-top:10px;flex-wrap:wrap">' +
        '<label class="cx-switch"><input type="checkbox" data-sf="labels"' + (s.labels ? ' checked' : '') + '> Show angles too (FRONT / SIDE / BACK)</label>' +
        '<label class="field" style="min-width:180px"><span>In the slideshow</span><select data-sf="show"><option value="collage"' + (s.show !== 'each' ? ' selected' : '') + '>As one collage</option><option value="each"' + (s.show === 'each' ? ' selected' : '') + '>One shot after another</option></select></label></div>' +
        '<div class="row" style="gap:6px;margin-top:10px"><button type="button" class="btn btn-sm" data-set-dl>⬇ Download collage</button><button type="button" class="btn btn-ghost btn-sm" data-set-share hidden>📤 Share</button><button type="button" class="btn btn-ghost btn-sm" data-set-ungroup>Ungroup</button><button type="button" class="btn btn-danger btn-sm" data-set-remove>Delete client</button></div></li>';
    }).join('');
    if (navigator.canShare) document.querySelectorAll('[data-set-share]').forEach(function (b) { b.hidden = false; });
    setThumbsSoon();
  }
  var setThumbsSoon = YB.debounce(function () {
    var d = dims(), w = 300, h = Math.round(300 * d.H / d.W);
    if (h > 380) { h = 380; w = Math.round(380 * d.W / d.H); }
    sets.forEach(function (s) {
      var im = document.querySelector('[data-setprev="' + s.id + '"]'); if (!im) return;
      if (s._thumb) { im.src = s._thumb; return; }
      Promise.all(setPhotos(s).map(ensureImg)).then(function () { s._thumb = renderSet(s, w, h).toDataURL('image/jpeg', 0.82); im.src = s._thumb; });
    });
  }, 200);
  function clientName(s) { return s.title || 'Client ' + (sets.indexOf(s) + 1); }
  function ensureSetSlide(s) { if (!slides.some(function (sl) { return sl.ref === s.id; })) slides.push({ id: YB.uid(), kind: 'set', ref: s.id }); }
  function startPicking(setId, st) {
    selecting = true; picked = []; target = setId || ''; brush = st || 'before';
    renderGrid();
    var g = $('photoGrid'); if (g.scrollIntoView) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
    YB.toast('Tap the ' + (brush === 'keep' ? '' : brush + ' ') + 'photos' + (target && setById(target) ? ' for ' + clientName(setById(target)) : ''));
  }
  function stopPicking() { selecting = false; picked = []; target = ''; renderGrid(); }
  // A tap picks the photo and marks it with the brush (Before / After). Tapping a picked photo again
  // switches it to the brush, or lets go of it when it's already marked that way.
  function pickPhoto(p) {
    var k = picked.indexOf(p.id);
    if (k === -1) { picked.push(p.id); if (brush !== 'keep') p.stage = brush; }
    else if (brush !== 'keep' && p.stage !== brush) p.stage = brush;
    else picked.splice(k, 1);
    var s0 = setOf(p.id); if (s0) s0._thumb = null;
    queueThumb(p); saveProject(); renderGrid();
  }
  function makeSet() {
    if (!picked.length) return;
    var into = setById(target);
    if (into) {   // add to an existing client
      sets.forEach(function (x) { if (x !== into) x.ids = x.ids.filter(function (id) { return picked.indexOf(id) === -1; }); });
      picked.forEach(function (id) { if (into.ids.indexOf(id) === -1) into.ids.push(id); });
      if (picked.some(function (id) { var q = photoById(id); return q && q.stage; })) into.layout = 'split';
      slides = slides.filter(function (sl) { return !(sl.kind === 'photo' && picked.indexOf(sl.ref) !== -1); });
      ensureSetSlide(into); into._thumb = null;
      var n = picked.length; picked = []; selecting = false; target = '';
      saveProject(); renderAll(); thumbsSoon();
      YB.toast('Added ' + n + ' photo' + (n === 1 ? '' : 's') + ' to ' + clientName(into));
      setTimeout(function () { var el = document.querySelector('[data-set="' + into.id + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
      return;
    }
    // a photo belongs to one set at a time
    sets.forEach(function (s) { s.ids = s.ids.filter(function (id) { return picked.indexOf(id) === -1; }); });
    sets.forEach(function (x) { x._thumb = null; });
    var s = { id: YB.uid(), title: '', ids: picked.slice(), layout: defaultLayout(), labels: true, show: 'collage' };
    var ps = picked.map(photoById).filter(Boolean), anyStage = ps.some(function (p) { return p.stage; });
    if (ps.length === 2 && !anyStage) { ps[0].stage = 'before'; ps[1].stage = 'after'; anyStage = true; }
    if (anyStage) s.layout = 'split';
    else {   // no before / after chosen: label the angles front / side / back
      var auto = ps.length === 3 ? ['Front', 'Side', 'Back'] : ['Front', 'Left side', 'Right side', 'Back', 'Top', 'Detail'];
      ps.forEach(function (p, i) { if (!p.label && auto[i]) p.label = auto[i]; });
    }
    sets.push(s);
    // the set takes the place of its photos in the slideshow
    var at = slides.findIndex(function (sl) { return sl.kind === 'photo' && picked.indexOf(sl.ref) !== -1; });
    slides = slides.filter(function (sl) { return !(sl.kind === 'photo' && picked.indexOf(sl.ref) !== -1); });
    slides.splice(at < 0 ? slides.length : Math.min(at, slides.length), 0, { id: YB.uid(), kind: 'set', ref: s.id });
    picked = []; selecting = false; target = '';
    saveProject(); renderAll(); thumbsSoon();
    YB.toast(s.layout === 'split' ? 'Before & after set made for this client' : 'Set made — it\'s one collage and one part of the slideshow');
    setTimeout(function () { var el = document.querySelector('[data-set="' + s.id + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 100);
  }
  function ungroup(s) {
    var at = slides.findIndex(function (sl) { return sl.ref === s.id; });
    slides = slides.filter(function (sl) { return sl.ref !== s.id; });
    var add = s.ids.filter(function (id) { return photoById(id); }).map(function (id) { return { id: YB.uid(), kind: 'photo', ref: id }; });
    slides.splice.apply(slides, [at < 0 ? slides.length : at, 0].concat(add));
    sets = sets.filter(function (x) { return x !== s; });
  }

  /* ---------- Slideshow UI ---------- */
  function slideName(sl) {
    if (sl.kind === 'photo') { var p = photoById(sl.ref); return p ? photoTitle(p) : ''; }
    var s = setById(sl.ref); return s ? '👤 ' + (s.title || 'Client ' + (sets.indexOf(s) + 1)) + ' · ' + s.ids.length + ' shots' : '';
  }
  function slideThumb(sl) {
    if (sl.kind === 'photo') { var p = photoById(sl.ref); return p && p._thumb ? p._thumb : ''; }
    var s = setById(sl.ref); return s && s._thumb ? s._thumb : '';
  }
  function renderSlides() {
    $('showCard').hidden = !photos.length;
    slides = slides.filter(function (sl) { return sl.kind === 'photo' ? photoById(sl.ref) : setById(sl.ref); });
    $('slideCount').textContent = '· ' + slides.length + ' part' + (slides.length === 1 ? '' : 's');
    var opts = '<option value="">Default</option>' + TRANS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
    var durs = '<option value="">Default</option>' + [1.5, 2, 2.5, 3, 4, 5, 6].map(function (v) { return '<option value="' + v + '">' + v + ' s</option>'; }).join('');
    var missing = photos.filter(function (p) { return !setOf(p.id) && !slides.some(function (sl) { return sl.ref === p.id; }); }).map(function (p) { return ['photo', p.id, photoTitle(p)]; })
      .concat(sets.filter(function (s) { return !slides.some(function (sl) { return sl.ref === s.id; }); }).map(function (s) { return ['set', s.id, '👤 ' + (s.title || 'Client ' + (sets.indexOf(s) + 1))]; }));
    $('slideList').innerHTML = slides.map(function (sl, i) {
      var th = slideThumb(sl);
      return '<li class="sc-slide" data-slide="' + sl.id + '"><span class="cx-pnum">' + (i + 1) + '</span>' + (th ? '<img src="' + th + '" alt="">' : '<span class="sc-sl-ph"></span>') +
        '<div class="sc-sl-meta"><b>' + YB.esc(slideName(sl)) + '</b><span class="sc-sl-sel">' +
        '<select data-sl="trans" aria-label="Transition into this part">' + opts.replace('value="' + (sl.trans || '') + '"', 'value="' + (sl.trans || '') + '" selected') + '</select>' +
        '<select data-sl="dur" aria-label="How long">' + durs.replace('value="' + (sl.dur || '') + '"', 'value="' + (sl.dur || '') + '" selected') + '</select></span>' +
        '<span class="sc-sl-text"><input type="text" data-sl-text maxlength="90" value="' + YB.esc(sl.text || '') + '" placeholder="✍️ Text on screen (optional)" aria-label="Text on screen for part ' + (i + 1) + '">' +
        (sl.tx != null ? '<button type="button" class="sc-x" data-sl-repos title="Put the text back in its usual place" aria-label="Reset text position">↺</button>' : '') + '</span></div>' +
        '<span class="cx-pbtns"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-sl-up aria-label="Earlier"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="btn btn-ghost btn-icon btn-sm" data-sl-down aria-label="Later"' + (i < slides.length - 1 ? '' : ' disabled') + '>↓</button><button type="button" class="btn btn-ghost btn-icon btn-sm" data-sl-del aria-label="Leave out of the slideshow">✕</button></span></li>';
    }).join('') + (missing.length ? '<li class="sc-addback"><select id="addBack" aria-label="Add back"><option value="">＋ Put back in the slideshow…</option>' + missing.map(function (m) { return '<option value="' + m[0] + ':' + m[1] + '">' + YB.esc(m[2]) + '</option>'; }).join('') + '</select></li>' : '');
    $('transSel').value = S.trans; $('durRange').value = S.dur; $('durVal').textContent = S.dur + ' s';
    $('kenBurns').checked = !!S.kenBurns; $('introOn').checked = !!S.intro; $('outroOn').checked = !!S.outro;
    $('capStyle').value = S.capStyle; $('capPos').value = S.capPos; $('capAnim').value = S.capAnim; $('capSize').value = Math.round((S.capSize || 1) * 100); $('capSizeVal').textContent = Math.round((S.capSize || 1) * 100) + '%';
    ['introTitle', 'introSub', 'outroTitle', 'outroSub'].forEach(function (k) { if (document.activeElement !== $(k)) $(k).value = S[k] || ''; });
    $('musicName').textContent = music ? '🎵 ' + music.name : 'No music'; $('musicDel').hidden = !music; renderMusic(); $('fxSel').value = S.fx || 'none';
  }
  function renderMusic() {
    var box = $('musicOpts'); if (!box) return;
    box.hidden = !music; if (!music) return;
    $('musicVol').value = S.musicVol == null ? 85 : S.musicVol; $('musicVolVal').textContent = $('musicVol').value + '%';
    var max = Math.max(1, Math.floor((music.dur || 60) - 5));
    $('musicStart').max = max; $('musicStart').value = Math.min(max, songStart()); $('musicStartVal').textContent = mmss(songStart()) + (S.musicStart == null ? ' (first beat)' : '');
    $('beatSync').checked = S.beatSync !== false;
    $('bpmVal').textContent = music.bpm ? '· ' + Math.round(music.bpm) + ' BPM' : '· finding the beat…';
  }
  function renderFacts() {
    var tl = segments(), d = dims();
    $('facts').innerHTML = photos.length ? '<span><b>' + photos.length + '</b> photo' + (photos.length === 1 ? '' : 's') + '</span>' + (sets.length ? '<span><b>' + sets.length + '</b> set' + (sets.length === 1 ? '' : 's') + '</span>' : '') + '<span><b>' + mmss(tl.total) + '</b> video</span><span><b>' + d.W + '×' + d.H + '</b></span>' + (music ? '<span>🎵 music' + (synced() ? ' · on the beat' : '') + '</span>' : '') : '';
    $('exportBtn').disabled = !tl.segs.length || !!rec;
  }
  function renderSteps() {
    var st = document.querySelectorAll('.cx-steps li');
    st[0].classList.toggle('done', photos.length > 0);
    st[1].classList.toggle('done', photos.some(function (p) { return p.look !== 'natural' || p.auto; }));
    st[2].classList.toggle('done', sets.length > 0);
    st[3].classList.toggle('done', !!lastVideo);
    $('brandCard').hidden = !photos.length;
  }
  function renderBrand() {
    $('bShop').value = S.shop; $('bHandle').value = S.handle; $('bBook').value = S.book; $('bColor').value = S.color;
    $('wmPos').value = S.wmPos; $('wmStyle').value = S.wmStyle;
    $('plainOn').checked = !!S.plain;
    ['showStage', 'showAngle', 'showBrand', 'showTitle', 'showText'].forEach(function (k) { $(k).checked = S[k] !== false; $(k).disabled = !!S.plain; });
    $('switchGroup').classList.toggle('sc-off', !!S.plain);
    $('logoPrev').hidden = $('logoDel').hidden = !logo;
    if (logo && logo._img) $('logoPrev').src = logo._img.src;
  }
  function renderAll() { renderFormats(); renderGrid(); renderEditor(); renderSets(); renderSlides(); renderBrand(); renderSteps(); renderFacts(); sizePreview(); if (!pv.playing) drawPreview(); }

  /* ---------- Downloads ---------- */
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
  function toBlob(c) { return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.93); }); }
  function photoFile(p) { var d = dims(); return ensureImg(p).then(function () { return toBlob(renderPhoto(p, d.W, d.H, { brand: true, chip: true })); }); }
  function setFile(s) { var d = dims(); return Promise.all(setPhotos(s).map(ensureImg)).then(function () { return toBlob(renderSet(s, d.W, d.H, { brand: true })); }); }
  function photoName(p) { return String(photoNo(p)).padStart(2, '0') + (chipText(p) ? '-' + slug(chipText(p)) : '') + '-' + S.format + (S.plain ? '-plain' : '') + '.jpg'; }
  function setName(s) { return 'set-' + (sets.indexOf(s) + 1) + (s.title ? '-' + slug(s.title) : '') + '-' + S.format + '.jpg'; }
  function save(blob, name) { var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000); }
  // Save: phones open the share sheet ("Save Image" puts it in Photos); computers download the file.
  function touchy() { return (navigator.maxTouchPoints || 0) > 0 && window.matchMedia && matchMedia('(pointer: coarse)').matches; }
  function savePhoto(blob, name) {
    var f = new File([blob], name, { type: blob.type });
    if (touchy() && navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f] }).catch(function () {});
    save(blob, name); YB.toast('Saved ' + name);
  }
  function saveAllPhotos() {
    if (!photos.length) return;
    var btn = $('saveAllBtn'); btn.disabled = true; $('zipNote').textContent = 'Preparing your photos…';
    var files = [], i = 0;
    function next() {
      if (i >= photos.length) return Promise.resolve();
      var p = photos[i++]; $('zipNote').textContent = 'Preparing ' + i + ' of ' + photos.length + '…';
      return photoFile(p).then(function (b) { files.push(new File([b], photoName(p), { type: 'image/jpeg' })); }).then(next);
    }
    next().then(function () {
      sets.forEach(function () {});
      if (touchy() && navigator.canShare && navigator.canShare({ files: files })) {
        $('zipNote').textContent = 'Choose “Save ' + files.length + ' Images” to put them in Photos.';
        return navigator.share({ files: files }).catch(function () {});
      }
      return Promise.all(files.map(function (f) { return f.arrayBuffer().then(function (ab) { return { name: f.name, data: new Uint8Array(ab) }; }); })).then(function (list) {
        save(zip(list), 'photos-' + (slug(brandText()) || 'showcase') + '-' + S.format + (S.plain ? '-plain' : '') + '.zip');
        $('zipNote').textContent = list.length + ' edited photos saved (ZIP).';
      });
    }).catch(function (e) { console.error(e); YB.toast('Couldn\'t save the photos'); }).then(function () { btn.disabled = false; });
  }
  function share(blob, name) {
    var f = new File([blob], name, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [f] })) return navigator.share({ files: [f], title: brandText() || 'Fresh cut' }).catch(function () {});
    save(blob, name);
  }
  // ZIP (stored, no compression — JPEG and MP4 are already compressed)
  var CRC = (function () { var t = new Uint32Array(256); for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { var c = 0xFFFFFFFF; for (var i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files) {   // [{name, data:Uint8Array}]
    var parts = [], central = [], off = 0, enc = new TextEncoder(), now = new Date();
    var dt = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF, dd = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
    files.forEach(function (f) {
      var nm = enc.encode(f.name), crc = crc32(f.data), h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true); h.setUint16(10, dt, true); h.setUint16(12, dd, true);
      h.setUint32(14, crc, true); h.setUint32(18, f.data.length, true); h.setUint32(22, f.data.length, true); h.setUint16(26, nm.length, true); h.setUint16(28, 0, true);
      parts.push(h.buffer, nm, f.data);
      var c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dt, true); c.setUint16(14, dd, true);
      c.setUint32(16, crc, true); c.setUint32(20, f.data.length, true); c.setUint32(24, f.data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      central.push(c.buffer, nm);
      off += 30 + nm.length + f.data.length;
    });
    var csize = central.reduce(function (s, b) { return s + (b.byteLength || b.length); }, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    return new Blob(parts.concat(central, [e.buffer]), { type: 'application/zip' });
  }
  function downloadAll() {
    if (!photos.length) return;
    var btn = $('zipBtn'); btn.disabled = true;
    var jobs = photos.map(function (p) { return function () { return photoFile(p).then(function (b) { return [photoName(p), b]; }); }; })
      .concat(sets.map(function (s) { return function () { return setFile(s).then(function (b) { return [setName(s), b]; }); }; }));
    var out = [], i = 0;
    function next() {
      if (i >= jobs.length) return Promise.resolve();
      $('zipNote').textContent = 'Preparing ' + (i + 1) + ' of ' + jobs.length + '…';
      return jobs[i++]().then(function (r) { return r[1].arrayBuffer().then(function (ab) { out.push({ name: r[0], data: new Uint8Array(ab) }); }); }).then(function () { return new Promise(function (r) { setTimeout(r, 0); }); }).then(next);
    }
    next().then(function () {
      if (lastVideo && lastVideoBlob) return lastVideoBlob.arrayBuffer().then(function (ab) { out.push({ name: 'slideshow-' + S.format + '.' + (/mp4/.test(lastVideoBlob.type) ? 'mp4' : 'webm'), data: new Uint8Array(ab) }); });
    }).then(function () {
      save(zip(out), 'showcase-' + (slug(brandText()) || 'photos') + '-' + new Date().toISOString().slice(0, 10) + '.zip');
      $('zipNote').textContent = out.length + ' files: every photo' + (sets.length ? ', every set' : '') + (lastVideoBlob ? ' and the video' : '') + ', ' + dims().W + '×' + dims().H + '.';
    }).catch(function (e) { console.error(e); YB.toast('Couldn\'t make the ZIP'); }).then(function () { btn.disabled = false; });
  }

  /* ---------- Video export ---------- */
  var lastVideoBlob = null;
  function pickVideoCodec(W, H) {
    var opts = [['avc', 'avc1.640034'], ['avc', 'avc1.4d0034'], ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08']];
    return opts.reduce(function (p, o) {
      return p.then(function (found) {
        if (found) return found;
        var cfg = { codec: o[1], width: W, height: H, bitrate: W * H > 2e6 ? 12e6 : 9e6, framerate: FPS, latencyMode: 'quality' };
        if (o[0] === 'avc') cfg.avc = { format: 'avc' };
        return VideoEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? { mux: o[0], cfg: cfg } : null; }, function () { return null; });
      });
    }, Promise.resolve(null));
  }
  function pickAudioCodec() {
    if (!window.AudioEncoder || !window.AudioData) return Promise.resolve(null);
    return [['aac', 'mp4a.40.2'], ['opus', 'opus']].reduce(function (p, o) {
      return p.then(function (found) {
        if (found) return found;
        var cfg = { codec: o[1], sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
        return AudioEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? { mux: o[0], cfg: cfg } : null; }, function () { return null; });
      });
    }, Promise.resolve(null));
  }
  function mixMusic(T) {
    if (!music || !blobs[music.blobId]) return Promise.resolve(null);
    var Off = window.OfflineAudioContext || window.webkitOfflineAudioContext, AC = window.AudioContext || window.webkitAudioContext;
    if (!Off || !AC) return Promise.resolve(null);
    return decodeMusic().then(function (b) {
      if (!b) return null;
      var off = new Off(2, Math.ceil(T * 48000), 48000), src = off.createBufferSource(), g = off.createGain(), comp = off.createDynamicsCompressor();
      var vol = (S.musicVol == null ? 85 : S.musicVol) / 100, st = Math.min(songStart(), Math.max(0, b.duration - 1));
      // a gentle compressor keeps the song full and punchy without clipping
      comp.threshold.value = -16; comp.knee.value = 8; comp.ratio.value = 3; comp.attack.value = 0.006; comp.release.value = 0.2;
      src.buffer = b; src.loop = true; src.loopStart = 0; src.loopEnd = b.duration;
      src.connect(g); g.connect(comp); comp.connect(off.destination);
      g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(vol, 0.02); g.gain.setValueAtTime(vol, Math.max(0.03, T - 1.8)); g.gain.linearRampToValueAtTime(0, T);
      src.start(0, st); return off.startRendering();
    }).catch(function () { return null; });
  }
  function opusHead(preSkip) {
    var b = new Uint8Array(19), dv = new DataView(b.buffer);
    'OpusHead'.split('').forEach(function (ch, i) { b[i] = ch.charCodeAt(0); });
    b[8] = 1; b[9] = 2; dv.setUint16(10, preSkip, true); dv.setUint32(12, 48000, true); return b.buffer;
  }
  function fixOpusDelay(blob) {   // some browsers write 80 ms of Opus padding instead of 6.5 ms
    if (!/mp4/.test(blob.type)) return Promise.resolve(blob);
    return blob.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), fixed = false;
      for (var i = 4; i < u.length - 12; i++) if (u[i] === 0x64 && u[i + 1] === 0x4F && u[i + 2] === 0x70 && u[i + 3] === 0x73) { if (((u[i + 6] << 8) | u[i + 7]) === 3840) { u[i + 6] = 1; u[i + 7] = 56; fixed = true; } break; }
      return fixed ? new Blob([u], { type: blob.type }) : blob;
    }, function () { return blob; });
  }
  function exportVideo() {
    var tl = segments(); if (!tl.segs.length || rec) return;
    stop();
    var d = dims(), W = d.W, H = d.H, T = tl.total;
    rec = { cancelled: false };
    $('exportProg').hidden = false; $('result').hidden = true; $('exportBtn').disabled = true; $('playBtn').disabled = true;
    $('exportBar').style.width = '0%'; $('exportText').textContent = 'Preparing the photos…';
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    var fast = window.VideoEncoder && window.VideoFrame && window.Mp4Muxer;
    // make every full-size still first, so frames are quick
    var chain = Promise.resolve();
    tl.segs.forEach(function (g, i) {
      chain = chain.then(function () {
        if (rec.cancelled) throw new Error('cancelled');
        var ps = g.photo ? [g.photo] : g.set ? setPhotos(g.set) : [];
        return Promise.all(ps.map(ensureImg)).then(function () { stillFor(g, W, H); $('exportText').textContent = 'Preparing ' + (i + 1) + ' of ' + tl.segs.length + '…'; return new Promise(function (r) { setTimeout(r, 0); }); });
      });
    });
    chain.then(function () { return mixMusic(T); }).then(function (mix) {
      if (rec.cancelled) throw new Error('cancelled');
      if (!fast) return recordVideo(canvas, ctx, mix, T, tl);
      return Promise.all([pickVideoCodec(W, H), mix ? pickAudioCodec() : null]).then(function (r) {
        if (!r[0] || (mix && !r[1])) return recordVideo(canvas, ctx, mix, T, tl);
        return encodeVideo(canvas, ctx, mix, T, tl, r[0], r[1]);
      });
    }).then(function (out) {
      if (!out) return;
      return fixOpusDelay(out.blob).then(function (b) { showResult(b, T, W, H); });
    }).catch(function (e) {
      if (e && e.message === 'cancelled') YB.toast('Video cancelled');
      else { console.error('[Showcase] export failed', e); YB.toast('The video couldn\'t be made: ' + (e && e.message || e)); }
    }).then(function () {
      rec = null; $('exportProg').hidden = true; $('playBtn').disabled = false; renderFacts(); renderSteps(); trimStills();
    });
  }
  function encodeVideo(canvas, ctx, mix, T, tl, vc, ac) {
    var W = canvas.width, H = canvas.height, frames = Math.max(1, Math.round(T * FPS)), failed = null;
    var target = new Mp4Muxer.ArrayBufferTarget();
    var muxer = new Mp4Muxer.Muxer({ target: target, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
      video: { codec: vc.mux, width: W, height: H, frameRate: FPS }, audio: mix ? { codec: ac.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined });
    var vEnc = new VideoEncoder({ output: function (c, m) { muxer.addVideoChunk(c, m); }, error: function (e) { failed = failed || e; } });
    vEnc.configure(vc.cfg);
    var audioDone = Promise.resolve();
    if (mix) {
      var gotHead = false;
      var aEnc = new AudioEncoder({ output: function (c, m) {
        if (ac.mux === 'opus') { if (!gotHead) { var ds = m && m.decoderConfig && m.decoderConfig.description; if (!ds || ds.byteLength < 18) m = { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: opusHead(312) } }; gotHead = true; } else m = undefined; }
        muxer.addAudioChunk(c, m);
      }, error: function (e) { failed = failed || e; } });
      aEnc.configure(ac.cfg);
      var L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
      for (var o = 0; o < mix.length; o += 4800) {
        var n = Math.min(4800, mix.length - o), data = new Float32Array(n * 2); data.set(L.subarray(o, o + n), 0); data.set(R.subarray(o, o + n), n);
        var ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(o / 48000 * 1e6), data: data });
        aEnc.encode(ad); ad.close();
      }
      audioDone = aEnc.flush().then(function () { aEnc.close(); });
    }
    var fi = 0;
    function step() {
      if (rec.cancelled) return Promise.reject(new Error('cancelled'));
      if (failed) return Promise.reject(failed);
      var end = Math.min(frames, fi + 10);
      for (; fi < end; fi++) {
        renderFrame(ctx, W, H, fi / FPS, tl);
        var vf = new VideoFrame(canvas, { timestamp: Math.round(fi * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        vEnc.encode(vf, { keyFrame: fi % (FPS * 2) === 0 }); vf.close();
      }
      $('exportBar').style.width = (fi / frames * 100).toFixed(1) + '%';
      $('exportText').textContent = 'Making the video… ' + Math.round(fi / frames * 100) + '%';
      if (fi >= frames) return Promise.resolve();
      var wait = function () { return vEnc.encodeQueueSize > 12 ? new Promise(function (r) { setTimeout(r, 10); }).then(wait) : new Promise(function (r) { setTimeout(r, 0); }); };
      return wait().then(step);
    }
    return step().then(function () { $('exportText').textContent = 'Finishing…'; return Promise.all([vEnc.flush(), audioDone]); }).then(function () {
      if (failed) throw failed;
      vEnc.close(); muxer.finalize();
      return { blob: new Blob([target.buffer], { type: 'video/mp4' }) };
    }, function (e) { try { vEnc.close(); } catch (x) { /* closed */ } throw e; });
  }
  function recordVideo(canvas, ctx, mix, T, tl) {   // browsers without WebCodecs: real-time recording
    if (!window.MediaRecorder || !canvas.captureStream) return Promise.reject(new Error('This browser can\'t make videos — use Chrome, Edge or Safari'));
    var types = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'], mime = types.find(function (t) { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } }) || '';
    var stream = canvas.captureStream(FPS), AC = window.AudioContext || window.webkitAudioContext, ac = new AC(), src = null;
    if (mix) { var dest = ac.createMediaStreamDestination(); src = ac.createBufferSource(); src.buffer = mix; src.connect(dest); dest.stream.getAudioTracks().forEach(function (t) { stream.addTrack(t); }); }
    return (ac.state === 'suspended' ? ac.resume() : Promise.resolve()).then(function () {
      return new Promise(function (resolve, reject) {
        var chunks = [], mr = mime ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 10e6 }) : new MediaRecorder(stream);
        mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        mr.onstop = function () { stream.getTracks().forEach(function (t) { t.stop(); }); try { ac.close(); } catch (e) { /* closed */ } if (rec && rec.cancelled) reject(new Error('cancelled')); else resolve({ blob: new Blob(chunks, { type: (mr.mimeType || mime || 'video/webm').split(';')[0] }) }); };
        var t0 = 0, done = false;
        function frame() {
          if (done) return;
          var t = Math.max(0, ac.currentTime - t0);
          if (rec.cancelled || t >= T) { done = true; try { src && src.stop(); } catch (e) { /* stopped */ } setTimeout(function () { mr.stop(); }, 150); return; }
          renderFrame(ctx, canvas.width, canvas.height, t, tl);
          $('exportBar').style.width = Math.min(100, t / T * 100).toFixed(1) + '%'; $('exportText').textContent = 'Recording ' + mmss(t) + ' of ' + mmss(T) + ' — keep this screen open';
          requestAnimationFrame(frame);
        }
        renderFrame(ctx, canvas.width, canvas.height, 0, tl);
        mr.start(1000); t0 = ac.currentTime + 0.1; if (src) src.start(t0);
        requestAnimationFrame(frame);
      });
    });
  }
  function showResult(blob, T, W, H) {
    if (lastVideo) URL.revokeObjectURL(lastVideo);
    lastVideoBlob = blob; lastVideo = URL.createObjectURL(blob);
    var ext = /mp4/.test(blob.type) ? 'mp4' : 'webm';
    $('resultVideo').src = lastVideo; $('downloadBtn').href = lastVideo;
    $('downloadBtn').download = 'showcase-' + (slug(brandText()) || 'slideshow') + '-' + S.format + '.' + ext;
    $('resultInfo').textContent = W + '×' + H + ' · ' + mmss(T) + ' · ' + ext.toUpperCase() + ' · ' + (blob.size / 1048576).toFixed(1) + ' MB';
    $('shareVideoBtn').hidden = !navigator.canShare;
    $('result').hidden = false; YB.toast('Your slideshow is ready');
  }

  /* ---------- Wiring ---------- */
  function wire() {
    var drop = $('dropZone');
    $('photoFiles').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });

    $('formatSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-format]'); if (!b) return;
      S.format = b.getAttribute('data-format'); saveSettings();
      var d = dims(); photos.forEach(function (p) { clampFrame(p, d.W, d.H); p._thumb = null; });
      sets.forEach(function (s) { s._thumb = null; }); stills = {};
      stop(); pv.t = 0; renderAll(); thumbsSoon();
    });
    $('photoGrid').addEventListener('click', function (e) {
      var li = e.target.closest('[data-id]'); if (!li) return;
      var id = li.getAttribute('data-id'), i = photos.findIndex(function (p) { return p.id === id; }); if (i < 0) return;
      var sb = e.target.closest('[data-stage]');
      if (sb) { setStage(photos[i], sb.getAttribute('data-stage')); return; }
      if (e.target.closest('[data-del]')) {
        if (!confirm('Remove photo ' + (i + 1) + '?')) return;
        var p = photos.splice(i, 1)[0]; delBlob(p.blobId); delete blobs[p.blobId]; delete imgs[p.blobId];
        sets.forEach(function (s) { s.ids = s.ids.filter(function (x) { return x !== id; }); s._thumb = null; });
        slides = slides.filter(function (sl) { return sl.ref !== id; }); picked = picked.filter(function (x) { return x !== id; });
        if (cur === id) cur = (photos[i] || photos[i - 1] || {}).id || '';
      } else if (e.target.closest('[data-left]') && i > 0) { var t = photos[i - 1]; photos[i - 1] = photos[i]; photos[i] = t; }
      else if (e.target.closest('[data-right]') && i < photos.length - 1) { var t2 = photos[i + 1]; photos[i + 1] = photos[i]; photos[i] = t2; }
      else if (e.target.closest('[data-open]')) {
        if (selecting) { pickPhoto(photos[i]); return; }
        cur = id; renderGrid(); renderEditor();
        var ed = $('editCard'); if (ed.getBoundingClientRect().top > window.innerHeight * 0.6 && ed.scrollIntoView) ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
      } else return;
      saveProject(); renderAll();
    });
    $('photoGrid').addEventListener('change', function (e) {
      var li = e.target.closest('[data-id]'); if (!li || !e.target.matches('[data-label]')) return;
      var p = photoById(li.getAttribute('data-id')); if (!p) return;
      p.label = e.target.value; saveProject(); if (p.id === cur) $('labelSel').value = p.label;
      sets.forEach(function (s) { if (s.ids.indexOf(p.id) !== -1) s._thumb = null; }); renderSets(); refreshShowSoon();
    });
    $('selectModeBtn').addEventListener('click', function () { if (selecting) stopPicking(); else startPicking('', 'before'); });
    $('cancelSelBtn').addEventListener('click', stopPicking);
    $('brushSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-brush]'); if (!b) return; brush = b.getAttribute('data-brush'); renderGrid(); });
    $('newClientBtn').addEventListener('click', function () {
      var s = { id: YB.uid(), title: '', ids: [], layout: 'split', labels: true, show: 'collage' };
      sets.push(s); ensureSetSlide(s); saveProject(); renderSets(); refreshShowSoon();
      setTimeout(function () { var el = document.querySelector('[data-set="' + s.id + '"] [data-sf=title]'); if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.focus({ preventScroll: true }); } }, 80);
    });
    $('makeSetBtn').addEventListener('click', makeSet);
    $('autoAllBtn').addEventListener('click', function () { photos.forEach(function (p) { p.auto = true; p._thumb = null; }); stills = {}; saveProject(); renderAll(); thumbsSoon(); YB.toast('Auto-fix is on for every photo'); });
    $('lookAllBtn').addEventListener('click', function () {
      var c = photoById(cur); if (!c) return;
      photos.forEach(function (p) { p.look = c.look; p.adj = Object.assign({}, c.adj); p.auto = c.auto; p._thumb = null; });
      stills = {}; saveProject(); renderAll(); thumbsSoon();
      YB.toast('"' + LOOKS.find(function (l) { return l[0] === c.look; })[1] + '" is on every photo');
    });

    // editor
    $('prevBtn').addEventListener('click', function () { var i = photos.findIndex(function (p) { return p.id === cur; }); if (i > 0) { cur = photos[i - 1].id; renderGrid(); renderEditor(); } });
    $('nextBtn').addEventListener('click', function () { var i = photos.findIndex(function (p) { return p.id === cur; }); if (i < photos.length - 1) { cur = photos[i + 1].id; renderGrid(); renderEditor(); } });
    $('zoom').addEventListener('input', function () { var p = photoById(cur); if (!p) return; p.f.zoom = clamp(+this.value / 100, 0.5, 4); var c = $('edCanvas'); clampFrame(p, c.width, c.height); $('zoomVal').textContent = this.value + '%'; drawEditor(true); });
    $('zoom').addEventListener('change', function () { var p = photoById(cur); if (p) photoChanged(p); });
    $('tilt').addEventListener('input', function () { var p = photoById(cur); if (!p) return; p.f.tilt = +this.value; $('tiltVal').textContent = (p.f.tilt > 0 ? '+' : '') + p.f.tilt + '°'; drawEditor(true); });
    $('tilt').addEventListener('change', function () { var p = photoById(cur); if (p) photoChanged(p); });
    $('rotBtn').addEventListener('click', function () { var p = photoById(cur); if (!p) return; p.f.rot = (p.f.rot + 1) % 4; p.f.cx = 0.5; p.f.cy = 0.5; photoChanged(p); });
    $('flipBtn').addEventListener('click', function () { var p = photoById(cur); if (!p) return; p.f.flip = !p.f.flip; photoChanged(p); });
    $('resetCropBtn').addEventListener('click', function () { var p = photoById(cur); if (!p) return; p.f = defaultFrame(); renderEditor(); photoChanged(p); });
    $('stageSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-estage]'), p = photoById(cur); if (b && p) setStage(p, b.getAttribute('data-estage')); });
    function shownChanged() { saveSettings(); stills = {}; photos.forEach(function (p) { p._thumb = null; }); sets.forEach(function (s) { s._thumb = null; }); renderBrand(); drawEditor(); thumbsSoon(); renderSets(); drawPreview(); }
    ['showStage', 'showAngle', 'showBrand', 'showTitle', 'showText'].forEach(function (k) { $(k).addEventListener('change', function () { S[k] = this.checked; shownChanged(); }); });
    $('plainOn').addEventListener('change', function () { S.plain = this.checked; shownChanged(); YB.toast(S.plain ? 'Plain photos: nothing is added on top — your crops and looks stay' : 'Tags, name and text are back on'); });
    [['capStyle', 'capStyle'], ['capPos', 'capPos'], ['capAnim', 'capAnim']].forEach(function (a) { $(a[0]).addEventListener('change', function () { S[a[1]] = this.value; if (a[0] === 'capPos') slides.forEach(function (sl) { sl.tx = sl.ty = null; }); saveSettings(); saveProject(); showTextPart(a[0] === 'capAnim'); }); });
    $('capSize').addEventListener('input', function () { S.capSize = +this.value / 100; $('capSizeVal').textContent = this.value + '%'; saveSettings(); showTextPart(false); });
    ['introTitle', 'introSub', 'outroTitle', 'outroSub'].forEach(function (k) { $(k).addEventListener('input', function () { S[k] = this.value; saveSettings(); stills = {}; stop(); var tl = segments(); var g = tl.segs.find(function (x) { return x.card === (k.indexOf('intro') === 0 ? 'intro' : 'outro'); }); if (g) pv.t = g.start + 1; drawPreview(); }); });
    $('labelSel').addEventListener('change', function () { var p = photoById(cur); if (!p) return; p.label = this.value; saveProject(); renderGrid(); sets.forEach(function (s) { if (s.ids.indexOf(p.id) !== -1) s._thumb = null; }); renderSets(); refreshShowSoon(); });
    $('lookList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-look]'), p = photoById(cur); if (!b || !p) return;
      p.look = b.getAttribute('data-look'); p.adj = {};
      document.querySelectorAll('#lookList [data-look]').forEach(function (x) { var on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
      renderAdj(); photoChanged(p);
    });
    $('autoFix').addEventListener('change', function () { var p = photoById(cur); if (!p) return; p.auto = this.checked; lookPreviewsSoon(); photoChanged(p); });
    $('adjList').addEventListener('input', function (e) {
      var k = e.target.getAttribute('data-adj'), p = photoById(cur); if (!k || !p) return;
      p.adj = p.adj || {}; p.adj[k] = +e.target.value / 100;
      var b = e.target.previousElementSibling.querySelector('b'); if (b) b.textContent = (+e.target.value > 0 && ADJ.find(function (a) { return a[0] === k; })[2] < 0 ? '+' : '') + e.target.value;
      drawEditor(k !== 'sharpen');
    });
    $('adjList').addEventListener('change', function (e) { var p = photoById(cur); if (!p || !e.target.getAttribute('data-adj')) return; renderAdj(); photoChanged(p); });
    $('resetAdjBtn').addEventListener('click', function () { var p = photoById(cur); if (!p) return; p.adj = {}; renderAdj(); photoChanged(p); });
    $('dlPhotoBtn').addEventListener('click', function () { var p = photoById(cur); if (p) photoFile(p).then(function (b) { savePhoto(b, photoName(p)); }); });
    $('sharePhotoBtn').hidden = !navigator.canShare || touchy();
    $('sharePhotoBtn').addEventListener('click', function () { var p = photoById(cur); if (p) photoFile(p).then(function (b) { share(b, photoName(p)); }); });

    // sets
    var sl = $('setList');
    ['dragenter', 'dragover'].forEach(function (ev) { sl.addEventListener(ev, function (e) { var c = e.target.closest('[data-col]'); if (!c || !c.getAttribute('data-col')) return; e.preventDefault(); c.classList.add('over'); }); });
    sl.addEventListener('dragleave', function (e) { var c = e.target.closest('[data-col]'); if (c) c.classList.remove('over'); });
    sl.addEventListener('drop', function (e) {
      var c = e.target.closest('[data-col]'); if (!c || !c.getAttribute('data-col')) return; e.preventDefault(); c.classList.remove('over');
      if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files, { setId: c.closest('[data-set]').getAttribute('data-set'), stage: c.getAttribute('data-col') });
    });
    sl.addEventListener('click', function (e) {
      var li = e.target.closest('[data-set]'); if (!li) return;
      var s = setById(li.getAttribute('data-set')); if (!s) return;
      var lb = e.target.closest('[data-layout]'), sp;
      if (lb) { s.layout = lb.getAttribute('data-layout'); }
      else if ((sp = e.target.closest('[data-sp-del]'))) { var id = sp.getAttribute('data-sp-del'); s.ids = s.ids.filter(function (x) { return x !== id; }); slides.push({ id: YB.uid(), kind: 'photo', ref: id }); }
      else if ((sp = e.target.closest('[data-sp-flip]'))) { var fp = photoById(sp.getAttribute('data-sp-flip')); if (fp) { fp.stage = fp.stage === 'before' ? 'after' : 'before'; queueThumb(fp); } }
      else if ((sp = e.target.closest('[data-sp-mark]'))) { var mp = photoById(sp.getAttribute('data-p')); if (mp) { mp.stage = sp.getAttribute('data-sp-mark'); s.layout = 'split'; queueThumb(mp); } }
      else if ((sp = e.target.closest('[data-pick]'))) { startPicking(s.id, sp.getAttribute('data-pick')); return; }
      else if (e.target.closest('[data-set-remove]')) { if (!confirm('Delete ' + clientName(s) + '? Its photos stay in your photos.')) return; ungroup(s); }
      else if ((sp = e.target.closest('[data-sp-left]'))) { var j = s.ids.indexOf(sp.getAttribute('data-sp-left')); if (j > 0) { var t = s.ids[j - 1]; s.ids[j - 1] = s.ids[j]; s.ids[j] = t; } }
      else if (e.target.closest('[data-set-dl]')) { setFile(s).then(function (b) { save(b, setName(s)); }); return; }
      else if (e.target.closest('[data-set-share]')) { setFile(s).then(function (b) { share(b, setName(s)); }); return; }
      else if (e.target.closest('[data-set-ungroup]')) { ungroup(s); }
      else return;
      s._thumb = null; saveProject(); renderGrid(); renderSets(); refreshShowSoon();
    });
    sl.addEventListener('change', function (e) {
      if (e.target.matches('[data-up]')) {
        var ul = e.target.closest('[data-set]'); if (ul) addFiles(e.target.files, { setId: ul.getAttribute('data-set'), stage: e.target.getAttribute('data-up') });
        e.target.value = ''; return;
      }
      var li = e.target.closest('[data-set]'), k = e.target.getAttribute('data-sf'); if (!li || !k) return;
      var s = setById(li.getAttribute('data-set')); if (!s) return;
      s[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
      s._thumb = null; saveProject(); if (k === 'title') renderGrid(); renderSets(); refreshShowSoon();
    });

    // brand
    function brand(k, el, now) { S[k] = el.value; saveSettings(); stills = {}; sets.forEach(function (s) { s._thumb = null; }); if (now) { drawEditor(); drawPreview(); } else brandSoon(); }
    var brandSoon = YB.debounce(function () { drawEditor(); renderSets(); drawPreview(); }, 300);
    [['bShop', 'shop'], ['bHandle', 'handle'], ['bBook', 'book']].forEach(function (a) { $(a[0]).addEventListener('input', function () { brand(a[1], this); }); });
    $('bColor').addEventListener('input', function () { brand('color', this); });
    $('wmPos').addEventListener('change', function () { brand('wmPos', this, true); });
    $('wmStyle').addEventListener('change', function () { brand('wmStyle', this, true); });
    $('logoFile').addEventListener('change', function () {
      var f = this.files[0]; this.value = ''; if (!f || !/^image\//.test(f.type)) return;
      if (logo) delBlob(logo.blobId);
      var id = 'l' + YB.uid(); blobs[id] = f; putBlob(id, f);
      loadImg(f).then(function (im) { logo = { blobId: id, _img: im }; if (S.wmPos === 'off') S.wmPos = 'br'; saveSettings(); saveProject(); stills = {}; renderBrand(); drawEditor(); drawPreview(); });
    });
    $('logoDel').addEventListener('click', function () { if (!logo) return; delBlob(logo.blobId); logo = null; saveProject(); stills = {}; renderBrand(); drawEditor(); drawPreview(); });

    // slideshow
    $('playBtn').addEventListener('click', function () { if (pv.playing) stop(); else play(); });
    $('scrub').addEventListener('input', function () { stop(); pv.t = +this.value / 1000 * segments().total; drawPreview(); });
    $('transSel').innerHTML = TRANS.map(function (t) { return '<option value="' + t[0] + '">' + t[1] + '</option>'; }).join('');
    $('transSel').addEventListener('change', function () { S.trans = this.value; saveSettings(); jumpToTransition(); });
    $('durRange').addEventListener('input', function () { S.dur = +this.value; $('durVal').textContent = S.dur + ' s'; saveSettings(); renderFacts(); drawPreview(); });
    [['kenBurns', 'kenBurns'], ['introOn', 'intro'], ['outroOn', 'outro']].forEach(function (a) { $(a[0]).addEventListener('change', function () { S[a[1]] = this.checked; saveSettings(); renderFacts(); drawPreview(); }); });
    var list = $('slideList');
    list.addEventListener('click', function (e) {
      var li = e.target.closest('[data-slide]'); if (!li) return;
      var i = slides.findIndex(function (s) { return s.id === li.getAttribute('data-slide'); }); if (i < 0) return;
      if (e.target.closest('[data-sl-up]') && i > 0) { var t = slides[i - 1]; slides[i - 1] = slides[i]; slides[i] = t; }
      else if (e.target.closest('[data-sl-down]') && i < slides.length - 1) { var t2 = slides[i + 1]; slides[i + 1] = slides[i]; slides[i] = t2; }
      else if (e.target.closest('[data-sl-del]')) slides.splice(i, 1);
      else if (e.target.closest('[data-sl-repos]')) { slides[i].tx = slides[i].ty = null; }
      else if (e.target.closest('input')) return;
      else if (!e.target.closest('select,button')) { stop(); var tl = segments(), key = slides[i].kind === 'photo' ? 'p:' + slides[i].ref : 's:' + slides[i].ref; var g = tl.segs.find(function (x) { return x.key.indexOf(key) === 0; }); if (g) { pv.t = g.start + Math.min(g.dur * 0.5, 1); drawPreview(); } return; }
      else return;
      saveProject(); renderSlides(); renderFacts(); drawPreview();
    });
    list.addEventListener('input', function (e) {
      if (!e.target.matches('[data-sl-text]')) return;
      var li = e.target.closest('[data-slide]'), sl = slides.find(function (x) { return x.id === li.getAttribute('data-slide'); }); if (!sl) return;
      sl.text = e.target.value; saveProject();
      // show the part with its text while typing
      stop(); var tl = segments(), g = tl.segs.find(function (x) { return x.sl === sl; }); if (g) pv.t = g.start + Math.min(g.dur - 0.1, TR + 0.5);
      drawPreview();
    });
    list.addEventListener('change', function (e) {
      if (e.target.matches('[data-sl-text]')) return;
      if (e.target.id === 'addBack') { var v = e.target.value.split(':'); if (v[1]) { slides.push({ id: YB.uid(), kind: v[0], ref: v[1] }); saveProject(); renderSlides(); renderFacts(); drawPreview(); } return; }
      var li = e.target.closest('[data-slide]'), k = e.target.getAttribute('data-sl'); if (!li || !k) return;
      var s = slides.find(function (x) { return x.id === li.getAttribute('data-slide'); }); if (!s) return;
      s[k] = k === 'dur' ? (e.target.value ? +e.target.value : null) : e.target.value;
      saveProject(); renderFacts(); drawPreview();
    });
    $('musicFile').addEventListener('change', function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      if (music) delBlob(music.blobId);
      var id = 'm' + YB.uid(); blobs[id] = f; putBlob(id, f); music = { blobId: id, name: f.name }; S.musicStart = null; saveSettings();
      if (pv.music) { pv.music.pause(); pv.music.dataset.id = ''; }
      saveProject(); renderSlides(); renderFacts(); analyseMusic();
      YB.toast('Finding the beat…');
    });
    $('musicDel').addEventListener('click', function () { if (!music) return; delBlob(music.blobId); music = null; if (pv.music) { pv.music.pause(); pv.music.dataset.id = ''; } saveProject(); renderSlides(); renderFacts(); drawPreview(); });
    $('exportBtn').addEventListener('click', exportVideo);
    $('fxSel').innerHTML = FX.map(function (f) { return '<option value="' + f[0] + '">' + f[1] + '</option>'; }).join('');
    $('fxSel').addEventListener('change', function () { S.fx = this.value; saveSettings(); stop(); var tl = segments(), g = tl.segs[1] || tl.segs[0]; if (g) { pv.t = Math.max(0, g.start - 0.2); play(); setTimeout(function () { if (pv.playing) stop(); }, 2600); } });
    $('musicVol').addEventListener('input', function () { S.musicVol = +this.value; $('musicVolVal').textContent = this.value + '%'; if (pv.music) pv.music.volume = S.musicVol / 100; saveSettings(); });
    $('musicStart').addEventListener('input', function () { S.musicStart = +this.value; $('musicStartVal').textContent = mmss(S.musicStart); saveSettings(); });
    $('musicStart').addEventListener('change', function () { renderFacts(); if (pv.playing) { stop(); play(); } else drawPreview(); });
    $('musicStartReset').addEventListener('click', function () { S.musicStart = null; saveSettings(); renderMusic(); renderFacts(); drawPreview(); });
    $('beatSync').addEventListener('change', function () { S.beatSync = this.checked; saveSettings(); renderFacts(); drawPreview(); });
    $('cancelBtn').addEventListener('click', function () { if (rec) rec.cancelled = true; });
    $('shareVideoBtn').addEventListener('click', function () { if (lastVideoBlob) share(lastVideoBlob, $('downloadBtn').download); });
    $('zipBtn').addEventListener('click', downloadAll);
    $('fullBtn').addEventListener('click', openFull);
    $('fullVideoBtn').addEventListener('click', function () { var v = $('resultVideo'); if (!v.src || !window.YB.full) return; YB.full.open({ stage: v }); v.play().catch(function () {}); });
    $('saveAllBtn').addEventListener('click', saveAllPhotos);
    window.addEventListener('resize', YB.debounce(function () { sizeEditor(); drawEditor(); sizePreview(); drawPreview(); }, 150));
    wireEditorPointer(); wirePreviewPointer();
  }
  function showTextPart(animate) {   // jump to the first part that has text so the change can be seen
    var tl = segments(), g = tl.segs.find(function (x) { return x.sl && x.sl.text; });
    stop(); if (!g) { drawPreview(); return; }
    if (animate) { pv.t = g.start + TR * 0.4; play(); setTimeout(function () { if (pv.playing) stop(); }, 1600); }
    else { pv.t = g.start + Math.min(g.dur - 0.1, TR + 0.5); drawPreview(); }
  }
  function jumpToTransition() {   // show the new transition straight away
    stop(); var tl = segments(), g = tl.segs[1] || tl.segs[0]; if (!g) return;
    pv.t = Math.max(0, g.start - 0.3); play();
    setTimeout(function () { if (pv.playing && pv.t > g.start + TR + 0.4) stop(); }, (TR + 0.8) * 1000);
  }

  /* ---------- Start ---------- */
  function restore() {
    return kv('readonly', function (st, out) { var r = st.get('project'); r.onsuccess = function () { out.v = r.result; }; }).then(function (data) {
      if (!data) { if (!S.naturalDefault) { S.naturalDefault = true; saveSettings(); } return; }
      var ids = (data.photos || []).map(function (p) { return p.blobId; });
      if (data.music) ids.push(data.music.blobId);
      if (data.logo) ids.push(data.logo.blobId);
      return Promise.all(ids.map(function (id) { return getBlob(id).then(function (b) { if (b) blobs[id] = b; }); })).then(function () {
        photos = (data.photos || []).filter(function (p) { return blobs[p.blobId]; });
        // one time: photos that only had the old automatic look (Pro clean + auto-fix, never changed) go back to natural
        if (!S.naturalDefault) { photos.forEach(function (p) { if (p.look === 'clean' && p.auto === true && !Object.keys(p.adj || {}).length) { p.look = 'natural'; p.auto = false; } }); S.naturalDefault = true; saveSettings(); unsaved = true; saveSoon(); }
        photos.forEach(function (p) { p.f = Object.assign(defaultFrame(), p.f); p.adj = p.adj || {}; if (p.label === 'Before' || p.label === 'After') { p.stage = p.label.toLowerCase(); p.label = ''; } p.stage = p.stage || ''; });
        sets = (data.sets || []).map(function (s) { s.ids = s.ids.filter(photoById); return s; });
        slides = data.slides || [];
        music = data.music && blobs[data.music.blobId] ? data.music : null;
        if (music) setTimeout(analyseMusic, 0);
        cur = photos.length ? photos[0].id : '';
        var lp = data.logo && blobs[data.logo.blobId] ? loadImg(blobs[data.logo.blobId]).then(function (im) { logo = { blobId: data.logo.blobId, _img: im }; }, function () {}) : Promise.resolve();
        return Promise.all([lp].concat(photos.map(function (p) { return ensureImg(p).catch(function () {}); })));
      });
    });
  }
  window.YBShowcase = {   // used by tests
    music: function () { return music ? { bpm: music.bpm, first: music.first, start: songStart(), synced: synced() } : null; },
    state: function () { return { S: S, photos: photos.map(clean), sets: sets.map(clean), slides: slides.map(clean), cur: cur, total: segments().total }; },
    segments: function () { return segments().segs.map(function (g) { return { key: g.key, start: g.start, dur: g.dur, trans: transFor(g) }; }); },
    frame: function (t) { var c = $('preview'); stop(); pv.t = t; drawPreview(); return c.toDataURL('image/jpeg', 0.8); },
    photoData: function (i, w, h) { var p = photos[i]; return ensureImg(p).then(function () { return renderPhoto(p, w, h, { brand: true, chip: true }).toDataURL('image/jpeg', 0.9); }); },
    setData: function (i, w, h) { var s = sets[i]; return Promise.all(setPhotos(s).map(ensureImg)).then(function () { return renderSet(s, w, h, { brand: true }).toDataURL('image/jpeg', 0.9); }); }
  };
  wire();
  restore().then(function () { renderAll(); thumbsSoon(); });
})();
