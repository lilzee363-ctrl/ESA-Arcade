/* ==========================================================================
   ESA ARCADE - SOLO MODE (one human on the device)
   Mode -> soloSelect (your fighter: Normal / Evil / Guest)
        -> soloGames (registry: soloEligible; every card says VS CPU or
                      SCORE ATTACK)
   Two kinds of Solo game (registry soloModeType):
     cpu-versus    -> soloDifficulty (Easy / Normal / Hard) -> VS
                      -> Briefing -> match -> WIN / LOSS / DRAW
                      The human is P1, a CPU participant is P2, driven by
                      ESA.CPU through ESA.Controls - the game only exposes a
                      read-only observe(). Recorded in the VERSUS record.
     score-attack  -> Briefing -> one-player run -> RUN COMPLETE
                      No CPU, no difficulty, no P2. The game reads
                      context.single and reports result.score. Recorded
                      in SCORE ATTACK (attempts / latest / best).

   Everything Solo-specific about a match travels in its context:
     versus  { mode: "solo", matchId, difficulty, cpuSlot: "p2",
               slotTags: { p1: "YOU", p2: "CPU" }, hudKeys, tag }
     score   { mode: "solo", single: true, matchId, slotTags: { p1: "YOU" },
               hudKeys, tag }
   ========================================================================== */

