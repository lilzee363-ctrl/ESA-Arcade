/* ==========================================================================
   ESA ARCADE - ATTRACT MODE + MASCOT
   After a few idle seconds on a menu screen the arcade "wakes up": lights
   chase, the floor grid drifts, and every so often the ESA emblem grows
   little legs and gets up to something.

   Rules
   - Menu screens only. Entering gameplay calls disable(): every timer
     stops, the mascot vanishes, and body.is-attract is removed.
   - Any input ends attract mode immediately.
   - Nothing runs while the tab is hidden, and skits are skipped entirely
     for prefers-reduced-motion.
   - The emblem PNG itself is never modified. Legs and arms are separate
     elements positioned around it.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var IDLE_MS = 6500;          // quiet time before attract mode starts
  var FIRST_SKIT_MS = 9500;    // first mascot appearance
  var SKIT_GAP = [17000, 26000];

  var SKIT_SCREENS = {
    welcome: ["legs"],
    mode: ["stroll", "peek", "dash"],
    charSelect: ["peek", "dash"],
    library: ["push", "push", "peek", "stroll"],
    participants: ["stroll", "peek"],
    hub: ["stroll", "peek", "dash"],
    intro: ["peek"],
    tourIntro: ["stroll"]
  };

  var Attract = {
    enabled: false,
    screen: null,
    lastInput: 0,
    nextSkitAt: 0,
    skit: null,
    timers: new ESA.TimerGroup(),
    checkId: 0,
    reduced: false,

    init: function () {
      var self = this;
      this.body = document.body;
      this.mascot = ESA.byId("mascot");
      this.welcomeEmblem = ESA.byId("welcomeEmblem");
      try {
        this.reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (e) { this.reduced = false; }

      var poke = function () { self.poke(); };
      window.addEventListener("keydown", poke, true);
      window.addEventListener("pointerdown", poke, true);
      window.addEventListener("wheel", poke, { passive: true, capture: true });
      var lastMove = 0;
      window.addEventListener("pointermove", function () {
        var now = performance.now();
        if (now - lastMove > 250) { lastMove = now; self.poke(); }
      }, { passive: true });

      document.addEventListener("visibilitychange", function () {
        if (document.hidden) { self.stopChecks(); self.endSkit(true); }
        else if (self.enabled) { self.poke(); self.startChecks(); }
      });
    },

    /** Called by App on every screen change. */
    onScreen: function (name, ctrl) {
      this.endSkit(true);
      if (ctrl && ctrl.gameplay) { this.disable(); return; }
      this.screen = name;
      this.enabled = true;
      this.poke();
      this.startChecks();
    },

    disable: function () {
      this.enabled = false;
      this.stopChecks();
      this.endSkit(true);
      this.body.classList.remove("is-attract");
    },

    startChecks: function () {
      if (this.checkId || document.hidden) return;
      var self = this;
      this.checkId = setInterval(function () { self.tick(); }, 1000);
    },

    stopChecks: function () {
      clearInterval(this.checkId);
      this.checkId = 0;
    },

    poke: function () {
      var now = performance.now();
      this.lastInput = now;
      this.nextSkitAt = now + FIRST_SKIT_MS;
      if (this.body && this.body.classList.contains("is-attract")) this.body.classList.remove("is-attract");
      if (this.skit) this.endSkit(false);
    },

    tick: function () {
      if (!this.enabled || document.hidden) return;
      var now = performance.now();
      if (now - this.lastInput > IDLE_MS) this.body.classList.add("is-attract");
      if (!this.skit && !this.reduced && now >= this.nextSkitAt &&
          !ESA.Screens.busy && !ESA.Modal.active()) {
        this.runSkit();
      }
    },

    /* --- Skits ------------------------------------------------------ */
    runSkit: function () {
      var options = SKIT_SCREENS[this.screen];
      if (!options) { this.nextSkitAt = performance.now() + SKIT_GAP[0]; return; }
      var name = options[Math.floor(Math.random() * options.length)];
      this.skit = name;
      this.nextSkitAt = Infinity;
      var fn = this["skit_" + name];
      if (typeof fn === "function") fn.call(this);
      else this.finishSkit();
    },

    /** Natural end of a skit: schedule the next one. */
    finishSkit: function () {
      this.timers.clear();
      this.resetMascot();
      this.welcomeEmblem.classList.remove("is-walking");
      this.skit = null;
      this.nextSkitAt = performance.now() + SKIT_GAP[0] + Math.random() * (SKIT_GAP[1] - SKIT_GAP[0]);
    },

    /** Interrupted skit: the mascot scurries off (or vanishes if `instant`). */
    endSkit: function (instant) {
      if (!this.skit && !this.mascot.classList.contains("is-on")) {
        this.welcomeEmblem && this.welcomeEmblem.classList.remove("is-walking");
        return;
      }
      this.timers.clear();
      this.skit = null;
      this.welcomeEmblem.classList.remove("is-walking");
      var m = this.mascot;
      if (instant) { this.resetMascot(); return; }
      m.classList.add("is-leaving");
      var self = this;
      this.timers.after(260, function () { self.resetMascot(); });
    },

    resetMascot: function () {
      var m = this.mascot;
      m.className = "";
      m.style.transition = "none";
      m.style.transform = "";
      m.style.left = "";
      m.style.bottom = "";
    },

    /** Move the mascot to an x position (px from the left edge). */
    place: function (x, bottom, facing) {
      var m = this.mascot;
      m.style.transition = "none";
      m.style.left = "0px";
      m.style.bottom = bottom + "px";
      m.style.transform = "translate3d(" + x + "px,0,0)";
      m.classList.toggle("face-left", facing === "left");
      void m.offsetWidth;
    },

    walkTo: function (x, ms, facing) {
      var m = this.mascot;
      m.classList.toggle("face-left", facing === "left");
      m.classList.add("is-walking");
      m.style.transition = "transform " + ms + "ms linear";
      m.style.transform = "translate3d(" + x + "px,0,0)";
    },

    stop: function () {
      var m = this.mascot;
      m.classList.remove("is-walking");
    },

    /* Welcome: the big emblem itself sprouts legs and has a little waddle. */
    skit_legs: function () {
      var self = this;
      this.welcomeEmblem.classList.add("is-walking");
      this.timers.after(4600, function () { self.finishSkit(); });
    },

    /* Walk in from the left, look around, hop, walk home. */
    skit_stroll: function () {
      var self = this, W = window.innerWidth;
      var target = Math.round(W * (0.18 + Math.random() * 0.18));
      this.place(-110, 26, "right");
      this.mascot.classList.add("is-on");
      this.walkTo(target, 2600, "right");
      this.timers.after(2650, function () {
        self.stop();
        self.mascot.classList.add("is-hop");
      });
      this.timers.after(3700, function () {
        self.mascot.classList.remove("is-hop");
        self.mascot.classList.add("is-look");
      });
      this.timers.after(4900, function () {
        self.mascot.classList.remove("is-look");
        self.walkTo(-120, 2300, "left");
      });
      this.timers.after(7300, function () { self.finishSkit(); });
    },

    /* Peek up from behind the bottom of the cabinet. */
    skit_peek: function () {
      var self = this, W = window.innerWidth;
      var x = Math.round(W * (0.12 + Math.random() * 0.7));
      this.place(x, -96, "right");
      this.mascot.classList.add("is-on", "is-peek");
      this.timers.after(40, function () { self.mascot.classList.add("peek-up"); });
      this.timers.after(1500, function () { self.mascot.classList.add("is-look"); });
      this.timers.after(3100, function () {
        self.mascot.classList.remove("is-look", "peek-up");
      });
      this.timers.after(3800, function () { self.finishSkit(); });
    },

    /* Sprint across the bottom of the screen. */
    skit_dash: function () {
      var self = this, W = window.innerWidth;
      this.place(W + 40, 26, "left");
      this.mascot.classList.add("is-on", "is-dash");
      this.walkTo(-140, 1500, "left");
      this.timers.after(1600, function () { self.finishSkit(); });
    },

    /* Library: walk up to the selected cabinet and shove the next one in. */
    skit_push: function () {
      var center = document.querySelector("#libCarousel .cabinet.is-center");
      if (!center || ESA.App.state !== "library") { this.skit_stroll(); return; }
      var self = this, W = window.innerWidth;
      var rect = center.getBoundingClientRect();
      var target = Math.min(W - 96, Math.round(rect.right + 4));
      // Stand on the same floor line as the cabinet so the shove reads.
      var floor = Math.max(26, Math.round(window.innerHeight - rect.bottom - 4));
      this.place(W + 30, floor, "left");
      this.mascot.classList.add("is-on");
      this.walkTo(target, 1900, "left");
      this.timers.after(1950, function () {
        self.stop();
        self.mascot.classList.add("is-push");
      });
      this.timers.after(2500, function () {
        if (ESA.Library) ESA.Library.nudge(1);
        ESA.Audio.play("uiMove");
      });
      this.timers.after(3300, function () {
        self.mascot.classList.remove("is-push");
        self.mascot.classList.add("is-hop");
      });
      this.timers.after(4200, function () {
        self.mascot.classList.remove("is-hop");
        self.walkTo(W + 60, 1700, "right");
      });
      this.timers.after(6000, function () { self.finishSkit(); });
    }
  };

  ESA.Attract = Attract;

})(window.ESA);
