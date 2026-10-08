/* Youtube Blue — Comic to Video: put each story line on the panel that shows it.

   Comic panels usually have the words in their speech bubbles. This reads the text in every
   panel on the device (Tesseract OCR, loaded on demand from jsDelivr, ~3 MB the first time,
   then cached by the browser) and matches each story line to the panel whose bubbles contain
   it, keeping the story order. Lines that can't be read (a stylised sign, narration) fall
   between their neighbours. Pictures with no words get no line, so they show in a pause.

   window.YBComicOCR = { read(canvases, onProgress) → Promise<string[]>, match(lines, texts) → groups }
   match() is pure and works without OCR text too (it then spreads the lines evenly). */
(function (root) {
  'use strict';

  var VER = '5.1.1';
  var CDN = 'https://cdn.jsdelivr.net/npm/';
  var worker = null, loading = null;

  function loadLib() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = CDN + 'tesseract.js@' + VER + '/dist/tesseract.min.js';
      s.onload = function () { root.Tesseract ? resolve(root.Tesseract) : reject(new Error('OCR did not load')); };
      s.onerror = function () { loading = null; reject(new Error('OCR could not be downloaded')); };
      document.head.appendChild(s);
    });
    return loading;
  }
  // Never wait forever on a slow or blocked network: then lines are simply spread in order.
  function within(p, ms, what) {
    return Promise.race([p, new Promise(function (res, rej) { setTimeout(function () { rej(new Error(what + ' timed out')); }, ms); })]);
  }
  function getWorker() {
    if (worker) return worker;
    worker = within(loadLib(), 20000, 'OCR download').then(function (T) {
      return T.createWorker('eng', 1, {
        workerPath: CDN + 'tesseract.js@' + VER + '/dist/worker.min.js',
        corePath: CDN + 'tesseract.js-core@' + VER,
        langPath: CDN + '@tesseract.js-data/eng@1.0.0/4.0.0_best_int'
      });
    });
    worker = within(worker, 90000, 'OCR start');
    worker.catch(function () { worker = null; });
    return worker;
  }

  // canvases: one per panel (already cropped). Returns the text found in each.
  function read(canvases, onProgress) {
    return getWorker().then(function (w) {
      var out = [], chain = Promise.resolve();
      canvases.forEach(function (c, i) {
        chain = chain.then(function () {
          if (onProgress) onProgress(i, canvases.length);
          if (!c) { out[i] = ''; return; }
          var txt = '';
          return w.recognize(c).then(function (r) { txt = (r && r.data && r.data.text) || ''; }, function () {})
            .then(function () { return w.recognize(contrast(c)); })
            .then(function (r) { out[i] = txt + '\n' + ((r && r.data && r.data.text) || ''); }, function () { out[i] = txt; });
        });
      });
      return chain.then(function () { if (onProgress) onProgress(canvases.length, canvases.length); return out; });
    });
  }

  // Black-and-white copy (Otsu threshold): bold outlines and coloured lettering read better this way.
  function contrast(c) {
    var w = c.width, h = c.height, x = c.getContext('2d', { willReadFrequently: true }), img = x.getImageData(0, 0, w, h), d = img.data;
    var hist = new Array(256).fill(0), n = w * h, i, g;
    var gray = new Uint8Array(n);
    for (i = 0; i < n; i++) { g = (d[i * 4] * 0.3 + d[i * 4 + 1] * 0.59 + d[i * 4 + 2] * 0.11) | 0; gray[i] = g; hist[g]++; }
    var sum = 0; for (i = 0; i < 256; i++) sum += i * hist[i];
    var sB = 0, wB = 0, best = 0, th = 128;
    for (i = 0; i < 256; i++) {
      wB += hist[i]; if (!wB) continue; var wF = n - wB; if (!wF) break;
      sB += i * hist[i]; var mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) * (mB - mF);
      if (v > best) { best = v; th = i; }
    }
    var o = document.createElement('canvas'); o.width = w; o.height = h;
    var ox = o.getContext('2d'), oi = ox.createImageData(w, h), od = oi.data;
    for (i = 0; i < n; i++) { var v2 = gray[i] > th ? 255 : 0; od[i * 4] = od[i * 4 + 1] = od[i * 4 + 2] = v2; od[i * 4 + 3] = 255; }
    ox.putImageData(oi, 0, 0);
    return o;
  }

  /* ---------- matching ---------- */
  function words(t) { return (String(t || '').toLowerCase().replace(/[’']/g, '').match(/[a-z0-9]+/g) || []); }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 3) return 9;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
    for (j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
  // how well one word from a line shows up in a panel's OCR words (0..1)
  function wordHit(w, ocrWords, ocrJoined) {
    if (ocrWords.indexOf(w) !== -1) return 1;
    if (w.length >= 5 && ocrJoined.indexOf(w.slice(1, -1)) !== -1) return 0.9;    // "breakfast" in "eakfast"
    var best = 0;
    for (var i = 0; i < ocrWords.length; i++) {
      var o = ocrWords[i]; if (o.length < 3) continue;
      if (w.length >= 5 && o.length >= 4 && (w.indexOf(o) !== -1 || o.indexOf(w) !== -1)) best = Math.max(best, 0.8);
      if (w.length >= 4 && o.length > w.length && o.indexOf(w) === 0) best = Math.max(best, 0.85);   // "make" in "makeit"
      var e = lev(w, o), lim = w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0;
      if (e <= lim) best = Math.max(best, 1 - e / (w.length + 1));
    }
    return best;
  }
  var STOP = /^(the|a|an|to|of|and|is|it|i|you|my|me|be|so|in|on|at|for|do|im|its|this|that|we|he|she|they|was|are|am|oh|um|uh)$/;
  function sim(line, ocr) {
    var lw = words(line).filter(function (w) { return w.length >= 2; }), ow = words(ocr);
    if (!lw.length || !ow.length) return 0;
    var joined = ow.join(''), tot = 0, got = 0;
    lw.forEach(function (w) {
      var weight = STOP.test(w) ? 0.3 : Math.min(3, 0.5 + w.length / 3);
      tot += weight; got += weight * wordHit(w, ow, joined);
    });
    var s = got / tot;
    return s < 0.25 ? 0 : s;     // a stray letter or two is not a match
  }

  // lines: story lines in order; texts: OCR text per panel in order.
  // Returns groups[panelIndex] = [lineIndex, ...], keeping the story order across panels.
  function match(lines, texts) {
    var L = lines.length, N = texts.length, i, j;
    var groups = texts.map(function () { return []; });
    if (!L || !N) return { groups: groups, matched: 0, readable: 0 };
    var S = lines.map(function (l) { return texts.map(function (t) { return sim(l, t); }); });
    var hasText = texts.map(function (t) { return words(t).filter(function (w) { return w.length >= 3; }).length >= 2; });
    var readable = hasText.filter(Boolean).length;
    var matched = S.filter(function (row) { return row.some(function (v) { return v >= 0.5; }); }).length;
    // Not enough to go on (no bubbles, or OCR found little): spread evenly like before.
    if (matched < Math.max(2, L * 0.25)) {
      lines.forEach(function (l, k) { groups[L >= N ? Math.min(N - 1, Math.floor(k * N / L)) : Math.round(k * (N - 1) / Math.max(1, L - 1))].push(k); });
      return { groups: groups, matched: matched, readable: readable, fallback: true };
    }
    // 1) Anchors: dynamic programming puts every line on a panel without going backwards, scoring how well
    //    the panel's words match; lines whose match is real (≥ 0.3) are anchors.
    function score(i, j) {
      var v = S[i][j] >= 0.3 ? S[i][j] : 0;
      var exp = L > 1 ? i * (N - 1) / (L - 1) : 0;
      return v - 0.01 * Math.abs(j - exp) / Math.max(1, N / 6);      // tiny nudge only to break ties
    }
    var dp = [], from = [];
    for (i = 0; i < L; i++) {
      dp.push(new Float64Array(N)); from.push(new Int32Array(N));
      var best = -1e18, bi = -1;
      for (j = 0; j < N; j++) {
        if (i === 0) { dp[i][j] = score(0, j); continue; }
        if (dp[i - 1][j] > best) { best = dp[i - 1][j]; bi = j; }   // previous line on a panel ≤ j
        dp[i][j] = best + score(i, j); from[i][j] = bi;
      }
    }
    var end = 0; for (j = 1; j < N; j++) if (dp[L - 1][j] > dp[L - 1][end]) end = j;
    var at = []; at[L - 1] = end;
    for (i = L - 1; i > 0; i--) at[i - 1] = from[i][at[i]];
    var anchor = at.map(function (p, k) { return S[k][p] >= 0.3; });
    var anchoredPanel = texts.map(function () { return false; });
    at.forEach(function (p, k) { if (anchor[k]) anchoredPanel[p] = true; });
    var inkOf = texts.map(function (t) { return words(t).filter(function (w) { return w.length >= 3; }).length; });
    // 2) Lines that couldn't be read go between their anchors: onto panels there that have words nobody
    //    matched (a bubble or sign the reader couldn't make out); if there are fewer such panels than lines,
    //    the earlier ones join the panel before them (a second bubble), the last ones take the free panels.
    var k0 = 0;
    while (k0 < L) {
      if (anchor[k0]) { k0++; continue; }
      var k1 = k0; while (k1 < L && !anchor[k1]) k1++;                 // lines k0..k1-1 are unread
      var pa = k0 > 0 ? at[k0 - 1] : -1, pb = k1 < L ? at[k1] : N;
      var free = []; for (j = pa + 1; j < pb; j++) if (!anchoredPanel[j] && inkOf[j] >= 1) free.push(j);
      var gap = k1 - k0;
      if (free.length > gap) free = free.map(function (j) { return j; }).sort(function (x, y) { return inkOf[y] - inkOf[x]; }).slice(0, gap).sort(function (x, y) { return x - y; });
      if (!free.length) {   // no panel with unread words: any panel in between, or share the neighbour's
        for (j = pa + 1; j < pb; j++) free.push(j);
        if (free.length > gap) free = free.filter(function (j, q) { return q % Math.ceil(free.length / gap) === 0; }).slice(0, gap);
      }
      for (var q = 0; q < gap; q++) {
        var off = gap - free.length;                                   // leftover lines join the panel before
        at[k0 + q] = q >= off ? free[q - off] : (pa >= 0 ? pa : (free[0] != null ? free[0] : 0));
      }
      k0 = k1;
    }
    at.forEach(function (p, k) { groups[p].push(k); });
    return { groups: groups, matched: matched, readable: readable, fallback: false, sim: S };
  }

  root.YBComicOCR = { read: read, match: match, _sim: sim };
})(typeof window !== 'undefined' ? window : globalThis);