(function (ESA) {
  "use strict";

  var App = ESA.App;
  var byId = ESA.byId;
  var esc = ESA.esc;
  var HUMAN = "p1", CPU = "p2";

  /** Cross-screen Solo state (lives in App.session; gone on refresh). */
  function S() {
    if (!App.session.solo) {
      App.session.solo = { humanPid: null, gameId: null, difficulty: "normal", cpuPid: null, statsFrom: null };
    }
    return App.session.solo;
  }

  function human() { return S().humanPid ? ESA.Participants.resolve(S().humanPid) : null; }
  function game() { return S().gameId ? ESA.Games.get(S().gameId) : null; }
  function diff() { return ESA.CPU.difficulty(S().difficulty); }
  function isScore(g) { return ESA.Games.isScoreAttack(g); }

  /* ================================================================== *
   * CPU opponent selection
   * A random permanent roster character, Normal (3x as likely) or Evil,
   * never the human's exact character + variant when anything else
   * exists, and less likely to be the same base character. The character
   * never changes difficulty - that is AI behaviour only.
   * ================================================================== */
  function pickCpu(humanP, diffId, gameId) {
    var chars = ESA.Characters.list();
    var pool = [], total = 0;
    chars.forEach(function (c) {
      ["normal", "evil"].forEach(function (v) {
        var same = humanP && humanP.type === "roster" && humanP.characterId === c.id;
        if (same && humanP.variant === v) return;          // the exact human identity
        var w = (v === "normal" ? 3 : 1) * (same ? 0.35 : 1);
        pool.push({ id: c.id, v: v, w: w });
        total += w;
      });
    });
    if (!pool.length) {                                     // a one-character roster
      var only = chars[0];
      return only ? ESA.Participants.addCpu(only.id, "normal", diffId, gameId) : null;
    }
    var roll = Math.random() * total;
    for (var i = 0; i < pool.length; i++) {
      roll -= pool[i].w;
      if (roll <= 0) return ESA.Participants.addCpu(pool[i].id, pool[i].v, diffId, gameId);
    }
    var last = pool[pool.length - 1];
    return ESA.Participants.addCpu(last.id, last.v, diffId, gameId);
  }

  function setup() {
    var s = S();
    if (isScore(game())) return s.humanPid ? { p1: s.humanPid } : null;   // one player, no P2
    return s.humanPid && s.cpuPid ? { p1: s.humanPid, p2: s.cpuPid } : null;
  }

  /** HUD key line for the human: keys on desktop, just YOU on touch. */
  function youKeys(g) {
    if (ESA.Touch && ESA.Touch.active) return "YOU";
    return "YOU · " + (g ? ESA.controlsFor(HUMAN, g.controls).text : "");
  }

  /** The match context for the current Solo selection. */
  function context() {
    var d = diff(), g = game();
    var label = d.label.toUpperCase();
    if (isScore(g)) {
      return {
        mode: "solo",
        single: true,
        slotTags: { p1: "YOU" },
        hudKeys: { p1: youKeys(g), p2: "" },
        tag: "Solo · Score Attack"
      };
    }
    return {
      mode: "solo",
      difficulty: d.id,
      cpuSlot: CPU,
      slotTags: { p1: "YOU", p2: "CPU" },
      hudKeys: {
        p1: youKeys(g),
        p2: "CPU · " + label
      },
      tag: "Solo · " + d.label + " CPU"
    };
  }

  /** New CPU opponent for a fresh matchup (rematches keep the same one). */
  function newOpponent() {
    var s = S();
    var cpu = pickCpu(human(), s.difficulty, s.gameId);
    s.cpuPid = cpu ? cpu.participantId : null;
    if (cpu && ESA.Variants) ESA.Variants.warm(ESA.Participants.avatar(cpu));
  }

  /** Start (or restart / rematch / retry) the current Solo match or run. */
  function play() {
    var g = game(), su = setup();
    if (!g || !su) { App.go("soloSelect"); return; }
    App.startMatch(g, su, context());           // App gives every start a new matchId
  }

  /** "CPU — HARD" chip markup. */
  function cpuChipHTML(d) {
    d = d || diff();
    return '<span class="so-cpu-chip" style="--dc:' + esc(d.color) + '">CPU &middot; ' + esc(d.label.toUpperCase()) + "</span>";
  }

  /* ================================================================== *
   * 1. CHOOSE YOUR FIGHTER (one side, same SELECT -> CONFIRM rules)
   * ================================================================== */
  var sel = {
    entries: [], tiles: [], cols: 1,
    cursor: 0, pending: null, variant: "normal", memory: {}, locked: false, gen: 0
  };

  function selEntry(i) { return i === null || i === undefined ? null : sel.entries[i] || null; }

  function selAvatar(i, picked) {
    var e = selEntry(i);
    if (!e || e.kind === "add") return null;
    if (e.kind === "guest") return e.c;
    return picked ? ESA.Avatars.forVariant(e.c.id, sel.variant) : e.c;
  }

  function selBuildSide() {
    var side = byId("soSide");
    var ctl = ESA.CONTROLS[HUMAN];
    side.style.setProperty("--slot", ctl.color);
    side.innerHTML =
      '<div class="cs-side-head"><span class="slot-tag">You</span><span class="cs-state">Selecting</span></div>' +
      '<div class="cs-portrait art-box"><span class="cs-portrait-glow"></span>' +
        '<span class="art-frame cs-art"><img class="art-img" alt="" draggable="false" /></span>' +
        '<span class="cs-add-ph" aria-hidden="true"><span class="add-plus"></span></span>' +
        '<span class="cs-stamp">Locked In</span></div>' +
      '<div class="cs-name"></div>' +
      '<div class="cs-tagline"></div>' +
      '<div class="cs-keys desk-only"><span class="keycap wide">W A S D</span><span class="cs-move-word">move</span>' +
        '<span class="keycap wide">Space</span><span class="cs-lock-word">select</span></div>' +
      '<div class="cs-confirm" role="group">' +
        '<div class="cs-variant" role="group" aria-label="Normal or Evil">' +
          '<button class="cs-vbtn" type="button" data-v="normal">Normal</button>' +
          '<button class="cs-vbtn is-evil" type="button" data-v="evil">Evil</button>' +
        "</div>" +
        '<div class="cs-ask">Play as <b class="cs-ask-name"></b>?</div>' +
        '<div class="cs-confirm-row">' +
          '<button class="btn btn-gold btn-small cs-ok" type="button">&#10003; Confirm</button>' +
          '<button class="btn btn-ghost btn-small cs-no" type="button">Change</button>' +
        "</div>" +
        '<div class="cs-confirm-keys desk-only"><span class="keycap">Space</span> confirm ' +
          '<span class="cs-vkeys">&middot; <span class="keycap">W S</span> normal / evil </span></div>' +
      "</div>" +
      '<div class="cs-lockflash" aria-hidden="true"><span class="cs-lf-who"></span><span class="cs-lf-word">Locked In</span></div>';
    side.querySelector(".cs-ok").addEventListener("click", selConfirm);
    side.querySelector(".cs-no").addEventListener("click", function () { selCancel(true); });
    Array.prototype.forEach.call(side.querySelectorAll(".cs-vbtn"), function (b) {
      b.addEventListener("click", function () { selSetVariant(b.getAttribute("data-v")); });
    });
  }

  function selBuildTiles() {
    var host = byId("soRoster");
    host.innerHTML = "";
    sel.tiles = sel.entries.map(function (e, i) {
      var b = ESA.rosterTile(e, i, "cs");
      b.insertAdjacentHTML("beforeend", '<span class="cs-cursor p1">YOU</span>');
      b.addEventListener("click", function () { selClick(i); });
      host.appendChild(b);
      return b;
    });
    sel.cols = ESA.sizeRoster(host, host.parentNode, sel.entries.length, null, { label: 40, edge: 14 });
  }

  function selRender() {
    sel.tiles.forEach(function (t, i) {
      var e = sel.entries[i];
      t.classList.toggle("has-p1", sel.cursor === i);
      t.classList.toggle("pending-p1", sel.pending === i);
      t.classList.toggle("locked-p1", sel.locked && sel.pending === i);
      t.classList.toggle("evil-p1", !!e && e.kind === "char" && sel.pending === i && sel.variant === "evil");
    });
    var side = byId("soSide");
    var pending = sel.pending !== null && !sel.locked;
    var idx = sel.pending !== null ? sel.pending : sel.cursor;
    var e = selEntry(idx);
    side.classList.toggle("is-pending", pending);
    side.classList.toggle("is-locked", sel.locked);
    side.classList.toggle("is-turn", !sel.locked);
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
    var c = selAvatar(idx, sel.pending !== null);
    side.style.setProperty("--cc", c.color);
    ESA.setArt(side.querySelector(".cs-art"), c, sel.locked ? "selected" : "normal", "body");
    ESA.setNameEl(side.querySelector(".cs-name"), c);
    side.querySelector(".cs-tagline").textContent = c.tagline || "";
    side.querySelector(".cs-ask-name").textContent = c.displayName;
    stateEl.textContent = sel.locked ? "Ready" : (pending ? "Confirm?" : "Selecting");
    side.querySelector(".cs-lock-word").textContent = pending ? "confirm" : "select";
    if (e.kind === "char") {
      Array.prototype.forEach.call(side.querySelectorAll(".cs-vbtn"), function (b) {
        var v = b.getAttribute("data-v");
        b.classList.toggle("is-on", sel.variant === v);
        b.classList.remove("is-taken");
        b.setAttribute("aria-pressed", sel.variant === v ? "true" : "false");
      });
    }
    var hint = byId("soTouchHint");
    if (hint) {
      hint.innerHTML = sel.locked ? "Fighter locked in!"
        : pending ? (e.kind === "char" ? "Pick <b>Normal</b> or <b>Evil</b>, then " : "Tap ") + "<b>Confirm</b>"
        : "Tap a fighter &middot; <b>+ Add Guest</b> to play as someone new";
    }
  }

  function selMove(dir) {
    if (sel.locked || !sel.entries.length) return;
    var pe = selEntry(sel.pending);
    if (pe && pe.kind === "char" && (dir === "up" || dir === "down")) {
      selSetVariant(sel.variant === "evil" ? "normal" : "evil");
      return;
    }
    var from = sel.pending !== null ? sel.pending : sel.cursor;
    var next = ESA.gridMove(from, dir, sel.entries.length, sel.cols);
    var had = sel.pending !== null;
    sel.pending = null;
    if (next === sel.cursor && !had) return;
    sel.cursor = next;
    ESA.Audio.play("uiMove");
    selRender();
    ESA.replayAnim(byId("soSide").querySelector(".cs-portrait"), "is-swap");
  }

  function selSelect(i) {
    var e = selEntry(i);
    if (!e || sel.locked) return;
    if (e.kind === "add") { sel.cursor = i; selRender(); selAddGuest(); return; }
    var changed = sel.pending !== i || sel.cursor !== i;
    if (e.kind === "char") sel.variant = changed ? (sel.memory[e.c.id] || "normal") : sel.variant;
    sel.cursor = i;
    sel.pending = i;
    ESA.Audio.play("toggleOn");
    selRender();
    var side = byId("soSide");
    if (changed) ESA.replayAnim(side.querySelector(".cs-portrait"), "is-swap");
    ESA.replayAnim(side.querySelector(".cs-confirm"), "is-in");
  }

  function selSetVariant(v) {
    var e = selEntry(sel.pending);
    if (!e || e.kind !== "char" || sel.locked) return;
    v = v === "evil" ? "evil" : "normal";
    if (sel.variant === v) return;
    sel.variant = v;
    sel.memory[e.c.id] = v;
    ESA.Audio.play(v === "evil" ? "toggleOn" : "uiMove");
    selRender();
    ESA.replayAnim(byId("soSide").querySelector(".cs-portrait"), "is-swap");
  }

  function selCancel(sound) {
    if (sel.pending === null || sel.locked) return false;
    sel.pending = null;
    if (sound) ESA.Audio.play("unlock");
    selRender();
    return true;
  }

  function selConfirm() {
    if (App.state !== "soloSelect" || sel.locked || sel.pending === null) return;
    var e = selEntry(sel.pending);
    if (!e || e.kind === "add") return;
    var p = e.kind === "guest" ? e.p : ESA.Participants.forVariant(e.c.id, sel.variant);
    if (!p) { ESA.Audio.play("denied"); return; }
    if (e.kind === "char") sel.memory[e.c.id] = sel.variant;
    sel.locked = true;
    var s = S();
    if (s.humanPid !== p.participantId) s.cpuPid = null;    // new human: new opponent later
    s.humanPid = p.participantId;
    ESA.Audio.play("lockIn");
    var side = byId("soSide");
    side.querySelector(".cs-lf-who").textContent = "YOU · " + p.displayName;
    ESA.replayAnim(side, "just-locked");
    ESA.replayAnim(side.querySelector(".cs-lockflash"), "is-on");
    selRender();
    var gen = ++sel.gen;
    App.timers.after(760, function () {
      if (gen !== sel.gen || App.state !== "soloSelect") return;
      App.go("soloGames");
    });
  }

  function selClick(i) {
    if (App.state !== "soloSelect" || sel.locked) return;
    if (sel.pending === i) { ESA.replayAnim(byId("soSide").querySelector(".cs-confirm"), "is-nudge"); return; }
    selSelect(i);
  }

  function selKey() {
    if (!sel.entries.length || sel.locked) return;
    if (sel.pending !== null) selConfirm();
    else selSelect(sel.cursor);
  }

  function selAddGuest() {
    if (!ESA.Guests) return;
    ESA.Guests.openCreator({
      onDone: function (p) {
        if (App.state !== "soloSelect") return;
        sel.entries = ESA.rosterEntries();
        selBuildTiles();
        for (var i = 0; i < sel.entries.length; i++) {
          if (sel.entries[i].kind === "guest" && sel.entries[i].p === p) { selSelect(i); break; }
        }
        selRender();
      }
    });
  }

  App.register("soloSelect", {
    el: "soloSelectScreen",
    parent: "mode",
    crumb: "Solo · Choose Your Fighter",
    ownsConfirmKeys: true,
    back: function () {
      var dropped = selCancel(false);
      ESA.Audio.play("uiBack");
      if (!dropped) App.go("mode");
    },
    enter: function () {
      App.session.mode = "solo";
      sel.entries = ESA.rosterEntries();
      sel.pending = null;
      sel.locked = false;
      sel.variant = "normal";
      sel.gen++;
      // Start on the current Solo fighter, if there is one.
      sel.cursor = 0;
      var cur = human();
      if (cur) {
        for (var i = 0; i < sel.entries.length; i++) {
          var e = sel.entries[i];
          if (cur.type === "guest" && e.kind === "guest" && e.p === cur) { sel.cursor = i; break; }
          if (cur.type === "roster" && e.kind === "char" && e.c.id === cur.characterId) {
            sel.memory[e.c.id] = cur.variant;
            sel.cursor = i;
            break;
          }
        }
      }
      selBuildSide();
      selBuildTiles();
      selRender();
      renderRecordStrip(byId("soSelectRecord"));
    },
    onResize: function () {
      sel.cols = ESA.sizeRoster(byId("soRoster"), byId("soRoster").parentNode, sel.entries.length, null, { label: 40, edge: 14 });
    },
    onKey: function (code) {
      if (code === "KeyW" || code === "ArrowUp") selMove("up");
      else if (code === "KeyS" || code === "ArrowDown") selMove("down");
      else if (code === "KeyA" || code === "ArrowLeft") selMove("left");
      else if (code === "KeyD" || code === "ArrowRight") selMove("right");
      else if (ESA.isConfirm(code)) selKey();
      else if (code === "KeyT") openStats("soloSelect");
    }
  });

  /* ================================================================== *
   * Compact "this session" strip (select / game screens). The Session
   * Stats button lives in its own row (#soStatsBtn / #soSelectStatsBtn),
   * never inside the strip.
   * ================================================================== */
  function renderRecordStrip(el) {
    if (!el || !ESA.SoloStats) return;
    var st = ESA.SoloStats.snapshot();
    el.innerHTML = "";
    var label = document.createElement("span");
    label.className = "sr-label";
    label.textContent = "This session";
    el.appendChild(label);
    var rec = document.createElement("b");
    rec.className = "sr-rec";
    rec.textContent = st.matches ? "VS " + ESA.SoloStats.line(st.overall) : "No versus matches yet";
    el.appendChild(rec);
    if (st.runs) {
      var r = document.createElement("span");
      r.className = "sr-runs";
      r.textContent = st.runs + (st.runs === 1 ? " run" : " runs");
      el.appendChild(r);
    }
    if (st.hardDefeated) {
      var h = document.createElement("span");
      h.className = "sr-hard";
      h.textContent = "Hard CPU defeated ×" + st.hardDefeated;
      el.appendChild(h);
    }
  }

  function openStats(from) {
    if (ESA.Screens.busy) return;
    S().statsFrom = from || null;
    ESA.Audio.play("uiClick");
    App.go("soloStats");
  }

  /* ================================================================== *
   * 2. CHOOSE A GAME (registry-driven)
   * ================================================================== */
  var gs = { list: [], cards: [], focus: 0 };

  /** Format label for a game in Solo ("First to 5", "60 seconds"). */
  function soloModeLabel(g) {
    return g.solo.mode || ESA.Games.resolve(g, { mode: "solo" }).mode;
  }

  /** One line of session record for a game card. */
  function cardRecord(g, st) {
    if (isScore(g)) {
      var row = null;
      st.scoreAttack.forEach(function (x) { if (x.gameId === g.id) row = x; });
      return row ? "Best " + row.best + " · " + row.attempts + (row.attempts === 1 ? " run" : " runs") : "";
    }
    var r = st.byGame[g.id];
    return r && (r.w + r.d + r.l) ? ESA.SoloStats.line(r) : "";
  }

  function gsBuild() {
    var host = byId("soGameGrid");
    host.innerHTML = "";
    // Every Solo-eligible game is playable: VS CPU (needs a CPU strategy)
    // or SCORE ATTACK (no CPU). Games without Solo support are not listed.
    // VS CPU games first, then Score Attack (registration order within each).
    var all = ESA.Games.soloPool();
    var playable = all.filter(function (g) { return !isScore(g); }).concat(all.filter(isScore));
    var st = ESA.SoloStats.snapshot();
    gs.list = playable;
    gs.cards = [];
    playable.forEach(function (g, i) {
      var score = isScore(g);
      var rec = cardRecord(g, st);
      var b = document.createElement("button");
      b.type = "button";
      b.className = "so-game " + (score ? "is-score" : "is-versus");
      b.style.setProperty("--accent", g.accent);
      b.innerHTML =
        '<span class="sg-badge">' + (score ? "Score Attack" : "VS CPU") + "</span>" +
        '<span class="sg-art">' + ESA.Games.iconHTML(g) + "</span>" +
        '<span class="sg-title">' + esc(g.title) + "</span>" +
        '<span class="sg-mode">' + esc(soloModeLabel(g)) + "</span>" +
        '<span class="sg-blurb"><span class="desk-only">' + esc(g.solo.blurb || g.tagline) + '</span>' +
          '<span class="touch-only">' + esc(g.solo.touchBlurb || g.solo.blurb || g.touch.tagline || g.tagline) + "</span></span>" +
        '<span class="sg-rec">' + esc(rec) + "</span>" +
        '<span class="sg-cta"><span class="desk-only">&#9654; Press Enter</span><span class="touch-only">&#9654; Tap to play</span></span>';
      b.addEventListener("mouseenter", function () { if (App.state === "soloGames") gsFocus(i, true); });
      b.addEventListener("click", function () { gsChoose(i); });
      host.appendChild(b);
      gs.cards.push(b);
    });
  }

  function gsFocus(i, silent) {
    if (!gs.cards.length) return;
    var n = gs.cards.length;
    var next = ((i % n) + n) % n;
    if (next !== gs.focus && !silent) ESA.Audio.play("uiMove");
    gs.focus = next;
    gs.cards.forEach(function (c, k) { c.classList.toggle("is-focus", k === gs.focus); });
  }

  function gsChoose(i) {
    var g = gs.list[i];
    if (!g || App.state !== "soloGames" || ESA.Screens.busy) return;
    var s = S();
    if (s.gameId !== g.id) s.cpuPid = null;
    s.gameId = g.id;
    gsFocus(i, true);
    ESA.Audio.play("lockIn");
    // Score Attack has no CPU and no difficulty: straight to the briefing.
    if (isScore(g)) App.go("intro", { def: g, setup: setup(), context: context() });
    else App.go("soloDifficulty");
  }

  function fighterBadgeHTML() {
    var p = human();
    if (!p) return "";
    var av = ESA.Participants.avatar(p);
    return '<span class="so-me" style="--cc:' + esc(av ? av.color : "#f3c35a") + '">' +
             '<span class="mu-face">' + ESA.portraitImg(av) + "</span>" +
             '<span class="so-me-text"><small>You</small><span class="so-me-name">' + ESA.nameHTML(p) + "</span></span>" +
           "</span>";
  }

  App.register("soloGames", {
    el: "soloGamesScreen",
    parent: "soloSelect",
    crumb: "Solo · Choose a Game",
    enter: function () {
      if (!human()) { App.redirect("soloSelect"); return; }
      byId("soGamesMe").innerHTML = fighterBadgeHTML();
      gsBuild();
      var idx = 0;
      gs.list.forEach(function (g, i) { if (g.id === S().gameId) idx = i; });
      gs.focus = -1;
      gsFocus(idx, true);
      renderRecordStrip(byId("soGamesRecord"));
    },
    afterEnter: function () {
      // Keep the focused card in view on phones (the grid scrolls).
      var c = gs.cards[gs.focus];
      if (c && ESA.Touch && ESA.Touch.active && c.scrollIntoView) c.scrollIntoView({ block: "nearest" });
    },
    onKey: function (code) {
      if (code === "ArrowLeft" || code === "KeyA" || code === "ArrowUp" || code === "KeyW") gsFocus(gs.focus - 1);
      else if (code === "ArrowRight" || code === "KeyD" || code === "ArrowDown" || code === "KeyS") gsFocus(gs.focus + 1);
      else if (ESA.isConfirm(code)) gsChoose(gs.focus);
      else if (code === "KeyC") { ESA.Audio.play("uiBack"); App.go("soloSelect"); }
      else if (code === "KeyT") openStats("soloGames");
    }
  });

  /* ================================================================== *
   * 3. DIFFICULTY
   * ================================================================== */
  var dsel = { cards: [], focus: 1, choosing: false };
  var diffScroll = null;                  // shared Mode Select scroll focus (phones)
  var DIFF_ICON = { easy: "&#9733;", normal: "&#9733;&#9733;", hard: "&#9733;&#9733;&#9733;" };

  function dBuild() {
    var host = byId("soDiffGrid");
    host.innerHTML = "";
    dsel.cards = ESA.CPU.DIFFICULTIES.map(function (d, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "so-diff is-" + d.id;
      b.style.setProperty("--dc", d.color);
      b.innerHTML =
        '<span class="sd-stars" aria-hidden="true">' + DIFF_ICON[d.id] + "</span>" +
        '<span class="sd-title">' + esc(d.label) + "</span>" +
        '<span class="sd-blurb">' + esc(d.blurb) + "</span>" +
        '<span class="sd-rec"></span>' +
        '<span class="sd-cta"><span class="desk-only">&#9654; Press Enter</span><span class="touch-only">&#9654; Tap to fight</span></span>';
      b.addEventListener("mouseenter", function () {
        if (App.state === "soloDifficulty" && !dsel.choosing && !(diffScroll && diffScroll.stacked())) dFocus(i, true);
      });
      b.addEventListener("click", function () { dChoose(i); });
      host.appendChild(b);
      return b;
    });
    var st = ESA.SoloStats.snapshot();
    ESA.CPU.DIFFICULTIES.forEach(function (d, i) {
      var r = st.byDifficulty[d.id];
      var n = r.w + r.d + r.l;
      dsel.cards[i].querySelector(".sd-rec").textContent = n ? "This session " + ESA.SoloStats.line(r) : "";
    });
  }

  function dFocus(i, silent) {
    var n = dsel.cards.length;
    var next = ((i % n) + n) % n;
    if (next !== dsel.focus && !silent) ESA.Audio.play("uiMove");
    dsel.focus = next;
    dsel.cards.forEach(function (c, k) { c.classList.toggle("is-focus", k === dsel.focus); });
  }

  function dChoose(i) {
    if (dsel.choosing || App.state !== "soloDifficulty" || ESA.Screens.busy) return;
    var d = ESA.CPU.DIFFICULTIES[i];
    if (!d) return;
    dsel.choosing = true;
    dFocus(i, true);
    dsel.cards[i].classList.add("is-chosen");
    byId("soDiffGrid").classList.add("is-choosing");
    ESA.Audio.play("lockIn");
    var s = S();
    s.difficulty = d.id;
    newOpponent();                       // a fresh rival for every new matchup
    App.timers.after(480, function () { App.go("vs"); });
  }

  App.register("soloDifficulty", {
    el: "soloDiffScreen",
    parent: "soloGames",
    crumb: "Solo · CPU Difficulty",
    enter: function () {
      if (!human()) { App.redirect("soloSelect"); return; }
      if (!game()) { App.redirect("soloGames"); return; }
      dsel.choosing = false;
      byId("soDiffGrid").classList.remove("is-choosing");
      byId("soDiffGame").textContent = game().title;
      byId("soDiffMe").innerHTML = fighterBadgeHTML();
      dBuild();
      var idx = 1;
      ESA.CPU.DIFFICULTIES.forEach(function (d, i) { if (d.id === S().difficulty) idx = i; });
      dsel.focus = -1;
      dFocus(idx, true);
      // Phones (stacked cards): start at the top with EASY active; the
      // active card then follows the scroll (Easy -> Normal -> Hard).
      if (diffScroll) diffScroll.reset();
    },
    onKey: function (code) {
      if (code === "ArrowLeft" || code === "KeyA") dFocus(dsel.focus - 1);
      else if (code === "ArrowRight" || code === "KeyD") dFocus(dsel.focus + 1);
      else if (ESA.isConfirm(code)) dChoose(dsel.focus);
    }
  });

  /* ================================================================== *
   * 4. SESSION STATS
   * ================================================================== */
  function statTile(label, value, cls) {
    return '<div class="ss-tile ' + (cls || "") + '"><span class="ss-label">' + esc(label) + "</span>" +
           '<b class="ss-value">' + esc(value) + "</b></div>";
  }

  function wdlCells(r) {
    return '<span class="ss-w">' + r.w + "W</span>" +
           '<span class="ss-d">' + r.d + "D</span>" +
           '<span class="ss-l">' + r.l + "L</span>";
  }

  function streakText(st) { return st.streak > 0 ? "W" + st.streak : "—"; }

  function renderStats() {
    var st = ESA.SoloStats.snapshot();
    var body = byId("ssBody");
    var html = '<section class="ss-section is-versus"><h3 class="ss-h"><span>Versus Record</span>' +
      '<small>Air Hockey &middot; Bomb Pass &middot; vs the CPU</small></h3>' + versusHTML(st) + "</section>" +
      '<section class="ss-section is-score"><h3 class="ss-h"><span>Score Attack</span>' +
      "<small>Solo runs &middot; best this session</small></h3>" + scoreHTML(st) + "</section>";
    body.innerHTML = html;
  }

  /** Score Attack: one compact card per game (attempts, latest, best). */
  function scoreHTML(st) {
    var games = ESA.Games.soloPool().filter(isScore);
    var byId_ = {};
    st.scoreAttack.forEach(function (x) { byId_[x.gameId] = x; });
    // Any game that reported a score but is no longer listed still shows.
    st.scoreAttack.forEach(function (x) { if (!games.some(function (g) { return g.id === x.gameId; })) games.push({ id: x.gameId, title: x.gameId, accent: "#f3c35a" }); });
    if (!games.length) return "";
    var html = '<div class="ss-scores">';
    games.forEach(function (g) {
      var r = byId_[g.id];
      html += '<div class="ss-score' + (r ? "" : " is-empty") + '" style="--accent:' + esc(g.accent || "#f3c35a") + '">' +
        '<span class="ss-sg">' + esc(g.title) + "</span>" +
        '<span class="ss-best"><small>Session best</small><b>' + (r ? esc(String(r.best)) : "—") + "</b></span>" +
        '<span class="ss-sub"><span><small>Latest</small><b>' + (r ? esc(String(r.latest)) : "—") + "</b></span>" +
        "<span><small>Attempts</small><b>" + (r ? r.attempts : 0) + "</b></span></span>" +
        "</div>";
    });
    return html + "</div>";
  }

  function versusHTML(st) {
    if (!st.matches) {
      return '<div class="ss-empty"><b>No versus matches yet</b>' +
        "<span>Beat a CPU in Air Hockey or Bomb Pass and your record starts here.</span></div>";
    }
    var html = '<div class="ss-hero">' +
      statTile("Overall", ESA.SoloStats.line(st.overall), "is-wide") +
      statTile("Win rate", ESA.SoloStats.pct(st.winRate)) +
      statTile("Current streak", streakText(st)) +
      statTile("Best streak", st.bestStreak ? "W" + st.bestStreak : "—") +
      statTile("Hard CPU defeated", "×" + st.hardDefeated, "is-hard" + (st.hardDefeated ? " is-lit" : "")) +
      "</div>";

    html += '<div class="ss-cols"><section class="ss-panel"><h3>By difficulty</h3>';
    ESA.CPU.DIFFICULTIES.forEach(function (d) {
      html += '<div class="ss-row" style="--dc:' + esc(d.color) + '"><span class="ss-name"><i class="ss-dot"></i>' +
              esc(d.label) + '</span><span class="ss-wdl">' + wdlCells(st.byDifficulty[d.id]) + "</span></div>";
    });
    html += "</section>";

    html += '<section class="ss-panel"><h3>By game</h3>';
    // Every CPU-versus game, played or not, then anything else recorded.
    var ids = ESA.Games.soloPool().filter(function (g) { return !isScore(g); }).map(function (g) { return g.id; });
    Object.keys(st.byGame).forEach(function (id) { if (ids.indexOf(id) < 0) ids.push(id); });
    ids.forEach(function (id) {
      if (!st.byGame[id]) st.byGame[id] = { w: 0, d: 0, l: 0 };
      var g = ESA.Games.get(id);
      html += '<div class="ss-row"><span class="ss-name">' + esc(g ? g.title : id) + '</span><span class="ss-wdl">' +
              wdlCells(st.byGame[id]) + "</span></div>";
    });
    html += "</section>";

    if (st.players.length) {
      html += '<section class="ss-panel"><h3>Fighters</h3>';
      st.players.forEach(function (p) {
        var part = ESA.Participants.get(p.participantId);
        var av = part ? ESA.Participants.avatar(part) : null;
        html += '<div class="ss-row is-player"><span class="ss-name">' +
                (av ? '<span class="ss-face mu-face">' + ESA.portraitImg(av) + "</span>" : "") +
                '<span class="ss-pname">' + (part ? ESA.nameHTML(part) : esc(p.name)) +
                (p.guest ? ' <em class="ss-guest">Guest</em>' : "") + "</span></span>" +
                '<span class="ss-wdl">' + wdlCells(p) + "</span></div>";
      });
      html += "</section>";
    }
    html += "</div>";
    return html;
  }

  function statsBack() {
    var from = S().statsFrom;
    ESA.Audio.play("uiBack");
    App.go(from && App.screens[from] && from !== "soloStats" && from !== "play" ? from : "soloGames");
  }

  App.register("soloStats", {
    el: "soloStatsScreen",
    crumb: "Solo · Session Stats",
    back: statsBack,
    enter: function () { renderStats(); },
    onKey: function (code) { if (ESA.isConfirm(code)) statsBack(); }
  });

  /* ================================================================== *
   * 5. MATCH END - record once, then show the session record
   * ================================================================== */
  function outcomeOf(result) {
    if (!result || !result.winner) return "d";
    return result.winner === HUMAN ? "w" : "l";
  }

  /** RUN COMPLETE block: SCORE + SESSION BEST (and a NEW BEST flash). */
  function scoreExtra(rec, score) {
    var box = document.createElement("div");
    box.className = "so-result is-run";
    if (rec.newBest && rec.previousBest !== null) {
      var nb = document.createElement("div");
      nb.className = "so-newbest";
      nb.textContent = "New session best!";
      box.appendChild(nb);
    }
    var row = document.createElement("div");
    row.className = "so-runscore";
    row.innerHTML =
      '<span class="rs is-score"><small>Score</small><b>' + esc(String(score)) + "</b></span>" +
      '<span class="rs is-best"><small>Session best</small><b>' + esc(String(rec.best === null ? score : rec.best)) + "</b></span>";
    box.appendChild(row);
    var att = document.createElement("div");
    att.className = "so-attempts";
    att.textContent = "Attempt " + rec.attempts + " this session";
    box.appendChild(att);
    return box;
  }

  function resultExtra(rec, outcome) {
    var st = rec.snapshot;
    var box = document.createElement("div");
    box.className = "so-result";
    if (rec.firstHardWin) {
      var ach = document.createElement("div");
      ach.className = "so-achievement";
      ach.innerHTML = '<span class="sa-k">Achievement</span><b class="sa-t">CPU Slayer</b><span class="sa-s">Hard mode defeated</span>';
      box.appendChild(ach);
    }
    var row = document.createElement("div");
    row.className = "so-session";
    row.innerHTML =
      '<span class="sx"><small>Versus record</small><b>' + esc(ESA.SoloStats.line(st.overall)) + "</b></span>" +
      '<span class="sx"><small>Streak</small><b>' + esc(streakText(st)) + "</b></span>" +
      '<span class="sx is-hard' + (st.hardDefeated ? " is-lit" : "") + '"><small>Hard CPU defeated</small><b>×' + st.hardDefeated + "</b></span>";
    box.appendChild(row);
    box.classList.add("is-" + (outcome === "w" ? "win" : outcome === "l" ? "loss" : "draw"));
    return box;
  }

  function leaveTo(screen) {
    return function () { ESA.Audio.play("uiBack"); App.go(screen); };
  }

  function statsFromResult() { S().statsFrom = "soloGames"; ESA.Audio.play("uiClick"); App.go("soloStats"); }

  /** Score Attack run end: record the score once, show RUN COMPLETE. */
  function onRunEnd(run, result) {
    var ctx = run.context;
    var score = typeof result.score === "number" ? result.score : (result.scores ? result.scores.p1 : 0);
    var rec = ESA.SoloStats.recordScore({ matchId: ctx.matchId, gameId: run.def.id, score: score });
    var out = {};
    for (var k in result) out[k] = result[k];
    out.winner = "p1";                         // the portrait shows the runner
    out.kicker = run.def.title + " · Score Attack";
    out.title = "Run Complete";
    out.outcome = "run";
    out.extra = scoreExtra(rec, score);
    if (rec.newBest && rec.previousBest !== null) ESA.Audio.play("tokenBonus");
    return {
      result: out,
      actions: [
        { label: "Retry", kind: "gold", onClick: function () { play(); } },
        { label: "Change Character", kind: "small", onClick: leaveTo("soloSelect") },
        { label: "Solo Game Select", kind: "small", onClick: leaveTo("soloGames") },
        { label: "Session Stats", kind: "small", onClick: statsFromResult },
        { label: "Back to Arcade", kind: "small", onClick: leaveTo("mode") }
      ]
    };
  }

  ESA.Solo = {
    /** Called by app.js once per run (run guard), returns { result, actions }. */
    onMatchEnd: function (run, result) {
      var ctx = run.context;
      if (ctx.single) return onRunEnd(run, result);
      var outcome = outcomeOf(result);
      var humanP = ESA.Participants.resolve(run.setup[HUMAN]);
      var rec = ESA.SoloStats.record({
        matchId: ctx.matchId,
        gameId: run.def.id,
        difficulty: ctx.difficulty,
        outcome: outcome,
        participant: humanP
      });
      var d = ESA.CPU.difficulty(ctx.difficulty);
      var out = {};
      for (var k in result) out[k] = result[k];
      out.kicker = run.def.title + " · " + d.label + " CPU";
      out.title = outcome === "w" ? "Win" : outcome === "l" ? "Loss" : "Draw";
      out.outcome = outcome === "w" ? "win" : outcome === "l" ? "loss" : "draw";
      out.extra = resultExtra(rec, outcome);
      if (rec.firstHardWin) {
        ESA.Audio.play("tokenBonus");
      }
      return {
        result: out,
        actions: [
          { label: "Rematch", kind: "gold", onClick: function () { play(); } },
          { label: "Change Difficulty", kind: "small", onClick: leaveTo("soloDifficulty") },
          { label: "Change Character", kind: "small", onClick: leaveTo("soloSelect") },
          { label: "Solo Game Select", kind: "small", onClick: leaveTo("soloGames") },
          { label: "Session Stats", kind: "small", onClick: statsFromResult },
          { label: "Back to Arcade", kind: "small", onClick: leaveTo("mode") }
        ]
      };
    },

    pauseMenu: function (run) {
      var single = !!run.context.single;
      function leave(screen) {
        return function () {
          ESA.Modal.confirm({
            title: single ? "Leave Run?" : "Leave Match?",
            body: single ? "This run won't count - only finished runs go into Session Stats."
                         : "This match won't count - only finished Solo matches go into Session Stats.",
            safe: "Continue Playing",
            danger: single ? "Exit Run" : "Exit Match",
            onConfirm: function () { App.go(screen); }
          });
        };
      }
      if (single) {
        return {
          type: "menu",
          kicker: run.def.title + " · Score Attack",
          title: "Paused",
          onEscape: App.resume,
          items: App.withTouchSetup([
            { label: "Resume", kind: "safe", action: App.resume },
            { label: "Restart Run", action: function () {
              ESA.Modal.confirm({
                title: "Restart Run?",
                body: "The score resets and the run starts again. Nothing is recorded for this one.",
                safe: "Keep Playing", danger: "Restart",
                onConfirm: play
              });
            } },
            { label: "Change Character", action: leave("soloSelect") },
            { label: "Solo Game Select", action: leave("soloGames") },
            { label: "Exit to Mode Select", kind: "danger", action: leave("mode") }
          ])
        };
      }
      return {
        type: "menu",
        kicker: run.def.title + " · " + ESA.CPU.difficulty(run.context.difficulty).label + " CPU",
        title: "Paused",
        onEscape: App.resume,
        items: App.withTouchSetup([
          { label: "Resume", kind: "safe", action: App.resume },
          { label: "Restart Match", action: function () {
            ESA.Modal.confirm({
              title: "Restart Match?",
              body: "The score resets and the match starts again. Nothing is recorded for this one.",
              safe: "Keep Playing", danger: "Restart",
              onConfirm: play
            });
          } },
          { label: "Change Difficulty", action: leave("soloDifficulty") },
          { label: "Change Character", action: leave("soloSelect") },
          { label: "Exit to Mode Select", kind: "danger", action: leave("mode") }
        ])
      };
    },

    /** Matchup + context for the VS / briefing screens. */
    setup: setup,
    context: context,
    cpuChipHTML: cpuChipHTML,
    game: game,
    play: play,
    hasMatchup: function () { return !!(setup() && game()); }
  };

  ESA.SoloMenus = {
    init: function () {
      byId("ssBackBtn").addEventListener("click", statsBack);
      byId("soGamesStatsBtn").addEventListener("click", function () { openStats("soloGames"); });
      byId("soSelectStatsBtn").addEventListener("click", function () { openStats("soloSelect"); });
      diffScroll = new ESA.ScrollFocus({
        screen: "soloDiffScreen", state: "soloDifficulty",
        cards: function () { return dsel.cards; },
        focus: function () { return dsel.focus; },
        setFocus: function (i) { dFocus(i, true); },
        blocked: function () { return dsel.choosing; }
      });
    }
  };

})(window.ESA);
