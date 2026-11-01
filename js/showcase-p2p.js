/* Photo Showcase — send projects to other people by name, phone to phone.
   No database and no keys: the pages find each other through the free PeerJS connector
   (only "who is where" goes through it); photos travel directly between the two devices.
   Sends wait in the sender's Outbox and are delivered by themselves the next time both people
   have Photo Showcase open; the other person then sees a request and taps Accept or Decline.
   Their answer comes back the same way. */
(function () {
  'use strict';
  var NS = 'ybshowcase-v1-';                     // this site's people only
  var OPTS = window.YB_PEER_OPTS || { debug: 0 };
  var peer = null, myName = '', H = null, retry = 0, slotTry = 0, closedOnPurpose = false, ready = false;

  function norm(n) { return String(n || '').trim().replace(/\s+/g, ' ').toLowerCase(); }
  function idFor(name, n) {
    var txt = 'yb-person:' + norm(name);
    return crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)).then(function (h) {
      var hex = Array.from(new Uint8Array(h)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      return NS + hex.slice(0, 28) + (n ? '-' + n : '');
    });
  }
  function ok() { return !!(window.Peer && window.crypto && crypto.subtle && window.RTCPeerConnection); }
  function status(s) { ready = s === 'ready'; if (H && H.status) H.status(s); }

  /* ---------- being reachable by your name ---------- */
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
      p.on('connection', incoming);
      p.on('disconnected', function () { ready = false; if (!p.destroyed && !closedOnPurpose) setTimeout(function () { if (!p.destroyed) p.reconnect(); }, 3000); });
      p.on('error', function (e) {
        if (e.type === 'unavailable-id' && slotTry < 3) { p.destroy(); slotTry++; open(); return; }   // the same person open on another device
        if (/network|server-error|socket-error|socket-closed/.test(e.type)) {
          status('offline'); p.destroy();
          setTimeout(function () { if (peer === p && !closedOnPurpose) open(); }, Math.min(60000, 4000 * Math.pow(2, retry++)));
        }
      });
    });
  }
  function stop() { closedOnPurpose = true; myName = ''; if (peer) { peer.destroy(); peer = null; } status('off'); }

  function incoming(c) {
    var info = null, data = null, map = {}, files = 0, got = 0;
    c.on('data', function (m) {
      if (!m || !m.t || !H) return;
      if (m.t === 'offer') {           // someone is delivering a project they sent you
        info = m;
        Promise.resolve(H.request(m)).then(function (r) { c.send({ t: r === 'have' ? 'have' : 'yes' }); if (r === 'have') setTimeout(function () { c.close(); }, 500); });
      } else if (m.t === 'meta' && info) {
        data = m.data; files = m.count || 0; if (H.progress) H.progress('Receiving "' + info.name + '" from ' + info.from + '…');
      } else if (m.t === 'file' && info) {
        Promise.resolve(H.file(m.id, new Blob([m.buf], { type: m.type || 'application/octet-stream' }))).then(function (nid) {
          map[m.id] = nid; got++;
          if (H.progress) H.progress('Receiving photo ' + got + ' of ' + files + ' from ' + info.from + '…');
          c.send({ t: 'got', id: m.id });
        }, function () { c.send({ t: 'fail', why: 'Their phone couldn\'t save a photo.' }); });
      } else if (m.t === 'end' && info) {
        Promise.resolve(H.done(info, data, map)).then(function () { c.send({ t: 'saved' }); }, function () { c.send({ t: 'fail', why: 'Their phone couldn\'t save it.' }); });
      } else if (m.t === 'receipt') {  // the answer to something you sent
        Promise.resolve(H.receipt(m)).then(function () { c.send({ t: 'ok' }); setTimeout(function () { c.close(); }, 500); });
      }
    });
  }

  /* ---------- reaching someone by name (null if they aren't open right now) ---------- */
  function reach(toName) {
    return new Promise(function (resolve, reject) {
      var own = peer && !peer.destroyed && peer.open && ready ? peer : null;
      var me = own || new window.Peer(OPTS), slot = 0, settled = false, timer = 0;
      function end(conn) {
        if (settled) return; settled = true; clearTimeout(timer); me.off('error', onErr);
        if (!conn && !own) setTimeout(function () { try { me.destroy(); } catch (e) {} }, 300);
        resolve(conn ? { conn: conn, done: function () { setTimeout(function () { try { conn.close(); } catch (e) {} if (!own) try { me.destroy(); } catch (e) {} }, 800); } } : null);
      }
      function onErr(e) {
        if (e.type === 'peer-unavailable') { if (slot < 1) { slot++; tryNext(); } else end(null); return; }
        if (!own && !settled) { settled = true; clearTimeout(timer); try { me.destroy(); } catch (x) {} var er = new Error('Couldn\'t connect — check the internet.'); er.code = 'net'; reject(er); }
      }
      me.on('error', onErr);
      function tryNext() {
        idFor(toName, slot).then(function (id) {
          if (settled) return;
          clearTimeout(timer); timer = setTimeout(function () { end(null); }, 12000);
          var c = me.connect(id, { reliable: true, serialization: 'binary' });
          c.on('open', function () { end(c); });
        });
      }
      if (own) tryNext(); else me.on('open', tryNext);
    });
  }

  // Deliver one queued project. pkg = { shareId, from, name, thumb, data, files: [{ id, blob }] }
  // Resolves 'delivered' / 'already' (they have it), or null when they aren't open right now.
  function deliver(toName, pkg, progress) {
    if (!ok()) return Promise.resolve(null);
    progress = progress || function () {};
    return reach(toName).then(function (r) {
      if (!r) return null;
      return new Promise(function (resolve, reject) {
        var c = r.conn, i = 0, total = pkg.files.length, finished = false, timer = setTimeout(function () { fin(new Error('It stopped part way — it will try again.')); }, 60000);
        function fin(err, val) { if (finished) return; finished = true; clearTimeout(timer); r.done(); if (err) reject(err); else resolve(val); }
        function bump() { clearTimeout(timer); timer = setTimeout(function () { fin(new Error('It stopped part way — it will try again.')); }, 60000); }
        c.on('close', function () { fin(new Error('The connection closed — it will try again.')); });
        c.on('data', function (m) {
          if (!m || !m.t) return; bump();
          if (m.t === 'have') return fin(null, 'already');
          if (m.t === 'fail') return fin(new Error(m.why || 'It didn\'t save on their phone.'));
          if (m.t === 'yes') { c.send({ t: 'meta', data: pkg.data, count: total }); next(); }
          if (m.t === 'got') next();
          if (m.t === 'saved') fin(null, 'delivered');
        });
        c.send({ t: 'offer', shareId: pkg.shareId, from: pkg.from, name: pkg.name, thumb: pkg.thumb || '', photos: total, sent: pkg.sent || Date.now() });
        function next() {
          if (i >= total) { progress('Finishing…'); c.send({ t: 'end' }); return; }
          var f = pkg.files[i++]; progress('Delivering photo ' + i + ' of ' + total + ' to ' + toName + '…');
          f.blob.arrayBuffer().then(function (buf) { c.send({ t: 'file', id: f.id, type: f.blob.type, buf: buf }); });
        }
      });
    });
  }
  // Tell the sender whether you accepted. Resolves true when delivered, null when they aren't open.
  function receipt(toName, msg) {
    if (!ok()) return Promise.resolve(null);
    return reach(toName).then(function (r) {
      if (!r) return null;
      return new Promise(function (resolve) {
        var t = setTimeout(function () { r.done(); resolve(null); }, 15000);
        r.conn.on('data', function (m) { if (m && m.t === 'ok') { clearTimeout(t); r.done(); resolve(true); } });
        r.conn.send(Object.assign({ t: 'receipt' }, msg));
      });
    });
  }

  window.YBP2P = { listen: listen, stop: stop, deliver: deliver, receipt: receipt, supported: ok, isReady: function () { return ready; }, idFor: idFor };
})();
