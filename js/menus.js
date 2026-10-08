/* ==========================================================================
   ESA ARCADE - MENU SCREENS
   Welcome -> Mode Select -> Character Select -> VS -> Game Library -> Intro

   Everything here is built from the registries (ESA.Characters,
   ESA.Games), so new characters and games appear automatically.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var App = ESA.App;
  var byId = ESA.byId;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  ESA.esc = esc;

  /**
   * Head-and-shoulders portrait <img> for a character. Must sit inside a
   * square, overflow:hidden box (faces, tiles); the crop comes from the
   * registry's trim data so padded and tightly-cropped art look the same.
   */
  function portraitImg(c, cls) {
    return '<img class="' + (cls || "") + '" src="' + esc(c.art.portrait) + '" alt="" ' +
           'style="' + esc(ESA.headStyle(c)) + '" />';
  }
  ESA.portraitImg = portraitImg;

  /** Key caps markup for a slot in a given scheme. */
  function capsHTML(slot, scheme) {
    return ESA.controlsFor(slot, scheme).caps.map(function (k) {
      return '<span class="keycap">' + esc(k) + "</span>";
    }).join("");
  }
  ESA.capsHTML = capsHTML;

  /** Re-trigger CSS entrance animations on an element. */
  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }
  ESA.replayAnim = replay;

  /* ================================================================== *
   * WELCOME
   * ================================================================== */
  var TICKER = [
    "Two players &middot; One keyboard &middot; Extremely serious competition",
    "No coins required &middot; Bragging rights only",
    "Friendships may be tested. Results are final.",
    "Hidden fuse. Visible panic.",
    "The official arcade of the Egyptian Students Association",
    "Warning: Bonk Booth may contain bonking"
  ];

  var welcome = {
    launching: false,
    tickerIndex: 0
  };

  function launchFromWelcome() {
    if (welcome.launching || ESA.Screens.busy) return;
    welcome.launching = true;
    ESA.Audio.unlock();
    ESA.Audio.play("start");
    byId("welcomeScreen").classList.add("is-launching");
    App.timers.after(330, function () { App.go("mode"); });
  }

  App.register("welcome", {
    el: "welcomeScreen",
    topbar: true,              // sound toggle stays reachable; no Back here
    crumb: "",
    enter: function () {
      welcome.launching = false;
      byId("welcomeScreen").classList.remove("is-launching");
      var ticker = byId("welcomeTicker");
      App.timers.every(4200, function () {
        welcome.tickerIndex = (welcome.tickerIndex + 1) % TICKER.length;
        ticker.classList.remove("is-in");
        void ticker.offsetWidth;
        var line = TICKER[welcome.tickerIndex];
        if (ESA.Touch && ESA.Touch.active) line = line.replace("One keyboard", "One screen");
        ticker.innerHTML = line;
        ticker.classList.add("is-in");
      });
    },
    onKey: function (code) {
      if (ESA.isConfirm(code)) launchFromWelcome();
    }
  });

  /* ================================================================== *
   * MODE SELECT
   * ================================================================== */
  var modeState = { focus: 0, choosing: false, cards: [] };
  var MODES = ["casual", "tournament"];

  function focusMode(i, silent) {
    modeState.focus = (i + MODES.length) % MODES.length;
    modeState.cards.forEach(function (c, n) { c.classList.toggle("is-focus", n === modeState.focus); });
    if (!silent) ESA.Audio.play("uiMove");
  }

  function chooseMode(i) {
    if (modeState.choosing || ESA.Screens.busy) return;
    modeState.choosing = true;
    focusMode(i, true);
    var mode = MODES[modeState.focus];
    byId("modeGrid").classList.add("is-choosing");
    modeState.cards[modeState.focus].classList.add("is-chosen");
    ESA.Audio.play("lockIn");
    App.timers.after(560, function () {
      App.session.mode = mode;
      App.go(mode === "casual" ? "charSelect" : "participants");
    });
  }

  App.register("mode", {
    el: "modeScreen",
    parent: "welcome",
    crumb: "Mode Select",
    enter: function () {
      modeState.choosing = false;
      byId("modeGrid").classList.remove("is-choosing");
      modeState.cards.forEach(function (c) { c.classList.remove("is-chosen"); });
      focusMode(App.session.mode === "tournament" ? 1 : 0, true);
      var n = ESA.Characters.count();
      var lines = modeState.cards[1].querySelector(".mc-lines");
      var count = lines.querySelector(".mc-count");
      if (!count) {
        count = document.createElement("span");
        count.className = "mc-count";
        lines.appendChild(count);
      }
      count.textContent = n + " ESA member" + (n === 1 ? "" : "s") + " playable";
    },
    onKey: function (code) {
      if (code === "ArrowLeft" || code === "KeyA") focusMode(modeState.focus - 1);
      else if (code === "ArrowRight" || code === "KeyD") focusMode(modeState.focus + 1);
      else if (ESA.isConfirm(code)) chooseMode(modeState.focus);
    }
  });

  function wireMode() {
    modeState.cards = Array.prototype.slice.call(document.querySelectorAll(".mode-card"));
    modeState.cards.forEach(function (card, i) {
      card.addEventListener("mouseenter", function () {
        if (App.state === "mode" && !modeState.choosing && modeState.focus !== i) focusMode(i);
      });
      card.addEventListener("click", function () { chooseMode(i); });
    });
  }

  /* ================================================================== *
   * CASUAL CHARACTER SELECT
   * ================================================================== */
  var cs = {
    chars: [],
    cols: 1,
    cursor: { p1: 0, p2: 0 },
    // SELECT -> CONFIRM -> LOCKED IN. `pending` is a chosen-but-unconfirmed
    // fighter; only Confirm turns it into `locked`.
    pending: { p1: null, p2: null },
    locked: { p1: null, p2: null },
    tiles: [],
    readyGen: 0
  };

  function gridCols(n) {
    if (n <= 4) return Math.max(1, n);
    if (n <= 6) return 3;
    if (n <= 12) return 4;
    if (n <= 15) return 5;
    if (n <= 24) return 6;
    return 8;
  }

  /**
   * Size tiles so any roster size fits the available box without clipping.
   * When `cols` is null the column count is chosen to give the biggest
   * tiles (preferring fuller last rows on a tie). Returns the column count.
   */
  function sizeRoster(host, wrap, n, cols, opts) {
    opts = opts || {};

    /*
     * Explicit breakpoints win. Touch layouts (and short windows) scroll, so
     * the roster box's height there depends on the tiles themselves -
     * measuring it gave a different column count on every visit (and on
     * every mobile URL-bar resize). Those layouts declare --roster-cols in
     * CSS instead and size the tiles with pure CSS; we only read the count
     * back for keyboard navigation and clear any stale measured values.
     */
    var fixed = parseInt(getComputedStyle(host).getPropertyValue("--roster-cols"), 10);
    if (fixed > 0) {
      host.style.removeProperty("--cols");
      host.style.removeProperty("--tile");
      host.classList.add("is-fixed-grid");
      return fixed;
    }
    host.classList.remove("is-fixed-grid");
    var gap = opts.gap || 12;
    var label = opts.label || 28;
    var maxTile = opts.max || 196;
    var w = wrap.clientWidth || 600;
    var h = wrap.clientHeight || 400;

    function tileFor(c) {
      var rows = Math.max(1, Math.ceil(n / c));
      var byW = (w - (c - 1) * gap) / c;
      var byH = (h - (rows - 1) * gap) / rows - label;
      return Math.floor(Math.max(56, Math.min(maxTile, byW, byH)));
    }

    if (!cols) {
      var best = 1, bestTile = -1, bestGap = Infinity;
      for (var c = 1; c <= Math.max(1, n); c++) {
        var t = tileFor(c);
        var emptyInLastRow = (c - (n % c)) % c;
        if (t > bestTile + 2 || (Math.abs(t - bestTile) <= 2 && emptyInLastRow < bestGap)) {
          best = c; bestTile = t; bestGap = emptyInLastRow;
        }
      }
      cols = best;
    }

    host.style.setProperty("--cols", cols);
    host.style.setProperty("--tile", tileFor(cols) + "px");
    return cols;
  }
  ESA.sizeRoster = sizeRoster;
  ESA.gridCols = gridCols;

  /** Grid navigation with wrap-around, shared by both select screens. */
  function gridMove(idx, dir, n, cols) {
    if (n <= 0) return 0;
    var col = idx % cols;
    switch (dir) {
      case "left":  return (idx - 1 + n) % n;
      case "right": return (idx + 1) % n;
      case "down":  return idx + cols < n ? idx + cols : col;
      case "up":
        if (idx - cols >= 0) return idx - cols;
        var last = Math.floor((n - 1) / cols) * cols + col;
        return last >= n ? last - cols : last;
    }
    return idx;
  }
  ESA.gridMove = gridMove;

  function csBuild() {
    var host = byId("csRoster");
    host.innerHTML = "";
    cs.tiles = cs.chars.map(function (c, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cs-tile";
      b.style.setProperty("--i", i);
      b.style.setProperty("--cc", c.color);
      b.innerHTML =
        '<span class="cs-tile-img">' + portraitImg(c) + "</span>" +
        '<span class="cs-tile-name">' + esc(c.displayName) + "</span>" +
        '<span class="cs-cursor p1">P1</span><span class="cs-cursor p2">P2</span>';
      b.addEventListener("click", function () { csClickTile(i); });
      host.appendChild(b);
      return b;
    });
    cs.cols = sizeRoster(host, host.parentNode, cs.chars.length, null, { label: 40 });

    ESA.SLOTS.forEach(function (slot) {
      var ctl = ESA.CONTROLS[slot];
      var side = byId(slot === "p1" ? "csSideP1" : "csSideP2");
      side.style.setProperty("--slot", ctl.color);
      side.innerHTML =
        '<div class="cs-side-head"><span class="slot-tag">' + ctl.short + '</span>' +
          '<span class="cs-state">Selecting</span></div>' +
        '<div class="cs-portrait art-box"><span class="cs-portrait-glow"></span>' +
          '<span class="art-frame cs-art"><img class="art-img" alt="" draggable="false" /></span>' +
          '<span class="cs-stamp">Locked In</span></div>' +
        '<div class="cs-name"></div>' +
        '<div class="cs-tagline"></div>' +
        '<div class="cs-keys">' +
          '<span class="keycap wide">' + esc(ctl.selectLabel.move) + '</span><span class="cs-move-word">move</span>' +
          '<span class="keycap wide">' + esc(ctl.selectLabel.lock) + '</span><span class="cs-lock-word">select</span>' +
        "</div>" +
        '<button class="btn btn-ghost btn-small cs-change" type="button">Change</button>' +
        // Confirmation step (shown while a fighter is selected but not locked).
        '<div class="cs-confirm" role="group">' +
          '<div class="cs-ask">Select <b class="cs-ask-name"></b>?</div>' +
          '<div class="cs-confirm-row">' +
            '<button class="btn btn-gold btn-small cs-ok" type="button">&#10003; Confirm</button>' +
            '<button class="btn btn-ghost btn-small cs-no" type="button">Change</button>' +
          "</div>" +
          '<div class="cs-confirm-keys desk-only"><span class="keycap">' + esc(ctl.selectLabel.lock) +
            '</span> confirm &middot; <span class="keycap">' + esc(ctl.selectLabel.move) + "</span> change</div>" +
        "</div>" +
        '<div class="cs-lockflash" aria-hidden="true"><span class="cs-lf-who"></span><span class="cs-lf-word">Locked In</span></div>';
      side.querySelector(".cs-change").addEventListener("click", function () { csUnlock(slot); });
      side.querySelector(".cs-ok").addEventListener("click", function () { csConfirm(slot); });
      side.querySelector(".cs-no").addEventListener("click", function () { csCancelPending(slot, true); });
    });
  }

  function csSide(slot) { return byId(slot === "p1" ? "csSideP1" : "csSideP2"); }

  /** The slot a mouse click / tap applies to: P1 until locked, then P2. */
  function csPointerSlot() {
    return cs.locked.p1 === null ? "p1" : (cs.locked.p2 === null ? "p2" : null);
  }

  function csRender() {
    cs.tiles.forEach(function (t, i) {
      t.classList.toggle("has-p1", cs.cursor.p1 === i);
      t.classList.toggle("has-p2", cs.cursor.p2 === i);
      t.classList.toggle("pending-p1", cs.pending.p1 === i);
      t.classList.toggle("pending-p2", cs.pending.p2 === i);
      t.classList.toggle("locked-p1", cs.locked.p1 === i);
      t.classList.toggle("locked-p2", cs.locked.p2 === i);
    });
    var turn = csPointerSlot();
    ESA.SLOTS.forEach(function (slot) {
      var side = csSide(slot);
      var locked = cs.locked[slot] !== null;
      var pending = !locked && cs.pending[slot] !== null;
      var idx = locked ? cs.locked[slot] : (pending ? cs.pending[slot] : cs.cursor[slot]);
      var c = cs.chars[idx];
      side.classList.toggle("is-locked", locked);
      side.classList.toggle("is-pending", pending);
      side.classList.toggle("is-turn", turn === slot);
      if (!c) return;
      side.style.setProperty("--cc", c.color);
      ESA.setArt(side.querySelector(".cs-art"), c, locked ? "selected" : "normal", "body");
      side.querySelector(".cs-name").textContent = c.displayName;
      side.querySelector(".cs-tagline").textContent = c.tagline || "";
      side.querySelector(".cs-ask-name").textContent = c.displayName;
      side.querySelector(".cs-state").textContent = locked ? "Ready" : (pending ? "Confirm?" : "Selecting");
      side.querySelector(".cs-lock-word").textContent = locked ? "change" : (pending ? "confirm" : "select");
    });
    var hint = byId("csTouchHint");
    if (hint) {
      hint.innerHTML = !turn ? "Both fighters locked in!"
        : (cs.pending[turn] !== null
            ? 'Tap <b>Confirm</b> to lock in <b class="t-' + turn + '">' + turn.toUpperCase() + "</b> &middot; or tap another fighter"
            : 'Tap a fighter for <b class="t-' + turn + '">' + turn.toUpperCase() + "</b>" +
              (turn === "p1" ? ', then one for <b class="t-p2">P2</b>' : ""));
    }
  }

  function csMove(slot, dir) {
    if (cs.locked[slot] !== null || !cs.chars.length) return;
    var from = cs.pending[slot] !== null ? cs.pending[slot] : cs.cursor[slot];
    var next = gridMove(from, dir, cs.chars.length, cs.cols);
    var hadPending = cs.pending[slot] !== null;
    cs.pending[slot] = null;               // moving away = Change
    if (next === cs.cursor[slot] && !hadPending) return;
    cs.cursor[slot] = next;
    ESA.Audio.play("uiMove");
    csRender();
    replay(csSide(slot).querySelector(".cs-portrait"), "is-swap");
  }

  /** Step 1: highlight a fighter and ask for confirmation. Never locks. */
  function csSelect(slot, i) {
    if (!cs.chars.length || cs.locked[slot] !== null) return;
    var c = cs.chars[i];
    if (!c) return;
    if (c.slots.indexOf(slot) < 0) { ESA.Audio.play("denied"); return; }
    var changed = cs.pending[slot] !== i || cs.cursor[slot] !== i;
    cs.cursor[slot] = i;
    cs.pending[slot] = i;
    ESA.Audio.play("toggleOn");
    csRender();
    if (changed) replay(csSide(slot).querySelector(".cs-portrait"), "is-swap");
    replay(csSide(slot).querySelector(".cs-confirm"), "is-in");
  }

  /** Step 2: Confirm turns the pending choice into a lock. */
  function csConfirm(slot) {
    if (App.state !== "charSelect" || cs.locked[slot] !== null || cs.pending[slot] === null) return;
    var c = cs.chars[cs.pending[slot]];
    if (!c || c.slots.indexOf(slot) < 0) { ESA.Audio.play("denied"); return; }
    cs.locked[slot] = cs.pending[slot];
    cs.cursor[slot] = cs.pending[slot];
    cs.pending[slot] = null;
    ESA.Audio.play("lockIn");
    var side = csSide(slot);
    side.querySelector(".cs-lf-who").textContent = ESA.CONTROLS[slot].short + " · " + c.displayName;
    replay(side, "just-locked");
    replay(side.querySelector(".cs-lockflash"), "is-on");
    csRender();
    csCheckReady();
  }

  /** Change before confirming: drop the preview, stay on the screen. */
  function csCancelPending(slot, sound) {
    if (cs.pending[slot] === null) return false;
    cs.pending[slot] = null;
    if (sound) ESA.Audio.play("unlock");
    csRender();
    return true;
  }

  /** Change after locking in (existing behaviour). */
  function csUnlock(slot) {
    if (cs.locked[slot] === null) return;
    cs.locked[slot] = null;
    cs.pending[slot] = null;
    cs.readyGen++;                         // cancels a pending "both ready" advance
    byId("charSelectScreen").classList.remove("is-ready");
    ESA.Audio.play("unlock");
    csRender();
  }

  /** Keyboard select key: select -> confirm, or unlock when already locked. */
  function csLockKey(slot) {
    if (!cs.chars.length) return;
    if (cs.locked[slot] !== null) csUnlock(slot);
    else if (cs.pending[slot] !== null) csConfirm(slot);
    else csSelect(slot, cs.cursor[slot]);
  }

  function csClickTile(i) {
    if (App.state !== "charSelect") return;
    var slot = csPointerSlot();
    if (!slot) return;
    // Tapping the already-selected fighter again does NOT confirm - an
    // accidental double tap must never lock someone in.
    if (cs.pending[slot] === i) { replay(csSide(slot).querySelector(".cs-confirm"), "is-nudge"); return; }
    csSelect(slot, i);
  }

  function csCheckReady() {
    if (cs.locked.p1 === null || cs.locked.p2 === null) return;
    var gen = ++cs.readyGen;
    byId("charSelectScreen").classList.add("is-ready");
    App.timers.after(900, function () {
      if (gen !== cs.readyGen || App.state !== "charSelect") return;
      App.session.setup = { p1: cs.chars[cs.locked.p1].id, p2: cs.chars[cs.locked.p2].id };
      App.go("vs");
    });
  }

  App.register("charSelect", {
    el: "charSelectScreen",
    parent: "mode",
    crumb: "Casual · Character Select",
    ownsConfirmKeys: true,
    // Back first cancels an unconfirmed selection, then leaves as before.
    back: function () {
      var dropped = false;
      ESA.SLOTS.forEach(function (slot) { if (csCancelPending(slot, false)) dropped = true; });
      ESA.Audio.play("uiBack");
      if (!dropped) App.go("mode");
    },
    enter: function () {
      cs.chars = ESA.Characters.list();
      cs.locked.p1 = cs.locked.p2 = null;
      cs.pending.p1 = cs.pending.p2 = null;
      cs.readyGen++;
      byId("charSelectScreen").classList.remove("is-ready");

      // Cursors start on the previous matchup (unlocked) or the first two.
      var prev = App.session.setup;
      var find = function (id, fallback) {
        for (var i = 0; i < cs.chars.length; i++) if (cs.chars[i].id === id) return i;
        return fallback;
      };
      cs.cursor.p1 = prev ? find(prev.p1, 0) : 0;
      cs.cursor.p2 = prev ? find(prev.p2, Math.min(1, cs.chars.length - 1)) : Math.min(1, cs.chars.length - 1);

      csBuild();
      csRender();
    },
    onResize: function () {
      cs.cols = sizeRoster(byId("csRoster"), byId("csRoster").parentNode, cs.chars.length, null, { label: 40 });
    },
    onKey: function (code) {
      var p1 = ESA.CONTROLS.p1.select, p2 = ESA.CONTROLS.p2.select;
      if (code === p1.up) csMove("p1", "up");
      else if (code === p1.down) csMove("p1", "down");
      else if (code === p1.left) csMove("p1", "left");
      else if (code === p1.right) csMove("p1", "right");
      else if (code === p1.lock) csLockKey("p1");
      else if (code === p2.up) csMove("p2", "up");
      else if (code === p2.down) csMove("p2", "down");
      else if (code === p2.left) csMove("p2", "left");
      else if (code === p2.right) csMove("p2", "right");
      else if (code === p2.lock || code === "NumpadEnter") csLockKey("p2");
    }
  });

  /* ================================================================== *
   * VS PRESENTATION
   * ================================================================== */
  function vsHalf(who, slot) {
    var c = who.character;
    return '<div class="vs-art-wrap art-box">' + ESA.bodyArtHTML(c, "selected", "vs-art") + "</div>" +
           '<div class="vs-plate"><span class="vs-slot">' + ESA.CONTROLS[slot].short + "</span>" +
           '<span class="vs-name">' + esc(who.name) + "</span></div>";
  }

  function vsContinue() {
    if (App.state !== "vs") return;
    App.go("library");
  }

  App.register("vs", {
    el: "vsScreen",
    parent: "charSelect",
    crumb: "Casual",
    enter: function () {
      var setup = App.session.setup;
      if (!setup) return;
      var who = ESA.describeMatchup(setup);
      var p1 = byId("vsP1"), p2 = byId("vsP2");
      p1.innerHTML = vsHalf(who.p1, "p1");
      p2.innerHTML = vsHalf(who.p2, "p2");
      p1.style.setProperty("--cc", who.p1.color);
      p2.style.setProperty("--cc", who.p2.color);
      replay(byId("vsScreen"), "is-playing");
    },
    afterEnter: function () {
      ESA.Audio.play("versus");
      App.timers.after(1750, vsContinue);
    },
    onKey: function (code) { if (ESA.isConfirm(code)) vsContinue(); }
  });

  /* ================================================================== *
   * GAME LIBRARY
   * ================================================================== */
  var lib = { games: [], cards: [], index: 0 };

  function cabinetHTML(g, i) {
    var p1 = ESA.controlsFor("p1", g.controls), p2 = ESA.controlsFor("p2", g.controls);
    var bulbs = "";
    for (var b = 0; b < 9; b++) bulbs += "<i></i>";
    return '' +
      '<span class="cab-marquee"><span class="cab-bulbs">' + bulbs + '</span>' +
        '<span class="cab-no">Machine ' + (i < 9 ? "0" : "") + (i + 1) + "</span>" +
        '<span class="cab-title">' + esc(g.title) + "</span></span>" +
      '<span class="cab-screen"><span class="cab-art">' + ESA.Games.iconHTML(g) + "</span>" +
        '<span class="cab-mode">' + esc(g.mode) + "</span></span>" +
      '<span class="cab-desc"><span class="desk-only">' + esc(g.tagline) + '</span>' +
        '<span class="touch-only">' + esc(g.touch.tagline || g.tagline) + "</span></span>" +
      '<span class="cab-panel desk-only">' +
        '<span class="cab-ctrl"><span class="who">P1</span>' + p1.caps.map(function (k) { return '<span class="keycap">' + esc(k) + "</span>"; }).join("") + "</span>" +
        '<span class="cab-ctrl"><span class="who">P2</span>' + p2.caps.map(function (k) { return '<span class="keycap">' + esc(k) + "</span>"; }).join("") + "</span>" +
      "</span>" +
      '<span class="cab-panel cab-touch touch-only">' + touchSummaryHTML(g) + "</span>" +
      '<span class="cab-play"><span class="desk-only">&#9654; Press Enter to Play</span>' +
        '<span class="touch-only">&#9654; Tap to Play</span></span>';
  }

  /** Touch controls in plain words, e.g. "Joystick · DASH" / "Tap to bonk". */
  function touchSummary(g) {
    var t = g.touch || {}, parts = [];
    if (t.movement === "joystick") parts.push("Joystick");
    (t.actions || []).forEach(function (a) { parts.push(a.label); });
    if (t.interaction === "directTap") parts.push("Tap to play");
    return parts;
  }
  function touchSummaryHTML(g) {
    return touchSummary(g).map(function (p) { return '<span class="tchip">' + esc(p) + "</span>"; }).join("");
  }
  ESA.touchSummaryHTML = touchSummaryHTML;

  function libBuild() {
    var host = byId("libCarousel");
    host.innerHTML = "";
    lib.cards = lib.games.map(function (g, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "cabinet";
      b.style.setProperty("--accent", g.accent);
      b.innerHTML = cabinetHTML(g, i);
      b.addEventListener("click", function () {
        if (App.state !== "library") return;
        if (lib.swiped) { lib.swiped = false; return; }
        if (i === lib.index) libOpen();
        else libSelect(i);
      });
      host.appendChild(b);
      return b;
    });

    var dots = byId("libDots");
    dots.innerHTML = "";
    if (lib.games.length <= 14) {
      lib.games.forEach(function (g, i) {
        var d = document.createElement("button");
        d.type = "button";
        d.className = "lib-dot";
        d.setAttribute("aria-label", g.title);
        d.addEventListener("click", function () { libSelect(i); });
        dots.appendChild(d);
      });
    }
  }

  function wrapOffset(i, index, n) {
    var d = i - index;
    if (n > 2) {
      if (d > n / 2) d -= n;
      if (d < -n / 2) d += n;
    }
    return d;
  }

  function libLayout() {
    var n = lib.games.length;
    lib.cards.forEach(function (card, i) {
      var off = wrapOffset(i, lib.index, n);
      var a = Math.abs(off);
      card.style.setProperty("--off", off);
      card.style.setProperty("--abs", a);
      // Far cabinets tuck in behind their neighbours instead of spreading out.
      card.style.setProperty("--k", off === 0 ? 0 : (off > 0 ? 1 : -1) * (a === 1 ? 1 : 1.62));
      card.classList.toggle("is-center", off === 0);
      card.classList.toggle("is-near", a === 1);
      card.classList.toggle("is-far", a === 2);
      card.classList.toggle("is-hidden", a > 2);
      card.tabIndex = a > 2 ? -1 : 0;
    });
    var dots = byId("libDots").children;
    for (var k = 0; k < dots.length; k++) dots[k].classList.toggle("is-on", k === lib.index);
    var pad = function (v) { return (v < 10 ? "0" : "") + v; };
    byId("libCount").textContent = pad(lib.index + 1) + " / " + pad(n);
    App.session.libraryIndex = lib.index;
  }

  function libSelect(i) {
    var n = lib.games.length;
    if (!n) return;
    var next = ((i % n) + n) % n;
    if (next === lib.index) return;
    lib.index = next;
    ESA.Audio.play("uiMove");
    libLayout();
  }

  function libOpen() {
    var g = lib.games[lib.index];
    if (!g || !App.session.setup) return;
    ESA.Audio.play("uiClick");
    App.go("intro", { def: g, setup: App.session.setup, context: { mode: "casual" } });
  }

  /** Mascot hook: the attract-mode emblem can shove the carousel along. */
  ESA.Library = { nudge: function (d) { if (App.state === "library") libSelect(lib.index + d); } };

  function matchupHTML(setup) {
    var who = ESA.describeMatchup(setup);
    return '' +
      '<span class="mu-side p1" style="--cc:' + esc(who.p1.color) + '">' +
        '<span class="mu-face">' + portraitImg(who.p1.character) + "</span>" +
        '<span class="mu-name"><small>P1</small>' + esc(who.p1.name) + "</span></span>" +
      '<span class="mu-vs">VS</span>' +
      '<span class="mu-side p2" style="--cc:' + esc(who.p2.color) + '">' +
        '<span class="mu-name"><small>P2</small>' + esc(who.p2.name) + "</span>" +
        '<span class="mu-face">' + portraitImg(who.p2.character) + "</span></span>";
  }

  App.register("library", {
    el: "libraryScreen",
    parent: "charSelect",
    crumb: "Casual · Game Library",
    enter: function () {
      if (!App.session.setup) { App.redirect("charSelect"); return; }
      lib.games = ESA.Games.list();
      lib.index = Math.min(App.session.libraryIndex || 0, Math.max(0, lib.games.length - 1));
      byId("libMatchup").innerHTML = matchupHTML(App.session.setup);
      libBuild();
      libLayout();
    },
    onKey: function (code) {
      if (code === "ArrowLeft" || code === "KeyA") libSelect(lib.index - 1);
      else if (code === "ArrowRight" || code === "KeyD") libSelect(lib.index + 1);
      else if (ESA.isConfirm(code)) libOpen();
      else if (code === "KeyC") { ESA.Audio.play("uiBack"); App.go("charSelect"); }
    }
  });

  function wireLibrary() {
    byId("libPrev").addEventListener("click", function () { libSelect(lib.index - 1); });
    byId("libNext").addEventListener("click", function () { libSelect(lib.index + 1); });
    byId("changePlayersBtn").addEventListener("click", function () {
      ESA.Audio.play("uiBack");
      App.go("charSelect");
    });
    // Swipe left / right on touch screens browses the floor.
    var sw = null;
    var car = byId("libCarousel");
    car.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse") return;
      sw = { id: e.pointerId, x: e.clientX, y: e.clientY };
      lib.swiped = false;
    });
    car.addEventListener("pointerup", function (e) {
      if (!sw || sw.id !== e.pointerId) return;
      var dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      sw = null;
      if (Math.abs(dx) > 36 && Math.abs(dx) > Math.abs(dy) * 1.2 && App.state === "library") {
        lib.swiped = true;                       // swallow the click that follows
        libSelect(lib.index + (dx < 0 ? 1 : -1));
        setTimeout(function () { lib.swiped = false; }, 400);
      }
    });
    car.addEventListener("pointercancel", function () { sw = null; });

    // Mouse wheel browses the floor too.
    var wheelLock = 0;
    byId("libCarousel").addEventListener("wheel", function (e) {
      if (App.state !== "library") return;
      var now = performance.now();
      if (now - wheelLock < 220) return;
      var d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (Math.abs(d) < 8) return;
      wheelLock = now;
      e.preventDefault();
      libSelect(lib.index + (d > 0 ? 1 : -1));
    }, { passive: false });
  }

  /* ================================================================== *
   * GAME INTRO (shared by Casual and Tournament)
   * ================================================================== */
  function introStart() {
    var p = App.params;
    if (!p || !p.def) return;
    if (ESA.Touch && ESA.Touch.active) ESA.Touch.enterImmersive();
    App.startMatch(p.def, p.setup, p.context);
  }

  App.register("intro", {
    el: "introScreen",
    parent: function () {
      return App.params.context && App.params.context.mode === "tournament" ? "hub" : "library";
    },
    crumb: "Briefing",
    enter: function (p) {
      var g = p.def;
      var who = ESA.describeMatchup(p.setup);
      var isTour = p.context && p.context.mode === "tournament";
      byId("introKicker").textContent = isTour ? (p.context.tag || "Tournament Match") : "Casual Match";
      byId("introTitle").textContent = g.title;
      byId("introMode").textContent = ESA.Games.resolve(g, p.context).mode;
      byId("introRules").innerHTML = '<span class="desk-only">' + g.description + '</span>' +
        '<span class="touch-only">' + (g.touch.description || g.description) + "</span>";
      byId("introArt").innerHTML = ESA.Games.iconHTML(g);
      byId("introScreen").style.setProperty("--accent", g.accent);

      var html = "";
      ESA.SLOTS.forEach(function (slot) {
        var w = who[slot];
        html += '<div class="ctrl" style="--pc:' + esc(w.color) + '">' +
                  '<span class="ctrl-face">' + portraitImg(w.character) + "</span>" +
                  '<span class="ctrl-text"><span class="ctrl-slot">' + ESA.CONTROLS[slot].short + "</span>" +
                  '<span class="ctrl-name">' + esc(w.name) + "</span></span>" +
                  '<span class="ctrl-keys desk-only">' + capsHTML(slot, g.controls) + "</span>" +
                  '<span class="ctrl-touch touch-only">' + touchSummaryHTML(g) +
                    '<span class="tside">' + (slot === "p1" ? "Left side" : "Right side") + "</span></span>" +
                "</div>";
      });
      byId("introControls").innerHTML = html;
      this.crumb = isTour ? "Tournament · Briefing" : "Casual · Briefing";
    },
    onKey: function (code) {
      if (ESA.isConfirm(code)) introStart();
    }
  });

  /* ================================================================== *
   * Wiring (once, at boot)
   * ================================================================== */
  ESA.Menus = {
    init: function () {
      byId("pressStart").addEventListener("click", launchFromWelcome);
      wireMode();
      wireLibrary();
      byId("introStartBtn").addEventListener("click", introStart);
      byId("introBackBtn").addEventListener("click", function () { App.back(); });
    }
  };

})(window.ESA);
