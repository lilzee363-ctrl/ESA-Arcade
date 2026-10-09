/* ==========================================================================
   ESA ARCADE - touch / mobile presentation layer (shared)
   Phones, tablets and touchscreen laptops. Desktop never runs any of this
   visibly: everything is gated on body.is-touch, which is mutually
   exclusive with the desktop presentation.

   Games never see touch events:
     joystick  -> ESA.Controls.vector(slot)
     buttons   -> ESA.Controls.fireAction(slot, "action1")
     taps      -> game.onTap(x, y, pointerId) in the game's 960x540 space

   Each game DECLARES what it needs in its registry entry:
     touch: { movement: "joystick" | "none",
              actions: [{ id: "action1", label: "DASH" }],
              interaction: "directTap",
              help: ["JOYSTICK — MOVE", ...],
              tagline / description: touch wording for menus }

   MENUS PORTRAIT, GAMEPLAY = FULL-SCREEN VIRTUAL LANDSCAPE
   --------------------------------------------------------
   Menus are normal portrait pages. Actual GAMEPLAY is always a landscape
   game that fills the whole screen - and the phone does NOT have to be
   turned. One shared wrapper does it for every game (present and future):

     body.vland  is set while a touch device is on the play screen with a
                 PORTRAIT viewport. Only the gameplay layers are rotated:
                 #playScreen (stage, HUD, canvas, results), #touchLayer
                 (joystick / buttons / Control Setup), #modalLayer (pause
                 menu) and #touchPreroll (how-to card). Each is sized
                 W' = viewport height, H' = viewport width (a landscape
                 box), then rotate(90deg) about its top-left corner placed
                 at the viewport's right edge - it exactly covers the
                 screen. Menus, the welcome screen, setup screens, sheets
                 and the veil are never rotated.
     viewport    --app-w / --app-h are measured in JS (innerWidth /
                 innerHeight - what fixed layers really get, Safari bars
                 included) on every resize / visualViewport resize /
                 orientation change, so 100vh is never trusted.
     safe areas  the --sa-* insets are remapped into the rotated frame
                 (local top = screen right, local left = screen top...).
     input       every pointer goes through localPoint(), the exact inverse
                 of that rotation (local x = clientY - top, local y =
                 right - clientX), so the joystick, the buttons, editor
                 drags and Bonk taps hit exactly what is drawn. Native hit
                 testing already follows the transform, pointer ids and
                 pointer capture are untouched.
     physical    if the phone IS turned (viewport becomes landscape) the
     rotation    wrapper simply switches off - the game is already
                 landscape - so there is never a double rotation. Every
                 switch releases all fingers and re-lays the controls out;
                 the running game, loop, CPU, timers and score are not
                 touched (it is presentation + input mapping only).
   Page scroll is locked while gameplay is up (html.vland) and restored
   when the play screen is left. Desktop never uses any of this. On
   Android, Start also asks for fullscreen + a landscape lock (best
   effort, never required).

   LIFECYCLE (no duplicate listeners, ever)
   ----------------------------------------
   Every widget and listener is created ONCE in init(). A match mount()s a
   config (show + position the existing widgets) and unmount()s it (release
   every pointer, zero every vector, hide). Each joystick / button tracks
   its own pointerId, so any number of fingers work at once.

   STALE POINTERS (the iPhone "frozen joystick" fix)
   --------------------------------------------------
   iOS Safari can swallow a finger's pointerup / pointercancel (home-bar
   and toolbar gestures, a viewport resize under the finger). A widget
   that only let go on that exact event stayed owned by a finger that no
   longer existed and refused every new touch - joystick and DASH dead
   while the game and the CPU kept running. Now ownership is never trusted
   blindly:
     - a new finger on a widget always takes it over (old one released);
     - a primary touch (no other finger on the glass) releases every
       widget still owned by an older finger;
     - pointerup / pointercancel anywhere in the window release that
       finger wherever it was held, and a touchend with no fingers left
       releases everything;
     - resize, orientation change, blur, page hide / visibility change,
       pause, resume, restart and exit all release every widget.

   SETTINGS - localStorage "esaArcade.touchControls.v1"
   ------------------------------------------------------
   Only harmless UI preferences: positions (normalized 0..1 inside the
   safe-area control region), sizes, opacity, side swap. Anything invalid
   falls back to the defaults.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var STORAGE_KEY = "esaArcade.touchControls.v1";
  var SLOTS = ["p1", "p2"];
  // Joystick response (fraction of the knob travel, ~36px on a phone).
  //   DEADZONE  thumb wobble ignored (~2.5px)
  //   FULL_AT   past the dead zone, full speed at this much of the rest of
  //             the travel (~17px of drag) - no long useless thumb travel
  //   then an ease-out curve so a short flick is already most of the way
  //   to full speed (keyboard is always full speed; touch must not feel
  //   like it is "catching up"). No time smoothing anywhere: the vector is
  //   recomputed on every pointermove and read by the game loop each frame.
  // The knob is DRAWN at that same magnitude, so what you see is exactly
  // what the game gets. Direction stays full 360-degree analog.
  var DEADZONE = 0.07;
  var FULL_AT = 0.5;
  var HELP_AUTOSTART_MS = 6000;
  var GAME_KEYS = ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
                   "Space", "Enter", "KeyJ", "KeyK", "KeyL"];

  var byId = function (id) { return document.getElementById(id); };
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function num(v, min, max, fallback) {
    return (typeof v === "number" && isFinite(v)) ? clamp(v, min, max) : fallback;
  }

  /* ================================================================== *
   * Settings
   * ================================================================== */
  var DEFAULT_POS = {
    // Two players on one device: P1 owns the left half, P2 the right.
    // Joystick low in the corner, action above it - both thumbs-reach.
    duo: {
      p1: { joystick: { x: 0.09, y: 0.76 }, action1: { x: 0.08, y: 0.36 }, action2: { x: 0.2, y: 0.36 } },
      p2: { joystick: { x: 0.91, y: 0.76 }, action1: { x: 0.92, y: 0.36 }, action2: { x: 0.8, y: 0.36 } }
    },
    // One human (Solo vs CPU): joystick left, actions right.
    solo: {
      p1: { joystick: { x: 0.11, y: 0.74 }, action1: { x: 0.9, y: 0.74 }, action2: { x: 0.9, y: 0.44 } }
    }
  };

  function defaultProfile(layout, slot) {
    var src = DEFAULT_POS[layout][slot], pos = {};
    for (var k in src) pos[k] = { x: src[k].x, y: src[k].y };
    return { joyScale: 1, btnScale: 1, opacity: 0.8, swapped: false, pos: pos };
  }

  function defaults() {
    return {
      v: 1,
      duo: { p1: defaultProfile("duo", "p1"), p2: defaultProfile("duo", "p2") },
      solo: { p1: defaultProfile("solo", "p1") }
    };
  }

  /** Copy whatever is valid from `raw` over the defaults. */
  function sanitize(raw) {
    var out = defaults();
    if (!raw || typeof raw !== "object" || raw.v !== 1) return out;
    ["duo", "solo"].forEach(function (layout) {
      var src = raw[layout];
      if (!src || typeof src !== "object") return;
      for (var slot in out[layout]) {
        var p = src[slot], d = out[layout][slot];
        if (!p || typeof p !== "object") continue;
        d.joyScale = num(p.joyScale, 0.7, 1.4, 1);
        d.btnScale = num(p.btnScale, 0.7, 1.4, 1);
        d.opacity = num(p.opacity, 0.3, 1, 0.8);
        d.swapped = p.swapped === true;
        if (p.pos && typeof p.pos === "object") {
          for (var k in d.pos) {
            var q = p.pos[k];
            if (q && typeof q === "object") {
              d.pos[k].x = num(q.x, 0, 1, d.pos[k].x);
              d.pos[k].y = num(q.y, 0, 1, d.pos[k].y);
            }
          }
        }
      }
    });
    return out;
  }

  function loadSettings() {
    try {
      var s = window.localStorage.getItem(STORAGE_KEY);
      return sanitize(s ? JSON.parse(s) : null);
    } catch (e) { return defaults(); }
  }

  function saveSettings() {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Touch.settings)); } catch (e) { /* private mode etc. */ }
  }

  /* ================================================================== *
   * Mode detection
   * ================================================================== */
  var forced = /[?&]touch=1\b/.test(location.search) ? true
             : /[?&]touch=0\b/.test(location.search) ? false : null;

  /** Phones / tablets: the primary pointer is a finger. */
  function primaryTouch() {
    try {
      return window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(hover: none)").matches;
    } catch (e) { return false; }
  }

  /* ================================================================== *
   * State
   * ================================================================== */
  var layer, safe, zones, canvas, preEl, edEl;
  var widgets = {};                // slot -> { joystick, action1, action2, zone }
  var tapPointers = Object.create(null);
  var drag = null;                 // edit-mode drag { pid, w, offX, offY }
  var pre = { gen: 0, timers: null, def: null, opts: null, autoStarted: false };
  var immersive = false;

  var Touch = {
    active: false,
    rotated: false,                // gameplay shown as virtual landscape (body.vland)
    settings: null,
    mounted: null,                 // { def, touch, layout, slots }
    editing: false,
    editSlot: "p1",
    editorOpen: false,
    tapHandler: null,

    /* ------------------------------------------------------------------ */
    init: function () {
      this.settings = loadSettings();
      buildLayer();
      buildPreroll();
      buildEditor();

      canvas = byId("gameCanvas");
      canvas.addEventListener("pointerdown", onCanvasDown, { passive: false });
      canvas.addEventListener("pointerup", onCanvasUp);
      canvas.addEventListener("pointercancel", onCanvasUp);

      ESA.Controls.addProvider({ name: "touch", vector: touchVector });

      var self = this;
      // A real finger anywhere switches a hybrid laptop into touch mode.
      window.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "touch" && !self.active) self.setActive(true);
      }, true);
      // Typing on a hybrid laptop's keyboard mid-game switches back.
      window.addEventListener("keydown", function (e) {
        if (self.active && !primaryTouch() && ESA.App && ESA.App.state === "play" &&
            GAME_KEYS.indexOf(e.code) >= 0 && !self.editorOpen) {
          self.setActive(false);
        }
      }, true);
      // Any change of viewport (rotation, Safari bars, split view) drops
      // every finger, then re-lays the controls out for the new size.
      var lastW = 0, lastH = 0;
      var relayout = function () {
        var w = window.innerWidth, h = window.innerHeight;
        if (w !== lastW || h !== lastH) { lastW = w; lastH = h; self.releaseAll(); }
        self.updateOrientation();
        self.layout();
      };
      window.addEventListener("resize", relayout);
      window.addEventListener("orientationchange", function () { self.releaseAll(); setTimeout(relayout, 120); });
      // Safari bars / split view change the usable area without always
      // firing a window resize.
      if (window.visualViewport) window.visualViewport.addEventListener("resize", relayout);
      window.addEventListener("blur", function () { self.releaseAll(); });
      window.addEventListener("pagehide", function () { self.releaseAll(); });
      window.addEventListener("pageshow", function () { self.releaseAll(); relayout(); });
      document.addEventListener("visibilitychange", function () { self.releaseAll(); });
      document.addEventListener("fullscreenchange", function () { if (!document.fullscreenElement) immersive = false; });
      // Orientation flips are also caught here (Safari sometimes changes the
      // media state before it fires resize). One listener, added once.
      try {
        var oq = window.matchMedia("(orientation: portrait)");
        if (oq.addEventListener) oq.addEventListener("change", relayout);
        else if (oq.addListener) oq.addListener(relayout);
      } catch (e) { /* old browsers: resize covers it */ }
      // Window-level safety net for lost pointer events (see STALE POINTERS).
      window.addEventListener("pointerup", function (e) { releasePointer(e.pointerId); }, true);
      window.addEventListener("pointercancel", function (e) { releasePointer(e.pointerId); }, true);
      window.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "touch" && e.isPrimary) releaseStale(e.pointerId);
      }, true);
      window.addEventListener("touchend", function (e) { if (e.touches && e.touches.length === 0) self.releaseAll(); }, { capture: true, passive: true });
      window.addEventListener("touchcancel", function (e) { if (e.touches && e.touches.length === 0) self.releaseAll(); }, { capture: true, passive: true });

      this.setActive(primaryTouch());
    },

    /** True when the viewport is portrait (gameplay then goes virtual landscape). */
    isPortraitView: function () {
      var w = window.innerWidth, h = window.innerHeight;
      if (w && h && Math.abs(w - h) > 8) return h > w;
      try { return window.matchMedia("(orientation: portrait)").matches; } catch (e) { return h > w; }
    },

    setActive: function (on) {
      if (forced !== null) on = forced;
      on = !!on;
      if (on === this.active && document.body.classList.contains("is-touch") === on) return;
      this.active = on;
      document.body.classList.toggle("is-touch", on);
      if (!on) this.releaseAll();
      this.updateOrientation();
      this.refresh();
      applyWording();
    },

    /** Called by App on every screen change. */
    onScreen: function (name) {
      if (name !== "play") this.exitImmersive();
      this.releaseAll();
      this.updateOrientation();
    },

    /**
     * The virtual-landscape switch (see the header). Touch + play screen +
     * portrait viewport = rotate the gameplay layers; anything else = off.
     * Presentation and input mapping only - the match itself never knows.
     */
    updateOrientation: function () {
      measureViewport();
      var on = this.active && !!ESA.App && ESA.App.state === "play" && this.isPortraitView();
      if (on !== this.rotated) {
        this.rotated = on;
        this.releaseAll();                   // old finger coordinates mean nothing now
      }
      document.body.classList.toggle("vland", on);
      document.documentElement.classList.toggle("vland", on);
      document.body.classList.remove("play-gated", "force-landscape");
    },

    /** Android: fullscreen + landscape lock on Start (user gesture). Best effort. */
    enterImmersive: function () {
      if (!this.active || !primaryTouch()) return;
      var el = document.documentElement;
      var so = window.screen && window.screen.orientation;
      if (!el.requestFullscreen || !so || typeof so.lock !== "function") return;   // iOS: virtual landscape instead
      try {
        el.requestFullscreen({ navigationUI: "hide" }).then(function () {
          immersive = true;
          return so.lock("landscape");
        }).catch(function () { /* declined or unsupported: virtual landscape covers it */ });
      } catch (e) { /* ignore */ }
    },

    exitImmersive: function () {
      if (!immersive) return;
      immersive = false;
      try {
        if (window.screen.orientation && window.screen.orientation.unlock) window.screen.orientation.unlock();
        if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
      } catch (e) { /* ignore */ }
    },

    /** Does this game show any customizable on-screen control? */
    hasControls: function (def) {
      var t = def && def.touch;
      return !!t && (t.movement === "joystick" || (t.actions && t.actions.length > 0));
    },

    /* --- Mounting -------------------------------------------------- */

    /**
     * Show the controls a game declares. opts.layout "duo" (two humans on
     * one device) or "solo" (one human vs a CPU).
     */
    mount: function (def, opts) {
      opts = opts || {};
      var layoutType = opts.layout || "duo";
      this.mounted = {
        def: def,
        touch: def.touch || {},
        layout: layoutType,
        slots: layoutType === "solo" ? ["p1"] : SLOTS.slice()
      };
      this.tapHandler = opts.onTap || null;
      byId("ctlBtn") && byId("ctlBtn").classList.toggle("hidden", !this.hasControls(def));
      this.refresh();
    },

    unmount: function () {
      this.closeEditor(true);
      this.cancelPreroll();
      this.releaseAll();
      this.mounted = null;
      this.tapHandler = null;
      this.refresh();
    },

    /** Show/hide/position widgets for the current mode + mount. */
    refresh: function () {
      var m = this.mounted;
      var show = !!(m && this.active);
      document.body.classList.toggle("touch-play", show);
      layer.classList.toggle("hidden", !show);
      SLOTS.forEach(function (slot) {
        var w = widgets[slot];
        var used = show && m.slots.indexOf(slot) >= 0;
        // One human on the device: the controls are simply "YOU".
        var tag = m && m.layout === "solo" ? "YOU" : ESA.CONTROLS[slot].short;
        [w.joystick, w.action1, w.action2].forEach(function (x) {
          var t = x.el.querySelector(".tc-tag");
          if (t && t.textContent !== tag) t.textContent = tag;
        });
        var joy = used && m.touch.movement === "joystick";
        w.joystick.el.classList.toggle("hidden", !joy);
        w.zone.classList.toggle("hidden", !joy);
        ["action1", "action2"].forEach(function (a) {
          var spec = used && (m.touch.actions || []).filter(function (x) { return x.id === a; })[0];
          w[a].el.classList.toggle("hidden", !spec);
          if (spec) w[a].label.textContent = spec.label || "";
        });
      });
      this.layout();
    },

    profile: function (slot) {
      var m = this.mounted, layoutType = m ? m.layout : "duo";
      return this.settings[layoutType][slot] || this.settings.duo[slot];
    },

    /** Normalized positions -> pixels for the current region size. */
    layout: function () {
      var m = this.mounted;
      if (!m || !this.active) { setGutter(0); return; }
      var self = this;
      var dims = sizes();
      // Landscape: keep a modest side gutter so the joystick sits mostly
      // beside the arena (matters on tablets, whose arena is width-limited).
      // Solo has one control set, so only the side it uses needs room.
      var widest = 0;
      if (this.hasControls(m.def)) {
        m.slots.forEach(function (slot) {
          widest = Math.max(widest, clamp(dims.joy * self.profile(slot).joyScale, 80, 200));
        });
      }
      setGutter(Math.round(widest * (m.layout === "solo" ? 0.42 : 0.55)));
      var size = regionSize();
      if (!size.w || !size.h) return;
      m.slots.forEach(function (slot) {
        var prof = self.profile(slot), w = widgets[slot];
        var joyD = clamp(dims.joy * prof.joyScale, 80, 200);
        var btnD = clamp(dims.btn * prof.btnScale, 54, 130);
        place(w.joystick, slot, "joystick", joyD, size);
        place(w.action1, slot, "action1", btnD, size);
        place(w.action2, slot, "action2", btnD, size);
        w.joystick.home = { left: w.joystick.el.style.left, top: w.joystick.el.style.top };
        [w.joystick, w.action1, w.action2].forEach(function (x) { x.el.style.opacity = prof.opacity; });
        // The joystick capture zone: this player's whole half (duo) or the
        // left half (solo), minus a band at the top for the HUD.
        var z = zoneOf(slot), zs = w.zone.style;
        var zx0 = m.layout === "duo" ? z[0] : 0, zx1 = m.layout === "duo" ? z[1] : 0.5;
        var top = 0.14;                          // leave the HUD band alone
        zs.left = (zx0 * size.w) + "px";
        zs.width = ((zx1 - zx0) * size.w) + "px";
        zs.top = Math.round(size.h * top) + "px";
        zs.height = Math.round(size.h * (1 - top)) + "px";
      });
      zones.classList.toggle("is-duo", m.layout === "duo");
    },

    /* --- Per-frame sync from the running game ---------------------- */
    sync: function (game) {
      if (!this.mounted || !this.active) return;
      layer.classList.toggle("is-result", !!(ESA.UI && ESA.UI.isResultVisible()));
      for (var i = 0; i < SLOTS.length; i++) {
        var slot = SLOTS[i];
        var st = game && typeof game.touchState === "function" ? game.touchState(slot) : null;
        var off = !!(st && st.disabled);
        var w = widgets[slot];
        if (w.disabled !== off) {
          w.disabled = off;
          w.joystick.el.classList.toggle("is-disabled", off);
          w.action1.el.classList.toggle("is-disabled", off);
          w.action2.el.classList.toggle("is-disabled", off);
        }
      }
    },

    /** Drop every finger: joysticks recentre, buttons release, drags end. */
    releaseAll: function () {
      SLOTS.forEach(function (slot) {
        var w = widgets[slot];
        if (!w) return;
        releaseJoystick(w.joystick);
        releaseButton(w.action1);
        releaseButton(w.action2);
      });
      tapPointers = Object.create(null);
      if (drag) { try { drag.w.el.releasePointerCapture(drag.pid); } catch (e) {} drag.w.el.classList.remove("is-dragging"); drag = null; }
    },

    /** Current joystick vector (after dead zone), for tests and tooling. */
    joystick: function (slot) { var j = widgets[slot] && widgets[slot].joystick; return j ? { x: j.vx, y: j.vy } : { x: 0, y: 0 }; },

    /* ================================================================ *
     * Control briefing (before the first kickoff) - already shown inside
     * the landscape game, whatever way the phone is held.
     * ================================================================ */
    /** opts: { timers: TimerGroup, onPlay(), onBack(), layout: "duo" | "solo" } */
    preroll: function (def, opts) {
      var gen = ++pre.gen;
      pre.def = def; pre.opts = opts; pre.timers = opts.timers; pre.autoStarted = false;
      this.updateOrientation();
      this._showHelp(gen);
    },

    _showHelp: function (gen) {
      var def = pre.def, t = def.touch || {};
      preEl.className = "tp is-help";
      byId("tpTitle").textContent = def.title;
      byId("tpLines").innerHTML = (t.help || []).map(function (l) {
        var parts = String(l).split(" — ");
        return "<li><b>" + ESA.esc(parts[0]) + "</b>" + (parts[1] ? "<span>" + ESA.esc(parts[1]) + "</span>" : "") + "</li>";
      }).join("");
      byId("tpCustomize").classList.toggle("hidden", !this.hasControls(def));
      // Show the controls underneath so players see where they are (in the
      // match's own layout: Solo shows the single human control set).
      this.mount(def, { onTap: this.tapHandler, layout: (pre.opts && pre.opts.layout) || "duo" });
      var bar = byId("tpBar");
      bar.classList.remove("is-running");
      void bar.offsetWidth;
      bar.classList.add("is-running");
      pre.timers.after(HELP_AUTOSTART_MS, function () {
        if (gen !== pre.gen || Touch.editorOpen || pre.autoStarted) return;
        Touch._play();
      });
    },

    _play: function () {
      if (pre.autoStarted) return;
      pre.autoStarted = true;
      var opts = pre.opts;
      this.cancelPreroll();
      if (opts && opts.onPlay) opts.onPlay();
    },

    cancelPreroll: function () {
      pre.gen++;
      if (preEl) preEl.className = "tp hidden";
    },

    prerollVisible: function () { return !!preEl && !preEl.classList.contains("hidden"); },

    /* ================================================================ *
     * Control Setup editor
     * ================================================================ */
    openEditor: function (onClose) {
      if (!this.mounted || !this.hasControls(this.mounted.def)) return;
      this.releaseAll();
      this.editorOpen = true;
      this.editing = true;
      this._onClose = onClose || null;
      this.editSlot = this.mounted.slots[0];
      layer.classList.add("is-editing");
      edEl.classList.remove("hidden", "is-collapsed");
      document.body.classList.add("touch-editing");
      bar(false);
      this._renderEditor();
      this.layout();
    },

    closeEditor: function (silent) {
      if (!this.editorOpen) return;
      this.editorOpen = false;
      this.editing = false;
      this.releaseAll();
      layer.classList.remove("is-editing");
      edEl.classList.add("hidden");
      document.body.classList.remove("touch-editing");
      saveSettings();
      var cb = this._onClose;
      this._onClose = null;
      if (!silent && cb) cb();
    },

    resetSettings: function () {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) {}
      this.settings = defaults();
      saveSettings();
      this._renderEditor();
      this.layout();
    },

    _renderEditor: function () {
      var m = this.mounted;
      if (!m) return;
      var prof = this.profile(this.editSlot);
      byId("teTabs").classList.toggle("hidden", m.slots.length < 2);
      var tabs = byId("teTabs").querySelectorAll("button");
      for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("is-on", tabs[i].getAttribute("data-slot") === this.editSlot);
      byId("teJoy").value = Math.round(prof.joyScale * 100);
      byId("teOpacity").value = Math.round(prof.opacity * 100);
      edEl.style.setProperty("--slot", ESA.CONTROLS[this.editSlot].color);
    },

    _zoneOf: zoneOf
  };
  ESA.Touch = Touch;

  /* ================================================================== *
   * Touch wording (static markup uses .desk-only / .touch-only spans;
   * a few dynamic strings are swapped here).
   * ================================================================== */
  function applyWording() {
    var on = Touch.active;
    var nodes = document.querySelectorAll("[data-touch-text]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n.hasAttribute("data-desk-text")) n.setAttribute("data-desk-text", n.textContent);
      n.textContent = on ? n.getAttribute("data-touch-text") : n.getAttribute("data-desk-text");
    }
  }
  Touch.applyWording = applyWording;

  /* ================================================================== *
   * Geometry - everything in the control region's LOCAL (landscape)
   * frame. With body.vland the gameplay layers are rotated 90deg
   * clockwise, so local top = screen right and local left = screen top.
   * ================================================================== */

  /**
   * Screen point -> element-local point: the exact inverse of the
   * gameplay rotation. getBoundingClientRect() of a rotated element is its
   * screen-space box; its local origin (top-left) sits at the box's
   * top-RIGHT corner.
   */
  function localPoint(el, cx, cy) {
    var r = el.getBoundingClientRect();
    if (Touch.rotated) return { x: cy - r.top, y: r.right - cx, w: r.height, h: r.width };
    return { x: cx - r.left, y: cy - r.top, w: r.width, h: r.height };
  }

  /** Live viewport size for the CSS (--app-w / --app-h), never 100vh. */
  var vpW = 0, vpH = 0;
  function measureViewport() {
    var w = window.innerWidth, h = window.innerHeight;
    if (w === vpW && h === vpH) return;
    vpW = w; vpH = h;
    var s = document.documentElement.style;
    s.setProperty("--app-w", w + "px");
    s.setProperty("--app-h", h + "px");
  }
  Touch.localPoint = localPoint;

  function regionSize() { return { w: safe.offsetWidth, h: safe.offsetHeight }; }

  /** Base sizes from the viewport's short side, capped for tablets (thumb-sized, never giant). */
  function sizes() {
    var vmin = Math.min(window.innerWidth, window.innerHeight);
    return { joy: clamp(vmin * 0.27, 96, 140), btn: clamp(vmin * 0.17, 62, 86) };
  }

  /** Horizontal fraction of the control region a slot may use. */
  function zoneOf(slot) {
    var m = Touch.mounted;
    if (!m || m.layout !== "duo") return [0, 1];
    return slot === "p1" ? [0, 0.5] : [0.5, 1];
  }

  var gutterPx = -1;
  function setGutter(px) {
    if (px === gutterPx) return;
    gutterPx = px;
    document.documentElement.style.setProperty("--touch-gutter", px + "px");
  }

  /** Clamp a centre point (px) so a widget of diameter d stays in its zone. */
  function clampCentre(slot, cx, cy, d, size) {
    var z = zoneOf(slot), pad = 4;
    var zl = size.w * z[0] + d / 2 + pad, zr = size.w * z[1] - d / 2 - pad;
    cx = zl > zr ? (zl + zr) / 2 : clamp(cx, zl, zr);
    var top = d / 2 + pad, bot = size.h - d / 2 - pad;
    cy = top > bot ? size.h / 2 : clamp(cy, top, bot);
    return { x: cx, y: cy };
  }

  function place(w, slot, key, d, size) {
    var p = Touch.profile(slot).pos[key];
    var c = clampCentre(slot, p.x * size.w, p.y * size.h, d, size);
    w.d = d;
    w.el.style.width = d + "px";
    w.el.style.height = d + "px";
    w.el.style.left = (c.x - d / 2) + "px";
    w.el.style.top = (c.y - d / 2) + "px";
  }

  /* ================================================================== *
   * Widgets
   * ================================================================== */
  function buildLayer() {
    layer = document.createElement("div");
    layer.id = "touchLayer";
    layer.className = "touch-layer hidden";
    layer.setAttribute("aria-hidden", "true");
    safe = document.createElement("div");
    safe.className = "tc-safe";
    layer.appendChild(safe);

    zones = document.createElement("div");
    zones.className = "tc-zones";
    zones.innerHTML = '<div class="tc-zone p1"><span>P1 ZONE</span></div><div class="tc-zone p2"><span>P2 ZONE</span></div>';
    safe.appendChild(zones);

    SLOTS.forEach(function (slot) {
      var color = ESA.CONTROLS[slot].color;

      // Invisible capture area: touch anywhere on your half to grab the
      // joystick there (it floats to your thumb, then returns home).
      var zone = document.createElement("div");
      zone.className = "tc-capture hidden";
      zone.setAttribute("data-slot", slot);
      safe.appendChild(zone);

      var joy = document.createElement("div");
      joy.className = "tc-joy hidden";
      joy.setAttribute("data-slot", slot);
      joy.style.setProperty("--slot", color);
      joy.innerHTML = '<div class="tc-joy-base"><i class="tc-ticks"></i><div class="tc-joy-knob"></div></div>' +
                      '<span class="tc-tag">' + ESA.CONTROLS[slot].short + '</span><span class="tc-stun">STUNNED</span>';
      safe.appendChild(joy);
      var jw = { el: joy, knob: joy.querySelector(".tc-joy-knob"), slot: slot, key: "joystick",
                 pid: null, vx: 0, vy: 0, d: 120, home: null, floating: false };
      wireJoystick(jw, zone);

      var acts = {};
      ["action1", "action2"].forEach(function (a) {
        var btn = document.createElement("div");
        btn.className = "tc-btn hidden";
        btn.setAttribute("data-slot", slot);
        btn.style.setProperty("--slot", color);
        btn.innerHTML = '<span class="tc-btn-label"></span><span class="tc-tag">' + ESA.CONTROLS[slot].short + '</span>';
        safe.appendChild(btn);
        var bw = { el: btn, label: btn.querySelector(".tc-btn-label"), slot: slot, key: a, action: a, pid: null, d: 80 };
        wireButton(bw);
        acts[a] = bw;
      });
      widgets[slot] = { joystick: jw, action1: acts.action1, action2: acts.action2, zone: zone, disabled: false };
    });

    document.body.appendChild(layer);
  }

  function capture(el, pid) { try { el.setPointerCapture(pid); } catch (e) {} }
  function uncapture(el, pid) { try { if (el.hasPointerCapture(pid)) el.releasePointerCapture(pid); } catch (e) {} }

  /** Release whichever widget is held by finger `pid` (wherever its events went). */
  function releasePointer(pid) {
    SLOTS.forEach(function (slot) {
      var w = widgets[slot];
      if (!w) return;
      if (w.joystick.pid === pid) releaseJoystick(w.joystick);
      if (w.action1.pid === pid) releaseButton(w.action1);
      if (w.action2.pid === pid) releaseButton(w.action2);
    });
  }

  /** A primary touch means no other finger is down: anything still held is stale. */
  function releaseStale(pid) {
    SLOTS.forEach(function (slot) {
      var w = widgets[slot];
      if (!w) return;
      if (w.joystick.pid !== null && w.joystick.pid !== pid) releaseJoystick(w.joystick);
      if (w.action1.pid !== null && w.action1.pid !== pid) releaseButton(w.action1);
      if (w.action2.pid !== null && w.action2.pid !== pid) releaseButton(w.action2);
    });
  }

  /* --- Joystick --------------------------------------------------- */
  function wireJoystick(w, zone) {
    function start(e, el, floating) {
      e.preventDefault();
      if (Touch.editing) { if (!floating) startDrag(w, e); return; }
      if (w.pid === e.pointerId) return;
      // A new finger always wins: whatever held the stick before is either
      // gone (a lost pointerup) or a second thumb - never block fresh input.
      if (w.pid !== null) releaseJoystick(w);
      w.pid = e.pointerId;
      w.captor = el;
      capture(el, e.pointerId);
      w.el.classList.add("is-active");
      if (floating) {
        // Float the pad so its centre sits under the thumb (clamped to the zone).
        var p = localPoint(safe, e.clientX, e.clientY);
        var c = clampCentre(w.slot, p.x, p.y, w.d, regionSize());
        w.floating = true;
        w.el.classList.add("is-floating");
        w.el.style.left = (c.x - w.d / 2) + "px";
        w.el.style.top = (c.y - w.d / 2) + "px";
      }
      moveJoystick(w, e);
    }
    function move(e) {
      if (drag && drag.pid === e.pointerId) { moveDrag(e); return; }
      if (e.pointerId === w.pid) { e.preventDefault(); moveJoystick(w, e); }
    }
    function end(e) {
      if (drag && drag.pid === e.pointerId) { endDrag(); return; }
      if (e.pointerId === w.pid) releaseJoystick(w);
    }
    w.el.addEventListener("pointerdown", function (e) { start(e, w.el, false); }, { passive: false });
    zone.addEventListener("pointerdown", function (e) { start(e, zone, true); }, { passive: false });
    [w.el, zone].forEach(function (el) {
      el.addEventListener("pointermove", move, { passive: false });
      el.addEventListener("pointerup", end);
      el.addEventListener("pointercancel", end);
      el.addEventListener("lostpointercapture", end);
    });
  }

  function moveJoystick(w, e) {
    var p = localPoint(w.el, e.clientX, e.clientY);
    var travel = p.w * 0.34;
    var dx = (p.x - p.w / 2) / travel;
    var dy = (p.y - p.h / 2) / travel;
    var len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; len = 1; }
    if (len < DEADZONE || !isFinite(len)) {
      w.vx = 0; w.vy = 0;
      w.knob.style.transform = "translate(" + (dx * travel).toFixed(1) + "px," + (dy * travel).toFixed(1) + "px)";
      return;
    }
    var m = Math.min(1, ((len - DEADZONE) / (1 - DEADZONE)) / FULL_AT);
    var mag = 1 - (1 - m) * (1 - m);                  // ease-out: quick to useful speed
    var ux = dx / len, uy = dy / len;
    w.vx = ux * mag;
    w.vy = uy * mag;
    // Knob shows the magnitude the game receives (never behind the thumb).
    var k = Math.max(len, mag) * travel;
    w.knob.style.transform = "translate(" + (ux * k).toFixed(1) + "px," + (uy * k).toFixed(1) + "px)";
  }

  function releaseJoystick(w) {
    if (w.pid !== null && w.captor) uncapture(w.captor, w.pid);
    w.pid = null;
    w.captor = null;
    w.vx = 0; w.vy = 0;
    w.knob.style.transform = "";
    w.el.classList.remove("is-active");
    if (w.floating) {
      w.floating = false;
      w.el.classList.remove("is-floating");
      if (w.home) { w.el.style.left = w.home.left; w.el.style.top = w.home.top; }
    }
  }

  function touchVector(slot) {
    if (!Touch.active || !Touch.mounted || Touch.editing) return null;
    var j = widgets[slot] && widgets[slot].joystick;
    if (!j || j.pid === null || (!j.vx && !j.vy)) return null;
    return { x: j.vx, y: j.vy };
  }

  /* --- Action buttons ---------------------------------------------- */
  function wireButton(w) {
    w.el.addEventListener("pointerdown", function (e) {
      e.preventDefault();
      if (Touch.editing) { startDrag(w, e); return; }
      if (w.pid === e.pointerId) return;
      if (w.pid !== null) releaseButton(w);       // stale owner: take over (see STALE POINTERS)
      w.pid = e.pointerId;
      capture(w.el, e.pointerId);
      w.el.classList.add("is-down");
      ESA.Controls.fireAction(w.slot, w.action, "touch");
    }, { passive: false });
    w.el.addEventListener("pointermove", function (e) {
      if (drag && drag.pid === e.pointerId) moveDrag(e);
    });
    var end = function (e) {
      if (drag && drag.pid === e.pointerId) { endDrag(); return; }
      if (e.pointerId === w.pid) releaseButton(w);
    };
    w.el.addEventListener("pointerup", end);
    w.el.addEventListener("pointercancel", end);
    w.el.addEventListener("lostpointercapture", end);
  }

  function releaseButton(w) {
    if (w.pid !== null) uncapture(w.el, w.pid);
    w.pid = null;
    w.el.classList.remove("is-down");
  }

  /* --- Edit-mode dragging ------------------------------------------ */
  function startDrag(w, e) {
    if (drag) return;
    if (Touch.mounted && Touch.mounted.slots.length > 1) {
      Touch.editSlot = w.slot;
      Touch._renderEditor();
    }
    var p = localPoint(safe, e.clientX, e.clientY);
    var left = parseFloat(w.el.style.left) || 0, top = parseFloat(w.el.style.top) || 0;
    drag = { pid: e.pointerId, w: w, offX: p.x - (left + w.d / 2), offY: p.y - (top + w.d / 2) };
    capture(w.el, e.pointerId);
    w.el.classList.add("is-dragging");
  }

  function moveDrag(e) {
    var size = regionSize(), w = drag.w;
    var p = localPoint(safe, e.clientX, e.clientY);
    var c = clampCentre(w.slot, p.x - drag.offX, p.y - drag.offY, w.d, size);
    var pos = Touch.profile(w.slot).pos[w.key];
    pos.x = c.x / size.w;
    pos.y = c.y / size.h;
    Touch.layout();
  }

  function endDrag() {
    var w = drag.w;
    uncapture(w.el, drag.pid);
    w.el.classList.remove("is-dragging");
    drag = null;
    saveSettings();
  }

  /* --- Direct taps on the game canvas (Bonk Booth) ----------------- */
  function onCanvasDown(e) {
    if (!Touch.active || !Touch.tapHandler || Touch.editing) return;
    if (e.pointerType === "mouse") return;            // desktop stays keyboard-driven
    e.preventDefault();
    if (tapPointers[e.pointerId]) return;             // one tap per finger
    tapPointers[e.pointerId] = true;
    var p = localPoint(canvas, e.clientX, e.clientY);
    if (!p.w || !p.h) return;
    Touch.tapHandler(p.x / p.w * ESA.W, p.y / p.h * ESA.H, e.pointerId);
  }
  function onCanvasUp(e) { delete tapPointers[e.pointerId]; }

  /* ================================================================== *
   * Pre-roll + editor DOM (built once)
   * ================================================================== */
  function buildPreroll() {
    preEl = document.createElement("div");
    preEl.id = "touchPreroll";
    preEl.className = "tp hidden";
    preEl.innerHTML =
      '<div class="tp-rotate">' +
        '<div class="tp-phone"><span class="tp-phone-screen"><i></i></span></div>' +
        '<div class="tp-kicker">ESA ARCADE</div>' +
        '<div class="tp-head">ROTATE TO PLAY</div>' +
        '<div class="tp-sub">Turn your device sideways for the game</div>' +
        '<div class="tp-count" id="tpCount">3</div>' +
      '</div>' +
      '<div class="tp-help">' +
        '<div class="tp-kicker">HOW TO PLAY</div>' +
        '<div class="tp-title" id="tpTitle"></div>' +
        '<ul class="tp-lines" id="tpLines"></ul>' +
        '<div class="tp-actions">' +
          '<button class="btn btn-ghost btn-small" type="button" id="tpBack">Back</button>' +
          '<button class="btn btn-ghost btn-small" type="button" id="tpCustomize">&#9881; Controls</button>' +
          '<button class="btn btn-gold" type="button" id="tpPlay">Play &#9654;</button>' +
        '</div>' +
        '<div class="tp-bar"><i id="tpBar"></i></div>' +
      '</div>';
    document.body.appendChild(preEl);

    byId("tpPlay").addEventListener("click", function () { Touch._play(); });
    byId("tpBack").addEventListener("click", function () {
      var opts = pre.opts;
      Touch.cancelPreroll();
      if (opts && opts.onBack) opts.onBack();
    });
    byId("tpCustomize").addEventListener("click", function () {
      bar(false);
      preEl.classList.add("is-under-editor");
      Touch.openEditor(function () { preEl.classList.remove("is-under-editor"); });
    });
  }

  function bar(on) {
    var b = byId("tpBar");
    if (b && !on) b.classList.remove("is-running");
  }

  function buildEditor() {
    // Lives inside the control layer, above the play scene.
    edEl = document.createElement("div");
    edEl.id = "touchEditor";
    edEl.className = "te hidden";
    edEl.innerHTML =
      '<div class="te-head"><span>&#9881; Controls</span>' +
        '<button type="button" class="te-collapse" id="teCollapse" aria-label="Collapse">&#9662;</button></div>' +
      '<div class="te-body">' +
        '<p class="te-tip">Drag the joystick and buttons to move them.</p>' +
        '<div class="te-tabs" id="teTabs">' +
          '<button type="button" data-slot="p1">P1</button><button type="button" data-slot="p2">P2</button></div>' +
        '<label class="te-row" id="teJoyRow"><span>Size</span><input type="range" id="teJoy" min="70" max="140" step="1"></label>' +
        '<label class="te-row"><span>Visibility</span><input type="range" id="teOpacity" min="30" max="100" step="1"></label>' +
        '<div class="te-actions">' +
          '<button class="btn btn-ghost btn-small" type="button" id="teSwap">&#8646; Swap</button>' +
          '<button class="btn btn-ghost btn-small" type="button" id="teReset">Reset</button>' +
          '<button class="btn btn-gold btn-small" type="button" id="teDone">Done</button>' +
        '</div>' +
      '</div>';
    layer.appendChild(edEl);

    var tabs = edEl.querySelectorAll("#teTabs button");
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener("click", function () {
        Touch.editSlot = this.getAttribute("data-slot");
        Touch._renderEditor();
      });
    }
    // One "Size" slider scales the whole control set (joystick + buttons).
    byId("teJoy").addEventListener("input", function () {
      var p = Touch.profile(Touch.editSlot), v = clamp(Number(this.value) / 100, 0.7, 1.4);
      p.joyScale = v; p.btnScale = v;
      Touch.layout();
    });
    byId("teOpacity").addEventListener("input", function () {
      Touch.profile(Touch.editSlot).opacity = clamp(Number(this.value) / 100, 0.3, 1);
      Touch.layout();
    });
    byId("teJoy").addEventListener("change", saveSettings);
    byId("teOpacity").addEventListener("change", saveSettings);
    byId("teSwap").addEventListener("click", function () {
      // Mirror this player's controls inside their own zone.
      var prof = Touch.profile(Touch.editSlot), z = zoneOf(Touch.editSlot);
      for (var k in prof.pos) prof.pos[k].x = clamp(z[0] + z[1] - prof.pos[k].x, 0, 1);
      prof.swapped = !prof.swapped;
      Touch.layout();
      saveSettings();
    });
    byId("teReset").addEventListener("click", function () { Touch.resetSettings(); });
    byId("teDone").addEventListener("click", function () { Touch.closeEditor(); });
    byId("teCollapse").addEventListener("click", function () { edEl.classList.toggle("is-collapsed"); });
  }

})(window.ESA);
