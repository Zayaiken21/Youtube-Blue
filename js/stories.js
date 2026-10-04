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
      var isN = c.id === 'narrator', count = s.blocks.filter(function (b) { return b.type === 'line' && b.speaker === c.id; }).length;
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
      '<div class="block-tools">' +
      '<button type="button" data-act="up" aria-label="Move up">↑</button>' +
      '<button type="button" data-act="down" aria-label="Move down">↓</button>' +
      '<button type="button" data-act="dup" aria-label="Duplicate">⧉</button>' +
      '<button type="button" data-act="del" aria-label="Delete">✕</button>' +
      '</div></div>' +
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
      var ls = s.blocks.filter(function (b) { return b.type === 'line' && b.speaker === c.id; });
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
    s.blocks.forEach(function (b) { if (b.speaker === id) b.speaker = 'narrator'; });
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
    else if (act === 'dup') s.blocks.splice(i + 1, 0, Object.assign({}, s.blocks[i], { id: YB.uid() }));
    else if (act === 'del') {
      if (s.blocks[i].text.trim() && !confirm('Delete this block?')) return;
      s.blocks.splice(i, 1);
    } else return;
    touch(); renderBlocks(); renderStats();
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
        var c = who(s, b.speaker);
        var tag = s.mode === 'single' && c.id !== 'narrator' ? 'NARRATOR (as ' + c.name.toUpperCase() + ', ' + c.voice.toLowerCase() + ' voice)' : c.name.toUpperCase();
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
        if (b.type === 'line' && b.speaker === c.id && b.text.trim()) { n++; lines.push(n + '. ' + (scene ? '[' + scene + '] ' : '') + b.text.trim()); }
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
      var label = s.mode === 'single' && c.id !== 'narrator' ? 'as ' + c.name + ' · ' + c.voice : c.name;
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
      stories = stories.filter(function (s) { return s.id !== currentId; });
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
    $('blocks').addEventListener('change', function (e) {
      var el = e.target, wrap = el.closest('.block'); if (!wrap || el.getAttribute('data-f') !== 'speaker') return;
      var s = story(), b = s.blocks.find(function (x) { return x.id === wrap.getAttribute('data-id'); });
      if (b) { b.speaker = el.value; wrap.style.setProperty('--c', who(s, b.speaker).color); touch(); renderStats(); renderCast(); }
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
    renderAll();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
