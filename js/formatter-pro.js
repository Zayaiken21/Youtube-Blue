/* Video Formatter — pro editing tools:
   · a timeline with a video track and one layer per overlay (drag to move, drag the ends to trim)
   · ✂ split / ⧉ duplicate / 🗑 delete at the playhead, zoom in / out
   · effects from the 168-effect library on one clip or the whole video
   · barber stickers (clippers, razor, scissors, comb, barber pole, crown, spray bottle, cape)
   Works through window.YBFmt, which formatter.js provides. */
(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function esc(s) { return window.YB ? YB.esc(s) : String(s); }

  /* ---------- Barber stickers (drawn here, no files needed) ---------- */
  var G = '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFE7A3"/><stop offset=".5" stop-color="#E0AA3E"/><stop offset="1" stop-color="#9A6A1C"/></linearGradient>' +
    '<linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c9cfd6"/><stop offset="1" stop-color="#7b838c"/></linearGradient></defs>';
  var STICKERS = {
    clippers: ['💈 Clippers', '<rect x="62" y="40" width="76" height="140" rx="30" fill="#111" stroke="url(#g)" stroke-width="6"/><rect x="58" y="22" width="84" height="30" rx="6" fill="url(#s)"/>' +
      '<path d="M60 22 v-12 M70 22 v-12 M80 22 v-12 M90 22 v-12 M100 22 v-12 M110 22 v-12 M120 22 v-12 M130 22 v-12 M140 22 v-12" stroke="url(#s)" stroke-width="5" stroke-linecap="round"/>' +
      '<rect x="88" y="78" width="24" height="44" rx="12" fill="url(#g)"/><circle cx="100" cy="150" r="9" fill="url(#g)"/><path d="M100 180 q0 14 -14 16" stroke="#111" stroke-width="7" fill="none" stroke-linecap="round"/>'],
    razor: ['🪒 Straight razor', '<path d="M24 120 L120 60 Q150 44 168 62 Q174 70 166 78 L64 142 Z" fill="url(#s)" stroke="#444" stroke-width="3"/><path d="M40 118 L150 62" stroke="#fff" stroke-width="3" opacity=".7"/>' +
      '<path d="M62 142 L40 182 Q36 192 46 194 L58 192 L86 128 Z" fill="url(#g)" stroke="#6b4a12" stroke-width="3"/><circle cx="72" cy="136" r="7" fill="#111"/>'],
    scissors: ['✂️ Scissors', '<circle cx="62" cy="150" r="26" fill="none" stroke="url(#g)" stroke-width="12"/><circle cx="138" cy="150" r="26" fill="none" stroke="url(#g)" stroke-width="12"/>' +
      '<path d="M78 128 L150 22 L160 30 L100 128 Z" fill="url(#s)" stroke="#555" stroke-width="2"/><path d="M122 128 L50 22 L40 30 L100 128 Z" fill="url(#s)" stroke="#555" stroke-width="2"/><circle cx="100" cy="112" r="7" fill="url(#g)"/>'],
    comb: ['🪮 Comb', '<rect x="20" y="70" width="160" height="34" rx="8" fill="url(#g)"/>' +
      Array.apply(null, Array(15)).map(function (_, i) { return '<rect x="' + (26 + i * 10.4) + '" y="100" width="6" height="' + (i < 7 ? 44 : 30) + '" rx="2" fill="url(#g)"/>'; }).join('')],
    pole: ['💈 Barber pole', '<rect x="78" y="8" width="44" height="18" rx="9" fill="url(#g)"/><rect x="70" y="24" width="60" height="10" rx="4" fill="url(#g)"/>' +
      '<clipPath id="pc"><rect x="80" y="34" width="40" height="132" rx="8"/></clipPath><rect x="80" y="34" width="40" height="132" rx="8" fill="#fff"/>' +
      '<g clip-path="url(#pc)">' + [0, 1, 2, 3, 4, 5].map(function (i) { var y = 20 + i * 30; return '<polygon points="80,' + (y + 20) + ' 120,' + y + ' 120,' + (y + 10) + ' 80,' + (y + 30) + '" fill="#d62828"/><polygon points="80,' + (y + 35) + ' 120,' + (y + 15) + ' 120,' + (y + 22) + ' 80,' + (y + 42) + '" fill="#1d4ed8"/>'; }).join('') + '</g>' +
      '<rect x="80" y="34" width="40" height="132" rx="8" fill="none" stroke="#999" stroke-width="2"/><rect x="70" y="166" width="60" height="10" rx="4" fill="url(#g)"/><rect x="78" y="176" width="44" height="16" rx="8" fill="url(#g)"/>'],
    crown: ['👑 Crown', '<polygon points="20,150 30,60 70,110 100,40 130,110 170,60 180,150" fill="url(#g)" stroke="#6b4a12" stroke-width="4" stroke-linejoin="round"/><rect x="18" y="148" width="164" height="26" rx="6" fill="url(#g)" stroke="#6b4a12" stroke-width="4"/>' +
      '<circle cx="30" cy="56" r="10" fill="url(#g)"/><circle cx="100" cy="36" r="10" fill="url(#g)"/><circle cx="170" cy="56" r="10" fill="url(#g)"/><circle cx="100" cy="161" r="6" fill="#d62828"/><circle cx="60" cy="161" r="5" fill="#1d4ed8"/><circle cx="140" cy="161" r="5" fill="#1d4ed8"/>'],
    spray: ['💦 Spray bottle', '<rect x="62" y="80" width="76" height="110" rx="18" fill="url(#s)" stroke="#555" stroke-width="3"/><rect x="82" y="56" width="36" height="26" rx="6" fill="#111"/><path d="M90 56 V36 H140 V48 H110 V56 Z" fill="#111"/><path d="M114 60 l-16 30" stroke="#111" stroke-width="6" stroke-linecap="round"/>' +
      '<circle cx="158" cy="38" r="5" fill="#7cc4ff"/><circle cx="172" cy="28" r="4" fill="#7cc4ff"/><circle cx="174" cy="46" r="4" fill="#7cc4ff"/><circle cx="186" cy="36" r="3" fill="#7cc4ff"/><rect x="74" y="110" width="52" height="40" rx="6" fill="url(#g)"/>'],
    brush: ['🖌️ Fade brush', '<rect x="40" y="20" width="120" height="60" rx="26" fill="url(#g)" stroke="#6b4a12" stroke-width="4"/>' +
      Array.apply(null, Array(12)).map(function (_, i) { return '<path d="M' + (46 + i * 10) + ' 82 q' + (i % 2 ? 4 : -4) + ' 50 0 96" stroke="#222" stroke-width="7" stroke-linecap="round" fill="none"/>'; }).join('')],
    fresh: ['✨ "Fresh cut" badge', '<path d="M100 8 l20 22 30 -6 4 30 28 12 -12 28 16 26 -26 16 -2 30 -30 -2 -18 24 -18 -24 -30 2 -2 -30 -26 -16 16 -26 -12 -28 28 -12 4 -30 30 6 z" fill="url(#g)" stroke="#6b4a12" stroke-width="4"/>' +
      '<text x="100" y="96" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="34" fill="#111">FRESH</text><text x="100" y="134" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="34" fill="#111">CUT</text>']
  };
  var urls = {};
  window.YBStickers = {
    url: function (k) {
      if (!urls[k]) { var s = STICKERS[k] || STICKERS.clippers; urls[k] = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200" width="400" height="400">' + G + s[1] + '</svg>'); }
      return urls[k];
    },
    list: Object.keys(STICKERS).map(function (k) { return [k, STICKERS[k][0]]; })
  };

  /* ---------- Effects on the picture ---------- */
  /* ---------- Rhythm: the beat is found by itself from the sound of the video (music, or the clips' own sound) ---------- */
  var beats = null, beatSig = '', beatBusy = false, beatTimer = 0;
  function findBeats(buf) {   // same method as Photo Showcase: kick-weighted onsets, best tempo and phase
    var sr = buf.sampleRate, n = Math.min(buf.length, Math.floor(sr * 120)), hop = 1024, ch = buf.numberOfChannels;
    var a = buf.getChannelData(0), b2 = ch > 1 ? buf.getChannelData(1) : a, frames = Math.floor(n / hop), env = new Float32Array(frames), lp = 0, k = Math.exp(-2 * Math.PI * 160 / sr), loud = 0;
    for (var f = 0; f < frames; f++) {
      var e = 0, el = 0;
      for (var i = f * hop, end = i + hop; i < end; i++) { var v = (a[i] + b2[i]) * 0.5; lp = lp * k + v * (1 - k); e += v * v; el += lp * lp; }
      env[f] = Math.log(1 + 1000 * (e / hop)) + 1.5 * Math.log(1 + 1000 * (el / hop)); loud += e / hop;
    }
    if (loud / Math.max(1, frames) < 1e-6) return null;   // silent: no beat to follow
    var on = new Float32Array(frames);
    for (f = 1; f < frames; f++) on[f] = Math.max(0, env[f] - env[f - 1]);
    var fps = sr / hop, best = { score: -1, bpm: 120, phase: 0 };
    for (var bpm = 70; bpm <= 180; bpm += 0.5) {
      var P = fps * 60 / bpm, w = Math.exp(-Math.pow(Math.log2(bpm / 115), 2) / 0.6);
      for (var ph = 0; ph < P; ph += 1) {
        var sc = 0, cnt = 0;
        for (var t = ph; t < frames; t += P) { sc += on[Math.round(t)] || 0; cnt++; }
        sc = sc / Math.max(1, cnt) * w;
        if (sc > best.score) best = { score: sc, bpm: bpm, phase: ph };
      }
    }
    var len = 60 / best.bpm, first = best.phase / fps, P2 = fps * len, sums = [0, 0, 0, 0], j = 0;
    for (var g = best.phase; g < frames; g += P2, j++) sums[j % 4] += Math.max(on[Math.round(g) - 1] || 0, on[Math.round(g)] || 0, on[Math.round(g) + 1] || 0);
    var down = sums.indexOf(Math.max.apply(null, sums));   // the "1" of the bar is the strongest of every four beats
    return { bpm: best.bpm, len: len, first: first, down: down };
  }
  function analyseSoon() { clearTimeout(beatTimer); beatTimer = setTimeout(analyse, 1200); }
  function analyse() {
    var F = window.YBFmt; if (!F || beatBusy) return;
    var cl = F.clips(), m = F.music(), sig = cl.map(function (c) { return c.blobId + ':' + c.in.toFixed(2) + ':' + c.out.toFixed(2) + ':' + (c.mute ? 0 : 1); }).join('|') + '#' + (m ? m.blobId + ':' + F.S.musicVol : '');
    if (sig === beatSig) return;
    if (!cl.length) { beats = null; beatSig = sig; renderBeat(); return; }
    beatBusy = true;
    F.mix(Math.max(1, F.timeline().total)).then(function (buf) { beats = buf ? findBeats(buf) : null; }, function () { beats = null; })
      .then(function () { beatSig = sig; beatBusy = false; renderBeat(); F.draw(); if (sig !== currentSig()) analyseSoon(); });
  }
  function currentSig() { var F = YBFmt, m = F.music(); return F.clips().map(function (c) { return c.blobId + ':' + c.in.toFixed(2) + ':' + c.out.toFixed(2) + ':' + (c.mute ? 0 : 1); }).join('|') + '#' + (m ? m.blobId + ':' + F.S.musicVol : ''); }
  function renderBeat() { var e = $('fmBeat'); if (e) e.textContent = beats ? '🥁 Following the beat — ' + Math.round(beats.bpm) + ' BPM, found by itself' : '🥁 No beat in the sound yet — effects keep a steady 120 BPM rhythm. Add music and they follow it by themselves.'; }
  function beatAt(t) {
    var len = beats ? beats.len : 0.5, first = beats ? beats.first % len : 0;
    var since = ((t - first) % len + len) % len, i = Math.round((t - first - since) / len), d = beats ? beats.down : 0;
    return { k: Math.exp(-since / 0.14), down: (((i - d) % 4) + 4) % 4 === 0, since: since, i: i };
  }
  var brand = '';
  function brandColor() { if (!brand) { brand = (getComputedStyle(document.documentElement).getPropertyValue('--primary') || '').trim() || '#e0aa3e'; } return brand; }
  window.YBFmtFx = function (x, W, H, t, ci, c, tl) {
    if (!window.YBFX || !window.YBFmt) return;
    var F = YBFmt, items = (F.S.fxAll || []).concat(c.fx || []);
    if (!items.length) return;
    if (window.YBFmtFxT != null) t = window.YBFmtFxT;   // the floating live preview animates the effects
    YBFX.apply(x, W, H, items, { t: t, u: t - tl.starts[ci], dur: F.clipLen(c), beat: beatAt(t), color: F.S.fxColor || brandColor(), idx: ci, count: F.clips().length || 1 });
  };
  var fxTarget = 'clip', fxCat = 'popular', fxShow = 48;
  function curClip() { var F = YBFmt, cl = F.clips(); if (!cl.length) return null; return cl[F.clipAt(F.pv.t)]; }
  function fxList() { var F = YBFmt; if (fxTarget === 'all') return F.S.fxAll || (F.S.fxAll = []); var c = curClip(); if (!c) return null; return c.fx || (c.fx = []); }
  function fxSaved() { var F = YBFmt; if (fxTarget === 'all') F.saveSettings(); F.save(); F.draw(); renderFx(); render(); }
  function renderFx() {
    var box = $('fmFx'); if (!box || !window.YBFX || !window.YBFmt) return;
    var F = YBFmt, cl = F.clips(), c = curClip(), ci = c ? cl.indexOf(c) : -1, list = fxList() || [];
    $('fmFxTarget').innerHTML = '<button type="button" data-fxt="clip" class="' + (fxTarget === 'clip' ? 'on' : '') + '">🎬 This clip' + (c ? ' (' + (ci + 1) + ')' : '') + '</button><button type="button" data-fxt="all" class="' + (fxTarget === 'all' ? 'on' : '') + '">🌐 Whole video</button>';
    $('fmFxOn').innerHTML = list.length ? list.map(function (q, i) {
      var e = YBFX.byId[q.id]; if (!e) return '';
      return '<li class="fm-fxon"><b>' + esc(e.name) + '</b><span class="fm-fxs" role="group" aria-label="Strength">' +
        [[0.6, 'Light'], [1, 'Medium'], [1.5, 'Strong']].map(function (p) { return '<button type="button" data-fxs="' + p[0] + '" data-fxi="' + i + '" class="' + (Math.abs((q.s || 1) - p[0]) < 0.01 ? 'on' : '') + '">' + p[1] + '</button>'; }).join('') +
        '</span><button type="button" class="btn btn-ghost btn-sm" data-fxdel="' + i + '" aria-label="Remove">✕</button></li>';
    }).join('') : '<li class="muted small">No effects on ' + (fxTarget === 'all' ? 'the whole video' : 'this clip') + ' yet — tap one below. Move the playhead to pick another clip.</li>';
    var q = ($('fmFxSearch').value || '').trim();
    $('fmFxCats').innerHTML = YBFX.cats.map(function (k) { return '<button type="button" data-fxc="' + k[0] + '" class="' + (!q && k[0] === fxCat ? 'on' : '') + '">' + k[1] + '</button>'; }).join('');
    var on = {}; list.forEach(function (it) { on[it.id] = 1; });
    var all = q ? YBFX.search(q, 400) : YBFX.shown(fxCat), show = all.slice(0, fxShow);
    $('fmFxMore').hidden = all.length <= show.length; $('fmFxMore').textContent = 'Show more (' + (all.length - show.length) + (q && all.length >= 400 ? '+' : '') + ' more)';
    $('fmFxSearch').placeholder = 'Search ' + YBFX.count.toLocaleString() + ' effects — try “gold confetti”, “beat”, “clippings fast”';
    renderBeat();
    $('fmFxTiles').innerHTML = !show.length ? '<p class="muted small">No effects match "' + esc(q) + '".</p>' : show.map(function (e) { return '<button type="button" class="fm-fxtile' + (on[e.id] ? ' on' : '') + '" data-fx="' + e.id + '" aria-pressed="' + !!on[e.id] + '">' + esc(e.name) + '</button>'; }).join('');
  }

  /* ---------- Timeline ---------- */
  var pps = 0, zoomK = 1, drag = null;
  function render() {
    if (window.YBFmt && adoptNew()) { YBFmt.renderOverlays(); return; }
    if (window.YBFmt && YBFmt.clips().length && currentSig() !== beatSig) analyseSoon();
    var box = $('tlInner'), sc = $('tlScroll'); if (!box || !window.YBFmt) return;
    var F = YBFmt, tl = F.timeline(), total = tl.total, cl = F.clips(), ov = F.overlays(), sel = F.sel();
    if (!cl.length) { box.innerHTML = ''; return; }
    var avail = Math.max(240, sc.clientWidth - 4);
    pps = Math.max(avail / Math.max(1, total), 34) * zoomK;   // never squeezed: long videos run past the edge and you swipe to see the rest
    extendToEnd(F);
    var W = Math.max(avail, Math.round(total * pps) + Math.round(avail * 0.7)), cur = F.clipAt(F.pv.t);
    var ruler = '', step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120].find(function (q) { return q * pps >= 56; }) || 300;
    for (var s = 0; s <= total + 0.001; s += step) ruler += '<span class="fm-tick" style="left:' + (s * pps) + 'px">' + (Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0') + (step < 1 && s % 1 ? '.5' : '')) + '</span>';
    var vids = cl.map(function (c, i) {
      var w = Math.max(6, F.clipLen(c) * pps - 2), nfx = (c.fx || []).length;
      var spd = F.sp(c), bg = '';
      return '<div class="fm-tclip' + (i === cur ? ' on' : '') + '" data-tclip="' + i + '" style="left:' + (tl.starts[i] * pps) + 'px;width:' + w + 'px' + bg + '">' +
        '<b class="fm-tv" data-vk="c' + c.id + '"></b><i class="fm-th fm-th-l" data-cedge="l" title="Drag to trim the start"></i><span>' + (i + 1) + (c.mute ? ' 🔇' : '') + (spd !== 1 ? ' ⏩' + spd + '×' : '') + (nfx ? ' ✨' + nfx : '') + ' · ' + F.clipLen(c).toFixed(1) + ' of ' + (c.dur || 0).toFixed(1) + ' s</span><i class="fm-th fm-th-r" data-cedge="r" title="Drag to trim the end"></i></div>';
    }).join('');
    function bar(o) {
      var st = o.type === 'progress' ? 0 : (o.start || 0), en = o.type === 'progress' || o.end == null ? total : Math.min(o.end, total);
      var name = o.type === 'audio' ? '🎵 ' + (o.label || 'Sound') : o.type === 'video' ? '🎬 ' + (o.label || 'Video') : o.type === 'image' ? (o.sticker ? (STICKERS[o.sticker] || [''])[0] : '🖼️ Photo') : o.type === 'progress' ? '▬ Progress bar' : o.type === 'cta' ? '🔔 ' + (o.text || 'Button') : (o.kind === 'emoji' ? o.text : '🅣 ' + (o.text || 'Text'));
      var tags = (o.mute ? '🔇 ' : '') + ((+o.speed || 1) !== 1 ? '⏩' + o.speed + '× ' : '');
      var kind = o.type === 'video' ? ' k-video' : o.type === 'image' ? ' k-photo' : o.type === 'audio' ? ' k-audio' : '';
      return '<div class="fm-tlayer' + kind + (o.id === sel ? ' on' : '') + (o.type === 'progress' ? ' fixed' : '') + (o.hidden ? ' off' : '') + '" data-tov="' + o.id + '" style="left:' + (st * pps) + 'px;width:' + Math.max(14, (en - st) * pps - 2) + 'px">' +
        (o.type === 'video' && o.blobId ? '<b class="fm-tv" data-vk="o' + o.id + '"></b>' : '') + (o.type === 'progress' ? '' : '<i class="fm-th fm-th-l" data-edge="l"></i>') + '<span>' + (o.hidden ? '🚫 ' : '') + tags + esc(name) + '</span>' + (o.type === 'progress' ? '' : '<i class="fm-th fm-th-r" data-edge="r"></i>') + '</div>';
    }
    function unitRow(u) {
      if (u.type !== 'track') return '<div class="fm-trow' + (u.type === 'video' ? ' fm-vlayer' : u.type === 'image' ? ' fm-plater' : u.type === 'audio' ? ' fm-alayer' : '') + '">' + bar(u) + '</div>';
      var items = itemsOf(u), on = u.id === sel || u.id === targetTrack;
      return '<div class="fm-trow fm-track' + (on ? ' on' : '') + (u.hidden ? ' off' : '') + '" data-track="' + u.id + '"><span class="fm-trackname">' + (u.hidden ? '🚫 ' : '') + esc(u.name || 'Layer') +
        (items.length ? '' : ' · empty — tap here, then add a video, photo, sound or text') + '</span>' + items.map(bar).join('') + '</div>';
    }
    var units = ov.filter(function (o) { return o.type === 'track' || !trackOf(o); });
    var sound = units.filter(function (u) { return u.type === 'audio'; }), pics = units.filter(function (u) { return u.type !== 'audio'; });
    var over = pics.filter(function (u) { return !u.under; }).reverse().map(unitRow).join(''), under = pics.filter(function (u) { return u.under; }).reverse().map(unitRow).join(''), audio = sound.map(unitRow).join('');
    box.style.width = W + 'px';
    box.innerHTML = '<div class="fm-ruler" data-seek>' + ruler + '</div>' + (over ? '<div class="fm-tlabel">Layers on top (top row = in front)</div>' + over : '') +
      '<div class="fm-tlabel">Main video</div><div class="fm-trow fm-vrow" data-seek>' + vids + '</div>' +
      (under ? '<div class="fm-tlabel">Layers under the main video</div>' + under : '') + (audio ? '<div class="fm-tlabel">Audio</div>' + audio : '') + '<div class="fm-playhead" id="tlHead"></div>';
    fillVideos(box);
    renderLayerTools();
    lastTotal = total; lastW = sc.clientWidth;
    tick(F.pv.t, total);
    renderFx();
  }
  function tick(t, total) {
    if (total != null && Math.abs(total - lastTotal) > 0.01 && !drag && window.YBFmt && YBFmt.clips().length) { render(); return; }
    var h = $('tlHead'); if (!h || !pps) return;
    h.style.left = (t * pps) + 'px';
    var F = window.YBFmt; if (!F) return;
    syncBars(F, t);
    var cur = F.clipAt(t); document.querySelectorAll('.fm-tclip').forEach(function (e) { e.classList.toggle('on', +e.getAttribute('data-tclip') === cur); });
    if (F.pv.playing) { var sc = $('tlScroll'), x = t * pps; if (x < sc.scrollLeft + 20 || x > sc.scrollLeft + sc.clientWidth - 40) sc.scrollLeft = x - 40; }
    if (lastFxClip !== cur) { lastFxClip = cur; if (fxTarget === 'clip') renderFx(); if (window._fmRenderSpeed) window._fmRenderSpeed(); }
  }
  var lastFxClip = -1;
  /* the real picture in each clip on the timeline (a muted video paused at the clip's start, not a thumbnail image) */
  var vcache = {};
  function fillVideos(box) {
    var F = YBFmt, used = {};
    box.querySelectorAll('.fm-tv[data-vk]').forEach(function (slot) {
      var k = slot.getAttribute('data-vk'), it = k.charAt(0) === 'c' ? F.clips().find(function (c) { return 'c' + c.id === k; }) : F.overlays().find(function (o) { return 'o' + o.id === k; });
      if (!it || !it.blobId) return;
      var url = F.url(it.blobId); if (!url) return;
      var at = Math.max(0.05, (it.in || 0) + 0.1), v = vcache[k];
      if (!v || v._url !== url) {
        v = document.createElement('video'); v.muted = true; v.defaultMuted = true; v.playsInline = true; v.setAttribute('playsinline', ''); v.setAttribute('webkit-playsinline', '');
        v.setAttribute('disablepictureinpicture', ''); v.preload = 'auto'; v._url = url; v._at = at; v.src = url + '#t=' + at.toFixed(2);
        v.addEventListener('loadeddata', function () { try { if (Math.abs(v.currentTime - v._at) > 0.2) v.currentTime = v._at; } catch (e) { /* not ready */ } }, { once: true });
        try { var pr = v.play(); if (pr && pr.then) pr.then(function () { v.pause(); try { v.currentTime = v._at; } catch (e) { /* ignore */ } }, function () { /* iPhone may refuse: the #t frame still shows */ }); } catch (e) { /* ignore */ }
        vcache[k] = v;
      } else if (Math.abs(v._at - at) > 0.15) { v._at = at; try { v.currentTime = at; } catch (e) { /* ignore */ } }
      used[k] = 1; slot.appendChild(v);
    });
    Object.keys(vcache).forEach(function (k) { if (!used[k] && !document.body.contains(vcache[k])) { var v = vcache[k]; v.removeAttribute('src'); v.load(); delete vcache[k]; } });
  }
  /* the video in the timeline bar under the playhead shows (and plays) exactly what the preview shows */
  var barSync = 0;
  function barFollow(v, want, rate, on, playing) {
    if (!v || v.readyState < 1) return;
    if (!on) { if (!v.paused) v.pause(); if (Math.abs(v.currentTime - v._at) > 0.3 && !v.seeking) { try { v.currentTime = v._at; } catch (e) { /* ignore */ } } return; }
    if (v.playbackRate !== rate) v.playbackRate = rate;
    var drift = v.currentTime - want;
    if (Math.abs(drift) > (playing ? 0.35 : 0.08) && !v.seeking) { try { v.currentTime = want; } catch (e) { /* ignore */ } }
    if (playing && v.paused) { v.muted = true; var pr = v.play(); if (pr && pr.catch) pr.catch(function () {}); } else if (!playing && !v.paused) v.pause();
  }
  function syncBars(F, t) {
    var now = performance.now(), playing = F.pv.playing; if (!playing && now - barSync < 60) return; barSync = now;
    var tl = F.timeline(), cur = F.clipAt(t);
    F.clips().forEach(function (c, i) {
      var v = vcache['c' + c.id], sp = F.sp(c);
      barFollow(v, (c.in || 0) + (t - tl.starts[i]) * sp, sp, i === cur, playing);
    });
    F.overlays().forEach(function (o) {
      if (o.type !== 'video') return; var v = vcache['o' + o.id]; if (!v) return;
      var st = o.start || 0, en = o.end == null ? tl.total : o.end, sp = +o.speed || 1;
      barFollow(v, (o.in || 0) + (t - st) * sp, sp, t >= st && t < en, playing);
    });
  }
  /* a layer that ran to the end keeps running to the end when the video gets longer */
  var endTotal = -1;
  function extendToEnd(F) {
    var total = F.timeline().main, prev = endTotal; endTotal = total;
    if (prev <= 0 || Math.abs(total - prev) < 0.05) return;
    var ch = false;
    F.overlays().forEach(function (o) {
      if (o.type === 'track' || o.type === 'progress' || o.end == null) return;
      if (Math.abs(o.end - prev) > 0.15 && !(o.end > total)) return;
      if (o.type === 'video' || o.type === 'audio') {
        var room = (o.start || 0) + Math.max(0.2, ((o.dur || 1e9) - (o.in || 0)) / (+o.speed || 1));
        var ne = Math.round(Math.min(total, room) * 10) / 10; if (ne !== o.end) { o.end = ne; ch = true; }
      } else { o.end = null; ch = true; }
    });
    if (ch) F.save();
  }
  function timeAt(e) { var r = $('tlInner').getBoundingClientRect(); return clamp((e.clientX - r.left) / pps, 0, YBFmt.timeline().total); }
  function wire() {
    var inner = $('tlInner'); if (!inner) return;
    inner.addEventListener('pointerdown', function (e) {
      var F = YBFmt;
      var lay = e.target.closest('[data-tov]');
      if (!lay && e.target.closest('[data-track]')) {   // a blank layer row: choose it as the place new things go
        var tr = trackById(e.target.closest('[data-track]').getAttribute('data-track'));
        if (tr) { targetTrack = tr.id; F.sel(tr.id); F.renderOverlays(); F.seek(timeAt(e)); YB.toast('Adding to ' + (tr.name || 'this layer') + ' — now add a video, photo, sound or text'); }
        return;
      }
      if (lay) {
        var o = F.overlays().find(function (k) { return k.id === lay.getAttribute('data-tov'); }); if (!o) return;
        targetTrack = o.track && trackById(o.track) ? o.track : '';
        F.sel(o.id); F.renderOverlays(); F.draw();
        if (o.type === 'progress') return;
        var total = F.timeline().total, edge = e.target.getAttribute('data-edge');
        drag = { y0: e.clientY, o: o, edge: edge, x0: e.clientX, st: o.start || 0, en: o.end == null ? total : o.end, total: total, main: F.timeline().main, moved: false, el: inner.querySelector('[data-tov="' + o.id + '"]') || e.target.closest('[data-tov]'), in0: o.in || 0 };
        holdFirst(e); inner.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      var tc = e.target.closest('[data-tclip]');
      if (tc) {
        var ci = +tc.getAttribute('data-tclip'), cc = F.clips()[ci], ce = e.target.getAttribute('data-cedge');
        targetTrack = '';
        if (F.sel()) { F.sel(''); F.renderOverlays(); F.draw(); }
        drag = ce ? { clip: ci, edge: ce, x0: e.clientX, in0: cc.in, out0: cc.out } : { reorder: ci, x0: e.clientX, y0: e.clientY, moved: false, el: inner.querySelector('[data-tclip="' + ci + '"]') || tc, t: timeAt(e), st: F.timeline().starts[ci] };
        holdFirst(e); inner.setPointerCapture(e.pointerId); e.preventDefault(); return;
      }
      if (e.target.closest('[data-seek]') || e.target === inner) {
        if (e.pointerType === 'touch') { drag = { pan: null, x0: e.clientX, y0: e.clientY, sl0: $('tlScroll').scrollLeft, wy0: window.scrollY, tap: timeAt(e) }; inner.setPointerCapture(e.pointerId); e.preventDefault(); return; }
        F.seek(timeAt(e)); drag = { seek: true }; inner.setPointerCapture(e.pointerId);
      }
    });
    var holdT = 0;
    function holdFirst(e) {   // on a phone a quick swipe scrolls; press and hold (or move slowly after holding) to drag
      if (e.pointerType !== 'touch' || drag.edge || drag.clip != null) return;
      var real = drag; drag = { hold: real, pan: null, x0: e.clientX, y0: e.clientY, sl0: $('tlScroll').scrollLeft, wy0: window.scrollY };
      clearTimeout(holdT);
      holdT = setTimeout(function () {
        if (!drag || drag.hold !== real || drag.pan) return;
        drag = real; if (real.el) real.el.classList.add('lifted'); if (navigator.vibrate) try { navigator.vibrate(12); } catch (er) { /* ignore */ }
      }, 260);
    }
    function edgeScroll(e) {   // dragging near the edge scrolls the timeline along
      var sc = $('tlScroll'), r = sc.getBoundingClientRect();
      if (e.clientX > r.right - 34) sc.scrollLeft += 14; else if (e.clientX < r.left + 34) sc.scrollLeft -= 14;
    }
    function panBy(e) {
      var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (!drag.pan) { if (Math.abs(dx) < 7 && Math.abs(dy) < 7) return; drag.pan = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y'; clearTimeout(holdT); }
      if (drag.pan === 'x') $('tlScroll').scrollLeft = drag.sl0 - dx; else window.scrollTo(window.scrollX, drag.wy0 - dy);
    }
    inner.addEventListener('pointermove', function (e) {
      if (!drag) return; var F = YBFmt;
      if (drag.hold || drag.tap != null) { panBy(e); return; }
      if (drag.seek) { F.seek(timeAt(e)); return; }
      if (drag.clip != null) {   // trim a clip: drag its ends out to its full length, or in
        var c = F.clips()[drag.clip], dd = (e.clientX - drag.x0) / pps;
        var ksp = F.sp(c);
        if (drag.edge === 'l') c.in = Math.round(clamp(drag.in0 + dd * ksp, 0, drag.out0 - 0.2) * 100) / 100;
        else c.out = Math.round(clamp(drag.out0 + dd * ksp, drag.in0 + 0.2, c.dur || drag.out0) * 100) / 100;
        drag.moved = true; var tl2 = F.timeline(); render(); F.seek(drag.edge === 'l' ? tl2.starts[drag.clip] : tl2.starts[drag.clip] + F.clipLen(c) - 0.05); return;
      }
      if (drag.reorder != null) {   // drag a clip along the track to put it somewhere else
        var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0; if (Math.abs(dx) > 6 || Math.abs(dy) > 6) drag.moved = true;
        if (drag.moved) {
          drag.el.classList.add('dragging'); drag.el.style.zIndex = 5;
          if (Math.abs(dy) > 20 || drag.vert) { drag.vert = true; showZones(); }
          var tg = drag.vert ? targetAt(e.clientY) : null; drag.tg = tg;
          if (tg && tg.kind !== 'main') {   // leaving the main video: show the ghost on the row it will go to
            drag.el.style.transform = ''; drag.el.classList.add('to-layer');
            var cc0 = F.clips()[drag.reorder]; ghostAt(tg, snapT(drag.st + dx / pps) * pps, F.clipLen(cc0) * pps);
          } else {
            drag.el.classList.remove('to-layer'); drag.el.style.transform = 'translateX(' + dx + 'px)';
            var gh = $('tlInner').querySelector('.fm-ghost'); if (gh) gh.remove(); $('tlInner').querySelectorAll('.fm-drop').forEach(function (k) { k.classList.remove('fm-drop'); });
          }
        }
        return;
      }
      var d = (e.clientX - drag.x0) / pps; if (Math.abs(e.clientX - drag.x0) > 3 || Math.abs(e.clientY - drag.y0) > 3) drag.moved = true;
      var o = drag.o, len = drag.en - drag.st, st = drag.st, en = drag.en, isV = o.type === 'video' || o.type === 'audio', lr = +o.speed || 1, room = isV ? Math.max(0.2, ((o.dur || 999) - (drag.in0 || 0)) / lr) : 1e9;
      if (drag.edge === 'l') { st = clamp(drag.st + d, Math.max(0, isV ? drag.st - (drag.in0 || 0) / lr : 0), drag.en - 0.2); if (isV) o.in = Math.round(((drag.in0 || 0) + (st - drag.st) * lr) * 100) / 100; }
      else if (drag.edge === 'r') en = clamp(drag.en + d, drag.st + 0.2, isV ? drag.st + room : 3600);
      else { st = Math.max(0, drag.st + d); var s2 = snapT(st, o), e2 = snapT(st + len, o); st = s2 !== st ? s2 : (e2 !== st + len ? e2 - len : st); st = Math.max(0, st); en = st + len; }
      if (drag.edge === 'l') { var sl = snapT(st, o); if (sl < en - 0.2) { if (isV) o.in = Math.max(0, Math.round(((drag.in0 || 0) + (sl - drag.st) * lr) * 100) / 100); st = sl; } }
      if (drag.edge === 'r') { var sr = snapT(en, o); if (sr > st + 0.2 && (!isV || sr <= drag.st + room + 1e-6)) en = sr; }
      if (!drag.edge && (Math.abs(e.clientY - drag.y0) > 20 || drag.vert)) {   // moving to another row: show where it lands
        drag.vert = true; showZones(); var tgo = targetAt(e.clientY); drag.tg = tgo;
        if (tgo && !tgo.el.contains(drag.el)) ghostAt(tgo, st * pps, (en - st) * pps); else { var gh2 = $('tlInner').querySelector('.fm-ghost'); if (gh2) gh2.remove(); }
      }
      if (o.end == null && !drag.edge && !isV) en = null;   // something that runs to the end keeps doing so while it's moved
      o.start = Math.round(st * 10) / 10; o.end = en == null ? null : !isV && drag.edge === 'r' && Math.abs(en - drag.main) < 0.05 ? null : Math.round(en * 10) / 10;
      edgeScroll(e);
      drag.el.style.left = (o.start * pps) + 'px'; drag.el.style.width = Math.max(14, ((o.end == null ? Math.max(drag.total, o.start + 0.2) : o.end) - o.start) * pps) + 'px';
      var inr = $('tlInner'), need = ((o.end == null ? 0 : o.end) * pps) + 120; if (need > inr.offsetWidth) inr.style.width = need + 'px';
      F.seek(drag.edge === 'r' ? Math.max(0, (o.end == null ? drag.total : o.end) - 0.05) : o.start);
    });
    function up(e) {
      if (!drag) return; var was = drag, F = YBFmt; drag = null;
      clearTimeout(holdT); clearDrop();
      document.querySelectorAll('.lifted').forEach(function (k) { k.classList.remove('lifted'); });
      if (was.tap != null) { if (!was.pan && e.type !== 'pointercancel') F.seek(was.tap); return; }
      if (was.hold) { if (!was.pan && e.type !== 'pointercancel' && was.hold.reorder != null) F.seek(was.hold.t); return; }
      if (was.o && was.moved && was.vert && was.tg && !was.tg.el.contains(was.el)) {
        var tg = was.tg, ov = F.overlays(), o = was.o;
        if (tg.kind === 'track') { var tr = trackById(tg.track); if (tr && tr.id !== o.track) { placeOnTrack(o, tr); targetTrack = tr.id; YB.toast('Moved onto ' + (tr.name || 'the layer')); } }
        else if (tg.kind === 'top' || tg.kind === 'bottom') {   // its own new layer, on top of everything or right under the main video
          delete o.track; o.under = tg.kind === 'bottom'; ov.splice(ov.indexOf(o), 1);
          if (tg.kind === 'top') ov.push(o); else ov.unshift(o);   // the bottom row is the one furthest back
          targetTrack = ''; YB.toast(tg.kind === 'top' ? 'Now its own layer on top' : 'Now its own layer under the main video');
        }
      }
      if (was.o && was.moved) { F.save(); F.renderOverlays(); }
      if (was.clip != null && was.moved) { F.save(); F.renderAll(); }
      if (was.reorder != null) {
        if (!was.moved) { F.seek(was.t); return; }
        var tg2 = was.vert ? was.tg : null;
        if (tg2 && tg2.kind !== 'main') {   // off the main video: it becomes a layer where it was dropped
          var st0 = snapT(Math.max(0, was.st + (e.clientX - was.x0) / pps)), under;
          if (tg2.kind === 'track') { var tr2 = trackById(tg2.track); pendingTrack = tr2 ? tr2.id : ''; under = !!(tr2 && tr2.under); }
          else if (tg2.kind === 'row') { var rowO = F.overlays().find(function (k) { return tg2.el.querySelector('[data-tov="' + k.id + '"]'); }); under = !!(rowO && rowO.under); }
          else under = tg2.kind === 'bottom';
          F.clipMoveToLayer(was.reorder, under, st0).then(function (done) { if (done) { var nw = F.overlays()[F.overlays().length - 1]; YB.toast(pendingTrack ? 'Moved onto the layer' : under ? 'Now a layer under the main video' : 'Now a layer on top of the main video'); } });
          return;
        }
        var t = timeAt(e), tl = F.timeline(), cl = F.clips(), to = 0;
        for (var i = 0; i < cl.length; i++) if (t > tl.starts[i] + F.clipLen(cl[i]) / 2) to = i + (i >= was.reorder ? 0 : 1);
        to = clamp(to, 0, cl.length - 1);
        if (to !== was.reorder) { F.moveClip(was.reorder, to); YB.toast('Clip moved'); } else render();
      }
    }
    inner.addEventListener('pointerup', up); inner.addEventListener('pointercancel', up);
    $('tlSplit').addEventListener('click', function () { $('splitBtn').click(); });
    $('tlDup').addEventListener('click', function () { var F = YBFmt; if (!F.clips().length) return; F.stop(); F.dupClip(F.clipAt(F.pv.t)); YB.toast('Clip duplicated'); });
    $('tlDel').addEventListener('click', function () {
      var F = YBFmt, cl = F.clips(); if (!cl.length) return;
      var sel = F.sel(), o = sel && F.overlays().find(function (k) { return k.id === sel; });
      if (o) { if (!confirm('Delete this layer?')) return; var ov = F.overlays(); ov.splice(ov.indexOf(o), 1); F.sel(''); F.save(); F.renderOverlays(); F.renderFacts(); F.draw(); return; }
      var i = F.clipAt(F.pv.t); if (!confirm('Delete clip ' + (i + 1) + '?')) return; F.stop(); F.removeClip(i);
    });
    $('tlZoomIn').addEventListener('click', function () { zoomK = Math.min(16, zoomK * 1.6); render(); });
    $('tlZoomOut').addEventListener('click', function () { zoomK = Math.max(1, zoomK / 1.6); render(); });
    window.addEventListener('resize', function () { clearTimeout(wire._r); wire._r = setTimeout(render, 150); });
    // effects
    $('fmFx').addEventListener('click', function (e) {
      var b; var list = fxList();
      if ((b = e.target.closest('[data-fxt]'))) { fxTarget = b.getAttribute('data-fxt'); renderFx(); return; }
      if ((b = e.target.closest('[data-fxc]'))) { fxCat = b.getAttribute('data-fxc'); fxShow = 48; $('fmFxSearch').value = ''; renderFx(); return; }
      if (e.target.id === 'fmFxMore') { fxShow += 48; renderFx(); return; }
      if (!list) { YB.toast('Add a video first'); return; }
      if ((b = e.target.closest('[data-fx]'))) {
        var id = b.getAttribute('data-fx'), k = list.findIndex(function (q) { return q.id === id; });
        if (k === -1) list.push({ id: id, s: 1 }); else list.splice(k, 1);
        fxSaved(); return;
      }
      if ((b = e.target.closest('[data-fxs]'))) { list[+b.getAttribute('data-fxi')].s = +b.getAttribute('data-fxs'); fxSaved(); return; }
      if ((b = e.target.closest('[data-fxdel]'))) { list.splice(+b.getAttribute('data-fxdel'), 1); fxSaved(); return; }
      if (e.target.id === 'fmFxClear') { list.length = 0; fxSaved(); }
    });
    var fxT = 0; $('fmFxSearch').addEventListener('input', function () { clearTimeout(fxT); fxT = setTimeout(function () { fxShow = 48; renderFx(); }, 200); });
    var lastAdd = { k: '', t: 0 };
    function once(f) {   // one pick = one layer, even if the phone fires the pick twice
      var k = f.name + '|' + f.size + '|' + f.lastModified, now = Date.now();
      if (k === lastAdd.k && now - lastAdd.t < 1500) return false;
      lastAdd = { k: k, t: now }; return true;
    }
    function addLayerFile(f) { if (!f || !once(f)) return; var F = YBFmt; if (!F.clips().length) { YB.toast('Add your main video first'); return; } YB.toast('Adding video layer…'); F.addVideoLayer(f).then(function () { YB.toast('Video layer added — drag it on the preview, set when it shows on the timeline'); }, function () { YB.toast('This browser can\'t play that video'); }); }
    function target() { var F = YBFmt, o = selLayer(); if (o && (o.type === 'video' || o.type === 'audio')) return { o: o }; var cl = F.clips(); return cl.length ? { c: cl[F.clipAt(F.pv.t)] } : null; }
    $('tlMute').addEventListener('click', function () {
      var F = YBFmt, tg = target(); if (!tg) return;
      if (tg.o) { tg.o.mute = !tg.o.mute; if (!tg.o.mute && !(tg.o.vol > 0)) tg.o.vol = 1; YB.toast(tg.o.mute ? 'Layer muted' : 'Layer sound on'); }
      else { tg.c.mute = !tg.c.mute; YB.toast(tg.c.mute ? 'Clip muted' : 'Clip sound on'); }
      F.save(); F.renderAll();
    });
    window._fmRenderSpeed = function () { renderSpeed(); };
    $('tlSpeed').addEventListener('click', function () { var r = $('fmSpeedRow'); r.hidden = !r.hidden; renderSpeed(); });
    function renderSpeed() {
      var r = $('fmSpeedRow'); if (r.hidden) return; var tg = target(); if (!tg) { r.innerHTML = '<span class="muted small">Add a video first</span>'; return; }
      var cur = tg.o ? (+tg.o.speed || 1) : YBFmt.sp(tg.c);
      r.innerHTML = '<span class="muted small">' + (tg.o ? 'Layer' : 'Clip ' + (YBFmt.clips().indexOf(tg.c) + 1)) + ' speed</span>' + [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map(function (q) { return '<button type="button" data-speed="' + q + '" class="' + (Math.abs(cur - q) < 0.001 ? 'on' : '') + '">' + q + '×</button>'; }).join('');
    }
    $('fmSpeedRow').addEventListener('click', function (e) {
      var b = e.target.closest('[data-speed]'); if (!b) return; var F = YBFmt, tg = target(), q = +b.getAttribute('data-speed'); if (!tg) return;
      F.stop();
      if (tg.o) { var len = (tg.o.end == null ? F.timeline().total : tg.o.end) - (tg.o.start || 0), old = +tg.o.speed || 1; tg.o.speed = q; if (tg.o.end != null) tg.o.end = Math.round(((tg.o.start || 0) + len * old / q) * 10) / 10; }
      else tg.c.speed = q;
      F.save(); F.renderAll(); renderSpeed(); YB.toast('Speed ' + q + '×');
    });
    $('tlAudioFile').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (!f || !once(f)) return; if (!YBFmt.clips().length) { YB.toast('Add your main video first'); return; } YB.toast('Adding sound…'); YBFmt.addAudioLayer(f).then(function () { YB.toast('Sound added on its own row — swipe its ends to trim, tap it for volume'); }, function () { YB.toast('This browser can\'t play that sound file'); }); });
    $('tlNewTrack').addEventListener('click', newTrack);
    $('tlUndo').addEventListener('click', function () { var r = YBFmt.undo(); if (r && r.then) r.then(function () { YB.toast('Undone'); }); });
    $('tlRedo').addEventListener('click', function () { var r = YBFmt.redo(); if (r && r.then) r.then(function () { YB.toast('Redone'); }); });
    YBFmt.histUi();
    var big = false; try { big = localStorage.getItem('fmTlBig') === '1'; } catch (er) { /* no storage */ }
    function setBig(on) { big = on; $('tlBox').classList.toggle('fm-tl-big', on); $('tlExpand').setAttribute('aria-pressed', on); $('tlExpand').querySelector('span').textContent = on ? 'Smaller' : 'Expand'; try { localStorage.setItem('fmTlBig', on ? '1' : '0'); } catch (er) { /* no storage */ } }
    setBig(big);
    $('tlExpand').addEventListener('click', function () { setBig(!big); });
    $('lyUp').addEventListener('click', function () { moveLayer(-1); });
    $('lyDown').addEventListener('click', function () { moveLayer(1); });
    $('tlCenter').addEventListener('click', function () {
      var F = YBFmt, o = selLayer();
      if (o && o.type !== 'audio' && o.type !== 'progress') { o.x = 0.5; o.y = 0.5; F.save(); F.draw(); YB.toast('Layer centred'); return; }
      var cl = F.clips(); if (!cl.length) return; var c = cl[F.clipAt(F.pv.t)];
      c.ox = 0; c.oy = 0; F.save(); F.renderClips(); F.draw(); YB.toast('Video back in the centre');
    });
    $('lyDel').addEventListener('click', function () {
      var F = YBFmt, o = selLayer(); if (!o) return;
      var many = o.type === 'track' ? itemsOf(o) : [];
      if (!confirm(o.type === 'track' ? 'Delete ' + (o.name || 'this layer') + (many.length ? ' and the ' + many.length + ' thing' + (many.length === 1 ? '' : 's') + ' on it' : '') + '?' : 'Delete this?')) return;
      var ov = F.overlays(); [o].concat(many).forEach(function (k) { var i = ov.indexOf(k); if (i !== -1) ov.splice(i, 1); });
      if (targetTrack === o.id) targetTrack = '';
      F.sel(''); F.save(); F.renderOverlays(); F.renderFacts(); F.draw(); YB.toast(o.type === 'track' ? 'Layer deleted' : 'Deleted');
    });
    $('lyFull').addEventListener('click', function () { var o = selLayer(); if (!o || (o.type !== 'video' && o.type !== 'image')) { YB.toast('Choose a video or photo layer first'); return; } YBFmt.setFit(o, o.fit === 'full' ? '' : 'full'); render(); YB.toast(o.fit === 'full' ? 'Fills the whole screen' : 'Free size — drag it on the preview'); });
    $('lyMatch').addEventListener('click', function () { var o = selLayer(); if (!o || (o.type !== 'video' && o.type !== 'image')) { YB.toast('Choose a video or photo layer first'); return; } YBFmt.setFit(o, o.fit === 'match' ? '' : 'match'); render(); YB.toast(o.fit === 'match' ? 'Same size as the main video' : 'Free size — drag it on the preview'); });
    $('lyHide').addEventListener('click', function () { var o = selLayer(); if (!o) return; o.hidden = !o.hidden; if (o.type === 'track') itemsOf(o).forEach(function (k) { k.hidden = o.hidden; }); YBFmt.save(); YBFmt.draw(); render(); });
    $('tlPhotoFile').addEventListener('change', function () { var f = this.files[0]; this.value = ''; if (!f || !once(f)) return; if (!YBFmt.clips().length) { YB.toast('Add your main video first'); return; } YBFmt.addImage(f); YB.toast('Photo layer added'); });
    ['layerFile', 'tlLayerFile'].forEach(function (id) { var el = $(id); if (el) el.addEventListener('change', function () { addLayerFile(this.files[0]); this.value = ''; }); });
    // stickers
    $('stickerRow').innerHTML = YBStickers.list.map(function (s) { return '<button type="button" class="fm-sticker" data-sticker="' + s[0] + '" aria-label="' + esc(s[1]) + '" title="' + esc(s[1]) + '"><img src="' + YBStickers.url(s[0]) + '" alt=""></button>'; }).join('');
    $('stickerRow').addEventListener('click', function (e) {
      var b = e.target.closest('[data-sticker]'); if (!b) return; var F = YBFmt;
      if (!F.clips().length) { YB.toast('Add a video first'); return; }
      F.addOverlay({ type: 'image', sticker: b.getAttribute('data-sticker'), w: 0.22, x: 0.78, y: 0.2, shape: 'square', opacity: 1, anim: 'pop', start: Math.round(F.pv.t * 10) / 10, end: null });
      YB.toast('Sticker added — drag it on the preview; set when it shows on the timeline');
    });
  }
  function selLayer() { var F = YBFmt, id = F.sel(); return id ? F.overlays().find(function (k) { return k.id === id; }) : null; }
  /* ---------- Blank layers: a row you make first, then fill with videos, photos, sound or text ---------- */
  var targetTrack = '', pendingTrack = '', known = null;
  function trackById(id) { return id ? YBFmt.overlays().find(function (k) { return k.id === id && k.type === 'track'; }) : null; }
  function trackOf(o) { return o && o.type !== 'track' && o.track ? trackById(o.track) : null; }
  function unitOf(o) { return o.type === 'track' ? o : (trackOf(o) || o); }
  function itemsOf(t) { return YBFmt.overlays().filter(function (k) { return k.type !== 'track' && k.track === t.id; }); }
  function placeOnTrack(o, t) {   // keep a layer's items right after it, so they draw at the layer's place in the stack
    var ov = YBFmt.overlays(); o.track = t.id; o.under = !!t.under; if (t.hidden) o.hidden = true;
    ov.splice(ov.indexOf(o), 1);
    var at = ov.indexOf(t); ov.forEach(function (k, i) { if (k.track === t.id && k.type !== 'track') at = Math.max(at, i); });
    ov.splice(at + 1, 0, o);
  }
  function adoptNew() {   // anything just added goes onto the chosen layer
    var F = YBFmt, ov = F.overlays();
    if (!known) { known = {}; ov.forEach(function (o) { known[o.id] = 1; }); return false; }
    var changed = false;
    ov.slice().forEach(function (o) {
      if (known[o.id]) return; known[o.id] = 1;
      if (o.type === 'track' || o.type === 'progress' || o.track) return;
      var t = trackById(pendingTrack) || trackById(targetTrack);
      if (t) { placeOnTrack(o, t); changed = true; }
    });
    pendingTrack = '';
    if (changed) { F.save(); F.draw(); }
    return changed;
  }
  function newTrack() {
    var F = YBFmt; if (!F.clips().length) { YB.toast('Add your main video first'); return; }
    var n = F.overlays().filter(function (k) { return k.type === 'track'; }).length + 1;
    F.addOverlay({ type: 'track', name: 'Layer ' + n, under: false, start: 0, end: null }).then(function () {
      var t = F.overlays()[F.overlays().length - 1]; targetTrack = t.id; F.sel(t.id); F.renderOverlays();
      YB.toast('Layer ' + n + ' added — now add a video, photo, sound or text to it');
    });
  }
  function renderLayerTools() {
    var o = selLayer(), g = $('fmLayerTools'); if (!g) return;
    var tt = trackById(targetTrack), hint = $('fmTarget');
    if (hint) { hint.hidden = !tt; if (tt) hint.textContent = 'Adding to ' + (tt.name || 'Layer') + ' — tap the main video to stop'; }
    g.hidden = !o || o.type === 'progress';
    if (window._fmRenderSpeed) window._fmRenderSpeed();
    var pic = o && (o.type === 'video' || o.type === 'image');
    $('lyFull').hidden = $('lyMatch').hidden = !pic;
    if (pic) { $('lyFull').classList.toggle('on', o.fit === 'full'); $('lyMatch').classList.toggle('on', o.fit === 'match'); }
    if (o) { $('lyHide').querySelector('span').textContent = o.hidden ? 'Show' : 'Hide'; $('lyHide').querySelector('i').textContent = o.hidden ? '🚫' : '👁'; }
  }
  // move the selected layer one step up or down the stack — past the main video it goes under it
  function moveLayer(dir) {
    var F = YBFmt, o = selLayer(); if (!o) return;
    var u = unitOf(o);
    if (u.type === 'audio') { YB.toast('Sound isn\'t in front or behind — it just plays'); return; }
    var ov = F.overlays(), units = ov.filter(function (k) { return k.type === 'track' || !trackOf(k); });
    var snd = units.filter(function (k) { return k.type === 'audio'; }), pic = units.filter(function (k) { return k.type !== 'audio'; });
    var vis = pic.filter(function (k) { return !k.under; }).reverse().concat(['MAIN']).concat(pic.filter(function (k) { return k.under; }).reverse());
    var i = vis.indexOf(u), j = i + dir; if (i < 0 || j < 0 || j >= vis.length) return;
    vis[i] = vis[j]; vis[j] = u;
    var m = vis.indexOf('MAIN'), overs = vis.slice(0, m).reverse(), unders = vis.slice(m + 1).reverse();
    function expand(k, under) { k.under = under; var out = [k]; if (k.type === 'track') itemsOf(k).forEach(function (it) { it.under = under; out.push(it); }); return out; }
    var order = []; unders.forEach(function (k) { order = order.concat(expand(k, true)); }); overs.forEach(function (k) { order = order.concat(expand(k, false)); });
    snd.forEach(function (k) { order = order.concat(expand(k, false)); });
    ov.length = 0; order.forEach(function (k) { ov.push(k); });
    F.save(); F.renderOverlays(); F.draw();
    YB.toast(u.under ? (u.name || 'Layer') + ' is now under the main video' : (u.name || 'Layer') + ' moved ' + (dir < 0 ? 'forward' : 'back'));
  }
  function splitLayer() {
    var F = YBFmt, o = selLayer(); if (!o || o.type === 'progress') return false;
    if (o.type === 'track') { var tt = F.pv.t; o = itemsOf(o).find(function (k) { return tt > (k.start || 0) && tt < (k.end == null ? F.timeline().total : k.end); }); if (!o) { YB.toast('Nothing on this layer at the playhead'); return true; } }
    var t = F.pv.t, total = F.timeline().total, st = o.start || 0, en = o.end == null ? total : o.end;
    if (t - st < 0.15 || en - t < 0.15) { YB.toast('Move the playhead inside the layer to cut it'); return true; }
    var b = {}; Object.keys(o).forEach(function (k) { if (k.charAt(0) !== '_') b[k] = o[k]; });
    b.start = Math.round(t * 10) / 10; if (o.type === 'video') b.in = Math.round(((o.in || 0) + (b.start - st)) * 100) / 100;
    o.end = b.start; delete b.id;
    F.addOverlay(b).then(function () { YB.toast('Layer cut in two'); });
    return true;
  }
  /* ---------- Dragging between rows: a gold outline shows where it will land, right on the timeline ---------- */
  function showZones() {
    var inner = $('tlInner'); if (inner.querySelector('.fm-dropzone')) return;
    // nothing moves while you drag: "on top" sits over the time ruler, "underneath" is added below the last row
    var sc = $('tlScroll'), ruler = inner.querySelector('.fm-ruler');
    var top = document.createElement('div'); top.className = 'fm-dropzone fm-dz-top'; top.setAttribute('data-zone', 'top'); top.textContent = '＋ New layer on top';
    top.style.left = sc.scrollLeft + 'px'; top.style.width = (sc.clientWidth - 8) + 'px'; top.style.top = '0px'; top.style.height = Math.max(26, ruler.offsetHeight) + 'px';
    var bot = document.createElement('div'); bot.className = 'fm-dropzone'; bot.setAttribute('data-zone', 'bottom'); bot.textContent = '＋ New layer underneath';
    bot.style.marginLeft = (sc.scrollLeft + 4) + 'px'; bot.style.width = (sc.clientWidth - 16) + 'px';
    inner.appendChild(top); inner.appendChild(bot);
  }
  function clearDrop() {
    var inner = $('tlInner'); if (!inner) return;
    inner.querySelectorAll('.fm-dropzone, .fm-ghost').forEach(function (e) { e.remove(); });
    inner.querySelectorAll('.fm-drop').forEach(function (e) { e.classList.remove('fm-drop'); });
  }
  function targetAt(y) {   // the row (or new-layer spot) under the finger, else the nearest one
    var best = null, bd = 1e9;
    $('tlInner').querySelectorAll('.fm-trow, .fm-dropzone').forEach(function (el) {
      var r = el.getBoundingClientRect(), d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0;
      if (d < bd) { bd = d; best = el; }
    });
    if (!best) return null;
    var kind = best.classList.contains('fm-dropzone') ? best.getAttribute('data-zone') : best.classList.contains('fm-vrow') ? 'main' : best.hasAttribute('data-track') ? 'track' : 'row';
    return { el: best, kind: kind, track: best.getAttribute('data-track') || '' };
  }
  function ghostAt(tg, left, width) {
    var inner = $('tlInner'), g = inner.querySelector('.fm-ghost');
    inner.querySelectorAll('.fm-drop').forEach(function (e) { if (e !== tg.el) e.classList.remove('fm-drop'); });
    tg.el.classList.add('fm-drop');
    if (!g) { g = document.createElement('div'); g.className = 'fm-ghost'; inner.appendChild(g); }
    g.style.top = (tg.el.offsetTop + 3) + 'px'; g.style.height = Math.max(18, tg.el.offsetHeight - 6) + 'px';
    g.style.left = Math.max(0, left) + 'px'; g.style.width = Math.max(14, width) + 'px';
    g.textContent = tg.kind === 'top' ? 'New layer on top' : tg.kind === 'bottom' ? 'New layer underneath' : tg.kind === 'main' ? 'Main video' : tg.kind === 'track' ? 'Onto ' + ((trackById(tg.track) || {}).name || 'this layer') : 'Onto this layer';
  }
  // edges snap to the playhead, the start / end, clip joins and other layers (like CapCut)
  function snapT(t, skip) {
    var F = YBFmt, tl = F.timeline(), c = [0, tl.total, F.pv.t];
    F.clips().forEach(function (k, i) { c.push(tl.starts[i], tl.starts[i] + F.clipLen(k)); });
    F.overlays().forEach(function (o) { if (o === skip || o.type === 'track') return; c.push(o.start || 0); if (o.end != null) c.push(o.end); });
    var best = t, bd = 10 / pps;
    c.forEach(function (x) { var d = Math.abs(x - t); if (d < bd) { bd = d; best = x; } });
    return best;
  }
  var lastW = 0, lastTotal = -1;
  function watchSize() {
    var sc = $('tlScroll'); if (!sc) return;
    if (window.ResizeObserver) new ResizeObserver(function () { if (sc.clientWidth && sc.clientWidth !== lastW) { lastW = sc.clientWidth; render(); } }).observe(sc);
  }
  if (window.YBFloat) YBFloat({ list: function () { return $('fmFxTiles'); }, main: function () { return $('screen'); }, ready: function () { return window.YBFmt && YBFmt.clips().length > 0; }, draw: function (cv, t) { YBFmt.drawAt(cv, t); } });
  window.YBFmtPro = { splitLayer: splitLayer, render: render, tick: tick, beats: function () { return beats; }, beatAt: beatAt };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { wire(); watchSize(); render(); }); else { wire(); watchSize(); render(); }
})();
