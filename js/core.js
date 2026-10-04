/* =========================================================
   Youtube Blue — core.js
   Shared helpers ONLY: menu, storage, toasts, downloads,
   install-to-home-screen, offline service worker.
   Page features live in their own files (home.js, design.js,
   analytics.js, stories.js) so each can be edited alone.
   ========================================================= */
(function () {
  'use strict';

  var YB = (window.YB = window.YB || {});

  /* ---------- Storage (all keys prefixed "yb:") ---------- */
  YB.store = {
    get: function (key, fallback) {
      try {
        var raw = localStorage.getItem('yb:' + key);
        return raw ? JSON.parse(raw) : fallback;
      } catch (e) { return fallback; }
    },
    set: function (key, value) {
      try { localStorage.setItem('yb:' + key, JSON.stringify(value)); return true; }
      catch (e) { YB.toast('Could not save — storage is full or blocked'); return false; }
    },
    remove: function (key) { try { localStorage.removeItem('yb:' + key); } catch (e) {} },
    keys: function () {
      var out = [];
      try { for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('yb:') === 0) out.push(k.slice(3)); } } catch (e) {}
      return out;
    }
  };

  /* ---------- Small utilities ---------- */
  YB.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };

  YB.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  YB.num = function (n, digits) {
    n = Number(n) || 0;
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return n.toLocaleString(undefined, { maximumFractionDigits: digits == null ? 0 : digits });
  };

  YB.debounce = function (fn, ms) {
    var t;
    return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms || 300); };
  };

  YB.toast = function (msg) {
    var host = document.querySelector('.toast-host');
    if (!host) { host = document.createElement('div'); host.className = 'toast-host'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    host.appendChild(el);
    setTimeout(function () { el.remove(); }, 2600);
  };

  YB.download = function (filename, data, type) {
    var blob = data instanceof Blob ? data : new Blob([data], { type: type || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  };

  YB.copy = function (text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { YB.toast('Copied to clipboard'); }, fallback);
    }
    fallback();
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); YB.toast('Copied to clipboard'); } catch (e) { YB.toast('Copy failed'); }
      ta.remove();
    }
  };

  YB.readFile = function (file, asDataURL) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      if (asDataURL) r.readAsDataURL(file); else r.readAsText(file);
    });
  };

  YB.isIOS = function () {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  };
  YB.isStandalone = function () {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  };

  /* ---------- Menu ---------- */
  function initMenu() {
    var btn = document.querySelector('.menu-btn');
    var nav = document.getElementById('nav');
    var scrim = document.querySelector('.scrim');
    var page = document.body.getAttribute('data-page');

    if (nav) {
      nav.querySelectorAll('a[data-page]').forEach(function (a) {
        if (a.getAttribute('data-page') === page) { a.classList.add('active'); a.setAttribute('aria-current', 'page'); }
      });
    }
    if (!btn || !nav) return;

    function setOpen(open) {
      nav.classList.toggle('open', open);
      if (scrim) scrim.classList.toggle('show', open);
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      document.body.classList.toggle('no-scroll', open);
    }
    btn.addEventListener('click', function () { setOpen(!nav.classList.contains('open')); });
    if (scrim) scrim.addEventListener('click', function () { setOpen(false); });
    nav.addEventListener('click', function (e) { if (e.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });
    window.addEventListener('resize', function () { if (window.innerWidth > 900) setOpen(false); });
  }

  /* ---------- Install to home screen ---------- */
  var deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    deferredPrompt = e;
    document.querySelectorAll('[data-install]').forEach(function (b) { b.hidden = false; });
  });
  window.addEventListener('appinstalled', function () {
    deferredPrompt = null;
    document.querySelectorAll('[data-install]').forEach(function (b) { b.hidden = true; });
    YB.toast('Youtube Blue installed');
  });

  YB.install = function () {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
    } else if (YB.isIOS()) {
      YB.toast('On iPhone/iPad: tap Share, then "Add to Home Screen"');
    } else {
      YB.toast('Use your browser menu → "Install app" or "Add to Home screen"');
    }
  };

  function initInstall() {
    document.querySelectorAll('[data-install]').forEach(function (b) {
      // iOS has no install prompt event, so show the button there and explain the steps.
      if (YB.isStandalone()) { b.hidden = true; return; }
      if (YB.isIOS()) b.hidden = false;
      b.addEventListener('click', YB.install);
    });
  }

  /* ---------- Offline support ---------- */
  function initServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () {});
    });
  }

  function boot() { initMenu(); initInstall(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  initServiceWorker();
})();
