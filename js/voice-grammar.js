/* Youtube Blue — Story grammar tidy-up for Voice Studio.
   Runs instantly on the device whenever a story is moved into Voice Studio,
   so the voice reads clean, properly punctuated sentences.

   Safe by design: it only fixes mechanics (spacing, capitals, missing
   apostrophes, end punctuation, doubled words, messy punctuation). It never
   rewrites words, never changes meaning, and keeps reaction tags like [laugh]
   exactly where they are.

   To remove this feature: delete this file and its <script> line in
   voice.html. Voice Studio checks for window.YBGrammar and works without it. */
(function () {
  'use strict';

  // Placeholder marks for [tags] while the text is tidied (built from char codes on purpose).
  var O = String.fromCharCode(0xE000), C = String.fromCharCode(0xE001);
  var TAG = '\\uE000\\d+\\uE001';                 // one protected tag, as regex source
  var TAGS = '(?:' + TAG + '\\s*)*';              // any number of them
  function re(src, flags) { return new RegExp(src, flags || ''); }

  // Missing-apostrophe words that are never real words without it.
  var CONTRACTIONS = {
    dont: "don't", doesnt: "doesn't", didnt: "didn't", cant: "can't", couldnt: "couldn't",
    wouldnt: "wouldn't", shouldnt: "shouldn't", isnt: "isn't", arent: "aren't", wasnt: "wasn't",
    werent: "weren't", havent: "haven't", hasnt: "hasn't", hadnt: "hadn't", wont: "won't",
    mustnt: "mustn't", neednt: "needn't", aint: "ain't", im: "I'm", ive: "I've",
    youre: "you're", youve: "you've", youll: "you'll", theyre: "they're", theyve: "they've",
    theyll: "they'll", weve: "we've", thats: "that's", whats: "what's", wheres: "where's",
    whos: "who's", hows: "how's", theres: "there's", heres: "here's", shes: "she's",
    hes: "he's", yall: "y'all", couldve: "could've", wouldve: "would've",
    shouldve: "should've", mightve: "might've", mustve: "must've"
  };
  // Doubled by mistake ("the the"). Words that can legitimately repeat ("that that", "had had") are left alone.
  var DOUBLES = ['the', 'a', 'an', 'to', 'and', 'of', 'is', 'in', 'it', 'on', 'for', 'with', 'was', 'my', 'your', 'i'];
  // After these, a full stop doesn't end the sentence.
  var ABBR = /\b(?:mr|mrs|ms|dr|st|jr|sr|vs|etc|e\.g|i\.e|prof|mt|no)\.$/i;
  // A sentence starting with one of these and missing an ending is a question.
  var QUESTION = /^(?:who|what|what's|where|where's|when|why|how|how's|who's|is|are|am|do|does|did|can|could|would|will|should|shall|have|has|was|were|isn't|aren't|don't|doesn't|didn't|can't|won't|wouldn't|couldn't|shouldn't)$/i;
  // Web-ish endings: "google.com" must not become "google. Com".
  var TLD = /^(?:com|net|org|io|co|tv|gov|edu|uk|us|app|dev|ly|me)\b/i;

  function keepCase(src, out) {
    if (src.length > 1 && src === src.toUpperCase()) return out.toUpperCase();
    if (src[0] === src[0].toUpperCase()) return out[0].toUpperCase() + out.slice(1);
    return out;
  }

  function fixLine(text, names) {
    var s = String(text == null ? '' : text);
    if (!s.trim()) return '';

    // Protect [tags] (anything in brackets) so nothing inside them changes.
    var tags = [];
    s = s.replace(/\[[^\]]*\]/g, function (m) { tags.push(m); return O + (tags.length - 1) + C; });

    s = s
      .replace(/[‘’ʼ]/g, "'")            // curly apostrophes → plain
      .replace(/[“”]/g, '"')
      .replace(/…/g, '...')
      .replace(/\s*--+\s*/g, ' — ')                 // -- → dash
      .replace(/[ \t ]+/g, ' ')
      .replace(/\s*\n\s*/g, ' ')
      .trim();

    // Things a voice can't say or stumbles on: emojis, markdown stars, #hashtags, "&".
    s = s
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '')
      .replace(/^\s*\*[^*]{1,40}\*\s*|\s*\*[^*]{1,40}\*\s*$/g, ' ')   // *whispers* at the start/end = stage direction
      .replace(/[*_~`]+/g, '')
      .replace(/(?:\s+#[A-Za-z]\w*)+\s*$/g, '')                    // trailing #hashtags
      .replace(/(^|\s)#(?=[A-Za-z])/g, '$1')
      .replace(/\s*&\s*/g, ' and ')
      .replace(/\bw\/\s*/gi, 'with ')
      .replace(/[ \t]+/g, ' ').trim();

    // Shouted runs ("THIS IS SO GOOD") read better as normal words; a single shouted word stays.
    s = s.replace(/\b[A-Z][A-Z']+(?:\s+[A-Z][A-Z']*)+\b/g, function (m) {
      return m.split(/\s+/).length < 2 ? m : m.toLowerCase().replace(/\bi\b/g, 'I');
    });

    // Messy punctuation.
    s = s
      .replace(/\.{4,}/g, '...')
      .replace(/(^|[^.])\.\.(?!\.)/g, '$1...')           // ".." → "..."
      .replace(/([!?])\1+/g, '$1')                       // !!! → !   ??? → ?
      .replace(/[!?]{2,}/g, function (m) { return m.indexOf('?') !== -1 ? '?!' : '!'; })
      .replace(/,{2,}/g, ',')
      .replace(/[,;:](?=[.!?])/g, '')                    // ",." → "."
      .replace(/\s+([,.;:!?])/g, '$1')                   // no space before punctuation
      .replace(re('([,;:!?])(?=[A-Za-z\\uE000])', 'g'), '$1 ')   // space after , ; : ! ?
      .replace(/([a-z]{2,})\.([A-Za-z]{2,})/g, function (m, a, b) { return TLD.test(b) ? m : a + '. ' + b; })   // "end.next" → "end. next"
      .replace(/(\.\.\.)(?=[A-Za-z])/g, '$1 ')
      .replace(re('(\\uE001)(?=[A-Za-z0-9"\'])', 'g'), '$1 ')      // "[laugh]so" → "[laugh] so"
      .replace(re('([A-Za-z0-9.,!?])(?=\\uE000)', 'g'), '$1 ');

    // Missing apostrophes.
    s = s.replace(/\b[A-Za-z]+\b/g, function (w) {
      var k = w.toLowerCase(), fix = CONTRACTIONS[k];
      if (!fix) return w;
      return (k === 'im' || k === 'ive') ? fix : keepCase(w, fix);
    });

    // "lets" meaning "let us": at a sentence start, or before go/see/get/do/…
    s = s.replace(/(^|[.!?]\s+|\uE001\s*)lets\b/gi, function (m, pre) { return pre + (/^lets/.test(m.slice(pre.length)) ? "let's" : "Let's"); })
         .replace(/\blets\s+(?=(?:go|see|get|do|make|try|be|find|have|play|eat|talk|start|just|not|all|hope|pray|keep|take|watch|wait|dance)\b)/gi, function (m) { return (m[0] === 'L' ? "Let's" : "let's") + m.slice(4); });

    // Character names from the story keep their capital letters.
    (names || []).forEach(function (n) {
      n = String(n || '').trim();
      if (!n || n === n.toLowerCase() || !/^[A-Za-z][A-Za-z' -]*$/.test(n)) return;
      s = s.replace(re('\\b' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'gi'), function (m) { return m === m.toLowerCase() ? n : m; });   // "ZAY!" shouting stays
    });

    // Lone "i" → "I" (i, i'm, i'll, i'd, i've).
    s = s.replace(re('\\bi\\b(?=$|[\\s,.!?;:\'"\\u2014\\uE000])', 'g'), 'I');

    // Doubled words.
    s = s.replace(re('\\b(' + DOUBLES.join('|') + ')\\s+\\1\\b', 'gi'), '$1');

    // Capital at the start and after each sentence end ("wait... then" keeps flowing).
    s = s.replace(re('^(' + TAGS + '["\'(]*)([a-z])'), function (m, pre, ch) { return pre + ch.toUpperCase(); });
    s = s.replace(re('([.!?]["\')]*\\s+' + TAGS + '["\'(]*)([a-z])', 'g'), function (m, pre, ch, off, all) {
      var before = all.slice(0, off + 1);
      if (ABBR.test(before) || /\.\.\.$/.test(before)) return m;
      if (/^[!?]["')]/.test(pre)) return m;                 // "Where are you going?" she asked
      return pre + ch.toUpperCase();
    });

    // Flowing speech: no stop-start breaks in the middle of a thought.
    s = s
      .replace(/\.\.\.\s*([A-Za-z][A-Za-z']*)/g, function (m, w) {      // "Well... I guess" → "Well, I guess"
        var keep = /^I('|$)/.test(w) || (w.length > 1 && w === w.toUpperCase()) ||
          (names || []).some(function (n) { return String(n).split(/\s+/)[0] === w; });
        return ', ' + (keep ? w : w.charAt(0).toLowerCase() + w.slice(1));
      })
      .replace(/\s*\u2014\s*/g, ', ')                              // dashes → a comma pause
      .replace(/\?!/g, '?')
      .replace(/,\s*,/g, ',').replace(/,\s*([.!?])/g, '$1').replace(/^\s*,\s*/, '')
      .replace(/ {2,}/g, ' ').trim();

    // End every line with punctuation so the voice lands the sentence.
    var end = re('^([\\s\\S]*?[A-Za-z0-9])(["\')]*)(\\s*' + TAGS + ')$').exec(s);
    if (end) {
      var body = end[1];
      var last = body.split(/[.!?]["')]*\s+/).pop().replace(re(TAG, 'g'), ' ').replace(/^[\s"'(]+/, '')
        .replace(/^(?:so|and|but|well|okay|ok|hey|oh|um|uh|hmm|wait|now|then|guys|man|look),?\s+/i, '');   // "So, what now" is still a question
      var mark = QUESTION.test((last.match(/^[A-Za-z']+/) || [''])[0]) ? '?' : '.';
      s = body + mark + end[2] + end[3];
    }

    s = s.replace(/ {2,}/g, ' ').trim();
    return s.replace(re('\\uE000(\\d+)\\uE001', 'g'), function (m, i) { return tags[Number(i)]; });
  }

  // Whole scripts: tidy each line on its own, keep the blank lines between them.
  function fixText(text, names) {
    return String(text == null ? '' : text).split('\n').map(function (line) { return line.trim() ? fixLine(line, names) : ''; }).join('\n');
  }

  window.YBGrammar = { fixLine: fixLine, fixText: fixText };
})();
