/* =========================================================
   Youtube Blue — scheduler.js
   Niche Analyzer & Upload Scheduler.
   • Niche benchmarks (built-in database + your own custom niches)
   • 7-day × 4-block calendar with an audience-activity heatmap
   • Click a slot → add a Short or a Long-Form upload
   • Flags days over YouTube's 3-notifications-per-24h cap
   • Live totals + Schedule Optimization Rating
   Everything is saved on this device (localStorage).
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;
  if (!YB) return;

  /* ---------- Data ---------- */
  // Built-in niches. sat = saturation (0–100) and ret = target average view
  // duration % are planning estimates, not YouTube data.
  var YOUTUBE_NICHE_DATABASE = {
    gaming: { name: "Gaming (Let's Plays, Streams, Guides)", freq: '5-7 shorts per week, 2-3 long-form', best_times: ['3:00 PM - 7:00 PM', '8:00 PM - 11:00 PM'], days: 'Thursday, Friday, Saturday, Sunday', behavior: 'High weekend traffic, heavy late-night viewing, fast swipe-away rates.', sat: 92, ret: 35 },
    tech_reviews: { name: 'Tech, Gadgets & Hardware Reviews', freq: '2-3 shorts per week, 1-2 long-form', best_times: ['11:00 AM - 3:00 PM', '5:00 PM - 7:00 PM'], days: 'Tuesday, Wednesday, Thursday', behavior: 'High search intent, active during lunch breaks and post-work product research windows.', sat: 76, ret: 45 },
    finance_business: { name: 'Finance, Investing, Crypto & Business', freq: '3-4 shorts per week, 1-2 long-form', best_times: ['7:00 AM - 9:00 AM', '4:00 PM - 7:00 PM'], days: 'Monday, Tuesday, Wednesday, Thursday', behavior: 'Strict weekday audience. Peaks during morning commutes and immediately after stock market close.', sat: 72, ret: 45 },
    comedy_entertainment: { name: 'Comedy Skits, Memes & Viral Entertainment', freq: '7+ shorts per week, 1 long-form', best_times: ['12:00 PM - 2:00 PM', '6:00 PM - 10:00 PM'], days: 'Friday, Saturday, Sunday', behavior: 'Heavy weekend bias, relies heavily on rapid Shorts Feed algorithmic distribution.', sat: 88, ret: 40 },
    education_science: { name: 'Education, Science, History & Documentaries', freq: '2-3 shorts per week, 1 long-form', best_times: ['2:00 PM - 5:00 PM', '7:00 PM - 9:00 PM'], days: 'Tuesday, Wednesday, Thursday, Saturday', behavior: 'High shelf-life. Content often picks up traffic weeks after publishing via search and recommendations.', sat: 60, ret: 50 },
    fitness_health: { name: 'Fitness, Workouts, Diet & Bodybuilding', freq: '4-5 shorts per week, 1-2 long-form', best_times: ['6:00 AM - 8:00 AM', '5:00 PM - 7:00 PM'], days: 'Monday, Tuesday, Wednesday, Sunday', behavior: 'Extremely active early mornings and late afternoons as viewers prep for or finish gym sessions.', sat: 74, ret: 40 },
    cooking_food: { name: 'Cooking, Baking, Food Reviews & Recipes', freq: '3-5 shorts per week, 1 long-form', best_times: ['11:00 AM - 1:00 PM', '4:00 PM - 7:00 PM'], days: 'Thursday, Friday, Saturday, Sunday', behavior: 'Strong dinner-time preparation spikes and high casual weekend browsing traffic.', sat: 70, ret: 45 },
    fashion_beauty: { name: 'Fashion, Makeup, Skincare & Style', freq: '4-6 shorts per week, 1-2 long-form', best_times: ['1:00 PM - 4:00 PM', '6:00 PM - 9:00 PM'], days: 'Friday, Saturday, Sunday', behavior: 'Highly visual community driven by weekly trend cycles and casual evening scrolling.', sat: 80, ret: 38 },
    travel_vlogs: { name: 'Travel, Adventure, Culture & Vlogs', freq: '2-3 shorts per week, 1 long-form', best_times: ['10:00 AM - 1:00 PM', '6:00 PM - 9:00 PM'], days: 'Friday, Saturday, Sunday', behavior: 'Strong escapism browsing trends, peaking heavily over the weekend when viewers have free time.', sat: 66, ret: 42 },
    music_art: { name: 'Music, Covers, Instrumentals & Digital Art', freq: '5-7 shorts per week, 1 long-form', best_times: ['2:00 PM - 5:00 PM', '8:00 PM - 12:00 AM'], days: 'Thursday, Friday, Saturday', behavior: 'Late-night listening biases, relies on looping audio trends and high remix engagement.', sat: 82, ret: 35 },
    diy_crafts: { name: 'DIY, Crafts, Woodworking & Home Decor', freq: '3-4 shorts per week, 1 long-form', best_times: ['9:00 AM - 12:00 PM', '3:00 PM - 6:00 PM'], days: 'Saturday, Sunday', behavior: 'Massive weekend project-driven spikes, high long-tail search value across years.', sat: 55, ret: 50 },
    automotive: { name: 'Automotive, Car Reviews & Restoration', freq: '3-4 shorts per week, 1-2 long-form', best_times: ['4:00 PM - 8:00 PM', '9:00 AM - 12:00 PM'], days: 'Friday, Saturday, Sunday', behavior: 'Mainly adult male demographic, highly active weekend mornings and Friday afternoons.', sat: 58, ret: 45 },
    kids_animation: { name: 'Animation, Family Content & Kids Entertainment', freq: '3-5 shorts per week, 2-3 long-form', best_times: ['7:00 AM - 9:00 AM', '3:00 PM - 6:00 PM'], days: 'Saturday, Sunday, Wednesday', behavior: 'Peaks precisely before school drop-off, immediately after school release, and all day on weekends.', sat: 85, ret: 40 },
    news_politics: { name: 'News, Current Events & Commentary', freq: '10+ shorts per week, 5+ long-form', best_times: ['6:00 AM - 9:00 AM', '5:00 PM - 8:00 PM'], days: 'Monday, Tuesday, Wednesday, Thursday, Friday', behavior: 'Extreme real-time reliance. Traffic drops heavily over weekends; requires instant upload speed as news breaks.', sat: 70, ret: 38 },
    pets_animals: { name: 'Pets, Cute Animals & Wildlife', freq: '5-7 shorts per week, 1 long-form', best_times: ['12:00 PM - 3:00 PM', '7:00 PM - 10:00 PM'], days: 'Saturday, Sunday', behavior: 'High universal viral potential, casual scrolling behavior across all demographics.', sat: 75, ret: 40 },
    motivational_spiritual: { name: 'Motivation, Self-Improvement & Spirituality', freq: '5-7 shorts per week, 1-2 long-form', best_times: ['5:00 AM - 7:00 AM', '8:00 PM - 10:00 PM'], days: 'Sunday, Monday, Tuesday', behavior: 'Strong early morning spikes for morning routines, alongside heavy Sunday planning traffic.', sat: 78, ret: 35 },
    sports_athletics: { name: 'Sports Highlights, Athletics & Commentary', freq: '7+ shorts per week, 2-3 long-form', best_times: ['6:00 PM - 11:00 PM', '12:00 PM - 4:00 PM'], days: 'Saturday, Sunday, Monday', behavior: 'Directly tied to live game schedules, weekend events, and Monday morning wrap-up discussions.', sat: 82, ret: 38 }
  };

  var DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  // Time blocks (24 h, local time). Overnight 0–5 isn't a posting block.
  var BLOCKS = [
    { id: 'morning', name: 'Morning', icon: '🌅', from: 5, to: 11, label: '5 AM – 11 AM' },
    { id: 'midday', name: 'Midday', icon: '☀️', from: 11, to: 14, label: '11 AM – 2 PM' },
    { id: 'afternoon', name: 'Afternoon', icon: '🌤️', from: 14, to: 18, label: '2 PM – 6 PM' },
    { id: 'night', name: 'Night Peak', icon: '🌙', from: 18, to: 24, label: '6 PM – 12 AM' }
  ];
  // Typical global viewing curve per block (mock baseline, 0–1) — evenings are busiest.
  var BLOCK_BASE = { morning: 0.35, midday: 0.5, afternoon: 0.6, night: 0.85 };
  var CAP = 3;   // YouTube sends subscriber notifications for at most 3 uploads per channel per 24 h

  /* ---------- State (saved on this device) ---------- */
  var custom = YB.store.get('schedCustomNiches', {});
  if (!custom || typeof custom !== 'object') custom = {};
  var nicheId = YB.store.get('schedNiche', 'gaming');
  var plan = YB.store.get('schedPlan', {});          // { 'd-block': [{ id, type: 'short'|'long' }] }
  if (!plan || typeof plan !== 'object') plan = {};
  var openSlot = null, editingNiche = null;

  function $(id) { return document.getElementById(id); }
  function save() { YB.store.set('schedPlan', plan); YB.store.set('schedNiche', nicheId); YB.store.set('schedCustomNiches', custom); }
  function allNiches() { var o = {}; Object.keys(YOUTUBE_NICHE_DATABASE).forEach(function (k) { o[k] = YOUTUBE_NICHE_DATABASE[k]; }); Object.keys(custom).forEach(function (k) { o[k] = custom[k]; }); return o; }
  function niche() { var n = allNiches(); if (!n[nicheId]) nicheId = 'gaming'; return n[nicheId]; }
  function isCustom(id) { return Object.prototype.hasOwnProperty.call(custom, id); }

  /* ---------- Parsing the niche text into numbers ---------- */
  // "3:00 PM - 7:00 PM" → { from: 15, to: 19 }; "8:00 PM - 12:00 AM" → { from: 20, to: 24 }
  function parseHour(t) {
    var m = /(\d{1,2})(?::(\d{2}))?\s*(AM|PM)/i.exec(t); if (!m) return null;
    var h = Number(m[1]) % 12 + (/pm/i.test(m[3]) ? 12 : 0);
    return h + (Number(m[2] || 0) / 60);
  }
  function parseWindow(s) {
    var parts = String(s).split(/\s*[-–]\s*/), a = parseHour(parts[0] || ''), b = parseHour(parts[1] || '');
    if (a === null || b === null) return null;
    if (b <= a) b += 24;            // runs past midnight (12:00 AM = 24)
    return { from: a, to: b };
  }
  function windows(n) { return (n.best_times || []).map(parseWindow).filter(Boolean); }
  function bestDays(n) {
    var txt = String(n.days || '').toLowerCase();
    return DAYS.map(function (d) { return txt.indexOf(d.toLowerCase()) !== -1; });
  }
  // "5-7 shorts per week, 2-3 long-form" / "7+ shorts" / "10+ shorts per week, 5+ long-form"
  function parseFreq(n) {
    function grab(re) {
      var m = re.exec(String(n.freq || '')); if (!m) return { min: 0, max: 0 };
      var min = Number(m[1]), max = m[2] ? Number(m[2]) : (m[3] ? null : min);
      return { min: min, max: max };
    }
    return { short: grab(/(\d+)\s*(?:-\s*(\d+)|(\+))?\s*shorts?/i), long: grab(/(\d+)\s*(?:-\s*(\d+)|(\+))?\s*long/i) };
  }
  function rangeText(r) { return r.max === null ? r.min + '+' : r.min === r.max ? String(r.min) : r.min + '–' + r.max; }

  // How much of a block falls inside the niche's best windows (0–1).
  function timeFit(n, block) {
    var best = 0;
    windows(n).forEach(function (w) {
      var a = Math.max(w.from, block.from), b = Math.min(w.to, block.to);
      if (b > a) best = Math.max(best, (b - a) / (block.to - block.from));
    });
    return best;
  }
  // Audience activity for one slot (0–1) = typical viewing curve + this niche's best days/times.
  function heat(n, d, block) {
    var dayFit = bestDays(n)[d] ? 1 : 0, tf = timeFit(n, block);
    var h = 0.18 * BLOCK_BASE[block.id] + 0.42 * Math.min(1, tf * 1.4) + 0.4 * dayFit;
    return Math.max(0.05, Math.min(1, h));
  }
  // "Optimal" = one of the niche's best days AND overlapping one of its best time windows.
  function isOptimal(n, d, block) { return bestDays(n)[d] && timeFit(n, block) > 0; }

  /* ---------- Plan helpers ---------- */
  function key(d, b) { return d + '-' + b; }
  function items(d, b) { return plan[key(d, b)] || []; }
  function dayCount(d) { return BLOCKS.reduce(function (t, b) { return t + items(d, b.id).length; }, 0); }
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function addUpload(d, b, type) {
    var k = key(d, b);
    (plan[k] = plan[k] || []).push({ id: uid(), type: type });
    save(); renderAll();
    var c = dayCount(d);
    if (c > CAP) YB.toast('⚠ ' + DAYS[d] + ' now has ' + c + ' uploads — only ' + CAP + ' get notifications');
  }
  function removeUpload(d, b, id) {
    var k = key(d, b);
    plan[k] = items(d, b).filter(function (x) { return x.id !== id; });
    if (!plan[k].length) delete plan[k];
    save(); renderAll();
  }

  /* ---------- Metrics ---------- */
  function metrics() {
    var n = niche(), shorts = 0, longs = 0, optimal = 0, notif = 0, over = [];
    for (var d = 0; d < 7; d++) {
      var c = 0;
      BLOCKS.forEach(function (b) {
        items(d, b.id).forEach(function (x) {
          c++;
          if (x.type === 'short') shorts++; else longs++;
          if (isOptimal(n, d, b)) optimal++;
        });
      });
      notif += Math.min(c, CAP);
      if (c > CAP) over.push({ day: d, count: c });
    }
    var total = shorts + longs;
    return { total: total, shorts: shorts, longs: longs, optimal: optimal, notif: notif, over: over, rating: total ? Math.round((optimal / total) * 100) : null };
  }
  function fitText(have, r) {
    if (r.max === null ? have >= r.min : have >= r.min && have <= r.max) return { t: 'On target', c: 'ok' };
    return have < r.min ? { t: (r.min - have) + ' below', c: 'warn' } : { t: (have - r.max) + ' above', c: 'warn' };
  }

  /* ---------- Render ---------- */
  function renderNicheSelect() {
    var all = allNiches(), sel = $('nicheSelect');
    var builtIn = Object.keys(YOUTUBE_NICHE_DATABASE), mine = Object.keys(custom);
    function opts(ids) { return ids.map(function (id) { return '<option value="' + YB.esc(id) + '">' + YB.esc(all[id].name) + '</option>'; }).join(''); }
    sel.innerHTML = '<optgroup label="All niches">' + opts(builtIn) + '</optgroup>' + (mine.length ? '<optgroup label="My niches">' + opts(mine) + '</optgroup>' : '');
    niche();               // fixes a missing id
    sel.value = nicheId;
  }

  function renderBench() {
    var n = niche(), f = parseFreq(n), bd = bestDays(n), sat = Number(n.sat), ret = Number(n.ret);
    var satLabel = sat >= 85 ? 'Very crowded' : sat >= 70 ? 'Crowded' : sat >= 55 ? 'Moderate' : 'Open';
    $('bench').innerHTML =
      '<h3 class="bench-name">' + YB.esc(n.name) + (isCustom(nicheId) ? ' <button type="button" class="btn btn-ghost btn-xs" id="editNicheBtn">✏️ Edit</button>' : '') + '</h3>' +
      '<div class="bench-grid">' +
        '<div class="bench-stat"><span>Shorts / week</span><b>' + rangeText(f.short) + '</b></div>' +
        '<div class="bench-stat"><span>Long-form / week</span><b>' + rangeText(f.long) + '</b></div>' +
        '<div class="bench-stat"><span>Saturation</span><b>' + (isFinite(sat) ? sat + '<small>/100</small>' : '—') + '</b><em>' + (isFinite(sat) ? satLabel : '') + '</em></div>' +
        '<div class="bench-stat"><span>Retention target</span><b>' + (isFinite(ret) ? ret + '%' : '—') + '</b><em>avg. view duration</em></div>' +
      '</div>' +
      '<div class="bench-row"><span class="bench-label">Best days</span><div class="day-chips">' + DAYS.map(function (d, i) { return '<span class="day-chip' + (bd[i] ? ' on' : '') + '">' + DAY_SHORT[i] + '</span>'; }).join('') + '</div></div>' +
      '<div class="bench-row"><span class="bench-label">Peak windows</span><div class="time-chips">' + (n.best_times || []).map(function (t) { return '<span class="time-chip">🔥 ' + YB.esc(t) + '</span>'; }).join('') + '</div></div>' +
      '<div class="bench-row"><span class="bench-label">Weekday vs weekend</span><div>' + weekSplit(bd) + '</div></div>' +
      '<p class="bench-behavior">' + YB.esc(n.behavior || '') + '</p>';
    var eb = $('editNicheBtn'); if (eb) eb.addEventListener('click', function () { openNicheForm(nicheId); });
  }
  function weekSplit(bd) {
    var wk = bd.slice(0, 5).filter(Boolean).length, we = bd.slice(5).filter(Boolean).length;
    return wk && we ? 'Both — ' + wk + ' weekday' + (wk === 1 ? '' : 's') + ' + ' + we + ' weekend day' + (we === 1 ? '' : 's') : we ? 'Weekend-heavy' : wk ? 'Weekday audience' : '—';
  }

  function renderCal() {
    var n = niche(), html = '<div class="cal-corner"></div>';
    for (var d = 0; d < 7; d++) {
      var c = dayCount(d), over = c > CAP;
      html += '<div class="cal-day' + (bestDays(n)[d] ? ' best' : '') + (over ? ' over' : '') + '" role="columnheader"><span class="cd-long">' + DAY_SHORT[d] + '</span><span class="cd-short">' + DAYS[d][0] + '</span>' +
        (c ? '<span class="cd-count' + (over ? ' over' : '') + '" title="' + c + ' uploads">' + (over ? '⚠ ' : '') + c + '</span>' : '') + '</div>';
    }
    BLOCKS.forEach(function (b) {
      html += '<div class="cal-block" role="rowheader"><span class="cb-ico" aria-hidden="true">' + b.icon + '</span><span class="cb-name">' + b.name + '</span><span class="cb-time">' + b.label + '</span></div>';
      for (var d = 0; d < 7; d++) {
        var h = heat(n, d, b), it = items(d, b.id), opt = isOptimal(n, d, b), over = dayCount(d) > CAP;
        var s = it.filter(function (x) { return x.type === 'short'; }).length, l = it.length - s;
        var label = DAYS[d] + ' ' + b.name + ': ' + Math.round(h * 100) + '% activity' + (opt ? ', best window' : '') + (it.length ? ', ' + s + ' short' + (s === 1 ? '' : 's') + ', ' + l + ' long-form' : ', empty');
        html += '<button type="button" class="cal-slot' + (opt ? ' opt' : '') + (over && it.length ? ' over' : '') + (openSlot && openSlot.d === d && openSlot.b === b.id ? ' open' : '') + '" style="--h:' + h.toFixed(2) + '" data-d="' + d + '" data-b="' + b.id + '" role="gridcell" aria-label="' + YB.esc(label) + '">' +
          (opt ? '<span class="slot-star" aria-hidden="true">★</span>' : '') +
          '<span class="slot-pills">' + (s ? '<span class="pill pill-short">' + (s > 1 ? s : '') + 'S</span>' : '') + (l ? '<span class="pill pill-long">' + (l > 1 ? l : '') + 'L</span>' : '') + '</span>' +
          '</button>';
      }
    });
    $('cal').innerHTML = html;

    var m = metrics(), w = $('capWarn');
    if (m.over.length) {
      w.hidden = false;
      w.innerHTML = '<b>⚠ Over the 3-notification cap</b>' + m.over.map(function (o) { return DAYS[o.day] + ': ' + o.count + ' uploads'; }).join(' · ') +
        '. YouTube only notifies subscribers about 3 uploads per channel in 24 hours. Move the extras to another day.';
    } else w.hidden = true;
  }

  function renderKpis() {
    var n = niche(), f = parseFreq(n), m = metrics();
    var sFit = fitText(m.shorts, f.short), lFit = fitText(m.longs, f.long);
    var rating = m.rating === null ? '—' : m.rating + '%';
    var rClass = m.rating === null ? '' : m.rating >= 75 ? 'ok' : m.rating >= 45 ? 'warn' : 'bad';
    $('kpis').innerHTML =
      kpi('Weekly uploads', m.total, m.shorts + ' Short' + (m.shorts === 1 ? '' : 's') + ' · ' + m.longs + ' long-form') +
      kpi('Notifications sent', m.notif, m.over.length ? '<span class="t-warn">' + (m.total - m.notif) + ' upload' + (m.total - m.notif === 1 ? '' : 's') + ' over the cap</span>' : 'per subscriber this week') +
      kpi('Optimization rating', '<span class="rating ' + rClass + '">' + rating + '</span>', m.total ? m.optimal + ' of ' + m.total + ' in best windows' : 'Add uploads to see your score', m.rating) +
      kpi('Vs. niche target', '<span class="t-' + (sFit.c === 'ok' && lFit.c === 'ok' ? 'ok' : 'warn') + '">' + (sFit.c === 'ok' && lFit.c === 'ok' ? 'On target' : 'Adjust') + '</span>',
        'Shorts: <b class="t-' + sFit.c + '">' + sFit.t + '</b> · Long: <b class="t-' + lFit.c + '">' + lFit.t + '</b>');
  }
  function kpi(label, value, note, pct) {
    return '<div class="card kpi"><div class="kpi-label">' + label + '</div><div class="kpi-value">' + value + '</div>' +
      (pct !== undefined && pct !== null ? '<div class="meter" aria-hidden="true"><i style="width:' + pct + '%"></i></div>' : '') +
      '<div class="kpi-note">' + note + '</div></div>';
  }

  function renderSlotMenu() {
    var menu = $('slotMenu');
    if (!openSlot) { menu.hidden = true; return; }
    var n = niche(), b = BLOCKS.find(function (x) { return x.id === openSlot.b; }), d = openSlot.d, it = items(d, b.id);
    var h = heat(n, d, b), opt = isOptimal(n, d, b), c = dayCount(d);
    $('slotTitle').textContent = DAYS[d] + ' · ' + b.name + ' (' + b.label + ')';
    $('slotHeat').innerHTML = '<span class="heat-chip" style="--h:' + h.toFixed(2) + '"></span>' + Math.round(h * 100) + '% audience activity' +
      (opt ? ' · <b class="t-ok">★ Best window</b>' : bestDays(n)[d] ? ' · good day, off-peak hours' : timeFit(n, b) ? ' · peak hours, slower day' : ' · quiet slot') +
      (c >= CAP ? '<div class="t-warn" style="margin-top:4px">' + DAYS[d] + ' has ' + c + ' upload' + (c === 1 ? '' : 's') + '. More than ' + CAP + ' won\'t notify subscribers.</div>' : '');
    $('slotItems').innerHTML = it.length ? it.map(function (x, i) {
      return '<li><span class="dot ' + (x.type === 'short' ? 'dot-short' : 'dot-long') + '"></span>' + (x.type === 'short' ? 'YouTube Short' : 'Long-Form Video') +
        '<button type="button" class="slot-rm" data-rm="' + x.id + '" aria-label="Remove ' + (x.type === 'short' ? 'Short' : 'long-form video') + ' ' + (i + 1) + '">Remove</button></li>';
    }).join('') : '<li class="muted small">Nothing scheduled here yet.</li>';
    menu.hidden = false;
    placeMenu();
  }
  function placeMenu() {
    var menu = $('slotMenu'), cell = document.querySelector('.cal-slot[data-d="' + openSlot.d + '"][data-b="' + openSlot.b + '"]');
    if (!cell) return;
    if (window.innerWidth < 640) { menu.classList.add('sheet'); menu.style.left = ''; menu.style.top = ''; return; }
    menu.classList.remove('sheet');
    var r = cell.getBoundingClientRect(), mw = menu.offsetWidth, mh = menu.offsetHeight;
    var left = Math.min(window.innerWidth - mw - 12, Math.max(12, r.left + r.width / 2 - mw / 2));
    var top = r.bottom + 8 + mh > window.innerHeight - 8 ? r.top - mh - 8 : r.bottom + 8;
    menu.style.left = left + 'px'; menu.style.top = Math.max(8, top) + 'px';
  }

  function renderAll() { renderKpis(); renderBench(); renderCal(); renderSlotMenu(); }

  /* ---------- Auto-plan ---------- */
  // Fills the niche's minimum weekly volume into the busiest slots, never more than 3 a day.
  function autoPlan() {
    var n = niche(), f = parseFreq(n);
    if (Object.keys(plan).length && !confirm('Replace this week\'s plan with an auto-plan for ' + n.name + '?')) return;
    plan = {};
    var slots = [];
    for (var d = 0; d < 7; d++) BLOCKS.forEach(function (b) { slots.push({ d: d, b: b.id, h: heat(n, d, b), opt: isOptimal(n, d, b) }); });
    slots.sort(function (a, b) { return (b.opt - a.opt) || (b.h - a.h); });
    var want = [];
    for (var i = 0; i < f.long.min; i++) want.push('long');
    for (i = 0; i < f.short.min; i++) want.push('short');
    var perDay = [0, 0, 0, 0, 0, 0, 0], placed = 0, round = 0;
    while (want.length && round < 4) {
      slots.forEach(function (s) {
        if (!want.length || perDay[s.d] >= CAP || items(s.d, s.b).length > round) return;
        var t = want.shift(); (plan[key(s.d, s.b)] = plan[key(s.d, s.b)] || []).push({ id: uid(), type: t });
        perDay[s.d]++; placed++;
      });
      round++;
    }
    save(); renderAll();
    YB.toast(want.length ? 'Placed ' + placed + ' uploads — the rest would break the 3-a-day cap' : 'Planned ' + placed + ' uploads in the best windows');
  }

  /* ---------- Add / edit niche ---------- */
  function hourOptions(sel) {
    var out = '';
    for (var h = 0; h <= 24; h++) {
      var lab = h === 0 || h === 24 ? '12:00 AM' : h === 12 ? '12:00 PM' : (h % 12) + ':00 ' + (h < 12 ? 'AM' : 'PM');
      out += '<option value="' + h + '"' + (h === sel ? ' selected' : '') + '>' + lab + (h === 24 ? ' (midnight)' : '') + '</option>';
    }
    return out;
  }
  function hourLabel(h) { h = Number(h); return h === 0 || h === 24 ? '12:00 AM' : h === 12 ? '12:00 PM' : (h % 12) + ':00 ' + (h < 12 ? 'AM' : 'PM'); }
  function openNicheForm(id) {
    var f = $('nicheForm'), n = id ? allNiches()[id] : null, fr = n ? parseFreq(n) : null, w = n ? windows(n) : [];
    editingNiche = id || null;
    $('nicheFormTitle').textContent = id ? 'Edit niche' : 'Add a niche';
    $('nicheSave').textContent = id ? 'Save changes' : 'Add niche';
    $('nicheDelete').hidden = !id;
    f.name.value = n ? n.name : '';
    f.sMin.value = fr ? fr.short.min : 3; f.sMax.value = fr ? (fr.short.max === null ? fr.short.min : fr.short.max) : 5;
    f.lMin.value = fr ? fr.long.min : 1; f.lMax.value = fr ? (fr.long.max === null ? fr.long.min : fr.long.max) : 2;
    f.w1s.innerHTML = hourOptions(w[0] ? Math.floor(w[0].from) : 12); f.w1e.innerHTML = hourOptions(w[0] ? Math.min(24, Math.round(w[0].to)) : 15);
    f.w2s.innerHTML = hourOptions(w[1] ? Math.floor(w[1].from) : 18); f.w2e.innerHTML = hourOptions(w[1] ? Math.min(24, Math.round(w[1].to)) : 21);
    var bd = n ? bestDays(n) : [false, false, false, false, true, true, true];
    $('dayPick').innerHTML = DAYS.map(function (d, i) { return '<label class="day-check"><input type="checkbox" value="' + d + '"' + (bd[i] ? ' checked' : '') + '><span>' + DAY_SHORT[i] + '</span></label>'; }).join('');
    f.behavior.value = n ? (n.behavior || '') : '';
    f.sat.value = n && isFinite(n.sat) ? n.sat : 60; f.ret.value = n && isFinite(n.ret) ? n.ret : 40;
    $('nicheModal').hidden = false;
    f.name.focus();
  }
  function closeNicheForm() { $('nicheModal').hidden = true; editingNiche = null; }
  function saveNicheForm(e) {
    e.preventDefault();
    var f = $('nicheForm'), name = f.name.value.trim();
    if (!name) { f.name.focus(); return; }
    function num(v, lo, hi) { v = Math.round(Number(v)); return isFinite(v) ? Math.max(lo, Math.min(hi, v)) : lo; }
    var sMin = num(f.sMin.value, 0, 50), sMax = Math.max(sMin, num(f.sMax.value, 0, 50)), lMin = num(f.lMin.value, 0, 20), lMax = Math.max(lMin, num(f.lMax.value, 0, 20));
    var days = Array.prototype.slice.call($('dayPick').querySelectorAll('input:checked')).map(function (x) { return x.value; });
    if (!days.length) { YB.toast('Pick at least one best day'); return; }
    var wins = [[f.w1s.value, f.w1e.value], [f.w2s.value, f.w2e.value]].filter(function (p) { return Number(p[1]) > Number(p[0]); })
      .map(function (p) { return hourLabel(p[0]) + ' - ' + hourLabel(p[1]); });
    if (!wins.length) { YB.toast('Each best window must end after it starts'); return; }
    var data = {
      name: name.slice(0, 60),
      freq: (sMin === sMax ? sMin : sMin + '-' + sMax) + ' shorts per week, ' + (lMin === lMax ? lMin : lMin + '-' + lMax) + ' long-form',
      best_times: wins, days: days.join(', '), behavior: f.behavior.value.trim().slice(0, 200),
      sat: num(f.sat.value, 0, 100), ret: num(f.ret.value, 5, 95), custom: true
    };
    var id = editingNiche || ('my_' + uid());
    custom[id] = data; nicheId = id;
    save(); closeNicheForm(); renderNicheSelect(); renderAll();
    YB.toast(editingNiche ? 'Niche updated' : 'Niche added');
  }
  function deleteNiche() {
    if (!editingNiche || !isCustom(editingNiche)) return;
    if (!confirm('Delete the niche "' + custom[editingNiche].name + '"? Your schedule stays.')) return;
    delete custom[editingNiche]; nicheId = 'gaming';
    save(); closeNicheForm(); renderNicheSelect(); renderAll();
  }

  /* ---------- Events ---------- */
  function bind() {
    $('nicheSelect').addEventListener('change', function () { nicheId = this.value; save(); renderAll(); });
    $('cal').addEventListener('click', function (e) {
      var s = e.target.closest('.cal-slot'); if (!s) return;
      var d = Number(s.getAttribute('data-d')), b = s.getAttribute('data-b');
      openSlot = openSlot && openSlot.d === d && openSlot.b === b ? null : { d: d, b: b };
      renderCal(); renderSlotMenu();
    });
    $('slotMenu').addEventListener('click', function (e) {
      if (!openSlot) return;
      var a = e.target.closest('[data-add]'); if (a) { addUpload(openSlot.d, openSlot.b, a.getAttribute('data-add')); return; }
      var r = e.target.closest('[data-rm]'); if (r) { removeUpload(openSlot.d, openSlot.b, r.getAttribute('data-rm')); return; }
    });
    $('slotClose').addEventListener('click', function () { openSlot = null; renderCal(); renderSlotMenu(); });
    document.addEventListener('click', function (e) {
      if (openSlot && !e.target.closest('#slotMenu') && !e.target.closest('.cal-slot')) { openSlot = null; renderCal(); renderSlotMenu(); }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('nicheModal').hidden) closeNicheForm();
      else if (openSlot) { openSlot = null; renderCal(); renderSlotMenu(); }
    });
    window.addEventListener('resize', function () { if (openSlot) placeMenu(); });
    window.addEventListener('scroll', function () { if (openSlot && !$('slotMenu').classList.contains('sheet')) placeMenu(); }, { passive: true });
    $('autoPlanBtn').addEventListener('click', autoPlan);
    $('clearWeekBtn').addEventListener('click', function () {
      if (!Object.keys(plan).length) return;
      if (!confirm('Clear every upload from this week?')) return;
      plan = {}; openSlot = null; save(); renderAll();
    });
    $('addNicheBtn').addEventListener('click', function () { openNicheForm(null); });
    $('nicheForm').addEventListener('submit', saveNicheForm);
    $('nicheCancel').addEventListener('click', closeNicheForm);
    $('nicheDelete').addEventListener('click', deleteNiche);
    $('nicheModal').addEventListener('click', function (e) { if (e.target === this) closeNicheForm(); });
  }

  function init() {
    renderNicheSelect();
    bind();
    renderAll();
  }
  // Exposed for the page's own checks.
  window.YBScheduler = { niches: allNiches, metrics: metrics, heat: function (d, b) { return heat(niche(), d, BLOCKS.find(function (x) { return x.id === b; })); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
