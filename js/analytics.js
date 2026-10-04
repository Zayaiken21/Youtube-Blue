/* =========================================================
   Youtube Blue — analytics.js
   Controls the Analytics page only: video log, KPIs, goals,
   SVG charts, insights, CSV import/export.
   Saved under storage key "analytics".
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;

  var DEFAULTS = { videos: [], baseSubs: 0, goalSubs: 1000, goalHours: 4000, goalShorts: 10000000 };
  var state = Object.assign({}, DEFAULTS, YB.store.get('analytics', {}));
  var ui = { sort: 'date', asc: false, metric: 'views', editing: null, query: '' };
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  function $(id) { return document.getElementById(id); }
  function save() { YB.store.set('analytics', state); }
  function n(v) { return Number(v) || 0; }
  function sum(arr, key) { return arr.reduce(function (s, v) { return s + n(v[key]); }, 0); }
  function avg(arr, key) { var a = arr.filter(function (v) { return v[key] !== '' && v[key] != null; }); return a.length ? sum(a, key) / a.length : 0; }
  function eng(v) { return n(v.views) ? ((n(v.likes) + n(v.comments)) / n(v.views)) * 100 : 0; }
  function fmtDate(d) { var x = new Date(d + 'T00:00:00'); return isNaN(x) ? d : x.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }); }
  function fmtDur(sec) { sec = Math.round(n(sec)); if (!sec) return '—'; var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }
  function trunc(s, len) { s = String(s); return s.length > len ? s.slice(0, len - 1) + '…' : s; }

  /* ---------- KPIs ---------- */
  function renderKpis() {
    var v = state.videos;
    var views = sum(v, 'views'), hours = sum(v, 'watchHours'), subs = sum(v, 'subs');
    var likes = sum(v, 'likes'), comments = sum(v, 'comments');
    var engagement = views ? ((likes + comments) / views) * 100 : 0;
    var tiles = [
      ['Total views', YB.num(views), v.length + ' videos'],
      ['Watch hours', YB.num(hours, 1), 'avg ' + YB.num(v.length ? hours / v.length : 0, 1) + ' per video'],
      ['Subscribers', YB.num(n(state.baseSubs) + subs), '+' + YB.num(subs) + ' from tracked videos'],
      ['Avg views', YB.num(v.length ? views / v.length : 0), 'per video'],
      ['Avg CTR', avg(v, 'ctr').toFixed(1) + '%', 'impressions → views'],
      ['Engagement', engagement.toFixed(2) + '%', '(likes + comments) ÷ views'],
      ['Avg view duration', fmtDur(avg(v, 'avd')), 'minutes:seconds'],
      ['Impressions', YB.num(sum(v, 'impressions')), 'times thumbnails were shown']
    ];
    $('kpis').innerHTML = tiles.map(function (t) {
      return '<div class="card kpi"><div class="kpi-label">' + t[0] + '</div><div class="kpi-value">' + t[1] + '</div><div class="kpi-note">' + t[2] + '</div></div>';
    }).join('');
  }

  /* ---------- Goals ---------- */
  function renderGoals() {
    var v = state.videos;
    var subs = n(state.baseSubs) + sum(v, 'subs');
    var longHours = sum(v.filter(function (x) { return x.type !== 'short'; }), 'watchHours');
    var shortViews = sum(v.filter(function (x) { return x.type === 'short'; }), 'views');
    var goals = [
      ['Subscribers', subs, n(state.goalSubs)],
      ['Long-form watch hours', longHours, n(state.goalHours)],
      ['Shorts views', shortViews, n(state.goalShorts)]
    ];
    $('goals').innerHTML = goals.map(function (g) {
      var pct = g[2] ? Math.min(100, (g[1] / g[2]) * 100) : 0;
      return '<div><div class="row between small"><b>' + g[0] + '</b><span class="muted">' + YB.num(g[1], 1) + ' / ' + YB.num(g[2]) + '</span></div>' +
        '<div class="progress" style="margin-top:6px"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
        '<div class="small muted" style="margin-top:4px">' + pct.toFixed(1) + '%' + (pct >= 100 ? ' — reached 🎉' : '') + '</div></div>';
    }).join('');
    $('gBase').value = state.baseSubs; $('gSubs').value = state.goalSubs; $('gHours').value = state.goalHours; $('gShorts').value = state.goalShorts;
  }

  /* ---------- Charts (plain SVG, no libraries) ---------- */
  function empty(msg) { return '<div class="chart-empty">' + (msg || 'Add videos to see this chart.') + '</div>'; }

  function niceMax(m) { if (m <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(m))); var f = m / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

  function renderTrend() {
    var data = state.videos.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (data.length < 2) { $('trendChart').innerHTML = empty('Add at least 2 videos to see a trend.'); return; }
    var key = ui.metric;
    var W = 600, H = 260, L = 48, R = 14, T = 14, B = 34;
    var max = niceMax(Math.max.apply(null, data.map(function (d) { return n(d[key]); })));
    var x = function (i) { return L + (i / (data.length - 1)) * (W - L - R); };
    var y = function (val) { return T + (1 - val / max) * (H - T - B); };
    var pts = data.map(function (d, i) { return x(i).toFixed(1) + ',' + y(n(d[key])).toFixed(1); });
    var grid = '';
    for (var g = 0; g <= 4; g++) {
      var gv = (max / 4) * g, gy = y(gv);
      grid += '<line class="grid-line" x1="' + L + '" x2="' + (W - R) + '" y1="' + gy + '" y2="' + gy + '"/>' +
        '<text x="' + (L - 6) + '" y="' + (gy + 4) + '" text-anchor="end">' + YB.num(gv, 1) + '</text>';
    }
    var step = Math.ceil(data.length / 6), labels = '';
    data.forEach(function (d, i) {
      if (i % step && i !== data.length - 1) return;
      labels += '<text x="' + x(i) + '" y="' + (H - 10) + '" text-anchor="middle">' + YB.esc(fmtDate(d.date)) + '</text>';
    });
    var dots = data.map(function (d, i) {
      return '<circle cx="' + x(i) + '" cy="' + y(n(d[key])) + '" r="4" fill="#7dd3fc"><title>' + YB.esc(d.title) + ' — ' + YB.num(d[key], 1) + '</title></circle>';
    }).join('');
    $('trendChart').innerHTML =
      '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Trend chart">' +
      '<defs><linearGradient id="ybArea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1e7bff" stop-opacity=".45"/><stop offset="1" stop-color="#1e7bff" stop-opacity="0"/></linearGradient></defs>' +
      grid +
      '<polygon fill="url(#ybArea)" points="' + x(0) + ',' + y(0) + ' ' + pts.join(' ') + ' ' + x(data.length - 1) + ',' + y(0) + '"/>' +
      '<polyline fill="none" stroke="#4b9bff" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"/>' +
      dots + labels + '</svg>';
  }

  function renderTop() {
    var data = state.videos.slice().sort(function (a, b) { return n(b.views) - n(a.views); }).slice(0, 5);
    if (!data.length) { $('topChart').innerHTML = empty(); return; }
    var W = 600, row = 52, H = data.length * row, max = n(data[0].views) || 1;
    var bars = data.map(function (d, i) {
      var w = Math.max(4, (n(d.views) / max) * (W - 90)), yy = i * row;
      return '<text x="0" y="' + (yy + 14) + '" style="fill:#e8f1ff;font-size:13px">' + YB.esc(trunc(d.title, 60)) + '</text>' +
        '<rect x="0" y="' + (yy + 22) + '" width="' + w + '" height="18" rx="9" fill="' + (d.type === 'short' ? '#38bdf8' : '#1e7bff') + '"/>' +
        '<text x="' + (w + 8) + '" y="' + (yy + 36) + '">' + YB.num(d.views) + '</text>';
    }).join('');
    $('topChart').innerHTML = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Top videos by views">' + bars + '</svg>' +
      '<div class="row small muted" style="margin-top:8px"><span class="dot" style="--c:#1e7bff"></span>Long-form <span class="dot" style="--c:#38bdf8;margin-left:10px"></span>Short</div>';
  }

  function renderFormat() {
    var longs = state.videos.filter(function (v) { return v.type !== 'short'; });
    var shorts = state.videos.filter(function (v) { return v.type === 'short'; });
    if (!state.videos.length) { $('formatChart').innerHTML = empty(); return; }
    var metrics = [
      ['Videos', longs.length, shorts.length, 0],
      ['Avg views', avg(longs, 'views'), avg(shorts, 'views'), 0],
      ['Avg subs gained', avg(longs, 'subs'), avg(shorts, 'subs'), 1],
      ['Engagement %', longs.length ? longs.reduce(function (s, v) { return s + eng(v); }, 0) / longs.length : 0,
        shorts.length ? shorts.reduce(function (s, v) { return s + eng(v); }, 0) / shorts.length : 0, 2]
    ];
    $('formatChart').innerHTML = metrics.map(function (m) {
      var max = Math.max(m[1], m[2]) || 1;
      return '<div style="margin-bottom:14px"><div class="small"><b>' + m[0] + '</b></div>' +
        bar('Long-form', m[1], max, m[3], '#1e7bff') + bar('Shorts', m[2], max, m[3], '#38bdf8') + '</div>';
    }).join('');
    function bar(label, val, max, d, color) {
      return '<div class="row small" style="gap:8px;margin-top:4px;flex-wrap:nowrap"><span class="muted" style="width:72px;flex:none">' + label + '</span>' +
        '<div class="progress" style="flex:1"><i style="width:' + ((val / max) * 100).toFixed(1) + '%;background:' + color + '"></i></div>' +
        '<span style="width:64px;text-align:right;flex:none">' + YB.num(val, d) + '</span></div>';
    }
  }

  function byDay() {
    var buckets = DAYS.map(function () { return { total: 0, count: 0 }; });
    state.videos.forEach(function (v) {
      var d = new Date(v.date + 'T00:00:00'); if (isNaN(d)) return;
      buckets[d.getDay()].total += n(v.views); buckets[d.getDay()].count++;
    });
    return buckets.map(function (b, i) { return { day: DAYS[i], avg: b.count ? b.total / b.count : 0, count: b.count }; });
  }

  function renderDays() {
    if (!state.videos.length) { $('dayChart').innerHTML = empty(); return; }
    var data = byDay(), W = 600, H = 230, B = 40, max = niceMax(Math.max.apply(null, data.map(function (d) { return d.avg; })));
    var bw = (W - 20) / 7;
    var best = data.reduce(function (a, b) { return b.avg > a.avg ? b : a; });
    var bars = data.map(function (d, i) {
      var h = (d.avg / max) * (H - B - 20), xx = 10 + i * bw + bw * 0.18, yy = H - B - h;
      return '<rect x="' + xx + '" y="' + yy + '" width="' + (bw * 0.64) + '" height="' + Math.max(h, 2) + '" rx="8" fill="' + (d === best && d.avg ? '#38bdf8' : '#1e7bff') + '" opacity="' + (d.count ? 1 : 0.3) + '"><title>' + d.day + ': ' + YB.num(d.avg) + ' avg views (' + d.count + ' videos)</title></rect>' +
        '<text x="' + (xx + bw * 0.32) + '" y="' + (yy - 6) + '" text-anchor="middle">' + (d.count ? YB.num(d.avg) : '') + '</text>' +
        '<text x="' + (xx + bw * 0.32) + '" y="' + (H - B + 18) + '" text-anchor="middle" style="fill:#e8f1ff">' + d.day + '</text>' +
        '<text x="' + (xx + bw * 0.32) + '" y="' + (H - B + 34) + '" text-anchor="middle">' + d.count + '×</text>';
    }).join('');
    $('dayChart').innerHTML = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Average views by weekday">' + bars + '</svg>';
  }

  /* ---------- Insights ---------- */
  function renderInsights() {
    var v = state.videos, out = [];
    if (!v.length) { $('insights').innerHTML = '<li>Add a few videos and insights will appear here.</li>'; return; }
    var best = v.reduce(function (a, b) { return n(b.views) > n(a.views) ? b : a; });
    out.push('Top video: <b>' + YB.esc(best.title) + '</b> with ' + YB.num(best.views) + ' views.');
    var days = byDay().filter(function (d) { return d.count; }).sort(function (a, b) { return b.avg - a.avg; });
    if (days.length > 1) out.push('Your videos posted on <b>' + days[0].day + '</b> average the most views (' + YB.num(days[0].avg) + ').');
    var avgViews = sum(v, 'views') / v.length;
    var above = v.filter(function (x) { return n(x.views) > avgViews; }).length;
    out.push(above + ' of ' + v.length + ' videos beat your average of ' + YB.num(avgViews) + ' views.');
    var ctrs = v.filter(function (x) { return x.ctr !== '' && x.ctr != null; });
    if (ctrs.length) {
      var bestCtr = ctrs.reduce(function (a, b) { return n(b.ctr) > n(a.ctr) ? b : a; });
      out.push('Best thumbnail/title (highest CTR): <b>' + YB.esc(bestCtr.title) + '</b> at ' + n(bestCtr.ctr).toFixed(1) + '%. Reuse its style.');
    }
    var longs = v.filter(function (x) { return x.type !== 'short'; }), shorts = v.filter(function (x) { return x.type === 'short'; });
    if (longs.length && shorts.length) {
      var sl = avg(shorts, 'subs'), ll = avg(longs, 'subs');
      out.push('Each Short brings ~' + YB.num(sl, 1) + ' subscribers vs ~' + YB.num(ll, 1) + ' per long video.');
    }
    var dates = v.map(function (x) { return new Date(x.date + 'T00:00:00').getTime(); }).filter(function (t) { return !isNaN(t); }).sort();
    if (dates.length > 1) {
      var gap = (dates[dates.length - 1] - dates[0]) / 86400000 / (dates.length - 1);
      out.push('You upload about every <b>' + gap.toFixed(1) + ' days</b>.');
    }
    var engBest = v.reduce(function (a, b) { return eng(b) > eng(a) ? b : a; });
    if (eng(engBest)) out.push('Most engaging: <b>' + YB.esc(engBest.title) + '</b> (' + eng(engBest).toFixed(2) + '% likes + comments per view).');
    $('insights').innerHTML = out.map(function (s) { return '<li>' + s + '</li>'; }).join('');
  }

  /* ---------- Table ---------- */
  var COLS = [
    ['title', 'Title'], ['date', 'Date'], ['type', 'Format'], ['views', 'Views', 1], ['impressions', 'Impr.', 1],
    ['ctr', 'CTR', 1], ['watchHours', 'Hours', 1], ['avd', 'AVD', 1], ['likes', 'Likes', 1], ['comments', 'Comm.', 1],
    ['subs', 'Subs', 1], ['eng', 'Eng.', 1], ['', '']
  ];

  function renderTable() {
    $('thead').innerHTML = COLS.map(function (c) {
      if (!c[0]) return '<th aria-label="Actions"></th>';
      var cls = (c[2] ? 'num ' : '') + (ui.sort === c[0] ? 'sorted' + (ui.asc ? ' asc' : '') : '');
      return '<th class="' + cls + '" data-sort="' + c[0] + '">' + c[1] + '</th>';
    }).join('');

    var q = ui.query.toLowerCase();
    var rows = state.videos.filter(function (v) { return !q || String(v.title).toLowerCase().indexOf(q) !== -1; });
    rows.sort(function (a, b) {
      var k = ui.sort, av = k === 'eng' ? eng(a) : a[k], bv = k === 'eng' ? eng(b) : b[k];
      var numeric = ['title', 'date', 'type'].indexOf(k) === -1;
      if (numeric) { av = n(av); bv = n(bv); } else { av = String(av).toLowerCase(); bv = String(bv).toLowerCase(); }
      return (av < bv ? -1 : av > bv ? 1 : 0) * (ui.asc ? 1 : -1);
    });

    if (!rows.length) {
      $('tbody').innerHTML = '<tr><td colspan="' + COLS.length + '" class="muted" style="text-align:center;padding:28px">' +
        (state.videos.length ? 'No titles match your search.' : 'No videos yet — add one above, import a CSV, or load sample data.') + '</td></tr>';
      return;
    }
    $('tbody').innerHTML = rows.map(function (v) {
      return '<tr>' +
        '<td class="wrap">' + YB.esc(v.title) + '</td>' +
        '<td>' + YB.esc(fmtDate(v.date)) + '</td>' +
        '<td><span class="badge' + (v.type === 'short' ? ' short' : '') + '">' + (v.type === 'short' ? 'Short' : 'Long') + '</span></td>' +
        '<td class="num">' + YB.num(v.views) + '</td>' +
        '<td class="num">' + YB.num(v.impressions) + '</td>' +
        '<td class="num">' + (v.ctr !== '' && v.ctr != null ? n(v.ctr).toFixed(1) + '%' : '—') + '</td>' +
        '<td class="num">' + YB.num(v.watchHours, 1) + '</td>' +
        '<td class="num">' + fmtDur(v.avd) + '</td>' +
        '<td class="num">' + YB.num(v.likes) + '</td>' +
        '<td class="num">' + YB.num(v.comments) + '</td>' +
        '<td class="num">' + YB.num(v.subs) + '</td>' +
        '<td class="num">' + eng(v).toFixed(2) + '%</td>' +
        '<td><div class="row" style="flex-wrap:nowrap;gap:4px">' +
        '<button class="btn btn-ghost btn-sm btn-icon" type="button" data-edit="' + v.id + '" aria-label="Edit">✏️</button>' +
        '<button class="btn btn-danger btn-sm btn-icon" type="button" data-del="' + v.id + '" aria-label="Delete">🗑️</button>' +
        '</div></td></tr>';
    }).join('');
  }

  function renderAll() { renderKpis(); renderGoals(); renderTrend(); renderTop(); renderFormat(); renderDays(); renderInsights(); renderTable(); }

  /* ---------- Form ---------- */
  var FIELDS = ['title', 'date', 'type', 'views', 'impressions', 'ctr', 'watchHours', 'avd', 'likes', 'comments', 'subs'];

  function readForm() {
    var f = $('videoForm'), v = {};
    FIELDS.forEach(function (k) { v[k] = f.elements[k].value; });
    ['views', 'impressions', 'watchHours', 'avd', 'likes', 'comments', 'subs', 'ctr'].forEach(function (k) { v[k] = v[k] === '' ? '' : Number(v[k]); });
    if (v.ctr === '' && n(v.impressions) && n(v.views)) v.ctr = Math.round((n(v.views) / n(v.impressions)) * 1000) / 10;
    return v;
  }

  function resetForm() {
    $('videoForm').reset();
    $('videoForm').elements.date.value = new Date().toISOString().slice(0, 10);
    ui.editing = null;
    $('saveVideo').textContent = '＋ Add video';
    $('formTitle').textContent = 'Add a video';
    $('cancelEdit').hidden = true;
  }

  function startEdit(id) {
    var v = state.videos.find(function (x) { return x.id === id; }); if (!v) return;
    var f = $('videoForm');
    FIELDS.forEach(function (k) { f.elements[k].value = v[k] == null ? '' : v[k]; });
    ui.editing = id;
    $('saveVideo').textContent = '💾 Save changes';
    $('formTitle').textContent = 'Edit video';
    $('cancelEdit').hidden = false;
    $('formCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    var rows = [], row = [], cell = '', q = false;
    text = text.replace(/^﻿/, '');
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) {
        if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
        else if (c === '"') q = false;
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return x.trim(); }); });
  }

  var ALIASES = {
    title: ['video title', 'title'],
    date: ['video publish time', 'publish date', 'published', 'date'],
    type: ['format', 'type'],
    views: ['views'],
    impressions: ['impressions'],
    ctr: ['impressions click-through rate (%)', 'click-through rate', 'ctr'],
    watchHours: ['watch time (hours)', 'watch hours', 'watchhours'],
    avd: ['average view duration', 'avd'],
    likes: ['likes'],
    comments: ['comments added', 'comments'],
    subs: ['subscribers gained', 'subscribers', 'subs']
  };

  function cleanNum(s) { s = String(s || '').replace(/[,%\s]/g, ''); return s === '' ? '' : Number(s) || 0; }
  function toSeconds(s) {
    s = String(s || '').trim(); if (!s) return '';
    if (s.indexOf(':') === -1) return cleanNum(s);
    return s.split(':').reduce(function (t, p) { return t * 60 + (Number(p) || 0); }, 0);
  }
  function toISODate(s) {
    s = String(s || '').trim(); if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    var d = new Date(s); if (isNaN(d)) return new Date().toISOString().slice(0, 10);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function importCSV(text) {
    var rows = parseCSV(text); if (rows.length < 2) throw new Error('empty');
    var head = rows[0].map(function (h) { return h.trim().toLowerCase(); });
    var idx = {};
    Object.keys(ALIASES).forEach(function (k) {
      for (var i = 0; i < ALIASES[k].length; i++) { var p = head.indexOf(ALIASES[k][i]); if (p !== -1) { idx[k] = p; break; } }
    });
    if (idx.title == null) throw new Error('no title');
    var seen = {}; state.videos.forEach(function (v) { seen[v.title + '|' + v.date] = 1; });
    var added = 0;
    rows.slice(1).forEach(function (r) {
      var title = (r[idx.title] || '').trim();
      if (!title || /^total$/i.test(title)) return;
      var typeRaw = idx.type != null ? String(r[idx.type]).toLowerCase() : '';
      var v = {
        id: YB.uid(), title: title,
        date: toISODate(idx.date != null ? r[idx.date] : ''),
        type: (typeRaw.indexOf('short') !== -1 || /#shorts/i.test(title)) ? 'short' : 'long',
        views: cleanNum(r[idx.views]), impressions: cleanNum(r[idx.impressions]), ctr: cleanNum(r[idx.ctr]),
        watchHours: cleanNum(r[idx.watchHours]), avd: toSeconds(r[idx.avd]),
        likes: cleanNum(r[idx.likes]), comments: cleanNum(r[idx.comments]), subs: cleanNum(r[idx.subs])
      };
      if (seen[v.title + '|' + v.date]) return;
      state.videos.push(v); added++;
    });
    return added;
  }

  function exportCSV() {
    var cols = FIELDS;
    var lines = [cols.join(',')].concat(state.videos.map(function (v) {
      return cols.map(function (k) { var s = v[k] == null ? '' : String(v[k]); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',');
    }));
    YB.download('youtube-blue-analytics-' + new Date().toISOString().slice(0, 10) + '.csv', lines.join('\n'), 'text/csv');
  }

  function sampleData() {
    var titles = [
      ['Baby Animals Meeting Each Other for the First Time', 'long'], ['Funniest Pet Fails of the Week', 'short'],
      ['How Do Penguins Stay Warm?', 'long'], ['Cat vs Cucumber #shorts', 'short'],
      ['10 Amazing Ocean Animals You Never Heard Of', 'long'], ['Dog Tries Lemon for the First Time', 'short'],
      ['The Story of Noah\'s Ark for Kids', 'long'], ['Goat Screams Compilation', 'short'],
      ['Why Do Elephants Never Forget?', 'long'], ['Parrot Sings Happy Birthday', 'short'],
      ['Jungle Animals Sounds for Kids', 'long'], ['Funniest Toddler Reactions', 'short']
    ];
    var start = Date.now() - 80 * 86400000;
    return titles.map(function (t, i) {
      var short = t[1] === 'short', views = Math.round((short ? 4000 : 1500) * (0.6 + Math.random() * 1.8) * (1 + i * 0.12));
      var impressions = Math.round(views / (0.03 + Math.random() * 0.06));
      return {
        id: YB.uid(), title: t[0], type: t[1],
        date: new Date(start + i * 6.5 * 86400000).toISOString().slice(0, 10),
        views: views, impressions: impressions, ctr: Math.round((views / impressions) * 1000) / 10,
        watchHours: Math.round(views * (short ? 0.006 : 0.07) * 10) / 10,
        avd: short ? Math.round(18 + Math.random() * 25) : Math.round(150 + Math.random() * 200),
        likes: Math.round(views * (0.02 + Math.random() * 0.04)), comments: Math.round(views * (0.002 + Math.random() * 0.006)),
        subs: Math.round(views * (short ? 0.002 : 0.006))
      };
    });
  }

  /* ---------- Events ---------- */
  function bind() {
    $('videoForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = readForm();
      if (!v.title.trim()) return;
      if (ui.editing) {
        var i = state.videos.findIndex(function (x) { return x.id === ui.editing; });
        if (i !== -1) state.videos[i] = Object.assign({ id: ui.editing }, v);
        YB.toast('Video updated');
      } else {
        state.videos.push(Object.assign({ id: YB.uid() }, v));
        YB.toast('Video added');
      }
      save(); resetForm(); renderAll();
    });
    $('cancelEdit').addEventListener('click', resetForm);

    $('tbody').addEventListener('click', function (e) {
      var ed = e.target.closest('[data-edit]'), del = e.target.closest('[data-del]');
      if (ed) startEdit(ed.getAttribute('data-edit'));
      if (del && confirm('Delete this video from your log?')) {
        var id = del.getAttribute('data-del');
        state.videos = state.videos.filter(function (x) { return x.id !== id; });
        save(); renderAll();
      }
    });
    $('thead').addEventListener('click', function (e) {
      var th = e.target.closest('[data-sort]'); if (!th) return;
      var k = th.getAttribute('data-sort');
      if (ui.sort === k) ui.asc = !ui.asc; else { ui.sort = k; ui.asc = k === 'title'; }
      renderTable();
    });
    $('search').addEventListener('input', YB.debounce(function (e) { ui.query = e.target.value; renderTable(); }, 150));

    $('trendMetric').addEventListener('click', function (e) {
      var b = e.target.closest('[data-m]'); if (!b) return;
      ui.metric = b.getAttribute('data-m');
      this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
      renderTrend();
    });

    $('goalEdit').addEventListener('click', function () { $('goalForm').hidden = !$('goalForm').hidden; });
    [['gBase', 'baseSubs'], ['gSubs', 'goalSubs'], ['gHours', 'goalHours'], ['gShorts', 'goalShorts']].forEach(function (p) {
      $(p[0]).addEventListener('change', function () { state[p[1]] = n($(p[0]).value); save(); renderKpis(); renderGoals(); });
    });

    $('csvImport').addEventListener('change', function (e) {
      var f = e.target.files[0]; e.target.value = ''; if (!f) return;
      YB.readFile(f).then(function (text) {
        var added = importCSV(text); save(); renderAll();
        YB.toast(added ? 'Imported ' + added + ' videos' : 'No new videos found in that file');
      }).catch(function () { YB.toast('Could not read that CSV — it needs a "Title" or "Video title" column'); });
    });
    $('csvExport').addEventListener('click', function () {
      if (!state.videos.length) { YB.toast('Nothing to export yet'); return; }
      exportCSV();
    });
    $('sampleBtn').addEventListener('click', function () {
      if (state.videos.length && !confirm('Add 12 sample videos to your log? You can clear them later.')) return;
      state.videos = state.videos.concat(sampleData()); save(); renderAll(); YB.toast('Sample data loaded');
    });
    $('clearAll').addEventListener('click', function () {
      if (!state.videos.length) return;
      if (!confirm('Delete ALL videos from your log? Export a CSV first if you want a copy.')) return;
      state.videos = []; save(); renderAll();
    });
  }

  function init() { resetForm(); bind(); renderAll(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
