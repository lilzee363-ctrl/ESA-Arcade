/* ==========================================================================
   ESA ARCADE - APPLICATION CORE
   ESA.App    : the state machine. Every screen is a registered controller;
                every screen change goes through App.go(), behind the veil.
   ESA.Modal  : the overlay stack (pause menu, confirmations, peeks). While
                a modal is open it receives ALL input - nothing leaks through.
   Game runs  : exactly one game instance exists at a time. Entering the
                play screen creates it; leaving the play screen destroys it.

   Screen controller shape (all optional except el):
     el          id of the <section class="screen">
     parent      screen name (or function) that Back / Esc returns to
     back()      custom Back behaviour (e.g. a confirmation first)
     enter(p)    build the screen (runs hidden behind the veil)
     afterEnter  runs once the veil has cleared
     leave()     tear down anything the screen started
     onKey(code) keyboard input for this screen
     gameplay    true for the play screen: freezes menu decoration
     topbar      false hides the global BACK bar
     crumb       short label shown next to BACK
     ownsConfirmKeys  true if Enter/Space are game controls on this screen

   Screen-scoped timers: anything a screen schedules goes through
   App.timers, which is cleared on EVERY screen change. Old callbacks can
   never mutate a new screen.
   ========================================================================== */

(function (ESA) {
  "use strict";

  function isConfirm(code) { return code === "Enter" || code === "NumpadEnter" || code === "Space"; }
  function isEnter(code) { return code === "Enter" || code === "NumpadEnter"; }
  ESA.isConfirm = isConfirm;
  ESA.isEnter = isEnter;

  /* ================================================================== *
   * App
   * ================================================================== */
  var App = {
    state: null,
    params: {},
    screens: Object.create(null),
    timers: new ESA.TimerGroup(),

    /** Shared, cross-screen session data. */
    session: {
      mode: null,                       // "casual" | "solo" | "tournament"
      solo: null,                       // Solo flow state (js/solo.js)
      setup: null,                      // casual { p1, p2 } PARTICIPANT ids
      libraryIndex: 0,
      tournament: null                  // ESA.Tournament while one is live
    },

    register: function (name, ctrl) {
      ctrl.name = name;
      this.screens[name] = ctrl;
    },

    current: function () { return this.screens[this.state] || null; },

    /**
     * Change screen. Ignored while a transition is already running, which
     * makes double clicks and key mashing harmless.
     */
    go: function (name, params) {
      var next = this.screens[name];
      if (!next) { console.warn("[ESA] Unknown screen:", name); return false; }
      if (ESA.Screens.busy) return false;

      var self = this;
      var prev = this.current();

      ESA.Screens.go(next.el, function () {
        self._swap(prev, next, name, params);
      }, function () {
        if (self._redirect) {
          var to = self._redirect;
          self._redirect = null;
          self.go(to);
          return;
        }
        if (self.state === name && typeof next.afterEnter === "function") next.afterEnter(self.params);
      });
      return true;
    },

    /** Ask for a different screen from inside enter(); runs once the veil clears. */
    redirect: function (name) { this._redirect = name; },

    /** Immediate switch with no veil - used once at boot. */
    boot: function (name, params) {
      var next = this.screens[name];
      this._swap(null, next, name, params);
      ESA.Screens.set(next.el);
      if (typeof next.afterEnter === "function") next.afterEnter(this.params);
    },

    _swap: function (prev, next, name, params) {
      this.timers.clear();
      Modal.clear();
      if (prev && typeof prev.leave === "function") {
        try { prev.leave(name); } catch (e) { console.error("[ESA] leave failed:", e); }
      }

      this.state = name;
      this.params = params || {};
      document.body.setAttribute("data-state", name);
      document.body.classList.toggle("is-gameplay", !!next.gameplay);
      ESA.Input.setMode(next.gameplay ? "play" : "menu");

      if (typeof next.enter === "function") {
        try { next.enter(this.params, prev && prev.name); }
        catch (e) { console.error("[ESA] enter failed:", e); }
      }
      Topbar.update(next);
      if (ESA.Attract) ESA.Attract.onScreen(name, next);
      if (ESA.Touch && ESA.Touch.onScreen) ESA.Touch.onScreen(name);
    },

    /** Logical Back for the current screen. */
    back: function () {
      var c = this.current();
      if (!c || Modal.active() || ESA.Screens.busy) return;
      if (typeof c.back === "function") { c.back(); return; }
      var parent = typeof c.parent === "function" ? c.parent() : c.parent;
      if (parent) {
        ESA.Audio.play("uiBack");
        this.go(parent);
      }
    },

    /** The single keyboard entry point (wired to ESA.Input.onPress). */
    handleKey: function (code, e) {
      // The touch Control Setup editor owns the screen while it is open.
      if (ESA.Touch && ESA.Touch.editorOpen) {
        if (code === "Escape") { e.preventDefault(); ESA.Touch.closeEditor(); }
        return;
      }
      if (ESA.Screens.busy) {
        if (code === "Space" || code === "Enter") e.preventDefault();
        return;
      }

      if (Modal.active()) {
        // Custom sheets (variant chooser, guest creator) manage their own
        // keys - Tab and typing must keep working inside them.
        if (Modal.top().type === "custom") { Modal.onKey(code, e); return; }
        if (code === "Escape" || isConfirm(code) || code === "Tab") e.preventDefault();
        Modal.onKey(code, e);
        return;
      }

      var c = this.current();
      if (!c) return;

      if (code === "Escape") {
        e.preventDefault();
        if (typeof c.onEscape === "function") c.onEscape();
        else this.back();
        return;
      }

      // A keyboard-focused button (Tab users) takes Enter / Space first.
      if (isConfirm(code) && !c.gameplay && !c.ownsConfirmKeys) {
        var ae = document.activeElement;
        if (ae && ae.tagName === "BUTTON" && ae.offsetParent !== null && !ae.disabled) {
          e.preventDefault();
          ae.click();
          return;
        }
      }
      if (isConfirm(code) && !c.gameplay) e.preventDefault();

      if (typeof c.onKey === "function") c.onKey(code, e);
    }
  };
  ESA.App = App;

  /* ================================================================== *
   * Global top bar - one consistent BACK control.
   * ================================================================== */
  var Topbar = {
    el: null, btn: null, label: null, crumb: null,

    init: function () {
      this.el = ESA.byId("topbar");
      this.btn = ESA.byId("backBtn");
      this.label = this.btn.querySelector(".bb-label");
      this.crumb = ESA.byId("topbarCrumb");
      this.btn.addEventListener("click", function () { App.back(); });
    },

    update: function (ctrl) {
      var showBack = ctrl.topbar !== false && !!(ctrl.parent || ctrl.back);
      this.el.classList.toggle("is-hidden", ctrl.topbar === false);
      this.btn.classList.toggle("hidden", !showBack);
      this.label.textContent = ctrl.backLabel || "Back";
      this.crumb.textContent = ctrl.crumb || "";
    }
  };

  /* ================================================================== *
   * Modal stack
   * ================================================================== */
  var Modal = {
    stack: [],
    layer: null,

    init: function () { this.layer = ESA.byId("modalLayer"); },

    active: function () { return this.stack.length > 0; },
    top: function () { return this.stack[this.stack.length - 1] || null; },

    push: function (m) {
      m.focus = m.focus || 0;
      this.stack.push(m);
      this.render();
    },

    pop: function () {
      this.stack.pop();
      this.render();
    },

    clear: function () {
      if (!this.stack.length && this.layer.classList.contains("hidden")) return;
      this.stack.length = 0;
      this.render();
    },

    /**
     * Destructive confirmation. The SAFE option is first and focused.
     * opts: { title, body, safe: label, danger: label, onConfirm, onCancel }
     */
    confirm: function (opts) {
      this.push({
        type: "confirm",
        title: opts.title,
        body: opts.body,
        buttons: [
          { label: opts.safe, kind: "safe", action: function () { Modal.pop(); if (opts.onCancel) opts.onCancel(); } },
          { label: opts.danger, kind: "danger", action: function () { Modal.clear(); opts.onConfirm(); } }
        ],
        onEscape: function () { Modal.pop(); if (opts.onCancel) opts.onCancel(); }
      });
      ESA.Audio.play("denied");
    },

    _buttons: function (m) { return m.type === "menu" ? m.items : m.buttons; },

    render: function () {
      var layer = this.layer;
      var m = this.top();
      layer.innerHTML = "";
      layer.classList.toggle("hidden", !m);
      if (!m) return;

      var card = document.createElement("div");
      card.className = "modal-card modal-" + m.type;

      // Custom sheets build their own content (DOM APIs only - user text
      // such as guest nicknames is never parsed as HTML).
      if (m.type === "custom") {
        if (m.cls) card.className += " " + m.cls;
        layer.appendChild(card);
        m.build(card, m);
        return;
      }

      if (m.kicker) {
        var k = document.createElement("div");
        k.className = "modal-kicker";
        k.textContent = m.kicker;
        card.appendChild(k);
      }
      var h = document.createElement("h2");
      h.className = "modal-title";
      h.textContent = m.title;
      card.appendChild(h);

      if (m.body) {
        var p = document.createElement("p");
        p.className = "modal-body";
        p.textContent = m.body;
        card.appendChild(p);
      }
      if (m.html) {
        var box = document.createElement("div");
        box.className = "modal-html";
        box.innerHTML = m.html;
        card.appendChild(box);
      }

      var list = document.createElement("div");
      list.className = m.type === "menu" ? "modal-menu" : "modal-actions";
      var self = this;
      this._buttons(m).forEach(function (b, i) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "modal-btn" + (b.kind ? " is-" + b.kind : "") + (i === m.focus ? " is-focus" : "");
        btn.innerHTML = '<span class="mb-cursor" aria-hidden="true"></span><span class="mb-label"></span>';
        btn.querySelector(".mb-label").textContent = b.label;
        btn.addEventListener("mouseenter", function () { self._setFocus(i); });
        btn.addEventListener("click", function () {
          ESA.Audio.play("uiClick");
          b.action();
        });
        list.appendChild(btn);
      });
      card.appendChild(list);

      var hint = document.createElement("div");
      hint.className = "modal-hint";
      hint.innerHTML = m.type === "menu"
        ? "<b>&uarr; &darr;</b> choose &middot; <b>Enter</b> select &middot; <b>Esc</b> " + (m.escLabel || "resume")
        : "<b>&larr; &rarr;</b> choose &middot; <b>Enter</b> confirm &middot; <b>Esc</b> cancel";
      card.appendChild(hint);

      layer.appendChild(card);
    },

    _setFocus: function (i) {
      var m = this.top();
      if (!m) return;
      var n = this._buttons(m).length;
      var next = (i + n) % n;
      if (next !== m.focus) ESA.Audio.play("uiMove");
      m.focus = next;
      var btns = this.layer.querySelectorAll(".modal-btn");
      for (var k = 0; k < btns.length; k++) btns[k].classList.toggle("is-focus", k === m.focus);
    },

    onKey: function (code, e) {
      var m = this.top();
      if (!m) return;
      if (m.type === "custom") {
        if (m.onKey && m.onKey(code, e)) return;
        if (code === "Escape") {
          if (e) e.preventDefault();
          ESA.Audio.play("uiBack");
          if (m.onEscape) m.onEscape(); else this.pop();
          return;
        }
        // Enter / Space press the focused button inside the sheet.
        if (isConfirm(code)) {
          var ae = document.activeElement;
          if (ae && ae.tagName === "BUTTON" && this.layer.contains(ae) && !ae.disabled) {
            if (e) e.preventDefault();
            ae.click();
          }
        }
        return;
      }
      var vertical = m.type === "menu";
      var prevKeys = vertical ? ["ArrowUp", "KeyW"] : ["ArrowLeft", "KeyA", "ArrowUp", "KeyW"];
      var nextKeys = vertical ? ["ArrowDown", "KeyS"] : ["ArrowRight", "KeyD", "ArrowDown", "KeyS"];

      if (code === "Escape") {
        ESA.Audio.play("uiBack");
        if (m.onEscape) m.onEscape(); else this.pop();
      } else if (prevKeys.indexOf(code) >= 0) {
        this._setFocus(m.focus - 1);
      } else if (nextKeys.indexOf(code) >= 0 || code === "Tab") {
        this._setFocus(m.focus + 1);
      } else if (isConfirm(code)) {
        var b = this._buttons(m)[m.focus];
        if (b) { ESA.Audio.play("uiClick"); b.action(); }
      }
    }
  };
  ESA.Modal = Modal;

  /* ================================================================== *
   * Game run lifecycle
   * ================================================================== */
  var Run = null;          // { token, def, setup, context, players, game, cpu, ended, paused, resultAt }
  var runToken = 0;
  var rafId = 0;
  var lastTime = 0;
  var playEl = null;

  /* --- The one and only game loop --------------------------------- */
  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (!Run || !Run.game || Run.paused) return;

    var dt = Math.min((now - lastTime) / 1000, 0.033);
    lastTime = now;

    // Hit-stop pauses simulation but keeps shake and rendering alive.
    if (!ESA.Stage.isFrozen(now)) {
      // A CPU decides its stick/buttons first, exactly like a human's
      // input arriving before the frame; the game then applies it.
      if (Run.cpu) Run.cpu.update(dt, Run.game);
      Run.game.update(dt, now);
    }
    ESA.Stage.updateFX(dt);
    if (ESA.Touch) ESA.Touch.sync(Run.game);

    var ctx = ESA.Stage.begin();
    Run.game.draw(ctx, now);
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

  function teardownRun() {
    stopLoop();
    if (Run && Run.game) {
      try { Run.game.destroy(); } catch (e) { console.error("[ESA] destroy failed:", e); }
    }
    if (Run && Run.cpu) Run.cpu.destroy();
    ESA.Controls.release();                 // every slot back to the human sources
    ESA.Controls.setKeyboardAlias(false);
    Run = null;
    if (ESA.Touch) ESA.Touch.unmount();     // pointers, overlays, pre-roll, editor
    ESA.UI.clearAll();
    ESA.Stage.resetFX();
    ESA.Input.clear();
    if (playEl) playEl.classList.remove("is-paused");
  }

  function onMatchEnd(token, result) {
    // Stale games (already torn down) and duplicate calls are ignored.
    if (!Run || Run.token !== token || Run.ended) return;
    Run.ended = true;
    Run.resultAt = performance.now();
    ESA.Input.clear();

    var out;
    if (Run.cpu) Run.cpu.reset();
    if (Run.context.mode === "tournament" && ESA.TournamentUI) {
      out = ESA.TournamentUI.onMatchEnd(Run, result);
    } else if (Run.context.mode === "solo" && ESA.Solo) {
      out = ESA.Solo.onMatchEnd(Run, result);
    } else {
      out = { result: result, actions: casualResultActions() };
    }
    ESA.UI.showResult(out.result, out.actions);
  }

  function casualResultActions() {
    var params = App.params;
    return [
      { label: "Rematch", kind: "gold", onClick: function () { App.startMatch(params.def, params.setup, params.context); } },
      { label: "Game Library", kind: "ghost", onClick: function () { ESA.Audio.play("uiBack"); App.go("library"); } },
      { label: "Change Players", kind: "ghost", onClick: function () { ESA.Audio.play("uiBack"); App.go("charSelect"); } }
    ];
  }

  /* --- Pause ------------------------------------------------------ */
  function pause() {
    if (!Run || !Run.game || Run.paused || Run.ended) return;
    Run.paused = true;
    if (Run.game.timers && Run.game.timers.pause) Run.game.timers.pause();
    stopLoop();
    ESA.Input.clear();
    if (ESA.Touch) ESA.Touch.releaseAll();
    if (Run.cpu) Run.cpu.reset();               // stick centred, plan dropped
    playEl.classList.add("is-paused");
    ESA.Audio.play("pause");
    Modal.push(Run.context.mode === "tournament" && ESA.TournamentUI ? ESA.TournamentUI.pauseMenu(Run)
      : Run.context.mode === "solo" && ESA.Solo ? ESA.Solo.pauseMenu(Run)
      : casualPauseMenu());
  }

  function resume() {
    if (!Run || !Run.paused) return;
    Modal.clear();
    Run.paused = false;
    ESA.Input.clear();
    if (ESA.Touch) ESA.Touch.releaseAll();
    playEl.classList.remove("is-paused");
    if (Run.game.timers && Run.game.timers.resume) Run.game.timers.resume();
    startLoop();
    ESA.Audio.play("resume");
  }

  function leaveMatchConfirm(onConfirm) {
    Modal.confirm({
      title: "Leave Match?",
      body: "Current match progress will be lost.",
      safe: "Continue Playing",
      danger: "Exit Match",
      onConfirm: onConfirm
    });
  }

  function casualPauseMenu() {
    var params = App.params;
    return {
      type: "menu",
      kicker: Run.def.title,
      title: "Paused",
      onEscape: resume,
      items: withTouchSetup([
        { label: "Resume", kind: "safe", action: resume },
        { label: "Restart Match", action: function () {
          Modal.confirm({
            title: "Restart Match?",
            body: "The current score will be wiped and the match starts again.",
            safe: "Keep Playing", danger: "Restart",
            onConfirm: function () { App.startMatch(params.def, params.setup, params.context); }
          });
        } },
        { label: "Change Players", action: function () {
          leaveMatchConfirm(function () { App.go("charSelect"); });
        } },
        { label: "Back to Arcade", action: function () {
          leaveMatchConfirm(function () { App.go("library"); });
        } },
        { label: "Exit to Welcome", kind: "danger", action: function () {
          leaveMatchConfirm(function () { App.go("welcome"); });
        } }
      ])
    };
  }

  /**
   * On touch devices, adds "Customize Controls" right after Resume. The game
   * is already paused, so nothing moves while controls are edited; Done
   * returns to the same pause menu.
   */
  function withTouchSetup(items) {
    if (!Run || !ESA.Touch || !ESA.Touch.active || !ESA.Touch.hasControls(Run.def)) return items;
    var hidden = false;
    items.splice(1, 0, { label: "Customize Controls", action: function () {
      if (!Modal.layer || hidden) return;
      hidden = true;
      Modal.layer.classList.add("is-under-editor");
      ESA.Touch.openEditor(function () {
        hidden = false;
        Modal.layer.classList.remove("is-under-editor");
      });
    } });
    return items;
  }
  App.withTouchSetup = withTouchSetup;

  /* --- The play screen controller --------------------------------- */
  App.register("play", {
    el: "playScreen",
    gameplay: true,
    topbar: false,

    /**
     * params: { def: game registry entry, setup: { p1, p2 },
     *           context: { mode: "casual" } | { mode: "tournament", matchId, tag }
     *                  | { mode: "solo", matchId, difficulty, cpuSlot, slotTags, hudKeys, tag }
     *                  | { mode: "solo", single: true, matchId, hudKeys, tag }  (Score Attack) }
     */
    enter: function (p, prevName) {
      teardownRun();
      var def = p.def;
      var players = ESA.describeMatchup(p.setup);
      // Build Evil / Guest sprite caches now, behind the veil - never on
      // the first gameplay frame.
      if (ESA.Variants) ESA.SLOTS.forEach(function (s) { ESA.Variants.warm(players[s].character); });
      var single = !!(p.context && p.context.single);
      Run = {
        token: ++runToken,
        def: def,
        setup: p.setup,
        context: p.context || { mode: "casual" },
        players: players,
        game: null,
        cpu: null,
        ended: false,
        paused: false,
        resultAt: 0,
        // Touch players get the rotate + controls briefing when they arrive
        // from a menu - not on every rematch / restart.
        preroll: prevName !== "play"
      };

      var view = ESA.Games.resolve(def, Run.context);
      ESA.UI.configure({
        title: def.title,
        mode: (single && def.solo && def.solo.mode) || view.mode,
        centerLabel: view.hud.centerLabel,
        centerValue: view.hud.centerValue,
        pips: view.hud.pips,
        players: players,
        scheme: def.controls,
        keys: Run.context.hudKeys || null,      // Solo: "YOU · ..." / "CPU · HARD"
        // Score Attack: one player; the right panel shows the session best.
        single: single,
        best: single && ESA.SoloStats ? ESA.SoloStats.best(def.id) : null,
        bestLabel: single ? "Score Attack" : ""
      });

      var tag = ESA.byId("playTag");
      tag.textContent = Run.context.tag || "";
      tag.classList.toggle("hidden", !Run.context.tag);
    },

    // The countdown only begins once the veil has fully cleared.
    afterEnter: function () {
      if (!Run || Run.game) return;
      ESA.Stage.resize();
      var token = Run.token;
      // Touch: the how-to card on arrival from a menu (shown inside the
      // landscape game shell, whichever way the phone is held).
      if (ESA.Touch && ESA.Touch.active && Run.preroll) {
        ESA.Touch.preroll(Run.def, {
          timers: App.timers,
          layout: touchLayout(),
          onPlay: function () { if (Run && Run.token === token) beginRun(); },
          onBack: function () {
            if (!Run || Run.token !== token) return;
            ESA.Audio.play("uiBack");
            var mode = Run.context.mode;
            App.go(mode === "tournament" ? "hub"
              : mode === "solo" ? (Run.context.single ? "soloGames" : "soloDifficulty") : "library");
          }
        });
        return;
      }
      beginRun();
    },

    leave: function () { teardownRun(); },

    onEscape: function () {
      if (!Run) return;
      if (ESA.UI.isResultVisible()) {
        // The match is over: Esc takes the "leave" option, never a rematch.
        if (performance.now() - Run.resultAt < 450) return;
        if (Run.context.mode === "tournament") ESA.UI.triggerDefaultResult();
        else { ESA.Audio.play("uiBack"); App.go(Run.context.mode === "solo" ? "soloGames" : "library"); }
        return;
      }
      pause();
    },

    onKey: function (code) {
      if (!Run || !Run.game || Run.paused) return;
      if (ESA.UI.isResultVisible()) {
        // A short guard stops a key mashed at the final second from
        // instantly triggering the rematch.
        if (isEnter(code) && performance.now() - Run.resultAt > 600) ESA.UI.triggerDefaultResult();
        return;
      }
      if (typeof Run.game.onKeyDown === "function") Run.game.onKeyDown(code);
    }
  });

  /** One human on the device (Solo): one control set, no dead P2 widgets. */
  function touchLayout() {
    return Run && Run.context.mode === "solo" ? "solo" : "duo";
  }

  /** Creates the game instance and starts the one loop. */
  function beginRun() {
    if (!Run || Run.game) return;
    var token = Run.token;
    try {
      Run.game = Run.def.create({
        endMatch: function (r) { onMatchEnd(token, r); },
        context: Run.context
      }, Run.setup);
      Run.game.start();
    } catch (e) {
      console.error("[ESA] Game failed to start:", e);
      Run.game = null;
      return;
    }
    // Solo: the CPU becomes the control source for its slot. The game is
    // not told - it keeps reading ESA.Controls like it always does.
    // Solo: one human on the keyboard - arrows / Enter work for them too.
    ESA.Controls.setKeyboardAlias(Run.context.mode === "solo");
    if (Run.context.mode === "solo" && Run.context.cpuSlot && ESA.CPU) {
      Run.cpu = ESA.CPU.attach(Run.def.id, Run.context.cpuSlot, Run.context.difficulty);
      if (!Run.cpu) console.warn("[ESA] No CPU strategy for", Run.def.id);
    }
    if (ESA.Touch) {
      var g = Run.game;
      ESA.Touch.mount(Run.def, {
        layout: touchLayout(),
        onTap: typeof g.onTap === "function"
          ? function (x, y, pid) { if (Run && Run.game === g && !Run.paused && !Run.ended) g.onTap(x, y, pid); }
          : null
      });
    }
    startLoop();
  }

  /** Launches a match through the play screen. */
  App.startMatch = function (def, setup, context) {
    if (!def || !setup) return false;
    context = context || { mode: "casual" };
    // Every Solo start (first match, rematch, restart) is a NEW match with
    // its own id, so Session Stats can record each result exactly once.
    if (context.mode === "solo" && ESA.SoloStats) {
      var fresh = {};
      for (var k in context) fresh[k] = context[k];
      fresh.matchId = ESA.SoloStats.newMatchId();
      context = fresh;
    }
    ESA.Audio.unlock();
    ESA.Audio.play("start");
    return App.go("play", { def: def, setup: setup, context: context });
  };

  App.pause = pause;
  App.resume = resume;
  App.currentRun = function () { return Run; };

  /* --- Init (called from main.js) --------------------------------- */
  App.init = function () {
    playEl = ESA.byId("playScreen");
    Topbar.init();
    Modal.init();
    ESA.byId("pauseBtn").addEventListener("click", function () {
      if (Run && !ESA.UI.isResultVisible()) pause();
    });
    // Touch: the in-game gear opens Control Setup over the paused match;
    // Done drops back to the pause menu (Resume continues).
    ESA.byId("ctlBtn").addEventListener("click", function () {
      if (!Run || !Run.game || ESA.UI.isResultVisible() || !ESA.Touch) return;
      if (!Run.paused) pause();
      var item = Modal.top() && (Modal.top().items || []).filter(function (it) { return it.label === "Customize Controls"; })[0];
      if (item) item.action();
    });
    ESA.Input.onPress = function (code, e) { App.handleKey(code, e); };
    // Touch buttons (and a future CPU) reach the game through here.
    ESA.Controls.onAction = function (slot, action) {
      if (!Run || !Run.game || Run.paused || Run.ended || ESA.UI.isResultVisible()) return;
      if (typeof Run.game.onAction === "function") Run.game.onAction(slot, action);
    };

    // A paused game stays paused if the tab is hidden; a running one pauses.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden && Run && Run.game && !Run.paused && !Run.ended && App.state === "play") {
        pause();
      }
    });
  };

})(window.ESA);
