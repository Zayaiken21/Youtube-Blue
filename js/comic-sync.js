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
  function plan(an, weights, caps) {
    var N = weights.length;
    if (!N) return null;
    var idx = []; weights.forEach(function (w, i) { if (w > 0) idx.push(i); });
    // A Voice Studio story track knows exactly where every line is: match each caption to its lines.
    var exact = an.marks && caps ? exactCore(an, idx.length ? idx.map(function (i) { return caps[i]; }) : null) : null;
    if (!idx.length || idx.length === N) return exact || core(an, idx.length ? weights : weights.map(function () { return 1; }));
    var c = exact || core(an, idx.map(function (i) { return weights[i]; }));
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
      var cut = c.starts[k], from = k ? speechEnd(k - 1) + 0.06 : 0, room = cut - from;
      // fit in the pause when there's room (at least ~0.35 s each); otherwise right after the last words
      // Speaking panels always start on time. A picture-only panel uses the pause when there's room;
      // otherwise it takes a short moment from the end of the panel before it (never delaying the next words).
      // Picture-only panels live in the pause only — never over anyone's words. If the pause is too short
      // for them, they're skipped (zero time) rather than showing the wrong picture while someone speaks.
      var d = room >= 0.12 * m ? Math.min(1.5, room / m) : 0;
      var begin = Math.max(k ? Math.min(cut, c.starts[k - 1] + 0.3) : 0, cut - d * m);
      if (k) ends[idx[k - 1]] = begin;
      for (i = 0; i < m; i++) { starts[lo + i] = begin + i * (cut - begin) / m; ends[lo + i] = begin + (i + 1) * (cut - begin) / m; }
      if (!k) starts[lo] = 0;
    }
    var speech = starts.map(function (s0, j) {
      return an.segs.filter(function (sg) { return sg[1] > s0 && sg[0] < ends[j]; }).map(function (sg) { return [Math.max(sg[0], s0), Math.min(sg[1], ends[j])]; });
    });
    return { starts: starts, ends: ends, speech: speech, synced: c.synced, exact: !!c.exact };
  }

  /* ---------- Exact mode: line times saved with a Voice Studio story track ----------
     marks: [{ s, e, t }] — where each spoken line starts/ends in the track and its words.
     The panels' captions (in order) are matched letter by letter to those words, so each
     panel starts right before its first line and each caption follows its own line. */
  function norm(t) { return String(t || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ''); }
  function exactCore(an, caps) {
    if (!caps || !caps.length) return null;
    var M = '', mb = [], C = '', cb = [];
    an.marks.forEach(function (m) { var n = norm(m.t); mb.push({ a: M.length, b: M.length + n.length, s: m.s, e: m.e }); M += n; });
    caps.forEach(function (c) { var n = norm(c); cb.push({ a: C.length, b: C.length + n.length }); C += n; });
    if (!M.length || !C.length) return null;
    // align caption letters to track letters (tiny differences like tidied punctuation or a changed word are skipped)
    var map = new Int32Array(C.length + 1).fill(-1), i = 0, j = 0, matched = 0;
    while (i < C.length && j < M.length) {
      if (C[i] === M[j]) { map[i] = j; i++; j++; matched++; continue; }
      var w = C.substr(i, 8), k = M.indexOf(w, j), w2 = M.substr(j, 8), k2 = C.indexOf(w2, i);
      if (k !== -1 && k - j < 400 && (k2 === -1 || k - j <= k2 - i)) j = k;
      else if (k2 !== -1 && k2 - i < 400) { while (i < k2) map[i++] = j; }
      else { map[i] = j; i++; j++; }
    }
    while (i <= C.length) map[i++] = Math.min(j, M.length);
    if (matched < 0.7 * Math.min(C.length, M.length)) return null;   // captions don't match this track: use the pauses instead
    for (i = 0; i <= C.length; i++) if (map[i] < 0) map[i] = i ? map[i - 1] : 0;
    function at(x) {   // letter position in the track text → { time, line, atLineStart }
      for (var q = 0; q < mb.length; q++) {
        var m = mb[q];
        if (x < m.b || q === mb.length - 1) {
          if (x <= m.a + 1) return { t: m.s, k: q, start: true };
          return { t: m.s + Math.min(1, (x - m.a) / Math.max(1, m.b - m.a)) * (m.e - m.s), k: q, start: false };
        }
      }
      return { t: 0, k: 0, start: true };
    }
    var N = caps.length, starts = [], ends = [], q;
    for (q = 0; q < N; q++) {
      if (!q) { starts.push(0); continue; }
      var p = at(map[cb[q].a]), prevEnd = p.k ? mb[p.k - 1].e : 0, cut;
      if (p.start) cut = Math.max(prevEnd + 0.04, p.t - 0.15);            // just before this panel's first line
      else {                                                               // a caption that starts mid-line: nearest real pause
        var best = null;
        (an.pauses || []).forEach(function (pa) { if (Math.abs(pa.e - p.t) < 0.6 && (!best || Math.abs(pa.e - p.t) < Math.abs(best.e - p.t))) best = pa; });
        cut = best ? Math.max(best.s + 0.02, best.e - 0.1) : p.t - 0.05;
      }
      starts.push(Math.max(cut, starts[q - 1] + 0.3));
    }
    for (q = 0; q < N; q++) ends.push(q < N - 1 ? starts[q + 1] : Math.max(an.dur, mb[mb.length - 1].e) + 0.35);
    var speech = starts.map(function (s0, x) {
      return an.segs.filter(function (sg) { return sg[1] > s0 && sg[0] < ends[x]; }).map(function (sg) { return [Math.max(sg[0], s0), Math.min(sg[1], ends[x])]; });
    });
    return { starts: starts, ends: ends, speech: speech, synced: true, exact: true };
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
