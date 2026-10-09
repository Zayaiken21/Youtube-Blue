/* =========================================================
   Youtube Blue — formatter.js · Video Formatter
   1. Import videos → trim, split, reorder, zoom / move the picture per clip.
   2. Format for YouTube (Short 9:16, long form 16:9, square, 4:5) with a
      background (blur, colours, gradients, your image) and a frame style.
   3. Overlays: text, emoji, logo / picture, subscribe button, progress bar —
      drag to move, drag the corner to resize, edit text, style, timing, animation.
   4. Export an MP4. Each clip plays once while its frames are captured with their
      exact time (requestVideoFrameCallback + WebCodecs); the sound is mixed on the
      device and packed alongside, so picture and sound stay locked together.
      Browsers without that use the real-time recorder, driven by the audio clock.
   Everything stays on this device (IndexedDB "youtube-blue-formatter").
   ========================================================= */
(function () {
  'use strict';

  var FORMATS = {
    short: { w: 1080, h: 1920, name: 'Short', sub: '9:16 · 1080×1920', ico: '📱' },
    long: { w: 1920, h: 1080, name: 'Long form', sub: '16:9 · 1920×1080', ico: '🖥️' },
    square: { w: 1080, h: 1080, name: 'Square', sub: '1:1 · 1080×1080', ico: '⬛' },
    portrait: { w: 1080, h: 1350, name: 'Portrait', sub: '4:5 · 1080×1350', ico: '🖼️' }
  };
  var BGS = [
    ['blur', 'Blurred video'], ['black', 'Black'], ['white', 'White'], ['color', 'Your colour'],
    ['sunset', 'Sunset', ['#ff7e5f', '#feb47b']], ['ocean', 'Ocean', ['#2193b0', '#6dd5ed']], ['night', 'Night', ['#0f2027', '#2c5364']],
    ['candy', 'Candy', ['#ee9ca7', '#ffdde1']], ['brand', 'Blue → violet', ['#1e7bff', '#a855f7']], ['image', 'Your image']
  ];
  var FRAMES = [['none', 'None'], ['rounded', 'Rounded'], ['border', 'Border'], ['polaroid', 'Photo card'], ['neon', 'Neon'], ['film', 'Film strip'], ['tv', 'TV']];
  var FONTS = {
    bold: { name: 'Bold', css: '900 {s}px "Arial Black", "Segoe UI Black", Impact, system-ui, sans-serif' },
    impact: { name: 'Impact', css: '400 {s}px Impact, "Haettenschweiler", "Arial Narrow Bold", "Arial Black", sans-serif' },
    clean: { name: 'Clean', css: '700 {s}px system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif' },
    serif: { name: 'Serif', css: '700 {s}px Georgia, "Times New Roman", serif' },
    mono: { name: 'Typewriter', css: '700 {s}px "Courier New", Courier, monospace' },
    fun: { name: 'Fun', css: '700 {s}px "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive' }
  };
  var STYLES = [['outline', 'White with outline'], ['shadow', 'Soft shadow'], ['box', 'On a box'], ['neon', 'Neon glow'], ['plain', 'Plain']];
  var ANIMS = [['none', 'None'], ['fade', 'Fade'], ['pop', 'Pop'], ['slide', 'Slide up'], ['type', 'Type out']];
  var FPS = 30, ANIM_T = 0.35, FADE_T = 0.3;

  var S = Object.assign({ format: 'short', fit: 'fit', bg: 'blur', bgColor: '#0b1530', frame: 'none', frameColor: '#ffffff', transition: 'cut', pad: 0, musicVol: 25 },
    (window.YB && YB.store.get('fmSettings', {})) || {});
  var clips = [], overlays = [], blobs = {}, music = null, bgImage = null;
  var sel = '', moveVideo = false, rec = null, lastVideo = null;

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function mmss(s) { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function secs(s) { return (Math.round((s || 0) * 10) / 10).toFixed(1); }
  function saveSettings() { YB.store.set('fmSettings', S); }

  /* ---------- Storage (IndexedDB) ---------- */
  var DB = 'youtube-blue-formatter';
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
  function putBlob(id, blob) { return kv('readwrite', function (st) { st.put(blob, 'blob:' + id); }); }
  function getBlob(id) { return kv('readonly', function (st, out) { var r = st.get('blob:' + id); r.onsuccess = function () { out.v = r.result; }; }); }
  function delBlob(id) { return kv('readwrite', function (st) { st.delete('blob:' + id); }); }
  function blobUrl(id) { var b = blobs[id]; return b ? b.url : ''; }
  function addBlob(id, blob) { if (blobs[id] && blobs[id].url) URL.revokeObjectURL(blobs[id].url); blobs[id] = { blob: blob, url: URL.createObjectURL(blob) }; }

  var unsaved = false, saveSoon = YB.debounce(saveNow, 400);
  function saveProject() { unsaved = true; saveSoon(); }
  document.addEventListener('visibilitychange', function () { if (document.hidden && unsaved) saveNow(); });
  window.addEventListener('pagehide', function () { if (unsaved) saveNow(); });
  function saveNow() {
    if (!unsaved) return;
    unsaved = false;
    var data = {
      clips: clips.map(function (c) { return { id: c.id, name: c.name, blobId: c.blobId, dur: c.dur, vw: c.vw, vh: c.vh, in: c.in, out: c.out, vol: c.vol, mute: c.mute, zoom: c.zoom, ox: c.ox, oy: c.oy, audio: c.audio }; }),
      overlays: overlays.map(function (o) { var x = {}; Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') x[k] = o[k]; }); return x; }),
      music: music ? { blobId: music.blobId, name: music.name } : null,
      bgImage: bgImage ? { blobId: bgImage.blobId } : null
    };
    kv('readwrite', function (st) { st.put(data, 'project'); });
  }

  /* ---------- Timeline ---------- */
  function clipLen(c) { return Math.max(0.1, c.out - c.in); }
  function timeline() {
    var starts = [], t = 0;
    clips.forEach(function (c) { starts.push(t); t += clipLen(c); });
    return { starts: starts, total: t };
  }
  function clipAt(t, tl) {
    tl = tl || timeline();
    var i = 0; while (i < clips.length - 1 && t >= tl.starts[i + 1]) i++;
    return i;
  }

  /* ---------- Geometry ---------- */
  function dims() { var f = FORMATS[S.format] || FORMATS.short; return { W: f.w, H: f.h }; }
  // Where the video goes: the frame minus the space around it and room for the frame style.
  function contentRect(W, H) {
    var base = Math.min(W, H), p = (S.pad / 100) * base, x = p, y = p, w = W - 2 * p, h = H - 2 * p;
    var extra = { polaroid: [0.035, 0.035, 0.035, 0.11], film: [0, 0.07, 0, 0.07], tv: [0.035, 0.035, 0.035, 0.035], border: [0.014, 0.014, 0.014, 0.014], neon: [0.012, 0.012, 0.012, 0.012] }[S.frame];
    if (extra) { x += extra[0] * base; y += extra[1] * base; w -= (extra[0] + extra[2]) * base; h -= (extra[1] + extra[3]) * base; }
    return { x: x, y: y, w: Math.max(10, w), h: Math.max(10, h) };
  }
  // The rectangle the clip's picture is drawn into (may be larger than the content area when zoomed or filling).
  function videoRect(c, W, H) {
    var R = contentRect(W, H), vw = c.vw || 16, vh = c.vh || 9;
    var s = (S.fit === 'fill' ? Math.max(R.w / vw, R.h / vh) : Math.min(R.w / vw, R.h / vh)) * (c.zoom || 1);
    var w = vw * s, h = vh * s;
    return { x: R.x + (R.w - w) / 2 + (c.ox || 0) * R.w, y: R.y + (R.h - h) / 2 + (c.oy || 0) * R.h, w: w, h: h, R: R };
  }
  function visibleRect(c, W, H) {   // the part of the picture actually on screen
    var v = videoRect(c, W, H), R = v.R;
    var x0 = Math.max(v.x, R.x), y0 = Math.max(v.y, R.y), x1 = Math.min(v.x + v.w, R.x + R.w), y1 = Math.min(v.y + v.h, R.y + R.h);
    return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
  }

  /* ---------- Drawing ---------- */
  function rr(x, X, Y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath();
  }
  var tiny = null;
  function drawBackground(x, W, H, v, c) {
    var b = S.bg, g = BGS.find(function (k) { return k[0] === b; });
    if (b === 'blur' && v && ready(v)) {
      // soft blur that works in every browser: shrink, then stretch with smoothing
      tiny = tiny || document.createElement('canvas');
      var tw = 40, th = Math.max(8, Math.round(40 * H / W)); tiny.width = tw; tiny.height = th;
      var tx = tiny.getContext('2d'), vw = c.vw || v.videoWidth || 16, vh = c.vh || v.videoHeight || 9, s = Math.max(tw / vw, th / vh);
      tx.drawImage(v, (tw - vw * s) / 2, (th - vh * s) / 2, vw * s, vh * s);
      x.save(); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(tiny, 0, 0, W, H);
      x.fillStyle = 'rgba(0,0,0,0.38)'; x.fillRect(0, 0, W, H); x.restore();
      return;
    }
    if (b === 'image' && bgImage && bgImage.img && bgImage.img.naturalWidth) {
      var im = bgImage.img, s2 = Math.max(W / im.naturalWidth, H / im.naturalHeight);
      x.drawImage(im, (W - im.naturalWidth * s2) / 2, (H - im.naturalHeight * s2) / 2, im.naturalWidth * s2, im.naturalHeight * s2);
      return;
    }
    if (g && g[2]) {
      var gr = x.createLinearGradient(0, 0, W * 0.4, H); gr.addColorStop(0, g[2][0]); gr.addColorStop(1, g[2][1]);
      x.fillStyle = gr; x.fillRect(0, 0, W, H); return;
    }
    x.fillStyle = b === 'white' ? '#ffffff' : b === 'color' ? S.bgColor : '#000000';
    x.fillRect(0, 0, W, H);
  }
  function ready(v) { return v && v.readyState >= 2 && v.videoWidth > 0; }

  function drawVideo(x, W, H, v, c) {
    var R = contentRect(W, H), vr = videoRect(c, W, H), vis = visibleRect(c, W, H), base = Math.min(W, H), fc = S.frameColor;
    var fr = S.frame;
    // frame behind the picture
    if (fr === 'polaroid') {
      var p = 0.035 * base;
      x.save(); x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 0.03 * base; x.shadowOffsetY = 0.01 * base;
      x.fillStyle = fc; rr(x, vis.x - p, vis.y - p, vis.w + 2 * p, vis.h + p + 0.11 * base, 0.008 * base); x.fill(); x.restore();
    } else if (fr === 'tv') {
      var q = 0.035 * base;
      x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 0.03 * base;
      var tg = x.createLinearGradient(0, vis.y - q, 0, vis.y + vis.h + q); tg.addColorStop(0, '#3a3f4b'); tg.addColorStop(1, '#16181f');
      x.fillStyle = tg; rr(x, vis.x - q, vis.y - q, vis.w + 2 * q, vis.h + 2 * q, 0.05 * base); x.fill(); x.restore();
    } else if (fr === 'film') {
      var fh = 0.07 * base;
      x.fillStyle = '#0b0b0b'; x.fillRect(vis.x, vis.y - fh, vis.w, vis.h + 2 * fh);
      x.fillStyle = 'rgba(255,255,255,0.88)';
      var hw = 0.022 * base, hh = 0.03 * base, gap = 0.05 * base;
      for (var hx = vis.x + gap / 2; hx < vis.x + vis.w - hw; hx += gap) {
        rr(x, hx, vis.y - fh + (fh - hh) / 2, hw, hh, hw * 0.25); x.fill();
        rr(x, hx, vis.y + vis.h + (fh - hh) / 2, hw, hh, hw * 0.25); x.fill();
      }
    } else if (fr === 'rounded') {
      x.save(); x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = 0.035 * base; x.shadowOffsetY = 0.012 * base;
      x.fillStyle = '#000'; rr(x, vis.x, vis.y, vis.w, vis.h, 0.035 * base); x.fill(); x.restore();
    }
    // the picture, clipped to the content area (and rounded where the frame is rounded)
    x.save();
    var radius = fr === 'rounded' ? 0.035 * base : fr === 'tv' ? 0.03 * base : fr === 'border' || fr === 'neon' ? 0.012 * base : 0;
    if (radius) { rr(x, vis.x, vis.y, vis.w, vis.h, radius); x.clip(); }
    else { x.beginPath(); x.rect(R.x, R.y, R.w, R.h); x.clip(); }
    if (ready(v)) x.drawImage(v, vr.x, vr.y, vr.w, vr.h);
    else { x.fillStyle = '#000'; x.fillRect(vis.x, vis.y, vis.w, vis.h); }
    x.restore();
    // frame on top
    if (fr === 'border') {
      var bw = 0.014 * base; x.save(); x.strokeStyle = fc; x.lineWidth = bw; rr(x, vis.x - bw / 2, vis.y - bw / 2, vis.w + bw, vis.h + bw, 0.016 * base); x.stroke(); x.restore();
    } else if (fr === 'neon') {
      var nw = 0.007 * base; x.save(); x.strokeStyle = fc; x.lineWidth = nw; x.shadowColor = fc; x.shadowBlur = 0.04 * base;
      rr(x, vis.x - nw, vis.y - nw, vis.w + 2 * nw, vis.h + 2 * nw, 0.016 * base); x.stroke(); x.stroke(); x.restore();
    }
  }

  // Overlays ----------------------------------------------------------------
  function fontCss(o, px) { return (FONTS[o.font] || FONTS.bold).css.replace('{s}', Math.max(6, Math.round(px))); }
  function wrapLines(x, text, maxW) {
    var out = [];
    String(text || '').split('\n').forEach(function (para) {
      var words = para.split(/\s+/).filter(Boolean), line = '';
      if (!words.length) { out.push(''); return; }
      words.forEach(function (w) {
        var t = line ? line + ' ' + w : w;
        if (line && x.measureText(t).width > maxW) { out.push(line); line = w; } else line = t;
      });
      out.push(line);
    });
    return out;
  }
  function visibleAt(o, t) { return t >= (o.start || 0) - 1e-6 && (o.end == null || t < o.end); }
  // animation in/out → { a: alpha, s: scale, dy: offset (fraction of H), chars: fraction of text shown }
  function animState(o, t, total) {
    var st = o.start || 0, en = o.end == null ? total : Math.min(o.end, total), k = { a: 1, s: 1, dy: 0, chars: 1 };
    var inP = clamp((t - st) / ANIM_T, 0, 1), outP = clamp((en - t) / ANIM_T, 0, 1);
    var an = o.anim || 'none';
    if (an === 'fade') k.a = Math.min(inP, en < total - 0.01 ? outP : 1);
    else if (an === 'pop') { var e = inP < 1 ? 1 - Math.pow(1 - inP, 3) : 1; k.s = 0.6 + 0.4 * e + (inP > 0.6 && inP < 1 ? 0.08 * Math.sin((inP - 0.6) / 0.4 * Math.PI) : 0); k.a = Math.min(1, inP * 2); }
    else if (an === 'slide') { var e2 = 1 - Math.pow(1 - inP, 3); k.dy = (1 - e2) * 0.06; k.a = inP; }
    else if (an === 'type') { k.chars = clamp((t - st) / Math.max(0.4, Math.min(1.6, (en - st) * 0.5)), 0, 1); }
    return k;
  }
  function drawOverlays(x, W, H, t, total, forPreview) {
    var base = Math.min(W, H);
    overlays.forEach(function (o) {
      o._b = null;
      if (!visibleAt(o, t)) return;
      // paused preview shows every overlay fully, so it can be seen and edited; animations play in playback and the export
      var k = forPreview && !pv.playing ? { a: 1, s: 1, dy: 0, chars: 1 } : animState(o, t, total);
      x.save(); x.globalAlpha = k.a * (o.opacity == null ? 1 : o.opacity);
      if (o.type === 'progress') {
        var th = Math.max(2, (o.thick || 0.008) * H), y = o.pos === 'top' ? 0 : H - th;
        x.fillStyle = 'rgba(255,255,255,0.18)'; x.fillRect(0, y, W, th);
        x.fillStyle = o.color || '#ff0033'; x.fillRect(0, y, W * clamp(t / Math.max(0.01, total), 0, 1), th);
        o._b = { x: 0, y: y - 6, w: W, h: th + 12, noResize: true };
        x.restore(); return;
      }
      var cx = o.x * W, cy = (o.y + k.dy) * H;
      x.translate(cx, cy); x.scale(k.s, k.s);
      if (o.type === 'image') {
        var im = o._img;
        if (im && im.naturalWidth) {
          var w = o.w * base, h = w * im.naturalHeight / im.naturalWidth;   // sized by the short side, so it looks the same in every format
          x.save();
          if (o.shape === 'circle') { x.beginPath(); x.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2); x.clip(); var d = Math.min(w, h), sc = Math.max(d / w, d / h); x.drawImage(im, -w * sc / 2, -h * sc / 2, w * sc, h * sc); w = h = d; }
          else { if (o.shape === 'rounded') { rr(x, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.12); x.clip(); } x.drawImage(im, -w / 2, -h / 2, w, h); }
          x.restore();
          if (o.border) { x.lineWidth = Math.max(2, base * 0.006); x.strokeStyle = '#fff'; if (o.shape === 'circle') { x.beginPath(); x.arc(0, 0, w / 2, 0, Math.PI * 2); x.stroke(); } else { rr(x, -w / 2, -h / 2, w, h, o.shape === 'rounded' ? Math.min(w, h) * 0.12 : 0); x.stroke(); } }
          o._b = { x: cx - w * k.s / 2, y: cy - h * k.s / 2, w: w * k.s, h: h * k.s };
        }
        x.restore(); return;
      }
      if (o.type === 'cta') {
        var fs = o.size * base, label = (o.text || 'SUBSCRIBE').toUpperCase();
        x.font = fontCss({ font: 'bold' }, fs);
        var tw = x.measureText(label).width, bell = fs * 1.3, pw = tw + fs * 1.6 + bell, ph = fs * 2;
        x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = fs * 0.5; x.shadowOffsetY = fs * 0.12;
        x.fillStyle = o.color || '#ff0033'; rr(x, -pw / 2, -ph / 2, pw, ph, ph / 2); x.fill();
        x.shadowColor = 'transparent';
        x.fillStyle = '#fff'; x.textAlign = 'left'; x.textBaseline = 'middle';
        x.fillText(label, -pw / 2 + fs * 0.8, fs * 0.05);
        x.font = Math.round(fs * 1.05) + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
        x.fillText('🔔', pw / 2 - bell - fs * 0.15, fs * 0.05);
        o._b = { x: cx - pw * k.s / 2, y: cy - ph * k.s / 2, w: pw * k.s, h: ph * k.s };
        x.restore(); return;
      }
      // text (title, text, name tag, emoji)
      var px = o.size * base;
      x.font = fontCss(o, px);
      var lines = wrapLines(x, o.text, (o.wrap || 0.86) * W), lh = px * 1.16;
      var full = lines.join('\n'), show = k.chars < 1 ? Math.round(full.length * k.chars) : full.length, shown = 0;
      var widths = lines.map(function (l) { return x.measureText(l).width; }), bw = Math.max.apply(null, widths.concat([px * 0.5])), bh = lines.length * lh;
      var padX = o.style === 'box' ? px * 0.45 : px * 0.1, padY = o.style === 'box' ? px * 0.28 : px * 0.05;
      if (o.style === 'box') {
        x.save(); x.fillStyle = o.bg || '#000000'; x.globalAlpha *= o.bgAlpha == null ? 0.85 : o.bgAlpha;
        rr(x, -bw / 2 - padX, -bh / 2 - padY, bw + 2 * padX, bh + 2 * padY, px * 0.3); x.fill(); x.restore();
      }
      x.textBaseline = 'middle'; x.lineJoin = 'round';
      var al = o.align || 'center';
      lines.forEach(function (l, i) {
        var left = shown, txt = l;
        if (shown + l.length > show) txt = l.slice(0, Math.max(0, show - shown));
        shown += l.length + 1;
        if (!txt) return;
        var ly = -bh / 2 + lh * (i + 0.5), lx = al === 'left' ? -bw / 2 : al === 'right' ? bw / 2 : 0;
        x.textAlign = al;
        if (o.style === 'outline') {
          x.lineWidth = Math.max(2, px * 0.16); x.strokeStyle = o.stroke || '#000000'; x.strokeText(txt, lx, ly);
          x.fillStyle = o.color || '#ffffff'; x.fillText(txt, lx, ly);
        } else if (o.style === 'shadow') {
          x.save(); x.shadowColor = 'rgba(0,0,0,.7)'; x.shadowBlur = px * 0.3; x.shadowOffsetY = px * 0.07;
          x.fillStyle = o.color || '#ffffff'; x.fillText(txt, lx, ly); x.restore();
        } else if (o.style === 'neon') {
          x.save(); x.shadowColor = o.color || '#22d3ee'; x.shadowBlur = px * 0.6; x.fillStyle = o.color || '#22d3ee';
          x.fillText(txt, lx, ly); x.fillText(txt, lx, ly); x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillText(txt, lx, ly); x.restore();
        } else { x.fillStyle = o.color || '#ffffff'; x.fillText(txt, lx, ly); }
        void left;
      });
      o._b = { x: cx - (bw / 2 + padX) * k.s, y: cy - (bh / 2 + padY) * k.s, w: (bw + 2 * padX) * k.s, h: (bh + 2 * padY) * k.s };
      x.restore();
    });
  }

  // One frame of the video at time t (v = the clip's video element, already showing the right moment).
  function drawFrame(x, W, H, t, v, ci, preview) {
    var tl = timeline(), c = clips[ci];
    x.save();
    x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    if (c) {
      drawBackground(x, W, H, v, c);
      drawVideo(x, W, H, v, c);
      if (S.transition === 'fade' && clips.length > 1) {
        var st = tl.starts[ci], en = st + clipLen(c), a = 0;
        if (ci > 0 && t - st < FADE_T) a = 1 - (t - st) / FADE_T;
        if (ci < clips.length - 1 && en - t < FADE_T) a = Math.max(a, 1 - (en - t) / FADE_T);
        if (a > 0) { x.fillStyle = 'rgba(0,0,0,' + clamp(a, 0, 1) + ')'; x.fillRect(0, 0, W, H); }
      }
    }
    drawOverlays(x, W, H, t, tl.total, preview);
    x.restore();
  }

  /* ---------- Preview player ---------- */
  var pv = { t: 0, playing: false, raf: 0, ci: 0, music: null };
  var stash = document.createElement('div');
  stash.style.cssText = 'position:fixed;left:-10px;top:-10px;width:2px;height:2px;overflow:hidden;opacity:0;pointer-events:none';
  document.body.appendChild(stash);
  function elFor(c) {
    if (!c._el || c._el.dataset.src !== c.blobId) {
      var v = document.createElement('video');
      v.preload = 'auto'; v.playsInline = true; v.setAttribute('playsinline', ''); v.crossOrigin = 'anonymous';
      v.dataset.src = c.blobId; v.src = blobUrl(c.blobId);
      v.addEventListener('loadeddata', function () { if (!pv.playing) drawPreview(); });
      v.addEventListener('seeked', function () { if (!pv.playing) drawPreview(); });
      stash.appendChild(v);
      c._el = v;
    }
    return c._el;
  }
  function previewSize() {
    var d = dims(), maxW = 360, maxH = 640, s = Math.min(maxW / d.W, maxH / d.H);
    if (d.W >= d.H) s = Math.min(640 / d.W, 360 / d.H);
    return { w: Math.round(d.W * s), h: Math.round(d.H * s), s: s };
  }
  function sizePreview() {
    var c = $('preview'), ps = previewSize(), dpr = Math.min(2, window.devicePixelRatio || 1);
    c.width = Math.round(ps.w * dpr); c.height = Math.round(ps.h * dpr);
    c.style.width = ps.w + 'px'; c.style.aspectRatio = ps.w + ' / ' + ps.h;
  }
  function drawPreview() {
    var c = $('preview'); if (!c) return;
    var x = c.getContext('2d'), W = c.width, H = c.height, tl = timeline();
    if (!clips.length) { x.fillStyle = '#06101f'; x.fillRect(0, 0, W, H); return; }
    var ci = clipAt(pv.t, tl), v = elFor(clips[ci]);
    drawFrame(x, W, H, pv.t, v, ci, true);
    // selection box + resize corner
    var o = overlays.find(function (k) { return k.id === sel; });
    if (o && o._b) {
      var b = o._b;
      x.save(); x.setLineDash([6, 4]); x.lineWidth = 2; x.strokeStyle = '#7cc4ff'; x.strokeRect(b.x, b.y, b.w, b.h); x.setLineDash([]);
      if (!b.noResize) { x.fillStyle = '#1e7bff'; x.strokeStyle = '#fff'; x.beginPath(); x.rect(b.x + b.w - 9, b.y + b.h - 9, 18, 18); x.fill(); x.stroke(); }
      x.restore();
    }
    if (moveVideo) {
      var vr = visibleRect(clips[ci], W, H);
      x.save(); x.setLineDash([8, 6]); x.lineWidth = 2; x.strokeStyle = '#fbbf24'; x.strokeRect(vr.x, vr.y, vr.w, vr.h); x.restore();
    }
    var total = tl.total;
    $('scrub').value = total ? Math.round(pv.t / total * 1000) : 0;
    $('timeLabel').textContent = mmss(pv.t) + ' / ' + mmss(total);
  }
  function seekTo(t) {
    var tl = timeline(); pv.t = clamp(t, 0, tl.total);
    if (!clips.length) return drawPreview();
    var ci = clipAt(pv.t, tl), c = clips[ci], v = elFor(c), want = c.in + (pv.t - tl.starts[ci]);
    if (pv.playing) { stopPreview(); }
    try { if (Math.abs(v.currentTime - want) > 0.01) v.currentTime = want; } catch (e) { /* not ready */ }
    drawPreview();
  }
  function startPreview() {
    if (!clips.length || rec) return;
    var tl = timeline(); if (pv.t >= tl.total - 0.05) pv.t = 0;
    pv.playing = true; setPlayBtn(true);
    pv.ci = clipAt(pv.t, tl);
    var c = clips[pv.ci], v = elFor(c);
    v.currentTime = c.in + (pv.t - tl.starts[pv.ci]);
    playEl(c, v);
    if (music) {
      pv.music = pv.music || new Audio(); if (pv.music.src !== blobUrl(music.blobId)) pv.music.src = blobUrl(music.blobId);
      pv.music.loop = true; pv.music.volume = S.musicVol / 100;
      try { pv.music.currentTime = pv.t % (pv.music.duration || 1e9); } catch (e) { /* metadata */ }
      pv.music.play().catch(function () {});
    }
    var loop = function () {
      if (!pv.playing) return;
      var tl2 = timeline(), c2 = clips[pv.ci], v2 = elFor(c2);
      if (!c2) { stopPreview(); return; }
      pv.t = tl2.starts[pv.ci] + Math.max(0, v2.currentTime - c2.in);
      if (v2.currentTime >= c2.out - 0.03 || v2.ended) {
        v2.pause();
        if (pv.ci >= clips.length - 1) { pv.t = tl2.total; drawPreview(); stopPreview(); return; }
        pv.ci++;
        var n = clips[pv.ci], nv = elFor(n);
        nv.currentTime = n.in; pv.t = tl2.starts[pv.ci];
        playEl(n, nv);
      }
      drawPreview(); pv.raf = requestAnimationFrame(loop);
    };
    pv.raf = requestAnimationFrame(loop);
  }
  function playEl(c, v) { v.muted = !!c.mute; v.volume = clamp(c.vol == null ? 1 : c.vol, 0, 1); v.play().catch(function () { v.muted = true; v.play().catch(function () {}); }); }
  function stopPreview() {
    pv.playing = false; cancelAnimationFrame(pv.raf); setPlayBtn(false);
    clips.forEach(function (c) { if (c._el) c._el.pause(); });
    if (pv.music) pv.music.pause();
  }
  function setPlayBtn(on) {
    var b = $('playBtn'); b.classList.toggle('is-playing', on); b.classList.toggle('is-active', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.setAttribute('aria-label', on ? 'Pause preview' : 'Play preview');
  }

  /* ---------- Import ---------- */
  function probe(blob) {
    return new Promise(function (res, rej) {
      var v = document.createElement('video'), url = URL.createObjectURL(blob), done = false;
      v.preload = 'auto'; v.muted = true; v.playsInline = true; v.src = url;
      var fail = function () { if (done) return; done = true; URL.revokeObjectURL(url); rej(new Error('cannot-play')); };
      var t = setTimeout(fail, 20000);
      v.onerror = fail;
      v.onloadedmetadata = function () {
        var d = v.duration;
        var finish = function (dur) {
          if (done) return; done = true; clearTimeout(t);
          var w = v.videoWidth, h = v.videoHeight;
          // thumbnail from ~10% in
          var go = function () {
            var cv = document.createElement('canvas'), s = 160 / Math.max(w || 160, h || 90); cv.width = Math.max(1, Math.round((w || 160) * s)); cv.height = Math.max(1, Math.round((h || 90) * s));
            try { cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); } catch (e) { /* ignore */ }
            var thumb = ''; try { thumb = cv.toDataURL('image/jpeg', 0.7); } catch (e) { /* ignore */ }
            URL.revokeObjectURL(url);
            res({ dur: dur, w: w, h: h, thumb: thumb, audio: hasAudio(v) });
          };
          v.onseeked = go; try { v.currentTime = Math.min(dur * 0.1, 1); } catch (e) { go(); }
          setTimeout(function () { if (v.onseeked) { v.onseeked = null; go(); } }, 4000);
        };
        if (!isFinite(d) || !d) {   // some recordings report no duration until they're read through
          v.currentTime = 1e7;
          v.ontimeupdate = function () { v.ontimeupdate = null; var dd = v.duration; v.currentTime = 0; finish(isFinite(dd) && dd ? dd : 0); };
        } else finish(d);
      };
    });
  }
  function hasAudio(v) {
    if (typeof v.mozHasAudio === 'boolean') return v.mozHasAudio;
    if (typeof v.webkitAudioDecodedByteCount === 'number' && v.audioTracks === undefined) return null;   // unknown until played
    if (v.audioTracks) return v.audioTracks.length > 0;
    return null;
  }
  function addFiles(files) {
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return /^video\//.test(f.type) || /\.(mp4|mov|m4v|webm|mkv|ogv|3gp|avi)$/i.test(f.name); });
    if (!list.length) { YB.toast('Choose video files'); return; }
    var bad = [];
    $('importNote').hidden = true;
    var chain = Promise.resolve();
    YB.toast(list.length === 1 ? 'Adding ' + list[0].name + '…' : 'Adding ' + list.length + ' videos…');
    list.forEach(function (f) {
      chain = chain.then(function () {
        return probe(f).then(function (info) {
          var id = YB.uid(), blobId = 'v' + id;
          addBlob(blobId, f);
          return putBlob(blobId, f).then(function () {
            clips.push({ id: id, name: f.name, blobId: blobId, dur: info.dur, vw: info.w, vh: info.h, thumb: info.thumb, in: 0, out: info.dur || 1, vol: 1, mute: false, zoom: 1, ox: 0, oy: 0, audio: info.audio });
          });
        }, function () { bad.push(f.name); });
      });
    });
    chain.then(function () {
      if (bad.length) {
        $('importNote').hidden = false;
        $('importNote').textContent = 'This browser can\'t play ' + bad.join(', ') + '. Most often that\'s an MKV, HEVC (iPhone "High Efficiency") or AVI file — save or convert it as an MP4 (H.264) and add it again.';
      }
      saveProject(); renderAll(); seekTo(pv.t);
    });
  }

  /* ---------- Rendering the page ---------- */
  function renderClips() {
    var tl = timeline();
    $('clipCount').textContent = clips.length ? '· ' + clips.length + ' clip' + (clips.length === 1 ? '' : 's') + ' · ' + mmss(tl.total) : '';
    $('clipList').innerHTML = clips.map(function (c, i) {
      return '<li class="fm-clip" data-id="' + c.id + '">' +
        '<div class="fm-clip-top"><span class="cx-pnum">' + (i + 1) + '</span>' +
        (c.thumb ? '<img class="fm-thumb" src="' + c.thumb + '" alt="">' : '<span class="fm-thumb"></span>') +
        '<div class="fm-clip-meta"><b class="fm-clip-name">' + YB.esc(c.name) + '</b>' +
        '<span class="muted small">' + (c.vw ? c.vw + '×' + c.vh + ' · ' : '') + 'plays ' + secs(clipLen(c)) + ' s of ' + secs(c.dur) + ' s · starts at ' + mmss(tl.starts[i]) + '</span></div>' +
        '<div class="cx-pbtns"><button type="button" class="btn btn-ghost btn-icon btn-sm" data-up aria-label="Move earlier"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn btn-ghost btn-icon btn-sm" data-down aria-label="Move later"' + (i === clips.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn btn-danger btn-icon btn-sm" data-del aria-label="Remove clip ' + (i + 1) + '">✕</button></div></div>' +
        '<div class="fm-clip-ctl">' +
        '<label class="field"><span>Start (s)</span><input type="number" data-k="in" min="0" max="' + secs(c.dur) + '" step="0.1" value="' + secs(c.in) + '"></label>' +
        '<label class="field"><span>End (s)</span><input type="number" data-k="out" min="0" max="' + secs(c.dur) + '" step="0.1" value="' + secs(c.out) + '"></label>' +
        '<label class="field"><span>Zoom <b>' + Math.round((c.zoom || 1) * 100) + '%</b></span><input type="range" data-k="zoom" min="50" max="300" step="5" value="' + Math.round((c.zoom || 1) * 100) + '"></label>' +
        '<label class="field"><span>Volume <b>' + (c.mute ? 'muted' : Math.round((c.vol == null ? 1 : c.vol) * 100) + '%') + '</b></span><input type="range" data-k="vol" min="0" max="100" step="5" value="' + Math.round((c.vol == null ? 1 : c.vol) * 100) + '"' + (c.mute ? ' disabled' : '') + '></label>' +
        '<label class="fm-check"><input type="checkbox" data-k="mute"' + (c.mute ? ' checked' : '') + '> Mute</label>' +
        ((c.ox || c.oy || (c.zoom && c.zoom !== 1)) ? '<button type="button" class="btn btn-ghost btn-sm" data-reset>↺ Re-centre</button>' : '') +
        '</div></li>';
    }).join('');
  }
  function renderFormats() {
    $('formatSeg').innerHTML = Object.keys(FORMATS).map(function (k) {
      var f = FORMATS[k];
      return '<button type="button" role="radio" data-format="' + k + '" class="fm-format' + (k === S.format ? ' on' : '') + '" aria-checked="' + (k === S.format) + '">' +
        '<span class="fm-format-ico fm-ar-' + k + '" aria-hidden="true"></span><b>' + f.ico + ' ' + f.name + '</b><span class="muted small">' + f.sub + '</span></button>';
    }).join('');
    document.querySelectorAll('[data-fit]').forEach(function (b) { var on = b.getAttribute('data-fit') === S.fit; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    $('bgList').innerHTML = BGS.map(function (g) {
      var sw = g[0] === 'blur' ? 'background:linear-gradient(135deg,#667,#223);filter:blur(1px)' : g[0] === 'black' ? 'background:#000' : g[0] === 'white' ? 'background:#fff' :
        g[0] === 'color' ? 'background:' + S.bgColor : g[0] === 'image' ? (bgImage ? 'background:center/cover url(' + blobUrl(bgImage.blobId) + ')' : 'background:repeating-linear-gradient(45deg,#334,#334 6px,#223 6px,#223 12px)') :
        'background:linear-gradient(135deg,' + g[2][0] + ',' + g[2][1] + ')';
      var dis = g[0] === 'image' && !bgImage;
      return '<button type="button" role="radio" class="fm-sw' + (S.bg === g[0] ? ' on' : '') + '" data-bg="' + g[0] + '" aria-checked="' + (S.bg === g[0]) + '"' + (dis ? ' disabled title="Add your own background first"' : '') + '><i style="' + sw + '"></i><span>' + g[1] + '</span></button>';
    }).join('');
    $('frameList').innerHTML = FRAMES.map(function (f) {
      return '<button type="button" role="radio" class="fm-sw fm-fr fm-fr-' + f[0] + (S.frame === f[0] ? ' on' : '') + '" data-frame="' + f[0] + '" aria-checked="' + (S.frame === f[0]) + '"><i></i><span>' + f[1] + '</span></button>';
    }).join('');
    $('frameColorWrap').hidden = ['border', 'polaroid', 'neon'].indexOf(S.frame) === -1;
    $('bgColor').value = S.bgColor; $('frameColor').value = S.frameColor; $('transition').value = S.transition;
    $('pad').value = S.pad; $('padVal').textContent = S.pad + '%';
    $('musicName').textContent = music ? '🎵 ' + music.name : 'No music';
    $('musicDel').hidden = !music; $('musicVolWrap').hidden = !music;
    $('musicVol').value = S.musicVol; $('musicVolVal').textContent = S.musicVol + '%';
  }
  function ovLabel(o) {
    if (o.type === 'image') return '🖼️ Picture';
    if (o.type === 'cta') return '🔔 ' + (o.text || 'Subscribe');
    if (o.type === 'progress') return '▬ Progress bar';
    return (o.kind === 'emoji' ? '' : '🔤 ') + (String(o.text || '').split('\n')[0].slice(0, 40) || 'Text');
  }
  function renderOverlays() {
    var total = timeline().total;
    $('ovList').innerHTML = overlays.length ? overlays.slice().reverse().map(function (o) {
      var en = o.end == null ? total : o.end;
      return '<li class="fm-ov' + (o.id === sel ? ' on' : '') + '" data-ov="' + o.id + '"><span class="fm-ov-name">' + YB.esc(ovLabel(o)) + '</span><span class="muted small">' + (o.type === 'progress' ? 'whole video' : secs(o.start || 0) + '–' + secs(en) + ' s') + '</span></li>';
    }).join('') : '<li class="muted small fm-empty">No overlays yet — add one above.</li>';
    renderEditor();
  }
  function markSelected() {   // highlight in the list without rebuilding anything (safe mid-drag)
    $('ovList').querySelectorAll('[data-ov]').forEach(function (li) { li.classList.toggle('on', li.getAttribute('data-ov') === sel); });
  }
  function steady(fn) {
    var c = $('preview'), top = c.getBoundingClientRect().top;
    fn();
    var d = c.getBoundingClientRect().top - top;
    if (Math.abs(d) > 1 && window.innerWidth < 980) window.scrollBy(0, d);
  }
  var edFor = '';
  function opt(list, v) { return list.map(function (a) { return '<option value="' + a[0] + '"' + (a[0] === v ? ' selected' : '') + '>' + a[1] + '</option>'; }).join(''); }
  function renderEditor() {
    var o = overlays.find(function (k) { return k.id === sel; }), ed = $('ovEditor');
    edFor = o ? o.id : '';
    if (!o) { ed.hidden = true; ed.innerHTML = ''; return; }
    ed.hidden = false;
    var total = timeline().total, h = '';
    var timeRow = o.type === 'progress' ? '' :
      '<div class="fields fm-times"><label class="field"><span>Shows from (s)</span><input type="number" data-o="start" min="0" step="0.1" value="' + secs(o.start || 0) + '"></label>' +
      '<label class="field"><span>Until (s)</span><input type="number" data-o="end" min="0" step="0.1" value="' + (o.end == null ? '' : secs(o.end)) + '" placeholder="the end (' + secs(total) + ')"></label>' +
      '<label class="field"><span>Animation</span><select data-o="anim">' + opt(ANIMS, o.anim || 'none') + '</select></label></div>' +
      '<div class="row" style="gap:6px;margin-top:6px"><button type="button" class="btn btn-ghost btn-sm" data-ot="now">⏱ Start at the playhead</button><button type="button" class="btn btn-ghost btn-sm" data-ot="nowend">⏱ End at the playhead</button><button type="button" class="btn btn-ghost btn-sm" data-ot="all">Whole video</button></div>';
    if (o.type === 'text') {
      h += '<label class="field"><span>Text</span><textarea data-o="text" rows="2">' + YB.esc(o.text || '') + '</textarea></label>' +
        '<div class="fields">' +
        '<label class="field"><span>Font</span><select data-o="font">' + opt(Object.keys(FONTS).map(function (k) { return [k, FONTS[k].name]; }), o.font) + '</select></label>' +
        '<label class="field"><span>Style</span><select data-o="style">' + opt(STYLES, o.style) + '</select></label>' +
        '<label class="field"><span>Size <b>' + Math.round(o.size * 1000) / 10 + '</b></span><input type="range" data-o="size" min="1" max="30" step="0.5" value="' + Math.round(o.size * 1000) / 10 + '"></label>' +
        '<label class="field"><span>Text colour</span><input type="color" data-o="color" value="' + (o.color || '#ffffff') + '"></label>' +
        (o.style === 'box' ? '<label class="field"><span>Box colour</span><input type="color" data-o="bg" value="' + (o.bg || '#000000') + '"></label>' : '') +
        (o.style === 'outline' ? '<label class="field"><span>Outline colour</span><input type="color" data-o="stroke" value="' + (o.stroke || '#000000') + '"></label>' : '') +
        '<label class="field"><span>Line up</span><select data-o="align">' + opt([['left', 'Left'], ['center', 'Centre'], ['right', 'Right']], o.align || 'center') + '</select></label>' +
        '<label class="field"><span>Width <b>' + Math.round((o.wrap || 0.86) * 100) + '%</b></span><input type="range" data-o="wrap" min="20" max="100" step="2" value="' + Math.round((o.wrap || 0.86) * 100) + '"></label>' +
        '</div>';
    } else if (o.type === 'image') {
      h += '<div class="fields">' +
        '<label class="field"><span>Size <b>' + Math.round(o.w * 100) + '%</b></span><input type="range" data-o="w" min="4" max="180" step="1" value="' + Math.round(o.w * 100) + '"></label>' +
        '<label class="field"><span>Shape</span><select data-o="shape">' + opt([['square', 'As it is'], ['rounded', 'Rounded'], ['circle', 'Circle']], o.shape || 'square') + '</select></label>' +
        '<label class="field"><span>See-through <b>' + Math.round((1 - (o.opacity == null ? 1 : o.opacity)) * 100) + '%</b></span><input type="range" data-o="opacity" min="10" max="100" step="5" value="' + Math.round((o.opacity == null ? 1 : o.opacity) * 100) + '"></label>' +
        '<label class="fm-check"><input type="checkbox" data-o="border"' + (o.border ? ' checked' : '') + '> White border</label></div>';
    } else if (o.type === 'cta') {
      h += '<div class="fields"><label class="field"><span>Button text</span><input type="text" data-o="text" maxlength="24" value="' + YB.esc(o.text || 'Subscribe') + '"></label>' +
        '<label class="field"><span>Size <b>' + Math.round(o.size * 1000) / 10 + '</b></span><input type="range" data-o="size" min="2" max="12" step="0.5" value="' + Math.round(o.size * 1000) / 10 + '"></label>' +
        '<label class="field"><span>Colour</span><input type="color" data-o="color" value="' + (o.color || '#ff0033') + '"></label></div>';
    } else if (o.type === 'progress') {
      h += '<div class="fields"><label class="field"><span>Where</span><select data-o="pos">' + opt([['bottom', 'Bottom'], ['top', 'Top']], o.pos || 'bottom') + '</select></label>' +
        '<label class="field"><span>Colour</span><input type="color" data-o="color" value="' + (o.color || '#ff0033') + '"></label>' +
        '<label class="field"><span>Thickness <b>' + Math.round((o.thick || 0.008) * 1000) / 10 + '</b></span><input type="range" data-o="thick" min="0.3" max="3" step="0.1" value="' + Math.round((o.thick || 0.008) * 1000) / 10 + '"></label></div>';
    }
    h += timeRow;
    h += '<div class="row" style="gap:6px;margin-top:10px">' +
      '<button type="button" class="btn btn-ghost btn-sm" data-ol="up">⬆ Bring forward</button><button type="button" class="btn btn-ghost btn-sm" data-ol="down">⬇ Send back</button>' +
      (o.type !== 'progress' ? '<button type="button" class="btn btn-ghost btn-sm" data-ol="center">⊕ Centre</button><button type="button" class="btn btn-ghost btn-sm" data-ol="dup">⧉ Copy</button>' : '') +
      '<button type="button" class="btn btn-danger btn-sm" data-ol="del">🗑 Remove</button></div>';
    ed.innerHTML = '<div class="label">Edit · ' + YB.esc(ovLabel(o)) + '</div>' + h;
  }
  function renderSteps() {
    var has = clips.length > 0;
    ['formatCard', 'overlayCard', 'exportCard'].forEach(function (id) { $(id).hidden = !has; });
    var steps = document.querySelectorAll('.cx-steps li');
    if (steps[0]) steps[0].classList.toggle('done', has);
    if (steps[1]) steps[1].classList.toggle('done', has);
    if (steps[2]) steps[2].classList.toggle('done', overlays.length > 0);
    if (steps[3]) steps[3].classList.toggle('done', !!lastVideo);
  }
  function renderFacts() {
    var tl = timeline(), d = dims(), f = FORMATS[S.format];
    $('facts').innerHTML = clips.length ? '<span><b>' + clips.length + '</b> clip' + (clips.length === 1 ? '' : 's') + '</span><span><b>' + mmss(tl.total) + '</b> long</span><span><b>' + d.W + '×' + d.H + '</b></span><span>' + f.ico + ' ' + f.name + '</span>' + (overlays.length ? '<span><b>' + overlays.length + '</b> overlay' + (overlays.length === 1 ? '' : 's') + '</span>' : '') + (music ? '<span>🎵 music</span>' : '') : '';
    var w = $('lenWarn');
    if (S.format === 'short' && tl.total > 180) { w.hidden = false; w.textContent = 'This runs ' + mmss(tl.total) + '. YouTube Shorts can be up to 3 minutes — longer videos upload as regular videos. Trim the clips or choose Long form.'; }
    else w.hidden = true;
    $('exportBtn').disabled = !clips.length || !!rec;
  }
  function renderAll() { renderClips(); renderFormats(); renderOverlays(); renderSteps(); renderFacts(); sizePreview(); drawPreview(); }

  /* ---------- Overlays: add / edit ---------- */
  function addOverlay(kind) {
    var total = timeline().total, tall = dims().H > dims().W, o;
    if (kind === 'title') o = { type: 'text', text: 'Your title here', font: 'bold', style: 'outline', size: 0.075, color: '#ffffff', x: 0.5, y: tall ? 0.14 : 0.16, anim: 'pop' };
    else if (kind === 'text') o = { type: 'text', text: 'Add your text', font: 'clean', style: 'box', size: 0.05, color: '#ffffff', bg: '#000000', x: 0.5, y: 0.5, anim: 'fade' };
    else if (kind === 'lower') o = { type: 'text', text: 'Your Name · @yourchannel', font: 'clean', style: 'box', size: 0.04, color: '#ffffff', bg: '#1e7bff', bgAlpha: 0.95, x: 0.5, y: tall ? 0.8 : 0.84, anim: 'slide', wrap: 0.8 };
    else if (kind === 'emoji') o = { type: 'text', kind: 'emoji', text: '😂', font: 'clean', style: 'plain', size: 0.14, x: 0.78, y: 0.3, anim: 'pop' };
    else if (kind === 'cta') o = { type: 'cta', text: 'Subscribe', size: 0.05, color: '#ff0033', x: 0.5, y: tall ? 0.72 : 0.8, anim: 'pop', start: Math.max(0, Math.round((total - 5) * 10) / 10) };
    else if (kind === 'progress') { if (overlays.some(function (k) { return k.type === 'progress'; })) { YB.toast('There\'s already a progress bar'); return; } o = { type: 'progress', pos: 'bottom', color: '#ff0033', thick: 0.008 }; }
    if (!o) return;
    o.id = YB.uid(); if (o.start == null) o.start = 0; if (o.end === undefined) o.end = null;
    overlays.push(o); sel = o.id;
    saveProject(); renderOverlays(); renderSteps(); renderFacts(); drawPreview();
  }
  function addImage(file) {
    if (!file || !/^image\//.test(file.type)) { YB.toast('Choose a picture'); return; }
    var id = YB.uid(), blobId = 'i' + id;
    addBlob(blobId, file); putBlob(blobId, file);
    var o = { id: id, type: 'image', blobId: blobId, w: 0.26, x: 0.82, y: 0.1, shape: 'square', opacity: 1, start: 0, end: null, anim: 'fade' };
    loadOvImage(o).then(function () { overlays.push(o); sel = o.id; saveProject(); renderOverlays(); renderSteps(); renderFacts(); drawPreview(); });
  }
  function loadOvImage(o) {
    return new Promise(function (res) {
      var im = new Image(); im.onload = function () { o._img = im; res(); }; im.onerror = function () { res(); }; im.src = blobUrl(o.blobId);
    });
  }
  function setOv(o, k, el) {
    var v = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'size') o.size = clamp(+v / 100, 0.005, 0.4);
    else if (k === 'w') o.w = clamp(+v / 100, 0.02, 1.8);
    else if (k === 'opacity') o.opacity = clamp(+v / 100, 0.05, 1);
    else if (k === 'wrap') o.wrap = clamp(+v / 100, 0.1, 1);
    else if (k === 'thick') o.thick = clamp(+v / 100, 0.002, 0.04);
    else if (k === 'start') o.start = clamp(+v || 0, 0, 1e5);
    else if (k === 'end') o.end = v === '' ? null : Math.max(+v || 0, (o.start || 0) + 0.1);
    else o[k] = v;
  }

  /* ---------- Pointer: select, drag, resize, move the video ---------- */
  var drag = null;
  function canvasPt(e) {
    var c = $('preview'), r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height };
  }
  function wirePointer() {
    var c = $('preview');
    c.addEventListener('pointerdown', function (e) {
      if (!clips.length) return;
      var p = canvasPt(e), W = c.width, H = c.height;
      var so = overlays.find(function (k) { return k.id === sel; });
      if (so && so._b && !so._b.noResize && Math.abs(p.x - (so._b.x + so._b.w)) < 16 && Math.abs(p.y - (so._b.y + so._b.h)) < 16) {
        drag = { mode: 'resize', o: so, cx: so.x * W, cy: so.y * H, d0: Math.hypot(p.x - so.x * W, p.y - so.y * H) || 1, size0: so.size, w0: so.w };
      } else {
        var hit = null;
        for (var i = overlays.length - 1; i >= 0; i--) { var b = overlays[i]._b; if (b && p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { hit = overlays[i]; break; } }
        if (hit && !moveVideo) {
          if (sel !== hit.id) { sel = hit.id; markSelected(); }
          drag = hit.type === 'progress' ? null : { mode: 'move', o: hit, dx: p.x - hit.x * W, dy: p.y - hit.y * H };
        } else if (moveVideo) {
          var ci = clipAt(pv.t), cl = clips[ci], R = contentRect(W, H);
          drag = { mode: 'video', c: cl, p0: p, ox: cl.ox || 0, oy: cl.oy || 0, R: R };
        } else if (sel) { sel = ''; markSelected(); }
      }
      if (drag) { c.setPointerCapture(e.pointerId); e.preventDefault(); }
      drawPreview();
    });
    c.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = canvasPt(e), W = c.width, H = c.height;
      if (drag.mode === 'move') { drag.o.x = clamp((p.x - drag.dx) / W, 0, 1); drag.o.y = clamp((p.y - drag.dy) / H, 0, 1); }
      else if (drag.mode === 'resize') {
        var k = (Math.hypot(p.x - drag.cx, p.y - drag.cy) || 1) / drag.d0;
        if (drag.o.type === 'image') drag.o.w = clamp(drag.w0 * k, 0.02, 1.8); else drag.o.size = clamp(drag.size0 * k, 0.005, 0.4);
      } else if (drag.mode === 'video') {
        drag.c.ox = clamp(drag.ox + (p.x - drag.p0.x) / drag.R.w, -1.5, 1.5); drag.c.oy = clamp(drag.oy + (p.y - drag.p0.y) / drag.R.h, -1.5, 1.5);
      }
      drawPreview();
    });
    // The editor is rebuilt only when the finger lifts, and the page is scrolled so the preview stays
    // exactly where it was (on phones the editor sits above the preview and changes height).
    var end = function () {
      var m = drag && drag.mode; drag = null;
      if (m) saveProject();
      steady(function () { if (m === 'video') renderClips(); else if (edFor !== sel || m) renderEditor(); });
      drawPreview();
    };
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
  }

  /* ---------- Export ---------- */
  function pickVideoCodec(W, H) {
    var opts = [['avc', 'avc1.640034'], ['avc', 'avc1.4d0034'], ['vp9', 'vp09.00.40.08'], ['av1', 'av01.0.08M.08']];
    var br = W * H > 2e6 ? 10e6 : 7e6;
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
    return [['aac', 'mp4a.40.2'], ['opus', 'opus']].reduce(function (p, o) {
      return p.then(function (found) {
        if (found) return found;
        var cfg = { codec: o[1], sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 };
        return AudioEncoder.isConfigSupported(cfg).then(function (r) { return r.supported ? { mux: o[0], cfg: cfg } : null; }, function () { return null; });
      });
    }, Promise.resolve(null));
  }
  function pickMime() {
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) return '';
    var list = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    for (var i = 0; i < list.length; i++) { try { if (MediaRecorder.isTypeSupported(list[i])) return list[i]; } catch (e) { /* skip */ } }
    return '';
  }
  function decodeAudio(ac, blob) {
    return blob.arrayBuffer().then(function (buf) {
      return new Promise(function (res) { var p = ac.decodeAudioData(buf, res, function () { res(null); }); if (p && p.then) p.then(res, function () { res(null); }); });
    }).catch(function () { return null; });
  }
  // All the sound of the finished video, mixed on the device: each clip's own sound at its place, plus music.
  function mixAudio(T) {
    var needs = clips.some(function (c) { return !c.mute && (c.vol == null || c.vol > 0) && c.audio !== false; }) || !!music;
    if (!needs) return Promise.resolve(null);
    var Off = window.OfflineAudioContext || window.webkitOfflineAudioContext, AC = window.AudioContext || window.webkitAudioContext;
    if (!Off || !AC) return Promise.resolve(null);
    var dec = new AC(), cache = {}, len = Math.max(1, Math.ceil(T * 48000));
    var off = new Off(2, len, 48000), tl = timeline(), any = false;
    var jobs = clips.map(function (c, i) {
      if (c.mute || (c.vol != null && c.vol <= 0) || c.audio === false) return Promise.resolve();
      cache[c.blobId] = cache[c.blobId] || decodeAudio(dec, blobs[c.blobId].blob);
      return cache[c.blobId].then(function (b) {
        if (!b) return;
        any = true;
        var src = off.createBufferSource(), g = off.createGain(); src.buffer = b; g.gain.value = c.vol == null ? 1 : c.vol;
        src.connect(g); g.connect(off.destination);
        var L = clipLen(c), st = tl.starts[i];
        // short fades at the joins so cuts never click
        g.gain.setValueAtTime(0, st); g.gain.linearRampToValueAtTime(g.gain.value || 1, st + 0.012);
        g.gain.setValueAtTime(c.vol == null ? 1 : c.vol, Math.max(st + 0.013, st + L - 0.012)); g.gain.linearRampToValueAtTime(0, st + L);
        src.start(st, c.in, L);
      });
    });
    if (music) jobs.push(decodeAudio(dec, blobs[music.blobId].blob).then(function (b) {
      if (!b) return;
      any = true;
      var src = off.createBufferSource(), g = off.createGain(), v = S.musicVol / 100;
      src.buffer = b; src.loop = true; src.connect(g); g.connect(off.destination);
      g.gain.setValueAtTime(v, 0); g.gain.setValueAtTime(v, Math.max(0, T - 1.5)); g.gain.linearRampToValueAtTime(0, T);
      src.start(0);
    }));
    return Promise.all(jobs).then(function () { try { dec.close(); } catch (e) { /* ignore */ } return any ? off.startRendering() : null; });
  }
  function opusHead(preSkip) {
    var b = new Uint8Array(19), dv = new DataView(b.buffer);
    'OpusHead'.split('').forEach(function (ch, i) { b[i] = ch.charCodeAt(0); });
    b[8] = 1; b[9] = 2; dv.setUint16(10, preSkip, true); dv.setUint32(12, 48000, true); dv.setInt16(16, 0, true); b[18] = 0;
    return b.buffer;
  }
  // Some browsers label Opus sound in MP4 with 80 ms of start-up padding instead of the real 6.5 ms,
  // which makes players cut real sound (the voice would run ahead of the picture). Correct the number.
  function fixOpusDelay(blob) {
    if (!/mp4/.test(blob.type)) return Promise.resolve(blob);
    return blob.arrayBuffer().then(function (buf) {
      var u = new Uint8Array(buf), fixed = false;
      for (var i = 4; i < u.length - 12; i++) {
        if (u[i] === 0x64 && u[i + 1] === 0x4F && u[i + 2] === 0x70 && u[i + 3] === 0x73) {
          if (((u[i + 6] << 8) | u[i + 7]) === 3840) { u[i + 6] = 312 >> 8; u[i + 7] = 312 & 255; fixed = true; }
          break;
        }
      }
      return fixed ? new Blob([u], { type: blob.type }) : blob;
    }, function () { return blob; });
  }
  function exportVideo() {
    if (!clips.length || rec) return;
    stopPreview();
    var fast = window.VideoEncoder && window.VideoFrame && window.Mp4Muxer && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
    var d = dims(), W = d.W, H = d.H, tl = timeline(), T = tl.total, frames = Math.max(1, Math.ceil(T * FPS));
    rec = { cancelled: false };
    $('exportProg').hidden = false; $('result').hidden = true; $('exportBtn').disabled = true; $('playBtn').disabled = true;
    $('exportBar').style.width = '0%'; $('exportText').textContent = 'Mixing the sound…';
    var canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    mixAudio(T).then(function (mix) {
      if (rec.cancelled) throw new Error('cancelled');
      if (!fast) return recordVideo(canvas, ctx, mix, T);
      return Promise.all([pickVideoCodec(W, H), mix ? pickAudioCodec() : Promise.resolve(null)]).then(function (r) {
        var vc = r[0], acodec = r[1];
        if (!vc || (mix && !acodec)) return recordVideo(canvas, ctx, mix, T);   // can't encode here: real-time recorder keeps the sound
        return encodeVideo(canvas, ctx, mix, T, frames, vc, acodec);
      });
    }).then(function (out) {
      if (!out) return;
      return fixOpusDelay(out.blob).then(function (b) { showResult(b, out.type, T, W, H); });
    }).catch(function (e) {
      if (e && e.message === 'cancelled') YB.toast('Video cancelled');
      else { console.error('[Formatter] export failed', e); YB.toast('The video couldn\'t be made: ' + (e && e.message || e)); }
    }).then(function () {
      rec = null; $('exportProg').hidden = true; $('playBtn').disabled = false; renderFacts(); renderSteps();
      stash.querySelectorAll('video[data-export]').forEach(function (v) { v.pause(); v.removeAttribute('src'); v.load(); v.remove(); });
    });
  }
  function exportEl(c) {
    var v = document.createElement('video');
    v.preload = 'auto'; v.muted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.dataset.export = '1';
    v.src = blobUrl(c.blobId); stash.appendChild(v);
    return v;
  }
  function once(el, ev, ms) {
    return new Promise(function (res, rej) {
      var t = setTimeout(function () { el.removeEventListener(ev, h); rej(new Error(ev + ' timed out')); }, ms || 15000);
      function h() { clearTimeout(t); el.removeEventListener(ev, h); res(); }
      el.addEventListener(ev, h);
    });
  }
  function seekEl(v, t) {
    if (v.readyState >= 1 && Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return Promise.resolve();
    var p = once(v, 'seeked', 15000); v.currentTime = t; return p;
  }
  // Fast, exact path: every frame the clip shows is captured with its own time (requestVideoFrameCallback),
  // encoded with WebCodecs, and packed into an MP4 together with the mixed sound.
  function encodeVideo(canvas, ctx, mix, T, frames, vc, acodec) {
    var W = canvas.width, H = canvas.height, tl = timeline(), failed = null;
    var target = new Mp4Muxer.ArrayBufferTarget();
    var muxer = new Mp4Muxer.Muxer({ target: target, fastStart: 'in-memory', firstTimestampBehavior: 'cross-track-offset',
      video: { codec: vc.mux, width: W, height: H, frameRate: FPS },
      audio: mix ? { codec: acodec.mux, numberOfChannels: 2, sampleRate: 48000 } : undefined });
    var vEnc = new VideoEncoder({ output: function (c, m) { muxer.addVideoChunk(c, m); }, error: function (e) { failed = failed || e; } });
    vEnc.configure(vc.cfg);
    var audioDone = Promise.resolve();
    if (mix) {
      var gotHead = false;
      var aEnc = new AudioEncoder({ output: function (c, m) {
        if (acodec.mux === 'opus') {
          if (!gotHead) { var dc = m && m.decoderConfig, ds = dc && dc.description; if (!ds || ds.byteLength < 18) m = { decoderConfig: { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, description: opusHead(312) } }; gotHead = true; }
          else m = undefined;
        }
        muxer.addAudioChunk(c, m);
      }, error: function (e) { failed = failed || e; } });
      aEnc.configure(acodec.cfg);
      var L = mix.getChannelData(0), R = mix.numberOfChannels > 1 ? mix.getChannelData(1) : L;
      for (var o = 0; o < mix.length; o += 4800) {
        var n = Math.min(4800, mix.length - o), data = new Float32Array(n * 2);
        data.set(L.subarray(o, o + n), 0); data.set(R.subarray(o, o + n), n);
        var ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(o / 48000 * 1e6), data: data });
        aEnc.encode(ad); ad.close();
      }
      audioDone = aEnc.flush().then(function () { aEnc.close(); });
    }
    var fi = 0;
    function emitUntil(t) {   // output frames whose time is before t show what's on the canvas now
      while (fi < frames && fi / FPS < t - 1e-6) {
        var vf = new VideoFrame(canvas, { timestamp: Math.round(fi * 1e6 / FPS), duration: Math.round(1e6 / FPS) });
        vEnc.encode(vf, { keyFrame: fi % (FPS * 2) === 0 }); vf.close(); fi++;
      }
      $('exportBar').style.width = (fi / frames * 100).toFixed(1) + '%';
      $('exportText').textContent = 'Making the video… ' + Math.round(fi / frames * 100) + '% · ' + mmss(fi / FPS) + ' of ' + mmss(T);
    }
    function drain() { return vEnc.encodeQueueSize > 8 ? new Promise(function (r) { setTimeout(r, 15); }).then(drain) : Promise.resolve(); }
    function captureClip(i) {
      var c = clips[i], st = tl.starts[i], len = clipLen(c), v = exportEl(c);
      return once(v, 'loadeddata', 20000).catch(function () {}).then(function () { return seekEl(v, c.in); }).then(function () {
        drawFrame(ctx, W, H, st, v, i, false);
        return new Promise(function (resolve, reject) {
          var finished = false, lastCb = performance.now(), busy = false;
          function finish() {
            if (finished) return; finished = true; clearInterval(watch);
            v.pause();
            emitUntil(st + len);
            resolve();
          }
          function onFrame(now, md) {
            if (finished) return;
            lastCb = performance.now();
            if (rec.cancelled) { finished = true; clearInterval(watch); v.pause(); reject(new Error('cancelled')); return; }
            if (failed) { finished = true; clearInterval(watch); v.pause(); reject(failed); return; }
            var mt = md && typeof md.mediaTime === 'number' ? md.mediaTime : v.currentTime;
            var t = st + clamp(mt - c.in, 0, len);
            emitUntil(t);                                   // frames before this one keep the previous picture
            if (mt >= c.out - 0.5 / FPS) { finish(); return; }
            drawFrame(ctx, W, H, t, v, i, false);
            if (vEnc.encodeQueueSize > 20 && !busy) {        // let the encoder catch up (pause, then carry on)
              busy = true; v.pause();
              drain().then(function () { busy = false; if (!finished) { v.requestVideoFrameCallback(onFrame); v.play().catch(function () {}); } });
              return;
            }
            v.requestVideoFrameCallback(onFrame);
          }
          var watch = setInterval(function () {
            if (finished) return;
            if (rec.cancelled) { onFrame(0, null); return; }
            if (v.ended || v.currentTime >= c.out - 0.5 / FPS) { finish(); return; }
            if (!busy && performance.now() - lastCb > 3000) { lastCb = performance.now(); v.play().catch(function () {}); }   // nudge a stalled decoder
          }, 250);
          v.addEventListener('ended', finish);
          v.requestVideoFrameCallback(onFrame);
          v.play().catch(function (e) { finished = true; clearInterval(watch); reject(e); });
        });
      });
    }
    var chain = Promise.resolve();
    clips.forEach(function (c, i) { chain = chain.then(function () { if (rec.cancelled) throw new Error('cancelled'); return captureClip(i); }); });
    return chain.then(function () {
      emitUntil(T + 1);
      $('exportText').textContent = 'Finishing…';
      return Promise.all([vEnc.flush(), audioDone]);
    }).then(function () {
      if (failed) throw failed;
      vEnc.close(); muxer.finalize();
      return { blob: new Blob([target.buffer], { type: 'video/mp4' }), type: 'video/mp4' };
    }, function (e) { try { vEnc.close(); } catch (x) { /* closed */ } throw e; });
  }
  // Real-time recorder (any browser with MediaRecorder): the sound plays on the audio clock and every
  // clip follows that clock, so picture and sound can't drift apart.
  function recordVideo(canvas, ctx, mix, T) {
    var mime = pickMime(); if (!mime) return Promise.reject(new Error('This browser can\'t make videos — use Chrome, Edge or Safari'));
    var W = canvas.width, H = canvas.height, tl = timeline();
    var stream = canvas.captureStream(FPS), AC = window.AudioContext || window.webkitAudioContext, ac = new AC(), src = null;
    if (mix) {
      var dest = ac.createMediaStreamDestination(); src = ac.createBufferSource(); src.buffer = mix; src.connect(dest);
      dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
    }
    var els = clips.map(function (c) { return exportEl(c); });
    return Promise.all(els.map(function (v, i) { return once(v, 'loadeddata', 20000).catch(function () {}).then(function () { return seekEl(v, clips[i].in); }); })).then(function () {
      return (ac.state === 'suspended' ? ac.resume() : Promise.resolve());
    }).then(function () {
      return new Promise(function (resolve, reject) {
        var chunks = [], mr;
        try { mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: W * H > 2e6 ? 12e6 : 8e6, audioBitsPerSecond: 192000 }); }
        catch (e) { mr = new MediaRecorder(stream); }
        mr.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
        mr.onstop = function () {
          stream.getTracks().forEach(function (tr) { tr.stop(); });
          try { ac.close(); } catch (e) { /* closed */ }
          if (rec && rec.cancelled) { reject(new Error('cancelled')); return; }
          var type = (mr.mimeType || mime).split(';')[0];
          resolve({ blob: new Blob(chunks, { type: type }), type: type });
        };
        var t0 = 0, cur = -1, stopped = false;
        function clock() { return Math.max(0, ac.currentTime - t0); }
        function frame() {
          if (stopped) return;
          var t = clock();
          if (rec.cancelled || t >= T) { stopped = true; try { src && src.stop(); } catch (e) { /* stopped */ } els.forEach(function (v) { v.pause(); }); setTimeout(function () { mr.stop(); }, 150); return; }
          var i = clipAt(t, tl), c = clips[i], v = els[i], want = c.in + (t - tl.starts[i]);
          if (i !== cur) { if (cur >= 0) els[cur].pause(); cur = i; try { v.currentTime = want; } catch (e) { /* ignore */ } v.play().catch(function () {}); }
          else if (Math.abs(v.currentTime - want) > 0.2) { try { v.currentTime = want; } catch (e) { /* ignore */ } }   // keep the picture on the sound's clock
          if (i + 1 < clips.length && tl.starts[i + 1] - t < 1 && Math.abs(els[i + 1].currentTime - clips[i + 1].in) > 0.05) { try { els[i + 1].currentTime = clips[i + 1].in; } catch (e) { /* ignore */ } }
          drawFrame(ctx, W, H, t, v, i, false);
          $('exportBar').style.width = Math.min(100, t / T * 100).toFixed(1) + '%';
          $('exportText').textContent = 'Recording ' + mmss(t) + ' of ' + mmss(T);
          requestAnimationFrame(frame);
        }
        var keep = setInterval(function () { if (stopped) clearInterval(keep); else if (document.hidden) frame(); }, 1000 / FPS);
        drawFrame(ctx, W, H, 0, els[0], 0, false);
        mr.start(1000);
        t0 = ac.currentTime + 0.12;
        if (src) src.start(t0);
        requestAnimationFrame(frame);
      });
    });
  }
  function showResult(blob, type, T, W, H) {
    if (lastVideo) URL.revokeObjectURL(lastVideo);
    lastVideo = URL.createObjectURL(blob);
    var ext = /mp4/.test(type) ? 'mp4' : 'webm';
    $('resultVideo').src = lastVideo;
    $('downloadBtn').href = lastVideo;
    $('downloadBtn').download = 'youtube-blue-' + S.format + '-' + new Date().toISOString().slice(0, 10) + '.' + ext;
    $('resultInfo').textContent = W + '×' + H + ' · ' + mmss(T) + ' · ' + ext.toUpperCase() + ' · ' + (blob.size / 1048576).toFixed(1) + ' MB';
    $('result').hidden = false;
    YB.toast('Your video is ready');
  }

  /* ---------- Wiring ---------- */
  function wire() {
    var drop = $('dropZone');
    $('videoFiles').addEventListener('change', function () { addFiles(this.files); this.value = ''; });
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); }); });
    drop.addEventListener('drop', function (e) { if (e.dataTransfer) addFiles(e.dataTransfer.files); });

    $('clipList').addEventListener('click', function (e) {
      var li = e.target.closest('li[data-id]'); if (!li) return;
      var i = clips.findIndex(function (c) { return c.id === li.getAttribute('data-id'); }); if (i < 0) return;
      if (e.target.closest('[data-up]') && i > 0) { var t = clips[i - 1]; clips[i - 1] = clips[i]; clips[i] = t; }
      else if (e.target.closest('[data-down]') && i < clips.length - 1) { var t2 = clips[i + 1]; clips[i + 1] = clips[i]; clips[i] = t2; }
      else if (e.target.closest('[data-del]')) {
        if (!confirm('Remove "' + clips[i].name + '"?')) return;
        var gone = clips.splice(i, 1)[0];
        if (gone._el) { gone._el.pause(); gone._el.remove(); }
        if (!clips.some(function (c) { return c.blobId === gone.blobId; })) { delBlob(gone.blobId); }
      } else if (e.target.closest('[data-reset]')) { clips[i].zoom = 1; clips[i].ox = 0; clips[i].oy = 0; }
      else if (!e.target.closest('input,label,button')) { stopPreview(); seekTo(timeline().starts[i] + 0.01); return; }
      else return;
      stopPreview(); saveProject(); renderAll(); seekTo(Math.min(pv.t, timeline().total));
    });
    $('clipList').addEventListener('input', function (e) {
      var li = e.target.closest('li[data-id]'), k = e.target.getAttribute('data-k'); if (!li || !k) return;
      var c = clips.find(function (x) { return x.id === li.getAttribute('data-id'); }); if (!c) return;
      if (k === 'zoom') { c.zoom = clamp(+e.target.value / 100, 0.5, 3); e.target.previousElementSibling.querySelector('b').textContent = e.target.value + '%'; drawPreview(); saveProject(); }
      if (k === 'vol') { c.vol = clamp(+e.target.value / 100, 0, 1); e.target.previousElementSibling.querySelector('b').textContent = e.target.value + '%'; if (c._el) c._el.volume = c.vol; saveProject(); }
    });
    $('clipList').addEventListener('change', function (e) {
      var li = e.target.closest('li[data-id]'), k = e.target.getAttribute('data-k'); if (!li || !k) return;
      var c = clips.find(function (x) { return x.id === li.getAttribute('data-id'); }); if (!c) return;
      if (k === 'in') c.in = clamp(+e.target.value || 0, 0, Math.max(0, c.out - 0.1));
      else if (k === 'out') c.out = clamp(+e.target.value || c.dur, c.in + 0.1, c.dur || 1e5);
      else if (k === 'mute') c.mute = e.target.checked;
      else if (k === 'zoom' || k === 'vol') { renderClips(); return; }
      stopPreview(); saveProject(); renderAll(); seekTo(Math.min(pv.t, timeline().total));
    });

    $('formatSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-format]'); if (!b) return; S.format = b.getAttribute('data-format'); saveSettings(); overlays.forEach(function (o) { o._b = null; }); renderAll(); });
    document.querySelectorAll('[data-fit]').forEach(function (b) { b.addEventListener('click', function () { S.fit = b.getAttribute('data-fit'); saveSettings(); renderFormats(); drawPreview(); }); });
    $('bgList').addEventListener('click', function (e) { var b = e.target.closest('[data-bg]'); if (!b || b.disabled) return; S.bg = b.getAttribute('data-bg'); saveSettings(); renderFormats(); drawPreview(); });
    $('frameList').addEventListener('click', function (e) { var b = e.target.closest('[data-frame]'); if (!b) return; S.frame = b.getAttribute('data-frame'); saveSettings(); renderFormats(); drawPreview(); });
    $('bgColor').addEventListener('input', function () { S.bgColor = this.value; S.bg = 'color'; saveSettings(); renderFormats(); drawPreview(); });
    $('frameColor').addEventListener('input', function () { S.frameColor = this.value; saveSettings(); drawPreview(); });
    $('transition').addEventListener('change', function () { S.transition = this.value; saveSettings(); drawPreview(); });
    $('pad').addEventListener('input', function () { S.pad = +this.value; $('padVal').textContent = S.pad + '%'; saveSettings(); drawPreview(); });
    $('bgFile').addEventListener('change', function () {
      var f = this.files[0]; this.value = ''; if (!f || !/^image\//.test(f.type)) return;
      var id = 'b' + YB.uid(); if (bgImage) delBlob(bgImage.blobId);
      addBlob(id, f); putBlob(id, f);
      var im = new Image(); im.onload = function () { drawPreview(); renderFormats(); }; im.src = blobUrl(id);
      bgImage = { blobId: id, img: im }; S.bg = 'image'; saveSettings(); saveProject(); renderFormats();
    });
    $('musicFile').addEventListener('change', function () {
      var f = this.files[0]; this.value = ''; if (!f) return;
      var id = 'm' + YB.uid(); if (music) delBlob(music.blobId);
      addBlob(id, f); putBlob(id, f); music = { blobId: id, name: f.name };
      if (pv.music) { pv.music.pause(); pv.music.src = ''; }
      saveProject(); renderFormats(); renderFacts();
    });
    $('musicDel').addEventListener('click', function () { if (!music) return; delBlob(music.blobId); music = null; if (pv.music) pv.music.pause(); saveProject(); renderFormats(); renderFacts(); });
    $('musicVol').addEventListener('input', function () { S.musicVol = +this.value; $('musicVolVal').textContent = S.musicVol + '%'; if (pv.music) pv.music.volume = S.musicVol / 100; saveSettings(); });

    document.querySelectorAll('[data-add]').forEach(function (b) { b.addEventListener('click', function () { addOverlay(b.getAttribute('data-add')); }); });
    $('imgFile').addEventListener('change', function () { addImage(this.files[0]); this.value = ''; });
    $('ovList').addEventListener('click', function (e) {
      var li = e.target.closest('[data-ov]'); if (!li) return;
      sel = li.getAttribute('data-ov'); var o = overlays.find(function (k) { return k.id === sel; });
      if (o && o.type !== 'progress' && !visibleAt(o, pv.t)) seekTo((o.start || 0) + 0.05);
      renderOverlays(); drawPreview();
    });
    var ed = $('ovEditor');
    ed.addEventListener('input', function (e) {
      var k = e.target.getAttribute('data-o'), o = overlays.find(function (x) { return x.id === sel; }); if (!k || !o) return;
      if (e.target.type === 'number' || e.target.tagName === 'SELECT') return;   // applied on change
      setOv(o, k, e.target);
      var lbl = e.target.closest('label'), b = lbl && lbl.querySelector('b');
      if (b && e.target.type === 'range') b.textContent = k === 'opacity' ? (100 - +e.target.value) + '%' : k === 'w' || k === 'wrap' ? e.target.value + '%' : e.target.value;
      if (k === 'text') { var li = $('ovList').querySelector('[data-ov="' + o.id + '"] .fm-ov-name'); if (li) li.textContent = ovLabel(o); }
      saveProject(); drawPreview();
    });
    ed.addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-o'), o = overlays.find(function (x) { return x.id === sel; }); if (!k || !o) return;
      setOv(o, k, e.target); saveProject();
      if (k === 'style' || k === 'start' || k === 'end') renderOverlays(); else renderEditor();
      drawPreview();
    });
    ed.addEventListener('click', function (e) {
      var o = overlays.find(function (x) { return x.id === sel; }); if (!o) return;
      var b = e.target.closest('[data-ol],[data-ot]'); if (!b) return;
      var act = b.getAttribute('data-ol') || b.getAttribute('data-ot'), i = overlays.indexOf(o);
      if (act === 'del') { overlays.splice(i, 1); sel = ''; }
      else if (act === 'up' && i < overlays.length - 1) { overlays[i] = overlays[i + 1]; overlays[i + 1] = o; }
      else if (act === 'down' && i > 0) { overlays[i] = overlays[i - 1]; overlays[i - 1] = o; }
      else if (act === 'center') { o.x = 0.5; o.y = 0.5; }
      else if (act === 'dup') { var c = {}; Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_' || k === '_img') c[k] = o[k]; }); c.id = YB.uid(); c.y = clamp((o.y || 0.5) + 0.06, 0, 1); overlays.push(c); sel = c.id; }
      else if (act === 'now') { o.start = Math.round(pv.t * 10) / 10; if (o.end != null && o.end <= o.start) o.end = null; }
      else if (act === 'nowend') { o.end = Math.max((o.start || 0) + 0.1, Math.round(pv.t * 10) / 10); }
      else if (act === 'all') { o.start = 0; o.end = null; }
      saveProject(); renderOverlays(); renderSteps(); renderFacts(); drawPreview();
    });
    document.addEventListener('keydown', function (e) {
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '')) {
        overlays = overlays.filter(function (o) { return o.id !== sel; }); sel = ''; saveProject(); renderOverlays(); drawPreview();
      }
    });

    $('playBtn').addEventListener('click', function () { if (pv.playing) stopPreview(); else startPreview(); });
    $('scrub').addEventListener('input', function () { stopPreview(); seekTo(+this.value / 1000 * timeline().total); });
    $('moveVideoBtn').addEventListener('click', function () { moveVideo = !moveVideo; this.setAttribute('aria-pressed', moveVideo); this.classList.toggle('on', moveVideo); if (moveVideo) { sel = ''; renderOverlays(); } drawPreview(); });
    $('splitBtn').addEventListener('click', function () {
      if (!clips.length) return;
      var tl = timeline(), i = clipAt(pv.t, tl), c = clips[i], at = c.in + (pv.t - tl.starts[i]);
      if (at - c.in < 0.2 || c.out - at < 0.2) { YB.toast('Move the playhead inside a clip to split it'); return; }
      stopPreview();
      var b = Object.assign({}, c, { id: YB.uid(), in: at, _el: null }); delete b._el;
      c.out = at; clips.splice(i + 1, 0, b);
      saveProject(); renderAll(); seekTo(pv.t); YB.toast('Split into two clips');
    });
    $('setInBtn').addEventListener('click', function () {
      if (!clips.length) return; var tl = timeline(), i = clipAt(pv.t, tl), c = clips[i], at = c.in + (pv.t - tl.starts[i]);
      if (c.out - at < 0.1) return; stopPreview(); c.in = at; saveProject(); renderAll(); seekTo(tl.starts[i]);
    });
    $('setOutBtn').addEventListener('click', function () {
      if (!clips.length) return; var tl = timeline(), i = clipAt(pv.t, tl), c = clips[i], at = c.in + (pv.t - tl.starts[i]);
      if (at - c.in < 0.1) return; stopPreview(); c.out = at; saveProject(); renderAll(); seekTo(pv.t);
    });
    $('exportBtn').addEventListener('click', exportVideo);
    $('cancelBtn').addEventListener('click', function () { if (rec) rec.cancelled = true; });
    window.addEventListener('resize', YB.debounce(function () { sizePreview(); drawPreview(); }, 150));
    wirePointer();
  }

  /* ---------- Start ---------- */
  function restore() {
    return kv('readonly', function (st, out) { var r = st.get('project'); r.onsuccess = function () { out.v = r.result; }; }).then(function (data) {
      if (!data) return;
      var ids = [];
      (data.clips || []).forEach(function (c) { if (ids.indexOf(c.blobId) === -1) ids.push(c.blobId); });
      (data.overlays || []).forEach(function (o) { if (o.blobId) ids.push(o.blobId); });
      if (data.music) ids.push(data.music.blobId);
      if (data.bgImage) ids.push(data.bgImage.blobId);
      return Promise.all(ids.map(function (id) { return getBlob(id).then(function (b) { if (b) addBlob(id, b); }); })).then(function () {
        clips = (data.clips || []).filter(function (c) { return blobs[c.blobId]; });
        overlays = (data.overlays || []).filter(function (o) { return o.type !== 'image' || blobs[o.blobId]; });
        music = data.music && blobs[data.music.blobId] ? data.music : null;
        if (data.bgImage && blobs[data.bgImage.blobId]) { var im = new Image(); im.onload = function () { drawPreview(); }; im.src = blobUrl(data.bgImage.blobId); bgImage = { blobId: data.bgImage.blobId, img: im }; }
        if (S.bg === 'image' && !bgImage) S.bg = 'blur';
        return Promise.all(overlays.filter(function (o) { return o.type === 'image'; }).map(loadOvImage)).then(function () {
          // thumbnails aren't saved — make them again
          clips.forEach(function (c) {
            var v = document.createElement('video'); v.muted = true; v.preload = 'auto'; v.src = blobUrl(c.blobId);
            v.onloadeddata = function () { try { v.currentTime = Math.min(c.in + 0.5, c.out); } catch (e) { /* ignore */ } };
            v.onseeked = function () { var cv = document.createElement('canvas'), s = 160 / Math.max(v.videoWidth || 160, v.videoHeight || 90); cv.width = Math.round((v.videoWidth || 160) * s); cv.height = Math.round((v.videoHeight || 90) * s); try { cv.getContext('2d').drawImage(v, 0, 0, cv.width, cv.height); c.thumb = cv.toDataURL('image/jpeg', 0.7); } catch (e) { /* ignore */ } v.onseeked = null; v.removeAttribute('src'); v.load(); renderClips(); };
          });
        });
      });
    });
  }

  window.YBFormatter = {   // used by tests
    timeline: timeline, frame: function (x, W, H, t) { var ci = clipAt(t); drawFrame(x, W, H, t, clips[ci] ? elFor(clips[ci]) : null, ci, false); },
    state: function () { return { S: S, clips: clips.map(function (c) { return { in: c.in, out: c.out, dur: c.dur, vw: c.vw, vh: c.vh, zoom: c.zoom, ox: c.ox, oy: c.oy, mute: c.mute }; }), overlays: overlays.map(function (o) { return { type: o.type, x: o.x, y: o.y, size: o.size, w: o.w, text: o.text, start: o.start, end: o.end, b: o._b }; }) }; },
    seek: function (t) { seekTo(t); }
  };
  wire();
  restore().then(function () { renderAll(); seekTo(0); });
})();
