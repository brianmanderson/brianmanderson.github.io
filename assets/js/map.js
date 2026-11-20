/* Journey map: renders window.SITE.journey (and SITE.talks) into #journey-root.
   A custom D3 map of the US drawn in the site's "contours" language: coastal
   isodose halos, pins drawn as concentric isodose contours, and route arcs that
   draw themselves in as each chapter becomes active. The chapter list works on
   its own if D3 or the basemap fails to load. */
(function () {
  "use strict";

  var ATLAS_URL = "https://cdn.jsdelivr.net/npm/us-atlas@3/states-albers-10m.json";
  var W = 975, H = 610;
  var NS = "http://www.w3.org/2000/svg";
  var STEP_MS = 3600;          // dwell per chapter while playing
  var ARC_MS = 1400;           // one arc drawing in
  var ARC_CHAIN_MS = 620;      // per arc when several draw in sequence
  var KIND_LABEL = { education: "Education", training: "Training", work: "Work" };
  var RING_RADII = [4.6, 7.8, 11.4, 15.4, 20, 25.2];

  // Preferred label positions per city (falls back through the rest).
  var LABEL_PREFS = {
    "Eureka": ["E", "SE", "NE", "S"],
    "San Diego": ["SE", "E", "S", "NE"],
    "Houston": ["S", "SW", "SE", "W"],
    "Atlanta": ["SW", "S", "W", "SE"],
    "Chapel Hill": ["NE", "E", "N", "SE"],
  };
  var ALL_POS = ["E", "W", "N", "S", "NE", "NW", "SE", "SW"];

  var reducedMQ = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(reducedMQ && reducedMQ.matches); }

  /* ---------- small helpers ---------- */
  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v == null || v === false) return;
        if (k === "text") n.textContent = v;
        else if (k === "class") n.className = v;
        else n.setAttribute(k, v === true ? "" : v);
      });
    }
    (kids || []).forEach(function (c) {
      if (c == null) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function s(tag, attrs, parent) {
    var n = document.createElementNS(NS, tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { if (attrs[k] != null) n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function easeInOut(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }
  function fmtCoord(lat, lon) {
    return Math.abs(lat).toFixed(2) + "° " + (lat >= 0 ? "N" : "S") + " · " +
      Math.abs(lon).toFixed(2) + "° " + (lon >= 0 ? "E" : "W");
  }
  function miles(a, b) {
    var R = 3958.8, rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return Math.round((2 * R * Math.asin(Math.sqrt(x))) / 10) * 10;
  }
  function shortYears(y) {
    return y.replace(/\s*–\s*/g, "–").replace(/Present/i, "now")
      .replace(/(\d{2})(\d{2})–\1(\d{2})/, "$1$2–$3");
  }
  function stateOf(city) { var p = city.split(","); return p.length > 1 ? p[p.length - 1].trim() : ""; }

  // Slightly irregular closed contour: an isodose line, not a perfect circle.
  function contour(r, seed) {
    var n = 56, pts = [];
    for (var i = 0; i < n; i++) {
      var t = (i / n) * Math.PI * 2;
      var rr = r * (1 + 0.06 * Math.sin(3 * t + seed) + 0.04 * Math.sin(5 * t + seed * 1.7) +
        0.025 * Math.sin(2 * t + seed * 0.37));
      pts.push([Math.cos(t) * rr, Math.sin(t) * rr]);
    }
    // Closed Catmull-Rom through the points.
    var d = "";
    for (var j = 0; j < n; j++) {
      var p0 = pts[(j - 1 + n) % n], p1 = pts[j], p2 = pts[(j + 1) % n], p3 = pts[(j + 2) % n];
      if (j === 0) d += "M" + p1[0].toFixed(2) + "," + p1[1].toFixed(2);
      var c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += "C" + c1x.toFixed(2) + "," + c1y.toFixed(2) + " " + c2x.toFixed(2) + "," + c2y.toFixed(2) +
        " " + p2[0].toFixed(2) + "," + p2[1].toFixed(2);
    }
    return d + "Z";
  }

  // Quadratic arc. The bend is perpendicular to the direction of travel, so two
  // legs between the same cities in opposite directions bow to opposite sides.
  function arcPath(a, b, bend) {
    var dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
    var nx = -dy / d, ny = dx / d;
    var cx = (a.x + b.x) / 2 + nx * d * bend, cy = (a.y + b.y) / 2 + ny * d * bend;
    return "M" + a.x.toFixed(1) + "," + a.y.toFixed(1) + " Q" + cx.toFixed(1) + "," + cy.toFixed(1) +
      " " + b.x.toFixed(1) + "," + b.y.toFixed(1);
  }

  /* ---------- component ---------- */
  function init() {
    var root = document.getElementById("journey-root");
    var SITE = window.SITE || {};
    if (!root || !Array.isArray(SITE.journey) || !SITE.journey.length) return;

    var chapters = SITE.journey.map(function (c, i) { var o = Object.assign({}, c); o.index = i; return o; });
    var talks = Array.isArray(SITE.talks) ? SITE.talks : [];
    var n = chapters.length;
    var byId = {};
    chapters.forEach(function (c) { byId[c.id] = c; });

    // Distinct locations (San Diego hosts two chapters).
    var locs = [];
    chapters.forEach(function (c) {
      var loc = locs.find(function (l) { return Math.abs(l.lat - c.lat) < 0.01 && Math.abs(l.lon - c.lon) < 0.01; });
      if (!loc) { loc = { short: c.short, city: c.city, lat: c.lat, lon: c.lon, chapters: [] }; locs.push(loc); }
      loc.chapters.push(c);
      c.loc = loc;
    });
    locs.forEach(function (l, i) {
      l.i = i;
      l.current = l.chapters.some(function (c) { return c.current; });
      l.years = l.chapters.map(function (c) { return shortYears(c.years); }).join(" · ");
    });

    // Legs of the route.
    var legs = [];
    chapters.forEach(function (c) {
      var prev = c.from && byId[c.from];
      if (!prev || prev.loc === c.loc) return;
      c.leg = { chapter: c, a: prev.loc, b: c.loc, side: !!c.sideTrip, miles: miles(prev.loc, c.loc) };
      legs.push(c.leg);
    });

    var currentIdx = chapters.findIndex(function (c) { return c.current; });
    var state = {
      active: currentIdx >= 0 ? currentIdx : n - 1,
      expanded: true,
      playing: false,
      timer: null,
      talks: false,
      interacted: false,
      pop: null,
    };

    /* ----- DOM skeleton ----- */
    root.textContent = "";
    var wrap = h("div", { class: "jm" });

    // Map column
    var mapCol = h("div", { class: "jm-map", "data-reveal": "" });

    var playIcon = h("span", { class: "jm-play-icon", "aria-hidden": "true" });
    var playLabel = h("span", { class: "jm-play-label", text: "Play the route" });
    var playBtn = h("button", { type: "button", class: "jm-btn jm-play", "data-state": "idle", "aria-controls": "jm-list" }, [playIcon, playLabel]);
    var talksBtn = h("button", { type: "button", class: "jm-btn jm-talks-btn", "aria-pressed": "false" }, [
      h("span", { class: "jm-talk-glyph", "aria-hidden": "true" }),
      h("span", { text: "Talks & conferences" }),
      h("span", { class: "jm-count", text: String(talks.length) }),
    ]);
    if (!talks.length) talksBtn.hidden = true;

    var bar = h("div", { class: "jm-bar" }, [
      h("p", { class: "jm-bar-title" }, [
        h("span", { class: "jm-bar-mark", "aria-hidden": "true" }),
        h("span", { text: "Route" }),
        h("span", { class: "jm-bar-span", text: (chapters[0].years.match(/\d{4}/) || [""])[0] + " → now" }),
      ]),
      h("div", { class: "jm-controls" }, [talksBtn, playBtn]),
    ]);

    var progSegs = chapters.map(function () { return h("i"); });
    var progress = h("div", { class: "jm-progress", "aria-hidden": "true" }, progSegs);

    var stage = h("div", { class: "jm-stage" }, [
      h("span", { class: "jm-corner jm-tl", "aria-hidden": "true" }),
      h("span", { class: "jm-corner jm-tr", "aria-hidden": "true" }),
      h("span", { class: "jm-corner jm-bl", "aria-hidden": "true" }),
      h("span", { class: "jm-corner jm-br", "aria-hidden": "true" }),
    ]);

    var pop = h("div", { class: "jm-pop", id: "jm-pop", role: "tooltip", hidden: true });

    var roStep = h("span", { class: "jm-ro-step" });
    var roCity = h("span", { class: "jm-ro-city" });
    var roCoord = h("span", { class: "jm-ro-coord" });
    var roLeg = h("span", { class: "jm-ro-leg" });
    var readout = h("p", { class: "jm-readout", "aria-live": "polite", "aria-atomic": "true" }, [roStep, roCity, roCoord, roLeg]);

    function legendItem(cls, label, extra) {
      return h("li", extra || null, [h("span", { class: "jm-glyph " + cls, "aria-hidden": "true" }), h("span", { text: label })]);
    }
    var legend = h("ul", { class: "jm-legend", "aria-label": "Legend" }, [
      legendItem("jm-g-education", "Education"),
      legendItem("jm-g-training", "Training"),
      legendItem("jm-g-work", "Work"),
      legendItem("jm-g-side", "Side trip"),
      talks.length ? legendItem("jm-g-talk", "Talk", { class: "jm-legend-talk" }) : null,
    ]);

    var foot = h("div", { class: "jm-foot" }, [readout, legend]);

    mapCol.appendChild(bar);
    mapCol.appendChild(progress);
    mapCol.appendChild(stage);
    mapCol.appendChild(foot);
    mapCol.appendChild(pop);

    // Steps column
    var stepsCol = h("div", { class: "jm-steps", "data-reveal": "" });
    stepsCol.appendChild(h("div", { class: "jm-steps-head" }, [
      h("span", { text: "Chapters" }),
      h("span", { class: "jm-keys", "aria-hidden": "true" }, [h("kbd", { text: "↑" }), h("kbd", { text: "↓" }), " to step"]),
    ]));
    var ol = h("ol", { class: "jm-list", id: "jm-list", "aria-label": "Chapters of the journey" });
    var items = chapters.map(function (c, i) {
      var tags = [];
      if (c.sideTrip) tags.push(h("span", { class: "jm-tag", text: "Side trip" }));
      if (c.current) tags.push(h("span", { class: "jm-tag jm-tag-now" }, [h("span", { class: "jm-now-dot", "aria-hidden": "true" }), "Now"]));
      var btn = h("button", {
        type: "button", class: "jm-step-btn", id: "jm-step-" + c.id,
        "aria-expanded": "false", "aria-controls": "jm-panel-" + c.id,
      }, [
        h("span", { class: "jm-meta" }, [
          h("span", { class: "jm-idx", text: pad(i + 1) }),
          h("span", { class: "jm-years", text: c.years }),
          h("span", { class: "jm-kind", text: KIND_LABEL[c.kind] || c.kind }),
        ].concat(tags)),
        h("span", { class: "jm-city", text: c.city }),
        h("span", { class: "jm-place", text: c.place }),
        h("span", { class: "jm-role", text: c.role }),
      ]);
      var body = h("div", { class: "jm-panel-body" }, [
        c.summary ? h("p", { class: "jm-summary", text: c.summary }) : null,
        Array.isArray(c.points) && c.points.length
          ? h("ul", { class: "jm-points" }, c.points.map(function (p) { return h("li", { text: p }); }))
          : null,
      ]);
      var panel = h("div", { class: "jm-panel", id: "jm-panel-" + c.id, role: "region", "aria-labelledby": btn.id }, [
        h("div", { class: "jm-panel-inner" }, [body]),
      ]);
      var li = h("li", { class: "jm-step", "data-kind": c.kind }, [
        h("span", { class: "jm-node", "aria-hidden": "true" }),
        h("div", { class: "jm-card" }, [btn, panel]),
      ]);
      ol.appendChild(li);
      btn.addEventListener("click", function () { select(i, { user: true }); });
      return { li: li, btn: btn };
    });
    stepsCol.appendChild(ol);

    wrap.appendChild(mapCol);
    wrap.appendChild(stepsCol);
    root.appendChild(wrap);

    ol.addEventListener("keydown", function (e) {
      var idx = items.findIndex(function (it) { return it.btn === document.activeElement; });
      if (idx < 0) return;
      var t = null;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") t = Math.min(n - 1, idx + 1);
      else if (e.key === "ArrowUp" || e.key === "ArrowLeft") t = Math.max(0, idx - 1);
      else if (e.key === "Home") t = 0;
      else if (e.key === "End") t = n - 1;
      if (t == null) return;
      e.preventDefault();
      if (t === state.active) { items[t].btn.focus(); return; }
      select(t, { user: true, focus: true });
    });

    /* ----- map ----- */
    var map = buildMap();

    function buildMap() {
      var d3 = window.d3;
      if (!d3 || !d3.geoAlbersUsa) {
        stage.classList.add("is-failed");
        stage.appendChild(h("p", { class: "jm-fallback", text: "The map couldn't load. The chapters tell the whole story." }));
        talksBtn.hidden = true;
        return null;
      }
      var projection = d3.geoAlbersUsa().scale(1300).translate([487.5, 305]);
      locs.forEach(function (l) { var p = projection([l.lon, l.lat]); l.x = p ? p[0] : W / 2; l.y = p ? p[1] : H / 2; });

      var svg = s("svg", {
        class: "jm-svg", viewBox: "0 0 " + W + " " + H, role: "group",
        "aria-labelledby": "jm-svg-title", preserveAspectRatio: "xMidYMid meet",
      });
      var title = s("title", { id: "jm-svg-title" }, svg);
      title.textContent = "Map of the United States tracing the route: " +
        chapters.map(function (c) { return c.short + (c.sideTrip ? " (side trip)" : ""); }).join(", ") + ".";
      stage.appendChild(svg);

      var defs = s("defs", null, svg);
      var pat = s("pattern", { id: "jm-grid", width: 24, height: 24, patternUnits: "userSpaceOnUse" }, defs);
      s("path", { d: "M12 9.6v4.8M9.6 12h4.8", class: "jm-grid-mark" }, pat);
      s("rect", { x: 0, y: 0, width: W, height: H, fill: "url(#jm-grid)", class: "jm-grid-rect" }, svg);

      var gBase = s("g", { class: "jm-base" }, svg);
      var gRoutes = s("g", { class: "jm-routes" }, svg);
      var gPins = s("g", { class: "jm-pins" }, svg);
      var gLabels = s("g", { class: "jm-labels", "aria-hidden": "true" }, svg);
      var gScale = s("g", { class: "jm-scale", "aria-hidden": "true" }, svg);
      var gTalks = s("g", { class: "jm-talks", "aria-hidden": "true" }, svg);

      /* routes */
      legs.forEach(function (leg, i) {
        var d = arcPath(leg.a, leg.b, leg.side ? 0.3 : 0.2);
        var mask = s("mask", { id: "jm-mask-" + i, maskUnits: "userSpaceOnUse", x: -100, y: -100, width: W + 200, height: H + 200 }, defs);
        leg.maskPath = s("path", { d: d, fill: "none", stroke: "#fff", "stroke-width": 44, "stroke-linecap": "butt" }, mask);
        leg.g = s("g", { class: "jm-arc" + (leg.side ? " is-side" : ""), mask: "url(#jm-mask-" + i + ")" }, gRoutes);
        s("path", { class: "jm-arc-glow", d: d }, leg.g);
        leg.path = s("path", { class: "jm-arc-line", d: d }, leg.g);
        leg.head = s("circle", { class: "jm-arc-head", r: 3, cx: leg.a.x, cy: leg.a.y }, gRoutes);
        leg.len = leg.path.getTotalLength() || Math.hypot(leg.b.x - leg.a.x, leg.b.y - leg.a.y);
        leg.maskPath.setAttribute("stroke-dasharray", leg.len + " " + (leg.len + 2));
        leg.progress = 0;
        setProgress(leg, 0);
      });

      /* pins */
      locs.forEach(function (l) {
        var g = s("g", { class: "jm-pin" + (l.current ? " is-current" : ""), transform: "translate(" + l.x.toFixed(1) + "," + l.y.toFixed(1) + ")" }, gPins);
        var body = s("g", { class: "jm-pin-body" }, g);
        RING_RADII.forEach(function (r, ri) {
          s("path", { class: "jm-iso jm-iso-" + (6 - ri) + " jm-ring-" + ri, d: contour(r, l.i * 2.3 + ri * 0.9), style: "--i:" + ri }, body);
        });
        if (l.current) {
          s("circle", { class: "jm-pulse", r: 4.6 }, body);
          s("circle", { class: "jm-pulse jm-pulse-2", r: 4.6 }, body);
        }
        s("circle", { class: "jm-core", r: 3.3 }, body);
        s("circle", { class: "jm-hit", r: 15 }, body);
        g.addEventListener("click", function () { onPinClick(l); });
        l.g = g; l.body = body;

        var lg = s("g", { class: "jm-label" }, gLabels);
        l.t1 = s("text", { class: "jm-label-name" }, lg);
        l.t1.textContent = l.short.toUpperCase();
        l.t2 = s("text", { class: "jm-label-sub" }, lg);
        l.t2.textContent = l.years.toUpperCase();
        l.label = lg;
      });

      /* scale bar: 500 miles measured along 33° N */
      var sp1 = projection([-98, 33]), sp2 = projection([-98 + 500 / (69.17 * Math.cos(33 * Math.PI / 180)), 33]);
      var scaleLen = sp1 && sp2 ? Math.hypot(sp2[0] - sp1[0], sp2[1] - sp1[1]) : 0;
      var scaleBar = s("path", { class: "jm-scale-bar" }, gScale);
      var scaleText = s("text", { class: "jm-scale-text", "text-anchor": "end" }, gScale);
      scaleText.textContent = "500 MI";

      /* talks */
      var markers = [];
      talks.forEach(function (t) {
        var p = projection([t.lon, t.lat]);
        if (!p) return;
        var host = locs.find(function (l) { return Math.hypot(l.x - p[0], l.y - p[1]) < 8; }) || null;
        var count = (t.items || []).length;
        var m = { talk: t, x: p[0], y: p[1], host: host };
        m.g = s("g", {
          class: "jm-talk" + (host ? " is-attached" : ""), role: "button", tabindex: "-1",
          "aria-label": t.city + ": " + count + (count === 1 ? " talk" : " talks"),
          "aria-expanded": "false", "aria-controls": "jm-pop",
        }, gTalks);
        if (host) m.leader = s("line", { class: "jm-talk-leader" }, m.g);
        m.body = s("g", { class: "jm-talk-body" }, m.g);
        s("circle", { class: "jm-talk-hit", r: 11 }, m.body);
        s("circle", { class: "jm-talk-focus", r: 8.5 }, m.body);
        s("path", { class: "jm-talk-mark", d: "M0,-4.6L4.6,0L0,4.6L-4.6,0Z" }, m.body);
        bindTalk(m);
        markers.push(m);
      });

      /* basemap */
      if (window.fetch && window.topojson) {
        fetch(ATLAS_URL)
          .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
          .then(drawBase)
          .catch(baseFailed);
      } else {
        baseFailed();
      }

      var statePaths = [];
      function drawBase(us) {
        var path = d3.geoPath();
        var nationD = path(topojson.feature(us, us.objects.nation));
        [[60, 1], [40, 2], [21, 3]].forEach(function (hw) {
          s("path", { class: "jm-halo jm-halo-" + hw[1], d: nationD, "stroke-width": hw[0] }, gBase);
          s("path", { class: "jm-halo-gap", d: nationD, "stroke-width": hw[0] - 2 }, gBase);
        });
        s("path", { class: "jm-land", d: nationD }, gBase);
        topojson.feature(us, us.objects.states).features.forEach(function (f) {
          var p = s("path", { class: "jm-state", d: path(f) }, gBase);
          statePaths.push({ name: f.properties && f.properties.name, el: p });
        });
        s("path", { class: "jm-borders", d: path(topojson.mesh(us, us.objects.states, function (a, b) { return a !== b; })) }, gBase);
        s("path", { class: "jm-coast", d: nationD }, gBase);
        gBase.classList.add("is-loaded");
        updateStates(state.active);
      }
      function baseFailed() {
        stage.appendChild(h("p", { class: "jm-note", text: "Basemap unavailable" }));
      }
      function updateStates(i) {
        var visited = {}, activeName = stateOf(chapters[i].city);
        chapters.forEach(function (c) { if (c.index <= i) visited[stateOf(c.city)] = true; });
        statePaths.forEach(function (sp) {
          sp.el.classList.toggle("is-visited", !!visited[sp.name]);
          sp.el.classList.toggle("is-active", sp.name === activeName);
        });
      }

      /* layout: keep pins and labels a constant on-screen size as the SVG scales */
      var k = 1, compact = false;
      function layout() {
        var rect = svg.getBoundingClientRect();
        if (!rect.width) return;
        var u = W / rect.width;
        k = clamp(u, 1, 2.75);
        compact = rect.width < 560;
        svg.style.setProperty("--k", k.toFixed(3));
        svg.classList.toggle("is-compact", compact);
        locs.forEach(function (l) { l.body.setAttribute("transform", "scale(" + k.toFixed(3) + ")"); });
        legs.forEach(function (leg) { leg.head.setAttribute("r", (3.2 * k).toFixed(2)); });
        markers.forEach(function (m) {
          var mx = m.x, my = m.y;
          if (m.host) { mx = m.host.x - 13 * k; my = m.host.y - 13 * k; }
          m.px = mx; m.py = my;
          m.g.setAttribute("transform", "translate(" + mx.toFixed(1) + "," + my.toFixed(1) + ")");
          m.body.setAttribute("transform", "scale(" + k.toFixed(3) + ")");
          if (m.leader) {
            var dx = m.host.x - mx, dy = m.host.y - my, d = Math.hypot(dx, dy);
            m.leader.setAttribute("x1", (dx / d * 5 * k).toFixed(2));
            m.leader.setAttribute("y1", (dy / d * 5 * k).toFixed(2));
            m.leader.setAttribute("x2", (dx - dx / d * 4.5 * k).toFixed(2));
            m.leader.setAttribute("y2", (dy - dy / d * 4.5 * k).toFixed(2));
          }
        });
        if (scaleLen) {
          var x2 = W - 18, x1 = x2 - scaleLen, y = H - 14, tk = 4 * k;
          scaleBar.setAttribute("d", "M" + x1 + "," + (y - tk) + "V" + y + "H" + x2 + "V" + (y - tk) + "M" + (x1 + scaleLen / 2) + "," + (y - tk * 0.6) + "V" + y);
          scaleText.setAttribute("x", x2);
          scaleText.setAttribute("y", y - tk - 4 * k);
          scaleText.setAttribute("font-size", (9 * k).toFixed(2));
        }
        placeLabels();
        if (state.pop) positionPop();
      }

      function placeLabels() {
        var fs1 = (compact ? 12.5 : 11.5) * k, fs2 = 9.5 * k, lh1 = 13.5 * k, lh2 = 11.5 * k, r = 11 * k;
        var stroke = (3.2 * k).toFixed(2);
        var obstacles = locs.map(function (l) { return { x: l.x - 8 * k, y: l.y - 8 * k, w: 16 * k, h: 16 * k, own: l }; });
        if (state.talks) markers.forEach(function (m) { obstacles.push({ x: m.px - 6 * k, y: m.py - 6 * k, w: 12 * k, h: 12 * k }); });
        var placed = [];
        var activeLoc = chapters[state.active].loc;
        var order = locs.slice().sort(function (a, b) { return (b === activeLoc) - (a === activeLoc); });
        order.forEach(function (l) {
          var hasSub = !compact;
          l.t1.setAttribute("font-size", fs1.toFixed(2));
          l.t2.setAttribute("font-size", fs2.toFixed(2));
          l.t1.setAttribute("stroke-width", stroke);
          l.t2.setAttribute("stroke-width", stroke);
          l.t2.style.display = hasSub ? "" : "none";
          var prefs = (LABEL_PREFS[l.short] || []).concat(ALL_POS.filter(function (p) { return (LABEL_PREFS[l.short] || []).indexOf(p) < 0; }));
          var best = null, bestScore = Infinity;
          for (var ci = 0; ci < prefs.length; ci++) {
            var box = positionLabel(l, prefs[ci], { fs1: fs1, fs2: fs2, lh1: lh1, lh2: lh2, r: r, hasSub: hasSub });
            var score = ci * 0.01;
            var m = 3;
            if (box.x < m) score += (m - box.x) * 50;
            if (box.y < m) score += (m - box.y) * 50;
            if (box.x + box.w > W - m) score += (box.x + box.w - (W - m)) * 50;
            if (box.y + box.h > H - m) score += (box.y + box.h - (H - m)) * 50;
            placed.concat(obstacles).forEach(function (o) { if (o.own !== l) score += overlap(box, o); });
            if (score < bestScore) { bestScore = score; best = prefs[ci]; }
            if (score < 1) break;
          }
          var fb = positionLabel(l, best, { fs1: fs1, fs2: fs2, lh1: lh1, lh2: lh2, r: r, hasSub: hasSub });
          placed.push({ x: fb.x - 2 * k, y: fb.y - 2 * k, w: fb.w + 4 * k, h: fb.h + 4 * k });
        });
      }
      function overlap(a, b) {
        var x = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        var y = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        return x * y;
      }
      function positionLabel(l, pos, o) {
        var hx = pos.indexOf("E") >= 0 ? 1 : pos.indexOf("W") >= 0 ? -1 : 0;
        var v = pos.indexOf("N") >= 0 ? "above" : pos.indexOf("S") >= 0 ? "below" : "mid";
        var blockH = o.lh1 + (o.hasSub ? o.lh2 : 0);
        var diag = v !== "mid" && hx !== 0;
        var top = v === "mid" ? l.y - blockH / 2 : v === "above" ? l.y - (diag ? o.r * 0.7 : o.r) - blockH : l.y + (diag ? o.r * 0.7 : o.r);
        var x = l.x + hx * (diag ? o.r * 0.55 : o.r);
        var anchor = hx > 0 ? "start" : hx < 0 ? "end" : "middle";
        [l.t1, l.t2].forEach(function (t) { t.setAttribute("x", x.toFixed(1)); t.setAttribute("text-anchor", anchor); });
        l.t1.setAttribute("y", (top + o.fs1 * 0.86).toFixed(1));
        l.t2.setAttribute("y", (top + o.lh1 + o.fs2 * 0.86).toFixed(1));
        var bb = null;
        try { bb = l.label.getBBox(); } catch (e) { bb = null; }
        if (!bb || !bb.width) {
          var w = Math.max(l.short.length * o.fs1 * 0.66, o.hasSub ? l.years.length * o.fs2 * 0.62 : 0);
          bb = { x: anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2, y: top, width: w, height: blockH };
        }
        return { x: bb.x, y: bb.y, w: bb.width, h: bb.height };
      }

      /* route drawing */
      function setProgress(leg, v) {
        leg.progress = v;
        leg.maskPath.setAttribute("stroke-dashoffset", (leg.len * (1 - v)).toFixed(2));
        leg.g.classList.toggle("is-drawn", v > 0.001);
      }
      function cancel(leg) {
        if (leg.anim) { cancelAnimationFrame(leg.anim.raf); leg.anim = null; }
        leg.head.classList.remove("is-on");
      }
      function tween(leg, to, dur, delay, withHead) {
        cancel(leg);
        var from = leg.progress, token = {}, start = performance.now() + delay;
        leg.anim = token;
        function frame(now) {
          if (leg.anim !== token) return;
          var t = (now - start) / dur;
          if (t < 0) { token.raf = requestAnimationFrame(frame); return; }
          t = Math.min(1, t);
          var v = from + (to - from) * easeInOut(t);
          setProgress(leg, v);
          if (withHead) {
            var pt = leg.path.getPointAtLength(leg.len * v);
            leg.head.setAttribute("cx", pt.x.toFixed(1));
            leg.head.setAttribute("cy", pt.y.toFixed(1));
            leg.head.classList.toggle("is-on", t < 1);
          }
          if (t < 1) token.raf = requestAnimationFrame(frame);
          else { leg.anim = null; leg.head.classList.remove("is-on"); }
        }
        token.raf = requestAnimationFrame(frame);
      }
      function renderRoute(target, animate) {
        var still = reduced() || !animate;
        var queue = [];
        legs.forEach(function (leg) {
          var show = leg.chapter.index <= target;
          leg.g.classList.toggle("is-active", leg.chapter.index === target);
          if (show) {
            if (leg.shown) { cancel(leg); setProgress(leg, 1); } else queue.push(leg);
          } else if (leg.shown || leg.progress > 0) {
            if (still) { cancel(leg); setProgress(leg, 0); } else tween(leg, 0, 380, 0, false);
          }
          leg.shown = show;
        });
        if (still) { queue.forEach(function (leg) { cancel(leg); setProgress(leg, 1); }); return; }
        var dur = queue.length > 1 ? ARC_CHAIN_MS : ARC_MS, delay = queue.length > 1 ? 120 : 60;
        queue.forEach(function (leg) {
          tween(leg, 1, dur, delay, true);
          delay += dur * 0.82;
        });
      }

      function update(i, animate) {
        var activeLoc = chapters[i].loc;
        var seen = {};
        chapters.forEach(function (c) { if (c.index <= i) seen[c.loc.i] = true; });
        locs.forEach(function (l) {
          var st = l === activeLoc ? "is-active" : seen[l.i] ? "is-visited" : "is-future";
          ["is-active", "is-visited", "is-future"].forEach(function (c) {
            var on = c === st || (c === "is-visited" && st === "is-active");
            l.g.classList.toggle(c, on);
            l.label.classList.toggle(c, on);
          });
        });
        gPins.appendChild(activeLoc.g); // draw active pin on top
        renderRoute(i, animate);
        updateStates(i);
        placeLabels();
      }

      function setTalks(on) {
        svg.classList.toggle("show-talks", on);
        gTalks.setAttribute("aria-hidden", on ? "false" : "true");
        markers.forEach(function (m) { m.g.setAttribute("tabindex", on ? "0" : "-1"); });
        placeLabels();
      }

      /* intro: draw the whole route in once the map is first seen */
      function intro() {
        if (state.interacted || reduced()) return;
        legs.forEach(function (leg) { cancel(leg); setProgress(leg, 0); leg.shown = false; });
        renderRoute(state.active, true);
      }

      if (window.ResizeObserver) new ResizeObserver(function () { layout(); }).observe(stage);
      else window.addEventListener("resize", layout);
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(layout);

      return {
        svg: svg, markers: markers, update: update, layout: layout, setTalks: setTalks, intro: intro,
        hideAllRoutes: function () { legs.forEach(function (leg) { cancel(leg); setProgress(leg, 0); leg.shown = false; }); },
      };
    }

    /* ----- talks popover ----- */
    var hideTimer = null;
    function bindTalk(m) {
      m.g.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") showPop(m, false); });
      m.g.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hidePopSoon(); });
      m.g.addEventListener("focus", function () { if (!state.pop || state.pop.m !== m) showPop(m, false); });
      m.g.addEventListener("blur", function () { if (state.pop && state.pop.m === m && !state.pop.pinned) hidePop(); });
      m.g.addEventListener("click", function (e) {
        e.stopPropagation();
        if (state.pop && state.pop.m === m && state.pop.pinned) hidePop();
        else showPop(m, true);
      });
      m.g.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          if (state.pop && state.pop.m === m && state.pop.pinned) hidePop();
          else showPop(m, true);
        }
      });
    }
    function showPop(m, pinned) {
      clearTimeout(hideTimer);
      if (state.pop && state.pop.m !== m) closeMarker(state.pop.m);
      if (!(state.pop && state.pop.m === m)) {
        pop.textContent = "";
        var t = m.talk;
        pop.appendChild(h("p", { class: "jm-pop-city" }, [
          h("span", { class: "jm-talk-glyph", "aria-hidden": "true" }), t.city,
        ]));
        pop.appendChild(h("ul", { class: "jm-pop-list" }, (t.items || []).map(function (it) { return h("li", { text: it }); })));
        if (m.host) {
          var ch = m.host.chapters.map(function (c) { return c.years; }).join(", ");
          pop.appendChild(h("p", { class: "jm-pop-note", text: "Also a journey stop · " + ch }));
        }
      }
      state.pop = { m: m, pinned: pinned || (state.pop && state.pop.m === m && state.pop.pinned) };
      pop.hidden = false;
      m.g.classList.add("is-open");
      m.g.setAttribute("aria-expanded", "true");
      m.g.setAttribute("aria-describedby", "jm-pop");
      positionPop();
    }
    function closeMarker(m) {
      m.g.classList.remove("is-open");
      m.g.setAttribute("aria-expanded", "false");
      m.g.removeAttribute("aria-describedby");
    }
    function hidePop() {
      clearTimeout(hideTimer);
      if (state.pop) closeMarker(state.pop.m);
      state.pop = null;
      pop.hidden = true;
    }
    function hidePopSoon() {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { if (state.pop && !state.pop.pinned) hidePop(); }, 160);
    }
    function positionPop() {
      if (!state.pop) return;
      var hit = state.pop.m.body.querySelector(".jm-talk-mark");
      var cr = mapCol.getBoundingClientRect(), mr = hit.getBoundingClientRect();
      var cx = mr.left + mr.width / 2 - cr.left;
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var left = clamp(cx - pw / 2, 8, Math.max(8, cr.width - pw - 8));
      var top = mr.top - cr.top - ph - 12;
      var below = top < 4;
      if (below) top = mr.bottom - cr.top + 12;
      pop.classList.toggle("is-below", below);
      pop.style.left = left.toFixed(0) + "px";
      pop.style.top = top.toFixed(0) + "px";
      pop.style.setProperty("--ax", (cx - left).toFixed(0) + "px");
    }
    pop.addEventListener("pointerenter", function () { clearTimeout(hideTimer); });
    pop.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse") hidePopSoon(); });
    document.addEventListener("pointerdown", function (e) {
      if (!state.pop) return;
      if (pop.contains(e.target) || state.pop.m.g.contains(e.target)) return;
      hidePop();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && state.pop) {
        hidePop();
      }
    });

    /* ----- selection, readout, play ----- */
    function onPinClick(l) {
      var idxs = l.chapters.map(function (c) { return c.index; });
      var at = idxs.indexOf(state.active);
      var target = at >= 0 && idxs.length > 1 ? idxs[(at + 1) % idxs.length] : idxs[idxs.length - 1];
      select(target, { user: true });
    }

    function select(i, opts) {
      opts = opts || {};
      i = clamp(i, 0, n - 1);
      if (opts.user) { state.interacted = true; stopPlay(); }
      var changed = i !== state.active;
      if (opts.user && !changed) state.expanded = !state.expanded;
      else state.expanded = true;
      state.active = i;
      renderList();
      renderReadout();
      if (map) map.update(i, changed && opts.animate !== false);
      if (opts.focus) items[i].btn.focus();
    }

    function renderList() {
      var a = state.active;
      items.forEach(function (it, j) {
        it.li.classList.toggle("is-active", j === a);
        it.li.classList.toggle("is-past", j < a);
        it.li.classList.toggle("is-future", j > a);
        it.li.classList.toggle("is-open", j === a && state.expanded);
        it.btn.setAttribute("aria-expanded", String(j === a && state.expanded));
        if (j === a) it.btn.setAttribute("aria-current", "step"); else it.btn.removeAttribute("aria-current");
      });
      progSegs.forEach(function (seg, j) {
        seg.className = j < a ? "is-done" : j === a ? "is-active" : "";
      });
    }

    function renderReadout() {
      var c = chapters[state.active];
      roStep.textContent = pad(state.active + 1) + " / " + pad(n);
      roCity.textContent = c.short;
      roCoord.textContent = fmtCoord(c.lat, c.lon);
      if (c.leg) roLeg.textContent = (c.sideTrip ? "Side trip from " : "From ") + c.leg.a.short + " · " + c.leg.miles.toLocaleString("en-US") + " mi";
      else roLeg.textContent = "Origin";
    }

    function setPlayUI() {
      var st = state.playing ? "playing" : (state.active < n - 1 && state.pausedMid) ? "paused" : "idle";
      playBtn.setAttribute("data-state", st);
      playLabel.textContent = st === "playing" ? "Pause" : st === "paused" ? "Resume" : "Play the route";
      playBtn.setAttribute("aria-label", st === "playing" ? "Pause the route" : st === "paused" ? "Resume the route" : "Play the route from the start");
    }
    function stopPlay() {
      clearTimeout(state.timer);
      state.playing = false;
      state.pausedMid = false;
      setPlayUI();
    }
    function tick() {
      if (!state.playing) return;
      if (state.active >= n - 1) { finish(); return; }
      select(state.active + 1);
      state.timer = setTimeout(state.active >= n - 1 ? finish : tick, STEP_MS);
    }
    function finish() { state.playing = false; state.pausedMid = false; setPlayUI(); }
    playBtn.addEventListener("click", function () {
      state.interacted = true;
      if (state.playing) {
        clearTimeout(state.timer);
        state.playing = false;
        state.pausedMid = true;
        setPlayUI();
        return;
      }
      state.playing = true;
      if (state.active >= n - 1 || !state.pausedMid) {
        state.pausedMid = false;
        if (map) map.hideAllRoutes();
        select(0, { animate: false });
        setPlayUI();
        state.timer = setTimeout(tick, reduced() ? STEP_MS : 1500);
      } else {
        setPlayUI();
        state.timer = setTimeout(tick, 400);
      }
    });

    talksBtn.addEventListener("click", function () {
      state.talks = !state.talks;
      talksBtn.setAttribute("aria-pressed", String(state.talks));
      mapCol.classList.toggle("talks-on", state.talks);
      hidePop();
      if (map) map.setTalks(state.talks);
    });

    /* ----- first render ----- */
    renderList();
    renderReadout();
    setPlayUI();
    if (map) {
      map.layout();
      map.update(state.active, false);
      if (window.IntersectionObserver && !reduced()) {
        map.hideAllRoutes();
        var io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (!en.isIntersecting) return;
            io.disconnect();
            setTimeout(function () {
              if (state.interacted || state.playing) return;
              map.intro();
            }, 350);
          });
        }, { threshold: 0.35 });
        io.observe(stage);
      }
    }

    window.JourneyMap = {
      select: function (i) { select(i, { user: true }); },
      play: function () { if (!state.playing) playBtn.click(); },
      pause: function () { if (state.playing) playBtn.click(); },
    };
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
