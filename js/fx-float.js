/* Live effect preview that floats in the corner while you scroll through effects,
   so every effect you tap can be seen right away. Shown only while the effect list is on
   screen and the big preview isn't. ✕ hides it until the page is opened again. */
(function () {
  'use strict';
  window.YBFloat = function (opt) {
    var box = document.createElement('div'); box.className = 'yb-float'; box.hidden = true;
    box.innerHTML = '<canvas aria-label="Live preview of your effects"></canvas><span>✨ Live preview</span><button type="button" aria-label="Close the live preview">✕</button>';
    document.body.appendChild(box);
    var cv = box.querySelector('canvas'), closed = false, onList = false, mainOn = false, raf = 0, last = 0, t0 = performance.now();
    box.querySelector('button').addEventListener('click', function (e) { e.stopPropagation(); closed = true; box.hidden = true; });
    box.addEventListener('click', function () { var m = opt.main(); if (m && m.scrollIntoView) m.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    function watch(el, set) {
      if (!el || !window.IntersectionObserver) return;
      new IntersectionObserver(function (es) { set(es[0].isIntersecting); tick(); }, { threshold: 0.01 }).observe(el);
    }
    function tick() {
      var want = !closed && onList && !mainOn && !document.hidden && (!opt.ready || opt.ready());
      box.hidden = !want;
      if (want && !raf) raf = requestAnimationFrame(loop);
    }
    function loop(now) {
      raf = 0;
      if (box.hidden) return;
      if (now - last > 40) { last = now; try { opt.draw(cv, (now - t0) / 1000); } catch (e) { /* not ready yet */ } }
      raf = requestAnimationFrame(loop);
    }
    function start() { watch(opt.list(), function (v) { onList = v; }); watch(opt.main(), function (v) { mainOn = v; }); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
    document.addEventListener('visibilitychange', tick);
    return { refresh: tick };
  };
})();
