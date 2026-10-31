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
    ig45: { w: 1080, h: 1350, name: 'Instagram post', sub: '4:5 · best for feed', ar: 'portrait' },
    square: { w: 1080, h: 1080, name: 'Square', sub: '1:1 · theCut, Instagram', ar: 'square' },
    story: { w: 1080, h: 1920, name: 'Story / Reel', sub: '9:16 · Reels, TikTok, Shorts', ar: 'short' },
    p34: { w: 1080, h: 1440, name: 'Portrait', sub: '3:4 · photo apps', ar: 'p34' },
    wide: { w: 1920, h: 1080, name: 'Wide', sub: '16:9 · YouTube, Facebook', ar: 'long' }
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

  var S = Object.assign({ format: 'ig45', trans: 'mix', dur: 2.5, kenBurns: true, intro: true, outro: true,
    shop: '', handle: '', book: '', color: '#e11d48', wmPos: 'br', wmStyle: 'tag' }, YB.store.get('scSettings', {}));
  if (!FORMATS[S.format]) S.format = 'ig45';
  var photos = [], sets = [], slides = [], blobs = {}, imgs = {}, music = null, logo = null;
  var cur = '', selecting = false, picked = [], rec = null, lastVideo = null;

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function saveSettings() { YB.store.set('scSettings', S); }
  function dims() { var f = FORMATS[S.format]; return { W: f.w, H: f.h }; }
  function photoById(id) { return photos.find(function (p) { return p.id === id; }); }
  function setById(id) { return sets.find(function (s) { return s.id === id; }); }
  function setOf(pid) { return sets.find(function (s) { return s.ids.indexOf(pid) !== -1; }); }
  function photoNo(p) { return photos.indexOf(p) + 1; }
  function stageName(p) { return p.stage === 'before' ? 'Before' : p.stage === 'after' ? 'After' : ''; }
  // What a photo says on itself: "BEFORE · SIDE", "AFTER", "FRONT"…
  function chipText(p, withAngle) { return [stageName(p), withAngle === false ? '' : p.label].filter(Boolean).join(' · '); }
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
    if (opts.chip && S.showStage !== false && chipText(p)) labelChip(x, W, H, p, chipText(p));
    if (opts.brand) drawBrand(x, W, H);
    return c;
  }

  /* ---------- Brand ---------- */
  function brandText() { return [S.handle, S.shop].filter(Boolean)[0] || ''; }
  function rr(x, X, Y, w, h, r) { r = Math.min(r, w / 2, h / 2); x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }
  var FONT = '"Arial Black", "Segoe UI Black", system-ui, -apple-system, sans-serif', FONT2 = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  function drawBrand(x, W, H) {
    var txt = brandText(), lim = logo && logo._img && logo._img.naturalWidth ? logo._img : null;
    if (S.wmPos === 'off' || (!txt && !lim)) return;
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
      var lab = [S.showStage !== false ? stageName(p) : '', s.labels !== false ? p.label : ''].filter(Boolean).join(' · ');
      if (lab) {
        var fs = Math.round(base * (cs.length > 3 ? 0.026 : 0.032)), pd = fs * 0.55;
        tag(x, r.x + pd, r.y + pd + (s.title && r.y < base * 0.12 ? base * 0.1 : 0), fs, p, lab);
      }
    });
    if (s.title) {
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
    var big = kind === 'intro' ? (S.shop || S.handle || 'Fresh cuts') : 'Book now', small1 = kind === 'intro' ? (S.shop && S.handle ? S.handle : 'Fresh cuts · clean lines') : (S.book || 'Link in bio'), small2 = kind === 'intro' ? '' : (S.handle || S.shop || '');
    fit(x, big.toUpperCase(), '900 {s}px ' + FONT, base * 0.1, W * 0.86); x.fillText(big.toUpperCase(), W / 2, y);
    x.fillStyle = col; x.fillRect(W / 2 - base * 0.08, y + base * 0.075, base * 0.16, Math.max(3, base * 0.008));
    x.fillStyle = 'rgba(255,255,255,0.88)'; fit(x, small1, '700 {s}px ' + FONT2, base * 0.045, W * 0.86); x.fillText(small1, W / 2, y + base * 0.15);
    if (small2) { x.fillStyle = 'rgba(255,255,255,0.7)'; fit(x, small2, '600 {s}px ' + FONT2, base * 0.038, W * 0.86); x.fillText(small2, W / 2, y + base * 0.225); }
    return c;
  }
  function fit(x, t, css, size, max) { var s = size; do { x.font = css.replace('{s}', Math.round(s)); s *= 0.92; } while (x.measureText(t).width > max && s > 8); }
  function hexA(h, a) { var n = parseInt(String(h).slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }

  /* ---------- Slideshow timeline ---------- */
  function segments() {
    var segs = [];
    if (S.intro) segs.push({ key: 'intro', dur: INTRO, card: 'intro' });
    slides.forEach(function (sl) {
      var dur = sl.dur || S.dur;
      if (sl.kind === 'photo') { var p = photoById(sl.ref); if (p) segs.push({ key: 'p:' + p.id, dur: dur, photo: p, trans: sl.trans }); }
      else {
        var s = setById(sl.ref); if (!s || !s.ids.length) return;
        if (s.show === 'each') setPhotos(s).forEach(function (p, i) { segs.push({ key: 's:' + s.id + ':' + p.id, dur: Math.max(1.2, dur * 0.75), photo: p, angle: s.labels !== false, trans: i ? 'slide' : sl.trans }); });
        else segs.push({ key: 's:' + s.id, dur: dur + 0.8, set: s, trans: sl.trans });
      }
    });
    if (S.outro) segs.push({ key: 'outro', dur: OUTRO, card: 'outro' });
    var t = 0; segs.forEach(function (g, i) { g.start = t; t += g.dur; g.i = i; });
    return { segs: segs, total: t };
  }
  var stills = {};   // key|W|H|version → canvas
  function stillFor(g, W, H) {
    var k = g.key + '|' + W + 'x' + H + '|' + (g.photo ? verOf(g.photo) : g.set ? verOfSet(g.set) : brandVer());
    if (stills[k]) return stills[k];
    var c = g.card ? renderCard(g.card, W, H) : g.set ? renderSet(g.set, W, H) : renderPhoto(g.photo, W, H);
    var lab = g.photo ? chipText(g.photo, g.angle === true) : '';
    if (lab && S.showStage !== false) labelChip(c.getContext('2d'), W, H, g.photo, lab);
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
  function verOf(p) { return JSON.stringify([p.f, p.look, p.adj, p.auto, p.stage, p.label, S.showStage, S.color]); }
  function verOfSet(s) { return JSON.stringify([s.layout, s.labels, s.title, s.ids.map(function (id) { var p = photoById(id); return p ? verOf(p) + p.label : ''; }), S.color]); }
  function brandVer() { return JSON.stringify([S.shop, S.handle, S.book, S.color, logo && logo.blobId]); }
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
  function renderFrame(x, W, H, t, tl) {
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
    if (!g.card) drawBrand(x, W, H);   // your name stays put on every photo (not on the intro / outro cards)
  }

  /* ---------- Preview player ---------- */
  var pv = { t: 0, playing: false, raf: 0, t0: 0, music: null };
  function previewSize() {
    var d = dims(), s = Math.min(360 / d.W, 520 / d.H);
    return { w: Math.round(d.W * s), h: Math.round(d.H * s) };
  }
  function sizePreview() {
    var c = $('preview'), ps = previewSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(ps.w * dpr); c.height = Math.round(ps.h * dpr); c.style.width = ps.w + 'px'; c.style.aspectRatio = ps.w + ' / ' + ps.h;
  }
  function drawPreview() {
    var c = $('preview'); if (!c) return;
    var x = c.getContext('2d'), tl = segments();
    renderFrame(x, c.width, c.height, pv.t, tl);
    $('scrub').value = tl.total ? Math.round(pv.t / tl.total * 1000) : 0;
    $('timeLabel').textContent = mmss(pv.t) + ' / ' + mmss(tl.total);
    trimStills();
  }
  function play() {
    var tl = segments(); if (!tl.segs.length || rec) return;
    if (pv.t >= tl.total - 0.05) pv.t = 0;
    pv.playing = true; setPlayBtn(true); pv.t0 = performance.now() - pv.t * 1000;
    if (music) { pv.music = pv.music || new Audio(); if (pv.music.dataset.id !== music.blobId) { pv.music.src = URL.createObjectURL(blobs[music.blobId]); pv.music.dataset.id = music.blobId; } pv.music.loop = true; try { pv.music.currentTime = pv.t; } catch (e) { /* not ready */ } pv.music.play().catch(function () {}); }
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
  function addFiles(files) {
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
          var p = { id: id, blobId: blobId, name: f.name, w: n.w, h: n.h, f: defaultFrame(), look: 'clean', adj: {}, auto: true, label: '', stage: '' };
          photos.push(p); slides.push({ id: YB.uid(), kind: 'photo', ref: id });
          added++;
          return putBlob(blobId, n.blob).then(function () { return ensureImg(p); });
        }, function () { bad.push(f.name); });
      });
    });
    chain.then(function () {
      if (bad.length) { $('importNote').hidden = false; $('importNote').textContent = 'This browser couldn\'t open ' + bad.join(', ') + '. iPhone "HEIC" photos open in Safari; elsewhere, save them as JPG (or set the camera to "Most Compatible") and add them again.'; }
      if (added && !photoById(cur)) cur = photos[photos.length - added].id;
      saveProject(); renderAll(); thumbsSoon();
      if (added) YB.toast('Added ' + added + ' photo' + (added === 1 ? '' : 's'));
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
      if (thumbQueue.length) setTimeout(runThumbs, 0); else { renderSets(); }
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
      var s = setOf(p.id), pk = picked.indexOf(p.id);
      return '<li class="sc-ph' + (p.id === cur ? ' on' : '') + (pk !== -1 ? ' picked' : '') + '" data-id="' + p.id + '">' +
        '<button type="button" class="sc-thumb" data-open aria-label="Edit photo ' + (i + 1) + '" style="aspect-ratio:' + thumbW() + '/' + thumbH() + '">' +
        (p._thumb ? '<img data-thumb="' + p.id + '" src="' + p._thumb + '" alt="">' : '<img data-thumb="' + p.id + '" alt="">') +
        '<span class="sc-n">' + (i + 1) + '</span>' + (pk !== -1 ? '<span class="sc-pick">' + (pk + 1) + '</span>' : '') +
        (p.stage ? '<span class="sc-stage-badge ' + p.stage + '">' + stageName(p).toUpperCase() + '</span>' : '') +
        (s ? '<span class="sc-inset">👤 ' + YB.esc(s.title || 'Client ' + (sets.indexOf(s) + 1)) + '</span>' : '') + '</button>' +
        '<div class="sc-ba" role="group" aria-label="Before or after, photo ' + (i + 1) + '">' + STAGES.map(function (st) { return '<button type="button" data-stage="' + st[0] + '" class="' + st[0] + (p.stage === st[0] ? ' on' : '') + '" aria-pressed="' + (p.stage === st[0]) + '">' + st[1] + '</button>'; }).join('') + '</div>' +
        '<div class="sc-ph-ctl"><select data-label aria-label="Shot ' + (i + 1) + '">' + LABELS.map(function (l) { return '<option value="' + l + '"' + (l === p.label ? ' selected' : '') + '>' + (l || 'Angle…') + '</option>'; }).join('') + '</select>' +
        '<span class="sc-ph-btns"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-left aria-label="Move earlier"' + (i ? '' : ' disabled') + '>‹</button>' +
        '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-right aria-label="Move later"' + (i < photos.length - 1 ? '' : ' disabled') + '>›</button>' +
        '<button type="button" class="btn btn-danger btn-icon btn-sm" data-del aria-label="Remove photo ' + (i + 1) + '">✕</button></span></div></li>';
    }).join('');
    $('formatGroup').hidden = $('bulkRow').hidden = !photos.length;
    $('selBar').hidden = !selecting;
    $('selectModeBtn').setAttribute('aria-pressed', selecting); $('selectModeBtn').classList.toggle('on', selecting);
    $('makeSetBtn').disabled = picked.length < 2;
    $('selText').textContent = picked.length ? picked.length + ' picked — ' + (picked.length < 2 ? 'pick the before and after shots of this client' : 'ready') : 'Tap the photos of one client — before and after shots, in order';
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
    if (!sets.length) { $('setList').innerHTML = '<li class="muted small fm-empty">No sets yet.</li>'; return; }
    var d = dims();
    $('setList').innerHTML = sets.map(function (s, si) {
      var ps = setPhotos(s);
      return '<li class="sc-set" data-set="' + s.id + '">' +
        '<div class="sc-set-top"><img class="sc-set-prev" data-setprev="' + s.id + '" alt="Set ' + (si + 1) + ' preview" style="aspect-ratio:' + d.W + '/' + d.H + '"' + (s._thumb ? ' src="' + s._thumb + '"' : '') + '>' +
        '<div class="sc-set-meta"><label class="field"><span>Client or cut (shown on top — optional)</span><input type="text" data-sf="title" maxlength="40" value="' + YB.esc(s.title || '') + '" placeholder="e.g. Marcus · skin fade + beard"></label>' +
        '<div class="sc-set-photos">' + ps.map(function (p, i) { return '<span class="sc-chip"><img data-sthumb="' + p.id + '" src="' + (p._thumb || '') + '" alt=""><b>' + (i + 1) + '</b> ' + (p.stage ? '<em class="sc-stage-badge ' + p.stage + '">' + stageName(p) + '</em> ' : '') + YB.esc(p.label || (p.stage ? '' : 'Photo ' + photoNo(p))) +
          '<button type="button" class="sc-x" data-sp-left="' + p.id + '" aria-label="Earlier"' + (i ? '' : ' disabled') + '>‹</button><button type="button" class="sc-x" data-sp-del="' + p.id + '" aria-label="Take out of the set">✕</button></span>'; }).join('') + '</div></div></div>' +
        '<div class="label" style="margin-top:10px">Layout</div><div class="seg sc-seg" role="radiogroup">' + LAYOUTS.map(function (l) { return '<button type="button" role="radio" data-layout="' + l[0] + '" class="' + (s.layout === l[0] ? 'on' : '') + '" aria-checked="' + (s.layout === l[0]) + '">' + l[1] + '</button>'; }).join('') + '</div>' +
        '<div class="row" style="gap:14px;margin-top:10px;flex-wrap:wrap">' +
        '<label class="cx-switch"><input type="checkbox" data-sf="labels"' + (s.labels ? ' checked' : '') + '> Show angles too (FRONT / SIDE / BACK)</label>' +
        '<label class="field" style="min-width:180px"><span>In the slideshow</span><select data-sf="show"><option value="collage"' + (s.show !== 'each' ? ' selected' : '') + '>As one collage</option><option value="each"' + (s.show === 'each' ? ' selected' : '') + '>One shot after another</option></select></label></div>' +
        '<div class="row" style="gap:6px;margin-top:10px"><button type="button" class="btn btn-sm" data-set-dl>⬇ Download collage</button><button type="button" class="btn btn-ghost btn-sm" data-set-share hidden>📤 Share</button><button type="button" class="btn btn-ghost btn-sm" data-set-ungroup>Ungroup</button></div></li>';
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
  function makeSet() {
    if (picked.length < 2) return;
    // a photo belongs to one set at a time
    sets.forEach(function (s) { s.ids = s.ids.filter(function (id) { return picked.indexOf(id) === -1; }); });
    sets = sets.filter(function (s) { if (s.ids.length < 2) { slides = slides.filter(function (sl) { return sl.ref !== s.id; }); s.ids.forEach(function (id) { if (!slides.some(function (sl) { return sl.ref === id; })) slides.push({ id: YB.uid(), kind: 'photo', ref: id }); }); return false; } return true; });
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
    picked = []; selecting = false;
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
        '<select data-sl="dur" aria-label="How long">' + durs.replace('value="' + (sl.dur || '') + '"', 'value="' + (sl.dur || '') + '" selected') + '</select></span></div>' +
        '<span class="cx-pbtns"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-sl-up aria-label="Earlier"' + (i ? '' : ' disabled') + '>↑</button><button type="button" class="btn btn-ghost btn-icon btn-sm" data-sl-down aria-label="Later"' + (i < slides.length - 1 ? '' : ' disabled') + '>↓</button><button type="button" class="btn btn-ghost btn-icon btn-sm" data-sl-del aria-label="Leave out of the slideshow">✕</button></span></li>';
    }).join('') + (missing.length ? '<li class="sc-addback"><select id="addBack" aria-label="Add back"><option value="">＋ Put back in the slideshow…</option>' + missing.map(function (m) { return '<option value="' + m[0] + ':' + m[1] + '">' + YB.esc(m[2]) + '</option>'; }).join('') + '</select></li>' : '');
    $('transSel').value = S.trans; $('durRange').value = S.dur; $('durVal').textContent = S.dur + ' s';
    $('kenBurns').checked = !!S.kenBurns; $('introOn').checked = !!S.intro; $('outroOn').checked = !!S.outro;
    $('musicName').textContent = music ? '🎵 ' + music.name : 'No music'; $('musicDel').hidden = !music;
  }
  function renderFacts() {
    var tl = segments(), d = dims();
    $('facts').innerHTML = photos.length ? '<span><b>' + photos.length + '</b> photo' + (photos.length === 1 ? '' : 's') + '</span>' + (sets.length ? '<span><b>' + sets.length + '</b> set' + (sets.length === 1 ? '' : 's') + '</span>' : '') + '<span><b>' + mmss(tl.total) + '</b> video</span><span><b>' + d.W + '×' + d.H + '</b></span>' + (music ? '<span>🎵 music</span>' : '') : '';
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
    $('wmPos').value = S.wmPos; $('wmStyle').value = S.wmStyle; $('showStage').checked = S.showStage !== false;
    $('logoPrev').hidden = $('logoDel').hidden = !logo;
    if (logo && logo._img) $('logoPrev').src = logo._img.src;
  }
  function renderAll() { renderFormats(); renderGrid(); renderEditor(); renderSets(); renderSlides(); renderBrand(); renderSteps(); renderFacts(); sizePreview(); if (!pv.playing) drawPreview(); }

  /* ---------- Downloads ---------- */
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40); }
  function toBlob(c) { return new Promise(function (res) { c.toBlob(res, 'image/jpeg', 0.93); }); }
  function photoFile(p) { var d = dims(); return ensureImg(p).then(function () { return toBlob(renderPhoto(p, d.W, d.H, { brand: true, chip: true })); }); }
  function setFile(s) { var d = dims(); return Promise.all(setPhotos(s).map(ensureImg)).then(function () { return toBlob(renderSet(s, d.W, d.H, { brand: true })); }); }
  function photoName(p) { return String(photoNo(p)).padStart(2, '0') + (chipText(p) ? '-' + slug(chipText(p)) : '') + '-' + S.format + '.jpg'; }
  function setName(s) { return 'set-' + (sets.indexOf(s) + 1) + (s.title ? '-' + slug(s.title) : '') + '-' + S.format + '.jpg'; }
  function save(blob, name) { var url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 4000); }
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
    var dec = new AC();
    return blobs[music.blobId].arrayBuffer().then(function (buf) {
      return new Promise(function (res) { var p = dec.decodeAudioData(buf, res, function () { res(null); }); if (p && p.then) p.then(res, function () { res(null); }); });
    }).then(function (b) {
      try { dec.close(); } catch (e) { /* closed */ }
      if (!b) return null;
      var off = new Off(2, Math.ceil(T * 48000), 48000), src = off.createBufferSource(), g = off.createGain();
      src.buffer = b; src.loop = true; src.connect(g); g.connect(off.destination);
      g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(1, 0.3); g.gain.setValueAtTime(1, Math.max(0.31, T - 1.6)); g.gain.linearRampToValueAtTime(0, T);
      src.start(0); return off.startRendering();
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
        sets.filter(function (s) { return s.ids.length < 2; }).forEach(ungroup);
        slides = slides.filter(function (sl) { return sl.ref !== id; }); picked = picked.filter(function (x) { return x !== id; });
        if (cur === id) cur = (photos[i] || photos[i - 1] || {}).id || '';
      } else if (e.target.closest('[data-left]') && i > 0) { var t = photos[i - 1]; photos[i - 1] = photos[i]; photos[i] = t; }
      else if (e.target.closest('[data-right]') && i < photos.length - 1) { var t2 = photos[i + 1]; photos[i + 1] = photos[i]; photos[i] = t2; }
      else if (e.target.closest('[data-open]')) {
        if (selecting) { var k = picked.indexOf(id); if (k === -1) picked.push(id); else picked.splice(k, 1); renderGrid(); return; }
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
    $('selectModeBtn').addEventListener('click', function () { selecting = !selecting; picked = []; renderGrid(); if (selecting) YB.toast('Tap the before and after shots of one client'); });
    $('cancelSelBtn').addEventListener('click', function () { selecting = false; picked = []; renderGrid(); });
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
    $('showStage').addEventListener('change', function () { S.showStage = this.checked; saveSettings(); stills = {}; photos.forEach(function (p) { p._thumb = null; }); sets.forEach(function (s) { s._thumb = null; }); drawEditor(); thumbsSoon(); drawPreview(); });
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
    $('dlPhotoBtn').addEventListener('click', function () { var p = photoById(cur); if (p) photoFile(p).then(function (b) { save(b, photoName(p)); }); });
    $('sharePhotoBtn').hidden = !navigator.canShare;
    $('sharePhotoBtn').addEventListener('click', function () { var p = photoById(cur); if (p) photoFile(p).then(function (b) { share(b, photoName(p)); }); });

    // sets
    var sl = $('setList');
    sl.addEventListener('click', function (e) {
      var li = e.target.closest('[data-set]'); if (!li) return;
      var s = setById(li.getAttribute('data-set')); if (!s) return;
      var lb = e.target.closest('[data-layout]'), sp;
      if (lb) { s.layout = lb.getAttribute('data-layout'); }
      else if ((sp = e.target.closest('[data-sp-del]'))) { var id = sp.getAttribute('data-sp-del'); s.ids = s.ids.filter(function (x) { return x !== id; }); slides.push({ id: YB.uid(), kind: 'photo', ref: id }); if (s.ids.length < 2) ungroup(s); }
      else if ((sp = e.target.closest('[data-sp-left]'))) { var j = s.ids.indexOf(sp.getAttribute('data-sp-left')); if (j > 0) { var t = s.ids[j - 1]; s.ids[j - 1] = s.ids[j]; s.ids[j] = t; } }
      else if (e.target.closest('[data-set-dl]')) { setFile(s).then(function (b) { save(b, setName(s)); }); return; }
      else if (e.target.closest('[data-set-share]')) { setFile(s).then(function (b) { share(b, setName(s)); }); return; }
      else if (e.target.closest('[data-set-ungroup]')) { ungroup(s); }
      else return;
      s._thumb = null; saveProject(); renderGrid(); renderSets(); refreshShowSoon();
    });
    sl.addEventListener('change', function (e) {
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
      else if (!e.target.closest('select,button')) { stop(); var tl = segments(), key = slides[i].kind === 'photo' ? 'p:' + slides[i].ref : 's:' + slides[i].ref; var g = tl.segs.find(function (x) { return x.key.indexOf(key) === 0; }); if (g) { pv.t = g.start + Math.min(g.dur * 0.5, 1); drawPreview(); } return; }
      else return;
      saveProject(); renderSlides(); renderFacts(); drawPreview();
    });
    list.addEventListener('change', function (e) {
      if (e.target.id === 'addBack') { var v = e.target.value.split(':'); if (v[1]) { slides.push({ id: YB.uid(), kind: v[0], ref: v[1] }); saveProject(); renderSlides(); renderFacts(); drawPreview(); } return; }
      var li = e.target.closest('[data-slide]'), k = e.target.getAttribute('data-sl'); if (!li || !k) return;
      var s = slides.find(function (x) { return x.id === li.getAttribute('data-slide'); }); if (!s) return;
      s[k] = k === 'dur' ? (e.target.value ? +e.target.value : null) : e.target.value;
      saveProject(); renderFacts(); drawPreview();
    });
    $('musicFile').addEventListener('change', function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      if (music) delBlob(music.blobId);
      var id = 'm' + YB.uid(); blobs[id] = f; putBlob(id, f); music = { blobId: id, name: f.name };
      saveProject(); renderSlides(); renderFacts();
    });
    $('musicDel').addEventListener('click', function () { if (!music) return; delBlob(music.blobId); music = null; if (pv.music) pv.music.pause(); saveProject(); renderSlides(); renderFacts(); });
    $('exportBtn').addEventListener('click', exportVideo);
    $('cancelBtn').addEventListener('click', function () { if (rec) rec.cancelled = true; });
    $('shareVideoBtn').addEventListener('click', function () { if (lastVideoBlob) share(lastVideoBlob, $('downloadBtn').download); });
    $('zipBtn').addEventListener('click', downloadAll);
    window.addEventListener('resize', YB.debounce(function () { sizeEditor(); drawEditor(); sizePreview(); drawPreview(); }, 150));
    wireEditorPointer();
  }
  function jumpToTransition() {   // show the new transition straight away
    stop(); var tl = segments(), g = tl.segs[1] || tl.segs[0]; if (!g) return;
    pv.t = Math.max(0, g.start - 0.3); play();
    setTimeout(function () { if (pv.playing && pv.t > g.start + TR + 0.4) stop(); }, (TR + 0.8) * 1000);
  }

  /* ---------- Start ---------- */
  function restore() {
    return kv('readonly', function (st, out) { var r = st.get('project'); r.onsuccess = function () { out.v = r.result; }; }).then(function (data) {
      if (!data) return;
      var ids = (data.photos || []).map(function (p) { return p.blobId; });
      if (data.music) ids.push(data.music.blobId);
      if (data.logo) ids.push(data.logo.blobId);
      return Promise.all(ids.map(function (id) { return getBlob(id).then(function (b) { if (b) blobs[id] = b; }); })).then(function () {
        photos = (data.photos || []).filter(function (p) { return blobs[p.blobId]; });
        photos.forEach(function (p) { p.f = Object.assign(defaultFrame(), p.f); p.adj = p.adj || {}; if (p.label === 'Before' || p.label === 'After') { p.stage = p.label.toLowerCase(); p.label = ''; } p.stage = p.stage || ''; });
        sets = (data.sets || []).map(function (s) { s.ids = s.ids.filter(photoById); return s; }).filter(function (s) { return s.ids.length >= 2; });
        slides = data.slides || [];
        music = data.music && blobs[data.music.blobId] ? data.music : null;
        cur = photos.length ? photos[0].id : '';
        var lp = data.logo && blobs[data.logo.blobId] ? loadImg(blobs[data.logo.blobId]).then(function (im) { logo = { blobId: data.logo.blobId, _img: im }; }, function () {}) : Promise.resolve();
        return Promise.all([lp].concat(photos.map(function (p) { return ensureImg(p).catch(function () {}); })));
      });
    });
  }
  window.YBShowcase = {   // used by tests
    state: function () { return { S: S, photos: photos.map(clean), sets: sets.map(clean), slides: slides.map(clean), cur: cur, total: segments().total }; },
    segments: function () { return segments().segs.map(function (g) { return { key: g.key, start: g.start, dur: g.dur, trans: transFor(g) }; }); },
    frame: function (t) { var c = $('preview'); stop(); pv.t = t; drawPreview(); return c.toDataURL('image/jpeg', 0.8); },
    photoData: function (i, w, h) { var p = photos[i]; return ensureImg(p).then(function () { return renderPhoto(p, w, h, { brand: true, chip: true }).toDataURL('image/jpeg', 0.9); }); },
    setData: function (i, w, h) { var s = sets[i]; return Promise.all(setPhotos(s).map(ensureImg)).then(function () { return renderSet(s, w, h, { brand: true }).toDataURL('image/jpeg', 0.9); }); }
  };
  wire();
  restore().then(function () { renderAll(); thumbsSoon(); });
})();
