/* Youtube Blue — on-device voices for Comic to Video (no server needed).
   Piper neural text-to-speech running in the browser:
   text → phonemes (espeak-ng, WebAssembly) → voice model (ONNX Runtime Web) → WAV.
   Each voice model downloads once (≈ 20–75 MB) and is kept in the browser's cache,
   so after the first time it works instantly and even offline.
   Open source: Piper (MIT), piper-phonemize / espeak-ng, ONNX Runtime (MIT).
   window.YBLocalVoice = { voices(lang), supports(lang), speak(text, voiceId, onProgress) → Promise<Blob> } */
(function () {
  'use strict';
  var HF = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/';
  var ORT = 'https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
  var PH = 'https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/piper_phonemize';
  var CACHE = 'yb-piper-voices-v1';

  // A few good voices per language (first = default). path is relative to HF.
  function v(id, name, path) { return { id: id, name: name, path: path }; }
  var VOICES = {
    en: [v('en_US-hfc_female-medium', 'Hannah · US female', 'en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx'),
         v('en_US-ryan-medium', 'Ryan · US male', 'en/en_US/ryan/medium/en_US-ryan-medium.onnx'),
         v('en_US-lessac-medium', 'Lessac · US storyteller', 'en/en_US/lessac/medium/en_US-lessac-medium.onnx'),
         v('en_US-kristin-medium', 'Kristin · US female', 'en/en_US/kristin/medium/en_US-kristin-medium.onnx'),
         v('en_US-joe-medium', 'Joe · US male', 'en/en_US/joe/medium/en_US-joe-medium.onnx'),
         v('en_GB-alan-medium', 'Alan · UK male', 'en/en_GB/alan/medium/en_GB-alan-medium.onnx'),
         v('en_US-amy-low', 'Amy · US female (small download)', 'en/en_US/amy/low/en_US-amy-low.onnx')],
    es: [v('es_MX-claude-high', 'Claude · Mexico', 'es/es_MX/claude/high/es_MX-claude-high.onnx'),
         v('es_ES-davefx-medium', 'Dave · Spain male', 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx'),
         v('es_ES-sharvard-medium', 'Sharvard · Spain', 'es/es_ES/sharvard/medium/es_ES-sharvard-medium.onnx'),
         v('es_MX-ald-medium', 'Ald · Mexico male', 'es/es_MX/ald/medium/es_MX-ald-medium.onnx')],
    pt: [v('pt_BR-faber-medium', 'Faber · Brazil male', 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx'),
         v('pt_BR-edresson-low', 'Edresson · Brazil male', 'pt/pt_BR/edresson/low/pt_BR-edresson-low.onnx')],
    fr: [v('fr_FR-siwis-medium', 'Siwis · female', 'fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx'),
         v('fr_FR-tom-medium', 'Tom · male', 'fr/fr_FR/tom/medium/fr_FR-tom-medium.onnx')],
    de: [v('de_DE-thorsten-medium', 'Thorsten · male', 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx'),
         v('de_DE-kerstin-low', 'Kerstin · female', 'de/de_DE/kerstin/low/de_DE-kerstin-low.onnx')],
    it: [v('it_IT-riccardo-x_low', 'Riccardo · male', 'it/it_IT/riccardo/x_low/it_IT-riccardo-x_low.onnx')],
    ru: [v('ru_RU-irina-medium', 'Irina · female', 'ru/ru_RU/irina/medium/ru_RU-irina-medium.onnx'),
         v('ru_RU-dmitri-medium', 'Dmitri · male', 'ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx')],
    ar: [v('ar_JO-kareem-medium', 'Kareem · male', 'ar/ar_JO/kareem/medium/ar_JO-kareem-medium.onnx')],
    tr: [v('tr_TR-fettah-medium', 'Fettah · male', 'tr/tr_TR/fettah/medium/tr_TR-fettah-medium.onnx'),
         v('tr_TR-dfki-medium', 'DFKI · male', 'tr/tr_TR/dfki/medium/tr_TR-dfki-medium.onnx')],
    vi: [v('vi_VN-vais1000-medium', 'Vais · female', 'vi/vi_VN/vais1000/medium/vi_VN-vais1000-medium.onnx')],
    'zh-CN': [v('zh_CN-huayan-medium', 'Huayan · female', 'zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx')]
  };
  function voices(lang) { return VOICES[lang] || []; }
  function supports(lang) { return voices(lang).length > 0; }
  function find(id) { var all = [].concat.apply([], Object.keys(VOICES).map(function (k) { return VOICES[k]; })); return all.find(function (x) { return x.id === id; }); }

  // ---------- loading ----------
  var scripts = {};
  function loadScript(src, global) {
    if (window[global]) return Promise.resolve(window[global]);
    if (scripts[src]) return scripts[src];
    scripts[src] = new Promise(function (res, rej) {
      var s = document.createElement('script'); s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = function () { window[global] ? res(window[global]) : rej(new Error('The voice engine didn\'t load.')); };
      s.onerror = function () { delete scripts[src]; rej(new Error('The voice engine couldn\'t be downloaded — check the internet connection.')); };
      document.head.appendChild(s);
    });
    return scripts[src];
  }
  function ensureOrt() {
    return loadScript(ORT + 'ort.min.js', 'ort').then(function (ort) {
      ort.env.wasm.wasmPaths = ORT;
      ort.env.wasm.numThreads = window.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
      return ort;
    });
  }
  // Downloads once, then served from the browser cache (works offline afterwards).
  function cachedBytes(url, onProgress) {
    var cacheP = window.caches ? caches.open(CACHE).catch(function () { return null; }) : Promise.resolve(null);
    return cacheP.then(function (cache) {
      return (cache ? cache.match(url) : Promise.resolve(null)).then(function (hit) {
        if (hit) return hit.arrayBuffer();
        return fetch(url).then(function (res) {
          if (!res.ok) throw new Error('The voice couldn\'t be downloaded (HTTP ' + res.status + ').');
          var total = Number(res.headers.get('content-length')) || 0;
          if (!res.body || !res.body.getReader || !onProgress) return res.arrayBuffer();
          var reader = res.body.getReader(), parts = [], got = 0;
          function pump() {
            return reader.read().then(function (r) {
              if (r.done) { var out = new Uint8Array(got), o = 0; parts.forEach(function (p) { out.set(p, o); o += p.length; }); return out.buffer; }
              parts.push(r.value); got += r.value.length; if (total) onProgress(got / total);
              return pump();
            });
          }
          return pump();
        }).then(function (buf) {
          if (cache) cache.put(url, new Response(buf.slice(0))).catch(function () { /* storage full: still works this time */ });
          return buf;
        });
      });
    });
  }
  var configs = {}, sessions = {}, order = [];
  function config(voice) {
    if (configs[voice.id]) return configs[voice.id];
    configs[voice.id] = cachedBytes(HF + voice.path + '.json').then(function (b) { return JSON.parse(new TextDecoder().decode(b)); });
    configs[voice.id].catch(function () { delete configs[voice.id]; });
    return configs[voice.id];
  }
  function session(voice, onProgress) {
    if (sessions[voice.id]) return sessions[voice.id];
    sessions[voice.id] = Promise.all([ensureOrt(), cachedBytes(HF + voice.path, onProgress)]).then(function (r) {
      return r[0].InferenceSession.create(r[1], { executionProviders: ['wasm'] });
    });
    sessions[voice.id].catch(function () { delete sessions[voice.id]; });
    order = order.filter(function (k) { return k !== voice.id; }); order.push(voice.id);
    while (order.length > 3) { var old = order.shift(); delete sessions[old]; }   // keep memory in check
    return sessions[voice.id];
  }
  function phonemes(text, espeakVoice) {
    return loadScript(PH + '.js', 'createPiperPhonemize').then(function (create) {
      return new Promise(function (res, rej) {
        var done = false;
        create({
          print: function (line) { if (done) return; try { done = true; res(JSON.parse(line).phoneme_ids); } catch (e) { rej(e); } },
          printErr: function () { /* espeak warnings */ },
          locateFile: function (f) { return f.endsWith('.wasm') ? PH + '.wasm' : f.endsWith('.data') ? PH + '.data' : f; }
        }).then(function (m) {
          m.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text: text }]), '--espeak_data', '/espeak-ng-data']);
          if (!done) setTimeout(function () { if (!done) rej(new Error('Couldn\'t read that text aloud.')); }, 4000);
        }, rej);
      });
    });
  }
  function wav(samples, rate) {
    var n = samples.length, buf = new ArrayBuffer(44 + n * 2), dv = new DataView(buf);
    function str(o, t) { for (var i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); }
    str(0, 'RIFF'); dv.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
    dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true); str(36, 'data'); dv.setUint32(40, n * 2, true);
    for (var i = 0, o = 44; i < n; i++, o += 2) { var s = Math.max(-1, Math.min(1, samples[i])); dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // text → WAV Blob in the chosen voice. onProgress(fraction) while the voice downloads (first time only).
  function speak(text, voiceId, onProgress) {
    var voice = find(voiceId); if (!voice) return Promise.reject(new Error('That voice isn\'t available on this device.'));
    text = String(text || '').trim(); if (!text) return Promise.reject(new Error('Nothing to say.'));
    return Promise.all([config(voice), session(voice, onProgress)]).then(function (r) {
      var cfg = r[0], sess = r[1], ort = window.ort;
      return phonemes(text, cfg.espeak.voice).then(function (ids) {
        // drop any sound this voice model doesn't know (instead of failing)
        var max = cfg.num_symbols || (cfg.phoneme_id_map ? Object.keys(cfg.phoneme_id_map).reduce(function (m, k) { return Math.max(m, Math.max.apply(null, cfg.phoneme_id_map[k])); }, 0) + 1 : 0);
        if (max) ids = ids.filter(function (x) { return x >= 0 && x < max; });
        if (!ids.length) throw new Error('Nothing to say.');
        var inf = cfg.inference || {};
        var feeds = {
          input: new ort.Tensor('int64', BigInt64Array.from(ids.map(function (x) { return BigInt(x); })), [1, ids.length]),
          input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
          scales: new ort.Tensor('float32', Float32Array.from([inf.noise_scale == null ? 0.667 : inf.noise_scale, inf.length_scale == null ? 1 : inf.length_scale, inf.noise_w == null ? 0.8 : inf.noise_w]), [3])
        };
        if (cfg.speaker_id_map && Object.keys(cfg.speaker_id_map).length) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(0)]), [1]);
        return sess.run(feeds).then(function (out) { return wav(out.output.data, cfg.audio.sample_rate); });
      });
    });
  }
  // Is this voice already downloaded? (shown in the menu)
  function isDownloaded(voiceId) {
    var voice = find(voiceId); if (!voice || !window.caches) return Promise.resolve(false);
    return caches.open(CACHE).then(function (c) { return c.match(HF + voice.path); }).then(function (r) { return !!r; }, function () { return false; });
  }

  window.YBLocalVoice = { voices: voices, supports: supports, speak: speak, isDownloaded: isDownloaded, find: find };
})();
