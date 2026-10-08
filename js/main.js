/* ==========================================================================
   ESA ARCADE - boot and flow
   Owns the single animation loop, the single key handler and the one
   currently-live game instance.

   Flow: title -> menu -> intro -> play -> result -> (rematch | menu)

   Exactly one game exists at a time. Every path into a match goes through
   startRun(), and every path out goes through teardownRun(), so repeated
   play / back / rematch cycles cannot leave a loop, timer or listener behind.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var GAMES = {
    bomb: ESA.BombPass,
    coin: ESA.CoinRush,
    bonk: ESA.BonkBooth
  };

  var appState = "boot";          // boot | title | menu | intro | play
  var currentGame = null;
  var currentGameId = null;
  var pendingGameId = null;

  var rafId = 0;
  var lastTime = 0;

  var cards = [];
  var cardIndex = 0;

  var el = {};

  /* ================================================================== *
   * Animation loop - there is only ever one
   * ================================================================== */
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!currentGame) return;

    var dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;

    // Hit-stop pauses simulation but keeps shake and rendering alive.
    if (!ESA.Stage.isFrozen(now)) currentGame.update(dt, now);
    ESA.Stage.updateFX(dt);

    var ctx = ESA.Stage.begin();
    currentGame.draw(ctx, now);
    ESA.Stage.end();
  }

  function startLoop() {
    cancelAnimationFrame(rafId);
    lastTime = performance.now();
    rafId = requestAnimationFrame(frame);
  }

  function stopLoop() {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }

  /* ================================================================== *
   * Match lifecycle
   * ================================================================== */
  var api = {
    endMatch: function (result) {
      ESA.Input.clear();
      ESA.UI.showResult(result);
    }
  };

  function teardownRun() {
    stopLoop();
    if (currentGame) {
      currentGame.destroy();
      currentGame = null;
    }
    ESA.UI.clearAll();
    ESA.Stage.resetFX();
    ESA.Input.clear();
  }

  /** Starts (or restarts) a match. The swap happens behind the veil. */
  function startRun(gameId) {
    if (ESA.Screens.busy) return;
    var Ctor = GAMES[gameId];
    if (!Ctor) return;

    ESA.Audio.unlock();
    ESA.Audio.play("start");

    ESA.Screens.go("playScreen", function () {
      teardownRun();

      currentGameId = gameId;
      var meta = Ctor.meta;
      ESA.UI.configure({
        title: meta.title,
        mode: meta.mode,
        keysZima: meta.controls === "booth"
          ? ESA.characters.zima.bonkLabel : ESA.characters.zima.controlLabel,
        keysShaza: meta.controls === "booth"
          ? ESA.characters.shaza.bonkLabel : ESA.characters.shaza.controlLabel,
        centerLabel: meta.hud.centerLabel,
        centerValue: meta.hud.centerValue,
        pips: meta.hud.pips
      });

      appState = "play";
      ESA.Input.setMode("play");
      el.ambient.classList.add("is-dim");

    }, function () {
      // Only once the veil has cleared does the countdown begin.
      ESA.Stage.resize();
      currentGame = new Ctor(api);
      currentGame.start();
      startLoop();
    });
  }

  /* ================================================================== *
   * Navigation
   * ================================================================== */
  function goTitle() {
    ESA.Screens.go("titleScreen", function () {
      teardownRun();
      appState = "title";
      ESA.Input.setMode("menu");
      el.ambient.classList.remove("is-dim");
      el.title.classList.remove("is-launching");
    });
  }

  function goMenu(silent) {
    if (!silent) ESA.Audio.play("uiBack");
    ESA.Screens.go("menuScreen", function () {
      teardownRun();
      appState = "menu";
      currentGameId = null;
      ESA.Input.setMode("menu");
      el.ambient.classList.remove("is-dim");
      focusCard(cardIndex);
    });
  }

  function goIntro(gameId) {
    var Ctor = GAMES[gameId];
    if (!Ctor) return;
    pendingGameId = gameId;
    buildIntro(Ctor.meta);
    ESA.Audio.play("uiClick");
    ESA.Screens.go("introScreen", function () {
      appState = "intro";
      ESA.Input.setMode("menu");
    });
  }

  /** The title screen hands off with the emblem flying toward the menu. */
  var launching = false;
  var flowTimers = new ESA.TimerGroup();

  function launchFromTitle() {
    if (launching || ESA.Screens.busy || appState !== "title") return;
    launching = true;
    ESA.Audio.unlock();
    ESA.Audio.play("start");
    el.title.classList.add("is-launching");
    flowTimers.after(260, function () {
      launching = false;
      goMenu(true);
    });
  }

  /* ================================================================== *
   * Intro screen content
   * ================================================================== */
  var ARROW_CAPS = ["←", "↑", "↓", "→"];

  function capsFor(charId, scheme) {
    var c = ESA.characters[charId];
    if (scheme === "booth") return c.bonkLabel.split(" ");
    if (charId === "shaza") return ARROW_CAPS;
    return ["W", "A", "S", "D"];
  }

  function buildIntro(meta) {
    el.introTitle.textContent = meta.title;
    el.introRules.innerHTML = meta.rules;

    // Art: the emblem itself for Coin Rush, an SVG symbol otherwise.
    if (meta.id === "coin") {
      el.introArt.innerHTML =
        '<img src="assets/Branding/Golden Canadian Pharaoh Emblem.png" alt="" ' +
        'style="width:100%;height:100%;object-fit:contain" />';
    } else {
      var symbol = meta.id === "bomb" ? "#icoBomb" : "#icoMallet";
      el.introArt.innerHTML = '<svg><use href="' + symbol + '" /></svg>';
    }

    el.introControls.innerHTML = "";
    ESA.roster.forEach(function (id) {
      var c = ESA.characters[id];
      var box = document.createElement("div");
      box.className = "ctrl";
      box.style.setProperty("--pc", c.color);

      var name = document.createElement("span");
      name.className = "ctrl-name";
      name.textContent = c.name;

      var keys = document.createElement("span");
      keys.className = "ctrl-keys";
      capsFor(id, meta.controls).forEach(function (k) {
        var cap = document.createElement("span");
        cap.className = "keycap";
        cap.textContent = k;
        keys.appendChild(cap);
      });

      box.appendChild(name);
      box.appendChild(keys);
      el.introControls.appendChild(box);
    });
  }

  /* ================================================================== *
   * Menu card focus
   * ================================================================== */
  function focusCard(i) {
    cardIndex = (i + cards.length) % cards.length;
    for (var n = 0; n < cards.length; n++) {
      cards[n].classList.toggle("is-focus", n === cardIndex);
    }
  }

  function moveFocus(delta) {
    focusCard(cardIndex + delta);
    ESA.Audio.play("uiHover");
  }

  /* ================================================================== *
   * Keyboard
   * ================================================================== */
  function isConfirm(code) {
    return code === "Enter" || code === "NumpadEnter" || code === "Space";
  }

  function handleKey(code) {
    if (ESA.Screens.busy) return;

    switch (appState) {
      case "title":
        if (isConfirm(code)) launchFromTitle();
        break;

      case "menu":
        if (code === "ArrowRight" || code === "ArrowDown") moveFocus(1);
        else if (code === "ArrowLeft" || code === "ArrowUp") moveFocus(-1);
        else if (isConfirm(code)) goIntro(cards[cardIndex].dataset.game);
        else if (code === "Escape") goTitle();
        break;

      case "intro":
        if (isConfirm(code)) startRun(pendingGameId);
        else if (code === "Escape") goMenu();
        break;

      case "play":
        if (code === "Escape") { goMenu(); return; }
        if (ESA.UI.isResultVisible()) {
          if (isConfirm(code)) startRun(currentGameId);
          return;
        }
        if (currentGame && typeof currentGame.onKeyDown === "function") {
          currentGame.onKeyDown(code);
        }
        break;
    }
  }

  /* ================================================================== *
   * Ambient dust + parallax
   * ================================================================== */
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

  function installParallax() {
    var queued = false;
    var px = 0, py = 0;

    window.addEventListener("mousemove", function (e) {
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

  /* ================================================================== *
   * Boot
   * ================================================================== */
  function cacheElements() {
    var id = ESA.byId;
    el = {
      ambient: id("ambient"),
      title: id("titleScreen"),
      startPrompt: id("startPrompt"),
      soundBtn: id("soundBtn"),
      introTitle: id("introTitle"),
      introRules: id("introRules"),
      introArt: id("introArt"),
      introControls: id("introControls"),
      canvas: id("gameCanvas")
    };
  }

  function wireEvents() {
    // --- Title -------------------------------------------------------
    el.startPrompt.addEventListener("click", launchFromTitle);

    // --- Menu cards --------------------------------------------------
    cards = Array.prototype.slice.call(document.querySelectorAll(".card"));
    cards.forEach(function (card, i) {
      card.addEventListener("click", function () {
        focusCard(i);
        goIntro(card.dataset.game);
      });
      card.addEventListener("mouseenter", function () {
        if (appState !== "menu") return;
        if (cardIndex !== i) ESA.Audio.play("uiHover");
        focusCard(i);
      });
    });

    // --- Intro -------------------------------------------------------
    ESA.byId("introStartBtn").addEventListener("click", function () {
      startRun(pendingGameId);
    });
    ESA.byId("introBackBtn").addEventListener("click", function () { goMenu(); });

    // --- Play --------------------------------------------------------
    ESA.byId("playBackBtn").addEventListener("click", function () { goMenu(); });
    ESA.byId("playRestartBtn").addEventListener("click", function () {
      startRun(currentGameId);
    });
    ESA.byId("rematchBtn").addEventListener("click", function () {
      startRun(currentGameId);
    });
    ESA.byId("resultBackBtn").addEventListener("click", function () { goMenu(); });

    // --- Sound -------------------------------------------------------
    el.soundBtn.addEventListener("click", function () {
      ESA.Audio.setEnabled(!ESA.Audio.enabled);
      el.soundBtn.classList.toggle("is-muted", !ESA.Audio.enabled);
      if (ESA.Audio.enabled) { ESA.Audio.unlock(); ESA.Audio.play("uiClick"); }
    });

    // --- Buttons share a click sound ---------------------------------
    document.querySelectorAll(".btn").forEach(function (b) {
      b.addEventListener("mouseenter", function () { ESA.Audio.play("uiHover"); });
    });

    // --- Window ------------------------------------------------------
    window.addEventListener("resize", function () { ESA.Stage.resize(); });
  }

  function boot() {
    cacheElements();
    ESA.Screens.init();
    ESA.UI.init();
    ESA.Stage.init(el.canvas);
    ESA.Input.install();
    ESA.Input.onPress = handleKey;

    buildDust(ESA.byId("ambDust"), 14);
    installParallax();
    wireEvents();

    el.soundBtn.classList.toggle("is-muted", !ESA.Audio.loadPreference());

    ESA.Assets.load(ESA.buildManifest()).then(function () {
      if (ESA.Assets.failed.length) {
        console.warn("[ESA] " + ESA.Assets.failed.length + " asset(s) missing; the arcade will still run.");
      }
      appState = "title";
      ESA.Input.setMode("menu");
      ESA.Screens.set("titleScreen");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})(window.ESA);
