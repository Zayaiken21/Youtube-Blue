/* Youtube Blue — Prompts page.
   Each prompt lives in prompts/<slug>.txt (the text that gets copied) with a matching
   prompts/<slug>.pdf built from it by tools/build-prompt-pdfs.py.
   To add a prompt: add the .txt, rebuild the PDFs, and add an entry to PROMPTS below. */
(function () {
  'use strict';

  var CATEGORIES = [
    { id: 'all', label: 'All' },
    { id: 'stories', label: '📖 Stories' },
    { id: 'characters', label: '🎭 Characters' }
  ];

  var PROMPTS = [
    {
      slug: 'story-master-prompt', cat: 'stories', icon: '📖', title: 'Master Story Prompt', tag: 'v3 · Import-Safe',
      blurb: 'A complete, original multi-character story — hook, escalation and payoff — written in the YouTube Blue Script Format so it imports with no cleanup.',
      steps: ['Fill in the YOUR STORY box (topic, length, narration…) or leave "you choose".', 'Paste the whole prompt into your AI and send it.', 'Paste the answer into Story Studio → 📄 Import → A new story.'],
      gets: ['Title', 'Characters with roles & voice notes', 'Spoken lines only', 'Group lines & scenes', 'Narrator or main-character narration']
    },
    {
      slug: 'character-creator-prompt', cat: 'characters', icon: '🎭', title: 'Character Creator Prompt', tag: 'v1 · Import-Safe',
      blurb: 'A memorable, easy-to-voice cast with consistent looks. The CHARACTERS block imports straight into Story Studio; the Character Bible gives image prompts, catchphrases and voice settings.',
      steps: ['Fill in the YOUR CAST box.', 'Paste the whole prompt into your AI and send it.', 'Paste the answer into Story Studio → 📄 Import → Add to this story. Reuse its CHARACTERS block in the Master Story Prompt to keep the same cast.'],
      gets: ['Roles & voice direction', 'Image prompt per character', 'Expressions & catchphrases', 'Suggested Chatterbox settings', 'No dialogue (cast only)']
    }
  ];

  var cat = 'all', texts = {};
  function $(id) { return document.getElementById(id); }

  // The copyable prompt is everything after the "────" line in the .txt (the lines above it are for people).
  function load(slug) {
    if (texts[slug]) return Promise.resolve(texts[slug]);
    return fetch('prompts/' + slug + '.txt', { cache: 'no-cache' }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    }).then(function (t) {
      var parts = t.split(/\n─{10,}\n/);
      texts[slug] = (parts.length > 1 ? parts.slice(1).join('\n') : t).replace(/^\s+|\s+$/g, '') + '\n';
      return texts[slug];
    });
  }

  function renderCats() {
    $('prCats').innerHTML = CATEGORIES.map(function (c) {
      var n = c.id === 'all' ? PROMPTS.length : PROMPTS.filter(function (p) { return p.cat === c.id; }).length;
      return '<button type="button" role="tab" data-cat="' + c.id + '" class="' + (c.id === cat ? 'on' : '') + '" aria-selected="' + (c.id === cat) + '">' + c.label + ' <span class="pr-count">' + n + '</span></button>';
    }).join('');
  }

  function renderGrid() {
    var list = PROMPTS.filter(function (p) { return cat === 'all' || p.cat === cat; });
    $('prGrid').innerHTML = list.map(function (p) {
      var catLabel = (CATEGORIES.find(function (c) { return c.id === p.cat; }) || {}).label || '';
      return '<article class="card pr-card" data-slug="' + p.slug + '">' +
        '<div class="pr-top"><span class="ico-badge">' + p.icon + '</span><div><h2>' + YB.esc(p.title) + '</h2>' +
        '<span class="pr-tag">' + YB.esc(catLabel) + ' · ' + YB.esc(p.tag) + '</span></div></div>' +
        '<p class="muted">' + YB.esc(p.blurb) + '</p>' +
        '<div class="pr-gets">' + p.gets.map(function (g) { return '<span class="stat-pill">' + YB.esc(g) + '</span>'; }).join('') + '</div>' +
        '<ol class="pr-steps">' + p.steps.map(function (s) { return '<li>' + YB.esc(s) + '</li>'; }).join('') + '</ol>' +
        '<div class="row pr-actions">' +
        '<button class="btn" type="button" data-copy="' + p.slug + '">📋 Copy prompt</button>' +
        '<a class="btn btn-ghost" href="prompts/' + p.slug + '.pdf" download="YouTube-Blue-' + p.slug + '.pdf">⬇️ PDF</a>' +
        '<a class="btn btn-ghost" href="prompts/' + p.slug + '.txt" download="YouTube-Blue-' + p.slug + '.txt">⬇️ .txt</a>' +
        '<button class="btn btn-ghost" type="button" data-show="' + p.slug + '" aria-expanded="false">👁️ Show prompt</button>' +
        '</div>' +
        '<pre class="pr-pre" data-pre="' + p.slug + '" hidden></pre>' +
        '</article>';
    }).join('');
  }

  function bind() {
    $('prCats').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cat]'); if (!b) return;
      cat = b.getAttribute('data-cat'); renderCats(); renderGrid();
    });
    $('prGrid').addEventListener('click', function (e) {
      var c = e.target.closest('[data-copy]'), s = e.target.closest('[data-show]');
      if (c) {
        var slug = c.getAttribute('data-copy');
        load(slug).then(function (t) {
          YB.copy(t);
          c.textContent = '✓ Copied'; setTimeout(function () { c.textContent = '📋 Copy prompt'; }, 1800);
        }, function () { YB.toast('Couldn\'t load the prompt — check your connection, or use the PDF'); });
      }
      if (s) {
        var sl = s.getAttribute('data-show'), pre = document.querySelector('[data-pre="' + sl + '"]');
        if (!pre.hidden) { pre.hidden = true; s.textContent = '👁️ Show prompt'; s.setAttribute('aria-expanded', 'false'); return; }
        load(sl).then(function (t) { pre.textContent = t; pre.hidden = false; s.textContent = '🙈 Hide prompt'; s.setAttribute('aria-expanded', 'true'); },
          function () { YB.toast('Couldn\'t load the prompt'); });
      }
    });
    $('copyFormat').addEventListener('click', function () {
      YB.copy(document.querySelector('.pr-sample').textContent.replace(/\n\(anything after END[^\n]*\)$/, '') + '\n');
    });
  }

  function init() { renderCats(); renderGrid(); bind(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
