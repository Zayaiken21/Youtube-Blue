/* Photo Showcase — send a project straight to another person, phone to phone.
   No database and no keys: both pages find each other through the free PeerJS connector
   (only "who is where" goes through it); the photos travel directly between the two devices.
   The person you send to needs Photo Showcase open and signed in; they tap Accept. */
(function () {
  'use strict';
  var NS = 'ybshowcase-v1-';                     // this site's people only
  var OPTS = window.YB_PEER_OPTS || { debug: 0 };
  var peer = null, myName = '', H = null, retry = 0, slotTry = 0, closedOnPurpose = false;

  function norm(n) { return String(n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function idFor(name, n) {
    var txt = 'yb-person:' + norm(name);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (h) {
      var hex = Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      return NS + hex.slice(0, 28) + (n ? '-' + n : '');
    });
  }
  function ok() { return !!(window.Peer && window.crypto && crypto.subtle && window.RTCPeerConnection); }

  /* ---------- receiving ---------- */
  function listen(name, handlers) {
    if (!ok()) return;
    if (peer && !peer.destroyed && norm(name) === norm(myName)) { H = handlers; return; }
    stop(); myName = name; H = handlers; slotTry = 0; closedOnPurpose = false; open();
  }
  function open() {
    var mine = myName;
    idFor(mine, slotTry).then(function (id) {
      if (mine !== myName || closedOnPurpose) return;
      var p = peer = new window.Peer(id, OPTS);
      p.on('open', function () { retry = 0; status('ready'); });
      p.on('connection', function (c) { incoming(c); });
      p.on('disconnected', function () { if (!p.destroyed && !closedOnPurpose) setTimeout(function () { if (!p.destroyed) p.reconnect(); }, 3000); });
      p.on('error', function (e) {
        if (e.type === 'unavailable-id' && slotTry < 3) { p.destroy(); slotTry++; open(); return; }   // same person open on another device
        if (/network|server-error|socket-error|socket-closed/.test(e.type)) {
          status('offline'); p.destroy();
          setTimeout(function () { if (peer === p && !closedOnPurpose) open(); }, Math.min(60000, 4000 * Math.pow(2, retry++)));
        }
      });
    });
  }
  function stop() { closedOnPurpose = true; myName = ''; if (peer) { peer.destroy(); peer = null; } status('off'); }
  function status(s) { if (H && H.status) H.status(s); }

  function incoming(c) {
    var info = null, data = null, map = {}, files = 0, got = 0;
    c.on('data', function (m) {
      if (!m || !m.t) return;
      if (m.t === 'offer') {
        info = m;
        Promise.resolve(H && H.offer ? H.offer(m) : false).then(function (yes) { c.send({ t: yes ? 'yes' : 'no' }); if (!yes) setTimeout(function () { c.close(); }, 500); });
      } else if (m.t === 'meta' && info) {
        data = m.data; files = m.count || 0; if (H.progress) H.progress('Receiving "' + info.name + '" from ' + info.from + '…');
      } else if (m.t === 'file' && info) {
        var blob = new Blob([m.buf], { type: m.type || 'application/octet-stream' });
        Promise.resolve(H.file(m.id, blob)).then(function (nid) {
          map[m.id] = nid; got++;
          if (H.progress) H.progress('Receiving photo ' + got + ' of ' + files + ' from ' + info.from + '…');
          c.send({ t: 'got', id: m.id });
        }, function () { c.send({ t: 'fail', why: 'Their phone couldn\'t save a photo.' }); });
      } else if (m.t === 'end' && info) {
        Promise.resolve(H.done(info, data, map)).then(function () { c.send({ t: 'saved' }); }, function () { c.send({ t: 'fail', why: 'Their phone couldn\'t save it.' }); });
      }
    });
  }

  /* ---------- sending ---------- */
  // pkg = { from, name, thumb, data, files: [{ id, blob }] }
  function send(toName, pkg, progress) {
    if (!ok()) return Promise.reject(new Error('This browser can\'t send phone to phone — use Send as a file.'));
    progress = progress || function () {};
    return new Promise(function (resolve, reject) {
      var me = new window.Peer(OPTS), done = false, conn = null, slot = 0, timer = 0;
      function finish(err, val) { if (done) return; done = true; clearTimeout(timer); setTimeout(function () { try { me.destroy(); } catch (e) {} }, 800); if (err) reject(err); else resolve(val); }
      function fail(code, text) { var e = new Error(text); e.code = code; finish(e); }
      me.on('error', function (e) {
        if (e.type === 'peer-unavailable') { if (slot < 3 && !conn_open) { slot++; tryNext(); } else if (!conn_open) fail('offline', toName + ' isn\'t on Photo Showcase right now.'); return; }
        if (!conn_open) fail('net', 'Couldn\'t connect — check the internet and try again.');
      });
      var conn_open = false;
      me.on('open', function () { progress('Looking for ' + toName + '…'); tryNext(); });
      timer = setTimeout(function () { if (!conn_open) fail('offline', toName + ' isn\'t on Photo Showcase right now.'); }, 25000);
      function tryNext() {
        idFor(toName, slot).then(function (id) {
          if (done) return;
          var c = me.connect(id, { reliable: true, serialization: 'binary' });
          c.on('open', function () { if (conn_open || done) return; conn_open = true; conn = c; clearTimeout(timer); talk(c); });
        });
      }
      function talk(c) {
        var i = 0, total = pkg.files.length;
        progress('Waiting for ' + toName + ' to tap Accept…');
        timer = setTimeout(function () { fail('timeout', toName + ' didn\'t answer.'); }, 120000);
        c.on('close', function () { if (!done) fail('closed', 'The connection closed before it finished.'); });
        c.on('data', function (m) {
          if (!m || !m.t) return;
          if (m.t === 'no') return fail('declined', toName + ' said no thanks.');
          if (m.t === 'fail') return fail('failed', m.why || 'It didn\'t save on their phone.');
          if (m.t === 'yes') { clearTimeout(timer); c.send({ t: 'meta', data: pkg.data, count: total }); next(); }
          if (m.t === 'got') next();
          if (m.t === 'saved') { progress(''); finish(null, true); }
        });
        c.send({ t: 'offer', from: pkg.from, name: pkg.name, thumb: pkg.thumb || '', photos: total });
        function next() {
          if (i >= total) { progress('Finishing…'); c.send({ t: 'end' }); return; }
          var f = pkg.files[i++]; progress('Sending photo ' + i + ' of ' + total + ' to ' + toName + '…');
          f.blob.arrayBuffer().then(function (buf) { c.send({ t: 'file', id: f.id, type: f.blob.type, buf: buf }); });
        }
      }
    });
  }

  window.YBP2P = { listen: listen, stop: stop, send: send, supported: ok, idFor: idFor };
})();
