/* Youtube Blue — keep voices in sync when several characters say a line together.

   Each character's clip is made on its own, so everyone speaks at a slightly
   different pace and the words drift apart (that sounds like an echo).
   Here every other voice is lined up with the main speaker, word by word:

   1. Both clips are turned into short sound "fingerprints" (10 ms frames).
   2. Dynamic time warping finds which moment in the other voice matches
      each moment of the main speaker.
   3. The other voice is gently sped up / slowed down along that map with
      WSOLA (waveform-similarity overlap-add), which keeps the pitch and
      the sound of the voice; it never uses a phase vocoder, so no echo.
   4. Everyone starts on the same sample, loudness is matched to the main
      speaker, and the mix is kept from clipping.

   Pure functions, no DOM: window.YBVoiceSync = { align, chorus }.
   If this file is missing, Voice Studio falls back to a simple mix. */
(function (root) {
  'use strict';

  /* ---------- small FFT (radix-2, in place) ---------- */
  function fft(re, im) {
    var n = re.length, i, j, k, len, half, step, wr, wi, cr, ci, tr, ti, a;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { tr = re[i]; re[i] = re[j]; re[j] = tr; ti = im[i]; im[i] = im[j]; im[j] = ti; }
    }
    for (len = 2; len <= n; len <<= 1) {
      half = len >> 1; step = -2 * Math.PI / len;
      for (i = 0; i < n; i += len) {
        for (k = 0; k < half; k++) {
          a = step * k; wr = Math.cos(a); wi = Math.sin(a);
          cr = re[i + k + half] * wr - im[i + k + half] * wi;
          ci = re[i + k + half] * wi + im[i + k + half] * wr;
          re[i + k + half] = re[i + k] - cr; im[i + k + half] = im[i + k] - ci;
          re[i + k] += cr; im[i + k] += ci;
        }
      }
    }
  }

  /* ---------- features: normalised MFCCs + loudness, one row per 10 ms ---------- */
  function features(x, rate, hop) {
    var N = 1; while (N < rate * 0.025) N <<= 1;
    var nb = 26, nc = 12, lo = 80, hi = Math.min(7600, rate / 2 - 1);
    function mel(f) { return 2595 * Math.log10(1 + f / 700); }
    function imel(m) { return 700 * (Math.pow(10, m / 2595) - 1); }
    var edges = [], b, i, k;
    for (b = 0; b < nb + 2; b++) edges.push(Math.floor(imel(mel(lo) + (mel(hi) - mel(lo)) * b / (nb + 1)) / rate * N));
    var win = new Float32Array(N); for (i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1));
    var frames = Math.max(1, Math.floor((x.length - 1) / hop) + 1);
    var dim = nc + 1, F = new Float32Array(frames * dim), energy = new Float32Array(frames);
    var re = new Float32Array(N), im = new Float32Array(N), pw = new Float32Array(N / 2 + 1), lm = new Float32Array(nb);
    for (var f = 0; f < frames; f++) {
      var start = f * hop - (N >> 1), e = 0;
      for (i = 0; i < N; i++) { var s = x[start + i] || 0; re[i] = s * win[i]; im[i] = 0; e += s * s; }
      fft(re, im);
      for (i = 0; i <= N / 2; i++) pw[i] = re[i] * re[i] + im[i] * im[i];
      for (b = 0; b < nb; b++) {
        var sum = 0, l = edges[b], c = Math.max(edges[b + 1], l + 1), r = Math.max(edges[b + 2], c + 1);
        for (k = l; k < c; k++) sum += pw[k] * (k - l) / (c - l);
        for (k = c; k < r; k++) sum += pw[k] * (r - k) / (r - c);
        lm[b] = Math.log(sum + 1e-9);
      }
      for (k = 1; k <= nc; k++) {
        var acc = 0;
        for (b = 0; b < nb; b++) acc += lm[b] * Math.cos(Math.PI * k * (b + 0.5) / nb);
        F[f * dim + k - 1] = acc;
      }
      energy[f] = Math.log(e / N + 1e-9);
    }
    // per-voice normalisation so a deep voice and a high voice can still be compared
    for (k = 0; k < nc; k++) {
      var m = 0, v = 0;
      for (f = 0; f < frames; f++) m += F[f * dim + k];
      m /= frames;
      for (f = 0; f < frames; f++) { var d = F[f * dim + k] - m; v += d * d; }
      v = Math.sqrt(v / frames) || 1;
      for (f = 0; f < frames; f++) F[f * dim + k] = (F[f * dim + k] - m) / v;
    }
    // loudness 0..1 (speech vs. pause matters most for lining up words), weighted strongly
    var emax = -1e9; for (f = 0; f < frames; f++) if (energy[f] > emax) emax = energy[f];
    for (f = 0; f < frames; f++) F[f * dim + nc] = 3 * Math.max(0, Math.min(1, (energy[f] - emax + 9) / 9));
    return { F: F, n: frames, dim: dim };
  }

  /* ---------- DTW inside a band; returns for each lead frame the matching frame in the other voice ---------- */
  function warpMap(A, B) {
    var n = A.n, m = B.n, dim = A.dim, INF = 1e30;
    var band = Math.max(Math.abs(n - m) + 40, Math.round(Math.max(n, m) * 0.25));
    function d(i, j) {
      var s = 0, a = i * dim, b = j * dim;
      for (var k = 0; k < dim; k++) { var t = A.F[a + k] - B.F[b + k]; s += t * t; }
      return Math.sqrt(s);
    }
    var lo = new Int32Array(n), hi = new Int32Array(n), off = new Int32Array(n + 1), i, j;
    for (i = 0; i < n; i++) {
      var c = Math.round(i * (m - 1) / Math.max(1, n - 1));
      lo[i] = Math.max(0, c - band); hi[i] = Math.min(m - 1, c + band);
      off[i + 1] = off[i] + (hi[i] - lo[i] + 1);
    }
    var D = new Float32Array(off[n]), P = new Uint8Array(off[n]);
    function at(ii, jj) { return (jj < lo[ii] || jj > hi[ii]) ? -1 : off[ii] + jj - lo[ii]; }
    var pen = 0.15;   // a small cost for holding still, so the path prefers natural pacing
    for (i = 0; i < n; i++) {
      for (j = lo[i]; j <= hi[i]; j++) {
        var idx = off[i] + j - lo[i], cost = d(i, j), best = INF, dir = 0, q;
        if (i === 0 && j === 0) { D[idx] = cost; P[idx] = 0; continue; }
        if (i > 0 && j > 0 && (q = at(i - 1, j - 1)) >= 0 && D[q] < best) { best = D[q]; dir = 1; }
        if (i > 0 && (q = at(i - 1, j)) >= 0 && D[q] + pen < best) { best = D[q] + pen; dir = 2; }
        if (j > 0 && (q = at(i, j - 1)) >= 0 && D[q] + pen < best) { best = D[q] + pen; dir = 3; }
        D[idx] = best >= INF ? INF : best + cost; P[idx] = dir;
      }
    }
    // walk back from the end
    var sums = new Float64Array(n), cnt = new Int32Array(n);
    i = n - 1; j = Math.min(m - 1, hi[n - 1]);
    if (at(i, j) < 0) j = hi[i];
    var guard = n + m + 5;
    while (guard-- > 0) {
      sums[i] += j; cnt[i]++;
      var p = P[at(i, j)];
      if (p === 1) { i--; j--; } else if (p === 2) i--; else if (p === 3) j--; else break;
      if (i < 0 || j < 0) break;
    }
    var map = new Float32Array(n);
    for (i = 0; i < n; i++) map[i] = cnt[i] ? sums[i] / cnt[i] : (i ? map[i - 1] : 0);
    // smooth, then keep the pace change gentle (between half and double speed) so the voice stays natural
    var sm = new Float32Array(n), R = 4;
    for (i = 0; i < n; i++) { var t = 0, c2 = 0; for (j = Math.max(0, i - R); j <= Math.min(n - 1, i + R); j++) { t += map[j]; c2++; } sm[i] = t / c2; }
    sm[0] = Math.max(0, sm[0]);
    for (i = 1; i < n; i++) sm[i] = Math.min(Math.max(sm[i], sm[i - 1] + 0.5), sm[i - 1] + 2);
    for (i = 0; i < n; i++) sm[i] = Math.min(sm[i], m - 1);
    return sm;
  }

  /* ---------- WSOLA along the map: output has the lead's length and timing ---------- */
  function render(x, map, hopF, outLen) {
    var W = 1024; while (W > 256 && W > outLen / 4) W >>= 1;
    var H = W >> 1, tol = W >> 2, out = new Float32Array(outLen), win = new Float32Array(W), i, k;
    for (i = 0; i < W; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / W);   // periodic Hann: 50% overlap sums to 1
    function srcAt(t) {   // output sample -> source sample, through the frame map
      var f = t / hopF, a = Math.floor(f), b = Math.min(map.length - 1, a + 1), w = f - a;
      if (a >= map.length - 1) return map[map.length - 1] * hopF + (t - (map.length - 1) * hopF);
      return (map[a] * (1 - w) + map[b] * w) * hopF;
    }
    var prev = -1;
    for (var o = -H; o < outLen; o += H) {
      var want = Math.round(srcAt(Math.max(0, o + H)) - H), best = want;
      if (prev >= 0) {
        var nat = prev + H, bestScore = -1e30;
        for (var c = want - tol; c <= want + tol; c += 2) {
          var sc = 0;
          for (k = 0; k < H; k += 4) sc += (x[c + k] || 0) * (x[nat + k] || 0);
          if (sc > bestScore) { bestScore = sc; best = c; }
        }
      }
      for (k = 0; k < W; k++) { var oi = o + k; if (oi >= 0 && oi < outLen) out[oi] += (x[best + k] || 0) * win[k]; }
      prev = best;
    }
    return out;
  }

  function rms(x) { var s = 0, n = 0; for (var i = 0; i < x.length; i++) if (Math.abs(x[i]) > 0.003) { s += x[i] * x[i]; n++; } return n ? Math.sqrt(s / n) : 0; }

  // Line `other` up with `lead`. Returns audio with exactly lead.length samples.
  function align(lead, other, rate) {
    if (!lead.length || !other.length) return new Float32Array(lead.length);
    var hop = Math.round(rate * 0.01);
    if ((lead.length / hop) * (other.length / hop) > 9e6) hop = Math.round(rate * 0.02);   // very long lines: coarser steps
    var map = warpMap(features(lead, rate, hop), features(other, rate, hop));
    return render(other, map, hop, lead.length);
  }

  // Mix several voices saying the same line. lines[0] is the main speaker; everyone follows their timing.
  function chorus(lines, rate) {
    if (lines.length === 1) return lines[0];
    var lead = lines[0], ref = rms(lead) || 0.1, out = Float32Array.from(lead), i, k;
    for (k = 1; k < lines.length; k++) {
      var al = align(lead, lines[k], rate), g = ref / (rms(al) || ref);
      g = Math.min(4, Math.max(0.25, g)) * 0.85;   // same loudness as the main voice, a touch behind it
      for (i = 0; i < out.length; i++) out[i] += al[i] * g;
    }
    // bring the group back to about one voice's loudness (a little fuller), and never clip
    var r = rms(out), target = ref * 1.2;
    var gain = r > target ? target / r : 1, peak = 0;
    for (i = 0; i < out.length; i++) { out[i] *= gain; var a = Math.abs(out[i]); if (a > peak) peak = a; }
    if (peak > 0.98) { var f = 0.98 / peak; for (i = 0; i < out.length; i++) out[i] *= f; }
    // soft 8 ms fade at both ends so nothing clicks
    var fd = Math.min(Math.round(rate * 0.008), out.length >> 1);
    for (i = 0; i < fd; i++) { out[i] *= i / fd; out[out.length - 1 - i] *= i / fd; }
    return out;
  }

  root.YBVoiceSync = { align: align, chorus: chorus, _features: features, _warpMap: warpMap };
})(typeof window !== 'undefined' ? window : globalThis);
