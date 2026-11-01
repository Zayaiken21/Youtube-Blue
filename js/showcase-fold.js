/* Photo Showcase — fold every section behind a clear title so the page isn't overwhelming.
   Tap a title to open or close it. Help text hides behind ⓘ. What's open is remembered on this device. */
(function () {
  'use strict';
  var KEY = 'scFold';
  // open the first time you visit: where you start, and the preview
  var DEFAULT_OPEN = { phCard: true, showCard: true };
  var state = (window.YB && YB.store.get(KEY, null)) || {};
  function isOpen(id) { if (window.YB_FOLD_ALL_OPEN) return true; return id in state ? !!state[id] : !!DEFAULT_OPEN[id]; }
  function save() { try { YB.store.set(KEY, state); } catch (e) {} }

  // help paragraphs → behind ⓘ (never live messages)
  var TIP_SKIP = { zipNote: 1, projNote: 1, acctNote: 1, projSaved: 1, importNote: 1, musicName: 1 };
  function markTips(card) {
    card.querySelectorAll('p.muted.small, .sc-fxsteps, .sc-hint').forEach(function (p) {
      if (TIP_SKIP[p.id] || p.closest('.sc-fold-head') || p.closest('#acctPanel, #sharePanel, #inboxBox, #setList, #slideList')) return;
      p.classList.add('sc-tip');
    });
    var tips = card.querySelectorAll('.sc-tip').length;
    return tips;
  }

  function fold(card) {
    var id = card.id; if (!id) return;
    var head = card.querySelector(':scope > .sc-projhead') || card.querySelector(':scope > h2');
    if (!head) return;
    // header row: title (tap to open/close) + ⓘ + chevron
    var bar = document.createElement('div'); bar.className = 'sc-fold-head';
    card.insertBefore(bar, head);
    bar.appendChild(head);
    var body = document.createElement('div'); body.className = 'sc-fold-body'; body.id = id + 'Body';
    while (bar.nextSibling) body.appendChild(bar.nextSibling);
    card.appendChild(body);
    var tools = document.createElement('span'); tools.className = 'sc-fold-tools';
    if (markTips(body)) {
      var info = document.createElement('button'); info.type = 'button'; info.className = 'sc-fold-info'; info.textContent = 'ⓘ';
      info.setAttribute('aria-label', 'Show help for this part'); info.setAttribute('aria-pressed', 'false');
      info.addEventListener('click', function (e) { e.stopPropagation(); var on = card.classList.toggle('sc-showtips'); info.setAttribute('aria-pressed', on); if (on) setOpen(true); });
      tools.appendChild(info);
    }
    var chev = document.createElement('button'); chev.type = 'button'; chev.className = 'sc-fold-chev';
    chev.setAttribute('aria-controls', body.id);
    tools.appendChild(chev);
    var h2 = head.matches('h2') ? head : head.querySelector('h2');
    (h2 || head).appendChild(tools);
    function setOpen(on, remember) {
      card.classList.toggle('sc-folded', !on);
      chev.setAttribute('aria-expanded', on); chev.setAttribute('aria-label', on ? 'Close this part' : 'Open this part');
      chev.textContent = on ? '▾' : '▸';
      if (remember) { state[id] = on; save(); }
    }
    card._fold = setOpen;
    setOpen(isOpen(id));
    function toggle() { setOpen(card.classList.contains('sc-folded'), true); }
    chev.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    // tapping the title opens / closes too (buttons and fields in the header keep working as before)
    bar.addEventListener('click', function (e) { if (e.target.closest('button, a, input, select, label, textarea') && !e.target.closest('.sc-fold-chev')) return; toggle(); });
    if (h2) { h2.setAttribute('role', 'button'); h2.tabIndex = 0; h2.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }); }
  }

  function openFor(el) {
    if (!el || !el.closest) return;
    var c = el.closest('.sc-folded'); if (c && c._fold) c._fold(true, true);
    for (var d = el.closest('details:not([open])'); d; d = d.parentElement && d.parentElement.closest('details:not([open])')) d.open = true;
  }

  function init() {
    var photos = document.querySelector('section[aria-labelledby="phTitle"]'); if (photos && !photos.id) photos.id = 'phCard';
    var proj = document.querySelector('.sc-projcard'); if (proj && !proj.id) proj.id = 'projCard';
    document.querySelectorAll('.cx-layout .card').forEach(fold);
    if (window.YB_FOLD_ALL_OPEN) document.querySelectorAll('.cx-layout details').forEach(function (d) { d.open = true; });
    // anything the page scrolls to or focuses opens its section first
    var siv = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function () { openFor(this); return siv.apply(this, arguments); };
    document.addEventListener('click', function (e) { if (e.target.closest('#photoGrid [data-id]')) { var ed = document.getElementById('editCard'); if (ed && ed._fold) ed._fold(true, true); } }, true);
    // the size picker's title shows the size that's chosen
    var seg = document.getElementById('formatSeg'), now = document.getElementById('formatNow');
    function fmtNow() { var b = seg && seg.querySelector('[aria-checked="true"] b'); if (now) now.textContent = b ? b.textContent : ''; }
    if (seg && window.MutationObserver) new MutationObserver(fmtNow).observe(seg, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-checked'] });
    fmtNow();
    window.YBFold = {
      open: function (id, on) { var c = document.getElementById(id); if (c && c._fold) c._fold(on !== false, true); },
      openAll: function () { document.querySelectorAll('.cx-layout .card').forEach(function (c) { if (c._fold) c._fold(true); }); },
      state: function () { var o = {}; document.querySelectorAll('.cx-layout .card').forEach(function (c) { if (c._fold) o[c.id] = !c.classList.contains('sc-folded'); }); return o; }
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
