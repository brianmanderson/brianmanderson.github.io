/* sections.js
   Renders About, Now, Work, Awards and Contact from window.SITE (data.js).
   Styles: assets/css/sections.css. No dependencies. */
(function () {
  "use strict";

  var SITE = window.SITE;
  if (!SITE) return;

  /* ---------- helpers ---------- */

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function mount(id, html) {
    var el = document.getElementById(id);
    if (!el) return null;
    el.innerHTML = html;
    return el;
  }

  // Wrap code identifiers (snake_case names, CamelCase names with digits such as
  // ReconstructPatches2D/3D) in <code>. Input is escaped first, so this is safe.
  function codify(text) {
    return esc(text).replace(
      /\b[A-Za-z]+(?:_[A-Za-z0-9]+)+\b|\b[A-Z][a-z]+[A-Z][A-Za-z]*\d[A-Za-z0-9\/]*/g,
      function (m) { return '<code class="work-code">' + m + "</code>"; }
    );
  }

  var EXT = '<span class="visually-hidden"> (opens in a new tab)</span>';
  var ARROW = '<svg class="sx-arrow" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true" focusable="false"><path d="M3 9 9 3M4.5 3H9v4.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  // Deterministic pseudo-random so contours look the same on every load.
  function rand(seed) {
    var x = Math.sin(seed * 9301 + 49297) * 233280;
    return x - Math.floor(x);
  }

  // Closed Catmull-Rom spline through points -> SVG path.
  function smoothPath(pts) {
    var n = pts.length, d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 0; i < n; i++) {
      var p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += "C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " + c2x.toFixed(1) + " " + c2y.toFixed(1) + " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    return d + "Z";
  }

  /* Isodose-style nested contours: hot (iso-6) at the core, cold (iso-1) outside.
     Rings share one perturbation shape so they nest without crossing, and drift
     slightly off-centre the way real dose distributions do. */
  function contours(opts) {
    var size = opts.size || 200, rings = opts.rings || 6, seed = opts.seed || 1;
    var cx = size / 2, cy = size / 2, maxR = size * (opts.reach || 0.47);
    var ph = [rand(seed) * 6.28, rand(seed + 1) * 6.28, rand(seed + 2) * 6.28];
    var dx = (rand(seed + 3) - 0.5) * size * 0.12, dy = (rand(seed + 4) - 0.5) * size * 0.12;
    var out = "";
    for (var k = 0; k < rings; k++) {
      var t = (k + 1) / rings;                 // 0..1, inner to outer
      var r = maxR * (0.18 + 0.82 * t);
      var amp = 0.05 + 0.09 * t;
      var ox = cx + dx * (1 - t), oy = cy + dy * (1 - t);
      var pts = [];
      for (var j = 0; j < 28; j++) {
        var a = (j / 28) * Math.PI * 2;
        var w = 1 + amp * (0.55 * Math.sin(2 * a + ph[0]) + 0.3 * Math.sin(3 * a + ph[1]) + 0.15 * Math.sin(5 * a + ph[2]));
        pts.push([ox + Math.cos(a) * r * w, oy + Math.sin(a) * r * w]);
      }
      var iso = Math.min(6, Math.max(1, Math.round(6 - (k / Math.max(1, rings - 1)) * 5)));
      out += '<path class="sx-ring sx-iso-' + iso + '" style="--k:' + k + '" d="' + smoothPath(pts) + '"/>';
    }
    return '<svg class="sx-contours ' + (opts.cls || "") + '" viewBox="0 0 ' + size + " " + size +
      '" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice">' + out + "</svg>";
  }

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- About ---------- */

  function renderAbout() {
    var a = SITE.about;
    if (!a) return;
    var paras = (a.paragraphs || []).map(function (p, i) {
      return '<p class="' + (i === 0 ? "about-lede" : "about-p") + '">' + esc(p) + "</p>";
    }).join("");

    var facts = (a.facts || []).map(function (f) {
      return '<div class="about-fact"><dt>' + esc(f.label) + "</dt><dd>" + esc(f.value) + "</dd></div>";
    }).join("");

    var tools = (a.toolkit || []).map(function (t) {
      return '<li class="chip">' + esc(t) + "</li>";
    }).join("");

    /* PORTRAIT: placeholder monogram drawn as isodose contours.
       To use a photo, replace the whole <svg class="sx-contours ..."> and
       <span class="about-monogram"> below with:
         <img src="assets/portrait.jpg" alt="Brian Anderson" width="800" height="1000" loading="lazy">
       The .about-portrait img rule in sections.css already crops it to fit. */
    var portrait =
      '<figure class="about-portrait" data-reveal>' +
        contours({ size: 240, rings: 7, seed: 7, reach: 0.5, cls: "about-rings" }) +
        '<span class="about-monogram" aria-hidden="true">BA</span>' +
        '<figcaption class="visually-hidden">Monogram placeholder for a portrait of ' + esc(SITE.person.name) + "</figcaption>" +
      "</figure>";

    mount("about-root",
      '<div class="about-grid">' +
        '<div class="about-text" data-reveal>' + paras + "</div>" +
        '<aside class="about-side" aria-label="Quick facts">' +
          portrait +
          '<dl class="about-facts" data-reveal>' + facts + "</dl>" +
          '<div class="about-toolkit" data-reveal>' +
            '<h3 class="about-label" id="about-toolkit-h">Toolkit</h3>' +
            '<ul class="about-chips" aria-labelledby="about-toolkit-h">' + tools + "</ul>" +
          "</div>" +
        "</aside>" +
      "</div>"
    );
  }

  /* ---------- Now ---------- */

  function renderNow() {
    var items = SITE.now || [];
    if (!items.length) return;
    var lead = items[0], rest = items.slice(1);

    var leadStat = "";
    if (lead.stat) {
      leadStat =
        '<div class="now-lead-stat">' +
          contours({ size: 220, rings: 6, seed: 3, reach: 0.5, cls: "now-rings" }) +
          '<p class="now-stat"><span class="now-stat-value" aria-hidden="true" data-count="' + esc(lead.stat.value) + '">' + esc(lead.stat.value) + "</span>" +
          '<span class="visually-hidden">' + esc(lead.stat.value) + " </span>" +
          '<span class="now-stat-label">' + esc(lead.stat.label) + "</span></p>" +
        "</div>";
    }

    var leadHtml =
      '<article class="now-lead" data-reveal aria-labelledby="now-lead-title">' +
        '<div class="now-lead-main">' +
          '<p class="now-status"><span class="now-pulse" aria-hidden="true"></span>' +
            '<span class="now-tag">' + esc(lead.tag) + '</span><span class="now-since">' + esc(lead.since) + "</span></p>" +
          '<h3 class="now-lead-title" id="now-lead-title">' + esc(lead.title) + "</h3>" +
          '<p class="now-org">' + esc(lead.org) + "</p>" +
          '<p class="now-body">' + esc(lead.body) + "</p>" +
        "</div>" +
        leadStat +
      "</article>";

    var restHtml = rest.map(function (it, i) {
      var stat = it.stat
        ? '<p class="now-mini-stat"><strong>' + esc(it.stat.value) + "</strong> " + esc(it.stat.label) + "</p>"
        : "";
      return '<li class="now-item" data-reveal style="--i:' + i + ";--c:var(--iso-" + (4 - i > 0 ? 4 - i : 1) + ')">' +
        "<article>" +
          '<p class="now-status"><span class="now-pulse" aria-hidden="true"></span>' +
            '<span class="now-tag">' + esc(it.tag) + '</span><span class="now-since">' + esc(it.since) + "</span></p>" +
          '<h3 class="now-title">' + esc(it.title) + "</h3>" +
          '<p class="now-org">' + esc(it.org) + "</p>" +
          '<p class="now-body">' + esc(it.body) + "</p>" +
          stat +
        "</article></li>";
    }).join("");

    var root = mount("now-root", leadHtml + '<ul class="now-list" role="list">' + restHtml + "</ul>");
    if (root) setupCount(root.querySelector(".now-stat-value"));
  }

  // Count the lead stat up from zero the first time it is seen (integers only).
  function setupCount(el) {
    if (!el || reduceMotion || !("IntersectionObserver" in window)) return;
    var target = el.getAttribute("data-count");
    if (!/^\d+$/.test(target)) return;
    var n = parseInt(target, 10);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.disconnect();
        var start = null, dur = 1400;
        el.textContent = "0";
        function step(ts) {
          if (start === null) start = ts;
          var p = Math.min(1, (ts - start) / dur);
          var eased = 1 - Math.pow(1 - p, 3);
          el.textContent = String(Math.round(n * eased));
          if (p < 1) requestAnimationFrame(step); else el.textContent = target;
        }
        requestAnimationFrame(step);
      });
    }, { threshold: 0.5 });
    io.observe(el);
  }

  /* ---------- Work ---------- */

  function renderWork() {
    var items = SITE.work || [];
    if (!items.length) return;
    var total = items.length;
    var pad = function (n) { return n < 10 ? "0" + n : String(n); };

    var html = items.map(function (w, i) {
      var meta = (w.meta || []).map(function (m) { return "<li>" + esc(m) + "</li>"; }).join("");
      var links = (w.links || []).map(function (l) {
        return '<li><a class="btn work-link" href="' + esc(l.href) + '" target="_blank" rel="noopener">' +
          esc(l.label) + ARROW + EXT + "</a></li>";
      }).join("");
      var tid = "work-" + esc(w.id || i) + "-title";
      return '<li class="work-item' + (i % 2 ? " is-flip" : "") + '" data-reveal>' +
        '<article class="work-article" aria-labelledby="' + tid + '">' +
          '<div class="work-stat">' +
            contours({ size: 260, rings: 6, seed: 11 + i * 5, reach: 0.52, cls: "work-rings" }) +
            '<span class="work-index">' + pad(i + 1) + " / " + pad(total) + "</span>" +
            (w.stat
              ? '<p class="work-figure"><span class="work-value">' + esc(w.stat.value) + '</span><span class="work-value-label">' + esc(w.stat.label) + "</span></p>"
              : "") +
          "</div>" +
          '<div class="work-copy">' +
            '<p class="work-kicker">' + esc(w.kicker) + "</p>" +
            '<h3 class="work-title" id="' + tid + '">' + esc(w.title) + "</h3>" +
            '<p class="work-body">' + codify(w.body) + "</p>" +
            (meta ? '<ul class="work-meta" aria-label="Details">' + meta + "</ul>" : "") +
            (links ? '<ul class="work-links" aria-label="Links">' + links + "</ul>" : "") +
          "</div>" +
        "</article></li>";
    }).join("");

    mount("work-root", '<ol class="work-list" role="list">' + html + "</ol>");
  }

  /* ---------- Awards ---------- */

  function renderAwards() {
    var awards = (SITE.awards || []).slice().sort(function (a, b) { return b.year - a.year; });
    var grants = SITE.grants || [];
    if (!awards.length && !grants.length) return;

    var groups = [];
    awards.forEach(function (a) {
      var g = groups[groups.length - 1];
      if (!g || g.year !== a.year) groups.push(g = { year: a.year, items: [] });
      g.items.push(a);
    });

    var timeline = groups.map(function (g, gi) {
      var items = g.items.map(function (a) {
        return '<li class="awards-item' + (a.highlight ? " is-highlight" : "") + '">' +
          (a.highlight ? '<span class="awards-flag">Highlight</span>' : "") +
          '<h4 class="awards-title">' + esc(a.title) + "</h4>" +
          (a.detail ? '<p class="awards-detail">' + esc(a.detail) + "</p>" : "") +
          "</li>";
      }).join("");
      return '<li class="awards-year" data-reveal style="--i:' + Math.min(gi, 6) + '">' +
        '<h3 class="awards-year-label"><time datetime="' + esc(g.year) + '">' + esc(g.year) + "</time></h3>" +
        '<ul class="awards-items" role="list">' + items + "</ul></li>";
    }).join("");

    var grantsHtml = grants.map(function (g) {
      return '<li class="awards-grant">' +
        '<p class="awards-grant-years">' + esc(g.years) + "</p>" +
        '<h4 class="awards-grant-title">' + esc(g.title) + "</h4>" +
        (g.detail ? '<p class="awards-grant-detail">' + esc(g.detail) + "</p>" : "") +
        "</li>";
    }).join("");

    mount("awards-root",
      '<div class="awards-grid">' +
        '<div class="awards-main">' +
          '<h3 class="visually-hidden">Awards by year</h3>' +
          '<ol class="awards-timeline" role="list">' + timeline + "</ol>" +
        "</div>" +
        (grants.length
          ? '<aside class="awards-grants" data-reveal aria-labelledby="awards-grants-h">' +
              '<h3 class="awards-grants-h" id="awards-grants-h">Grants and fellowships</h3>' +
              '<ul class="awards-grant-list" role="list">' + grantsHtml + "</ul>" +
            "</aside>"
          : "") +
      "</div>"
    );
  }

  /* ---------- Contact ---------- */

  function renderContact() {
    var p = SITE.person;
    if (!p) return;
    var gh = p.github ? p.github.replace(/^https?:\/\//, "") : "";
    mount("contact-root",
      '<div class="contact-wrap" data-reveal>' +
        contours({ size: 320, rings: 8, seed: 21, reach: 0.5, cls: "contact-rings" }) +
        '<div class="contact-main">' +
          '<p class="eyebrow">Contact</p>' +
          '<h2 class="contact-title" id="contact-title">Get in touch.</h2>' +
          (p.email
            ? '<a class="contact-email" href="mailto:' + esc(p.email) + '">' + esc(p.email) + "</a>"
            : "") +
        "</div>" +
        '<div class="contact-side">' +
          '<dl class="contact-dl">' +
            '<div><dt>Title</dt><dd>' + esc(p.title) + "</dd></div>" +
            '<div><dt>Department</dt><dd>' + esc(p.department) + "</dd></div>" +
            '<div><dt>Institution</dt><dd>' + esc(p.institution) + "</dd></div>" +
          "</dl>" +
          (p.github
            ? '<a class="btn contact-gh" href="' + esc(p.github) + '" target="_blank" rel="noopener">' +
                '<span>GitHub</span><span class="mono contact-gh-handle">' + esc(gh) + "</span>" + ARROW + EXT + "</a>"
            : "") +
        "</div>" +
      "</div>"
    );
    var sec = document.getElementById("contact");
    if (sec && !sec.hasAttribute("aria-labelledby")) sec.setAttribute("aria-labelledby", "contact-title");
  }

  /* ---------- reveal safety net ---------- */

  var ROOTS = ["about-root", "now-root", "work-root", "awards-root", "contact-root"];

  function revealSafetyNet() {
    if (typeof window.observeReveals === "function") {
      try { window.observeReveals(); } catch (e) { /* main.js also watches for inserted nodes */ }
    }
    setTimeout(function () {
      var noObserver = typeof window.observeReveals !== "function" && !document.querySelector("[data-reveal].in");
      ROOTS.forEach(function (id) {
        var root = document.getElementById(id);
        if (!root) return;
        // Include the section head of the section we render into.
        var scope = root.closest(".section") || root;
        var els = scope.querySelectorAll("[data-reveal]");
        var anyIn = root.querySelector("[data-reveal].in");
        // No reveal observer on the page at all, or this root is on screen and
        // nothing in it was picked up: show everything so content is never stuck hidden.
        if (noObserver || (!anyIn && onScreen(root))) {
          for (var i = 0; i < els.length; i++) els[i].classList.add("in");
        }
      });
    }, 1500);
  }

  function onScreen(el) {
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
  }

  /* ---------- go ---------- */

  function init() {
    [renderAbout, renderNow, renderWork, renderAwards, renderContact].forEach(function (fn) {
      try { fn(); } catch (e) { if (window.console) console.error("sections.js:", e); }
    });
    revealSafetyNet();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
