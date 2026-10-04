/* =========================================================
   Youtube Blue — home.js
   Controls the Home page only: workspace stats, install
   instructions, backup / restore.
   ========================================================= */
(function () {
  'use strict';
  var YB = window.YB;

  function $(id) { return document.getElementById(id); }

  function renderStats() {
    var analytics = YB.store.get('analytics', { videos: [] });
    var stories = YB.store.get('stories', []);
    var videos = analytics.videos || [];
    var views = videos.reduce(function (s, v) { return s + (Number(v.views) || 0); }, 0);
    var cast = stories.reduce(function (s, st) { return s + ((st.characters || []).length); }, 0);
    $('statVideos').textContent = YB.num(videos.length);
    $('statViews').textContent = YB.num(views);
    $('statStories').textContent = YB.num(stories.length);
    $('statCast').textContent = YB.num(cast);
  }

  function renderInstallHelp() {
    if (YB.isStandalone()) {
      $('installIOS').hidden = true;
      $('installAndroid').hidden = true;
      $('installedNote').hidden = false;
      return;
    }
    // Put the instructions for the current device first.
    if (!YB.isIOS()) {
      var ios = $('installIOS'), and = $('installAndroid');
      and.parentNode.insertBefore(and, ios);
      and.style.marginTop = '0'; ios.style.marginTop = '10px';
    }
  }

  function backupInfo() {
    var keys = YB.store.keys();
    $('backupInfo').textContent = keys.length
      ? 'Saved sections on this device: ' + keys.join(', ') + '.'
      : 'Nothing saved yet — start in any tool and it saves automatically.';
  }

  function backup() {
    var data = { app: 'youtube-blue', version: 1, exported: new Date().toISOString(), data: {} };
    YB.store.keys().forEach(function (k) { data.data[k] = YB.store.get(k, null); });
    var stamp = new Date().toISOString().slice(0, 10);
    YB.download('youtube-blue-backup-' + stamp + '.json', JSON.stringify(data, null, 2), 'application/json');
    YB.toast('Backup downloaded');
  }

  function restore(file) {
    YB.readFile(file).then(function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || parsed.app !== 'youtube-blue' || !parsed.data) throw new Error('bad file');
      if (!confirm('Restore this backup? It replaces matching sections saved on this device.')) return;
      Object.keys(parsed.data).forEach(function (k) { YB.store.set(k, parsed.data[k]); });
      renderStats(); backupInfo();
      YB.toast('Backup restored');
    }).catch(function () { YB.toast('That file is not a Youtube Blue backup'); });
  }

  function init() {
    renderStats();
    renderInstallHelp();
    backupInfo();
    $('backupBtn').addEventListener('click', backup);
    $('restoreInput').addEventListener('change', function (e) {
      if (e.target.files[0]) restore(e.target.files[0]);
      e.target.value = '';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
