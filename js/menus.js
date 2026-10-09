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
   * `c` is any avatar (roster Normal / Evil, or a Guest); Evil avatars get
   * the shared Evil treatment (js/variants.js) as a sibling overlay.
   */
  function portraitImg(c, cls) {
    if (!c) return "";
    var evil = !!c.evil;
    return '<img class="' + esc(cls || "") + (evil ? " is-evil-art" : "") + '" src="' + esc(c.art.portrait) + '" alt="" ' +
           'style="' + esc(ESA.headStyle(c)) + '" />' +
           (evil && ESA.Variants ? ESA.Variants.headOverlayHTML(c) : "");
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
    "Short fuse. Visible panic.",
    "The official arcade of the Egyptian Students Association",
    "Warning: Bonk Booth may contain bonking"
  ];

  var welcome = {
    launching: false,
    tickerIndex: 0
  };

  function launchFromWelcome() {
    if (welcome.launching || App.navBusy()) return;
    welcome.launching = true;
    ESA.Audio.unlock();
    ESA.Audio.play("start");
    byId("welcomeScreen").classList.add("is-launching");
    App.goLater(330, function () { App.go("mode"); });
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
  var MODES = ["casual", "solo", "tournament"];
  var MODE_SCREEN = { casual: "charSelect", solo: "soloSelect", tournament: "participants" };

  function focusMode(i, silent) {
    var next = (i + MODES.length) % MODES.length;
    if (next === modeState.focus && modeState.cards[next] && modeState.cards[next].classList.contains("is-focus")) return;
    modeState.focus = next;
    modeState.cards.forEach(function (c, n) { c.classList.toggle("is-focus", n === modeState.focus); });
    if (!silent) ESA.Audio.play("uiMove");
  }

  /*
   * SCROLL FOCUS (shared: Mode Select, Solo CPU Difficulty).
   * Phones: the cards are stacked and the screen scrolls, so the ACTIVE
   * card follows the scroll position instead of a hover:
   *   scrolled to the top     -> first card
   *   scrolled to the bottom  -> last card
   *   in between              -> the card whose centre is nearest the
   *                              middle of the visible area
   * Deterministic, one active card, no flicker: a card only takes over
   * once it is clearly nearer (8px hysteresis). One passive scroll
   * listener per screen, attached once, throttled to a frame. Only runs
   * while the cards are stacked in one column - side-by-side cards keep
   * hover / keyboard focus. Purely visual: tapping any card always works.
   *
   * opts: { screen: element id, cards(): [elements], focus(): index,
   *         setFocus(i), state: screen name, blocked(): bool }
   */
  function ScrollFocus(opts) {
    this.o = opts;
    this.raf = 0;
    var self = this;
    byId(opts.screen).addEventListener("scroll", function () {
      if (!self.raf) self.raf = requestAnimationFrame(function () { self.raf = 0; self.pick(); });
    }, { passive: true });
  }
  ScrollFocus.prototype.stacked = function () {
    var c = this.o.cards();
    return c.length > 1 && Math.abs(c[0].offsetLeft - c[1].offsetLeft) < 4;
  };
  ScrollFocus.prototype.pick = function () {
    var o = this.o;
    if (App.state !== o.state || (o.blocked && o.blocked()) || !this.stacked()) return;
    var sc = byId(o.screen), cards = o.cards(), cur = o.focus();
    var max = sc.scrollHeight - sc.clientHeight;
    if (max < 6) return;                          // everything fits: nothing to follow
    var pick;
    if (sc.scrollTop <= 4) pick = 0;
    else if (sc.scrollTop >= max - 4) pick = cards.length - 1;
    else {
      var view = sc.getBoundingClientRect();
      var mid = view.top + view.height / 2;
      var bestD = Infinity, curD = Infinity;
      cards.forEach(function (c, n) {
        var r = c.getBoundingClientRect();
        var d = Math.abs(r.top + r.height / 2 - mid);
        if (n === cur) curD = d;
        if (d < bestD) { bestD = d; pick = n; }
      });
      if (pick !== cur && curD - bestD < 8) pick = cur;
    }
    if (pick !== cur) o.setFocus(pick);
  };
  /** On entering the screen: stacked layout starts at the top, first card active. */
  ScrollFocus.prototype.reset = function () {
    if (!this.stacked()) return false;
    byId(this.o.screen).scrollTop = 0;
    this.o.setFocus(0);
    return true;
  };
  ESA.ScrollFocus = ScrollFocus;

  var modeScroll = null;
  function modeStacked() { return !!modeScroll && modeScroll.stacked(); }

  function chooseMode(i) {
    if (modeState.choosing || App.navBusy()) return;
    modeState.choosing = true;
    focusMode(i, true);
    var mode = MODES[modeState.focus];
    byId("modeGrid").classList.add("is-choosing");
    modeState.cards[modeState.focus].classList.add("is-chosen");
    ESA.Audio.play("lockIn");
    App.goLater(560, function () {
      App.session.mode = mode;
      App.go(MODE_SCREEN[mode]);
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
      focusMode(Math.max(0, MODES.indexOf(App.session.mode)), true);
      // Stacked phone layout: start at the top with Casual active.
      if (modeScroll) modeScroll.reset();
      var n = ESA.Characters.count();
      var tour = modeState.cards[MODES.indexOf("tournament")];
      var lines = tour.querySelector(".mc-lines");
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
    // Cards in MODES order, whatever their order in the markup.
    modeState.cards = MODES.map(function (m) { return document.querySelector('.mode-card[data-mode="' + m + '"]'); });
    modeState.cards.forEach(function (card, i) {
      card.addEventListener("mouseenter", function () {
        if (App.state === "mode" && !modeState.choosing && modeState.focus !== i && !modeStacked()) focusMode(i);
      });
      card.addEventListener("click", function () { chooseMode(i); });
    });
    modeScroll = new ScrollFocus({
      screen: "modeScreen", state: "mode",
      cards: function () { return modeState.cards; },
      focus: function () { return modeState.focus; },
      setFocus: function (i) { focusMode(i, true); },
      blocked: function () { return modeState.choosing; }
    });
  }

  /* --- Roster grid sizing + navigation (Casual + Tournament) ------- */
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
    // opts.edge: room for corner badges that hang outside the tiles.
    var w = (wrap.clientWidth || 600) - (opts.edge || 0);
    var h = wrap.clientHeight || 400;

    // V4.1: a tile is NEVER wider than its share of the width (the old 56px
    // floor could push the grid past the box and force a horizontal
    // scrollbar). When the height runs out, rows simply continue and the
    // roster scrolls VERTICALLY.
    function tileFor(c) {
      var rows = Math.max(1, Math.ceil(n / c));
      var byW = (w - (c - 1) * gap) / c;
      var byH = (h - (rows - 1) * gap) / rows - label;
      return Math.floor(Math.min(byW, Math.max(Math.min(64, byW), Math.min(maxTile, byW, byH))));
    }

    if (!cols) {
      var best = 1, bestTile = -1, bestGap = Infinity;
      // Never more columns than keep tiles >= 64px wide: extra fighters add
      // ROWS, not a wider (horizontally scrolling) grid.
      var maxCols = Math.max(1, Math.floor((w + gap) / (64 + gap)));
      for (var c = 1; c <= Math.max(1, Math.min(n, maxCols)); c++) {
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

  /* ------------------------------------------------------------------ *
   * Roster entries shared by Casual and Tournament: every permanent
   * character (a BASE tile - its Normal / Evil variant is chosen after the
   * tap), then this session's Guests, then the "+ Add Guest" tile. The
   * permanent roster keeps its explicit grid rules (phone portrait: 3
   * columns, rows as needed); guests simply add rows.
   * ------------------------------------------------------------------ */
  function rosterEntries() {
    var list = ESA.Characters.list().map(function (c) { return { kind: "char", c: c }; });
    ESA.Participants.guests().forEach(function (p) {
      list.push({ kind: "guest", p: p, c: ESA.Participants.avatar(p) });
    });
    list.push({ kind: "add" });
    return list;
  }
  ESA.rosterEntries = rosterEntries;

  /** Index of the same roster entry in a rebuilt list, or -1. */
  function sameEntry(list, e) {
    if (!e) return -1;
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (x.kind !== e.kind) continue;
      if (x.kind === "add" || (x.kind === "guest" && x.p === e.p) || (x.kind === "char" && x.c.id === e.c.id)) return i;
    }
    return -1;
  }

  /** Re-points an index into `old` at the same entry in `next` (gone -> fallback). */
  function remapEntry(old, next, i, fallback) {
    if (i === null || i === undefined) return fallback;
    var j = sameEntry(next, old[i]);
    return j < 0 ? fallback : j;
  }
  ESA.remapEntry = remapEntry;

  /*
   * DELETE GUEST (shared by Casual, Solo and Tournament rosters). One
   * Cancel / Delete confirmation, then the Guest leaves the session pool
   * (js/participants.js: sessionStorage entry, photo, cached art) and every
   * cross-screen reference to them is cleared here, so no screen can
   * resolve a ghost. `onDeleted` rebuilds the calling screen.
   */
  function confirmDeleteGuest(p, onDeleted) {
    if (!p || p.type !== "guest" || p.removed || ESA.Modal.active() || App.navBusy()) return;
    var id = p.participantId;
    var t = App.session.tournament;
    if (t && !t.champion && t.participants.indexOf(id) >= 0) {
      ESA.Audio.play("denied");
      ESA.Modal.push({
        type: "confirm",
        title: "Guest In Play",
        body: p.displayName + " is in the current tournament and can't be deleted until it ends.",
        buttons: [{ label: "OK", kind: "safe", action: function () { ESA.Modal.pop(); } }]
      });
      return;
    }
    ESA.Modal.confirm({
      title: "Delete " + p.displayName + "?",
      body: p.guestPhoto ? "This Guest and their photo are removed from this session." : "This Guest is removed from this session.",
      safe: "Cancel",
      danger: "Delete",
      onConfirm: function () {
        ESA.Participants.removeGuest(id);
        var s = App.session;
        if (s.setup && (s.setup.p1 === id || s.setup.p2 === id)) s.setup = null;
        if (s.pendingParticipants) s.pendingParticipants = s.pendingParticipants.filter(function (x) { return x !== id; });
        if (s.solo && s.solo.humanPid === id) { s.solo.humanPid = null; s.solo.cpuPid = null; }
        ESA.Audio.play("toggleOff");
        if (onDeleted) onDeleted(p);
      }
    });
  }
  ESA.confirmDeleteGuest = confirmDeleteGuest;

  var TRASH_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M9 2.5h6l.8 1.8H20v2.2H4V4.3h4.2zM5.6 8h12.8l-1 13.5H6.6zm3.6 2.4v8.6h1.7v-8.6zm3.9 0v8.6h1.7v-8.6z"/></svg>';

  /**
   * One roster tile (DOM APIs: guest nicknames are set as text only).
   * opts.onGuestDeleted: Guest tiles get a small trash button (inside the
   * tile, so it never shifts the grid) that asks before deleting.
   */
  function rosterTile(e, i, prefix, opts) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = prefix + "-tile" + (e.kind === "guest" ? " is-guest" : e.kind === "add" ? " is-add" : "");
    b.style.setProperty("--i", i);
    var img = document.createElement("span");
    img.className = prefix + "-tile-img";
    var name = document.createElement("span");
    name.className = prefix + "-tile-name";
    if (e.kind === "add") {
      b.style.setProperty("--cc", "#e5a92f");
      img.innerHTML = '<span class="add-plus" aria-hidden="true"></span>';
      name.textContent = "Add Guest";
      b.setAttribute("aria-label", "Add a guest");
    } else {
      b.style.setProperty("--cc", e.c.color);
      img.innerHTML = portraitImg(e.c);
      name.textContent = e.kind === "guest" ? e.p.displayName : e.c.displayName;
      if (e.kind === "guest") {
        var tag = document.createElement("span");
        tag.className = "guest-tag";
        tag.textContent = "Guest";
        img.appendChild(tag);
        if (opts && opts.onGuestDeleted) {
          var del = document.createElement("span");
          del.className = "guest-del";
          del.setAttribute("role", "button");
          del.setAttribute("aria-label", "Delete guest " + e.p.displayName);
          del.title = "Delete guest";
          del.innerHTML = TRASH_SVG;
          del.addEventListener("click", function (ev) {
            ev.preventDefault();
            ev.stopPropagation();                  // never selects the tile
            confirmDeleteGuest(e.p, opts.onGuestDeleted);
          });
          img.appendChild(del);
        }
      }
    }
    b.appendChild(img);
    b.appendChild(name);
    return b;
  }
  ESA.rosterTile = rosterTile;

  /** Display name into an element: "EVIL" gets the premium treatment. */
  function setNameEl(el, c) {
    el.textContent = "";
    if (c && c.evil) {
      var w = document.createElement("span");
      w.className = "evil-word";
      w.textContent = "Evil";
      el.appendChild(w);
      el.appendChild(document.createTextNode(" " + ESA.Characters.get(c.baseId).displayName));
    } else {
      el.textContent = c ? c.displayName : "";
    }
  }
  ESA.setNameEl = setNameEl;

  /* ================================================================== *
   * CASUAL CHARACTER SELECT
   *   tap a fighter -> preview + NORMAL / EVIL -> CONFIRM -> LOCKED IN
   * A first tap never commits anything; tapping another fighter before
   * Confirm simply moves the preview there (V4.1: no separate CHANGE
   * button - it was redundant). Back / moving away still drop a preview. The same exact identity (e.g.
   * Normal Zima, or one Guest) can't be on both sides - Zima vs Evil Zima
   * is the new mirror match.
   * ================================================================== */
  var cs = {
    entries: [],
    cols: 1,
    cursor: { p1: 0, p2: 0 },
    // SELECT -> CONFIRM -> LOCKED IN. `pending` is a chosen-but-unconfirmed
    // entry; only Confirm turns it into `locked`.
    pending: { p1: null, p2: null },
    locked: { p1: null, p2: null },
    lockedPid: { p1: null, p2: null },
    variant: { p1: "normal", p2: "normal" },     // of the pending / locked roster pick
    memory: { p1: {}, p2: {} },                  // last variant per character, per slot
    tiles: [],
    readyGen: 0
  };

  var VKEYS = {
    p1: { variant: "W S", change: "A D" },
    p2: { variant: "↑ ↓", change: "← →" }
  };

  function other(slot) { return slot === "p1" ? "p2" : "p1"; }
  function csEntry(i) { return i === null || i === undefined ? null : cs.entries[i] || null; }

  /** True if `slot` can't take entry i (variant v) because the other side has it. */
  function csTaken(slot, i, v) {
    var o = other(slot);
    if (cs.locked[o] === null || cs.locked[o] !== i) return false;
    var e = csEntry(i);
    return !!e && (e.kind === "guest" || (e.kind === "char" && cs.variant[o] === v));
  }

  /** Avatar shown for `slot` on entry i (variant applies once picked). */
  function csAvatar(slot, i, picked) {
    var e = csEntry(i);
    if (!e || e.kind === "add") return null;
    if (e.kind === "guest") return e.c;
    return picked ? ESA.Avatars.forVariant(e.c.id, cs.variant[slot]) : e.c;
  }

  function csBuildTiles() {
    var host = byId("csRoster");
    host.innerHTML = "";
    cs.tiles = cs.entries.map(function (e, i) {
      var b = rosterTile(e, i, "cs", { onGuestDeleted: csGuestDeleted });
      b.insertAdjacentHTML("beforeend", '<span class="cs-cursor p1">P1</span><span class="cs-cursor p2">P2</span>');
      b.addEventListener("click", function () { csClickTile(i); });
      host.appendChild(b);
      return b;
    });
    cs.cols = sizeRoster(host, host.parentNode, cs.entries.length, null, { label: 40, edge: 14 });
  }

  function csBuildSides() {
    ESA.SLOTS.forEach(function (slot) {
      var ctl = ESA.CONTROLS[slot];
      var side = byId(slot === "p1" ? "csSideP1" : "csSideP2");
      side.style.setProperty("--slot", ctl.color);
      side.innerHTML =
        '<div class="cs-side-head"><span class="slot-tag">' + ctl.short + '</span>' +
          '<span class="cs-state">Selecting</span></div>' +
        '<div class="cs-portrait art-box"><span class="cs-portrait-glow"></span>' +
          '<span class="art-frame cs-art"><img class="art-img" alt="" draggable="false" /></span>' +
          '<span class="cs-add-ph" aria-hidden="true"><span class="add-plus"></span></span>' +
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
          '<div class="cs-variant" role="group" aria-label="Normal or Evil">' +
            '<button class="cs-vbtn" type="button" data-v="normal">Normal</button>' +
            '<button class="cs-vbtn is-evil" type="button" data-v="evil">Evil</button>' +
          "</div>" +
          '<div class="cs-ask">Select <b class="cs-ask-name"></b>?</div>' +
          '<div class="cs-confirm-row">' +
            '<button class="btn btn-gold btn-small cs-ok" type="button">&#10003; Confirm</button>' +
          "</div>" +
          '<div class="cs-confirm-keys desk-only"><span class="keycap">' + esc(ctl.selectLabel.lock) +
            '</span> confirm <span class="cs-vkeys">&middot; <span class="keycap">' + esc(VKEYS[slot].variant) +
            '</span> normal / evil </span>&middot; <span class="keycap">' + esc(VKEYS[slot].change) + "</span> change</div>" +
        "</div>" +
        '<div class="cs-lockflash" aria-hidden="true"><span class="cs-lf-who"></span><span class="cs-lf-word">Locked In</span></div>';
      side.querySelector(".cs-change").addEventListener("click", function () { csUnlock(slot); });
      side.querySelector(".cs-ok").addEventListener("click", function () { csConfirm(slot); });
      Array.prototype.forEach.call(side.querySelectorAll(".cs-vbtn"), function (b) {
        b.addEventListener("click", function () { csSetVariant(slot, b.getAttribute("data-v")); });
      });
    });
  }

  /** A Guest was deleted: rebuild, keeping every cursor / pick on its fighter. */
  function csGuestDeleted() {
    if (App.state !== "charSelect") return;
    var old = cs.entries;
    cs.entries = rosterEntries();
    ESA.SLOTS.forEach(function (slot) {
      cs.cursor[slot] = remapEntry(old, cs.entries, cs.cursor[slot], Math.min(cs.cursor[slot], cs.entries.length - 1));
      cs.pending[slot] = remapEntry(old, cs.entries, cs.pending[slot], null);
      var wasLocked = cs.locked[slot] !== null;
      cs.locked[slot] = remapEntry(old, cs.entries, cs.locked[slot], null);
      if (wasLocked && cs.locked[slot] === null) {          // the deleted Guest was locked in
        cs.lockedPid[slot] = null;
        cs.readyGen++;
        byId("charSelectScreen").classList.remove("is-ready");
      }
    });
    csBuildTiles();
    csRender();
  }

  function csSide(slot) { return byId(slot === "p1" ? "csSideP1" : "csSideP2"); }

  /** The slot a mouse click / tap applies to: P1 until locked, then P2. */
  function csPointerSlot() {
    return cs.locked.p1 === null ? "p1" : (cs.locked.p2 === null ? "p2" : null);
  }

  function csEvilShown(slot, i) {
    var e = csEntry(i);
    return !!e && e.kind === "char" && cs.variant[slot] === "evil" &&
           (cs.pending[slot] === i || cs.locked[slot] === i);
  }

  function csRender() {
    cs.tiles.forEach(function (t, i) {
      t.classList.toggle("has-p1", cs.cursor.p1 === i);
      t.classList.toggle("has-p2", cs.cursor.p2 === i);
      t.classList.toggle("pending-p1", cs.pending.p1 === i);
      t.classList.toggle("pending-p2", cs.pending.p2 === i);
      t.classList.toggle("locked-p1", cs.locked.p1 === i);
      t.classList.toggle("locked-p2", cs.locked.p2 === i);
      t.classList.toggle("evil-p1", csEvilShown("p1", i));
      t.classList.toggle("evil-p2", csEvilShown("p2", i));
    });
    var turn = csPointerSlot();
    csSide("p1").parentNode.classList.toggle("has-pending",
      (cs.pending.p1 !== null && cs.locked.p1 === null) || (cs.pending.p2 !== null && cs.locked.p2 === null));
    ESA.SLOTS.forEach(function (slot) {
      var side = csSide(slot);
      var locked = cs.locked[slot] !== null;
      var pending = !locked && cs.pending[slot] !== null;
      var idx = locked ? cs.locked[slot] : (pending ? cs.pending[slot] : cs.cursor[slot]);
      var e = csEntry(idx);
      side.classList.toggle("is-locked", locked);
      side.classList.toggle("is-pending", pending);
      side.classList.toggle("is-turn", turn === slot);
      side.classList.toggle("is-add", !!e && e.kind === "add");
      side.classList.toggle("has-variants", !!e && e.kind === "char");
      if (!e) return;
      var stateEl = side.querySelector(".cs-state");
      if (e.kind === "add") {
        side.style.setProperty("--cc", "#e5a92f");
        side.querySelector(".cs-name").textContent = "Add Guest";
        side.querySelector(".cs-tagline").textContent = "Not on the roster? Create a fighter.";
        stateEl.textContent = "Selecting";
        side.querySelector(".cs-lock-word").textContent = "create";
        return;
      }
      var c = csAvatar(slot, idx, locked || pending);
      side.style.setProperty("--cc", c.color);
      ESA.setArt(side.querySelector(".cs-art"), c, locked ? "selected" : "normal", "body");
      setNameEl(side.querySelector(".cs-name"), c);
      side.querySelector(".cs-tagline").textContent = c.tagline || "";
      side.querySelector(".cs-ask-name").textContent = c.displayName;
      stateEl.textContent = locked ? "Ready" : (pending ? "Confirm?" : "Selecting");
      side.querySelector(".cs-lock-word").textContent = locked ? "change" : (pending ? "confirm" : "select");
      if (e.kind === "char") {
        Array.prototype.forEach.call(side.querySelectorAll(".cs-vbtn"), function (b) {
          var v = b.getAttribute("data-v");
          var taken = csTaken(slot, idx, v);
          b.classList.toggle("is-on", cs.variant[slot] === v);
          b.classList.toggle("is-taken", taken);
          b.setAttribute("aria-pressed", cs.variant[slot] === v ? "true" : "false");
          b.setAttribute("data-taken", taken ? other(slot).toUpperCase() : "");
        });
      }
    });
    var hint = byId("csTouchHint");
    if (hint) {
      var pe = turn && csEntry(cs.pending[turn]);
      hint.innerHTML = !turn ? "Both fighters locked in!"
        : (cs.pending[turn] !== null
            ? (pe && pe.kind === "char" ? "Pick <b>Normal</b> or <b>Evil</b>, then " : "Tap ") +
              '<b>Confirm</b> to lock in <b class="t-' + turn + '">' + turn.toUpperCase() + "</b>"
            : 'Tap a fighter for <b class="t-' + turn + '">' + turn.toUpperCase() + "</b>" +
              (turn === "p1" ? ', then one for <b class="t-p2">P2</b>' : ""));
    }
  }

  function csMove(slot, dir) {
    if (cs.locked[slot] !== null || !cs.entries.length) return;
    // While confirming a roster pick, up / down flips Normal <-> Evil.
    var pe = csEntry(cs.pending[slot]);
    if (pe && pe.kind === "char" && (dir === "up" || dir === "down")) {
      csSetVariant(slot, cs.variant[slot] === "evil" ? "normal" : "evil");
      return;
    }
    var from = cs.pending[slot] !== null ? cs.pending[slot] : cs.cursor[slot];
    var next = gridMove(from, dir, cs.entries.length, cs.cols);
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
    var e = csEntry(i);
    if (!e || cs.locked[slot] !== null) return;
    if (e.kind === "add") { cs.cursor[slot] = i; csRender(); csAddGuest(slot); return; }
    if (e.kind === "char" && e.c.slots.indexOf(slot) < 0) { ESA.Audio.play("denied"); return; }
    if (e.kind === "guest" && csTaken(slot, i)) { ESA.Audio.play("denied"); replay(cs.tiles[i], "is-shake"); return; }
    var changed = cs.pending[slot] !== i || cs.cursor[slot] !== i;
    if (e.kind === "char") {
      var v = changed ? (cs.memory[slot][e.c.id] || "normal") : cs.variant[slot];
      if (csTaken(slot, i, v)) v = v === "evil" ? "normal" : "evil";
      if (csTaken(slot, i, v)) { ESA.Audio.play("denied"); return; }
      cs.variant[slot] = v;
    }
    cs.cursor[slot] = i;
    cs.pending[slot] = i;
    ESA.Audio.play("toggleOn");
    csRender();
    if (changed) replay(csSide(slot).querySelector(".cs-portrait"), "is-swap");
    replay(csSide(slot).querySelector(".cs-confirm"), "is-in");
  }

  /** Normal / Evil for the pending roster pick - before Confirm only. */
  function csSetVariant(slot, v) {
    var i = cs.pending[slot];
    var e = csEntry(i);
    if (!e || e.kind !== "char" || cs.locked[slot] !== null) return;
    v = v === "evil" ? "evil" : "normal";
    if (cs.variant[slot] === v) return;
    if (csTaken(slot, i, v)) {
      ESA.Audio.play("denied");
      replay(csSide(slot).querySelector(".cs-variant"), "is-nudge");
      return;
    }
    cs.variant[slot] = v;
    cs.memory[slot][e.c.id] = v;
    ESA.Audio.play(v === "evil" ? "toggleOn" : "uiMove");
    csRender();
    replay(csSide(slot).querySelector(".cs-portrait"), "is-swap");
  }

  /** Step 2: Confirm turns the pending choice into a lock. */
  function csConfirm(slot) {
    if (App.state !== "charSelect" || cs.locked[slot] !== null || cs.pending[slot] === null) return;
    var i = cs.pending[slot];
    var e = csEntry(i);
    if (!e || e.kind === "add") return;
    if ((e.kind === "char" && e.c.slots.indexOf(slot) < 0) || csTaken(slot, i, cs.variant[slot])) {
      ESA.Audio.play("denied");
      return;
    }
    var p = e.kind === "guest" ? e.p : ESA.Participants.forVariant(e.c.id, cs.variant[slot]);
    if (!p) { ESA.Audio.play("denied"); return; }
    if (e.kind === "char") cs.memory[slot][e.c.id] = cs.variant[slot];
    cs.locked[slot] = i;
    cs.lockedPid[slot] = p.participantId;
    cs.cursor[slot] = i;
    cs.pending[slot] = null;
    ESA.Audio.play("lockIn");
    var side = csSide(slot);
    side.querySelector(".cs-lf-who").textContent = ESA.CONTROLS[slot].short + " · " + p.displayName;
    replay(side, "just-locked");
    replay(side.querySelector(".cs-lockflash"), "is-on");

    // The other side may be previewing the identity that was just taken.
    var o = other(slot);
    if (cs.pending[o] === i && csTaken(o, i, cs.variant[o])) {
      if (e.kind === "char") cs.variant[o] = cs.variant[o] === "evil" ? "normal" : "evil";
      else cs.pending[o] = null;
    }
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
    cs.lockedPid[slot] = null;
    cs.pending[slot] = null;
    cs.readyGen++;                         // cancels a pending "both ready" advance
    byId("charSelectScreen").classList.remove("is-ready");
    ESA.Audio.play("unlock");
    csRender();
  }

  /** Keyboard select key: select -> confirm, or unlock when already locked. */
  function csLockKey(slot) {
    if (!cs.entries.length) return;
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

  /** + Add Guest: create one, then preview them for this slot (still needs Confirm). */
  function csAddGuest(slot) {
    if (!ESA.Guests) return;
    ESA.Guests.openCreator({
      onDone: function (p) {
        if (App.state !== "charSelect") return;
        cs.entries = rosterEntries();
        csBuildTiles();
        for (var i = 0; i < cs.entries.length; i++) {
          if (cs.entries[i].kind === "guest" && cs.entries[i].p === p) { csSelect(slot, i); break; }
        }
        csRender();
      }
    });
  }

  function csCheckReady() {
    if (cs.locked.p1 === null || cs.locked.p2 === null) return;
    var gen = ++cs.readyGen;
    byId("charSelectScreen").classList.add("is-ready");
    App.timers.after(900, function () {
      if (gen !== cs.readyGen || App.state !== "charSelect") return;
      App.session.setup = { p1: cs.lockedPid.p1, p2: cs.lockedPid.p2 };
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
      cs.entries = rosterEntries();
      cs.locked.p1 = cs.locked.p2 = null;
      cs.lockedPid.p1 = cs.lockedPid.p2 = null;
      cs.pending.p1 = cs.pending.p2 = null;
      cs.variant.p1 = cs.variant.p2 = "normal";
      cs.memory = { p1: {}, p2: {} };
      cs.readyGen++;
      byId("charSelectScreen").classList.remove("is-ready");

      // Cursors start on the previous matchup (unlocked) or the first two;
      // a previous Evil pick is remembered as that slot's default variant.
      var prev = App.session.setup;
      var find = function (ref, slot, fallback) {
        var p = ref && ESA.Participants.resolve(ref);
        if (!p) return fallback;
        for (var i = 0; i < cs.entries.length; i++) {
          var e = cs.entries[i];
          if (p.type === "guest" && e.kind === "guest" && e.p === p) return i;
          if (p.type === "roster" && e.kind === "char" && e.c.id === p.characterId) {
            cs.memory[slot][e.c.id] = p.variant;
            return i;
          }
        }
        return fallback;
      };
      var second = Math.min(1, ESA.Characters.count() - 1);
      cs.cursor.p1 = prev ? find(prev.p1, "p1", 0) : 0;
      cs.cursor.p2 = prev ? find(prev.p2, "p2", second) : second;

      csBuildSides();
      csBuildTiles();
      csRender();
    },
    onResize: function () {
      cs.cols = sizeRoster(byId("csRoster"), byId("csRoster").parentNode, cs.entries.length, null, { label: 40, edge: 14 });
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
  /** A matchup side's name as safe HTML (EVIL styled; mirror labels kept). */
  function whoNameHTML(who) {
    if (who.participant && who.name === who.participant.displayName) return ESA.nameHTML(who.participant);
    return esc(who.name);
  }
  ESA.whoNameHTML = whoNameHTML;

  /**
   * One side of the VS screen. `tag` replaces the P1 / P2 slot label (Solo:
   * YOU); `badge` is trusted markup that replaces the tag entirely (Solo
   * CPU: the "CPU · HARD" chip). The plate is badge row + name, so on
   * phones it stacks inside its own half and can never run into the other.
   */
  function vsHalf(who, slot, tag, badge) {
    var c = who.character;
    return '<div class="vs-art-wrap art-box">' + ESA.bodyArtHTML(c, "selected", "vs-art") + "</div>" +
           '<div class="vs-plate"><span class="vs-tags">' +
             (badge || '<span class="vs-slot">' + esc(tag || ESA.CONTROLS[slot].short) + "</span>") + "</span>" +
           // Long names (Guests can be 16 characters) step the size down so
           // they wrap at word breaks inside their own half.
           '<span class="vs-name' + (who.name.length > 13 ? " is-xlong" : who.name.length > 9 ? " is-long" : "") + '">' +
             whoNameHTML(who) + "</span></div>";
  }

  function vsSolo() { return App.session.mode === "solo" && ESA.Solo && ESA.Solo.hasMatchup(); }

  function vsContinue() {
    if (App.state !== "vs") return;
    if (vsSolo()) {
      App.go("intro", { def: ESA.Solo.game(), setup: ESA.Solo.setup(), context: ESA.Solo.context() });
      return;
    }
    App.go("library");
  }

  App.register("vs", {
    el: "vsScreen",
    parent: function () { return vsSolo() ? "soloDifficulty" : "charSelect"; },
    crumb: "Casual",
    enter: function () {
      var solo = vsSolo();
      var setup = solo ? ESA.Solo.setup() : App.session.setup;
      this.crumb = solo ? "Solo" : "Casual";
      if (!setup) return;
      var who = ESA.describeMatchup(setup);
      var p1 = byId("vsP1"), p2 = byId("vsP2");
      p1.innerHTML = vsHalf(who.p1, "p1", solo ? "You" : null);
      p2.innerHTML = vsHalf(who.p2, "p2", null, solo ? ESA.Solo.cpuChipHTML() : "");
      byId("vsScreen").classList.toggle("is-solo", solo);
      p1.style.setProperty("--cc", who.p1.color);
      p2.style.setProperty("--cc", who.p2.color);
      p1.classList.toggle("is-evil", !!who.p1.character.evil);
      p2.classList.toggle("is-evil", !!who.p2.character.evil);
      replay(byId("vsScreen"), "is-playing");
    },
    afterEnter: function () {
      ESA.Audio.play("versus");
      App.timers.after(vsSolo() ? 2100 : 1750, vsContinue);
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
        '<span class="mu-name"><small>P1</small>' + whoNameHTML(who.p1) + "</span></span>" +
      '<span class="mu-vs">VS</span>' +
      '<span class="mu-side p2" style="--cc:' + esc(who.p2.color) + '">' +
        '<span class="mu-name"><small>P2</small>' + whoNameHTML(who.p2) + "</span>" +
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
      var c = App.params.context, m = c && c.mode;
      return m === "tournament" ? "hub" : m === "solo" ? (c.single ? "soloGames" : "soloDifficulty") : "library";
    },
    crumb: "Briefing",
    enter: function (p) {
      var g = p.def;
      var who = ESA.describeMatchup(p.setup);
      var isTour = p.context && p.context.mode === "tournament";
      var isSolo = p.context && p.context.mode === "solo";
      byId("introKicker").textContent = isTour ? (p.context.tag || "Tournament Match")
        : isSolo ? p.context.tag : "Casual Match";
      byId("introTitle").textContent = g.title;
      byId("introMode").textContent = ESA.Games.resolve(g, p.context).mode;
      byId("introRules").innerHTML = '<span class="desk-only">' + ((isSolo && g.solo.description) || g.description) + '</span>' +
        '<span class="touch-only">' + ((isSolo && g.solo.touchDescription) || g.touch.description || g.description) + "</span>";
      var single = !!(isSolo && p.context.single);
      if (single && g.solo.mode) byId("introMode").textContent = g.solo.mode + " · Score Attack";
      byId("introArt").innerHTML = ESA.Games.iconHTML(g);
      byId("introScreen").style.setProperty("--accent", g.accent);

      var html = "";
      (single ? ["p1"] : ESA.SLOTS).forEach(function (slot) {
        var w = who[slot];
        var cpu = isSolo && slot === p.context.cpuSlot;
        var tag = isSolo ? (cpu ? "CPU" : "You") : ESA.CONTROLS[slot].short;
        html += '<div class="ctrl' + (cpu ? " is-cpu" : "") + '" style="--pc:' + esc(w.color) + '">' +
                  '<span class="ctrl-face">' + portraitImg(w.character) + "</span>" +
                  '<span class="ctrl-text"><span class="ctrl-slot">' + esc(tag) + "</span>" +
                  '<span class="ctrl-name">' + whoNameHTML(w) + "</span></span>" +
                  (cpu
                    ? '<span class="ctrl-keys">' + ESA.Solo.cpuChipHTML(ESA.CPU.difficulty(p.context.difficulty)) + "</span>"
                    : '<span class="ctrl-keys desk-only">' + capsHTML(slot, g.controls) + "</span>" +
                      '<span class="ctrl-touch touch-only">' + touchSummaryHTML(g) +
                        '<span class="tside">' + (isSolo ? "Your controls" : slot === "p1" ? "Left side" : "Right side") + "</span></span>") +
                "</div>";
      });
      byId("introControls").innerHTML = html;
      byId("introControls").classList.toggle("is-single", single);
      this.crumb = isTour ? "Tournament · Briefing" : isSolo ? "Solo · Briefing" : "Casual · Briefing";
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
