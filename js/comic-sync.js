/* Youtube Blue — Comic to Video: line the pictures and captions up with the voice, automatically.

   analyze(samples, rate)  → where the speech and the pauses are in the voice track
   plan(analysis, weights) → when each panel starts and ends, and the speech inside it

   How the panels are placed: every panel gets a share of the *speech* in proportion
   to how much its caption says (panels without a caption share evenly). The cut
   from one panel to the next is moved to the nearest real pause, so a picture never
   changes in the middle of a word, and it changes just before the next words start.
   Captions are then timed across the speech inside their own panel, so each caption
   appears when its words are spoken and waits through the pauses.

   Pure functions, no DOM: window.YBAudioSync. */
(function (root) {
  'use strict';

  var HOP = 0.01;   // 10 ms frames

  function analyze(x, rate) {
    var hop = Math.max(1, Math.round(rate * HOP)), n = Math.floor(x.length / hop), db = new Float32Array(n), i, k;
    for (i = 0; i < n; i++) {
      var s = 0, o = i * hop;
      for (k = 0; k < hop; k++) { var v = x[o + k]; s += v * v; }
      db[i] = 10 * Math.log10(s / hop + 1e-10);
    }
    var dur = x.length / rate;
    if (!n) return { dur: dur, segs: [], pauses: [], speech: 0 };
    // noise floor and loud level from the track itself, so quiet or loud recordings both work
    var sorted = Array.prototype.slice.call(db).sort(function (a, b) { return a - b; });
    var floor = sorted[Math.floor(n * 0.1)], loud = sorted[Math.floor(n * 0.95)];
    var th = Math.max(floor + 9, loud - 32, -62);
    var on = new Uint8Array(n);
    for (i = 0; i < n; i++) on[i] = db[i] > th ? 1 : 0;
    // close tiny gaps inside words (< 120 ms), drop clicks (< 60 ms)
    fill(on, 0, 12); fill(on, 1, 6);
    var segs = [], start = -1;
    for (i = 0; i <= n; i++) {
      if (i < n && on[i]) { if (start < 0) start = i; }
      else if (start >= 0) { segs.push([start * HOP, i * HOP]); start = -1; }
    }
    var pauses = [], speech = 0, at = 0;
    segs.forEach(function (sg, j) {
      speech += sg[1] - sg[0];
      if (j < segs.length - 1) pauses.push({ s: sg[1], e: segs[j + 1][0], len: segs[j + 1][0] - sg[1], u: speech });   // u = speech heard before this pause
    });
    return { dur: dur, segs: segs, pauses: pauses, speech: speech };
  }
  // turn runs of `val` shorter than `len` frames into the other value (not at the edges)
  function fill(a, val, len) {
    var n = a.length, i = 0;
    while (i < n) {
      if (a[i] !== val) { i++; continue; }
      var j = i; while (j < n && a[j] === val) j++;
      if (i > 0 && j < n && j - i < len) for (var k = i; k < j; k++) a[k] = 1 - val;
      i = j;
    }
  }

  // speech-time (seconds of talking) → real time in the track
  function realAt(an, u) {
    var acc = 0;
    for (var j = 0; j < an.segs.length; j++) {
      var sg = an.segs[j], d = sg[1] - sg[0];
      if (acc + d >= u) return sg[0] + (u - acc);
      acc += d;
    }
    return an.segs.length ? an.segs[an.segs.length - 1][1] : 0;
  }

  // weights: one number per panel (how much it says). Returns { starts, ends, speech: [[ [s,e], ... ] per panel] }
  // Panels that say nothing (a picture with no caption) don't take any of the talking: they get a short
  // moment in the pause before the next words (or after the voice ends).
  function plan(an, weights) {
    var N = weights.length;
    if (!N) return null;
    var idx = []; weights.forEach(function (w, i) { if (w > 0) idx.push(i); });
    if (!idx.length || idx.length === N) return core(an, idx.length ? weights : weights.map(function () { return 1; }));
    var c = core(an, idx.map(function (i) { return weights[i]; }));
    var starts = new Array(N), ends = new Array(N), k, i;
    function speechStart(m) { var sp = c.speech[m]; return sp.length ? sp[0][0] : c.starts[m] + 0.1; }
    function speechEnd(m) { var sp = c.speech[m]; return sp.length ? sp[sp.length - 1][1] : c.ends[m]; }
    for (k = 0; k < idx.length; k++) { starts[idx[k]] = c.starts[k]; ends[idx[k]] = c.ends[k]; }
    // wordless panels before each worded panel (and at the very start)
    for (k = 0; k <= idx.length; k++) {
      var lo = k ? idx[k - 1] + 1 : 0, hi = k < idx.length ? idx[k] : N, m = hi - lo;
      if (!m) continue;
      if (k === idx.length) {   // after the last words: show them after the voice
        var t0 = speechEnd(idx.length - 1) + 0.25, d0 = 1.4;
        ends[idx[idx.length - 1]] = t0;
        for (i = 0; i < m; i++) { starts[lo + i] = t0 + i * d0; ends[lo + i] = t0 + (i + 1) * d0; }
        continue;
      }
      var cut = c.starts[k], from = k ? speechEnd(k - 1) + 0.15 : 0, room = cut - from;
      // fit in the pause when there's room (at least ~0.35 s each); otherwise right after the last words
      var fits = room >= 0.35 * m, d = fits ? Math.min(1.5, room / m) : 0.45;
      var begin = fits ? cut - d * m : Math.max(k ? c.starts[k - 1] + 0.3 : 0, from - 0.13);
      if (!fits) { cut = begin + d * m; starts[idx[k]] = cut; }
      if (k) ends[idx[k - 1]] = begin;
      for (i = 0; i < m; i++) { starts[lo + i] = begin + i * (cut - begin) / m; ends[lo + i] = begin + (i + 1) * (cut - begin) / m; }
      if (!k) starts[lo] = 0;
    }
    var speech = starts.map(function (s0, j) {
      return an.segs.filter(function (sg) { return sg[1] > s0 && sg[0] < ends[j]; }).map(function (sg) { return [Math.max(sg[0], s0), Math.min(sg[1], ends[j])]; });
    });
    return { starts: starts, ends: ends, speech: speech, synced: c.synced };
  }

  function core(an, weights) {
    var N = weights.length, dur = an.dur;
    if (!N) return null;
    if (!an.segs.length || an.speech < 0.3) {   // no speech found: share the track evenly
      var even = dur / N;
      return { starts: weights.map(function (w, i) { return i * even; }), ends: weights.map(function (w, i) { return (i + 1) * even; }), speech: weights.map(function () { return []; }), synced: false };
    }
    var avg = weights.reduce(function (a, b) { return a + b; }, 0) / N || 1;
    var w = weights.map(function (v) { return v > 0 ? v : avg * 0.35; });   // a panel with no words still gets a little time
    var tot = w.reduce(function (a, b) { return a + b; }, 0), U = an.speech, targets = [], acc = 0, k, j;
    for (k = 0; k < N - 1; k++) { acc += w[k]; targets.push(acc / tot * U); }

    // Choose one pause per cut, in order. Each panel is judged on its own (how much talking it should get vs.
    // how much lies between its two cuts), so small differences never add up down the comic; clear pauses win.
    var P = an.pauses, B = targets.length, cuts = [];
    if (B && P.length >= B) {
      var e = w.map(function (v) { return v / tot * U; }), u = P.map(function (p) { return p.u; });
      var lens = P.map(function (p) { return p.len; }).sort(function (a, b) { return a - b; });
      var Lref = Math.max(0.25, lens[Math.floor(lens.length * 0.8)] || 0.5);
      var bonus = P.map(function (p) { return 1.2 * Math.min(p.len, Lref) / Lref; });
      function seg(kk, a, b) { var d = b - a; return Math.abs(d - e[kk]) / Math.max(e[kk], 0.6); }
      var INF = 1e18, dp = [], from = [], M = P.length;
      dp[0] = u.map(function (uj, jj) { return jj <= M - B ? seg(0, 0, uj) - bonus[jj] : INF; });
      for (k = 1; k < B; k++) {
        dp[k] = new Array(M).fill(INF); from[k] = new Array(M).fill(-1);
        for (j = k; j <= M - (B - k); j++) {
          var bestV = INF, bestI = -1;
          for (var jp = k - 1; jp < j; jp++) {
            if (dp[k - 1][jp] >= INF) continue;
            var v = dp[k - 1][jp] + seg(k, u[jp], u[j]);
            if (v < bestV) { bestV = v; bestI = jp; }
          }
          if (bestI >= 0) { dp[k][j] = bestV - bonus[j]; from[k][j] = bestI; }
        }
      }
      var end = -1, ev = INF;
      for (j = 0; j < M; j++) { if (dp[B - 1][j] >= INF) continue; var fv = dp[B - 1][j] + seg(B, u[j], U); if (fv < ev) { ev = fv; end = j; } }
      var pick = [end];
      for (k = B - 1; k > 0; k--) pick.unshift(from[k][pick[0]]);
      cuts = pick.map(function (jj) { var p = P[jj]; return Math.max(p.s + Math.min(0.25, p.len * 0.5), p.e - 0.12); });   // change just before the next words
    } else {
      // not enough pauses: cut at the right share of the speech
      cuts = targets.map(function (u) { return realAt(an, u); });
    }
    var starts = [0].concat(cuts), ends = cuts.concat([Math.max(dur, cuts.length ? cuts[cuts.length - 1] + 0.5 : dur) + 0.35]);
    for (k = 1; k < N; k++) if (starts[k] < starts[k - 1] + 0.3) { starts[k] = starts[k - 1] + 0.3; ends[k - 1] = starts[k]; }
    var speech = starts.map(function (s, i) {
      return an.segs.filter(function (sg) { return sg[1] > s && sg[0] < ends[i]; }).map(function (sg) { return [Math.max(sg[0], s), Math.min(sg[1], ends[i])]; });
    });
    return { starts: starts, ends: ends, speech: speech, synced: true };
  }

  // Inside one panel: the real time when a fraction (0..1) of its speech has been said.
  function timeAt(spans, frac, fallbackStart, fallbackEnd) {
    var tot = spans.reduce(function (a, s) { return a + s[1] - s[0]; }, 0);
    if (!tot) return fallbackStart + (fallbackEnd - fallbackStart) * frac;
    var want = frac * tot, acc = 0;
    for (var i = 0; i < spans.length; i++) {
      var d = spans[i][1] - spans[i][0];
      if (acc + d >= want - 1e-9) return spans[i][0] + (want - acc);
      acc += d;
    }
    return spans[spans.length - 1][1];
  }

  // How long a caption takes to say, roughly: syllables (vowel groups) for alphabets, characters otherwise.
  function weight(text) {
    var t = String(text || '').replace(/\[[^\]]*\]/g, ' ');
    var words = t.match(/[\p{L}\p{N}'’]+/gu) || [], sum = 0;
    words.forEach(function (w) {
      if (/^[\p{N}]+$/u.test(w)) { sum += Math.max(1, w.length); return; }
      if (/[a-zà-ÿ]/i.test(w)) {
        var v = w.toLowerCase().replace(/'s$|’s$/, '').replace(/e$/, '').match(/[aeiouyà-ÿ]+/g);
        sum += Math.max(1, v ? v.length : 1);
      } else sum += Math.max(1, Math.round(w.length * 0.8));   // e.g. Chinese/Japanese characters ≈ a syllable each
    });
    var pauses = (t.match(/[,;:—–]/g) || []).length * 0.4;
    return sum + pauses;
  }

  root.YBAudioSync = { weight: weight, analyze: analyze, plan: plan, timeAt: timeAt };
})(typeof window !== 'undefined' ? window : globalThis);
