/* ==========================================================================
   ESA ARCADE - boot
   Wires the shared systems together once, loads the images, then shows
   the Welcome screen. All flow lives in js/app.js (state machine + game
   lifecycle), js/menus.js and js/tournament-ui.js.
   ========================================================================== */

(function (ESA) {
  "use strict";

  /* --- Ambient decoration (built once) ------------------------------ */
  function buildDust(host, count) {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < count; i++) {
      var d = document.createElement("span");
      d.className = "dust";
      d.style.left = (Math.random() * 100).toFixed(2) + "%";
      d.style.animationDuration = ESA.rand(14, 26).toFixed(1) + "s";
      d.style.animationDelay = (-Math.random() * 26).toFixed(1) + "s";
      d.style.setProperty("--drift", ESA.rand(-70, 70).toFixed(0) + "px");
      var s = ESA.rand(2, 4.5).toFixed(1);
      d.style.width = s + "px";
      d.style.height = s + "px";
      frag.appendChild(d);
    }
    host.appendChild(frag);
  }

  function buildBulbs(host, count) {
    var html = "";
    for (var i = 0; i < count; i++) html += '<i style="--i:' + i + '"></i>';
    host.innerHTML = html;
  }

  function installParallax() {
    var queued = false;
    var px = 0, py = 0;
    window.addEventListener("mousemove", function (e) {
      if (document.body.classList.contains("is-gameplay")) return;
      px = (e.clientX / window.innerWidth) * 2 - 1;
      py = (e.clientY / window.innerHeight) * 2 - 1;
      if (queued) return;
      queued = true;
      requestAnimationFrame(function () {
        queued = false;
        document.documentElement.style.setProperty("--px", px.toFixed(3));
        document.documentElement.style.setProperty("--py", py.toFixed(3));
      });
    });
  }

  /* --- Global UI behaviour ------------------------------------------ */
  function wireGlobal() {
    var soundBtn = ESA.byId("soundBtn");
    soundBtn.addEventListener("click", function () {
      ESA.Audio.setEnabled(!ESA.Audio.enabled);
      soundBtn.classList.toggle("is-muted", !ESA.Audio.enabled);
      if (ESA.Audio.enabled) { ESA.Audio.unlock(); ESA.Audio.play("uiClick"); }
    });
    soundBtn.classList.toggle("is-muted", !ESA.Audio.loadPreference());

    // Hover blips for every button, delegated so dynamic buttons get them too.
    var lastHover = 0;
    document.addEventListener("mouseover", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (!b || b.disabled || (e.relatedTarget && b.contains(e.relatedTarget))) return;
      if (document.body.classList.contains("is-gameplay") && !b.closest("#modalLayer, .result-overlay")) return;
      var now = performance.now();
      if (now - lastHover < 60) return;
      lastHover = now;
      ESA.Audio.play("uiHover");
    });

    // A mouse click should not leave keyboard focus on a button - otherwise
    // the next Enter would re-click it instead of driving the screen.
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button");
      if (b && e.detail > 0) b.blur();
    });

    var resizeQueued = false;
    window.addEventListener("resize", function () {
      ESA.Stage.resize();
      if (resizeQueued) return;
      resizeQueued = true;
      requestAnimationFrame(function () {
        resizeQueued = false;
        var c = ESA.App.current();
        if (c && typeof c.onResize === "function") c.onResize();
      });
    });
  }

  function boot() {
    ESA.Screens.init();
    ESA.UI.init();
    ESA.Stage.init(ESA.byId("gameCanvas"));
    ESA.Input.install();
    ESA.App.init();
    ESA.Menus.init();
    ESA.TournamentScreens.init();
    if (ESA.SoloMenus) ESA.SoloMenus.init();
    ESA.Attract.init();
    ESA.Touch.init();

    buildDust(ESA.byId("ambDust"), 14);
    buildBulbs(ESA.byId("bezelBulbs"), 28);
    installParallax();
    wireGlobal();

    ESA.Assets.load(ESA.buildManifest()).then(function () {
      if (ESA.Assets.failed.length) {
        console.warn("[ESA] " + ESA.Assets.failed.length + " asset(s) missing; the arcade will still run.");
      }
      document.body.classList.add("is-booted");
      ESA.App.boot("welcome");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})(window.ESA);
