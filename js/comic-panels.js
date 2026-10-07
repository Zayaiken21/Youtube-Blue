/* Youtube Blue — comic panel finder (v2).
   Finds the panels of a comic page and returns them in reading order.
   Pure function, no page access, so it can run anywhere (and in tests).

   Works on white, off-white, cream, black or coloured gutters, JPEG noise,
   transparent PNGs and phone screenshots with bars around the page:
   1. Transparent pixels count as white; uniform bars around the page are cut off.
   2. The gutter colour is read from the page itself (its border), and white and
      black are tried too.
   3. Two finders run for every colour: an "XY cut" over full gutter lines, and a
      "blob" finder that boxes each island of artwork. The most sensible
      result wins (covers the page, several panels, no giant leftovers).
   4. Reading order: rows by their top edge, left to right; a tall panel reads
      with the row it starts in. */
(function (root) {
  'use strict';

  function find(img, opts) {
    opts = opts || {};
    var W = img.width, H = img.height, d = img.data, N = W * H;
    var minFrac = opts.minPanel == null ? 0.06 : opts.minPanel;
    var tol = Math.max(18, Math.min(80, 255 - (opts.light == null ? 228 : opts.light) + 14));

    // RGB with transparency flattened onto white
    var R = new Uint8Array(N), G = new Uint8Array(N), B = new Uint8Array(N);
    for (var i = 0, p = 0; i < N; i++, p += 4) {
      var a = d[p + 3] / 255;
      R[i] = Math.round(d[p] * a + 255 * (1 - a)); G[i] = Math.round(d[p + 1] * a + 255 * (1 - a)); B[i] = Math.round(d[p + 2] * a + 255 * (1 - a));
    }

    // Colour of the page border (most common colour in the outer frame)
    function borderColour(x0, y0, x1, y1) {
      var t = Math.max(2, Math.round(Math.min(x1 - x0, y1 - y0) * 0.012)), hist = {}, best = null;
      function add(x, y) {
        var k = y * W + x, key = (R[k] >> 4) + ',' + (G[k] >> 4) + ',' + (B[k] >> 4), h = hist[key] || (hist[key] = { n: 0, r: 0, g: 0, b: 0 });
        h.n++; h.r += R[k]; h.g += G[k]; h.b += B[k];
      }
      for (var y = y0; y < y1; y += 2) for (var x = x0; x < x1; x += 2) {
        if (x - x0 < t || x1 - x <= t || y - y0 < t || y1 - y <= t) add(x, y);
      }
      var total = 0;
      Object.keys(hist).forEach(function (k) { total += hist[k].n; if (!best || hist[k].n > best.n) best = hist[k]; });
      return best ? { r: best.r / best.n, g: best.g / best.n, b: best.b / best.n, share: best.n / total } : null;
    }
    function near(k, c, t) { return Math.abs(R[k] - c.r) <= t && Math.abs(G[k] - c.g) <= t && Math.abs(B[k] - c.b) <= t; }

    // 1. Cut off uniform bars of any colour (phone UI, black/white margins), from the outside in.
    var box = { x0: 0, y0: 0, x1: W, y1: H };
    function uniformRow(y, x0, x1) { return uniform(function (f) { for (var x = x0; x < x1; x += 2) f(y * W + x); }); }
    function uniformCol(x, y0, y1) { return uniform(function (f) { for (var y = y0; y < y1; y += 2) f(y * W + x); }); }
    function uniform(each) {
      var ks = []; each(function (k) { ks.push(k); }); if (!ks.length) return null;
      var m = ks[ks.length >> 1], c = { r: R[m], g: G[m], b: B[m] }, n = 0;
      // median-ish reference: the middle sample is usually fine for a flat bar; check agreement
      ks.forEach(function (k) { if (near(k, c, 26)) n++; });
      return n >= ks.length * 0.97 ? c : null;
    }
    for (var pass = 0; pass < 6; pass++) {
      var b0 = JSON.stringify(box);
      while (box.y1 - box.y0 > H * 0.3 && uniformRow(box.y0, box.x0, box.x1)) box.y0++;
      while (box.y1 - box.y0 > H * 0.3 && uniformRow(box.y1 - 1, box.x0, box.x1)) box.y1--;
      while (box.x1 - box.x0 > W * 0.3 && uniformCol(box.x0, box.y0, box.y1)) box.x0++;
      while (box.x1 - box.x0 > W * 0.3 && uniformCol(box.x1 - 1, box.y0, box.y1)) box.x1--;
      if (JSON.stringify(box) === b0) break;
    }
    // keep a hair of margin so a gutter-coloured edge still separates the first panel
    box.x0 = Math.max(0, box.x0 - 2); box.y0 = Math.max(0, box.y0 - 2); box.x1 = Math.min(W, box.x1 + 2); box.y1 = Math.min(H, box.y1 + 2);
    var BW = box.x1 - box.x0, BH = box.y1 - box.y0;
    var minPanel = Math.max(16, Math.round(Math.min(BW, BH) * minFrac));

    // 2. Gutter colour candidates: the page's own border colour, then white and black.
    var cands = [], bcol = borderColour(box.x0, box.y0, box.x1, box.y1);
    function addCand(c, t) { if (!cands.some(function (o) { return Math.abs(o.r - c.r) + Math.abs(o.g - c.g) + Math.abs(o.b - c.b) < 40; })) cands.push({ r: c.r, g: c.g, b: c.b, t: t }); }
    // the colour of long uniform lines inside the page is almost always the gutter colour
    var lines = {}, lc = null;
    function addLine(c) { if (!c) return; var key = (c.r >> 4) + ',' + (c.g >> 4) + ',' + (c.b >> 4), h = lines[key] || (lines[key] = { n: 0, r: 0, g: 0, b: 0 }); h.n++; h.r += c.r; h.g += c.g; h.b += c.b; }
    for (var yy = box.y0; yy < box.y1; yy += 3) addLine(uniformRow(yy, box.x0, box.x1));
    for (var xx = box.x0; xx < box.x1; xx += 3) addLine(uniformCol(xx, box.y0, box.y1));
    Object.keys(lines).forEach(function (k) { if (!lc || lines[k].n > lc.n) lc = lines[k]; });
    if (lc && lc.n >= 3) addCand({ r: lc.r / lc.n, g: lc.g / lc.n, b: lc.b / lc.n }, tol + 10);
    if (opts.dark === true) addCand({ r: 0, g: 0, b: 0 }, tol + 20);
    if (bcol && bcol.share > 0.25) addCand(bcol, tol + 6);
    addCand({ r: 255, g: 255, b: 255 }, tol);
    addCand({ r: 0, g: 0, b: 0 }, tol + 20);

    var best = null;
    cands.forEach(function (c) {
      var g = new Uint8Array(N);
      for (var y = box.y0; y < box.y1; y++) for (var x = box.x0, k = y * W + box.x0; x < box.x1; x++, k++) g[k] = near(k, c, c.t) ? 1 : 0;
      [xyCut(g, 0.965), xyCut(g, 0.92), blobs(g)].forEach(function (res, m) {
        var sc = score(res);
        if (m === 2) sc -= 0.04;            // prefer clean gutter cuts when equally good
        if (!best || sc > best.sc) best = { sc: sc, res: res };
      });
    });
    var out = best && best.res.length ? best.res : [{ x: box.x0, y: box.y0, w: BW, h: BH }];
    return order(out);

    // How sensible a set of panels looks.
    function score(res) {
      if (!res.length) return -1;
      var area = BW * BH, cov = 0, big = 0, tiny = 0;
      res.forEach(function (r) { var a = r.w * r.h; cov += a; if (a > area * 0.85) big++; if (a < area * 0.004) tiny++; });
      cov = Math.min(1, cov / area);
      if (res.length === 1) return 0.05 + 0.1 * cov;
      return cov * 0.6 + Math.min(res.length, 24) / 24 * 0.4 - big * 0.5 - tiny * 0.05;
    }

    function xyCut(g, cover) {
      var out = [], guard = 0, minGap = 2;
      function rowFull(y, x0, x1) {
        var need = Math.ceil((x1 - x0) * cover), miss = (x1 - x0) - need, bad = 0;
        for (var x = x0, o = y * W + x0; x < x1; x++, o++) if (!g[o] && ++bad > miss) return false;
        return true;
      }
      function colFull(x, y0, y1) {
        var need = Math.ceil((y1 - y0) * cover), miss = (y1 - y0) - need, bad = 0;
        for (var y = y0, o = y0 * W + x; y < y1; y++, o += W) if (!g[o] && ++bad > miss) return false;
        return true;
      }
      function segments(a0, a1, full) {
        var segs = [], start = -1, gap = 0, a;
        for (a = a0; a < a1; a++) {
          if (full(a)) { gap++; if (start !== -1 && gap >= minGap) { segs.push([start, a - gap + 1]); start = -1; } }
          else { if (start === -1) start = a; gap = 0; }
        }
        if (start !== -1) segs.push([start, a1 - (gap < minGap ? 0 : gap)]);
        return segs.filter(function (s) { return s[1] - s[0] >= minPanel; });
      }
      function cut(x0, y0, x1, y1, depth, dir) {
        if (++guard > 3000 || depth > 30 || x1 - x0 < minPanel || y1 - y0 < minPanel) return;
        var rows = segments(y0, y1, function (y) { return rowFull(y, x0, x1); });
        var cols = segments(x0, x1, function (x) { return colFull(x, y0, y1); });
        if (rows.length > 1) { rows.forEach(function (s) { cut(x0, s[0], x1, s[1], depth + 1); }); return; }
        if (cols.length > 1) { cols.forEach(function (s) { cut(s[0], y0, s[1], y1, depth + 1); }); return; }
        if (!rows.length || !cols.length) return;   // all gutter
        var nx0 = cols[0][0], nx1 = cols[0][1], ny0 = rows[0][0], ny1 = rows[0][1];
        if (nx0 > x0 || nx1 < x1 || ny0 > y0 || ny1 < y1) { cut(nx0, ny0, nx1, ny1, depth + 1); return; }   // margins trimmed: look again
        out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      }
      cut(box.x0, box.y0, box.x1, box.y1, 0);
      return out;
    }

    // Islands of artwork on a coarse grid (handles gutters broken by speech bubbles at the edges).
    function blobs(g) {
      var cell = Math.max(2, Math.round(Math.max(BW, BH) / 360)), cw = Math.ceil(BW / cell), ch = Math.ceil(BH / cell);
      var on = new Uint8Array(cw * ch), lab = new Int32Array(cw * ch), cx, cy;
      for (cy = 0; cy < ch; cy++) for (cx = 0; cx < cw; cx++) {
        var n = 0, tot = 0;
        for (var y = box.y0 + cy * cell; y < Math.min(box.y1, box.y0 + (cy + 1) * cell); y++)
          for (var x = box.x0 + cx * cell; x < Math.min(box.x1, box.x0 + (cx + 1) * cell); x++) { tot++; if (!g[y * W + x]) n++; }
        on[cy * cw + cx] = n > tot * 0.35 ? 1 : 0;
      }
      var res = [], stack = [], id = 0, minCells = Math.max(3, Math.round(minPanel / cell));
      for (var s = 0; s < on.length; s++) {
        if (!on[s] || lab[s]) continue;
        id++; stack.push(s); lab[s] = id;
        var x0 = cw, y0 = ch, x1 = 0, y1 = 0;
        while (stack.length) {
          var q = stack.pop(), qx = q % cw, qy = (q - qx) / cw;
          if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
          if (qx > 0 && on[q - 1] && !lab[q - 1]) { lab[q - 1] = id; stack.push(q - 1); }
          if (qx < cw - 1 && on[q + 1] && !lab[q + 1]) { lab[q + 1] = id; stack.push(q + 1); }
          if (qy > 0 && on[q - cw] && !lab[q - cw]) { lab[q - cw] = id; stack.push(q - cw); }
          if (qy < ch - 1 && on[q + cw] && !lab[q + cw]) { lab[q + cw] = id; stack.push(q + cw); }
        }
        if (x1 - x0 + 1 >= minCells && y1 - y0 + 1 >= minCells)
          res.push({ x: box.x0 + x0 * cell, y: box.y0 + y0 * cell, w: Math.min(BW, (x1 - x0 + 1) * cell), h: Math.min(BH, (y1 - y0 + 1) * cell) });
      }
      // drop boxes sitting inside bigger ones
      return res.filter(function (a) { return !res.some(function (b) { return b !== a && b.w * b.h > a.w * a.h && a.x >= b.x - 2 && a.y >= b.y - 2 && a.x + a.w <= b.x + b.w + 2 && a.y + a.h <= b.y + b.h + 2; }); });
    }
  }

  // Reading order: rows by top edge (tolerance = a third of the typical panel height), then left → right.
  function order(list) {
    if (!list.length) return list;
    var hs = list.map(function (r) { return r.h; }).sort(function (a, b) { return a - b; });
    var tol = Math.max(8, hs[Math.floor(hs.length / 2)] * 0.33);
    var sorted = list.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; });
    var rows = [];
    sorted.forEach(function (r) {
      var row = rows.find(function (R) { return Math.abs(R.top - r.y) <= tol; });
      if (row) row.items.push(r); else rows.push({ top: r.y, items: [r] });
    });
    rows.sort(function (a, b) { return a.top - b.top; });
    var out = [];
    rows.forEach(function (R) { R.items.sort(function (a, b) { return a.x - b.x; }).forEach(function (r) { out.push(r); }); });
    return out;
  }

  // Equal grid (rows × cols) in reading order — for pages without clear gutters.
  function grid(x, y, w, h, rows, cols) {
    var out = [];
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++)
      out.push({ x: Math.round(x + w * c / cols), y: Math.round(y + h * r / rows), w: Math.round(w / cols), h: Math.round(h / rows) });
    return out;
  }

  // Best place to split one panel in two: the lightest/most uniform line near the middle.
  function splitLine(img, r, horizontal) {
    var W = img.width, d = img.data, len = horizontal ? r.h : r.w, best = -1, bestScore = -1;
    for (var t = Math.round(len * 0.25); t <= Math.round(len * 0.75); t++) {
      var n = 0, light = 0, step = 2;
      if (horizontal) { var y = r.y + t; for (var x = r.x; x < r.x + r.w; x += step) { var k = (y * W + x) * 4; n++; if (Math.min(d[k], d[k + 1], d[k + 2]) > 225 || Math.max(d[k], d[k + 1], d[k + 2]) < 30) light++; } }
      else { var xx = r.x + t; for (var yy = r.y; yy < r.y + r.h; yy += step) { var kk = (yy * W + xx) * 4; n++; if (Math.min(d[kk], d[kk + 1], d[kk + 2]) > 225 || Math.max(d[kk], d[kk + 1], d[kk + 2]) < 30) light++; } }
      var sc = light / n - Math.abs(t / len - 0.5) * 0.3;   // prefer a gutter-like line, then the middle
      if (sc > bestScore) { bestScore = sc; best = t; }
    }
    return best < 0 ? Math.round(len / 2) : best;
  }

  var api = { find: find, order: order, grid: grid, splitLine: splitLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.YBPanels = api;
})(typeof window !== 'undefined' ? window : this);
