// Publications browser: tabs, live search, first-author filter, per-year chart,
// year-grouped citation list. Renders into #pubs-root from window.PUBS.
(function () {
  "use strict";

  var root = document.getElementById("pubs-root");
  var PUBS = window.PUBS;
  if (!root || !PUBS || !PUBS.length) return;

  /* ================================================================ Config */

  var TABS = [
    { id: "papers", label: "Papers", types: ["paper", "chapter"], noun: ["paper", "papers"] },
    { id: "talks", label: "Invited talks", types: ["talk"], noun: ["invited talk", "invited talks"] },
    { id: "presentations", label: "Presentations", types: ["oral", "poster"], noun: ["presentation", "presentations"] },
    { id: "abstracts", label: "Abstracts", types: ["abstract"], noun: ["abstract", "abstracts"] },
    { id: "all", label: "All", types: null, noun: ["item", "items"] }
  ];

  // Chart / badge categories, cold (bottom of the dose ramp) to hot.
  var CATS = [
    { id: "paper", label: "Papers", iso: 6, types: ["paper", "chapter"] },
    { id: "talk", label: "Invited talks", iso: 5, types: ["talk"] },
    { id: "oral", label: "Oral", iso: 4, types: ["oral"] },
    { id: "poster", label: "Poster", iso: 3, types: ["poster"] },
    { id: "abstract", label: "Abstracts", iso: 1, types: ["abstract"] }
  ];
  var CAT_OF = { paper: "paper", chapter: "paper", talk: "talk", oral: "oral", poster: "poster", abstract: "abstract" };
  var TYPE_LABEL = { paper: "Paper", chapter: "Book chapter", talk: "Invited talk", oral: "Oral", poster: "Poster", abstract: "Abstract" };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  var COLLAPSE_OVER = 15;   // lists longer than this start collapsed
  var COLLAPSE_SHOW = 10;   // ...showing whole years until at least this many items
  var AUTHORS_COMPACT_OVER = 8;

  /* ================================================================ Utilities */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  // Length-preserving fold for search: lower case, strip diacritics, straighten quotes.
  var foldCache = {};
  function foldChar(c) {
    var hit = foldCache[c];
    if (hit !== undefined) return hit;
    var f = c.toLowerCase();
    if (f.normalize) f = f.normalize("NFD").replace(/[̀-ͯ]/g, "");
    if (/[‘’‛′]/.test(f)) f = "'";
    else if (/[“”‟″]/.test(f)) f = '"';
    else if (/[‐-―]/.test(f)) f = "-";
    if (f.length !== 1) f = c.toLowerCase().length === 1 ? c.toLowerCase() : c;
    foldCache[c] = f;
    return f;
  }
  function fold(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) out += foldChar(s.charAt(i));
    return out;
  }

  function plural(n, noun) { return n === 1 ? noun[0] : noun[1]; }

  /* ================================================================ Parser
     Every parsed field is a contiguous slice of the raw citation, so nothing
     is rewritten; we only choose how to present each slice. Anything the
     heuristics are not confident about falls back to the raw text. */

  var L = "a-zß-öø-ÿ";          // lower-case letters incl. accents
  var A = "A-Za-zÀ-ÖØ-öø-ÿ";
  var WORD = "[A-Z](?:['’][A-Z])?[" + L + "][" + A + "]*(?:-[A-Z][" + L + "]+)*";
  var SUR = "(?:(?:du|van|von|de|der|da)\\s)?" + WORD + "(?:\\s" + WORD + ")?";
  var INIT = "(?:[A-Z]{1,3}(?:[.\\-][A-Z]{1,2})*\\.?|[A-Z][a-z]\\.)(?=[\\s,.;]|$)" +
             "(?:\\s[A-Z]\\.?(?=\\s*,)|\\s[B-HJ-Z](?=\\s[A-Z][a-z]))?";

  var RE_SURNAME_INIT = new RegExp("(" + SUR + ")(?:,\\s*|\\s+)(" + INIT + ")", "y");
  var RE_INIT_SURNAME = new RegExp("[A-Z]\\.?\\s" + WORD + "(?=\\s*,|\\s)", "y");
  var RE_SURNAME_ONLY = new RegExp(SUR + "(?=\\s*,)", "y");
  var RE_ETAL = /et\.?\s?al\.?/y;
  var RE_SEP_COMMA = /\s*(?:,\s*)+/y;
  var RE_SEP_SPACE = /\s+/y;
  var ME = /Anderson\s+B\.\s?M\b\.?/;

  function matchAt(re, s, i) {
    re.lastIndex = i;
    var m = re.exec(s);
    return m && m.index === i ? m : null;
  }

  // Walk the author list from the start of the string.
  function parseAuthors(s) {
    var i = 0, list = [], prevInitFirst = false, endedWithDot = false;
    while (i < s.length) {
      var start = i, m, kind = null;
      if (list.length) {
        var sep = matchAt(RE_SEP_COMMA, s, i);
        var viaComma = !!(sep && sep[0].indexOf(",") >= 0);
        if (viaComma) i += sep[0].length;
        else if (endedWithDot && (sep = matchAt(RE_SEP_SPACE, s, i))) i += sep[0].length;
        else break;
        // After a bare space only a full "Surname I." author that is itself
        // followed by a comma can follow (guards titles like "Open RT Structures").
        if (!viaComma) {
          m = matchAt(RE_SURNAME_INIT, s, i);
          if (!m || !/^\s*,/.test(s.slice(i + m[0].length))) { i = start; break; }
          kind = "si";
        }
      }
      if (!kind) {
        if ((m = matchAt(RE_ETAL, s, i))) kind = "etal";
        else if ((m = matchAt(RE_SURNAME_INIT, s, i))) kind = "si";
        else if ((m = matchAt(RE_INIT_SURNAME, s, i)) &&
                 (prevInitFirst || /^\s*,/.test(s.slice(i + m[0].length)))) kind = "is";
        else if ((m = matchAt(RE_SURNAME_ONLY, s, i))) kind = "s";
        else { i = start; break; }
      }
      list.push(m[0]);
      i += m[0].length;
      prevInitFirst = kind === "is";
      endedWithDot = /\.$/.test(m[0]);
      if (kind === "etal") break;
    }
    return { list: list, end: list.length ? i : 0 };
  }

  var RE_DATE = /[\s,]*\(?(\d{1,2})\/(\d{4})\)?\.?\s*$/;

  // A small list of venues used only when a citation has no sentence break
  // between title and venue.
  var KNOWN_VENUES = [
    "Practical Radiation Oncology", "Advances in Radiation Oncology", "Medical Physics",
    "ASTRO Annual Conference", "AAPM Annual Conference", "Journal of Applied Clinical Medical Physics",
    "Physics in Medicine and Biology", "Frontiers in Oncology", "Cancers", "Radiology"
  ];

  function stripEnd(s) { return s.replace(/[\s.,;:]+$/, ""); }

  function splitTitleVenue(r) {
    r = r.replace(/^[\s.,;:]+/, "");
    if (!r) return null;
    var q = /^[“"]([^”"]+)[”"]\s*,?\s*(.*)$/.exec(r);
    if (q) {
      var qt = stripEnd(q[1]);
      return qt && q[2] ? { title: qt, venue: stripEnd(q[2]), quoted: true } : null;
    }
    // Sentence break: ". " before a capital, a digit, a quote, or a camel-case name like medRxiv.
    var re = /[^\s][.?!](?=\s+(?:[“"A-Z0-9]|[a-z]+[A-Z]))/g, m;
    while ((m = re.exec(r))) {
      var cut = m.index + 2;
      var title = r.slice(0, cut).replace(/\.$/, "");
      var venue = stripEnd(r.slice(cut)).replace(/^\s+/, "");
      if (title.split(/\s+/).length >= 3 && venue.length >= 3) return { title: title, venue: venue };
    }
    var plain = stripEnd(r);
    for (var k = 0; k < KNOWN_VENUES.length; k++) {
      var v = KNOWN_VENUES[k];
      if (plain.length > v.length + 12 && plain.slice(-v.length) === v && /\s/.test(plain.charAt(plain.length - v.length - 1))) {
        return { title: stripEnd(plain.slice(0, -v.length)), venue: v };
      }
    }
    return null;
  }

  function parseTalk(text) {
    var m = /^(.*?):\s*“([^”]+)”(.*?)\s*\((\d{1,2})\/(\d{4})\)\s*$/.exec(text);
    if (!m) return null;
    var extra = m[3].replace(/^[\s,]+/, "");
    return { mode: "talk", title: m[2], venue: m[1], extra: extra };
  }

  function parseChapter(text) {
    var m = /^(.+?,\s*Chapter\s+\d+):\s*(.+?)\.\s+((?:Anderson|[A-Z][a-z]+\s+[A-Z])[^]*?)\.\s+([^]*?)\s*$/.exec(text);
    if (!m) return null;
    var tail = m[4].replace(RE_DATE, "");
    var auth = parseAuthors(m[3] + ".");
    if (!auth.list.length || !ME.test(m[3])) return null;
    return {
      mode: "cite", title: m[2], authors: auth.list, authorsRaw: m[3] + ".",
      venue: m[1] + ". " + stripEnd(tail), venueRaw: true
    };
  }

  function parseCitation(text) {
    var body = text.replace(RE_DATE, "");
    var a = parseAuthors(body);
    if (!a.list.length) return null;
    var authorsRaw = body.slice(0, a.end).replace(/[\s,]+$/, "");
    // Confidence check: if he is named, he must be inside the parsed author list.
    if (ME.test(text) && !ME.test(authorsRaw)) return null;
    var tv = splitTitleVenue(body.slice(a.end));
    if (!tv) return null;
    return { mode: "cite", authors: a.list, authorsRaw: authorsRaw, title: tv.title, venue: tv.venue };
  }

  function parse(p) {
    var r = null;
    try {
      if (p.type === "talk") r = parseTalk(p.text);
      else if (p.type === "chapter") r = parseChapter(p.text);
      else r = parseCitation(p.text);
    } catch (e) { r = null; }
    if (!r) {
      var raw = p.text.replace(RE_DATE, "");
      r = { mode: "raw", raw: raw || p.text };
    }
    return r;
  }

  /* ================================================================ Data */

  var items = PUBS.map(function (p, idx) {
    var parsed = parse(p);
    return {
      idx: idx, type: p.type, cat: CAT_OF[p.type] || "abstract", year: p.year, month: p.month,
      first: !!p.first, text: p.text, parsed: parsed,
      preprint: /medrxiv/i.test(p.text),
      hay: fold(p.text + " " + p.year + " " + (TYPE_LABEL[p.type] || ""))
    };
  });

  var years = [];
  items.forEach(function (it) { if (years.indexOf(it.year) < 0) years.push(it.year); });
  years.sort(function (a, b) { return b - a; });
  var minYear = years[years.length - 1], maxYear = years[0];
  var chartYears = [];
  for (var y = minYear; y <= maxYear; y++) chartYears.push(y);

  /* ================================================================ State */

  var state = { tab: "papers", query: "", terms: [], first: false, year: null, expanded: false, openAuthors: {} };

  function tabById(id) { for (var i = 0; i < TABS.length; i++) if (TABS[i].id === id) return TABS[i]; return TABS[0]; }
  function inTab(it, tab) { return !tab.types || tab.types.indexOf(it.type) >= 0; }
  function matchesQuery(it) {
    for (var i = 0; i < state.terms.length; i++) if (it.hay.indexOf(state.terms[i]) < 0) return false;
    return true;
  }
  // Everything except the tab and year (used for tab counts and the chart).
  function baseFilter(it) { return (!state.first || it.first) && matchesQuery(it); }

  /* ================================================================ Inline rendering */

  // Escape text and wrap search hits in <mark>.
  function hl(s) {
    if (!state.terms.length || !s) return esc(s);
    var f = fold(s), ranges = [];
    state.terms.forEach(function (t) {
      var from = 0, at;
      while (t && (at = f.indexOf(t, from)) >= 0) { ranges.push([at, at + t.length]); from = at + t.length; }
    });
    if (!ranges.length) return esc(s);
    ranges.sort(function (a, b) { return a[0] - b[0]; });
    var merged = [ranges[0]];
    for (var i = 1; i < ranges.length; i++) {
      var last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
      else merged.push(ranges[i]);
    }
    var out = "", pos = 0;
    merged.forEach(function (r) {
      out += esc(s.slice(pos, r[0])) + "<mark>" + esc(s.slice(r[0], r[1])) + "</mark>";
      pos = r[1];
    });
    return out + esc(s.slice(pos));
  }

  var RE_RICH = /(Anderson\s+B\.\s?M\b\.?)|(doi:\s*(10\.\d{4,9}\/[^\s"<>]+))|(https?:\/\/[^\s"<>”]+)/g;

  // Bold his name, link DOIs and URLs, highlight search hits; everything escaped.
  function rich(s) {
    var out = "", pos = 0, m;
    RE_RICH.lastIndex = 0;
    while ((m = RE_RICH.exec(s))) {
      var whole = m[0], trail = "";
      if (m[2] || m[4]) {
        var t = /[.,;:)\]]+$/.exec(whole);
        if (t) { trail = t[0]; whole = whole.slice(0, -trail.length); }
      }
      out += hl(s.slice(pos, m.index));
      if (m[1]) out += '<strong class="pubs-me">' + hl(whole) + "</strong>";
      else if (m[2]) {
        var doi = whole.replace(/^doi:\s*/, "");
        out += '<a class="pubs-link" href="https://doi.org/' + esc(doi) + '" target="_blank" rel="noopener">' + hl(whole) + "</a>";
      } else {
        out += '<a class="pubs-link" href="' + esc(whole) + '" target="_blank" rel="noopener">' + hl(whole) + "</a>";
      }
      out += hl(trail);
      pos = m.index + m[0].length;
    }
    return out + hl(s.slice(pos));
  }

  function hasHit(s) {
    if (!state.terms.length) return false;
    var f = fold(s);
    for (var i = 0; i < state.terms.length; i++) if (f.indexOf(state.terms[i]) >= 0) return true;
    return false;
  }

  function renderAuthors(it) {
    var p = it.parsed, list = p.authors;
    var full = '<p class="pubs-authors">' + rich(p.authorsRaw) + "</p>";
    if (list.length <= AUTHORS_COMPACT_OVER || state.openAuthors[it.idx]) return full;
    var meIdx = -1;
    for (var i = 0; i < list.length; i++) if (ME.test(list[i])) { meIdx = i; break; }
    var shown = [0, 1, 2];
    if (meIdx > 2) shown.push(meIdx);
    var hidden = [];
    for (var j = 0; j < list.length; j++) if (shown.indexOf(j) < 0) hidden.push(list[j]);
    // A search hit inside a hidden name: show the whole list instead.
    if (hasHit(hidden.join(" "))) return full;
    var parts = [], prev = -1;
    shown.forEach(function (k) {
      if (k > prev + 1) parts.push('<span class="pubs-ellip" aria-hidden="true">…</span>');
      parts.push(rich(list[k].replace(/[\s,]+$/, "")));
      prev = k;
    });
    var more = list.length - shown.length;
    return '<p class="pubs-authors">' + parts.join(", ") +
      ' <button type="button" class="pubs-more-authors" data-authors="' + it.idx + '" aria-label="Show all ' + list.length + ' authors">+' + more + " more</button></p>";
  }

  function dateHTML(it) {
    var m = it.month >= 1 && it.month <= 12 ? it.month : 0;
    var dt = it.year + (m ? "-" + (m < 10 ? "0" : "") + m : "");
    var label = m ? MONTHS[m - 1] + " " + it.year : String(it.year);
    var aria = m ? MONTHS_LONG[m - 1] + " " + it.year : String(it.year);
    return '<time class="pubs-date" datetime="' + dt + '" aria-label="' + aria + '">' + label + "</time>";
  }

  function renderItem(it, tab) {
    var p = it.parsed, meta = [dateHTML(it)];
    var mixed = !tab.types || tab.types.length > 1 && tab.id !== "papers";
    if (it.type === "chapter") meta.push('<span class="pubs-badge" data-cat="paper">Book chapter</span>');
    else if (mixed) meta.push('<span class="pubs-badge" data-cat="' + it.cat + '">' + esc(TYPE_LABEL[it.type]) + "</span>");
    if (it.preprint) meta.push('<span class="pubs-badge pubs-badge-pre">medRxiv preprint</span>');
    if (it.first) meta.push('<span class="pubs-first" title="First author">First author</span>');

    var body;
    if (p.mode === "cite") {
      body = '<p class="pubs-title">' + rich(p.title) + "</p>" + renderAuthors(it) +
        '<p class="pubs-venue"><span class="pubs-venue-name">' + rich(p.venue) + "</span></p>";
    } else if (p.mode === "talk") {
      body = '<p class="pubs-title pubs-title-talk"><span class="pubs-q" aria-hidden="true">“</span>' + rich(p.title) +
        '<span class="pubs-q" aria-hidden="true">”</span></p>' +
        '<p class="pubs-venue pubs-venue-talk">' + rich(p.venue) +
        (p.extra ? ' <span class="pubs-extra">· ' + rich(p.extra) + "</span>" : "") + "</p>";
    } else {
      body = '<p class="pubs-raw">' + rich(p.raw) + "</p>";
    }
    return '<li class="pubs-item" data-cat="' + it.cat + '" data-mode="' + p.mode + '">' +
      '<div class="pubs-meta">' + meta.join("") + "</div>" +
      '<div class="pubs-body">' + body + "</div></li>";
  }

  /* ================================================================ Skeleton */

  var uid = "pubs";
  var counts = { papers: 0, firstPapers: 0, talks: 0, pres: 0 };
  items.forEach(function (it) {
    if (it.cat === "paper") { counts.papers++; if (it.first) counts.firstPapers++; }
    else if (it.cat === "talk") counts.talks++;
    else counts.pres++;
  });

  var tabsHTML = TABS.map(function (t) {
    var sel = t.id === state.tab;
    return '<button type="button" role="tab" class="pubs-tab" id="' + uid + "-tab-" + t.id + '" data-tab="' + t.id +
      '" aria-controls="' + uid + '-panel" aria-selected="' + sel + '" tabindex="' + (sel ? 0 : -1) + '">' +
      '<span class="pubs-tab-label">' + esc(t.label) + '</span> <span class="pubs-tab-n"></span></button>';
  }).join("");

  var legendHTML = CATS.map(function (c) {
    return '<li data-cat="' + c.id + '"><span class="pubs-swatch" aria-hidden="true"></span>' + esc(c.label) + "</li>";
  }).join("");

  root.innerHTML =
    '<div class="pubs">' +
      '<div class="pubs-summary" data-reveal>' +
        '<dl class="pubs-stats">' +
          '<div class="pubs-stat"><dt>Papers &amp; chapters</dt><dd>' + counts.papers + "</dd></div>" +
          '<div class="pubs-stat"><dt>First-author papers</dt><dd>' + counts.firstPapers + "</dd></div>" +
          '<div class="pubs-stat"><dt>Invited talks</dt><dd>' + counts.talks + "</dd></div>" +
          '<div class="pubs-stat"><dt>Presentations &amp; abstracts</dt><dd>' + counts.pres + "</dd></div>" +
        "</dl>" +
        '<figure class="pubs-chart">' +
          '<figcaption class="pubs-chart-cap"><span class="pubs-chart-title">Output per year</span>' +
          '<span class="pubs-chart-hint">Select a year to filter the list</span></figcaption>' +
          '<div class="pubs-cols" role="group" aria-label="Filter by year"></div>' +
          '<ul class="pubs-legend" aria-label="Chart colours">' + legendHTML + "</ul>" +
        "</figure>" +
      "</div>" +
      '<div class="pubs-controls" data-reveal>' +
        '<div class="pubs-tabs" role="tablist" aria-label="Publication type">' + tabsHTML + "</div>" +
        '<div class="pubs-tools">' +
          '<div class="pubs-search">' +
            '<label class="visually-hidden" for="' + uid + '-q">Search publications</label>' +
            '<svg class="pubs-search-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">' +
              '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
              '<circle cx="10.5" cy="10.5" r="3" fill="none" stroke="currentColor" stroke-width="1.2" opacity=".5"/>' +
              '<path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' +
            '<input class="pubs-input" id="' + uid + '-q" type="search" autocomplete="off" spellcheck="false" ' +
              'placeholder="Search titles, co-authors, journals…" aria-describedby="' + uid + '-count">' +
            '<kbd class="pubs-kbd" aria-hidden="true">/</kbd>' +
            '<button type="button" class="pubs-clear" aria-label="Clear search" hidden>' +
              '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>' +
            "</button>" +
          "</div>" +
          '<button type="button" class="pubs-toggle" aria-pressed="false">' +
            '<span class="pubs-toggle-track" aria-hidden="true"><span class="pubs-toggle-dot"></span></span>First author only</button>' +
        "</div>" +
        '<div class="pubs-status">' +
          '<p class="pubs-count" id="' + uid + '-count" role="status" aria-live="polite" aria-atomic="true"></p>' +
          '<button type="button" class="pubs-yearchip" hidden></button>' +
        "</div>" +
      "</div>" +
      '<div class="pubs-panel" id="' + uid + '-panel" role="tabpanel" aria-labelledby="' + uid + '-tab-' + state.tab + '" data-reveal>' +
        '<div class="pubs-list"></div>' +
        '<div class="pubs-foot"></div>' +
      "</div>" +
    "</div>";

  var $ = function (sel) { return root.querySelector(sel); };
  var elTabs = Array.prototype.slice.call(root.querySelectorAll(".pubs-tab"));
  var elCols = $(".pubs-cols");
  var elInput = $(".pubs-input");
  var elClear = $(".pubs-clear");
  var elToggle = $(".pubs-toggle");
  var elCount = $(".pubs-count");
  var elYearChip = $(".pubs-yearchip");
  var elPanel = $(".pubs-panel");
  var elList = $(".pubs-list");
  var elFoot = $(".pubs-foot");
  var elLegend = $(".pubs-legend");

  /* ================================================================ Render */

  function renderTabs() {
    elTabs.forEach(function (b) {
      var t = tabById(b.getAttribute("data-tab"));
      var n = 0;
      items.forEach(function (it) { if (inTab(it, t) && baseFilter(it) && (!state.year || it.year === state.year)) n++; });
      var sel = t.id === state.tab;
      b.setAttribute("aria-selected", sel ? "true" : "false");
      b.tabIndex = sel ? 0 : -1;
      b.querySelector(".pubs-tab-n").textContent = n;
      b.classList.toggle("is-empty", n === 0);
    });
    elPanel.setAttribute("aria-labelledby", uid + "-tab-" + state.tab);
  }

  function renderChart() {
    var tab = tabById(state.tab);
    var per = {}, max = 1;
    chartYears.forEach(function (y) { per[y] = { total: 0, cats: {} }; });
    items.forEach(function (it) {
      if (!baseFilter(it)) return;
      var b = per[it.year];
      b.total++;
      b.cats[it.cat] = (b.cats[it.cat] || 0) + 1;
    });
    // Fixed scale (all items) so bars don't jump around while typing.
    var allPer = {};
    items.forEach(function (it) { allPer[it.year] = (allPer[it.year] || 0) + 1; });
    Object.keys(allPer).forEach(function (k) { max = Math.max(max, allPer[k]); });

    elCols.innerHTML = chartYears.map(function (y) {
      var b = per[y], segs = "", desc = [];
      CATS.forEach(function (c) {
        var n = b.cats[c.id] || 0;
        if (!n) return;
        var active = !tab.types || c.types.some(function (t) { return tab.types.indexOf(t) >= 0; });
        segs += '<span class="pubs-seg' + (active ? "" : " is-dim") + '" data-cat="' + c.id + '" style="height:' + (n / max * 100).toFixed(2) + '%"></span>';
        desc.push(n + " " + c.label.toLowerCase());
      });
      var pressed = state.year === y;
      var label = y + ": " + (b.total ? desc.join(", ") : "nothing") + (b.total ? (pressed ? ". Selected; press to show all years" : ". Show only " + y) : "");
      return '<button type="button" class="pubs-col' + (pressed ? " is-on" : "") + (state.year && !pressed ? " is-off" : "") + '" data-year="' + y + '"' +
        (b.total ? "" : " disabled") + ' aria-pressed="' + pressed + '" aria-label="' + esc(label) + '">' +
        '<span class="pubs-col-n" aria-hidden="true">' + (b.total || "") + "</span>" +
        '<span class="pubs-col-bar" aria-hidden="true">' + segs + "</span>" +
        '<span class="pubs-col-y" aria-hidden="true">’' + String(y).slice(2) + "</span></button>";
    }).join("");

    Array.prototype.forEach.call(elLegend.children, function (li) {
      var c = li.getAttribute("data-cat"), cat;
      for (var i = 0; i < CATS.length; i++) if (CATS[i].id === c) cat = CATS[i];
      var active = !tab.types || cat.types.some(function (t) { return tab.types.indexOf(t) >= 0; });
      li.classList.toggle("is-dim", !active);
    });
  }

  function emptyHTML(tab) {
    var q = state.query.trim();
    var why = q ? "Nothing in " + tab.noun[1] + " matches “" + esc(q) + "”" : "Nothing to show here";
    var extra = [];
    if (state.first) extra.push(tab.id === "talks" ? "Invited talks aren’t listed with authors, so the first-author filter hides them all." : "The first-author filter is on.");
    if (state.year) extra.push("Only " + state.year + " is selected.");
    var actions = [];
    var allN = 0;
    items.forEach(function (it) { if (baseFilter(it) && (!state.year || it.year === state.year)) allN++; });
    if (tab.id !== "all" && allN) actions.push('<button type="button" class="btn" data-act="all">Search all types (' + allN + ")</button>");
    actions.push('<button type="button" class="btn" data-act="reset">Clear filters</button>');
    return '<div class="pubs-empty">' +
      '<svg class="pubs-empty-art" viewBox="0 0 120 80" aria-hidden="true" focusable="false">' +
        '<path d="M14 44c4-22 30-34 52-30s42 18 38 36-28 26-52 22S10 64 14 44z" data-iso="1"/>' +
        '<path d="M28 44c3-14 20-22 36-19s27 12 24 24-19 17-35 14-28-7-25-19z" data-iso="3"/>' +
        '<path d="M42 44c2-7 11-11 20-10s14 7 12 13-10 9-18 7-16-4-14-10z" data-iso="5"/>' +
        '<circle cx="58" cy="43" r="2.4" data-iso="6"/></svg>' +
      '<p class="pubs-empty-title">' + why + ".</p>" +
      (extra.length ? '<p class="pubs-empty-sub">' + extra.join(" ") + "</p>" : "") +
      '<div class="pubs-empty-actions">' + actions.join("") + "</div></div>";
  }

  var lastShownYears = [];

  function renderList() {
    var tab = tabById(state.tab);
    var res = items.filter(function (it) {
      return inTab(it, tab) && baseFilter(it) && (!state.year || it.year === state.year);
    });

    // Count / live status.
    var totalInTab = items.filter(function (it) { return inTab(it, tab); }).length;
    var filtered = state.terms.length || state.first || state.year;
    var msg;
    if (!filtered) msg = "<strong>" + res.length + "</strong> " + plural(res.length, tab.noun);
    else {
      msg = "<strong>" + res.length + "</strong> of " + totalInTab + " " + plural(totalInTab, tab.noun);
      var bits = [];
      if (state.terms.length) bits.push("matching “" + esc(state.query.trim()) + "”");
      if (state.first) bits.push("as first author");
      if (state.year) bits.push("in " + state.year);
      msg += " " + bits.join(", ");
    }
    elCount.innerHTML = msg;

    elYearChip.hidden = !state.year;
    if (state.year) elYearChip.innerHTML = '<span class="mono">' + state.year + '</span><span aria-hidden="true">×</span><span class="visually-hidden">Show all years</span>';

    if (!res.length) {
      elList.innerHTML = emptyHTML(tab);
      elFoot.innerHTML = "";
      lastShownYears = [];
      return;
    }

    // Group by year (data is newest first already; sort defensively).
    res.sort(function (a, b) { return b.year - a.year || b.month - a.month || a.idx - b.idx; });
    var groups = [], cur = null;
    res.forEach(function (it) {
      if (!cur || cur.year !== it.year) { cur = { year: it.year, items: [] }; groups.push(cur); }
      cur.items.push(it);
    });

    var collapsible = !filtered && res.length > COLLAPSE_OVER;
    var showGroups = groups;
    if (collapsible && !state.expanded) {
      var n = 0, k = 0;
      while (k < groups.length && n < COLLAPSE_SHOW) { n += groups[k].items.length; k++; }
      if (k < groups.length) showGroups = groups.slice(0, k);
    }

    elList.innerHTML = showGroups.map(function (g) {
      var ys = String(g.year);
      return '<section class="pubs-year" aria-labelledby="' + uid + "-y" + g.year + '">' +
        '<div class="pubs-year-mark"><h3 class="pubs-year-n" id="' + uid + "-y" + g.year + '" tabindex="-1">' +
          '<span class="pubs-year-c">' + ys.slice(0, 2) + "</span>" + ys.slice(2) + "</h3>" +
          '<span class="pubs-year-count">' + g.items.length + " " + plural(g.items.length, tab.noun) + "</span></div>" +
        '<ol class="pubs-items" reversed>' + g.items.map(function (it) { return renderItem(it, tab); }).join("") + "</ol></section>";
    }).join("");

    var hiddenGroups = groups.slice(showGroups.length);
    if (hiddenGroups.length) {
      var hiddenN = hiddenGroups.reduce(function (s, g) { return s + g.items.length; }, 0);
      var span = hiddenGroups[hiddenGroups.length - 1].year + "–" + hiddenGroups[0].year;
      elFoot.innerHTML = '<button type="button" class="btn pubs-showall" data-act="expand" aria-controls="' + uid + '-panel">' +
        "Show all " + res.length + " " + plural(res.length, tab.noun) +
        ' <span class="pubs-showall-sub mono">+' + hiddenN + " from " + span + "</span></button>";
    } else if (collapsible && state.expanded) {
      elFoot.innerHTML = '<button type="button" class="btn pubs-showall" data-act="collapse" aria-controls="' + uid + '-panel">Show fewer</button>';
    } else {
      elFoot.innerHTML = "";
    }
    lastShownYears = showGroups.map(function (g) { return g.year; });
  }

  function render() {
    renderTabs();
    renderChart();
    renderList();
  }

  /* ================================================================ Events */

  function selectTab(id, focus) {
    if (state.tab !== id) { state.tab = id; state.expanded = false; }
    render();
    var b = root.querySelector('.pubs-tab[data-tab="' + id + '"]');
    if (!b) return;
    if (focus) b.focus({ preventScroll: true });
    // On narrow screens the tab strip scrolls sideways: keep the selected tab in view.
    var strip = b.parentNode;
    if (strip.scrollWidth > strip.clientWidth) {
      var l = b.offsetLeft - strip.offsetLeft, r = l + b.offsetWidth;
      if (l < strip.scrollLeft + 16) strip.scrollLeft = l - 16;
      else if (r > strip.scrollLeft + strip.clientWidth - 16) strip.scrollLeft = r - strip.clientWidth + 16;
    }
  }

  elTabs.forEach(function (b) {
    b.addEventListener("click", function () { selectTab(b.getAttribute("data-tab")); });
    b.addEventListener("keydown", function (e) {
      var i = elTabs.indexOf(b), next = null;
      if (e.key === "ArrowRight" || e.key === "Right") next = (i + 1) % elTabs.length;
      else if (e.key === "ArrowLeft" || e.key === "Left") next = (i - 1 + elTabs.length) % elTabs.length;
      else if (e.key === "Home") next = 0;
      else if (e.key === "End") next = elTabs.length - 1;
      if (next === null) return;
      e.preventDefault();
      selectTab(elTabs[next].getAttribute("data-tab"), true);
    });
  });

  var timer = null;
  function applyQuery() {
    state.query = elInput.value;
    var terms = fold(state.query).split(/\s+/).filter(Boolean);
    state.terms = terms;
    elClear.hidden = !state.query;
    root.classList.toggle("pubs-has-query", !!state.query);
    render();
  }
  elInput.addEventListener("input", function () {
    elClear.hidden = !elInput.value;
    clearTimeout(timer);
    timer = setTimeout(applyQuery, 180);
  });
  elInput.addEventListener("keydown", function (e) {
    if ((e.key === "Escape" || e.key === "Esc") && elInput.value) {
      e.preventDefault();
      e.stopPropagation();
      elInput.value = "";
      clearTimeout(timer);
      applyQuery();
    } else if (e.key === "Enter") {
      clearTimeout(timer);
      applyQuery();
    }
  });
  elClear.addEventListener("click", function () {
    elInput.value = "";
    clearTimeout(timer);
    applyQuery();
    elInput.focus();
  });

  elToggle.addEventListener("click", function () {
    state.first = !state.first;
    elToggle.setAttribute("aria-pressed", state.first ? "true" : "false");
    render();
  });

  elCols.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest(".pubs-col");
    if (!b || b.disabled) return;
    var y = +b.getAttribute("data-year");
    state.year = state.year === y ? null : y;
    render();
    var again = elCols.querySelector('.pubs-col[data-year="' + y + '"]');
    if (again) again.focus();
  });

  elYearChip.addEventListener("click", function () {
    state.year = null;
    render();
    elInput.focus();
  });

  root.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-act], [data-authors]");
    if (!t || !root.contains(t)) return;
    if (t.hasAttribute("data-authors")) {
      var idx = +t.getAttribute("data-authors");
      state.openAuthors[idx] = true;
      var p = t.parentNode;
      var it = items[idx];
      var tmp = document.createElement("div");
      tmp.innerHTML = renderAuthors(it);
      var fresh = tmp.firstChild;
      fresh.setAttribute("tabindex", "-1");
      p.parentNode.replaceChild(fresh, p);
      fresh.focus({ preventScroll: true });
      return;
    }
    var act = t.getAttribute("data-act");
    if (act === "expand") {
      var before = lastShownYears.slice();
      state.expanded = true;
      renderList();
      var nextYear = null;
      for (var i = 0; i < lastShownYears.length; i++) if (before.indexOf(lastShownYears[i]) < 0) { nextYear = lastShownYears[i]; break; }
      var h = nextYear && document.getElementById(uid + "-y" + nextYear);
      if (h) h.focus({ preventScroll: true });
    } else if (act === "collapse") {
      state.expanded = false;
      renderList();
      var top = root.querySelector(".pubs-controls");
      if (top) top.scrollIntoView({ block: "start" });
      var btn = elFoot.querySelector("button");
      if (btn) btn.focus({ preventScroll: true });
    } else if (act === "all") {
      selectTab("all", true);
    } else if (act === "reset") {
      elInput.value = "";
      state.query = ""; state.terms = []; state.first = false; state.year = null;
      elToggle.setAttribute("aria-pressed", "false");
      elClear.hidden = true;
      root.classList.remove("pubs-has-query");
      render();
      elInput.focus();
    }
  });

  // "/" jumps to search while the publications section is on screen.
  var section = document.getElementById("publications") || root;
  document.addEventListener("keydown", function (e) {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    var a = document.activeElement, tag = a && a.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (a && a.isContentEditable)) return;
    var r = section.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) return;
    e.preventDefault();
    elInput.focus();
  });

  render();

  /* ================================================================ Reveal safety net
     main.js reveals [data-reveal] blocks on scroll. In case it never sees ours
     (or isn't loaded), reveal them ourselves. */

  var blocks = Array.prototype.slice.call(root.querySelectorAll("[data-reveal]"));
  function showBlock(el) { el.classList.add("in"); }
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (en.isIntersecting) { showBlock(en.target); io.unobserve(en.target); } });
    }, { threshold: 0 });
    blocks.forEach(function (b) { io.observe(b); });
  }
  setTimeout(function () {
    blocks.forEach(function (b) {
      if (b.classList.contains("in")) return;
      if (!("IntersectionObserver" in window) || b.getBoundingClientRect().top < window.innerHeight) showBlock(b);
    });
  }, 1500);
})();
