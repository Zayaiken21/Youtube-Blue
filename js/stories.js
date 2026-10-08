/* =========================================================
   Youtube Blue — stories.js
   Controls the Story Studio page only: stories, templates,
   characters (+ button), one-voice / multi-voice narration,
   script blocks, exports and the teleprompter.
   Saved under storage keys "stories" and "currentStory".
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;

  var COLORS = ['#1e7bff', '#38bdf8', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#fb923c', '#f87171', '#22d3ee', '#c084fc'];
  var NARRATOR = { id: 'narrator', name: 'Narrator', role: 'Tells the story', voice: 'Calm storyteller', notes: '', color: '#7dd3fc' };

  /* ---------- Templates ----------
     Blocks: S = scene heading, L = line (speaker), N = direction/SFX.
     Speaker "@0", "@1"… refers to the template's suggested cast. */
  function S(t) { return { type: 'scene', text: t }; }
  function L(t, who) { return { type: 'line', speaker: who || 'narrator', text: t }; }
  function N(t) { return { type: 'note', text: t }; }

  var TEMPLATES = {
    blank: { name: 'Blank page', desc: 'Start from nothing.', blocks: [L('')] },
    classic: {
      name: 'Classic story (3 acts)', desc: 'Hook → setup → problem → climax → happy ending. Works for any length.',
      blocks: [
        S('Hook (first 10 seconds)'), L('[Open with the most exciting moment or a big question.]'),
        S('Act 1 — Setup'), L('[Introduce the main character, where they live and what they want.]'),
        N('[Music: gentle intro]'),
        S('Act 2 — The problem'), L('[Something goes wrong. Raise the stakes.]'), L('[The character tries and fails once.]'),
        S('Act 3 — Climax & resolution'), L('[The big moment. How do they solve it?]'), L('[Show how the character has changed.]'),
        S('Ending'), L('[Lesson or moral in one sentence.]'), L('[Call to action: like, subscribe, what to watch next.]')
      ]
    },
    short: {
      name: 'YouTube Short (under 60s)', desc: 'Tight vertical format: hook in 3 seconds, one idea, a loop-back ending.',
      blocks: [
        S('Hook (0–3s)'), L('[One line that stops the scroll.]'), N('[On-screen text: 3–5 words]'),
        S('Build (3–40s)'), L('[Deliver the one idea fast. Cut every extra word.]'),
        S('Payoff (40–55s)'), L('[The surprise, punchline or answer.]'),
        S('Loop (55–60s)'), L('[Last line that leads back into the first line.]')
      ]
    },
    bible: {
      name: 'Kids Bible story', desc: 'Welcome, the story, what it teaches, a memory verse and a goodbye prayer.',
      blocks: [
        S('Welcome'), L('Hi friends! Welcome back! Today we have a very special story.'),
        S('Story time'), L('[Set the scene: where and when the story happens.]'), L('[Tell the story in simple words, one event at a time.]'), N('[Illustration / animation cue]'),
        S('What we learn'), L('[One clear lesson kids can remember.]'), L('[Ask the viewer a question to think about.]'),
        S('Memory verse'), L('[Verse text — reference]'), N('[Show verse on screen, read it twice]'),
        S('Prayer & goodbye'), L('[Short, simple prayer.]'), L('See you next time, friends!')
      ]
    },
    animal: {
      name: 'Animal facts narration', desc: 'Real wildlife clips with a friendly narrator and 3 big facts.',
      blocks: [
        S('Intro'), L('Do you know which animal [fun teaser]? Let\'s find out!'), N('[Clip: animal close-up]'),
        S('Fact 1'), L('[Fact + why it matters, in kid-friendly words.]'), N('[Clip]'),
        S('Fact 2'), L('[Fact]'), N('[Clip]'),
        S('Fact 3 — the wow fact'), L('[Save the most surprising fact for last.]'), N('[Clip + sound effect]'),
        S('Quick recap'), L('So today we learned that [1], [2] and [3]!'),
        S('Outro'), L('Which animal should we meet next? Tell us in the comments!')
      ]
    },
    funny: {
      name: 'Funny clips compilation', desc: 'Cold open, numbered clips with quick commentary, countdown finale.',
      blocks: [
        S('Cold open'), N('[Funniest 3 seconds of the whole video]'), L('[Quick reaction line]'),
        S('Intro'), L('Welcome back! Here are the funniest [topic] clips of the week!'),
        S('Clip 1'), N('[Clip description]'), L('[Short, funny commentary — 1 line]'),
        S('Clip 2'), N('[Clip description]'), L('[Commentary]'),
        S('Clip 3'), N('[Clip description]'), L('[Commentary]'),
        S('Number 1'), L('And the funniest clip of the week is…'), N('[Clip + replay in slow motion]'),
        S('Outro'), L('Which one made you laugh the most? Comment the number!')
      ]
    },
    dialogue: {
      name: 'Character skit / dialogue', desc: 'Two or more characters talking. Adds a starter cast you can rename.',
      cast: [{ name: 'Hero', role: 'Main character', voice: 'High & excited' }, { name: 'Buddy', role: 'Best friend', voice: 'Silly / cartoon' }],
      blocks: [
        S('Scene 1 — The setup'), N('[Where are they? What is happening?]'),
        L('[Hero says what they want.]', '@0'), L('[Buddy reacts.]', '@1'), L('[Hero has a plan.]', '@0'),
        S('Scene 2 — Uh oh'), N('[Something goes wrong — sound effect]'),
        L('[Buddy panics.]', '@1'), L('[Hero thinks of something.]', '@0'),
        S('Scene 3 — Fixed it'), L('[They solve it together.]', '@0'), L('[Funny last line.]', '@1'),
        L('[Narrator wraps up the lesson.]')
      ]
    },
    explainer: {
      name: 'Explainer / documentary', desc: 'Big question → background → three points → answer.',
      blocks: [
        S('The question'), L('[Ask the question this video answers.]'),
        S('Background'), L('[What do most people think? What do they not know?]'),
        S('Point 1'), L('[Point + evidence/example]'), N('[B-roll]'),
        S('Point 2'), L('[Point + evidence/example]'), N('[B-roll]'),
        S('Point 3'), L('[Point + evidence/example]'), N('[B-roll]'),
        S('Answer'), L('[Clear answer in one or two sentences.]'), L('[What to watch next.]')
      ]
    }
  };

  /* ---------- State ---------- */
  var stories = YB.store.get('stories', []);
  var currentId = YB.store.get('currentStory', null);
  var editingChar = null;
  var pickedColor = COLORS[0];

  function $(id) { return document.getElementById(id); }
  function story() { return stories.find(function (s) { return s.id === currentId; }); }
  var persist = YB.debounce(function () { YB.store.set('stories', stories); YB.store.set('currentStory', currentId); }, 300);
  function touch() { var s = story(); if (s) s.updated = Date.now(); persist(); }

  function newStory(templateKey, title) {
    var s = {
      id: YB.uid(), title: title || 'Untitled story', template: templateKey || 'classic', mode: 'single',
      wpm: 150, target: 3, characters: [], blocks: [], updated: Date.now()
    };
    applyTemplateTo(s, s.template);
    stories.unshift(s);
    currentId = s.id;
    persist();
    return s;
  }

  function applyTemplateTo(s, key) {
    var t = TEMPLATES[key] || TEMPLATES.blank;
    var map = {};
    (t.cast || []).forEach(function (c, i) {
      var existing = s.characters.find(function (x) { return x.name.toLowerCase() === c.name.toLowerCase(); });
      if (!existing) {
        existing = { id: YB.uid(), name: c.name, role: c.role || '', voice: c.voice || 'Warm & friendly', notes: '', color: COLORS[(s.characters.length + 1) % COLORS.length] };
        s.characters.push(existing);
      }
      map['@' + i] = existing.id;
    });
    if (t.cast && t.cast.length > 1) s.mode = 'multi';
    s.blocks = t.blocks.map(function (b) {
      return { id: YB.uid(), type: b.type, speaker: map[b.speaker] || b.speaker || 'narrator', text: b.text };
    });
    s.template = key;
  }

  function cast(s) { return [NARRATOR].concat(s.characters); }
  function who(s, id) { return cast(s).find(function (c) { return c.id === id; }) || NARRATOR; }

  /* ---------- Stats ---------- */
  function words(t) { var m = String(t || '').replace(/\[[^\]]*\]/g, ' ').match(/[\w'’-]+/g); return m ? m.length : 0; }
  function stats(s) {
    var lines = s.blocks.filter(function (b) { return b.type === 'line'; });
    var w = lines.reduce(function (t, b) { return t + words(b.text); }, 0);
    var secs = Math.round((w / (Number(s.wpm) || 150)) * 60);
    return { words: w, secs: secs, lines: lines.length, scenes: s.blocks.filter(function (b) { return b.type === 'scene'; }).length };
  }
  function mmss(sec) { return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); }

  /* ---------- Rendering ---------- */
  function renderList() {
    var list = stories.slice().sort(function (a, b) { return b.updated - a.updated; });
    $('storyList').innerHTML = list.map(function (s) {
      var st = stats(s);
      return '<li><button type="button" data-story="' + s.id + '" class="' + (s.id === currentId ? 'on' : '') + '">' +
        YB.esc(s.title || 'Untitled') + '<small>' + st.lines + ' lines · ' + mmss(st.secs) + ' · ' + (s.mode === 'multi' ? 'multi-voice' : 'one voice') + '</small></button></li>';
    }).join('');
  }

  function renderSetup() {
    var s = story();
    $('sTitle').value = s.title;
    $('sTemplate').value = s.template;
    $('sWpm').value = s.wpm;
    $('sTarget').value = s.target;
    $('templateDesc').textContent = (TEMPLATES[s.template] || TEMPLATES.blank).desc;
    $('modeSeg').querySelectorAll('button').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-mode') === s.mode); });
    $('modeDesc').textContent = s.mode === 'single'
      ? 'One narrator reads every line. Character lines are marked with voice cues so you can change your voice for each one.'
      : 'Each character speaks their own lines. Voice sheets split the script so every voice can be recorded separately.';
  }

  function renderCast() {
    var s = story();
    var cards = cast(s).map(function (c) {
      var isN = c.id === 'narrator', count = s.blocks.filter(function (b) { return speaksIn(s, b, c.id); }).length;
      return '<div class="cast-card" style="--c:' + YB.esc(c.color) + '">' +
        '<h4>' + YB.esc(c.name) + (isN ? ' <span class="badge">always</span>' : '') + '</h4>' +
        '<p>' + YB.esc(c.role || '—') + '</p>' +
        '<p>🎙️ ' + YB.esc(c.voice || '') + ' · ' + count + ' lines</p>' +
        (c.notes ? '<p class="small">' + YB.esc(c.notes) + '</p>' : '') +
        (isN ? '' : '<div class="cast-actions"><button class="btn btn-ghost btn-sm" type="button" data-char-edit="' + c.id + '">Edit</button>' +
          '<button class="btn btn-danger btn-sm" type="button" data-char-del="' + c.id + '">Remove</button></div>') +
        '</div>';
    }).join('');
    $('cast').innerHTML = cards + '<button class="cast-add" type="button" id="addCharTile"><span class="btn btn-plus" aria-hidden="true">+</span>Add character</button>';
  }

  /* ---------- Group lines (several characters say the same line together) ---------- */
  var openGroups = {};   // blocks whose "Together" picker is open (screen only, not saved)
  function withIds(s, b) {
    if (s.mode !== 'multi' || b.type !== 'line') return [];
    var ids = cast(s).map(function (c) { return c.id; });
    return (b.with || []).filter(function (id, i, a) { return id !== b.speaker && ids.indexOf(id) !== -1 && a.indexOf(id) === i; });
  }
  function speaksIn(s, b, id) { return b.type === 'line' && (b.speaker === id || withIds(s, b).indexOf(id) !== -1); }
  function groupNames(s, b) { return [b.speaker].concat(withIds(s, b)).map(function (id) { return who(s, id).name; }); }
  function groupHTML(s, b) {
    var w = withIds(s, b), open = openGroups[b.id] || w.length;
    if (s.mode !== 'multi' || !open) return '';
    var others = cast(s).filter(function (c) { return c.id !== b.speaker; });
    return '<div class="grp-row" role="group" aria-label="Who says this line together">' +
      '<span class="grp-label">👥 Said together with</span>' +
      (others.length ? others.map(function (c) {
        var on = w.indexOf(c.id) !== -1;
        return '<label class="grp-chip' + (on ? ' on' : '') + '" style="--c:' + YB.esc(c.color) + '"><input type="checkbox" data-grp="' + c.id + '"' + (on ? ' checked' : '') + '>' + YB.esc(c.name) + '</label>';
      }).join('') : '<span class="muted small">Add another character first.</span>') +
      '</div>';
  }

  function speakerOptions(s, selected) {
    var label = s.mode === 'single' ? function (c) { return c.id === 'narrator' ? 'Narrator' : 'Voice as: ' + c.name; } : function (c) { return c.name; };
    return cast(s).map(function (c) {
      return '<option value="' + c.id + '"' + (c.id === selected ? ' selected' : '') + '>' + YB.esc(label(c)) + '</option>';
    }).join('');
  }

  function blockHTML(s, b, i) {
    var kind = b.type === 'scene' ? 'Scene' : b.type === 'note' ? 'Direction' : 'Line';
    var color = b.type === 'line' ? who(s, b.speaker).color : '';
    var ph = b.type === 'scene' ? 'Scene title…' : b.type === 'note' ? '[Music, SFX, B-roll, on-screen text…]' : 'What is said…';
    return '<div class="block ' + b.type + '" data-id="' + b.id + '"' + (color ? ' style="--c:' + YB.esc(color) + '"' : '') + '>' +
      '<div class="block-top"><span class="block-kind">' + (i + 1) + ' · ' + kind + '</span>' +
      (b.type === 'line' ? '<select data-f="speaker" aria-label="Speaker">' + speakerOptions(s, b.speaker) + '</select>' : '') +
      (b.type === 'line' && s.mode === 'multi' ? '<button type="button" class="grp-btn' + (withIds(s, b).length ? ' on' : '') + '" data-act="group" aria-pressed="' + (withIds(s, b).length ? 'true' : 'false') + '" title="Several characters say this line at the same time">👥 ' + (withIds(s, b).length ? (withIds(s, b).length + 1) + ' together' : 'Together') + '</button>' : '') +
      '<div class="block-tools">' +
      '<button type="button" data-act="up" aria-label="Move up">↑</button>' +
      '<button type="button" data-act="down" aria-label="Move down">↓</button>' +
      '<button type="button" data-act="dup" aria-label="Duplicate">⧉</button>' +
      '<button type="button" data-act="del" aria-label="Delete">✕</button>' +
      '</div></div>' +
      (b.type === 'line' ? groupHTML(s, b) : '') +
      '<textarea data-f="text" rows="' + (b.type === 'scene' ? 1 : 3) + '" placeholder="' + ph + '">' + YB.esc(b.text) + '</textarea>' +
      '</div>';
  }

  function renderBlocks() {
    var s = story();
    $('blocks').innerHTML = s.blocks.length ? s.blocks.map(function (b, i) { return blockHTML(s, b, i); }).join('')
      : '<div class="chart-empty">No lines yet — use the buttons below or load a template outline.</div>';
  }

  function renderStats() {
    var s = story(), st = stats(s), target = Number(s.target) || 0;
    $('stats').innerHTML =
      '<span class="stat-pill"><b>' + st.words + '</b> words</span>' +
      '<span class="stat-pill">⏱ <b>' + mmss(st.secs) + '</b>' + (target ? ' / ' + mmss(Math.round(target * 60)) : '') + '</span>' +
      '<span class="stat-pill"><b>' + st.lines + '</b> lines</span>' +
      '<span class="stat-pill"><b>' + st.scenes + '</b> scenes</span>';
    var pct = target ? Math.min(100, (st.secs / (target * 60)) * 100) : 0;
    var bar = $('targetBar');
    bar.style.width = pct + '%';
    bar.style.background = target && st.secs > target * 60 * 1.1 ? 'linear-gradient(90deg,#fbbf24,#f87171)' : '';

    var rows = cast(s).map(function (c) {
      var ls = s.blocks.filter(function (b) { return speaksIn(s, b, c.id); });
      return { c: c, lines: ls.length, words: ls.reduce(function (t, b) { return t + words(b.text); }, 0) };
    }).filter(function (r) { return r.lines; });
    $('castBreakdown').innerHTML = rows.length ? '<div class="label" style="margin-bottom:8px">Who speaks how much</div>' + rows.map(function (r) {
      var pct2 = st.words ? (r.words / st.words) * 100 : 0;
      return '<div class="row small" style="gap:8px;margin-top:6px;flex-wrap:nowrap"><span class="dot" style="--c:' + YB.esc(r.c.color) + '"></span>' +
        '<span style="width:110px;flex:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + YB.esc(r.c.name) + '</span>' +
        '<div class="progress" style="flex:1"><i style="width:' + pct2.toFixed(1) + '%;background:' + YB.esc(r.c.color) + '"></i></div>' +
        '<span style="width:92px;text-align:right;flex:none" class="muted">' + r.lines + ' lines · ' + Math.round(pct2) + '%</span></div>';
    }).join('') : '';
  }

  function renderAll() { renderList(); renderSetup(); renderCast(); renderBlocks(); renderStats(); }

  /* ---------- Characters ---------- */
  function openCharModal(id) {
    var s = story(), c = id ? s.characters.find(function (x) { return x.id === id; }) : null;
    editingChar = c ? c.id : null;
    var f = $('charForm');
    f.reset();
    f.elements.name.value = c ? c.name : '';
    f.elements.role.value = c ? c.role : '';
    f.elements.voice.value = c ? c.voice : 'Warm & friendly';
    f.elements.notes.value = c ? c.notes : '';
    pickedColor = c ? c.color : COLORS[(s.characters.length) % COLORS.length];
    renderSwatches();
    $('charModalTitle').textContent = c ? 'Edit character' : 'Add character';
    $('charSave').textContent = c ? 'Save' : 'Add character';
    $('charModal').hidden = false;
    document.body.classList.add('no-scroll');
    setTimeout(function () { f.elements.name.focus(); }, 30);
  }
  function closeCharModal() { $('charModal').hidden = true; document.body.classList.remove('no-scroll'); }
  function renderSwatches() {
    $('swatches').innerHTML = COLORS.map(function (c) {
      return '<button type="button" style="--c:' + c + '" data-color="' + c + '" class="' + (c === pickedColor ? 'on' : '') + '" aria-label="Color ' + c + '"></button>';
    }).join('');
  }

  function saveChar(e) {
    e.preventDefault();
    var s = story(), f = $('charForm');
    var data = { name: f.elements.name.value.trim(), role: f.elements.role.value.trim(), voice: f.elements.voice.value, notes: f.elements.notes.value.trim(), color: pickedColor };
    if (!data.name) return;
    if (editingChar) {
      Object.assign(s.characters.find(function (x) { return x.id === editingChar; }), data);
    } else {
      s.characters.push(Object.assign({ id: YB.uid() }, data));
      if (s.characters.length >= 1 && s.mode === 'single' && s.characters.length === 2) YB.toast('Tip: switch to “Multiple characters” to give each one their own voice');
    }
    touch(); closeCharModal(); renderCast(); renderBlocks(); renderStats(); renderList();
    YB.toast(editingChar ? 'Character updated' : data.name + ' joined the cast');
  }

  function deleteChar(id) {
    var s = story(), c = s.characters.find(function (x) { return x.id === id; }); if (!c) return;
    if (!confirm('Remove ' + c.name + '? Their lines will move to the Narrator.')) return;
    s.characters = s.characters.filter(function (x) { return x.id !== id; });
    s.blocks.forEach(function (b) {
      if (b.with) b.with = b.with.filter(function (x) { return x !== id; });
      if (b.speaker === id) b.speaker = 'narrator';
      if (b.with) { b.with = b.with.filter(function (x) { return x !== b.speaker; }); if (!b.with.length) delete b.with; }
    });
    touch(); renderCast(); renderBlocks(); renderStats();
  }

  /* ---------- Blocks ---------- */
  function nextSpeaker(s) {
    if (s.mode !== 'multi' || !s.characters.length) return 'narrator';
    var lines = s.blocks.filter(function (b) { return b.type === 'line'; });
    if (!lines.length) return s.characters[0].id;
    var ids = cast(s).map(function (c) { return c.id; });
    var lastIdx = ids.indexOf(lines[lines.length - 1].speaker);
    return ids[(lastIdx + 1) % ids.length];
  }

  function addBlock(type) {
    var s = story();
    var b = { id: YB.uid(), type: type, speaker: type === 'line' ? nextSpeaker(s) : 'narrator', text: '' };
    s.blocks.push(b);
    touch(); renderBlocks(); renderStats();
    var el = document.querySelector('.block[data-id="' + b.id + '"] textarea');
    if (el) { el.focus({ preventScroll: true }); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }

  function blockAction(id, act) {
    var s = story(), i = s.blocks.findIndex(function (b) { return b.id === id; }); if (i === -1) return;
    if (act === 'up' && i > 0) { var t = s.blocks[i - 1]; s.blocks[i - 1] = s.blocks[i]; s.blocks[i] = t; }
    else if (act === 'down' && i < s.blocks.length - 1) { var t2 = s.blocks[i + 1]; s.blocks[i + 1] = s.blocks[i]; s.blocks[i] = t2; }
    else if (act === 'dup') s.blocks.splice(i + 1, 0, Object.assign({}, s.blocks[i], { id: YB.uid() }, s.blocks[i].with ? { with: s.blocks[i].with.slice() } : {}));
    else if (act === 'del') {
      if (s.blocks[i].text.trim() && !confirm('Delete this block?')) return;
      s.blocks.splice(i, 1);
    } else if (act === 'group') {
      if (withIds(s, s.blocks[i]).length) { if (openGroups[id]) { delete openGroups[id]; } else openGroups[id] = 1; }
      else if (openGroups[id]) delete openGroups[id]; else openGroups[id] = 1;
      renderBlocks(); return;
    } else return;
    touch(); renderBlocks(); renderStats();
  }

  /* ---------- Import a script (paste or PDF / Word file) — parsing lives in js/script-import.js ---------- */
  var imp = { parsed: null, off: {}, other: 'narrator', dest: 'new', title: '', busy: false, narr: 'narrator' };

  function impParse(text, fileTitle) {
    var P = window.YBScriptImport;
    if (!P) return;
    var p = text.trim() ? P.parse(text) : null;
    var prev = imp.parsed;
    imp.parsed = p; imp.off = {};
    if (p) {
      p.cast.forEach(function (c) { if (c.undeclared) imp.off[c.key] = true; });   // not in the script's CHARACTERS list
      if (!p.lines && p.cast.length && story()) imp.dest = 'append';               // a character sheet: add to this story
      if (!prev || prev.suggestOther !== p.suggestOther) imp.other = p.suggestOther;
      if (!prev || prev.narratorAs !== p.narratorAs) imp.narr = p.narratorAs || 'narrator';
      imp.title = p.title || fileTitle || imp.title || '';
      $('impTitleIn').value = imp.title;
    }
    renderImport();
  }

  function impColor(i, s) { return COLORS[(i + 1) % COLORS.length]; }
  // Who reads narration: the Narrator's own voice, or a (ticked) character such as the main character.
  function impNarrator() { var k = imp.narr; return k && k !== 'narrator' && !imp.off[k] && imp.parsed && imp.parsed.cast.some(function (c) { return c.key === k; }) ? k : 'narrator'; }

  function renderImport() {
    var p = imp.parsed, has = p && (p.lines || p.items.length || p.cast.length);
    $('impPreview').hidden = !has;
    $('impGo').disabled = !has || imp.busy;
    if (!has) { $('impGo').textContent = 'Import'; return; }
    var on = p.cast.filter(function (c) { return !imp.off[c.key]; });
    var groups = p.items.filter(function (it) { return it.type === 'line' && (it.all || it.who.length > 1); }).length;
    var scenes = p.items.filter(function (it) { return it.type === 'scene'; }).length;
    $('impSum').innerHTML = (p.strict ? '<span class="stat-pill imp-ok">✓ YouTube Blue format</span>' : '') + '<span class="stat-pill"><b>' + p.lines + '</b> spoken lines</span>' +
      '<span class="stat-pill"><b>' + on.length + '</b> character' + (on.length === 1 ? '' : 's') + (p.narratorLines ? ' + Narrator' : '') + '</span>' +
      (groups ? '<span class="stat-pill">👥 <b>' + groups + '</b> said together</span>' : '') +
      (scenes ? '<span class="stat-pill"><b>' + scenes + '</b> scene' + (scenes === 1 ? '' : 's') + '</span>' : '');
    $('impCast').innerHTML = (p.cast.length ? p.cast.map(function (c, i) {
      var off = imp.off[c.key];
      return '<label class="grp-chip' + (off ? '' : ' on') + '" style="--c:' + impColor(i) + '" title="' + YB.esc(c.undeclared ? 'Not in the CHARACTERS list — probably not a character' : (c.role || '')) + '">' +
        '<input type="checkbox" data-imp-char="' + YB.esc(c.key) + '"' + (off ? '' : ' checked') + '>' + YB.esc(c.name) +
        ' <span class="muted small">' + c.count + '</span></label>';
    }).join('') : '<span class="muted small">No character names found — check the formats below, or everything goes to the Narrator.</span>') +
      (p.narratorLines ? '<span class="grp-chip on imp-narr" style="--c:#1e7bff">🎙️ Narrator <span class="muted small">' + p.narratorLines + '</span></span>' : '');
    var unnamed = impItems().filter(function (it) { return it.kind === 'text'; }).length;
    var nk = impNarrator(), showNarr = p.cast.length && (p.narratorLines || p.narratorAs || (unnamed && imp.other === 'narrator'));
    $('impNarrField').hidden = !showNarr;
    $('impNarr').innerHTML = '<option value="narrator">The Narrator (its own voice)</option>' + p.cast.filter(function (c) { return !imp.off[c.key]; }).map(function (c) {
      return '<option value="' + YB.esc(c.key) + '"' + (c.key === nk ? ' selected' : '') + '>' + YB.esc(c.name) + ' — the main character narrates</option>';
    }).join('');
    $('impOtherN').textContent = unnamed;
    $('impOtherField').hidden = !unnamed;
    $('impOther').querySelectorAll('[data-other]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-other') === imp.other); });
    $('impDest').querySelectorAll('[data-dest]').forEach(function (b) { b.classList.toggle('on', b.getAttribute('data-dest') === imp.dest); });
    var list = impItems(), shown = list.slice(0, 60), ci = {};
    p.cast.forEach(function (c, i) { ci[c.key] = impColor(i); });
    $('impLines').innerHTML = shown.map(function (it) {
      if (it.kind === 'scene') return '<li class="imp-scene">— ' + YB.esc(it.text) + ' —</li>';
      if (it.kind === 'note') return '<li class="imp-note">' + YB.esc(it.text) + '</li>';
      if (it.kind === 'text') {
        var nkey = impNarrator(), nc = nkey !== 'narrator' && p.cast.find(function (x) { return x.key === nkey; });
        var how = imp.other === 'narrator' ? (nc ? '<b style="color:' + ci[nkey] + '">' + YB.esc(nc.name) + '</b> <span class="muted">narrating</span>' : '<b style="color:#1e7bff">Narrator</b>') : imp.other === 'note' ? '<i>Direction</i>' : '<i>left out</i>';
        return '<li class="imp-text' + (imp.other === 'skip' ? ' imp-skip' : '') + '"><span class="imp-who">' + how + '</span>' + YB.esc(it.text) + '</li>';
      }
      var names = it.keys.map(function (k) {
        if (k === 'narrator') return '<b style="color:#1e7bff">Narrator</b>';
        var c = p.cast.find(function (x) { return x.key === k; });
        return '<b style="color:' + ci[k] + '">' + YB.esc(c ? c.name : k) + '</b>';
      }).join(' + ') + (it.narr ? ' <span class="muted">narrating</span>' : '');
      return '<li><span class="imp-who">' + names + (it.keys.length > 1 ? ' <span class="grp-tag">👥</span>' : '') + '</span>' + YB.esc(it.text) + '</li>';
    }).join('') + (list.length > shown.length ? '<li class="imp-more">…and ' + (list.length - shown.length) + ' more</li>' : '');
    var spoken = list.filter(function (it) { return it.kind === 'line' || (it.kind === 'text' && imp.other === 'narrator'); }).length;
    var newChars = p.cast.filter(function (c) { return !imp.off[c.key]; }).length;
    $('impGo').textContent = spoken ? 'Import ' + spoken + ' line' + (spoken === 1 ? '' : 's') : 'Add ' + newChars + ' character' + (newChars === 1 ? '' : 's');
    $('impGo').disabled = imp.busy || (!spoken && !newChars);
  }

  // What the import will produce, with ticks applied: { kind: line|text|scene|note, keys, text }
  function impItems() {
    var p = imp.parsed, out = [];
    if (!p) return out;
    var allKeys = p.cast.filter(function (c) { return !imp.off[c.key]; }).map(function (c) { return c.key; });
    p.items.forEach(function (it) {
      if (it.type === 'scene' || it.type === 'note') return out.push({ kind: it.type, text: it.text });
      if (it.type === 'text') return out.push({ kind: 'text', text: it.text });
      var keys = it.all ? (allKeys.length ? allKeys : ['narrator']) : it.who;
      if (keys.some(function (k) { return imp.off[k]; })) return out.push({ kind: 'text', text: it.raw || it.text });   // unticked "name" → plain text
      if (!keys.length) keys = ['narrator'];
      var nk = impNarrator(), narr = !!it.narr;
      if (nk !== 'narrator' && keys.indexOf('narrator') !== -1) { keys = keys.map(function (k) { return k === 'narrator' ? nk : k; }); narr = true; }
      out.push({ kind: 'line', keys: keys.filter(function (k, i) { return keys.indexOf(k) === i; }), text: it.text, narr: narr });
    });
    return out;
  }

  function openImport(dest) {
    imp.dest = dest || (story() && storyHasText(story()) ? 'new' : 'replace');
    $('importModal').hidden = false; document.body.classList.add('no-scroll');
    $('impErr').hidden = true;
    renderImport();
    setTimeout(function () { $('impText').focus(); }, 30);
  }
  function closeImport() { $('importModal').hidden = true; document.body.classList.remove('no-scroll'); }
  function storyHasText(s) { return s.blocks.some(function (b) { return b.text.trim() && !/^\[.*\]$/.test(b.text.trim()); }); }

  function impFile(file) {
    if (!file || !window.YBScriptImport) return;
    imp.busy = true; $('impErr').hidden = true;
    $('impFileNote').textContent = 'Reading ' + file.name + '…';
    renderImport();
    window.YBScriptImport.readFile(file).then(function (r) {
      imp.busy = false;
      var text = r.text.replace(/\r\n?/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
      $('impText').value = text;
      $('impFileNote').textContent = '✓ ' + file.name;
      imp.parsed = null; imp.title = '';
      impParse(text, r.title);
      if (imp.parsed && !imp.parsed.lines) impError('Opened ' + file.name + ', but no "Name: line" style dialogue was found — everything would go to the Narrator. Check the formats below.');
    }, function (e) {
      imp.busy = false;
      $('impFileNote').textContent = file.name;
      impError(e && e.message ? e.message : 'That file couldn\'t be read.');
      renderImport();
    });
  }
  function impError(msg) { var el = $('impErr'); el.textContent = msg; el.hidden = false; }

  function doImport() {
    var p = imp.parsed; if (!p) return;
    var items = impItems(), cur = story(), dest = imp.dest, title = $('impTitleIn').value.trim();
    if (dest !== 'new' && !cur) dest = 'new';
    if (dest === 'replace' && storyHasText(cur) && !confirm('Replace the script of “' + cur.title + '” with the imported one? Its characters are replaced too.')) return;
    var s = dest === 'new'
      ? { id: YB.uid(), title: title || 'Imported script', template: 'blank', mode: 'multi', wpm: 150, target: 0, characters: [], blocks: [], updated: Date.now() }
      : cur;
    var keep = dest === 'append' ? s.characters.slice() : [];
    var pool = dest === 'new' ? [] : s.characters.slice();   // replace: reuse a matching character (keeps its color and voice)
    var used = {};
    function idFor(k) {
      if (k === 'narrator') return 'narrator';
      if (used[k]) return used[k];
      var c = p.cast.find(function (x) { return x.key === k; });
      var name = c ? c.name : k, nk = name.toLowerCase();
      var found = keep.find(function (x) { return x.name.toLowerCase() === nk; }) || pool.find(function (x) { return x.name.toLowerCase() === nk; });
      if (!found) {
        var all = keep.length;
        found = { id: YB.uid(), name: name, role: (c && c.role) || '', voice: voicePreset(c), notes: (c && c.notes) || '', color: COLORS[(all + 1) % COLORS.length] };
      } else if (c) {
        if (c.role && !found.role) found.role = c.role;
        if (c.notes && !found.notes) found.notes = c.notes;
      }
      if (keep.indexOf(found) === -1) keep.push(found);
      used[k] = found.id;
      return found.id;
    }
    // every ticked character joins the cast, even one with no lines yet (a character sheet)
    p.cast.forEach(function (c) { if (!imp.off[c.key]) idFor(c.key); });
    var blocks = [];
    items.forEach(function (it) {
      if (it.kind === 'scene') blocks.push({ id: YB.uid(), type: 'scene', speaker: 'narrator', text: it.text });
      else if (it.kind === 'note') blocks.push({ id: YB.uid(), type: 'note', speaker: 'narrator', text: it.text });
      else if (it.kind === 'text') {
        if (imp.other === 'narrator') blocks.push({ id: YB.uid(), type: 'line', speaker: idFor(impNarrator()), text: it.text });
        else if (imp.other === 'note') blocks.push({ id: YB.uid(), type: 'note', speaker: 'narrator', text: it.text });
      } else {
        var ids = it.keys.map(idFor), b = { id: YB.uid(), type: 'line', speaker: ids[0], text: it.text };
        if (ids.length > 1) b.with = ids.slice(1);
        blocks.push(b);
      }
    });
    s.characters = keep;
    if (dest === 'append') s.blocks = s.blocks.filter(function (b) { return b.text.trim(); }).concat(blocks);
    else s.blocks = blocks;
    if (s.characters.length) s.mode = 'multi';
    if (dest !== 'append' && title) s.title = title;
    s.updated = Date.now();
    if (dest === 'new') stories.unshift(s);
    currentId = s.id;
    persist(); renderAll(); closeImport();
    var n = blocks.filter(function (b) { return b.type === 'line'; }).length;
    YB.toast('Imported ' + n + ' line' + (n === 1 ? '' : 's') + ' · ' + s.characters.length + ' character' + (s.characters.length === 1 ? '' : 's'));
    $('impText').value = ''; imp.parsed = null; $('impFileNote').textContent = '…or drop a file here';
  }

  // Pick the closest voice style from a character's description ("deep, slow, wise grandpa" → Wise elder).
  function voicePreset(c) {
    if (!c) return 'Warm & friendly';
    var rules = [[/robot|machine|\bai\b|android|computer/, 'Robot / AI'], [/grandma|grandpa|grandmother|grandfather|elder|old (man|woman|lady)|wise|elderly/, 'Wise elder'],
      [/\b[1-9] years? old|\bkid\b|child|toddler|little (boy|girl)|childlike|young (boy|girl)/, 'Small / childlike'],
      [/deep|low pitch|gravel|booming|slow/, 'Deep & slow'], [/grump|cranky|grouch/, 'Grumpy'], [/silly|cartoon|goofy|squeaky/, 'Silly / cartoon'],
      [/excited|hyper|energetic|high[- ]energy|enthusiastic/, 'High & excited'], [/narrat|storyteller|calm/, 'Calm storyteller']];
    function pick(t) { t = String(t || '').toLowerCase(); for (var i = 0; i < rules.length; i++) if (rules[i][0].test(t)) return rules[i][1]; return ''; }
    // the voice direction decides first; the role / notes only if it says nothing useful
    return pick(c.voice) || pick((c.role || '') + ' ' + (c.notes || '')) || 'Warm & friendly';
  }

  function wireImport() {
    if (!$('importModal')) return;
    var later = YB.debounce(function () { impParse($('impText').value); $('impErr').hidden = true; }, 250);
    $('impText').addEventListener('input', later);
    $('impFile').addEventListener('change', function () { impFile(this.files[0]); this.value = ''; });
    $('importScript').addEventListener('click', function () { openImport(); });
    $('importStory').addEventListener('click', function () { openImport('new'); });
    $('impClose').addEventListener('click', closeImport);
    $('impCancel').addEventListener('click', closeImport);
    $('importModal').addEventListener('click', function (e) { if (e.target === this) closeImport(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('importModal').hidden) closeImport(); });
    $('impGo').addEventListener('click', doImport);
    $('impTitleIn').addEventListener('input', function () { imp.title = this.value; });
    $('impCast').addEventListener('change', function (e) {
      var k = e.target.getAttribute('data-imp-char'); if (k === null) return;
      if (e.target.checked) delete imp.off[k]; else imp.off[k] = true;
      renderImport();
    });
    $('impOther').addEventListener('click', function (e) { var b = e.target.closest('[data-other]'); if (b) { imp.other = b.getAttribute('data-other'); renderImport(); } });
    $('impNarr').addEventListener('change', function () { imp.narr = this.value; renderImport(); });
    $('impDest').addEventListener('click', function (e) { var b = e.target.closest('[data-dest]'); if (b) { imp.dest = b.getAttribute('data-dest'); renderImport(); } });
    var drop = $('impDrop');
    ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
    ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
    drop.addEventListener('drop', function (e) { var f = e.dataTransfer && e.dataTransfer.files[0]; if (f) impFile(f); });
  }

  /* ---------- Exports ---------- */
  function scriptText(s) {
    var st = stats(s), out = [];
    out.push(s.title.toUpperCase());
    out.push('Template: ' + (TEMPLATES[s.template] || TEMPLATES.blank).name + ' · Narration: ' + (s.mode === 'multi' ? 'Multiple characters' : 'One voice') + ' · Est. ' + mmss(st.secs) + ' at ' + s.wpm + ' wpm');
    out.push('');
    out.push('CAST');
    cast(s).forEach(function (c) { out.push('- ' + c.name + (c.role ? ' — ' + c.role : '') + ' (' + c.voice + ')' + (c.notes ? ' — ' + c.notes : '')); });
    s.blocks.forEach(function (b) {
      if (!b.text.trim()) return;
      if (b.type === 'scene') { out.push(''); out.push('=== ' + b.text.trim().toUpperCase() + ' ==='); }
      else if (b.type === 'note') out.push('  (' + b.text.trim().replace(/^\[|\]$/g, '') + ')');
      else {
        var c = who(s, b.speaker), grp = s.mode === 'multi' && withIds(s, b).length;
        var tag = grp ? groupNames(s, b).join(' + ').toUpperCase() + ' (together)'
          : s.mode === 'single' && c.id !== 'narrator' ? 'NARRATOR (as ' + c.name.toUpperCase() + ', ' + c.voice.toLowerCase() + ' voice)' : c.name.toUpperCase();
        out.push(tag + ': ' + b.text.trim());
      }
    });
    return out.join('\n');
  }

  function voiceSheets(s) {
    var out = [s.title.toUpperCase() + ' — VOICE SHEETS', ''];
    cast(s).forEach(function (c) {
      var scene = '', n = 0, lines = [];
      s.blocks.forEach(function (b) {
        if (b.type === 'scene') scene = b.text.trim();
        if (speaksIn(s, b, c.id) && b.text.trim()) {
          var mates = s.mode === 'multi' ? groupNames(s, b).filter(function (nm) { return nm !== c.name; }) : [];
          n++; lines.push(n + '. ' + (scene ? '[' + scene + '] ' : '') + (mates.length ? '(together with ' + mates.join(' + ') + ') ' : '') + b.text.trim());
        }
      });
      if (!lines.length) return;
      out.push('────────────────────────────────');
      out.push(c.name.toUpperCase() + ' — ' + lines.length + ' lines');
      out.push('Voice: ' + c.voice + (c.notes ? ' · ' + c.notes : ''));
      out.push('');
      out = out.concat(lines);
      out.push('');
    });
    return out.join('\n');
  }

  function fileSlug(s) { return (s.title || 'story').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'story'; }

  /* ---------- Teleprompter ---------- */
  var pState = { playing: false, raf: 0, last: 0, lock: null, pos: 0 };

  function openPrompter() {
    var s = story();
    $('pText').innerHTML = '<p class="scene">' + YB.esc(s.title) + '</p>' + s.blocks.filter(function (b) { return b.text.trim(); }).map(function (b) {
      if (b.type === 'scene') return '<p class="scene">— ' + YB.esc(b.text) + ' —</p>';
      if (b.type === 'note') return '<p class="note">' + YB.esc(b.text) + '</p>';
      var c = who(s, b.speaker);
      var label = s.mode === 'multi' && withIds(s, b).length ? groupNames(s, b).join(' + ')
        : s.mode === 'single' && c.id !== 'narrator' ? 'as ' + c.name + ' · ' + c.voice : c.name;
      return '<p><span class="who" style="color:' + YB.esc(c.color) + '">' + YB.esc(label) + '</span>' + YB.esc(b.text) + '</p>';
    }).join('') + '<p class="scene">— END —</p>';
    $('prompter').hidden = false;
    document.body.classList.add('no-scroll');
    $('pScroll').scrollTop = 0;
    pState.pos = 0;
    applySize();
  }
  function closePrompter() { stopPrompter(); $('prompter').hidden = true; document.body.classList.remove('no-scroll'); }
  function applySize() { $('pText').style.fontSize = 'calc((1.4rem + 2.6vw) * ' + ($('pSize').value / 100) + ')'; }

  function tick(t) {
    if (!pState.playing) return;
    var dt = pState.last ? (t - pState.last) / 1000 : 0; pState.last = t;
    var el = $('pScroll');
    pState.pos += dt * Number($('pSpeed').value);
    el.scrollTop = pState.pos;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) { stopPrompter(); return; }
    pState.raf = requestAnimationFrame(tick);
  }
  function startPrompter() {
    pState.playing = true; pState.last = 0; pState.pos = $('pScroll').scrollTop;
    $('pPlay').textContent = '❚❚ Pause';
    if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then(function (l) { pState.lock = l; }).catch(function () {});
    pState.raf = requestAnimationFrame(tick);
  }
  function stopPrompter() {
    pState.playing = false; cancelAnimationFrame(pState.raf);
    $('pPlay').textContent = '▶ Play';
    if (pState.lock) { pState.lock.release().catch(function () {}); pState.lock = null; }
  }

  /* ---------- Emotion / reaction tags while typing a line ----------
     Same chips as Voice Studio (it saves the server's tag list as
     "voiceTags"); shown under the character line you're typing in. */
  var DEFAULT_TAGS = ['laugh', 'chuckle', 'sigh', 'gasp', 'cough', 'clear throat', 'sniff', 'groan', 'shush'];
  var TAG_GROUPS = [['Laughter', ['laugh', 'chuckle']], ['Reaction', ['sigh', 'gasp', 'groan']], ['Vocal sounds', ['cough', 'clear throat', 'sniff', 'shush']]];
  var tagUi = { bar: null, target: null, start: null, end: null, hideTimer: 0, chipAt: 0 };

  function storyTags() {
    var t = YB.store.get('voiceTags', null);
    return (Array.isArray(t) && t.length ? t : DEFAULT_TAGS).map(function (x) { return String(x).replace(/^\[|\]$/g, '').trim().toLowerCase(); }).filter(Boolean);
  }

  function tagBar() {
    if (tagUi.bar) return tagUi.bar;
    var tags = storyTags(), used = {}, html = '';
    function group(name, items) {
      return '<div class="tag-group"><span class="tag-group-name">' + YB.esc(name) + '</span><div class="tag-row">' +
        items.map(function (t) { return '<button type="button" data-tag="' + YB.esc(t) + '" title="Adds [' + YB.esc(t) + '] at your cursor">[' + YB.esc(t) + ']</button>'; }).join('') + '</div></div>';
    }
    TAG_GROUPS.forEach(function (g) {
      var items = g[1].filter(function (t) { return tags.indexOf(t) !== -1; });
      items.forEach(function (t) { used[t] = 1; });
      if (items.length) html += group(g[0], items);
    });
    var extra = tags.filter(function (t) { return !used[t]; });
    if (extra.length) html += group('More', extra);
    var bar = document.createElement('div');
    bar.className = 'tag-box story-tag-box';
    bar.innerHTML = '<div class="label" style="margin-bottom:4px">😄 Emotion &amp; reaction tags <span class="muted small">— tap one to add it where your cursor is</span></div>' +
      '<p class="tag-example">Type it like this: <code>[laugh] That\'s the silliest thing ever!</code></p>' +
      '<div class="tag-groups">' + html + '</div>' +
      '<p class="muted small" style="margin:8px 0 0">Tags work best right before the sentence they affect. They\'re voiced by the Turbo model in Voice Studio.</p>';
    ['pointerdown', 'mousedown'].forEach(function (ev) {
      bar.addEventListener(ev, function (e) { tagUi.chipAt = Date.now(); if (e.target.closest('[data-tag]')) e.preventDefault(); }); // keep the cursor in the line
    });
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-tag]'); if (!b) return;
      tagUi.chipAt = Date.now();
      insertTag('[' + b.getAttribute('data-tag') + ']');
    });
    tagUi.bar = bar;
    return bar;
  }

  function showTagsFor(ta) {
    clearTimeout(tagUi.hideTimer);
    tagUi.target = ta;
    saveTagCursor();
    var bar = tagBar(), block = ta.closest('.block');
    if (bar.parentNode !== block) block.appendChild(bar);
    bar.hidden = false;
  }

  function hideTagsSoon() {
    clearTimeout(tagUi.hideTimer);
    tagUi.hideTimer = setTimeout(function () {
      var ae = document.activeElement;
      if (ae === tagUi.target || (tagUi.bar && tagUi.bar.contains(ae))) return;
      if (Date.now() - tagUi.chipAt < 300) { hideTagsSoon(); return; }   // just tapped a chip — check again shortly
      if (tagUi.bar) tagUi.bar.hidden = true;
    }, 250);
  }

  function saveTagCursor() {
    var ta = tagUi.target;
    if (ta && ta.selectionStart != null) { tagUi.start = ta.selectionStart; tagUi.end = ta.selectionEnd; }
  }

  function insertTag(snippet) {
    var ta = tagUi.target;
    if (!ta || !document.body.contains(ta)) return;
    var focused = document.activeElement === ta;
    var start = focused ? ta.selectionStart : (tagUi.start != null ? tagUi.start : ta.value.length);
    var end = focused ? ta.selectionEnd : (tagUi.end != null ? tagUi.end : start);
    start = Math.min(start, ta.value.length); end = Math.min(Math.max(end, start), ta.value.length);
    var before = ta.value.slice(0, start), after = ta.value.slice(end);
    if (before && !/\s$/.test(before)) snippet = ' ' + snippet;
    if (!after || !/^\s/.test(after)) snippet += ' ';
    ta.value = before + snippet + after;
    var pos = start + snippet.length;
    ta.focus();
    ta.setSelectionRange(pos, pos);
    tagUi.start = tagUi.end = pos;
    ta.dispatchEvent(new Event('input', { bubbles: true }));   // saves through the normal line editor
  }

  /* ---------- Events ---------- */
  function bind() {
    $('sTemplate').innerHTML = Object.keys(TEMPLATES).map(function (k) { return '<option value="' + k + '">' + YB.esc(TEMPLATES[k].name) + '</option>'; }).join('');

    $('storyList').addEventListener('click', function (e) {
      var b = e.target.closest('[data-story]'); if (!b) return;
      currentId = b.getAttribute('data-story'); persist(); renderAll();
    });
    $('newStory').addEventListener('click', function () { newStory('classic'); renderAll(); $('sTitle').focus(); $('sTitle').select(); });
    $('dupStory').addEventListener('click', function () {
      var copy = JSON.parse(JSON.stringify(story()));
      copy.id = YB.uid(); copy.title += ' (copy)'; copy.updated = Date.now();
      stories.unshift(copy); currentId = copy.id; persist(); renderAll(); YB.toast('Story duplicated');
    });
    $('delStory').addEventListener('click', function () {
      if (!confirm('Delete “' + story().title + '”? This cannot be undone.')) return;
      var gone = currentId;
      stories = stories.filter(function (s) { return s.id !== currentId; });
      var vc = YB.store.get('voiceCast', null);   // its Voice Studio character voices go with it
      if (vc && vc[gone]) { delete vc[gone]; YB.store.set('voiceCast', vc); }
      if (!stories.length) newStory('classic', 'My first story');
      currentId = stories[0].id; persist(); renderAll();
    });

    $('sTitle').addEventListener('input', function () { story().title = this.value; touch(); renderList(); });
    $('sWpm').addEventListener('input', function () { story().wpm = Math.max(60, Number(this.value) || 150); touch(); renderStats(); renderList(); });
    $('sTarget').addEventListener('input', function () { story().target = Number(this.value) || 0; touch(); renderStats(); });
    $('sTemplate').addEventListener('change', function () {
      story().template = this.value; touch();
      $('templateDesc').textContent = TEMPLATES[this.value].desc;
    });
    $('applyTemplate').addEventListener('click', function () {
      var s = story();
      var hasText = s.blocks.some(function (b) { return b.text.trim() && !/^\[.*\]$/.test(b.text.trim()); });
      if (hasText && !confirm('Replace your current script with the “' + TEMPLATES[s.template].name + '” outline? (Characters are kept.)')) return;
      applyTemplateTo(s, s.template); touch(); renderAll(); YB.toast('Template loaded');
    });

    $('modeSeg').addEventListener('click', function (e) {
      var b = e.target.closest('[data-mode]'); if (!b) return;
      story().mode = b.getAttribute('data-mode'); touch(); renderSetup(); renderBlocks(); renderList();
    });

    // characters
    $('addCharTop').addEventListener('click', function () { openCharModal(null); });
    $('cast').addEventListener('click', function (e) {
      if (e.target.closest('#addCharTile')) return openCharModal(null);
      var ed = e.target.closest('[data-char-edit]'), del = e.target.closest('[data-char-del]');
      if (ed) openCharModal(ed.getAttribute('data-char-edit'));
      if (del) deleteChar(del.getAttribute('data-char-del'));
    });
    $('charForm').addEventListener('submit', saveChar);
    $('charCancel').addEventListener('click', closeCharModal);
    $('charModal').addEventListener('click', function (e) { if (e.target === this) closeCharModal(); });
    $('swatches').addEventListener('click', function (e) {
      var b = e.target.closest('[data-color]'); if (!b) return;
      pickedColor = b.getAttribute('data-color'); renderSwatches();
    });

    // blocks
    var statsLater = YB.debounce(function () { renderStats(); renderList(); }, 250);
    $('blocks').addEventListener('input', function (e) {
      var el = e.target, wrap = el.closest('.block'); if (!wrap || el.getAttribute('data-f') !== 'text') return;
      var b = story().blocks.find(function (x) { return x.id === wrap.getAttribute('data-id'); });
      if (b) { b.text = el.value; touch(); statsLater(); }
    });
    // Emotion tags appear while you type in a character line
    $('blocks').addEventListener('focusin', function (e) {
      var ta = e.target;
      if (ta.getAttribute && ta.getAttribute('data-f') === 'text' && ta.closest('.block.line')) showTagsFor(ta);
    });
    $('blocks').addEventListener('focusout', function (e) {
      if (e.target === tagUi.target) { saveTagCursor(); hideTagsSoon(); }
    });
    ['keyup', 'click', 'select'].forEach(function (ev) {
      $('blocks').addEventListener(ev, function (e) { if (e.target === tagUi.target) saveTagCursor(); });
    });
    $('blocks').addEventListener('change', function (e) {
      var el = e.target, wrap = el.closest('.block'); if (!wrap) return;
      var s = story(), b = s.blocks.find(function (x) { return x.id === wrap.getAttribute('data-id'); });
      if (!b) return;
      if (el.hasAttribute('data-grp')) {   // tick who joins in on this line
        var id = el.getAttribute('data-grp'), w = withIds(s, b).filter(function (x) { return x !== id; });
        if (el.checked) w.push(id);
        if (w.length) b.with = w; else delete b.with;
        touch(); renderBlocks(); renderStats(); renderCast();
        var again = document.querySelector('.block[data-id="' + b.id + '"] [data-grp="' + id + '"]'); if (again) again.focus({ preventScroll: true });
        return;
      }
      if (el.getAttribute('data-f') !== 'speaker') return;
      b.speaker = el.value;
      if (b.with) { b.with = b.with.filter(function (x) { return x !== b.speaker; }); if (!b.with.length) delete b.with; }
      touch(); renderBlocks(); renderStats(); renderCast();
    });
    $('blocks').addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]'); if (!btn) return;
      blockAction(btn.closest('.block').getAttribute('data-id'), btn.getAttribute('data-act'));
    });
    document.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () { addBlock(b.getAttribute('data-add')); });
    });

    // exports
    $('dlScript').addEventListener('click', function () { YB.download(fileSlug(story()) + '-script.txt', scriptText(story())); });
    $('dlSheets').addEventListener('click', function () { YB.download(fileSlug(story()) + '-voice-sheets.txt', voiceSheets(story())); });
    $('copyScript').addEventListener('click', function () { YB.copy(scriptText(story())); });
    // Voice Studio reads this once on load and imports the story's spoken lines.
    $('sendToVoice').addEventListener('click', function () {
      YB.store.set('stories', stories);
      YB.store.set('voiceImport', { storyId: currentId, speaker: 'all' });
      location.href = 'voice.html';
    });

    // teleprompter
    $('openPrompter').addEventListener('click', openPrompter);
    $('pClose').addEventListener('click', closePrompter);
    $('pPlay').addEventListener('click', function () { pState.playing ? stopPrompter() : startPrompter(); });
    $('pScroll').addEventListener('click', function () { pState.playing ? stopPrompter() : startPrompter(); });
    $('pScroll').addEventListener('scroll', function () { if (!pState.playing) pState.pos = this.scrollTop; }, { passive: true });
    $('pSize').addEventListener('input', applySize);
    $('pMirror').addEventListener('change', function () { $('prompter').classList.toggle('mirror', this.checked); });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (!$('prompter').hidden) closePrompter();
      else if (!$('charModal').hidden) closeCharModal();
    });
  }

  function init() {
    if (!stories.length) newStory('classic', 'My first story');
    if (!story()) currentId = stories[0].id;
    bind();
    wireImport();
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
