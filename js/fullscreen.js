/* Youtube Blue — full-screen viewer with a big ✕ to close.
   YB.full.open({ stage: element, bar: element (optional), fit: function (w, h), onClose: function })
   moves the element(s) into a black full-screen layer (true full screen where the browser allows it,
   a full-window layer on iPhone) and puts them back exactly where they were when it closes.
   Closes with ✕, the Escape key, or leaving the browser's full screen. */
(function () {
  'use strict';
  var YB = (window.YB = window.YB || {});
  var ov = null, cur = null, spots = [];

  function build() {
    ov = document.createElement('div');
    ov.className = 'yb-full'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Full screen');
    ov.innerHTML = '<button type="button" class="yb-full-x" aria-label="Close full screen" title="Close (Esc)">✕</button><div class="yb-full-stage"></div><div class="yb-full-bar"></div>';
    ov.querySelector('.yb-full-x').addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (cur && e.key === 'Escape') close(); });
    var onFs = function () { if (cur && cur.native && !(document.fullscreenElement || document.webkitFullscreenElement)) close(); };
    document.addEventListener('fullscreenchange', onFs); document.addEventListener('webkitfullscreenchange', onFs);
    window.addEventListener('resize', function () { if (cur) fit(); });
  }
  function move(el, into) {
    var mark = document.createComment('yb-full'); el.parentNode.insertBefore(mark, el);
    spots.push({ el: el, mark: mark }); into.appendChild(el);
  }
  function fit() {
    var st = ov.querySelector('.yb-full-stage');
    if (cur.fit) cur.fit(st.clientWidth, st.clientHeight);
  }
  function open(o) {
    if (cur) close();
    if (!ov) build();
    cur = o; spots = [];
    var st = ov.querySelector('.yb-full-stage'), bar = ov.querySelector('.yb-full-bar');
    move(o.stage, st);
    if (o.bar) move(o.bar, bar);
    bar.hidden = !o.bar;
    document.body.appendChild(ov);
    document.documentElement.classList.add('yb-full-on');
    var req = ov.requestFullscreen || ov.webkitRequestFullscreen;
    if (req) { try { var r = req.call(ov); cur.native = true; if (r && r.catch) r.catch(function () { if (cur) cur.native = false; }); } catch (e) { cur.native = false; } }
    requestAnimationFrame(function () { if (cur === o) { fit(); setTimeout(function () { if (cur === o) fit(); }, 250); } });
    ov.querySelector('.yb-full-x').focus({ preventScroll: true });
  }
  function close() {
    if (!cur) return;
    var o = cur; cur = null;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      try { var ex = document.exitFullscreen || document.webkitExitFullscreen; var r = ex && ex.call(document); if (r && r.catch) r.catch(function () {}); } catch (e) { /* already out */ }
    }
    spots.forEach(function (s) { s.mark.parentNode.insertBefore(s.el, s.mark); s.mark.remove(); });
    spots = [];
    if (ov.parentNode) ov.remove();
    document.documentElement.classList.remove('yb-full-on');
    if (o.onClose) o.onClose();
  }
  YB.full = { open: open, close: close, isOpen: function () { return !!cur; } };
})();
