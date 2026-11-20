// Hero: headline numbers and a living isodose field.
// The field is a slowly drifting "dose distribution": an irregular target
// covered by a rotating arc of beams, drawn as nested isodose lines.
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reducedMotion() { return !!(mqReduce && mqReduce.matches); }

  /* ================================================================ Title */

  // Give screen readers a pause between the name and the credential.
  var cred = doc.querySelector(".hero-title .hero-cred");
  if (cred && !cred.parentNode.querySelector(".hero-sep")) {
    var sep = doc.createElement("span");
    sep.className = "visually-hidden hero-sep";
    sep.textContent = ", ";
    cred.parentNode.insertBefore(sep, cred);
  }

  /* ================================================================ Stats */

  (function stats() {
    var dl = doc.getElementById("hero-stats");
    if (!dl) return;
    var pubs = Array.isArray(window.PUBS) ? window.PUBS : [];
    var site = window.SITE || {};
    function workStat(id, fallback) {
      var w = (site.work || []).filter(function (x) { return x.id === id; })[0];
      return (w && w.stat && w.stat.value) || fallback;
    }
    var papers = pubs.filter(function (p) { return p.type === "paper" || p.type === "chapter"; }).length;
    var talks = pubs.filter(function (p) { return p.type === "talk"; }).length;

    var items = [];
    if (papers) items.push({ value: String(papers), label: "peer-reviewed papers and preprints", href: "#publications" });
    items.push({ value: workStat("keras", "~18M"), label: "monthly installs of Keras, which ships my patch-reconstruction layers", href: "#work" });
    items.push({ value: workStat("coverall", "Phase 2"), label: "randomized trial built on my dissertation", href: "#work" });
    if (talks) items.push({ value: String(talks), label: "invited talks", href: "#publications" });

    dl.innerHTML = "";
    var counters = [];
    items.forEach(function (it, i) {
      var group = doc.createElement("div");
      group.className = "hero-stat";
      group.style.setProperty("--i", i);
      var dt = doc.createElement("dt");
      dt.textContent = it.label;
      var dd = doc.createElement("dd");
      // Screen readers get the final value; the animated copy is hidden from them.
      var sr = doc.createElement("span");
      sr.className = "visually-hidden";
      sr.textContent = it.value;
      var shown = doc.createElement("span");
      shown.setAttribute("aria-hidden", "true");
      shown.className = "hero-stat-num";
      var m = /^(\D*?)(\d+)(\D*)$/.exec(it.value);
      if (m && +m[2] >= 5) {
        shown.innerHTML = "";
        var pre = m[1], n = +m[2], suf = m[3];
        if (pre) shown.appendChild(affix(pre, "hero-stat-pre"));
        var num = doc.createElement("span");
        num.textContent = reducedMotion() ? String(n) : "0";
        shown.appendChild(num);
        if (suf) shown.appendChild(affix(suf, "hero-stat-suf"));
        counters.push({ el: num, to: n });
      } else if (m) {
        if (m[1]) shown.appendChild(affix(m[1].trim(), "hero-stat-pre hero-stat-word"));
        shown.appendChild(doc.createTextNode(m[2]));
        if (m[3]) shown.appendChild(affix(m[3], "hero-stat-suf"));
      } else {
        shown.textContent = it.value;
      }
      dd.appendChild(sr);
      dd.appendChild(shown);
      group.appendChild(dd);
      group.appendChild(dt);
      dl.appendChild(group);
    });

    function affix(text, cls) {
      var s = doc.createElement("span");
      s.className = cls;
      s.textContent = text;
      return s;
    }

    if (reducedMotion() || !counters.length) return;

    function run() {
      var start = null, dur = 1600;
      function step(ts) {
        if (start === null) start = ts;
        var k = Math.min(1, (ts - start) / dur);
        var e = 1 - Math.pow(1 - k, 4);
        counters.forEach(function (c) { c.el.textContent = String(Math.round(c.to * e)); });
        if (k < 1) requestAnimationFrame(step);
      }
      // Let the load-in sequence reach the stats row first.
      setTimeout(function () { requestAnimationFrame(step); }, 900);
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (en) {
        if (en.some(function (e) { return e.isIntersecting; })) { io.disconnect(); run(); }
      }, { threshold: 0.3 });
      io.observe(dl);
    } else run();
  })();

  /* ================================================================ Field */

  var canvas = doc.getElementById("hero-field");
  var hero = doc.getElementById("hero");
  var d3 = window.d3;
  if (!canvas || !hero || !d3 || !d3.contours || !d3.geoPath || !d3.geoIdentity || !canvas.getContext) return;
  var ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Isodose levels as a fraction of the prescription. Majors carry the ramp colours.
  var MAJORS = [0.2, 0.4, 0.6, 0.8, 0.9, 0.95];
  var MINORS = [];
  for (var lv = 0.05; lv < 0.96; lv += 0.05) {
    var r = Math.round(lv * 100) / 100;
    if (MAJORS.indexOf(r) < 0) MINORS.push(r);
  }
  var LEVELS = MINORS.concat(MAJORS).sort(function (a, b) { return a - b; });
  var BEAMS = 5;

  var W = 0, H = 0, dpr = 1, cell = 9, cols = 0, rows = 0, values = null;
  var palette = null;
  var t = 18;               // field time, seconds (only advances while animating)
  var lean = { x: 0, y: 0 }, leanTarget = { x: 0, y: 0 };
  var running = false, onScreen = true, rafId = 0, lastTs = 0, lastDraw = 0;
  var FRAME = 1000 / 24;
  var contourGen = d3.contours().smooth(true);
  var projection = d3.geoIdentity();
  var path = d3.geoPath(projection, ctx);

  function readPalette() {
    var cs = getComputedStyle(root);
    function v(name, fb) { return (cs.getPropertyValue(name) || "").trim() || fb; }
    var bg = v("--bg", "#0a0f15");
    ctx.fillStyle = bg;
    var hex = String(ctx.fillStyle);
    var light = false;
    if (/^#[0-9a-f]{6}$/i.test(hex)) {
      var n = parseInt(hex.slice(1), 16);
      var lum = 0.2126 * (n >> 16) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
      light = lum > 140;
    }
    palette = {
      light: light,
      iso: [1, 2, 3, 4, 5, 6].map(function (i) { return v("--iso-" + i, "#888"); }),
      text: v("--text", light ? "#17202a" : "#e9eef3"),
      faint: v("--text-faint", "#5f6e7d"),
      font: v("--font-mono", "monospace"),
    };
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height));
    var d = Math.min(window.devicePixelRatio || 1, 2);
    if (w === W && h === H && d === dpr && values) return false;
    W = w; H = h; dpr = d;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    cell = W < 700 ? 8 : W > 1600 ? 11 : 9;
    cols = Math.ceil(W / cell) + 2;
    rows = Math.ceil(H / cell) + 2;
    values = new Float64Array(cols * rows);
    contourGen.size([cols, rows]);
    var k = cell * dpr;
    projection.scale(k).translate([-0.5 * k, -0.5 * k]);
    return true;
  }

  // Geometry of the plan at time t, in CSS pixels.
  function geometry() {
    var narrow = W < 760;
    var R = narrow ? Math.min(W * 0.3, H * 0.16) : Math.min(W, H) * 0.23;
    var bx = W * (narrow ? 0.88 : 0.72), by = narrow ? Math.max(R * 0.9, H * 0.08) : H * 0.44;
    var cx = bx + R * 0.22 * Math.sin(t * 0.13) + lean.x;
    var cy = by + R * 0.18 * Math.cos(t * 0.1) + lean.y;
    return { R: R, cx: cx, cy: cy, narrow: narrow };
  }

  function computeField(g) {
    var R = g.R, cx = g.cx, cy = g.cy;
    // Target: three wandering lobes make an irregular, slowly breathing volume.
    var lobes = [];
    for (var k = 0; k < 3; k++) {
      var ph = k * 2.094 + t * (0.07 + k * 0.025) * (k % 2 ? -1 : 1);
      var off = R * (0.62 + 0.18 * Math.sin(t * 0.17 + k));
      lobes.push({
        x: cx + off * Math.cos(ph), y: cy + off * Math.sin(ph) * 0.75,
        a: [1, 0.82, 0.7][k],
        s2: 2 * Math.pow(R * [0.5, 0.44, 0.4][k], 2),
      });
    }
    // An organ at risk the plan carves around, leaving a concave notch.
    var oa = t * 0.05 + 0.6;
    lobes.push({
      x: cx + R * 0.95 * Math.cos(oa), y: cy + R * 0.95 * Math.sin(oa),
      a: -0.55, s2: 2 * Math.pow(R * 0.36, 2),
    });
    // Beams: a slowly rotating arc of fields through the target.
    var beams = [];
    var arc = t * 0.035;
    for (var b = 0; b < BEAMS; b++) {
      var th = arc + (b * Math.PI) / BEAMS;
      beams.push({ c: Math.cos(th), s: Math.sin(th) });
    }
    var bw2 = 2 * Math.pow(R * 0.34, 2), bl = R * 3.4, beamA = 0.075;
    var max = 0, i, j, idx = 0;
    for (j = 0; j < rows; j++) {
      var py = j * cell;
      for (i = 0; i < cols; i++) {
        var px = i * cell, v = 0, q;
        for (q = 0; q < 4; q++) {
          var L = lobes[q], dx = px - L.x, dy = py - L.y;
          v += L.a * Math.exp(-(dx * dx + dy * dy) / L.s2);
        }
        var ux = px - cx, uy = py - cy;
        for (q = 0; q < BEAMS; q++) {
          var B = beams[q];
          var along = ux * B.c + uy * B.s, perp = -ux * B.s + uy * B.c;
          var fall = along / bl;
          v += beamA * Math.exp(-(perp * perp) / bw2) / (1 + fall * fall);
        }
        if (v > max) { max = v; g.hx = px; g.hy = py; }
        values[idx++] = v;
      }
    }
    var norm = max > 0 ? 1.04 / max : 1;
    for (i = 0; i < values.length; i++) values[i] *= norm;
  }

  function sample(x, y) {
    var gx = x / cell, gy = y / cell;
    var i = Math.floor(gx), j = Math.floor(gy);
    if (i < 0 || j < 0 || i >= cols - 1 || j >= rows - 1) return 0;
    var fx = gx - i, fy = gy - j, o = j * cols + i;
    return values[o] * (1 - fx) * (1 - fy) + values[o + 1] * fx * (1 - fy) +
      values[o + cols] * (1 - fx) * fy + values[o + cols + 1] * fx * fy;
  }

  function draw() {
    if (!W || !H) return;
    var g = geometry();
    computeField(g);
    var P = palette, light = P.light;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.lineJoin = "round";

    var contours = contourGen.thresholds(LEVELS)(values);

    // Colour wash under the major lines, building heat toward the core.
    ctx.globalAlpha = light ? 0.05 : 0.045;
    contours.forEach(function (c) {
      var mi = MAJORS.indexOf(Math.round(c.value * 100) / 100);
      if (mi < 0) return;
      ctx.fillStyle = P.iso[mi];
      ctx.beginPath(); path(c); ctx.fill();
    });

    // Fine topographic lines between the majors.
    ctx.strokeStyle = P.text;
    ctx.lineWidth = 1 * dpr;
    ctx.globalAlpha = light ? 0.13 : 0.085;
    ctx.beginPath();
    contours.forEach(function (c) {
      if (MAJORS.indexOf(Math.round(c.value * 100) / 100) < 0) path(c);
    });
    ctx.stroke();

    // Major isodose lines, coloured cold to hot.
    contours.forEach(function (c) {
      var mi = MAJORS.indexOf(Math.round(c.value * 100) / 100);
      if (mi < 0) return;
      ctx.strokeStyle = P.iso[mi];
      ctx.globalAlpha = light ? 0.9 : 0.78;
      ctx.lineWidth = (mi === MAJORS.length - 1 ? 1.9 : 1.3) * dpr;
      ctx.beginPath(); path(c); ctx.stroke();
    });

    // Level labels along a ray heading up and to the right of the isocentre.
    var s = dpr;
    if (!g.narrow) {
      ctx.font = "500 " + 10 * s + "px " + P.font;
      ctx.textBaseline = "middle";
      var ang = -0.62, dxr = Math.cos(ang), dyr = Math.sin(ang);
      var ox = g.hx, oy = g.hy;
      var prev = sample(ox, oy), step = 2, maxD = Math.max(W, H);
      var mIdx = MAJORS.length - 1;
      while (mIdx >= 0 && MAJORS[mIdx] > prev) mIdx--;
      for (var d = step; d < maxD && mIdx >= 0; d += step) {
        var x = ox + dxr * d, y = oy + dyr * d;
        if (x > W - 8 || y < 8) break;
        var cur = sample(x, y);
        while (mIdx >= 0 && prev >= MAJORS[mIdx] && cur < MAJORS[mIdx]) {
          var label = Math.round(MAJORS[mIdx] * 100) + "%";
          var lx = x * s + 5 * s, ly = y * s - 7 * s;
          ctx.globalAlpha = light ? 0.95 : 0.9;
          ctx.fillStyle = P.iso[mIdx];
          ctx.beginPath(); ctx.arc(x * s, y * s, 2 * s, 0, Math.PI * 2); ctx.fill();
          ctx.globalAlpha = light ? 0.85 : 0.75;
          ctx.fillText(label, lx, ly);
          mIdx--;
        }
        prev = cur;
      }
    }

    // Isocentre marker: the quartered circle used on plans and room lasers.
    var ix = g.cx * s, iy = g.cy * s, ir = 6 * s;
    ctx.globalAlpha = light ? 0.75 : 0.7;
    ctx.strokeStyle = P.text;
    ctx.fillStyle = P.text;
    ctx.lineWidth = 1 * s;
    ctx.beginPath(); ctx.arc(ix, iy, ir, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.arc(ix, iy, ir, 0, Math.PI / 2); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(ix, iy); ctx.arc(ix, iy, ir, Math.PI, Math.PI * 1.5); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = light ? 0.4 : 0.35;
    ctx.beginPath();
    ctx.moveTo(ix - ir * 3.2, iy); ctx.lineTo(ix - ir * 1.6, iy);
    ctx.moveTo(ix + ir * 1.6, iy); ctx.lineTo(ix + ir * 3.2, iy);
    ctx.moveTo(ix, iy - ir * 3.2); ctx.lineTo(ix, iy - ir * 1.6);
    ctx.moveTo(ix, iy + ir * 1.6); ctx.lineTo(ix, iy + ir * 3.2);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (!canvas.classList.contains("is-ready")) canvas.classList.add("is-ready");
  }

  /* ---------------------------------------------------------------- Loop */

  function frame(ts) {
    rafId = 0;
    if (!running) return;
    rafId = requestAnimationFrame(frame);
    if (ts - lastDraw < FRAME) return;
    var dt = lastTs ? Math.min(0.1, (ts - lastTs) / 1000) : 0;
    lastTs = ts; lastDraw = ts;
    t += dt;
    // Ease the hot spot toward the pointer.
    lean.x += (leanTarget.x - lean.x) * 0.06;
    lean.y += (leanTarget.y - lean.y) * 0.06;
    draw();
  }

  function shouldRun() { return onScreen && !doc.hidden && !reducedMotion(); }

  function update() {
    var want = shouldRun();
    if (want && !running) {
      running = true; lastTs = 0; lastDraw = 0;
      if (!rafId) rafId = requestAnimationFrame(frame);
    } else if (!want && running) {
      running = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function redrawStatic() { if (!running) draw(); }

  /* ---------------------------------------------------------------- Wiring */

  var caption = doc.createElement("div");
  caption.className = "hero-caption mono";
  caption.setAttribute("aria-hidden", "true");
  caption.innerHTML = "<span>Isodose</span><span>% of prescription</span>";
  hero.appendChild(caption);

  readPalette();
  resize();
  draw();
  update();

  var resizeTimer = 0;
  function onResize() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () { if (resize()) redrawStatic(); }, 80);
  }
  if ("ResizeObserver" in window) new ResizeObserver(onResize).observe(canvas);
  else window.addEventListener("resize", onResize);

  doc.addEventListener("themechange", function () {
    // Let the attribute's styles apply before reading the tokens.
    requestAnimationFrame(function () { readPalette(); draw(); });
  });
  if (window.matchMedia) {
    var mqLight = window.matchMedia("(prefers-color-scheme: light)");
    var onScheme = function () { readPalette(); draw(); };
    if (mqLight.addEventListener) mqLight.addEventListener("change", onScheme);
    else if (mqLight.addListener) mqLight.addListener(onScheme);
  }

  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (en) {
      onScreen = en[en.length - 1].isIntersecting;
      update();
    }).observe(hero);
  }
  doc.addEventListener("visibilitychange", update);
  if (mqReduce) {
    var onReduce = function () { update(); redrawStatic(); };
    if (mqReduce.addEventListener) mqReduce.addEventListener("change", onReduce);
    else if (mqReduce.addListener) mqReduce.addListener(onReduce);
  }

  // The hot spot leans a little toward a mouse or pen.
  hero.addEventListener("pointermove", function (e) {
    if (e.pointerType === "touch" || reducedMotion()) return;
    var rect = canvas.getBoundingClientRect();
    var g = geometry();
    var px = e.clientX - rect.left, py = e.clientY - rect.top;
    var dx = (px - (g.cx - lean.x)) * 0.16, dy = (py - (g.cy - lean.y)) * 0.16;
    var lim = g.R * 0.9, len = Math.sqrt(dx * dx + dy * dy);
    if (len > lim) { dx *= lim / len; dy *= lim / len; }
    leanTarget.x = dx; leanTarget.y = dy;
  });
  hero.addEventListener("pointerleave", function () { leanTarget.x = 0; leanTarget.y = 0; });
})();
