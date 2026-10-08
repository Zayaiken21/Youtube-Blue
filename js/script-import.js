/* Youtube Blue — import a script with several characters.

   readFile(file) -> Promise<{ text, title }>   PDF, Word (.docx / .doc), .odt, .rtf, .txt, .md, .fountain, .html
   parse(text)    -> { title, cast, items }      finds who says what

   Speaker styles it understands (mixed in one script is fine):
     ALEX: Ugh, the Wi-Fi is down!          name + colon (also **Alex:**, [Alex], Alex (whispering): …)
     00:05  BELLA: First world tragedy.     leading times / numbers are ignored
     MAX                                    screenplay: name in CAPS on its own line,
     Two minutes? That's ancient times.     the line(s) below are what they say
     Alex<TAB>Hello                         two-column tables from Word / PDF
     MOM & DAD: Happy birthday!             several people together (&, and, +, /)
     ALL: Deal!                             everyone together (ALL, EVERYONE, BOTH, TOGETHER)
   Scene headings (INT./EXT., "Scene 2:", "# Heading"), (directions), [SFX], "Music:" style
   labels and a "Characters:" list (names + roles) are recognised too.
   Pure parsing; everything runs on the device. window.YBScriptImport. */
(function () {
  'use strict';

  /* ======================= reading files ======================= */

  function ext(name) { var m = /\.([a-z0-9]+)$/i.exec(name || ''); return m ? m[1].toLowerCase() : ''; }
  function baseTitle(name) {
    return String(name || '').replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  function u8str(u8, from, to) { var s = ''; for (var i = from; i < to; i++) s += String.fromCharCode(u8[i]); return s; }

  function decodeText(buf) {
    var u8 = new Uint8Array(buf);
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try { return new TextDecoder('utf-8', { fatal: true }).decode(u8); }
    catch (e) { return new TextDecoder('windows-1252').decode(u8); }
  }

  // --- ZIP (Word .docx, .odt): read one file out of the archive ---
  function inflateRaw(data) {
    if (typeof DecompressionStream === 'undefined') return Promise.reject(new Error('This browser can\'t open Word files. Update it, or copy the text and paste it instead.'));
    return new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }
  function unzip(buf, wanted) {
    var u8 = new Uint8Array(buf), dv = new DataView(buf), i;
    for (i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) break;
    if (i < 0 || i < u8.length - 65557) return Promise.reject(new Error('This file looks damaged (not a readable document).'));
    var n = dv.getUint16(i + 10, true), off = dv.getUint32(i + 16, true);
    for (var k = 0; k < n && off + 46 <= u8.length; k++) {
      if (dv.getUint32(off, true) !== 0x02014b50) break;
      var method = dv.getUint16(off + 10, true), csize = dv.getUint32(off + 20, true);
      var nl = dv.getUint16(off + 28, true), xl = dv.getUint16(off + 30, true), cl = dv.getUint16(off + 32, true), local = dv.getUint32(off + 42, true);
      var name = new TextDecoder().decode(u8.subarray(off + 46, off + 46 + nl));
      off += 46 + nl + xl + cl;
      if (wanted.indexOf(name) === -1) continue;
      var start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true), data = u8.subarray(start, start + csize);
      if (method === 0) return Promise.resolve(data);
      if (method === 8) return inflateRaw(data);
      return Promise.reject(new Error('This document uses a compression the browser can\'t read.'));
    }
    return Promise.resolve(null);
  }
  function xmlDoc(u8) { return new DOMParser().parseFromString(new TextDecoder().decode(u8), 'application/xml'); }
  function local(el) { return el.localName || String(el.nodeName).replace(/^.*:/, ''); }

  // Word .docx: paragraphs in order; table rows become "cell<TAB>cell"; headings become "# ".
  function docxText(doc) {
    var out = [];
    function runText(node) {
      var s = '';
      (function walk(n) {
        for (var c = n.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1) continue;
          var t = local(c);
          if (t === 't') s += c.textContent;
          else if (t === 'tab') s += '\t';
          else if (t === 'br' || t === 'cr') s += '\n';
          else if (t === 'noBreakHyphen') s += '-';
          else if (t === 'delText' || t === 'instrText' || t === 'pPr' || t === 'rPr' || t === 'footnoteReference') continue;
          else walk(c);
        }
      })(node);
      return s;
    }
    function para(p) {
      var st = '', pPr = null;
      for (var c = p.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && local(c) === 'pPr') pPr = c;
      if (pPr) for (var d = pPr.firstChild; d; d = d.nextSibling) if (d.nodeType === 1 && local(d) === 'pStyle') st = d.getAttribute('w:val') || '';
      var t = runText(p);
      if (/^(heading|titre|überschrift)\s*\d|^heading|^title$/i.test(st) && t.trim()) t = (/title/i.test(st) ? '#! ' : '# ') + t.trim();
      return t;
    }
    function block(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var t = local(c);
        if (t === 'p') out.push(para(c));
        else if (t === 'tbl') table(c);
        else if (t === 'sdt' || t === 'sdtContent' || t === 'customXml' || t === 'ins' || t === 'smartTag') block(c);
      }
    }
    function table(tbl) {
      for (var r = tbl.firstChild; r; r = r.nextSibling) {
        if (r.nodeType !== 1 || local(r) !== 'tr') continue;
        var cells = [];
        for (var c = r.firstChild; c; c = c.nextSibling) {
          if (c.nodeType !== 1 || local(c) !== 'tc') continue;
          var ps = [];
          for (var p = c.firstChild; p; p = p.nextSibling) if (p.nodeType === 1 && local(p) === 'p') ps.push(para(p));
          cells.push(ps.join(' ').trim());
        }
        out.push(cells.filter(Boolean).join('\t'));
        out.push('');
      }
    }
    var body = doc.getElementsByTagName('w:body')[0] || doc.documentElement;
    block(body);
    return out.join('\n');
  }

  // OpenDocument .odt
  function odtText(doc) {
    var out = [];
    function inline(n) {
      var s = '';
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { s += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        var t = local(c);
        if (t === 's') s += ' '.repeat(Number(c.getAttribute('text:c') || 1));
        else if (t === 'tab') s += '\t';
        else if (t === 'line-break') s += '\n';
        else if (t === 'note' || t === 'annotation') continue;
        else s += inline(c);
      }
      return s;
    }
    function block(n) {
      for (var c = n.firstChild; c; c = c.nextSibling) {
        if (c.nodeType !== 1) continue;
        var t = local(c);
        if (t === 'p') out.push(inline(c));
        else if (t === 'h') out.push('# ' + inline(c).trim());
        else if (t === 'table-row') {
          var cells = [];
          for (var d = c.firstChild; d; d = d.nextSibling) if (d.nodeType === 1 && local(d) === 'table-cell') {
            var ps = []; for (var p = d.firstChild; p; p = p.nextSibling) if (p.nodeType === 1 && (local(p) === 'p' || local(p) === 'h')) ps.push(inline(p));
            cells.push(ps.join(' ').trim());
          }
          out.push(cells.filter(Boolean).join('\t')); out.push('');
        } else block(c);
      }
    }
    var body = doc.getElementsByTagName('office:text')[0] || doc.documentElement;
    block(body);
    return out.join('\n');
  }

  // Rich Text (.rtf, and many older ".doc" files are really RTF)
  var RTF_SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|object|header|headerl|headerr|headerf|footer|footerl|footerr|footerf|fldinst|themedata|colorschememapping|datastore|latentstyles|listtable|listoverridetable|rsidtbl|generator|xmlnstbl|mmathPr|filetbl|revtbl|nonshppict|shppict|bkmkstart|bkmkend|xe|tc|txe|field?inst|private|userprops|docvar|wgrffmtfilter|pgdsctbl)$/;
  var RTF_CHARS = { par: '\n', sect: '\n\n', page: '\n\n', line: '\n', tab: '\t', cell: '\t', row: '\n\n', emdash: '—', endash: '–', emspace: ' ', enspace: ' ', qmspace: ' ', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”' };
  function rtfText(s) {
    var re = /\\([a-z]{1,32})(-?\d{1,10})?[ ]?|\\'([0-9a-f]{2})|\\([^a-z])|([{}])|[\r\n]+|([^\\{}\r\n]+)/gi;
    var stack = [], ign = false, uc = 1, skip = 0, out = '', m, bytes = [], cp = new TextDecoder('windows-1252');
    function flush() { if (bytes.length) { out += cp.decode(new Uint8Array(bytes)); bytes = []; } }
    while ((m = re.exec(s))) {
      if (m[5]) { flush(); skip = 0; if (m[5] === '{') stack.push([uc, ign]); else if (stack.length) { var t = stack.pop(); uc = t[0]; ign = t[1]; } }
      else if (m[4]) { flush(); skip = 0; var ch = m[4]; if (ch === '*') ign = true; else if (!ign) { if (ch === '~') out += ' '; else if (ch === '_') out += '-'; else if ('{}\\'.indexOf(ch) !== -1) out += ch; } }
      else if (m[1]) {
        flush(); skip = 0; var w = m[1];
        if (RTF_SKIP.test(w)) ign = true;
        else if (ign) { /* inside a skipped group */ }
        else if (RTF_CHARS[w] !== undefined) out += RTF_CHARS[w];
        else if (w === 'uc') uc = Number(m[2] || 1);
        else if (w === 'u') { var c = Number(m[2]); if (c < 0) c += 65536; out += String.fromCharCode(c); skip = uc; }
      } else if (m[3]) { if (skip > 0) skip--; else if (!ign) bytes.push(parseInt(m[3], 16)); }
      else if (m[6]) {
        flush();
        var txt = m[6];
        if (skip > 0) { var cut = Math.min(skip, txt.length); txt = txt.slice(cut); skip -= cut; }
        if (!ign) out += txt;
      }
    }
    flush();
    return out;
  }

  // Old Word 97–2003 .doc (OLE compound file + piece table)
  function cfb(buf) {
    var dv = new DataView(buf), u8 = new Uint8Array(buf);
    if (dv.getUint32(0, true) !== 0xE011CFD0) throw new Error('not OLE');
    var ss = 1 << dv.getUint16(0x1E, true), mss = 1 << dv.getUint16(0x20, true);
    var dirStart = dv.getUint32(0x30, true), cutoff = dv.getUint32(0x38, true);
    var miniFatStart = dv.getUint32(0x3C, true), difatStart = dv.getUint32(0x44, true), nDifat = dv.getUint32(0x48, true);
    function off(sec) { return (sec + 1) * ss; }
    var fatSecs = [], i;
    for (i = 0; i < 109; i++) { var v = dv.getUint32(0x4C + i * 4, true); if (v < 0xFFFFFFFA) fatSecs.push(v); }
    var d = difatStart, guard = 0;
    while (nDifat-- > 0 && d < 0xFFFFFFFA && guard++ < 10000) {
      for (i = 0; i < ss / 4 - 1; i++) { var v2 = dv.getUint32(off(d) + i * 4, true); if (v2 < 0xFFFFFFFA) fatSecs.push(v2); }
      d = dv.getUint32(off(d) + ss - 4, true);
    }
    var fat = [];
    fatSecs.forEach(function (s) { for (var k = 0; k < ss / 4; k++) fat.push(off(s) + k * 4 + 4 <= u8.length ? dv.getUint32(off(s) + k * 4, true) : 0xFFFFFFFE); });
    function chain(start, size, table, secSize, read) {
      var out = new Uint8Array(size), pos = 0, s = start, g = 0;
      while (s < 0xFFFFFFFA && pos < size && g++ < 1e6) {
        var n = Math.min(secSize, size - pos); out.set(read(s, n), pos); pos += n; s = table[s];
      }
      return out;
    }
    function readSec(s, n) { return u8.subarray(off(s), off(s) + n); }
    var dirSecs = 0, s = dirStart; while (s < 0xFFFFFFFA && dirSecs < 1e5) { dirSecs++; s = fat[s]; }
    var dir = chain(dirStart, dirSecs * ss, fat, ss, readSec), ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength), entries = [];
    for (i = 0; i + 128 <= dir.length; i += 128) {
      var nl = ddv.getUint16(i + 0x40, true), nm = '';
      for (var k = 0; k < Math.max(0, nl / 2 - 1); k++) nm += String.fromCharCode(ddv.getUint16(i + k * 2, true));
      entries.push({ name: nm, type: dir[i + 0x42], start: ddv.getUint32(i + 0x74, true), size: ddv.getUint32(i + 0x78, true) });
    }
    var root = entries[0], mini = null, miniFat = null;
    function get(name) {
      var e = entries.find(function (x) { return x.name === name && x.type === 2; });
      if (!e) return null;
      if (e.size >= cutoff) return chain(e.start, e.size, fat, ss, readSec);
      if (!mini) {
        mini = chain(root.start, root.size, fat, ss, readSec);
        var mfLen = 0, q = miniFatStart; while (q < 0xFFFFFFFA && mfLen < 1e5) { mfLen++; q = fat[q]; }
        var mf = chain(miniFatStart, mfLen * ss, fat, ss, readSec), mdv = new DataView(mf.buffer, mf.byteOffset, mf.byteLength);
        miniFat = []; for (var j = 0; j + 4 <= mf.length; j += 4) miniFat.push(mdv.getUint32(j, true));
      }
      return chain(e.start, e.size, miniFat, mss, function (sec, n) { return mini.subarray(sec * mss, sec * mss + n); });
    }
    return { get: get };
  }
  function docText(buf) {
    var f = cfb(buf), wd = f.get('WordDocument');
    if (!wd) throw new Error('no WordDocument');
    var dv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    if (dv.getUint16(0, true) !== 0xA5EC) throw new Error('not Word');
    var flags = dv.getUint16(0x0A, true), table = f.get(flags & 0x0200 ? '1Table' : '0Table');
    var ccpText = dv.getInt32(0x4C, true), fcClx = dv.getUint32(0x01A2, true), lcbClx = dv.getUint32(0x01A6, true);
    var tdv = new DataView(table.buffer, table.byteOffset, table.byteLength), pos = fcClx, end = fcClx + lcbClx, text = '';
    while (pos < end && table[pos] === 1) pos += 3 + tdv.getUint16(pos + 1, true);
    if (table[pos] !== 2) throw new Error('no piece table');
    var lcb = tdv.getUint32(pos + 1, true); pos += 5;
    var n = (lcb - 4) / 12, cps = [], i;
    for (i = 0; i <= n; i++) cps.push(tdv.getUint32(pos + i * 4, true));
    var pcd = pos + (n + 1) * 4, cp1252 = new TextDecoder('windows-1252'), u16 = new TextDecoder('utf-16le');
    for (i = 0; i < n; i++) {
      if (cps[i] >= ccpText) break;
      var len = Math.min(cps[i + 1], ccpText) - cps[i], fc = tdv.getUint32(pcd + i * 8 + 2, true);
      if (fc & 0x40000000) { var o = (fc & 0x3FFFFFFF) / 2; text += cp1252.decode(wd.subarray(o, o + len)); }
      else text += u16.decode(wd.subarray(fc, fc + len * 2));
    }
    // fields: keep only what's shown ({\x13 code \x14 result \x15})
    var out = '', depth = 0, showing = [];
    for (i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '\x13') { depth++; showing.push(false); continue; }
      if (ch === '\x14') { if (depth) showing[depth - 1] = true; continue; }
      if (ch === '\x15') { if (depth) { depth--; showing.pop(); } continue; }
      if (depth && !showing[depth - 1]) continue;
      out += ch;
    }
    return out.replace(/\x07\x07/g, '\n').replace(/\x07/g, '\t').replace(/[\r\x0b\x0c]/g, '\n').replace(/[\x00-\x08\x0e-\x1f]/g, '');
  }

  // PDF: text with line breaks rebuilt from positions, and blank lines where there's a gap
  var pdfReady = null;
  function scriptBase() {
    var el = document.querySelector('script[src*="script-import.js"]');
    return el ? el.src.replace(/script-import\.js.*$/, '') : 'js/';
  }
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfReady) return pdfReady;
    pdfReady = new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = scriptBase() + 'vendor/pdfjs/pdf.min.js';
      s.onload = function () {
        if (!window.pdfjsLib) return reject(new Error('The PDF reader didn\'t load.'));
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = scriptBase() + 'vendor/pdfjs/pdf.worker.min.js';
        resolve(window.pdfjsLib);
      };
      s.onerror = function () { pdfReady = null; reject(new Error('The PDF reader couldn\'t load — check your connection and try again.')); };
      document.head.appendChild(s);
    });
    return pdfReady;
  }
  function pdfText(buf) {
    return loadPdfJs().then(function (lib) {
      return lib.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise;
    }).then(function (pdf) {
      var pages = [], chain = Promise.resolve();
      for (var p = 1; p <= pdf.numPages; p++) (function (p) {
        chain = chain.then(function () { return pdf.getPage(p); }).then(function (page) { return page.getTextContent(); }).then(function (tc) { pages.push(pdfLines(tc.items)); });
      })(p);
      return chain.then(function () {
        var text = pages.join('\n\n');
        if (text.replace(/\s/g, '').length < 20) throw new Error('This PDF is a picture (scanned), so there\'s no text to read. Copy the words from it and paste them here instead.');
        return text;
      });
    });
  }
  function pdfLines(items) {
    var rows = [];
    items.forEach(function (it) {
      if (!it.str || !it.transform) return;
      var x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || it.height || 10;
      var row = rows.find(function (r) { return Math.abs(r.y - y) < Math.max(2, h * 0.45); });
      if (!row) { row = { y: y, h: h, parts: [] }; rows.push(row); }
      row.parts.push({ x: x, w: it.width || 0, s: it.str, h: h });
    });
    rows.sort(function (a, b) { return b.y - a.y; });
    var gaps = []; for (var i = 1; i < rows.length; i++) gaps.push(rows[i - 1].y - rows[i].y);
    var sorted = gaps.slice().sort(function (a, b) { return a - b; }), typical = sorted.length ? sorted[Math.floor(sorted.length * 0.3)] : 12;
    var out = [];
    rows.forEach(function (r, i) {
      r.parts.sort(function (a, b) { return a.x - b.x; });
      var line = '', endX = null;
      r.parts.forEach(function (pt) {
        if (endX !== null) {
          var gap = pt.x - endX;
          if (gap > pt.h * 1.0) { if (!/\t$/.test(line)) line += '\t'; }                       // column gap (a table): name | line
          else if (gap > pt.h * 0.15 && !/\s$/.test(line) && !/^\s/.test(pt.s)) line += ' ';
        }
        if (/^\s+$/.test(pt.s) && pt.w > pt.h * 1.0) { if (!/\t$/.test(line)) line = line.replace(/ +$/, '') + '\t'; endX = pt.x + pt.w; return; }   // a wide blank = table column
        line += pt.s; endX = pt.x + pt.w;
      });
      if (i && gaps[i - 1] > Math.max(typical * 1.55, r.h * 1.9)) out.push('');
      out.push(line);
    });
    return out.join('\n');
  }

  function htmlText(s) {
    var doc = new DOMParser().parseFromString(s, 'text/html');
    doc.querySelectorAll('script,style,noscript,template').forEach(function (e) { e.remove(); });
    doc.querySelectorAll('br').forEach(function (e) { e.replaceWith('\n'); });
    doc.querySelectorAll('h1,h2,h3,h4').forEach(function (e) { e.prepend('# '); });
    doc.querySelectorAll('td,th').forEach(function (e) { e.append('\t'); });
    doc.querySelectorAll('p,div,li,tr,h1,h2,h3,h4,h5,h6,section,article,blockquote,pre').forEach(function (e) { e.append('\n'); });
    return (doc.body ? doc.body.textContent : '').replace(/\t\n/g, '\n');
  }

  function readFile(file) {
    var e = ext(file.name), title = baseTitle(file.name);
    if (/^(pages|key|numbers)$/.test(e)) return Promise.reject(new Error('Apple Pages files can\'t be opened in the browser. In Pages choose File → Export To → Word or PDF, then open that.'));
    if (/^(png|jpe?g|gif|webp|heic|bmp)$/.test(e)) return Promise.reject(new Error('That\'s a picture. Copy the script text and paste it here, or open the PDF / Word file it came from.'));
    if (file.size > 40 * 1024 * 1024) return Promise.reject(new Error('That file is over 40 MB — too big for a script.'));
    return file.arrayBuffer().then(function (buf) {
      var u8 = new Uint8Array(buf), head = u8str(u8, 0, Math.min(8, u8.length));
      var kind = head.indexOf('%PDF') === 0 ? 'pdf' : head.indexOf('PK') === 0 ? 'zip'
        : (u8[0] === 0xD0 && u8[1] === 0xCF && u8[2] === 0x11 && u8[3] === 0xE0) ? 'ole'
        : head.indexOf('{\\rtf') === 0 ? 'rtf' : 'text';
      if (kind === 'pdf') return pdfText(buf);
      if (kind === 'rtf') return rtfText(new TextDecoder('windows-1252').decode(u8));
      if (kind === 'ole') {
        try { var t = docText(buf); if (t.replace(/\s/g, '').length) return t; } catch (err) { /* fall through */ }
        throw new Error('This old Word file couldn\'t be read. Open it in Word and "Save As" .docx (or PDF), or copy and paste the text.');
      }
      if (kind === 'zip') {
        return unzip(buf, ['word/document.xml']).then(function (x) {
          if (x) return docxText(xmlDoc(x));
          return unzip(buf, ['content.xml']).then(function (y) {
            if (y) return odtText(xmlDoc(y));
            throw new Error('That archive isn\'t a Word or OpenDocument file.');
          });
        });
      }
      var txt = decodeText(buf);
      if (/^(html?|xhtml)$/.test(e) || /^\s*<(!doctype html|html)/i.test(txt)) return htmlText(txt);
      return txt;
    }).then(function (text) { return { text: text, title: title }; });
  }

  /* ======================= finding characters ======================= */

  var LABEL_SCENE = /^(scene|setting|location|place|chapter|act|episode|ep|part|sequence|segment|shot)$/;
  var LABEL_NOTE = /^(music|sfx|sound|sounds|sound effects?|fx|on[ -]?screen(?: text)?|text on screen|b-?roll|camera|visuals?|action|directions?|stage directions?|transition|beat|pause|note|notes|tip|tips|warning|reminder|important|ps|p\.s|todo|caption|captions|graphics?|overlay|cut to|cue|timing|duration|length|runtime|time|date|style|tone|mood|format|music cue)$/;
  var LABEL_DROP = /^(title|subtitle|written by|writer|author|by|logline|synopsis|summary|genre|audience|target|word count|words|page|pages|version|draft|copyright|source|sources|link|links|email|phone|website|url|http|https|www|theme|moral|hook|cta|description|characters?|cast|cast list|character list|cast of characters|roles|key|legend|storyboard|visual style|script)$/;
  var ALL_WORDS = /^(all|everyone|everybody|both|together|all together|all of them|all three|all four|the group|group|chorus|crowd|kids|the kids|everyone together)$/;
  // Headings that start a list of characters / voice notes ("CHARACTERS", "Voice direction", "Cast (auto-add)")
  var CASTHEAD = /^(?:the\s+)?(?:main\s+)?(?:characters?|cast|cast list|character list|cast of characters|roles|voices?|voice (?:notes|direction|guide|styles?|casting|tones?)|character (?:notes|tones?|voices?|descriptions?|guide|breakdown|list|styles?)|tones?(?: guide)?|who'?s who|performance notes|delivery(?: notes)?|vocal (?:direction|notes)|characters? (?:and|&) (?:voices?|tones?|roles?))(?:\s*[:\-–—].*)?$/i;
  var CASTWORDS = /^(?:the|main|characters?|cast|list|of|and|&|\+|\/|voices?|tones?|notes?|direction|guide|styles?|roles?|descriptions?|breakdown|casting|who'?s|who|performance|delivery|vocal|personalities|personality|vibes?)$/i;
  function castHeading(text) {
    var t = String(text || '').replace(/\([^)]*\)/g, ' ').replace(/[*_#:.\-–—]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (!t) return false;
    var w = t.split(' ');
    if (w.length <= 6 && CASTHEAD.test(t)) return true;
    // "CHARACTERS & VOICE TONES", "Cast and personalities": only cast-ish words, and one of the key ones
    return w.length <= 6 && w.every(function (x) { return CASTWORDS.test(x); }) && /\b(characters?|cast|voices?|tones?|roles?|personalit)/i.test(t);
  }
  // Words that describe how someone sounds or who they are — used to spot a list of voice notes.
  var DESC = /\b(?:tone|voice|voiced|delivery|energy|deadpan|sarcastic|dramatic|confident|calm|excited|robotic|polite|serious|nervous|confused|friendly|grumpy|cheerful|whiny|deep|high|low|slow|fast|raspy|soft|loud|outraged|exhausted|enthusiastic|passive|aggressive|monotone|main character|best friend|sidekick|villain|hero|narrator|witty|goofy|smart|funny|relatable|kind|wise|shy|bossy|sweet|sassy|bored|tired|young|old|elderly|childlike|cartoon|accent|squeaky|gruff|warm|cold|cheeky|curious|clumsy|brave|scared|anxious|optimistic|pessimistic|chaotic|clueless|sincere|dry|upbeat|chill|hyper|stern|gentle|mysterious|corporate|professional|absurd(?:ly)?)\b|\b\w{3,}(?:ly|ive|ous|ful|ic|ish|esque)\b/i;
  var PRONOUN = /\b(?:I|I'm|I'll|I've|I'd|me|my|mine|myself|we|we're|we'll|us|our|ours|you|you're|you'll|your|yours|let's)\b/i;
  function isDescription(t) {
    t = String(t || '').trim();
    var w = t.split(/\s+/).filter(Boolean).length;
    return w > 0 && w <= 14 && !/[?!]["”']?$/.test(t) && !/["“”]/.test(t) && !PRONOUN.test(t) && DESC.test(t);
  }
  var MINOR = /^(of|the|de|da|del|van|von|der|la|le|du|di|al|el|bin|and|y|mc)$/i;
  var EMOTION = [[/laugh/i, 'laugh'], [/chuckl|giggl/i, 'chuckle'], [/sigh/i, 'sigh'], [/gasp/i, 'gasp'], [/cough/i, 'cough'],
    [/clear(s|ing)? (his |her |their )?throat/i, 'clear throat'], [/sniff/i, 'sniff'], [/groan/i, 'groan'], [/shush|shh/i, 'shush']];

  function key(n) { return n.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9À-ɏ']+/g, ' ').trim(); }
  function nice(n) {
    n = n.replace(/\s+/g, ' ').trim();
    if (n.length > 1 && n === n.toUpperCase() && /[A-Z]/.test(n)) {
      n = n.toLowerCase().replace(/(^|[\s\-.'(])([a-zà-ɏ])/g, function (m, p, c) { return p + c.toUpperCase(); })
        .replace(/'S\b/g, "'s").replace(/\bMc([a-z])/g, function (m, c) { return 'Mc' + c.toUpperCase(); });
    }
    return n;
  }
  function stripName(raw) {
    return String(raw).replace(/^[\s\-–—*•>#_~]+/, '').replace(/[*_~]+/g, '').replace(/^\[(.*)\]$/, '$1').replace(/^\((.*)\)$/, '$1').trim();
  }
  // One person's name? Short, starts with a capital letter, no sentence punctuation.
  function oneName(n, capsOnly) {
    if (!n || n.length > 32) return false;
    if (!/^[A-Za-zÀ-ɏ][A-Za-z0-9À-ɏ .'’\-]*$/.test(n)) return false;
    if (/\.\s*$/.test(n) && !/^(dr|mr|mrs|ms|st|jr|sr|prof|mt)\.$/i.test(n.split(/\s+/).pop())) return false;
    var words = n.split(/\s+/);
    if (words.length > 4) return false;
    if (capsOnly && n !== n.toUpperCase()) return false;
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (!/^[A-Z0-9À-Þ]/.test(w) && !(i > 0 && MINOR.test(w))) return false;
    }
    var k = key(n);
    if (LABEL_SCENE.test(k) || LABEL_NOTE.test(k) || LABEL_DROP.test(k)) return false;
    return true;
  }
  // A speaker label: one name, several joined by & / and / + / "/", or ALL.
  function speakerLabel(raw, capsOnly) {
    var n = stripName(raw).replace(/\s*\((?:v\.?\s*o\.?|o\.?\s*s\.?|o\.?\s*c\.?|cont'?d|cont’d|continuing|off|on phone|voice ?over|into phone|pre-?lap|filtered)\)\s*/gi, ' ').trim();
    var paren = '';
    var pm = /^(.*?)\s*\(([^)]{1,40})\)\s*$/.exec(n);
    if (pm) { n = pm[1].trim(); paren = pm[2]; }
    if (!n) return null;
    var k = key(n), narrates = false;
    // "NARRATOR (Alex):" / "Narrator - Alex:" → Alex tells the story; "Alex (narrating):" → same
    var nAs = /^(?:the\s+)?narrator\s*[-–—]\s*(.+)$/i.exec(n);
    if (nAs) { n = nAs[1].trim(); k = key(n); narrates = true; }
    else if (/^(?:the )?narrator$/.test(k) && paren && oneName(paren.replace(/^as\s+/i, '').trim())) { n = paren.replace(/^as\s+/i, '').trim(); k = key(n); paren = ''; narrates = true; }
    if (paren && /narrat|storytell/i.test(paren)) { narrates = true; paren = ''; }
    if (narrates) return oneName(n, capsOnly) ? { names: [n], paren: paren, narrates: true } : null;
    if (ALL_WORDS.test(k) && (!capsOnly || n === n.toUpperCase())) return { all: true, names: [], paren: paren };
    var parts = n.split(/\s*(?:&|\+|\/|,|\band\b)\s*/i).filter(Boolean);
    if (parts.length > 1 && parts.length <= 8 && parts.every(function (p) { return oneName(p, capsOnly) && p.split(/\s+/).length <= 3; })) return { names: parts, paren: paren };
    if (oneName(n, capsOnly)) return { names: [n], paren: paren };
    return null;
  }

  function emotionTag(paren) {
    for (var i = 0; i < EMOTION.length; i++) if (EMOTION[i][0].test(paren)) return '[' + EMOTION[i][1] + ']';
    return '';
  }
  // Dialogue tidy: wrapping quotes off, *laughs* / (laughs) → [laugh], bold marks off.
  function cleanSpeech(t) {
    t = String(t).replace(/\*\*|__/g, '').trim();
    t = t.replace(/\*([^*]{1,30})\*|\(([^)]{1,30})\)/g, function (m, a, b) { var tag = emotionTag(a || b); return tag || (a ? '' : m); })   // *waves* is acting, not words
      .replace(/\s{2,}/g, ' ').trim();
    var q = /^["“](.*)["”]$/.exec(t);
    if (q && !/["“”]/.test(q[1])) t = q[1].trim();
    return t;
  }

  var TIME = /^\s*(?:\[\s*)?(?:\(\s*)?(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?(?:\s*[-–—>]+\s*(?:\d{1,2}:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)?\s*[\])]?\s*[-–—|.:]?\s*/;
  var NUM = /^\s*(?:line\s*)?\d{1,4}\s*[.)\]:-]?\s+(?=[A-Za-zÀ-ɏ*_[(])/i;

  function classify(raw) {
    var t = raw.replace(/ /g, ' ').replace(/[ ]+$/, '');
    var trimmed = t.trim();
    if (!trimmed) return { k: 'blank' };
    // timestamps / line numbers in front ("00:05 ALEX: …", "12. MAX: …")
    trimmed = trimmed.replace(TIME, '').replace(NUM, '').trim();
    if (!trimmed) return { k: 'drop' };
    var bare = trimmed.replace(/^[*_]+|[*_]+$/g, '').trim();
    if (/^\(?(continued|cont'?d\.?|more)\)?:?$/i.test(bare) || /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?\.?$/i.test(bare)) return { k: 'drop' };
    if (/^(fade (in|out|to black)|cut to|smash cut( to)?|dissolve to|match cut( to)?|the end|end( of (script|episode|scene))?|roll credits)[.:!]?$/i.test(bare)) return { k: 'drop' };
    var h = /^#!\s+(.+)$/.exec(bare); if (h) return { k: 'title', text: h[1].trim() };
    h = /^#{1,6}\s+(.+)$/.exec(bare); if (h) return { k: 'heading', text: h[1].replace(/[#*_]+/g, '').trim() };
    if (/^(INT|EXT|EST|I\/E|INT\.?\s*\/\s*EXT)[.\s]/.test(bare)) return { k: 'scene', text: bare };
    if (/^(scene|chapter|act|episode|part)\s+[\dIVXivx]+\b/i.test(bare)) return { k: 'scene', text: bare.replace(/[*_]+/g, '') };
    if (/^\[[^\]]*\]$/.test(bare) || /^\([^)]*\)$/.test(bare) || /^\*[^*]+\*$/.test(bare)) return { k: 'paren', text: bare.replace(/^[\[(*]|[\])*]$/g, '').trim() };
    // Name: text   (also "Name (whispering): text", "**Name:** text", "[Name]: text")
    var m = /^([^:：\t]{1,60}?)\s*[:：]\s*(.*)$/.exec(trimmed);
    if (m && !/^\/\//.test(m[2])) {
      var lab = stripName(m[1]).replace(/[*_]+$/, '').trim(), lk = key(lab.replace(/\s*\(.*\)\s*$/, ''));
      var rest = m[2].replace(/^(\*\*|__)\s*/, '').trim();
      if (LABEL_SCENE.test(lk)) return { k: 'scene', text: rest ? (nice(lab) + ': ' + rest) : nice(lab) };
      if (lk === 'title') return { k: 'title', text: rest };
      if (castHeading(lab)) return { k: 'castlist', text: rest };
      if (LABEL_NOTE.test(lk)) return { k: 'note', text: nice(lab) + (rest ? ': ' + rest : '') };
      if (LABEL_DROP.test(lk)) return { k: 'drop', text: rest };
      var sp = speakerLabel(m[1]);
      if (sp) return rest ? { k: 'say', sp: sp, text: rest, raw: trimmed } : { k: 'cue', sp: sp, raw: trimmed };
    }
    if (castHeading(bare)) return { k: 'castlist', text: '' };
    // Name<TAB>text (tables)
    m = /^([^\t]{1,40})\t+(.+)$/.exec(trimmed);
    if (m) { var sp2 = speakerLabel(m[1]); if (sp2) return { k: 'say', sp: sp2, text: m[2].trim(), raw: trimmed.replace(/\t+/g, ' ') }; }
    // NAME — text (caps only)
    m = /^([A-Z][A-Z0-9 .'’&+\/]{0,30}?)\s+[–—-]\s+(.+)$/.exec(trimmed);
    if (m) { var sp3 = speakerLabel(m[1], true); if (sp3) return { k: 'say', sp: sp3, text: m[2].trim(), raw: trimmed }; }
    // Screenplay cue: NAME on its own line, in capitals
    if (/[A-Z]{2}/.test(bare) || /^[A-Z]$/.test(bare)) {
      var sp4 = /^[A-Z0-9 .'’&+\/,\-()]+$/.test(bare.replace(/\((?:[^)]*)\)/g, function (x) { return x.toUpperCase(); })) ? speakerLabel(bare, true) : null;
      if (sp4) return { k: 'cue', sp: sp4, raw: trimmed, caps: true };
    }
    return { k: 'text', text: trimmed };
  }

  function parse(input) {
    var lines = String(input || '').replace(/\r\n?/g, '\n').replace(/\u2028|\u2029/g, '\n').split('\n');
    var cls = lines.map(classify);

    // Second pass: a mixed-case name alone on a line counts as a cue once that name has spoken elsewhere.
    var known = {};
    cls.forEach(function (c) { if ((c.k === 'say' || c.k === 'cue') && !c.sp.all) c.sp.names.forEach(function (n) { known[key(n)] = 1; }); });
    cls = cls.map(function (c) {
      if (c.k !== 'text') return c;
      var sp = speakerLabel(c.text);
      if (sp && !sp.all && sp.names.every(function (n) { return known[key(n)]; })) return { k: 'cue', sp: sp, raw: c.text };
      return c;
    });

    // A CAPS name only counts as a cue when their words come right under it (no empty line between).
    cls = cls.map(function (c, i) {
      if (c.k !== 'cue' || !c.caps) return c;
      var j = i + 1; while (j < cls.length && cls[j].k === 'drop') j++;
      var nx = cls[j];
      return nx && (nx.k === 'text' || nx.k === 'paren') ? c : { k: 'text', text: c.raw };
    });

    // A CAPS "name" used only once, before anyone else speaks, is a title ("THE BANANA INCIDENT"), not a character.
    var uses = {};
    cls.forEach(function (c) { if ((c.k === 'say' || c.k === 'cue') && !c.sp.all) c.sp.names.forEach(function (n) { var k = key(n); uses[k] = (uses[k] || 0) + 1; }); });
    var spokeYet = false;
    cls = cls.map(function (c) {
      if (c.k !== 'say' && c.k !== 'cue') return c;
      var solo = !c.sp.all && c.sp.names.every(function (n) { return uses[key(n)] === 1; });
      if (!spokeYet && c.caps && solo && Object.keys(uses).some(function (k) { return uses[k] > 1; })) return { k: 'text', text: c.raw };
      spokeYet = true;
      return c;
    });

    var content = cls.filter(function (c) { return c.k !== 'drop'; });
    var blanks = content.filter(function (c) { return c.k === 'blank'; }).length;
    var blankStyle = blanks > (content.length - blanks) * 0.2;   // paragraphs separated by empty lines

    var cast = {}, order = [], roles = {}, items = [], title = '', cur = null, cue = null, castMode = false, seenContent = false, castSeen = {}, narratorAs = '';
    function person(n) {
      var k = key(n);
      if (k === 'narrator' || k === 'the narrator' || k === 'narration' || k === 'storyteller' || k === 'vo' || k === 'v o') return 'narrator';
      if (!cast[k]) { cast[k] = { key: k, name: nice(n), count: 0, role: '' }; order.push(k); }
      return k;
    }
    function close() { cur = null; }
    function addLine(sp, text, raw) {
      var tag = sp.paren ? emotionTag(sp.paren) : '';
      var it = { type: 'line', narr: !!sp.narrates, all: !!sp.all, who: sp.all ? [] : sp.names.map(person), text: (tag ? tag + ' ' : '') + cleanSpeech(text), raw: raw, label: sp.all ? 'All' : sp.names.map(nice).join(' + ') };
      it.who.forEach(function (k) { if (cast[k]) cast[k].count++; });
      items.push(it); cur = it; seenContent = true;
      return it;
    }
    function ended(t) { return /[.!?…:;"”'’)\]]\s*$/.test(t); }

    for (var i = 0; i < cls.length; i++) {
      var c = cls[i];
      if (c.k === 'drop') continue;
      if (c.k === 'blank') { if (castMode && castMode !== 'start') castMode = false; close(); continue; }

      if (castMode) {   // "Characters:" list → names and roles, not lines
        var src = c.k === 'say' ? null : (c.raw || c.text || '');
        var em = c.k === 'say' ? [c.raw.slice(0, c.raw.indexOf(c.text)).replace(/[:\t\-–—\s]+$/, ''), c.text]
          : /^(.{1,40}?)\s*(?:[:\t]|\s[–—-]\s|\s*\()\s*(.*?)\)?$/.exec(src || '') ? (function (mm) { return [mm[1], mm[2]]; })(/^(.{1,40}?)\s*(?:[:\t]|\s[–—-]\s|\s*\()\s*(.*?)\)?$/.exec(src))
          : [src, ''];
        var nm = speakerLabel(em[0] || '');
        var roleWords = (em[1] || '').split(/\s+/).filter(Boolean).length;
        var nmKey = nm && !nm.all && nm.names.length === 1 ? key(nm.names[0]) : '';
        if (nmKey && !castSeen[nmKey] && roleWords <= 14 && !/[?!]["”']?$/.test(em[1] || '') && !PRONOUN.test(em[1] || '') && c.k !== 'scene' && c.k !== 'heading') {
          var pk = person(nm.names[0]), roleText = (em[1] || '').replace(/^[-–—:,\s]+/, '').replace(/[.\s]+$/, '');
          castSeen[nmKey] = 1;
          if (nm.narrates || /\bnarrat/i.test(roleText)) { if (pk !== 'narrator') narratorAs = pk; }
          if (pk !== 'narrator' && roleText) cast[pk].role = roleText.slice(0, 80);
          castMode = 'in';
          continue;
        }
        castMode = false;
      }

      if (c.k === 'castlist') { close(); castMode = 'start'; if (c.text) { var inl = c.text.split(/\s*[,;]\s*/); inl.forEach(function (x) { var s2 = speakerLabel(x); if (s2 && !s2.all && s2.names.length === 1) person(s2.names[0]); }); castMode = false; } continue; }
      if (c.k === 'title') { if (!title && c.text) title = c.text; continue; }
      if (c.k === 'heading') {
        close(); cue = null;
        if (!title && !seenContent) { title = c.text; continue; }
        if (castHeading(c.text)) { castMode = 'start'; continue; }
        if (LABEL_DROP.test(key(c.text))) continue;
        items.push({ type: 'scene', text: c.text }); seenContent = true; continue;
      }
      if (c.k === 'scene') { close(); cue = null; items.push({ type: 'scene', text: c.text }); seenContent = true; continue; }
      if (c.k === 'note') { close(); items.push({ type: 'note', text: c.text }); continue; }
      if (c.k === 'paren') {
        var tg = emotionTag(c.text);
        if (cue || (cur && cur.type === 'line' && cur.fromCue)) { if (tg) { if (cue) cue.pendingTag = tg; else cur.text += ' ' + tg; } continue; }
        close(); items.push({ type: 'note', text: c.text }); continue;
      }
      if (c.k === 'say') { close(); cue = null; addLine(c.sp, c.text, c.raw); continue; }
      if (c.k === 'cue') { close(); cue = { sp: c.sp, raw: c.raw }; continue; }
      // plain text
      var t = c.text;
      if (cue) {
        var line = addLine(cue.sp, (cue.pendingTag ? cue.pendingTag + ' ' : '') + t, cue.raw + ' ' + t);
        line.fromCue = true; cue = null; continue;
      }
      if (cur) {
        var join = blankStyle || !ended(cur.text);
        if (join) { cur.text += ' ' + (cur.type === 'line' ? cleanSpeech(t) : t); if (cur.raw) cur.raw += ' ' + t; continue; }
      }
      // title: a short first line before anything else
      if (!title && !seenContent && items.length === 0 && t.length <= 70 && t.split(/\s+/).length <= 10 && !/[.,;]$/.test(t)) { title = t.replace(/^["“]|["”]$/g, ''); continue; }
      if (!seenContent && /^(written\s+)?by\s+\S/i.test(t) && t.length < 60) continue;
      cur = { type: 'text', text: t }; items.push(cur); seenContent = true;
    }

    // Text before the first spoken line (headings, instructions) is "front matter".
    var firstLine = items.findIndex(function (it) { return it.type === 'line'; });
    items.forEach(function (it, k) { if (it.type === 'text' && firstLine !== -1 && k < firstLine) it.front = true; });
    // A quoted short line up front ("The Wi-Fi Survival Plan") is the real title.
    var quoted = items.find(function (it) { return it.front && /^["“].{2,70}["”]$/.test(it.text); });
    if (quoted) { if (title && title !== quoted.text) items.unshift({ type: 'text', text: title, front: true }); title = quoted.text.replace(/^["“]|["”]$/g, ''); items.splice(items.indexOf(quoted), 1); }

    // A run of "Name: how they sound" lines before the dialogue (no heading) is a list of voice notes, not lines.
    (function () {
      var start = items.findIndex(function (it) { return it.type === 'line'; });
      if (start === -1) return;
      var run = [], seen = {};
      for (var k = start; k < items.length; k++) {
        var it = items[k];
        if (it.type === 'text' || it.type === 'note') { if (run.length) break; continue; }
        if (it.type !== 'line' || it.all || it.who.length !== 1 || it.who[0] === 'narrator' || seen[it.who[0]] || !isDescription(it.text)) break;
        seen[it.who[0]] = 1; run.push(it);
      }
      if (run.length < 2) return;
      var later = function (w) { return items.some(function (x) { return x.type === 'line' && run.indexOf(x) === -1 && (x.all || x.who.indexOf(w) !== -1); }); };
      if (!run.every(function (it) { return later(it.who[0]); })) return;
      run.forEach(function (it) {
        var ck = it.who[0], c = cast[ck];
        if (c) { c.count--; if (!c.role) c.role = it.text.replace(/[.\s]+$/, '').slice(0, 80); if (/\bnarrat/i.test(it.text)) narratorAs = ck; }
        items.splice(items.indexOf(it), 1);
      });
    })();

    // The main character narrates when their narration lines are marked ("ALEX (narrating):", "NARRATOR (Alex):").
    items.forEach(function (it) { if (it.type === 'line' && it.narr && it.who[0] !== 'narrator') narratorAs = narratorAs || it.who[0]; });

    var castList = order.map(function (k) { return cast[k]; });
    var narratorLines = items.filter(function (it) { return it.type === 'line' && it.who.indexOf('narrator') !== -1; }).length;
    return {
      title: nice(title.replace(/\s+/g, ' ').trim()).slice(0, 120),
      cast: castList,
      narratorLines: narratorLines,
      items: items,
      lines: items.filter(function (it) { return it.type === 'line'; }).length,
      unnamed: items.filter(function (it) { return it.type === 'text'; }).length,
      narratorAs: narratorAs,
      // Only text that's labeled gets read. Text without a name is left out whenever the script has
      // named speakers; a plain story with no names at all is read by the Narrator.
      suggestOther: (castList.length || narratorLines) ? 'skip' : 'narrator'
    };
  }

  window.YBScriptImport = { readFile: readFile, parse: parse, _classify: classify, _rtf: rtfText };
})();
