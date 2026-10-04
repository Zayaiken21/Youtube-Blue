/* =========================================================
   Youtube Blue — design.js
   Controls the Channel Design page only: brand kit, banner,
   profile picture, thumbnail, About writer, keywords, checklist.
   Saved under storage key "design".
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;

  var SIZES = {
    banner: { w: 2560, h: 1440, file: 'banner-2560x1440.png' },
    avatar: { w: 800, h: 800, file: 'profile-800x800.png' },
    thumb: { w: 1280, h: 720, file: 'thumbnail-1280x720.png' }
  };

  var FONTS = {
    sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
    rounded: '"Arial Rounded MT Bold", "Nunito", "Quicksand", "Trebuchet MS", system-ui, sans-serif',
    impact: 'Impact, "Arial Black", "Helvetica Neue", sans-serif',
    serif: 'Georgia, "Times New Roman", serif',
    mono: '"Courier New", Courier, monospace'
  };

  var PRESETS = {
    ocean: { c1: '#0b2a6b', c2: '#1e7bff', accent: '#7dd3fc', text: '#ffffff', bg: 'waves' },
    midnight: { c1: '#020617', c2: '#1e3a8a', accent: '#60a5fa', text: '#e0f2fe', bg: 'gradient' },
    sky: { c1: '#0369a1', c2: '#38bdf8', accent: '#fef08a', text: '#ffffff', bg: 'rays' },
    ice: { c1: '#0c4a6e', c2: '#bae6fd', accent: '#0ea5e9', text: '#0b2a4a', bg: 'dots' }
  };

  var CHECKLIST = [
    'Channel name and @handle chosen',
    'Profile picture uploaded',
    'Banner uploaded and checked on phone and desktop',
    'About section written with keywords',
    'Links and business email added',
    'Channel trailer or featured video set',
    'Upload defaults saved (description template, tags)',
    'At least 3 videos ready before launch',
    'Playlists created for main topics',
    'Upload schedule decided',
    'Thumbnail style template saved',
    'Audience setting reviewed (“Made for kids” or not)'
  ];

  var DEFAULTS = {
    name: 'My Channel', tagline: 'Stories, fun and facts every week', handle: '@mychannel', schedule: '',
    c1: '#0b2a6b', c2: '#1e7bff', accent: '#7dd3fc', text: '#ffffff', font: 'sans', bg: 'waves',
    initials: '', avStyle: 'letters',
    thumbText: 'YOU WON\'T BELIEVE THIS', thumbTag: 'NEW', thumbSide: 'left',
    about: '', keywords: [], checklist: {}
  };

  var state = Object.assign({}, DEFAULTS, YB.store.get('design', {}));
  var photo = null; // HTMLImageElement, kept in memory only (too large for storage)
  var save = YB.debounce(function () { YB.store.set('design', state); }, 250);

  function $(id) { return document.getElementById(id); }

  /* ---------- Drawing helpers ---------- */
  function font(weight, size) { return weight + ' ' + Math.round(size) + 'px ' + (FONTS[state.font] || FONTS.sans); }

  function luminance(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || ''); if (!m) return 1;
    var n = parseInt(m[1], 16), r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  function strokeColor() { return luminance(state.text) > 0.5 ? state.c1 : '#ffffff'; }

  function hexA(hex, a) {
    var n = parseInt(String(hex).replace('#', ''), 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  }

  function fitSize(ctx, text, maxW, size, weight) {
    ctx.font = font(weight, size);
    while (size > 10 && ctx.measureText(text).width > maxW) { size -= 2; ctx.font = font(weight, size); }
    return size;
  }

  function wrap(ctx, text, maxW) {
    var words = String(text).trim().split(/\s+/), lines = [], line = '';
    words.forEach(function (w) {
      var test = line ? line + ' ' + w : w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    });
    if (line) lines.push(line);
    return lines;
  }

  function drawBackground(ctx, W, H) {
    var g = ctx.createLinearGradient(0, H, W, 0);
    g.addColorStop(0, state.c1); g.addColorStop(1, state.c2);
    ctx.fillStyle = state.bg === 'solid' ? state.c2 : g;
    ctx.fillRect(0, 0, W, H);

    if (photo) {
      var s = Math.max(W / photo.naturalWidth, H / photo.naturalHeight);
      var pw = photo.naturalWidth * s, ph = photo.naturalHeight * s;
      ctx.drawImage(photo, (W - pw) / 2, (H - ph) / 2, pw, ph);
      var ov = ctx.createLinearGradient(0, 0, 0, H);
      ov.addColorStop(0, hexA(state.c1, 0.25)); ov.addColorStop(1, hexA(state.c1, 0.7));
      ctx.fillStyle = ov; ctx.fillRect(0, 0, W, H);
      return;
    }

    var u = Math.min(W, H);
    if (state.bg === 'gradient' || state.bg === 'waves' || state.bg === 'rays') {
      var r = ctx.createRadialGradient(W * 0.8, H * 0.15, 0, W * 0.8, H * 0.15, W * 0.6);
      r.addColorStop(0, hexA(state.accent, 0.35)); r.addColorStop(1, hexA(state.accent, 0));
      ctx.fillStyle = r; ctx.fillRect(0, 0, W, H);
    }
    if (state.bg === 'waves') {
      for (var i = 0; i < 4; i++) {
        ctx.beginPath();
        var base = H * (0.62 + i * 0.1), amp = u * (0.035 + i * 0.01), len = W / (1.3 + i * 0.4);
        ctx.moveTo(0, H);
        for (var x = 0; x <= W; x += W / 120) ctx.lineTo(x, base + Math.sin((x / len) * Math.PI * 2 + i) * amp);
        ctx.lineTo(W, H); ctx.closePath();
        ctx.fillStyle = hexA(i % 2 ? state.accent : state.c1, 0.16 + i * 0.05);
        ctx.fill();
      }
    } else if (state.bg === 'dots') {
      var step = u / 14, rad = step * 0.09;
      ctx.fillStyle = hexA(state.accent, 0.22);
      for (var dy = step / 2; dy < H; dy += step) for (var dx = step / 2; dx < W; dx += step) {
        ctx.beginPath(); ctx.arc(dx, dy, rad, 0, Math.PI * 2); ctx.fill();
      }
    } else if (state.bg === 'rays') {
      ctx.save(); ctx.translate(W / 2, -H * 0.15);
      for (var k = 0; k < 18; k++) {
        ctx.rotate(Math.PI / 18);
        if (k % 2) continue;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-W * 0.09, W * 1.4); ctx.lineTo(W * 0.09, W * 1.4); ctx.closePath();
        ctx.fillStyle = hexA('#ffffff', 0.06); ctx.fill();
      }
      ctx.restore();
    } else if (state.bg === 'solid') {
      var v = ctx.createRadialGradient(W / 2, H / 2, u * 0.2, W / 2, H / 2, W * 0.75);
      v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = v; ctx.fillRect(0, 0, W, H);
    }
  }

  function textWithStroke(ctx, text, x, y, size, fill) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.strokeStyle = strokeColor();
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill || state.text;
    ctx.fillText(text, x, y);
  }

  /* ---------- Banner 2560×1440 ---------- */
  function drawBanner(ctx, W, H, preview) {
    drawBackground(ctx, W, H);
    var cx = W / 2, safeW = 1546, top = (H - 423) / 2;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    var nameSize = fitSize(ctx, state.name || ' ', safeW - 120, 160, 900);
    ctx.shadowColor = 'rgba(0,0,0,0.35)'; ctx.shadowBlur = 24;
    ctx.font = font(900, nameSize);
    ctx.fillStyle = state.text;
    ctx.fillText(state.name, cx, top + 150);
    ctx.shadowBlur = 0;

    if (state.tagline) {
      var tagSize = fitSize(ctx, state.tagline, safeW - 160, 60, 600);
      ctx.fillStyle = hexA(state.text, 0.9);
      ctx.fillText(state.tagline, cx, top + 262);
    }
    var info = [state.handle, state.schedule].filter(Boolean).join('   •   ');
    if (info) {
      var infoSize = fitSize(ctx, info, safeW - 260, 44, 700);
      var tw = ctx.measureText(info).width + infoSize * 1.4, th = infoSize * 1.7;
      roundRect(ctx, cx - tw / 2, top + 345 - th / 2, tw, th, th / 2);
      ctx.fillStyle = hexA(state.accent, 0.22); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = hexA(state.accent, 0.7); ctx.stroke();
      ctx.fillStyle = luminance(state.text) > 0.5 ? '#ffffff' : state.text;
      ctx.fillText(info, cx, top + 347);
    }

    if (preview && $('showSafe').checked) drawSafeAreas(ctx, W, H);
  }

  function drawSafeAreas(ctx, W, H) {
    var stripY = (H - 423) / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, W, stripY); ctx.fillRect(0, stripY + 423, W, H - stripY - 423);
    var boxes = [
      { w: 2560, label: 'Desktop', color: 'rgba(255,255,255,0.6)' },
      { w: 1855, label: 'Tablet', color: 'rgba(251,191,36,0.85)' },
      { w: 1546, label: 'All devices (safe)', color: 'rgba(125,211,252,1)' }
    ];
    ctx.setLineDash([24, 16]); ctx.lineWidth = 6;
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.font = '700 34px system-ui, sans-serif';
    boxes.forEach(function (b, i) {
      var x = (W - b.w) / 2;
      ctx.strokeStyle = b.color; ctx.strokeRect(x + 3, stripY, b.w - 6, 423);
      ctx.fillStyle = b.color; ctx.fillText(b.label, x + 18, stripY + 423 + 14 + i * 44);
    });
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText('TV shows the full 2560 × 1440', 24, 22);
  }

  /* ---------- Avatar 800×800 ---------- */
  function initials() {
    if (state.initials) return state.initials;
    var parts = String(state.name || '').trim().split(/\s+/).filter(Boolean);
    var s = parts.slice(0, 2).map(function (p) { return Array.from(p)[0] || ''; }).join('');
    return s.toUpperCase() || 'YB';
  }

  function drawAvatar(ctx, W, H, preview) {
    drawBackground(ctx, W, H);
    var cx = W / 2, cy = H / 2, txt = initials();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

    if (state.avStyle === 'ring') {
      ctx.beginPath(); ctx.arc(cx, cy, W * 0.36, 0, Math.PI * 2);
      ctx.lineWidth = W * 0.035; ctx.strokeStyle = state.accent;
      ctx.shadowColor = state.accent; ctx.shadowBlur = W * 0.06; ctx.stroke(); ctx.shadowBlur = 0;
    }
    if (state.avStyle === 'play') {
      var r = W * 0.13, py = H * 0.3;
      ctx.beginPath(); ctx.arc(cx, py, r, 0, Math.PI * 2); ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.beginPath(); ctx.moveTo(cx - r * 0.32, py - r * 0.45); ctx.lineTo(cx + r * 0.5, py); ctx.lineTo(cx - r * 0.32, py + r * 0.45); ctx.closePath();
      ctx.fillStyle = state.c2; ctx.fill();
      var s2 = fitSize(ctx, txt, W * 0.6, W * 0.3, 900);
      ctx.font = font(900, s2); ctx.fillStyle = state.text; ctx.fillText(txt, cx, H * 0.63);
    } else {
      var s = fitSize(ctx, txt, W * 0.58, W * 0.42, 900);
      ctx.shadowColor = 'rgba(0,0,0,0.3)'; ctx.shadowBlur = W * 0.03;
      ctx.font = font(900, s); ctx.fillStyle = state.text; ctx.fillText(txt, cx, cy + s * 0.04);
      ctx.shadowBlur = 0;
    }

    if (preview) { // dim what YouTube's circle crop hides
      ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(cx, cy, W / 2, 0, Math.PI * 2, true);
      ctx.fillStyle = 'rgba(2,8,20,0.75)'; ctx.fill('evenodd'); ctx.restore();
    }
  }

  /* ---------- Thumbnail 1280×720 ---------- */
  function drawThumb(ctx, W, H, preview) {
    drawBackground(ctx, W, H);
    var side = state.thumbSide, pad = 70;
    var maxW = side === 'center' ? W - pad * 2 : W * 0.62;
    var text = (state.thumbText || '').trim();

    // accent bar
    ctx.fillStyle = state.accent;
    if (side === 'right') ctx.fillRect(W - 22, 0, 22, H); else if (side === 'left') ctx.fillRect(0, 0, 22, H); else ctx.fillRect(0, H - 18, W, 18);

    if (text) {
      var size = 170, lines;
      do {
        ctx.font = font(900, size);
        lines = wrap(ctx, text, maxW);
        var tooWide = lines.some(function (l) { return ctx.measureText(l).width > maxW; });
        if (lines.length <= 3 && !tooWide && lines.length * size * 1.05 < H * 0.72) break;
        size -= 6;
      } while (size > 30);

      var lh = size * 1.02, total = lines.length * lh;
      var y = (H - total) / 2 + lh / 2 + 10;
      ctx.textBaseline = 'middle';
      ctx.textAlign = side === 'center' ? 'center' : side;
      var x = side === 'left' ? pad : side === 'right' ? W - pad : W / 2;
      lines.forEach(function (l, i) {
        textWithStroke(ctx, l, x, y + i * lh, size, i === 1 ? state.accent : state.text);
      });
    }

    if (state.thumbTag) {
      ctx.font = font(900, 46);
      var tw = ctx.measureText(state.thumbTag).width + 44, th = 72;
      var tx = side === 'left' ? W - tw - 40 : 40;
      roundRect(ctx, tx, 36, tw, th, 16);
      ctx.fillStyle = state.accent; ctx.fill();
      ctx.fillStyle = luminance(state.accent) > 0.55 ? state.c1 : '#ffffff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(state.thumbTag, tx + tw / 2, 36 + th / 2 + 2);
    }

    if (preview) { // where the duration badge sits
      roundRect(ctx, W - 150, H - 74, 120, 48, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fill();
      ctx.font = '600 28px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
      ctx.fillText('10:24', W - 90, H - 49);
    }
  }

  var DRAW = { banner: drawBanner, avatar: drawAvatar, thumb: drawThumb };
  var CANVAS = { banner: 'cBanner', avatar: 'cAvatar', thumb: 'cThumb' };

  function renderPreview(kind) {
    var c = $(CANVAS[kind]); if (!c) return;
    var size = SIZES[kind], ctx = c.getContext('2d');
    ctx.setTransform(c.width / size.w, 0, 0, c.height / size.h, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    DRAW[kind](ctx, size.w, size.h, true);
  }

  var frame = 0;
  function renderAll() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(function () { renderPreview('banner'); renderPreview('avatar'); renderPreview('thumb'); });
  }

  function downloadArt(kind) {
    var size = SIZES[kind];
    var c = document.createElement('canvas'); c.width = size.w; c.height = size.h;
    DRAW[kind](c.getContext('2d'), size.w, size.h, false);
    var slug = String(state.name || 'channel').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'channel';
    c.toBlob(function (blob) {
      if (!blob) { YB.toast('Could not export image'); return; }
      YB.download(slug + '-' + size.file, blob);
      YB.toast('Saved ' + size.w + '×' + size.h + ' PNG');
    }, 'image/png');
  }

  /* ---------- Inputs ---------- */
  var BIND = {
    dName: 'name', dTagline: 'tagline', dHandle: 'handle', dSchedule: 'schedule',
    dC1: 'c1', dC2: 'c2', dAccent: 'accent', dText: 'text', dFont: 'font', dBg: 'bg',
    dInitials: 'initials', dAvStyle: 'avStyle', dThumbText: 'thumbText', dThumbTag: 'thumbTag', dThumbSide: 'thumbSide'
  };

  function fillInputs() {
    Object.keys(BIND).forEach(function (id) { var el = $(id); if (el) el.value = state[BIND[id]] || ''; });
    $('dAbout').value = state.about || '';
  }

  function bindInputs() {
    Object.keys(BIND).forEach(function (id) {
      var el = $(id); if (!el) return;
      el.addEventListener('input', function () { state[BIND[id]] = el.value; save(); renderAll(); });
    });
    $('showSafe').addEventListener('change', function () { renderPreview('banner'); });

    $('presets').addEventListener('click', function (e) {
      var b = e.target.closest('[data-preset]'); if (!b) return;
      Object.assign(state, PRESETS[b.getAttribute('data-preset')]);
      fillInputs(); save(); renderAll();
    });

    $('dPhoto').addEventListener('change', function (e) {
      var f = e.target.files[0]; if (!f) return;
      YB.readFile(f, true).then(function (url) {
        var img = new Image();
        img.onload = function () { photo = img; $('clearPhoto').hidden = false; $('photoNote').textContent = 'Photo applied (not saved between visits).'; renderAll(); };
        img.src = url;
      });
    });
    $('clearPhoto').addEventListener('click', function () {
      photo = null; $('dPhoto').value = ''; $('clearPhoto').hidden = true; $('photoNote').textContent = ''; renderAll();
    });

    document.querySelectorAll('[data-dl]').forEach(function (b) {
      b.addEventListener('click', function () { downloadArt(b.getAttribute('data-dl')); });
    });
  }

  /* ---------- About + keywords ---------- */
  function updateAboutCount() {
    var n = $('dAbout').value.length, el = $('aboutCount');
    el.textContent = n + ' / 1000'; el.classList.toggle('over', n > 1000);
  }

  function aboutDraft() {
    var topics = state.keywords.slice(0, 5);
    var lines = [
      'Welcome to ' + (state.name || 'the channel') + '! ' + (state.tagline ? state.tagline.replace(/\.?$/, '.') : ''),
      '',
      topics.length ? 'Here you\'ll find videos about ' + listJoin(topics) + '.' : 'Here you\'ll find [what you make and who it\'s for].',
      (state.schedule ? state.schedule.replace(/\.?$/, '.') : 'New videos every week.'),
      '',
      'Subscribe and turn on notifications so you never miss a new video!',
      state.handle ? '\n' + state.handle : ''
    ];
    var text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    if ($('dAbout').value.trim() && !confirm('Replace your current description with a starter draft?')) return;
    $('dAbout').value = text; state.about = text; save(); updateAboutCount();
  }
  function listJoin(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }

  function renderKeywords() {
    var host = $('kwChips');
    host.innerHTML = state.keywords.map(function (k, i) {
      return '<span class="chip"><span>' + YB.esc(k) + '</span><button type="button" aria-label="Remove ' + YB.esc(k) + '" data-i="' + i + '">×</button></span>';
    }).join('') || '<span class="muted small">No keywords yet.</span>';
    var chars = state.keywords.join(', ').length;
    $('kwCount').textContent = state.keywords.length + ' keywords · ' + chars + ' characters';
  }

  function bindAbout() {
    $('dAbout').addEventListener('input', function () { state.about = $('dAbout').value; save(); updateAboutCount(); });
    $('aboutDraft').addEventListener('click', aboutDraft);
    $('aboutCopy').addEventListener('click', function () { YB.copy($('dAbout').value); });

    $('kwForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var input = $('kwInput');
      input.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean).forEach(function (k) {
        if (state.keywords.map(function (x) { return x.toLowerCase(); }).indexOf(k.toLowerCase()) === -1) state.keywords.push(k);
      });
      input.value = ''; save(); renderKeywords();
    });
    $('kwChips').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-i]'); if (!b) return;
      state.keywords.splice(Number(b.getAttribute('data-i')), 1); save(); renderKeywords();
    });
    $('kwCopy').addEventListener('click', function () { YB.copy(state.keywords.join(', ')); });
  }

  /* ---------- Checklist ---------- */
  function renderChecklist() {
    var done = 0;
    $('checklist').innerHTML = CHECKLIST.map(function (item, i) {
      var on = !!state.checklist[i]; if (on) done++;
      return '<li><label><input type="checkbox" data-ck="' + i + '"' + (on ? ' checked' : '') + '><span>' + YB.esc(item) + '</span></label></li>';
    }).join('');
    var pct = Math.round((done / CHECKLIST.length) * 100);
    $('ckProgress').textContent = pct + '%';
    $('ckBar').style.width = pct + '%';
  }
  function bindChecklist() {
    $('checklist').addEventListener('change', function (e) {
      var i = e.target.getAttribute('data-ck'); if (i == null) return;
      state.checklist[i] = e.target.checked; save(); renderChecklist();
    });
  }

  function init() {
    fillInputs(); bindInputs(); bindAbout(); bindChecklist();
    updateAboutCount(); renderKeywords(); renderChecklist(); renderAll();
    // re-render once web fonts / layout settle
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(renderAll);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
