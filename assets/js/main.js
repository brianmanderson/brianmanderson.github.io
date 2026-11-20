// Shared site behaviour: theme, nav, active section, scroll reveal, footer year.
// Runs (deferred) before the component scripts.
(function () {
  "use strict";

  var doc = document;
  var root = doc.documentElement;
  var mqDark = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var mqReduce = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

  /* ---------------------------------------------------------------- Theme */

  function currentTheme() {
    var t = root.getAttribute("data-theme");
    if (t === "light" || t === "dark") return t;
    return mqDark && !mqDark.matches ? "light" : "dark";
  }

  var themeBtn = doc.getElementById("theme-toggle");

  function syncThemeButton() {
    if (!themeBtn) return;
    var t = currentTheme();
    themeBtn.setAttribute("data-mode", t);
    themeBtn.setAttribute("aria-label", t === "dark" ? "Switch to light theme" : "Switch to dark theme");
    themeBtn.setAttribute("title", t === "dark" ? "Light theme" : "Dark theme");
    var meta = doc.querySelector('meta[name="theme-color"]');
    if (meta) {
      var bg = getComputedStyle(root).getPropertyValue("--bg").trim();
      if (bg) meta.setAttribute("content", bg);
    }
  }

  function announceTheme() {
    syncThemeButton();
    var ev;
    try { ev = new CustomEvent("themechange", { detail: { theme: currentTheme() } }); }
    catch (e) { ev = doc.createEvent("CustomEvent"); ev.initCustomEvent("themechange", false, false, { theme: currentTheme() }); }
    doc.dispatchEvent(ev);
  }

  if (themeBtn) {
    // Icon: a disc split into light and dark halves that turns over on toggle.
    themeBtn.innerHTML =
      '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">' +
      '<circle cx="12" cy="12" r="10.25" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".35"/>' +
      '<g class="nav-theme-disc">' +
      '<circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/>' +
      '<path d="M12 5.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/>' +
      "</g></svg>";
    themeBtn.addEventListener("click", function () {
      var next = currentTheme() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
      announceTheme();
    });
  }
  syncThemeButton();

  // Follow the OS while the visitor has not chosen a theme explicitly.
  if (mqDark) {
    var onScheme = function () { if (!root.hasAttribute("data-theme")) announceTheme(); };
    if (mqDark.addEventListener) mqDark.addEventListener("change", onScheme);
    else if (mqDark.addListener) mqDark.addListener(onScheme);
  }

  /* ---------------------------------------------------------------- Nav */

  var nav = doc.getElementById("nav");
  var menuBtn = doc.getElementById("nav-menu");
  var links = doc.getElementById("nav-links");

  function setScrolled() {
    if (nav) nav.classList.toggle("is-scrolled", (window.scrollY || window.pageYOffset) > 12);
  }
  setScrolled();
  window.addEventListener("scroll", setScrolled, { passive: true });

  function isMenuOpen() { return menuBtn && menuBtn.getAttribute("aria-expanded") === "true"; }

  function setMenu(open, returnFocus) {
    if (!menuBtn || !nav) return;
    menuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    menuBtn.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    nav.classList.toggle("is-open", open);
    if (!open && returnFocus) menuBtn.focus();
  }

  if (menuBtn) {
    menuBtn.innerHTML = '<span class="nav-menu-icon" aria-hidden="true"><span></span><span></span></span>';
    menuBtn.addEventListener("click", function () { setMenu(!isMenuOpen()); });
  }
  if (links) {
    links.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) setMenu(false);
    });
  }
  doc.addEventListener("keydown", function (e) {
    if ((e.key === "Escape" || e.key === "Esc") && isMenuOpen()) setMenu(false, true);
  });
  doc.addEventListener("click", function (e) {
    if (isMenuOpen() && nav && !nav.contains(e.target)) setMenu(false);
  });
  // Leaving the mobile layout closes the menu.
  var mqWide = window.matchMedia ? window.matchMedia("(min-width: 901px)") : null;
  if (mqWide) {
    var onWide = function () { if (mqWide.matches) setMenu(false); };
    if (mqWide.addEventListener) mqWide.addEventListener("change", onWide);
    else if (mqWide.addListener) mqWide.addListener(onWide);
  }

  /* ---------------------------------------------------------------- Active section */

  if (links && "IntersectionObserver" in window) {
    var linkFor = {};
    var targets = [];
    Array.prototype.forEach.call(links.querySelectorAll('a[href^="#"]'), function (a) {
      var id = a.getAttribute("href").slice(1);
      var sec = id && doc.getElementById(id);
      if (sec) { linkFor[id] = a; targets.push(sec); }
    });
    var visible = {};
    var setActive = function (id) {
      Object.keys(linkFor).forEach(function (k) {
        var on = k === id;
        linkFor[k].classList.toggle("is-active", on);
        if (on) linkFor[k].setAttribute("aria-current", "true");
        else linkFor[k].removeAttribute("aria-current");
      });
    };
    var sectionIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { visible[en.target.id] = en.isIntersecting; });
      var active = null;
      for (var i = 0; i < targets.length; i++) if (visible[targets[i].id]) { active = targets[i].id; break; }
      setActive(active);
    }, { rootMargin: "-40% 0px -55% 0px" });
    targets.forEach(function (t) { sectionIO.observe(t); });
  }

  /* ---------------------------------------------------------------- Scroll reveal */

  var revealIO = null;
  if ("IntersectionObserver" in window && !(mqReduce && mqReduce.matches)) {
    revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          en.target.classList.add("in");
          revealIO.unobserve(en.target);
        }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
  }

  function reveal(el) {
    if (el.__revealSeen) return;
    el.__revealSeen = true;
    if (revealIO) revealIO.observe(el);
    else el.classList.add("in");
  }

  function observeReveals(scope) {
    scope = scope || doc;
    if (scope.nodeType === 1 && scope.hasAttribute("data-reveal")) reveal(scope);
    if (scope.querySelectorAll) Array.prototype.forEach.call(scope.querySelectorAll("[data-reveal]"), reveal);
  }
  window.observeReveals = observeReveals;
  observeReveals(doc);

  if ("MutationObserver" in window) {
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var added = records[i].addedNodes;
        for (var j = 0; j < added.length; j++) if (added[j].nodeType === 1) observeReveals(added[j]);
      }
    }).observe(doc.body, { childList: true, subtree: true });
  }

  /* ---------------------------------------------------------------- Footer */

  var year = doc.getElementById("year");
  if (year) year.textContent = String(new Date().getFullYear());
})();
