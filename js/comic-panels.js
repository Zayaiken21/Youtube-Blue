/* Youtube Blue — comic panel finder.
   Finds the panels of a comic page by its white (or light) gutters and returns
   them in reading order. Pure function, no page access, so it can run anywhere.

   How: recursive "XY cut". In a region, rows that are almost entirely gutter
   colour split it into bands; if no band split exists, columns are tried. A
   region with no gutters left is a panel. Panels are then put in reading order:
   grouped into rows by their top edge, left to right within each row (a tall
   panel that spans two rows reads with the row it starts in). */
(function (root) {
  'use strict';

  // img: { data: Uint8ClampedArray RGBA, width, height }
  // opts: { light: 0–255 gutter brightness (default 228), cover: share of a line that must be gutter (0.965),
  //         minPanel: smallest panel as a share of the page's shorter side (0.06), minGap: px (2) }
  function find(img, opts) {
    opts = opts || {};
    var W = img.width, H = img.height, d = img.data;
    var light = opts.light == null ? 228 : opts.light;
    var cover = opts.cover == null ? 0.965 : opts.cover;
    var minGap = Math.max(1, opts.minGap == null ? 2 : opts.minGap);
    var minPanel = Math.max(16, Math.round(Math.min(W, H) * (opts.minPanel == null ? 0.06 : opts.minPanel)));
    var dark = opts.dark === true;   // black gutters instead of white

    // 1 = gutter pixel. Light & low-colour (white/cream/grey) — or very dark when dark gutters are chosen.
    var g = new Uint8Array(W * H);
    for (var i = 0, p = 0; i < g.length; i++, p += 4) {
      var r = d[p], gg = d[p + 1], b = d[p + 2], mx = r > gg ? (r > b ? r : b) : (gg > b ? gg : b), mn = r < gg ? (r < b ? r : b) : (gg < b ? gg : b);
      g[i] = dark ? (mx <= 255 - light ? 1 : 0) : (mn >= light && mx - mn <= 36 ? 1 : 0);
    }

    function rowFull(y, x0, x1) {
      var n = 0, need = Math.ceil((x1 - x0) * cover), miss = (x1 - x0) - need, bad = 0;
      for (var x = x0, o = y * W + x0; x < x1; x++, o++) { if (g[o]) n++; else if (++bad > miss) return false; }
      return n >= need;
    }
    function colFull(x, y0, y1) {
      var n = 0, need = Math.ceil((y1 - y0) * cover), miss = (y1 - y0) - need, bad = 0;
      for (var y = y0, o = y0 * W + x; y < y1; y++, o += W) { if (g[o]) n++; else if (++bad > miss) return false; }
      return n >= need;
    }
    // Content runs between gutter runs along one axis.
    function segments(a0, a1, full) {
      var segs = [], start = -1, gap = 0;
      for (var a = a0; a < a1; a++) {
        if (full(a)) { gap++; if (start !== -1 && gap >= minGap) { segs.push([start, a - gap + 1]); start = -1; } }
        else { if (start === -1) start = a; gap = 0; }
      }
      if (start !== -1) segs.push([start, a1 - (gap < minGap ? 0 : gap)]);
      return segs.filter(function (s) { return s[1] - s[0] >= minPanel; });
    }

    var out = [], guard = 0;
    function cut(x0, y0, x1, y1, depth) {
      if (++guard > 4000 || x1 - x0 < minPanel || y1 - y0 < minPanel) return;
      var rows = segments(y0, y1, function (y) { return rowFull(y, x0, x1); });
      if (rows.length > 1 || (rows.length === 1 && (rows[0][0] > y0 || rows[0][1] < y1) && depth < 40)) {
        if (rows.length === 1) { // only margins trimmed: carry on with columns inside
          var r0 = rows[0];
          return cutCols(x0, r0[0], x1, r0[1], depth + 1);
        }
        rows.forEach(function (s) { cut(x0, s[0], x1, s[1], depth + 1); });
        return;
      }
      cutCols(x0, y0, x1, y1, depth + 1);
    }
    function cutCols(x0, y0, x1, y1, depth) {
      var cols = segments(x0, x1, function (x) { return colFull(x, y0, y1); });
      if (cols.length > 1) { cols.forEach(function (s) { cut(s[0], y0, s[1], y1, depth + 1); }); return; }
      if (cols.length === 1 && (cols[0][0] > x0 || cols[0][1] < x1) && depth < 40) {
        // margins only: one more row pass inside, then it's a panel
        var c0 = cols[0], rows = segments(y0, y1, function (y) { return rowFull(y, c0[0], c0[1]); });
        if (rows.length > 1) { rows.forEach(function (s) { cut(c0[0], s[0], c0[1], s[1], depth + 1); }); return; }
        x0 = c0[0]; x1 = c0[1];
        if (rows.length === 1) { y0 = rows[0][0]; y1 = rows[0][1]; }
      }
      if (cols.length === 0) return;   // all gutter
      out.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
    cut(0, 0, W, H, 0);
    return order(out);
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

  var api = { find: find, order: order };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.YBPanels = api;
})(typeof window !== 'undefined' ? window : this);
