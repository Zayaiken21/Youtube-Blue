/* =========================================================
   Youtube Blue — showcase-fx.js · effect library for Photo Showcase videos
   120+ effects made on the device (no downloads, no accounts, free forever):
   colour looks, light leaks & flares, particles, film & retro, glitch & art,
   movement, frames, barber and emoji effects. Every effect is drawn from the
   time alone, so the preview and the exported video always match.
   window.YBFX = { cats, list, byId, apply(x, W, H, items, ctx) }
     items: [{ id, s }]   s = strength (0.6 light · 1 medium · 1.5 strong)
     ctx:   { t, u, dur, beat: { k, down }, color, idx, count }
   ========================================================= */
(function () {
  'use strict';

  /* ---------- helpers ---------- */
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rnd(i, k) { var x = Math.sin(i * 127.1 + k * 311.7 + 0.5) * 43758.5453; return x - Math.floor(x); }
  function easeOut(p) { p = clamp(p, 0, 1); return 1 - Math.pow(1 - p, 3); }
  function bounce(p) { p = clamp(p, 0, 1); var n = 7.5625, d = 2.75; if (p < 1 / d) return n * p * p; if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75; if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375; return n * (p -= 2.625 / d) * p + 0.984375; }
  function hexA(h, a) { var n = parseInt(String(h || '#ffffff').slice(1), 16); return 'rgba(' + (n >> 16 & 255) + ',' + (n >> 8 & 255) + ',' + (n & 255) + ',' + a + ')'; }
  var pool = {};
  function tmp(slot, W, H) { var c = pool[slot] || (pool[slot] = document.createElement('canvas')); if (c.width !== W || c.height !== H) { c.width = W; c.height = H; } return c; }
  function copy(x, W, H, slot) { var c = tmp(slot || 'a', W, H), g = c.getContext('2d'); g.globalCompositeOperation = 'copy'; g.globalAlpha = 1; g.drawImage(x.canvas, 0, 0); g.globalCompositeOperation = 'source-over'; return c; }
  function blurOf(src, W, H, k, slot) {   // fast big blur: shrink, then stretch with smoothing
    var w = Math.max(4, Math.round(W / k)), h = Math.max(4, Math.round(H / k)), c = tmp(slot || 'blur', w, h), g = c.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h); return c;
  }
  var sprites = {};
  function glowSprite(color, r) {
    var key = 'g' + color + r; if (sprites[key]) return sprites[key];
    var c = document.createElement('canvas'); c.width = c.height = r * 2; var g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
    gr.addColorStop(0, hexA(color, 1)); gr.addColorStop(0.25, hexA(color, 0.55)); gr.addColorStop(1, hexA(color, 0)); g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2);
    return (sprites[key] = c);
  }
  function emojiSprite(ch, px) {
    px = Math.max(8, Math.round(px / 8) * 8); var key = 'e' + ch + px; if (sprites[key]) return sprites[key];
    var c = document.createElement('canvas'); c.width = c.height = Math.round(px * 1.3); var g = c.getContext('2d');
    g.font = px + 'px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, c.width / 2, c.height / 2 + px * 0.06);
    return (sprites[key] = c);
  }
  var noiseTile = null, paperTile = null;
  function noise() {
    if (noiseTile) return noiseTile;
    noiseTile = document.createElement('canvas'); noiseTile.width = noiseTile.height = 160;
    var g = noiseTile.getContext('2d'), id = g.createImageData(160, 160), d = id.data, s = 11;
    for (var i = 0; i < d.length; i += 4) { s = (s * 16807) % 2147483647; var v = 128 + (s % 140) - 70; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
    g.putImageData(id, 0, 0); return noiseTile;
  }
  function paper() {
    if (paperTile) return paperTile;
    var small = document.createElement('canvas'); small.width = small.height = 24; var g = small.getContext('2d'), id = g.createImageData(24, 24), d = id.data;
    for (var i = 0; i < d.length; i += 4) { var v = 110 + rnd(i, 3) * 60; d[i] = v + 10; d[i + 1] = v + 6; d[i + 2] = v - 8; d[i + 3] = 255; }
    g.putImageData(id, 0, 0);
    paperTile = document.createElement('canvas'); paperTile.width = paperTile.height = 384; var p = paperTile.getContext('2d'); p.imageSmoothingEnabled = true; p.drawImage(small, 0, 0, 384, 384);
    return paperTile;
  }
  function tile(x, W, H, img, blend, alpha, ox, oy, scale) {
    x.save(); x.globalCompositeOperation = blend; x.globalAlpha = clamp(alpha, 0, 1);
    var pat = x.createPattern(img, 'repeat'), sc = scale || 1; x.translate(-(ox % img.width) * sc, -(oy % img.height) * sc); x.scale(sc, sc);
    x.fillStyle = pat; x.fillRect(0, 0, W / sc + img.width * 2, H / sc + img.height * 2); x.restore();
  }
  function heart(x, cx, cy, r) { x.beginPath(); x.moveTo(cx, cy + r * 0.35); x.bezierCurveTo(cx - r * 1.1, cy - r * 0.45, cx - r * 0.45, cy - r * 1.15, cx, cy - r * 0.45); x.bezierCurveTo(cx + r * 0.45, cy - r * 1.15, cx + r * 1.1, cy - r * 0.45, cx, cy + r * 0.35); x.closePath(); }
  function star(x, cx, cy, r, pts, inner) { x.beginPath(); for (var i = 0; i < pts * 2; i++) { var a = i * Math.PI / pts - Math.PI / 2, rr = i % 2 ? r * (inner || 0.45) : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); }
  function rr(x, X, Y, w, h, r, keep) { r = Math.min(r, w / 2, h / 2); if (!keep) x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + w, Y, X + w, Y + h, r); x.arcTo(X + w, Y + h, X, Y + h, r); x.arcTo(X, Y + h, X, Y, r); x.arcTo(X, Y, X + w, Y, r); x.closePath(); }

  /* ---------- 1 · Movement (moves the whole picture) ---------- */
  function move(x, W, H, m) {
    var c = copy(x, W, H, 'mv'), sc = m.sc || 1, rot = m.rot || 0, dx = m.dx || 0, dy = m.dy || 0, ox = m.ox == null ? 0.5 : m.ox, oy = m.oy == null ? 0.5 : m.oy;
    sc *= 1 + (Math.abs(dx) / W + Math.abs(dy) / H) * 2 + Math.abs(rot) * 1.3;   // never show an empty edge
    x.save(); x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
    x.translate(W * ox + dx, H * oy + dy); x.rotate(rot); x.scale(sc * (m.sx || 1), sc * (m.sy || 1)); x.translate(-W * ox, -H * oy);
    x.imageSmoothingEnabled = true; x.drawImage(c, 0, 0); x.restore();
  }
  function shakeAt(t, a) { return { x: (Math.sin(t * 41) + Math.sin(t * 67 + 1.3) * 0.6) * a, y: (Math.cos(t * 37) + Math.sin(t * 59 + 2.1) * 0.6) * a }; }
  var MOTION = {
    zoomIn: function (x, W, H, c, s) { move(x, W, H, { sc: 1 + 0.14 * s * clamp(c.u / c.dur, 0, 1) }); },
    zoomOut: function (x, W, H, c, s) { move(x, W, H, { sc: 1 + 0.14 * s * (1 - clamp(c.u / c.dur, 0, 1)) }); },
    punch: function (x, W, H, c, s) { move(x, W, H, { sc: 1 + 0.22 * s * Math.exp(-c.u / 0.22) }); },
    faceZoom: function (x, W, H, c, s) { move(x, W, H, { sc: 1 + 0.25 * s * easeOut(c.u / c.dur), ox: 0.5, oy: 0.38 }); },
    panL: function (x, W, H, c, s) { move(x, W, H, { sc: 1.06, dx: (0.5 - clamp(c.u / c.dur, 0, 1)) * W * 0.08 * s }); },
    panR: function (x, W, H, c, s) { move(x, W, H, { sc: 1.06, dx: (clamp(c.u / c.dur, 0, 1) - 0.5) * W * 0.08 * s }); },
    panU: function (x, W, H, c, s) { move(x, W, H, { sc: 1.06, dy: (0.5 - clamp(c.u / c.dur, 0, 1)) * H * 0.08 * s }); },
    panD: function (x, W, H, c, s) { move(x, W, H, { sc: 1.06, dy: (clamp(c.u / c.dur, 0, 1) - 0.5) * H * 0.08 * s }); },
    shake: function (x, W, H, c, s) { var q = shakeAt(c.t, Math.min(W, H) * 0.006 * s); move(x, W, H, { dx: q.x, dy: q.y }); },
    buzz: function (x, W, H, c, s) { var q = shakeAt(c.t * 3, Math.min(W, H) * 0.0035 * s); move(x, W, H, { dx: q.x, dy: q.y }); },
    quake: function (x, W, H, c, s) { var q = shakeAt(c.t, Math.min(W, H) * 0.03 * s * c.beat.k); move(x, W, H, { dx: q.x, dy: q.y, rot: q.x / W * 0.6 }); },
    bounceBeat: function (x, W, H, c, s) { move(x, W, H, { sc: 1 + 0.045 * s * c.beat.k * (c.beat.down ? 1.4 : 1) }); },
    heartbeat: function (x, W, H, c, s) { var p = c.t % 1, k = Math.exp(-Math.pow((p - 0.1) / 0.05, 2)) + 0.7 * Math.exp(-Math.pow((p - 0.32) / 0.05, 2)); move(x, W, H, { sc: 1 + 0.04 * s * k }); },
    spinIn: function (x, W, H, c, s) { var e = easeOut(c.u / 0.7); move(x, W, H, { rot: -0.35 * s * (1 - e), sc: 1 + 0.35 * (1 - e) }); },
    dropIn: function (x, W, H, c, s) { move(x, W, H, { dy: -H * 0.45 * s * (1 - bounce(c.u / 0.9)) }); },
    slideIn: function (x, W, H, c, s) { move(x, W, H, { dx: -W * 0.6 * s * (1 - easeOut(c.u / 0.5)) }); },
    sway: function (x, W, H, c, s) { move(x, W, H, { rot: 0.025 * s * Math.sin(c.t * 1.6), sc: 1.02 }); },
    tilt: function (x, W, H, c, s) { move(x, W, H, { rot: 0.05 * s * (clamp(c.u / c.dur, 0, 1) - 0.5), sc: 1.03 }); },
    jelly: function (x, W, H, c, s) { var k = c.beat.k * 0.05 * s; move(x, W, H, { sx: 1 + k, sy: 1 - k * 0.6 }); },
    whip: function (x, W, H, c, s) {
      if (c.u > 0.4) return; var a = 1 - c.u / 0.4, src = copy(x, W, H, 'mv');
      x.save(); for (var i = 1; i <= 6; i++) { x.globalAlpha = 0.18 * a * s; x.drawImage(src, -i * W * 0.025 * a * s, 0); x.drawImage(src, i * W * 0.012 * a * s, 0); } x.restore();
    },
    zoomBurst: function (x, W, H, c, s) {   // fast zoom-blur as the photo arrives
      if (c.u > 0.5) return; var a = 1 - c.u / 0.5, src = copy(x, W, H, 'mv');
      x.save(); for (var i = 1; i <= 6; i++) { var k = 1 + i * 0.025 * a * s; x.globalAlpha = 0.16 * a; x.drawImage(src, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k); } x.restore();
    }
  };

  /* ---------- 2 · Colour looks (blend layers that work in every browser) ---------- */
  function grade(x, W, H, layers, s) {
    layers.forEach(function (L) {
      x.save(); x.globalCompositeOperation = L.b; x.globalAlpha = clamp(L.a * s, 0, 1);
      if (L.self) { x.drawImage(copy(x, W, H, 'gr'), 0, 0); }
      else {
        if (L.g) { var gr = L.dir === 'h' ? x.createLinearGradient(0, 0, W, 0) : L.dir === 'd' ? x.createLinearGradient(0, 0, W, H) : x.createLinearGradient(0, 0, 0, H); L.g.forEach(function (c, i) { gr.addColorStop(i / (L.g.length - 1), c); }); x.fillStyle = gr; }
        else x.fillStyle = L.c;
        x.fillRect(0, 0, W, H);
      }
      x.restore();
    });
  }
  var GRAY = '#808080';
  var GRADES = {
    warm: [{ b: 'soft-light', c: '#ff9a3c', a: 0.45 }],
    cool: [{ b: 'soft-light', c: '#3c8cff', a: 0.45 }],
    tealOrange: [{ b: 'soft-light', g: ['#1aa6b7', '#ff9f43'], a: 0.55 }, { b: 'overlay', self: true, a: 0.15 }],
    bw: [{ b: 'saturation', c: GRAY, a: 1 }, { b: 'overlay', self: true, a: 0.2 }],
    sepia: [{ b: 'saturation', c: GRAY, a: 1 }, { b: 'color', c: '#a47a4a', a: 0.55 }],
    vintage: [{ b: 'screen', c: '#3a2a18', a: 0.4 }, { b: 'soft-light', c: '#ffcc88', a: 0.35 }, { b: 'saturation', c: GRAY, a: 0.3 }],
    rose: [{ b: 'soft-light', c: '#ff5c8a', a: 0.45 }],
    gold: [{ b: 'soft-light', c: '#ffc933', a: 0.5 }, { b: 'screen', c: '#2a1800', a: 0.25 }],
    emerald: [{ b: 'soft-light', c: '#2ecc71', a: 0.4 }],
    purple: [{ b: 'soft-light', c: '#9b59ff', a: 0.5 }],
    night: [{ b: 'multiply', c: '#5068c0', a: 0.3 }, { b: 'soft-light', c: '#00c8ff', a: 0.3 }],
    faded: [{ b: 'screen', c: '#333333', a: 0.4 }, { b: 'saturation', c: GRAY, a: 0.35 }],
    contrast: [{ b: 'overlay', self: true, a: 0.55 }],
    bright: [{ b: 'screen', c: '#ffffff', a: 0.12 }, { b: 'soft-light', c: '#ffffff', a: 0.3 }],
    moody: [{ b: 'multiply', c: '#2a2a3a', a: 0.4 }, { b: 'saturation', c: GRAY, a: 0.35 }, { b: 'overlay', self: true, a: 0.2 }],
    miami: [{ b: 'soft-light', g: ['#ff4fa3', '#22d3ee'], dir: 'd', a: 0.6 }],
    sunset: [{ b: 'soft-light', g: ['#ff8a00', '#d6249f'], a: 0.6 }],
    arctic: [{ b: 'color', c: '#a0d8ff', a: 0.3 }, { b: 'screen', c: '#102030', a: 0.25 }],
    desert: [{ b: 'soft-light', c: '#e0a060', a: 0.5 }, { b: 'saturation', c: GRAY, a: 0.15 }],
    neonPop: [{ b: 'overlay', self: true, a: 0.4 }, { b: 'soft-light', c: '#ff00cc', a: 0.25 }],
    cinema: [{ b: 'soft-light', g: ['#0f8b8d', '#ffb26b'], a: 0.55 }, { b: 'multiply', c: '#d8d0c8', a: 0.4 }],
    noir: [{ b: 'saturation', c: GRAY, a: 1 }, { b: 'overlay', self: true, a: 0.6 }, { b: 'multiply', c: '#9a9a9a', a: 0.4 }],
    mint: [{ b: 'soft-light', c: '#7fffd4', a: 0.4 }],
    peach: [{ b: 'soft-light', c: '#ffb38a', a: 0.45 }],
    infrared: [{ b: 'hue', c: '#ff2a6d', a: 0.55 }],
    duoBlue: [{ b: 'saturation', c: GRAY, a: 1 }, { b: 'color', g: ['#1e3a8a', '#38bdf8'], a: 0.7 }],
    duoPink: [{ b: 'saturation', c: GRAY, a: 1 }, { b: 'color', g: ['#6d28d9', '#f472b6'], a: 0.7 }],
    duoGold: [{ b: 'saturation', c: GRAY, a: 1 }, { b: 'color', g: ['#3b2a10', '#fbbf24'], a: 0.7 }],
    chrome: [{ b: 'saturation', c: GRAY, a: 0.55 }, { b: 'overlay', self: true, a: 0.45 }, { b: 'soft-light', c: '#9fd3ff', a: 0.2 }],
    cocoa: [{ b: 'soft-light', c: '#8b5a2b', a: 0.5 }, { b: 'overlay', self: true, a: 0.15 }]
  };

  /* ---------- 3 · Light ---------- */
  var LIGHT = {
    leak: function (x, W, H, c, s, p) {
      var a = 0.45 * s; x.save(); x.globalCompositeOperation = 'screen';
      (p.colors || ['#ff9646']).forEach(function (col, i) {
        var lx = W * (0.5 + 0.5 * Math.sin(c.t * (p.speed || 0.35) + i * 2.1)), ly = H * (0.25 + 0.3 * Math.cos(c.t * 0.27 + i * 1.7)), r = Math.max(W, H) * (0.5 + 0.1 * i);
        var g = x.createRadialGradient(lx, ly, 0, lx, ly, r); g.addColorStop(0, hexA(col, a)); g.addColorStop(0.45, hexA(col, a * 0.35)); g.addColorStop(1, hexA(col, 0));
        x.fillStyle = g; x.fillRect(0, 0, W, H);
      });
      x.restore();
    },
    edgeLeak: function (x, W, H, c, s, p) {   // a burn coming in from the side of the frame
      var a = 0.6 * s * (0.7 + 0.3 * Math.sin(c.t * 1.3)), col = p.colors[0];
      var g = x.createLinearGradient(0, 0, W * 0.6, 0); g.addColorStop(0, hexA(col, a)); g.addColorStop(0.5, hexA(p.colors[1] || col, a * 0.3)); g.addColorStop(1, hexA(col, 0));
      x.save(); x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();
    },
    flare: function (x, W, H, c, s) {
      var lx = W * (0.2 + 0.6 * (0.5 + 0.5 * Math.sin(c.t * 0.3))), ly = H * 0.18, base = Math.min(W, H);
      x.save(); x.globalCompositeOperation = 'screen';
      x.drawImage(glowSprite('#fff6d0', 128), lx - base * 0.35 * s, ly - base * 0.35 * s, base * 0.7 * s, base * 0.7 * s);
      var cx = W / 2, cy = H / 2;
      [[0.5, 0.06, '#7dd3fc'], [0.9, 0.035, '#f0abfc'], [1.3, 0.09, '#fde68a'], [1.7, 0.05, '#86efac']].forEach(function (g) {
        var gx = lx + (cx - lx) * g[0] * 2, gy = ly + (cy - ly) * g[0] * 2, r = base * g[1] * s;
        x.globalAlpha = 0.5; x.drawImage(glowSprite(g[2], 64), gx - r, gy - r, r * 2, r * 2);
      });
      x.restore();
    },
    streak: function (x, W, H, c, s, p) {   // anamorphic horizontal streak
      var ly = H * (0.3 + 0.1 * Math.sin(c.t * 0.5)), lx = W * (0.5 + 0.3 * Math.sin(c.t * 0.4));
      x.save(); x.globalCompositeOperation = 'screen'; x.translate(lx, ly); x.scale(1, 0.035);
      var r = W * 0.9, g = x.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, hexA('#ffffff', 0.9 * s)); g.addColorStop(0.15, hexA(p.color, 0.6 * s)); g.addColorStop(1, hexA(p.color, 0));
      x.fillStyle = g; x.fillRect(-r, -r, r * 2, r * 2); x.restore();
      x.save(); x.globalCompositeOperation = 'screen'; x.drawImage(glowSprite(p.color, 64), lx - W * 0.08, ly - W * 0.08, W * 0.16, W * 0.16); x.restore();
    },
    sweep: function (x, W, H, c, s, p) {   // a shine passing over the photo (once per photo, then again)
      var period = Math.max(1.6, c.dur), ph = ((c.u - 0.25) % period) / 1.1; if (ph < 0 || ph > 1) return;
      var pos = -0.4 + ph * 1.8, col = p.color === 'brand' ? c.color : p.color;
      x.save(); x.globalCompositeOperation = p.blend || 'screen'; x.translate(W * pos, 0); x.rotate(0.35);
      var bw = W * 0.18, g = x.createLinearGradient(-bw, 0, bw, 0); g.addColorStop(0, hexA(col, 0)); g.addColorStop(0.5, hexA(col, 0.55 * s)); g.addColorStop(1, hexA(col, 0));
      x.fillStyle = g; x.fillRect(-bw, -H, bw * 2, H * 3); x.restore();
    },
    spotlight: function (x, W, H, c, s) {
      var cx = W * (0.5 + 0.12 * Math.sin(c.t * 0.6)), cy = H * (0.42 + 0.06 * Math.cos(c.t * 0.5)), r = Math.min(W, H) * 0.42;
      var g = x.createRadialGradient(cx, cy, r * 0.5, cx, cy, Math.max(W, H) * 0.8); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + clamp(0.85 * s, 0, 0.95) + ')');
      x.fillStyle = g; x.fillRect(0, 0, W, H);
    },
    rays: function (x, W, H, c, s, p) {
      x.save(); x.globalCompositeOperation = 'screen'; x.translate(W * 0.12, -H * 0.08); x.rotate(0.55 + 0.05 * Math.sin(c.t * 0.4));
      for (var i = 0; i < 9; i++) {
        var a = (i - 4) * 0.09 + 0.02 * Math.sin(c.t * 0.7 + i), len = Math.hypot(W, H) * 1.2, wdt = len * (0.025 + 0.02 * rnd(i, 5));
        x.save(); x.rotate(a); var g = x.createLinearGradient(0, 0, len, 0); g.addColorStop(0, hexA(p.color, 0.35 * s * (0.6 + 0.4 * Math.sin(c.t + i)))); g.addColorStop(1, hexA(p.color, 0));
        x.fillStyle = g; x.beginPath(); x.moveTo(0, 0); x.lineTo(len, -wdt); x.lineTo(len, wdt); x.closePath(); x.fill(); x.restore();
      }
      x.restore();
    },
    strobe: function (x, W, H, c, s) { if (c.beat.k > 0.05) { x.fillStyle = 'rgba(255,255,255,' + clamp(0.45 * s * c.beat.k * (c.beat.down ? 1 : 0.6), 0, 0.8) + ')'; x.fillRect(0, 0, W, H); } },
    club: function (x, W, H, c, s) {
      x.save(); x.globalCompositeOperation = 'screen';
      ['#ff2bd6', '#22d3ee', '#a3e635'].forEach(function (col, i) {
        var lx = W * (0.5 + 0.45 * Math.sin(c.t * (0.9 + i * 0.3) + i * 2)), ly = H * (0.5 + 0.45 * Math.cos(c.t * (0.7 + i * 0.25) + i)), r = Math.min(W, H) * 0.45;
        var g = x.createRadialGradient(lx, ly, 0, lx, ly, r); g.addColorStop(0, hexA(col, 0.4 * s * (0.6 + 0.4 * c.beat.k))); g.addColorStop(1, hexA(col, 0)); x.fillStyle = g; x.fillRect(0, 0, W, H);
      });
      x.restore();
    },
    sunrise: function (x, W, H, c, s) { var g = x.createLinearGradient(0, H, 0, H * 0.35); g.addColorStop(0, 'rgba(255,140,40,' + 0.55 * s + ')'); g.addColorStop(1, 'rgba(255,140,40,0)'); x.save(); x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore(); },
    vignette: function (x, W, H, c, s, p) {
      var g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * (p.inner || 0.4), W / 2, H / 2, Math.hypot(W, H) * 0.56);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,' + clamp((p.a || 0.6) * s, 0, 0.95) + ')'); x.fillStyle = g; x.fillRect(0, 0, W, H);
    },
    bloom: function (x, W, H, c, s, p) {
      var b = blurOf(x.canvas, W, H, 10);
      x.save(); x.globalCompositeOperation = 'screen'; x.globalAlpha = clamp((p.a || 0.4) * s, 0, 1); x.imageSmoothingEnabled = true;
      if (p.tint) { var t = tmp('tint', b.width, b.height), g = t.getContext('2d'); g.globalCompositeOperation = 'copy'; g.drawImage(b, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = p.tint === 'brand' ? c.color : p.tint; g.fillRect(0, 0, t.width, t.height); g.globalCompositeOperation = 'source-over'; b = t; }
      x.drawImage(b, 0, 0, W, H); x.restore();
      if (p.soft) { x.save(); x.globalCompositeOperation = 'soft-light'; x.globalAlpha = 0.25 * s; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.restore(); }
    },
    pulseGlow: function (x, W, H, c, s) {   // edges light up on every beat in your brand colour
      var k = 0.3 + 0.7 * c.beat.k, g = x.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
      g.addColorStop(0, hexA(c.color, 0)); g.addColorStop(1, hexA(c.color, 0.6 * s * k)); x.save(); x.globalCompositeOperation = 'screen'; x.fillStyle = g; x.fillRect(0, 0, W, H); x.restore();
    }
  };

  /* ---------- 4 · Particles & emoji ---------- */
  var CONF = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#ec4899', '#facc15'];
  function particles(x, W, H, c, s, p) {
    var base = Math.min(W, H), n = Math.round((p.n || 60) * (0.5 + 0.5 * s)), t = c.t, seed = p.seed || 1;
    x.save(); if (p.blend) x.globalCompositeOperation = p.blend;
    for (var i = 0; i < n; i++) {
      var r1 = rnd(i, seed), r2 = rnd(i, seed + 1), r3 = rnd(i, seed + 2), r4 = rnd(i, seed + 3), r5 = rnd(i, seed + 4), r6 = rnd(i, seed + 5);
      var size = (p.size[0] + (p.size[1] - p.size[0]) * r3) * base, sp = (p.speed || 0.1) * (0.6 + 0.8 * r4), px, py, alpha = 1, rot = (r5 - 0.5) * t * 4;
      if (p.motion === 'fall') { py = ((r2 + t * sp) % 1.2) - 0.1; px = r1 + Math.sin(t * (0.6 + r5) * (p.sway || 1) + r6 * 6) * 0.03 * (p.sway || 1); }
      else if (p.motion === 'rise') { py = 1.1 - ((r2 + t * sp) % 1.2); px = r1 + Math.sin(t * (0.5 + r5) + r6 * 6) * 0.03 * (p.sway || 1); }
      else if (p.motion === 'float') { px = r1 + Math.sin(t * 0.3 * (0.5 + r4) + r5 * 6) * 0.06; py = r2 + Math.cos(t * 0.25 * (0.5 + r6) + r3 * 6) * 0.06; }
      else if (p.motion === 'twinkle') { px = p.area ? p.area[0] + r1 * p.area[2] : r1; py = p.area ? p.area[1] + r2 * p.area[3] : r2; alpha = Math.pow(Math.max(0, Math.sin(t * (2 + r4 * 3) + r5 * 6)), 3); rot = 0; }
      else if (p.motion === 'rain') { py = ((r2 + t * sp * 4) % 1.2) - 0.1; px = r1 + py * 0.15; }
      else if (p.motion === 'burst') {
        var per = p.period || 1.6, k = Math.floor((c.u + r6 * 0.15) / per), uu = (c.u + r6 * 0.15) - k * per, ang = rnd(i, seed + k * 7) * Math.PI * 2, v = (0.25 + 0.5 * rnd(i, seed + 9 + k)) * (p.power || 1);
        var bx = p.cx != null ? p.cx : 0.2 + 0.6 * rnd(k, seed + 20), by = p.cy != null ? p.cy : 0.25 + 0.3 * rnd(k, seed + 21);
        px = bx + Math.cos(ang) * v * uu * 0.6; py = by + Math.sin(ang) * v * uu * 0.6 + (p.gravity == null ? 0.25 : p.gravity) * uu * uu; alpha = clamp(1 - uu / (per * 0.9), 0, 1);
      } else { px = r1; py = r2; }
      var X = px * W, Y = py * H, col = (p.colors || CONF)[Math.floor(r6 * (p.colors || CONF).length)];
      if (X < -size * 2 || X > W + size * 2 || Y < -size * 2 || Y > H + size * 2 || alpha <= 0.01) continue;
      x.globalAlpha = alpha * (p.alpha || 1);
      drawShape(x, p.shape, X, Y, size, rot, col, p, t, i);
    }
    x.restore();
  }
  function drawShape(x, shape, X, Y, size, rot, col, p, t, i) {
    if (shape === 'emoji') { var D = size * 1.6, e = emojiSprite(p.ch[i % p.ch.length], D); x.save(); x.translate(X, Y); x.rotate(rot * 0.3); x.drawImage(e, -D * 0.65, -D * 0.65, D * 1.3, D * 1.3); x.restore(); return; }
    if (shape === 'glow') { var g = glowSprite(col, 32); x.drawImage(g, X - size, Y - size, size * 2, size * 2); return; }
    x.save(); x.translate(X, Y); x.rotate(rot); x.fillStyle = col; x.strokeStyle = col;
    if (shape === 'confetti') { x.scale(1, Math.abs(Math.sin(t * 3 + i))); x.fillRect(-size / 2, -size * 0.3, size, size * 0.6); }
    else if (shape === 'dot') { x.beginPath(); x.arc(0, 0, size / 2, 0, 6.283); x.fill(); }
    else if (shape === 'star') { star(x, 0, 0, size / 2, 5, 0.45); x.fill(); }
    else if (shape === 'sparkle') { star(x, 0, 0, size / 2, 4, 0.18); x.fill(); }
    else if (shape === 'heart') { heart(x, 0, 0, size / 2); x.fill(); }
    else if (shape === 'bubble') { x.lineWidth = Math.max(1, size * 0.06); x.globalAlpha *= 0.8; x.beginPath(); x.arc(0, 0, size / 2, 0, 6.283); x.stroke(); x.globalAlpha *= 0.6; x.beginPath(); x.arc(-size * 0.15, -size * 0.15, size * 0.1, 0, 6.283); x.fillStyle = '#fff'; x.fill(); }
    else if (shape === 'line') { x.rotate(-rot + 0.15); x.lineWidth = Math.max(1, size * 0.08); x.globalAlpha *= 0.55; x.beginPath(); x.moveTo(0, -size); x.lineTo(0, size); x.stroke(); }
    else if (shape === 'petal') { x.beginPath(); x.ellipse(0, 0, size / 2, size / 4, 0, 0, 6.283); x.fill(); }
    else if (shape === 'bill') { x.fillRect(-size / 2, -size * 0.25, size, size * 0.5); x.fillStyle = 'rgba(255,255,255,.75)'; x.font = '900 ' + Math.round(size * 0.38) + 'px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('$', 0, size * 0.02); }
    else if (shape === 'smoke') { x.globalAlpha *= 0.18; var sg = glowSprite(col, 32); x.drawImage(sg, -size, -size, size * 2, size * 2); }
    else if (shape === 'balloon') { x.rotate(-rot * 0.8); x.beginPath(); x.ellipse(0, 0, size * 0.38, size / 2, 0, 0, 6.283); x.fill(); x.strokeStyle = 'rgba(255,255,255,.6)'; x.lineWidth = 1; x.beginPath(); x.moveTo(0, size / 2); x.quadraticCurveTo(size * 0.1, size, 0, size * 1.4); x.stroke(); }
    else if (shape === 'strand') { x.lineWidth = Math.max(1, size * 0.12); x.lineCap = 'round'; x.beginPath(); x.moveTo(-size / 2, 0); x.quadraticCurveTo(0, -size * 0.35, size / 2, 0); x.stroke(); }
    else if (shape === 'leaf') { x.beginPath(); x.moveTo(0, -size / 2); x.quadraticCurveTo(size / 2, 0, 0, size / 2); x.quadraticCurveTo(-size / 2, 0, 0, -size / 2); x.fill(); }
    x.restore();
  }
  function sticker(x, W, H, c, s, p) {   // one big emoji that pops / drops / bounces in
    var base = Math.min(W, H), size = base * (p.size || 0.18) * (0.7 + 0.3 * s), e = emojiSprite(p.ch, size), u = c.u, sc = 1, dy = 0, rot = 0;
    if (p.anim === 'pop') { var q = clamp(u / 0.4, 0, 1); sc = q < 1 ? easeOut(q) * (1 + 0.25 * Math.sin(q * Math.PI)) : 1 + 0.05 * c.beat.k; }
    else if (p.anim === 'drop') { dy = -(1 - bounce(u / 0.9)) * H * 0.5; }
    else if (p.anim === 'bounce') { dy = -Math.abs(Math.sin(c.t * 3)) * base * 0.04; }
    else if (p.anim === 'spin') { rot = c.t * 2; }
    else if (p.anim === 'wiggle') { rot = Math.sin(c.t * 6) * 0.25; }
    if (sc <= 0.01) return;
    var w = size * 1.3;
    x.save(); x.translate(p.x * W, p.y * H + dy); x.rotate(rot); x.scale(sc, sc); x.shadowColor = 'rgba(0,0,0,.35)'; x.shadowBlur = size * 0.12; x.drawImage(e, -w / 2, -w / 2, w, w); x.restore();
  }

  /* ---------- 5 · Film & retro ---------- */
  function scanlines(x, W, H, a) {
    var key = 'scan' + H, c = sprites[key];
    if (!c) { c = document.createElement('canvas'); c.width = 4; c.height = Math.max(2, Math.round(H / 360)) * 2; var g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 4, c.height / 2); sprites[key] = c; }
    tile(x, W, H, c, 'multiply', a, 0, 0, 1);
  }
  var RETRO = {
    grain: function (x, W, H, c, s, p) { var f = Math.floor(c.t * 24); tile(x, W, H, noise(), 'overlay', (p.a || 0.18) * s, rnd(f, 1) * 160, rnd(f, 2) * 160, Math.max(1, Math.min(W, H) / 600)); },
    scan: function (x, W, H, c, s) { scanlines(x, W, H, 0.35 * s); },
    vhs: function (x, W, H, c, s) {
      GLITCH.rgb(x, W, H, c, s * 0.5, {});
      scanlines(x, W, H, 0.3 * s);
      var by = ((c.t * 0.25) % 1.3 - 0.15) * H, bh = H * 0.05;
      x.save(); x.globalCompositeOperation = 'screen'; x.globalAlpha = 0.25 * s; x.fillStyle = '#fff'; x.fillRect(0, by, W, bh * 0.15); x.restore();
      tile(x, W, H, noise(), 'overlay', 0.2 * s, c.t * 900, c.t * 500, 1);
      x.save(); x.fillStyle = 'rgba(255,255,255,0.9)'; x.font = '700 ' + Math.round(Math.min(W, H) * 0.04) + 'px "Courier New", monospace'; x.fillText('PLAY ▶', W * 0.05, H * 0.08); x.restore();
    },
    oldFilm: function (x, W, H, c, s) {
      grade(x, W, H, GRADES.sepia, 0.9 * s);
      var f = Math.floor(c.t * 18), fl = 0.08 * s * (rnd(f, 3) - 0.5);
      x.fillStyle = fl > 0 ? 'rgba(255,255,255,' + fl + ')' : 'rgba(0,0,0,' + (-fl) + ')'; x.fillRect(0, 0, W, H);
      RETRO.dust(x, W, H, c, s, {}); RETRO.grain(x, W, H, c, s, { a: 0.25 }); LIGHT.vignette(x, W, H, c, s, { a: 0.65 });
    },
    dust: function (x, W, H, c, s) {
      var f = Math.floor(c.t * 18); x.save();
      for (var i = 0; i < 3; i++) { if (rnd(f, i + 10) > 0.6) continue; var sx = rnd(f, i) * W; x.strokeStyle = 'rgba(255,255,255,' + 0.35 * s + ')'; x.lineWidth = Math.max(1, W / 900); x.beginPath(); x.moveTo(sx, 0); x.lineTo(sx + (rnd(f, i + 3) - 0.5) * 8, H); x.stroke(); }
      for (i = 0; i < 14; i++) { x.fillStyle = rnd(f, i + 40) > 0.5 ? 'rgba(0,0,0,.6)' : 'rgba(255,255,255,.5)'; x.beginPath(); x.arc(rnd(f, i + 20) * W, rnd(f, i + 30) * H, Math.max(1, Math.min(W, H) * 0.003 * rnd(f, i + 50) * 2), 0, 6.283); x.fill(); }
      x.restore();
    },
    flicker: function (x, W, H, c, s) { var f = Math.floor(c.t * 14), v = (rnd(f, 7) - 0.5) * 0.16 * s; x.fillStyle = v > 0 ? 'rgba(255,255,255,' + v + ')' : 'rgba(0,0,0,' + (-v) + ')'; x.fillRect(0, 0, W, H); },
    paper: function (x, W, H, c, s) { tile(x, W, H, paper(), 'multiply', 0.35 * s, 0, 0, Math.max(W, H) / 384); },
    crt: function (x, W, H, c, s) { scanlines(x, W, H, 0.3 * s); GLITCH.rgb(x, W, H, c, s * 0.3, {}); LIGHT.vignette(x, W, H, c, s, { a: 0.75, inner: 0.3 }); },
    eightMM: function (x, W, H, c, s) {
      grade(x, W, H, GRADES.vintage, s); RETRO.grain(x, W, H, c, s, { a: 0.3 }); RETRO.flicker(x, W, H, c, s); LIGHT.vignette(x, W, H, c, s, { a: 0.7 });
      x.save(); x.fillStyle = '#000'; x.beginPath(); x.rect(0, 0, W, H); rr(x, W * 0.03, H * 0.03, W * 0.94, H * 0.94, Math.min(W, H) * 0.08, true); x.fill('evenodd'); x.restore();
    },
    halftone: function (x, W, H, c, s) {
      var d = Math.max(4, Math.round(Math.min(W, H) / 110)), key = 'ht' + d, t2 = sprites[key];
      if (!t2) { t2 = document.createElement('canvas'); t2.width = t2.height = d; var g = t2.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, d, d); g.fillStyle = '#000'; g.beginPath(); g.arc(d / 2, d / 2, d * 0.32, 0, 6.283); g.fill(); sprites[key] = t2; }
      tile(x, W, H, t2, 'multiply', 0.35 * s, 0, 0, 1);
    },
    colorNoise: function (x, W, H, c, s) { tile(x, W, H, noise(), 'soft-light', 0.45 * s, c.t * 700, c.t * 300, Math.max(1, Math.min(W, H) / 500)); }
  };

  /* ---------- 6 · Glitch & art ---------- */
  var GLITCH = {
    rgb: function (x, W, H, c, s, p) {
      var d = Math.max(1, Math.round(W * 0.006 * s * (1 + (p.beat ? c.beat.k * 3 : 0)))), src = copy(x, W, H, 'g1');
      var r = tmp('gR', W, H), g = r.getContext('2d'); g.globalCompositeOperation = 'copy'; g.drawImage(src, 0, 0); g.globalCompositeOperation = 'multiply'; g.fillStyle = '#ff0000'; g.fillRect(0, 0, W, H);
      var b = tmp('gB', W, H), h = b.getContext('2d'); h.globalCompositeOperation = 'copy'; h.drawImage(src, 0, 0); h.globalCompositeOperation = 'multiply'; h.fillStyle = '#00ffff'; h.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'source-over'; h.globalCompositeOperation = 'source-over';
      x.save(); x.fillStyle = '#000'; x.fillRect(0, 0, W, H); x.globalCompositeOperation = 'lighter'; x.drawImage(r, -d, 0); x.drawImage(b, d, 0); x.restore();
    },
    slices: function (x, W, H, c, s) {
      var f = Math.floor(c.t * 10); if (rnd(f, 3) > 0.35 + 0.25 * s && c.beat.k < 0.6) return;
      var src = copy(x, W, H, 'g1');
      for (var i = 0; i < 7; i++) { var y = rnd(f, i) * H, h = H * (0.02 + 0.06 * rnd(f, i + 9)), dx = (rnd(f, i + 20) - 0.5) * W * 0.12 * s; x.drawImage(src, 0, y, W, h, dx, y, W, h); }
      if (rnd(f, 30) > 0.5) GLITCH.rgb(x, W, H, c, s * 1.5, {});
    },
    pixel: function (x, W, H, c, s) {
      var n = Math.max(8, Math.round(70 / s)), w = n, h = Math.max(4, Math.round(n * H / W)), t2 = tmp('px', w, h), g = t2.getContext('2d');
      g.imageSmoothingEnabled = true; g.drawImage(x.canvas, 0, 0, w, h);
      x.save(); x.imageSmoothingEnabled = false; x.drawImage(t2, 0, 0, W, H); x.restore();
    },
    mirror: function (x, W, H) { var src = copy(x, W, H, 'g1'); x.save(); x.translate(W, 0); x.scale(-1, 1); x.drawImage(src, 0, 0, W / 2, H, 0, 0, W / 2, H); x.restore(); },
    kaleido: function (x, W, H) {
      var src = copy(x, W, H, 'g1'); x.save();
      x.drawImage(src, 0, 0, W / 2, H / 2, 0, 0, W / 2, H / 2);
      x.save(); x.translate(W, 0); x.scale(-1, 1); x.drawImage(src, 0, 0, W / 2, H / 2, 0, 0, W / 2, H / 2); x.restore();
      x.save(); x.translate(0, H); x.scale(1, -1); x.drawImage(src, 0, 0, W / 2, H / 2, 0, 0, W / 2, H / 2); x.restore();
      x.save(); x.translate(W, H); x.scale(-1, -1); x.drawImage(src, 0, 0, W / 2, H / 2, 0, 0, W / 2, H / 2); x.restore();
      x.restore();
    },
    tiltShift: function (x, W, H, c, s) {
      var b = blurOf(x.canvas, W, H, 7), t2 = tmp('ts', W, H), g = t2.getContext('2d');
      g.globalCompositeOperation = 'copy'; g.imageSmoothingEnabled = true; g.drawImage(b, 0, 0, W, H); g.globalCompositeOperation = 'destination-in';
      var gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, 'rgba(0,0,0,' + clamp(s, 0, 1) + ')'); gr.addColorStop(0.3, 'rgba(0,0,0,0)'); gr.addColorStop(0.7, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + clamp(s, 0, 1) + ')');
      g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; x.drawImage(t2, 0, 0);
    },
    dreamBlur: function (x, W, H, c, s) {   // soft focus edges, sharp middle
      var b = blurOf(x.canvas, W, H, 9), t2 = tmp('ts', W, H), g = t2.getContext('2d');
      g.globalCompositeOperation = 'copy'; g.imageSmoothingEnabled = true; g.drawImage(b, 0, 0, W, H); g.globalCompositeOperation = 'destination-in';
      var gr = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.25, W / 2, H * 0.45, Math.max(W, H) * 0.7); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,' + clamp(s, 0, 1) + ')');
      g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalCompositeOperation = 'source-over'; x.drawImage(t2, 0, 0);
    },
    double: function (x, W, H, c, s) { var src = copy(x, W, H, 'g1'), k = 1.12 + 0.03 * Math.sin(c.t); x.save(); x.globalCompositeOperation = 'screen'; x.globalAlpha = 0.35 * s; x.drawImage(src, (W - W * k) / 2 + W * 0.05 * Math.sin(c.t * 0.5), (H - H * k) / 2, W * k, H * k); x.restore(); },
    invert: function (x, W, H, c, s) { if (!c.beat.down || c.beat.k < 0.35 / s) return; x.save(); x.globalCompositeOperation = 'difference'; x.globalAlpha = 1; x.fillStyle = '#fff'; x.fillRect(0, 0, W, H); x.restore(); },
    posterBold: function (x, W, H, c, s) { grade(x, W, H, [{ b: 'overlay', self: true, a: 0.8 }, { b: 'overlay', self: true, a: 0.5 }, { b: 'saturation', c: '#ff0000', a: 0.25 }], s); },
    neonEdge: function (x, W, H, c, s) { LIGHT.bloom(x, W, H, c, s, { a: 0.5, tint: 'brand' }); grade(x, W, H, [{ b: 'overlay', self: true, a: 0.35 }], s); },
    zoomBlur: function (x, W, H, c, s) { var src = copy(x, W, H, 'g1'); x.save(); for (var i = 1; i <= 5; i++) { var k = 1 + i * 0.018 * s; x.globalAlpha = 0.12; x.drawImage(src, (W - W * k) / 2, (H - H * k) / 2, W * k, H * k); } x.restore(); }
  };

  /* ---------- 7 · Frames ---------- */
  var FRAMES = {
    border: function (x, W, H, c, s, p) { var w = Math.min(W, H) * 0.03 * s, col = p.color === 'brand' ? c.color : p.color; x.save(); x.strokeStyle = col; x.lineWidth = w * 2; x.strokeRect(0, 0, W, H); x.restore(); },
    rounded: function (x, W, H, c, s) { x.save(); x.fillStyle = '#000'; x.beginPath(); x.rect(0, 0, W, H); rr(x, 0, 0, W, H, Math.min(W, H) * 0.08 * s, true); x.fill('evenodd'); x.restore(); },
    polaroid: function (x, W, H, c, s) { var b = Math.min(W, H) * 0.045; x.save(); x.fillStyle = '#fbfaf6'; x.beginPath(); x.rect(0, 0, W, H); x.rect(b, b, W - 2 * b, H - b * 4.2); x.fill('evenodd'); x.restore(); },
    film: function (x, W, H, c, s) {
      var bw = Math.min(W, H) * 0.07, hole = bw * 0.42, gap = hole * 1.9, off = (c.t * 60) % gap;
      x.save(); x.fillStyle = '#0b0b0b'; x.fillRect(0, 0, bw, H); x.fillRect(W - bw, 0, bw, H); x.fillStyle = 'rgba(255,255,255,0.9)';
      for (var y = -gap + off; y < H; y += gap) { rr(x, (bw - hole) / 2, y, hole, hole * 0.75, hole * 0.15); x.fill(); rr(x, W - bw + (bw - hole) / 2, y, hole, hole * 0.75, hole * 0.15); x.fill(); }
      x.restore();
    },
    viewfinder: function (x, W, H, c, s) {
      var b = Math.min(W, H), m = b * 0.06, L = b * 0.09, lw = Math.max(2, b * 0.006);
      x.save(); x.strokeStyle = '#fff'; x.lineWidth = lw; x.shadowColor = 'rgba(0,0,0,.5)'; x.shadowBlur = lw * 2;
      [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]].forEach(function (k) { x.beginPath(); x.moveTo(k[0], k[1] + L * k[3]); x.lineTo(k[0], k[1]); x.lineTo(k[0] + L * k[2], k[1]); x.stroke(); });
      var fs = Math.round(b * 0.035); x.font = '700 ' + fs + 'px "Courier New", monospace'; x.fillStyle = '#fff'; x.textBaseline = 'middle';
      if (Math.floor(c.t * 2) % 2 === 0) { x.fillStyle = '#ef4444'; x.beginPath(); x.arc(m + L * 0.4, m + L * 0.8, fs * 0.35, 0, 6.283); x.fill(); }
      x.fillStyle = '#fff'; x.fillText('REC', m + L * 0.4 + fs * 0.6, m + L * 0.8);
      var sec = Math.floor(c.t), tc = '00:' + String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); x.textAlign = 'right'; x.fillText(tc, W - m - L * 0.3, m + L * 0.8);
      x.strokeRect(W - m - L * 0.3 - fs * 2.2, H - m - L * 0.8 - fs * 0.4, fs * 2, fs * 0.8); x.fillRect(W - m - L * 0.3 - fs * 2.05, H - m - L * 0.8 - fs * 0.27, fs * 1.4, fs * 0.54);
      x.restore();
    },
    neon: function (x, W, H, c, s) { var b = Math.min(W, H), w = b * 0.008, k = 0.6 + 0.4 * c.beat.k; x.save(); x.strokeStyle = c.color; x.lineWidth = w * 1.5; x.shadowColor = c.color; x.shadowBlur = b * 0.04 * k * s; rr(x, b * 0.03, b * 0.03, W - b * 0.06, H - b * 0.06, b * 0.04); x.stroke(); x.stroke(); x.restore(); },
    goldFrame: function (x, W, H, c, s) { var w = Math.min(W, H) * 0.035 * s, g = x.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#fde68a'); g.addColorStop(0.3, '#b45309'); g.addColorStop(0.55, '#fef3c7'); g.addColorStop(0.8, '#a16207'); g.addColorStop(1, '#fde68a'); x.save(); x.strokeStyle = g; x.lineWidth = w * 2; x.strokeRect(0, 0, W, H); x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 2; x.strokeRect(w, w, W - 2 * w, H - 2 * w); x.restore(); },
    pole: function (x, W, H, c, s) {
      var bw = Math.min(W, H) * 0.045 * s, st = bw * 1.2, off = (c.t * st * 2) % (st * 3);
      [0, W - bw].forEach(function (bx) {
        x.save(); x.beginPath(); x.rect(bx, 0, bw, H); x.clip(); x.fillStyle = '#fff'; x.fillRect(bx, 0, bw, H);
        for (var y = -st * 3 + off - bw; y < H + bw; y += st * 3) { x.fillStyle = '#dc2626'; x.beginPath(); x.moveTo(bx, y); x.lineTo(bx + bw, y - bw); x.lineTo(bx + bw, y - bw + st); x.lineTo(bx, y + st); x.fill(); x.fillStyle = '#1d4ed8'; x.beginPath(); x.moveTo(bx, y + st * 1.5); x.lineTo(bx + bw, y + st * 1.5 - bw); x.lineTo(bx + bw, y + st * 2.5 - bw); x.lineTo(bx, y + st * 2.5); x.fill(); }
        x.restore();
      });
    },
    cinema: function (x, W, H, c, s) { var b = Math.round(H * (W >= H ? 0.1 : 0.07) * s); x.fillStyle = '#000'; x.fillRect(0, 0, W, b); x.fillRect(0, H - b, W, b); },
    circle: function (x, W, H, c, s) { var r = Math.min(W, H) * (0.62 - 0.12 * (s - 1)); x.save(); x.fillStyle = 'rgba(0,0,0,.88)'; x.beginPath(); x.rect(0, 0, W, H); x.arc(W / 2, H * 0.46, r / 1.1, 0, 6.283); x.fill('evenodd'); x.strokeStyle = c.color; x.lineWidth = Math.min(W, H) * 0.008; x.beginPath(); x.arc(W / 2, H * 0.46, r / 1.1, 0, 6.283); x.stroke(); x.restore(); },
    story: function (x, W, H, c, s) {
      var n = Math.max(1, c.count || 1), i = c.idx || 0, m = Math.min(W, H) * 0.03, gap = m * 0.3, bw = (W - 2 * m - gap * (n - 1)) / n, bh = Math.max(3, Math.min(W, H) * 0.007);
      for (var k = 0; k < n; k++) { var X = m + k * (bw + gap); x.fillStyle = 'rgba(255,255,255,.35)'; rr(x, X, m, bw, bh, bh / 2); x.fill(); var f = k < i ? 1 : k === i ? clamp(c.u / c.dur, 0, 1) : 0; if (f) { x.fillStyle = '#fff'; rr(x, X, m, bw * f, bh, bh / 2); x.fill(); } }
    },
    date: function (x, W, H, c) {
      var d = new Date(), txt = "'" + String(d.getFullYear()).slice(2) + ' ' + String(d.getMonth() + 1).padStart(2, '0') + ' ' + String(d.getDate()).padStart(2, '0'), fs = Math.round(Math.min(W, H) * 0.045);
      x.save(); x.font = '700 ' + fs + 'px "Courier New", monospace'; x.textAlign = 'right'; x.fillStyle = '#ff9a3c'; x.shadowColor = '#ff6a00'; x.shadowBlur = fs * 0.4; x.fillText(txt, W - fs, H - fs * 1.6); x.restore();
    },
    dashed: function (x, W, H, c, s) { var b = Math.min(W, H), off = (c.t * b * 0.05) % (b * 0.06); x.save(); x.setLineDash([b * 0.03, b * 0.03]); x.lineDashOffset = -off; x.strokeStyle = '#fff'; x.lineWidth = b * 0.008 * s; rr(x, b * 0.035, b * 0.035, W - b * 0.07, H - b * 0.07, b * 0.03); x.stroke(); x.restore(); },
    torn: function (x, W, H, c, s) {   // a rough white paper edge
      var b = Math.min(W, H) * 0.035 * s; x.save(); x.fillStyle = '#f8f5ee'; x.beginPath(); x.rect(0, 0, W, H);
      var pts = 60; x.moveTo(b, b);
      for (var i = 0; i <= pts; i++) x.lineTo(b + (W - 2 * b) * i / pts, b + rnd(i, 1) * b * 0.8);
      for (i = 0; i <= pts; i++) x.lineTo(W - b - rnd(i, 2) * b * 0.8, b + (H - 2 * b) * i / pts);
      for (i = 0; i <= pts; i++) x.lineTo(W - b - (W - 2 * b) * i / pts, H - b - rnd(i, 3) * b * 0.8);
      for (i = 0; i <= pts; i++) x.lineTo(b + rnd(i, 4) * b * 0.8, H - b - (H - 2 * b) * i / pts);
      x.closePath(); x.fill('evenodd'); x.restore();
    }
  };

  /* ---------- the catalogue ---------- */
  var CATS = [['popular', '⭐ Popular'], ['color', '🎨 Colour'], ['light', '💡 Light'], ['particles', '🎉 Party & sparkle'], ['barber', '💈 Barber'], ['emoji', '😀 Emoji'], ['retro', '🎞️ Film & retro'], ['glitch', '⚡ Glitch & art'], ['motion', '🎥 Movement'], ['frame', '🖼️ Frames']];
  var L = [];   // [id, cat, name, kind, params, popular]
  function add(id, cat, name, kind, p, pop) { L.push({ id: id, cat: cat, name: name, kind: kind, p: p || {}, pop: !!pop }); }
  // colour
  [['warm', 'Warm sun'], ['cool', 'Cool blue'], ['tealOrange', 'Teal & orange', 1], ['bw', 'Black & white', 1], ['sepia', 'Sepia'], ['vintage', 'Vintage'], ['rose', 'Rose'], ['gold', 'Golden hour', 1], ['emerald', 'Emerald'], ['purple', 'Purple haze'],
    ['night', 'Night city'], ['faded', 'Faded film'], ['contrast', 'Punchy contrast', 1], ['bright', 'Bright & airy'], ['moody', 'Moody'], ['miami', 'Miami'], ['sunset', 'Sunset'], ['arctic', 'Arctic'], ['desert', 'Desert'], ['neonPop', 'Neon pop'],
    ['cinema', 'Movie look', 1], ['noir', 'Noir'], ['mint', 'Mint'], ['peach', 'Peach'], ['infrared', 'Infrared'], ['duoBlue', 'Blue duotone'], ['duoPink', 'Pink duotone'], ['duoGold', 'Gold duotone'], ['chrome', 'Chrome'], ['cocoa', 'Cocoa']
  ].forEach(function (g) { add('c-' + g[0], 'color', g[1], 'grade', { g: g[0] }, g[2]); });
  // light
  add('l-warm', 'light', 'Warm light leak', 'light', { fn: 'leak', colors: ['#ff9646'] }, 1);
  add('l-pink', 'light', 'Pink light leak', 'light', { fn: 'leak', colors: ['#ff4f9a'] });
  add('l-blue', 'light', 'Blue light leak', 'light', { fn: 'leak', colors: ['#38bdf8'] });
  add('l-rainbow', 'light', 'Rainbow leak', 'light', { fn: 'leak', colors: ['#ff4f9a', '#fbbf24', '#38bdf8'], speed: 0.45 });
  add('l-golden', 'light', 'Golden leak', 'light', { fn: 'leak', colors: ['#fbbf24', '#f97316'] });
  add('l-burn', 'light', 'Film burn', 'light', { fn: 'edgeLeak', colors: ['#ff5a1f', '#ffd166'] });
  add('l-burnpink', 'light', 'Pink burn', 'light', { fn: 'edgeLeak', colors: ['#ff2d95', '#ffb3d9'] });
  add('l-flare', 'light', 'Lens flare', 'light', { fn: 'flare' }, 1);
  add('l-streak', 'light', 'Blue movie streak', 'light', { fn: 'streak', color: '#3b82f6' });
  add('l-streakg', 'light', 'Gold streak', 'light', { fn: 'streak', color: '#f59e0b' });
  add('l-shine', 'light', 'Shine sweep', 'light', { fn: 'sweep', color: '#ffffff' }, 1);
  add('l-shineg', 'light', 'Gold shine', 'light', { fn: 'sweep', color: '#fcd34d' });
  add('l-shineb', 'light', 'Brand colour shine', 'light', { fn: 'sweep', color: 'brand' });
  add('l-spot', 'light', 'Spotlight', 'light', { fn: 'spotlight' });
  add('l-rays', 'light', 'Sun rays', 'light', { fn: 'rays', color: '#fff3c4' }, 1);
  add('l-raysb', 'light', 'Blue rays', 'light', { fn: 'rays', color: '#bae6fd' });
  add('l-strobe', 'light', 'Strobe on the beat', 'light', { fn: 'strobe' });
  add('l-club', 'light', 'Club lights', 'light', { fn: 'club' });
  add('l-sunrise', 'light', 'Sunrise glow', 'light', { fn: 'sunrise' });
  add('l-vig', 'light', 'Soft vignette', 'light', { fn: 'vignette', a: 0.5 }, 1);
  add('l-vig2', 'light', 'Dark vignette', 'light', { fn: 'vignette', a: 0.85, inner: 0.25 });
  add('l-bloom', 'light', 'Glow', 'light', { fn: 'bloom', a: 0.4 }, 1);
  add('l-dreamy', 'light', 'Dreamy', 'light', { fn: 'bloom', a: 0.35, soft: true });
  add('l-brandglow', 'light', 'Brand colour glow', 'light', { fn: 'bloom', a: 0.5, tint: 'brand' });
  add('l-pulse', 'light', 'Edges pulse on the beat', 'light', { fn: 'pulseGlow' });
  // party & sparkle
  add('p-confetti', 'particles', 'Confetti', 'particles', { shape: 'confetti', motion: 'fall', n: 90, size: [0.018, 0.032], speed: 0.13, sway: 1.5 }, 1);
  add('p-glitter', 'particles', 'Gold glitter', 'particles', { shape: 'sparkle', motion: 'twinkle', n: 80, size: [0.022, 0.055], colors: ['#fde68a', '#fbbf24', '#ffffff'], blend: 'screen' }, 1);
  add('p-sparkle', 'particles', 'Sparkles', 'particles', { shape: 'sparkle', motion: 'twinkle', n: 45, size: [0.03, 0.07], colors: ['#ffffff', '#e0f2fe'], blend: 'screen' });
  add('p-snow', 'particles', 'Snow', 'particles', { shape: 'dot', motion: 'fall', n: 110, size: [0.007, 0.018], colors: ['#ffffff'], speed: 0.07, sway: 2, alpha: 0.9 });
  add('p-rain', 'particles', 'Rain', 'particles', { shape: 'line', motion: 'rain', n: 90, size: [0.015, 0.03], colors: ['#cbd5e1'], speed: 0.18 });
  add('p-bubbles', 'particles', 'Bubbles', 'particles', { shape: 'bubble', motion: 'rise', n: 30, size: [0.025, 0.07], colors: ['#e0f2fe', '#ffffff'], speed: 0.06, sway: 2 });
  add('p-hearts', 'particles', 'Hearts', 'particles', { shape: 'heart', motion: 'rise', n: 26, size: [0.025, 0.05], colors: ['#f43f5e', '#fb7185', '#ec4899'], speed: 0.07, sway: 1.5 });
  add('p-stars', 'particles', 'Stars', 'particles', { shape: 'star', motion: 'twinkle', n: 34, size: [0.03, 0.06], colors: ['#fde047', '#ffffff'] });
  add('p-fireflies', 'particles', 'Fireflies', 'particles', { shape: 'glow', motion: 'float', n: 45, size: [0.018, 0.04], colors: ['#fde047', '#bef264'], blend: 'screen' });
  add('p-bokeh', 'particles', 'Bokeh lights', 'particles', { shape: 'glow', motion: 'float', n: 22, size: [0.04, 0.11], colors: ['#f472b6', '#60a5fa', '#fbbf24', '#ffffff'], blend: 'screen', alpha: 0.6 }, 1);
  add('p-dust', 'particles', 'Floating dust', 'particles', { shape: 'dot', motion: 'float', n: 110, size: [0.004, 0.01], colors: ['#ffffff', '#fef3c7'], alpha: 0.75 });
  add('p-embers', 'particles', 'Embers', 'particles', { shape: 'glow', motion: 'rise', n: 55, size: [0.015, 0.035], colors: ['#f97316', '#fbbf24', '#ef4444'], speed: 0.12, blend: 'screen' });
  add('p-petals', 'particles', 'Rose petals', 'particles', { shape: 'petal', motion: 'fall', n: 30, size: [0.02, 0.035], colors: ['#fb7185', '#fda4af', '#f43f5e'], speed: 0.08, sway: 2.5 });
  add('p-leaves', 'particles', 'Autumn leaves', 'particles', { shape: 'leaf', motion: 'fall', n: 24, size: [0.025, 0.045], colors: ['#f59e0b', '#ea580c', '#b45309'], speed: 0.07, sway: 3 });
  add('p-money', 'particles', 'Money rain', 'particles', { shape: 'bill', motion: 'fall', n: 24, size: [0.04, 0.06], colors: ['#16a34a', '#15803d'], speed: 0.11, sway: 2 });
  add('p-smoke', 'particles', 'Smoke', 'particles', { shape: 'smoke', motion: 'rise', n: 16, size: [0.12, 0.25], colors: ['#d4d4d8', '#a1a1aa'], speed: 0.035, sway: 2 });
  add('p-balloons', 'particles', 'Balloons', 'particles', { shape: 'balloon', motion: 'rise', n: 14, size: [0.05, 0.08], speed: 0.07 });
  add('p-fireworks', 'particles', 'Fireworks', 'particles', { shape: 'glow', motion: 'burst', n: 90, size: [0.012, 0.028], colors: ['#f43f5e', '#fbbf24', '#38bdf8', '#a3e635'], period: 1.4, power: 1.3, gravity: 0.2, blend: 'screen' }, 1);
  add('p-burst', 'particles', 'Confetti burst', 'particles', { shape: 'confetti', motion: 'burst', n: 60, size: [0.012, 0.022], period: 2.2, power: 1.4, cx: 0.5, cy: 0.5, gravity: 0.4 });
  add('p-goldrain', 'particles', 'Gold rain', 'particles', { shape: 'glow', motion: 'fall', n: 70, size: [0.01, 0.022], colors: ['#fde68a', '#fbbf24'], speed: 0.16, blend: 'screen' });
  add('p-stardust', 'particles', 'Star dust swirl', 'particles', { shape: 'sparkle', motion: 'float', n: 60, size: [0.018, 0.04], colors: ['#ffffff', '#c4b5fd', '#93c5fd'], blend: 'screen' });
  // barber
  add('b-clippings', 'barber', 'Falling hair clippings', 'particles', { shape: 'strand', motion: 'fall', n: 80, size: [0.022, 0.042], colors: ['#1c1917', '#3f2e22', '#57534e', '#d6d3d1'], speed: 0.1, sway: 1.5 }, 1);
  add('b-pole', 'barber', 'Barber pole sides', 'frame', { fn: 'pole' }, 1);
  add('b-fresh', 'barber', 'Fresh-cut sparkle', 'particles', { shape: 'sparkle', motion: 'twinkle', n: 30, size: [0.035, 0.075], colors: ['#ffffff', '#e0f2fe'], area: [0.25, 0.08, 0.5, 0.4], blend: 'screen' }, 1);
  add('b-razor', 'barber', 'Razor shine', 'light', { fn: 'sweep', color: '#e0f2fe' });
  add('b-buzz', 'barber', 'Clipper buzz', 'motion', { fn: 'buzz' });
  add('b-crown', 'barber', 'Crown on top', 'sticker', { ch: '👑', x: 0.5, y: 0.12, size: 0.16, anim: 'drop' });
  add('b-scissors', 'barber', 'Scissors pop', 'sticker', { ch: '✂️', x: 0.82, y: 0.2, size: 0.13, anim: 'pop' });
  add('b-polesticker', 'barber', 'Barber pole sticker', 'sticker', { ch: '💈', x: 0.15, y: 0.18, size: 0.13, anim: 'wiggle' });
  add('b-smokebase', 'barber', 'Hot-towel steam', 'particles', { shape: 'smoke', motion: 'rise', n: 12, size: [0.1, 0.2], colors: ['#ffffff'], speed: 0.04, sway: 2, alpha: 0.8 });
  add('b-fade', 'barber', 'Sharp fade look', 'grade', { g: 'contrast' });
  add('b-goldcut', 'barber', 'Gold-standard cut', 'light', { fn: 'sweep', color: '#fcd34d' });
  add('b-viewfinder', 'barber', 'Camera (REC)', 'frame', { fn: 'viewfinder' });
  // emoji
  [['fire', '🔥', 'Fire rain', 'fall', 1], ['pole', '💈', 'Barber poles floating', 'rise'], ['scissor', '✂️', 'Scissors rain', 'fall'], ['hundred', '💯', '100s bursting', 'burst', 1], ['starem', '⭐', 'Star burst', 'burst'], ['cool', '😎', 'Cool faces', 'rise'], ['gem', '💎', 'Diamonds', 'twinkle'], ['cash', '💸', 'Cash flying', 'fall'], ['love', '❤️', 'Love hearts', 'rise'], ['clap', '👏', 'Applause', 'burst'], ['raise', '🙌', 'Hands up', 'rise'], ['crown', '👑', 'Crowns', 'twinkle'], ['spark', '✨', 'Sparkle emoji', 'twinkle', 1], ['lit', '⚡', 'Lightning', 'burst'], ['eyes', '👀', 'Eyes', 'float']
  ].forEach(function (e) { add('e-' + e[0], 'emoji', e[2], 'particles', { shape: 'emoji', ch: [e[1]], motion: e[3], n: e[3] === 'burst' ? 16 : 14, size: [0.05, 0.08], speed: 0.09, sway: 1.5, period: 2, power: 1.2, cx: 0.5, cy: 0.45, gravity: 0.35 }, e[4]); });
  [['s-fire', '🔥', 'Fire sticker', 0.82, 0.82, 'pop'], ['s-100', '💯', '100 sticker', 0.82, 0.8, 'pop'], ['s-wow', '😍', 'Wow sticker', 0.18, 0.8, 'bounce'], ['s-spark', '✨', 'Sparkle sticker', 0.8, 0.15, 'spin'], ['s-ok', '👌', 'Perfect sticker', 0.2, 0.82, 'pop']
  ].forEach(function (e) { add(e[0], 'emoji', e[2], 'sticker', { ch: e[1], x: e[3], y: e[4], size: 0.14, anim: e[5] }); });
  // film & retro
  add('r-grain', 'retro', 'Film grain', 'retro', { fn: 'grain', a: 0.16 }, 1);
  add('r-grain2', 'retro', 'Heavy grain', 'retro', { fn: 'grain', a: 0.32 });
  add('r-vhs', 'retro', 'VHS tape', 'retro', { fn: 'vhs' }, 1);
  add('r-scan', 'retro', 'Scan lines', 'retro', { fn: 'scan' });
  add('r-old', 'retro', 'Old film', 'retro', { fn: 'oldFilm' }, 1);
  add('r-dust', 'retro', 'Dust & scratches', 'retro', { fn: 'dust' });
  add('r-flicker', 'retro', 'Projector flicker', 'retro', { fn: 'flicker' });
  add('r-paper', 'retro', 'Paper texture', 'retro', { fn: 'paper' });
  add('r-crt', 'retro', 'Old TV', 'retro', { fn: 'crt' });
  add('r-8mm', 'retro', 'Home movie 8mm', 'retro', { fn: 'eightMM' });
  add('r-halftone', 'retro', 'Comic dots', 'retro', { fn: 'halftone' });
  add('r-noise', 'retro', 'Colour noise', 'retro', { fn: 'colorNoise' });
  add('r-date', 'retro', 'Date stamp', 'frame', { fn: 'date' });
  // glitch & art
  add('g-rgb', 'glitch', 'RGB split', 'glitch', { fn: 'rgb' }, 1);
  add('g-rgbbeat', 'glitch', 'RGB split on the beat', 'glitch', { fn: 'rgb', beat: true });
  add('g-slices', 'glitch', 'Glitch', 'glitch', { fn: 'slices' }, 1);
  add('g-pixel', 'glitch', 'Pixelate', 'glitch', { fn: 'pixel' });
  add('g-mirror', 'glitch', 'Mirror', 'glitch', { fn: 'mirror' });
  add('g-kaleido', 'glitch', 'Kaleidoscope', 'glitch', { fn: 'kaleido' });
  add('g-tilt', 'glitch', 'Tilt-shift blur', 'glitch', { fn: 'tiltShift' });
  add('g-dream', 'glitch', 'Soft focus edges', 'glitch', { fn: 'dreamBlur' }, 1);
  add('g-double', 'glitch', 'Double exposure', 'glitch', { fn: 'double' });
  add('g-invert', 'glitch', 'Invert flash on the beat', 'glitch', { fn: 'invert' });
  add('g-poster', 'glitch', 'Poster bold', 'glitch', { fn: 'posterBold' });
  add('g-neon', 'glitch', 'Neon glow edges', 'glitch', { fn: 'neonEdge' });
  add('g-zoomblur', 'glitch', 'Zoom blur', 'glitch', { fn: 'zoomBlur' });
  // movement
  [['zoomIn', 'Slow zoom in', 1], ['zoomOut', 'Slow zoom out'], ['punch', 'Punch zoom', 1], ['faceZoom', 'Zoom on the cut', 1], ['panL', 'Pan left'], ['panR', 'Pan right'], ['panU', 'Pan up'], ['panD', 'Pan down'], ['shake', 'Camera shake'], ['quake', 'Shake on the beat'],
    ['bounceBeat', 'Bounce on the beat', 1], ['heartbeat', 'Heartbeat'], ['spinIn', 'Spin in'], ['dropIn', 'Drop in'], ['slideIn', 'Slide in'], ['sway', 'Gentle sway'], ['tilt', 'Slow tilt'], ['jelly', 'Jelly wobble'], ['whip', 'Whip in'], ['zoomBurst', 'Zoom burst in']
  ].forEach(function (m) { add('m-' + m[0], 'motion', m[1], 'motion', { fn: m[0] }, m[2]); });
  // frames
  add('f-white', 'frame', 'White border', 'frame', { fn: 'border', color: '#ffffff' }, 1);
  add('f-black', 'frame', 'Black border', 'frame', { fn: 'border', color: '#000000' });
  add('f-brand', 'frame', 'Brand colour border', 'frame', { fn: 'border', color: 'brand' });
  add('f-rounded', 'frame', 'Rounded corners', 'frame', { fn: 'rounded' });
  add('f-polaroid', 'frame', 'Instant photo', 'frame', { fn: 'polaroid' }, 1);
  add('f-film', 'frame', 'Film strip', 'frame', { fn: 'film' });
  add('f-neon', 'frame', 'Neon frame', 'frame', { fn: 'neon' }, 1);
  add('f-gold', 'frame', 'Gold frame', 'frame', { fn: 'goldFrame' });
  add('f-cinema', 'frame', 'Movie bars', 'frame', { fn: 'cinema' }, 1);
  add('f-circle', 'frame', 'Circle spotlight', 'frame', { fn: 'circle' });
  add('f-story', 'frame', 'Story progress bars', 'frame', { fn: 'story' });
  add('f-dashed', 'frame', 'Moving dashed frame', 'frame', { fn: 'dashed' });
  add('f-torn', 'frame', 'Torn paper edge', 'frame', { fn: 'torn' });
  add('f-viewfinder', 'frame', 'Camera viewfinder', 'frame', { fn: 'viewfinder' });

  var BY = {}; L.forEach(function (e) { BY[e.id] = e; });
  var ORDER = { motion: 0, grade: 1, glitch: 2, retro: 3, light: 4, particles: 5, sticker: 6, frame: 7 };

  function applyOne(x, W, H, e, c, s) {
    var p = e.p;
    if (e.kind === 'motion') return MOTION[p.fn] && MOTION[p.fn](x, W, H, c, s);
    if (e.kind === 'grade') return grade(x, W, H, GRADES[p.g] || [], s);
    if (e.kind === 'light') return LIGHT[p.fn] && LIGHT[p.fn](x, W, H, c, s, p);
    if (e.kind === 'particles') return particles(x, W, H, c, s, p);
    if (e.kind === 'sticker') return sticker(x, W, H, c, s, p);
    if (e.kind === 'retro') return RETRO[p.fn] && RETRO[p.fn](x, W, H, c, s, p);
    if (e.kind === 'glitch') return GLITCH[p.fn] && GLITCH[p.fn](x, W, H, c, s, p);
    if (e.kind === 'frame') return FRAMES[p.fn] && FRAMES[p.fn](x, W, H, c, s, p);
  }
  function apply(x, W, H, items, ctx) {
    if (!items || !items.length) return;
    var list = items.map(function (it) { return { e: BY[it.id], s: it.s || 1 }; }).filter(function (q) { return q.e; });
    list.forEach(function (q, i) { q.i = i; });
    list.sort(function (a, b) { return ORDER[a.e.kind] - ORDER[b.e.kind] || a.i - b.i; });
    ctx = Object.assign({ t: 0, u: 0, dur: 3, beat: { k: 0, down: false }, color: '#e11d48', idx: 0, count: 1 }, ctx || {});
    var acc = { l: 0, r: 0, t: 0, b: 0 };
    list.forEach(function (q) {
      x.save();
      try {
        if (q.e.kind === 'frame') {   // draw inside the frames already there, clipped to that space
          var w = Math.max(10, W - acc.l - acc.r), h = Math.max(10, H - acc.t - acc.b);
          x.translate(acc.l, acc.t); x.beginPath(); x.rect(0, 0, w, h); x.clip();
          applyOne(x, w, h, q.e, ctx, q.s);
          var o = insetOne(q.e, q.s, w, h); acc.l += o.l; acc.r += o.r; acc.t += o.t; acc.b += o.b;
        } else applyOne(x, W, H, q.e, ctx, q.s);
      } catch (err) { if (window.console) console.warn('[effects] ' + q.e.id, err); }
      x.restore();
    });
  }
  // How much of each edge the chosen frames cover (fractions of the short side), so tags and
  // your name can sit just inside the frame instead of under it.
  var INSET = {
    pole: { l: 0.045, r: 0.045 }, film: { l: 0.07, r: 0.07 }, border: { a: 0.03 }, goldFrame: { a: 0.035 }, neon: { a: 0.045 },
    polaroid: { l: 0.045, r: 0.045, t: 0.045, b: 0.19 }, cinema: { tb: 1 }, story: { t: 0.04 }, rounded: { a: 0.02 }, torn: { a: 0.035 },
    dashed: { a: 0.045 }, viewfinder: { t: 0.1, l: 0.04, r: 0.04, b: 0.1 }, eightMM: { a: 0.035 }, circle: { a: 0.02 }
  };
  function insetOne(e, s, W, H) {   // the edges one frame covers, in pixels, for a picture of W×H
    var base = Math.min(W, H), o = { l: 0, r: 0, t: 0, b: 0 }, fn = e.p && e.p.fn, k = INSET[fn];
    if (e.kind !== 'frame' || !k) return o;
    var sc = /border|goldFrame|pole/.test(fn) ? s : 1;
    if (k.a) o.l = o.r = o.t = o.b = k.a * sc * base;
    if (k.l) o.l = Math.max(o.l, k.l * sc * base); if (k.r) o.r = Math.max(o.r, k.r * sc * base);
    if (k.t) o.t = Math.max(o.t, k.t * base); if (k.b) o.b = Math.max(o.b, k.b * base);
    if (k.tb) { var bar = H * (W >= H ? 0.1 : 0.07) * s; o.t = Math.max(o.t, bar); o.b = Math.max(o.b, bar); }
    return o;
  }
  // Several frames nest like picture frames: each one sits just inside the one before it, so they never cover each other.
  function inset(items, W, H) {
    var acc = { l: 0, r: 0, t: 0, b: 0 };
    (items || []).forEach(function (it) {
      var e = BY[it.id]; if (!e || e.kind !== 'frame') return;
      var o = insetOne(e, it.s || 1, Math.max(10, W - acc.l - acc.r), Math.max(10, H - acc.t - acc.b));
      acc.l += o.l; acc.r += o.r; acc.t += o.t; acc.b += o.b;
    });
    return acc;
  }
  window.YBFX = { cats: CATS, list: L, byId: BY, apply: apply, inset: inset };
})();
