/* ==========================================================================
   ESA ARCADE - TOURNAMENT SCREENS
   Participant Select -> Intro -> [ Game Draw -> Fixtures -> Hub -> matches
   -> Standings ] x league rounds -> Bracket -> knockout rounds -> The Final
   -> Champion

   ESA.Tournament (js/tournament.js) owns every rule. These screens only
   present its state and ask it to move on. Results reach it from the play
   screen through TournamentUI.onMatchEnd(), which records each match once.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var App = ESA.App;
  var Modal = ESA.Modal;
  var byId = ESA.byId;
  var esc = ESA.esc;
  var portraitImg = ESA.portraitImg;

  function T() { return App.session.tournament; }
  // Every id in a tournament (fixtures, standings, byes, bracket, champion)
  // is a PARTICIPANT id - never a character id.
  function av(id) { return ESA.Participants.avatar(id); }
  function name(id) { var p = ESA.Participants.get(id); return p ? p.displayName : "?"; }
  function nameHTML(id) { return ESA.nameHTML(id) || "?"; }
  function gameOf(id) { return ESA.Games.get(id); }

  /** Bail out to Mode Select if a screen is opened without a tournament. */
  function requireTournament() {
    if (T()) return true;
    App.redirect("mode");
    return false;
  }

  function face(id, cls) {
    var c = av(id);
    if (!c) return '<span class="t-face ' + (cls || "") + '"></span>';
    return '<span class="t-face ' + (cls || "") + '" style="--cc:' + esc(c.color) + '">' + portraitImg(c) + "</span>";
  }

  function roundLabel(t, r) {
    if (r.kind === "league") return "Round " + r.number;
    return r.name;
  }

  function matchTag(t, r, m) {
    if (r.kind === "league") {
      var i = r.matches.indexOf(m) + 1;
      return "Round " + r.number + " · Match " + i + " of " + r.matches.length;
    }
    if (t.isFinal(r)) return "The Final";
    var single = r.name.replace(/s$/, "");
    return single + " " + (r.matches.indexOf(m) + 1) + " of " + r.matches.length;
  }

  function formatSteps(f) {
    var steps = [{ k: "League Stage", v: f.leagueRounds + " rounds" }];
    if (f.knockoutRounds.length > 1) steps.push({ k: "Top " + f.qualifiers, v: "qualify" });
    f.knockoutRounds.forEach(function (n) {
      steps.push({ k: n, v: n === "The Final" ? "winner takes all" : "knockout" });
    });
    return steps;
  }

  function formatLine(f) {
    return formatSteps(f).map(function (s) { return s.k; }).join("  →  ");
  }

  function leaveTournamentConfirm() {
    Modal.confirm({
      title: "Leave Tournament?",
      body: "Current standings and knockout progress will be lost.",
      safe: "Stay in Tournament",
      danger: "Exit to Arcade",
      onConfirm: function () {
        if (App.go("mode")) App.session.tournament = null;
      }
    });
  }

  /* --- Shared compact renderers ------------------------------------ */
  function miniStandingsHTML(t, opts) {
    opts = opts || {};
    var rows = t.standings();
    var q = t.format.qualifiers;
    var html = '<table class="mini-table"><thead><tr><th>#</th><th class="l">Player</th>' +
               "<th>P</th><th>W</th><th>D</th><th>L</th><th>+/-</th><th>Pts</th></tr></thead><tbody>";
    rows.forEach(function (r, i) {
      html += '<tr class="' + (i < q ? "is-q" : "") + (i === q - 1 ? " q-edge" : "") + '">' +
              "<td>" + (i + 1) + '</td><td class="l">' + face(r.id, "sm") + "<span>" + nameHTML(r.id) + "</span></td>" +
              "<td>" + r.played + "</td><td>" + r.wins + "</td><td>" + r.draws + "</td><td>" + r.losses + "</td>" +
              "<td>" + (r.diff > 0 ? "+" : "") + r.diff + '</td><td class="pts">' + r.points + "</td></tr>";
    });
    html += "</tbody></table>";
    if (opts.legend !== false) html += '<div class="mini-legend"><i></i>Top ' + q + " qualify for the knockouts</div>";
    return html;
  }

  function miniKnockoutHTML(t) {
    var html = '<div class="mini-ko">';
    t.knockoutRounds().forEach(function (r) {
      html += '<div class="mini-ko-round"><div class="mini-ko-name">' + esc(r.name) +
              (r.gameId ? ' <span>' + esc(gameOf(r.gameId).title) + "</span>" : "") + "</div>";
      r.matches.forEach(function (m) {
        html += '<div class="mini-ko-match">' +
                entrantLine(m, m.a, m.scoreA) + entrantLine(m, m.b, m.scoreB) + "</div>";
      });
      html += "</div>";
    });
    return html + "</div>";

    function entrantLine(m, id, score) {
      var cls = m.status === "done" ? (m.winner === id ? "is-winner" : "is-loser") : "";
      return '<div class="mini-ko-line ' + cls + '">' + face(id, "xs") + "<span>" + nameHTML(id) +
             "</span><b>" + (m.status === "done" ? score : "") + "</b></div>";
    }
  }

  /* ================================================================== *
   * PARTICIPANT SELECT - up to MAX_ACTIVE (25) distinct participants.
   *   roster tile   -> Normal / Evil sheet (each variant added separately)
   *   guest tile    -> toggles that guest
   *   + Add Guest   -> guest creator; the new guest joins the selection
   * The selection is an ordered list of PARTICIPANT ids - the tournament's
   * only notion of identity.
   * ================================================================== */
  var ps = { entries: [], selected: [], focus: 0, cols: 1, tiles: [] };

  function MAX() { return ESA.Participants.MAX_ACTIVE; }
  function psHas(pid) { return ps.selected.indexOf(pid) >= 0; }
  function psFull() { return ps.selected.length >= MAX(); }

  /** Selected participant (if any) for a roster variant. */
  function psVariantPid(charId, v) {
    var p = ESA.Participants.findVariant(charId, v);
    return p && psHas(p.participantId) ? p.participantId : null;
  }

  /** Feedback when the roster is full (participant 26 never gets in). */
  function psFullFeedback(target) {
    ESA.Audio.play("denied");
    var note = byId("psNote");
    note.textContent = "Roster full — " + MAX() + " / " + MAX() + " players. Remove someone to add another.";
    note.classList.remove("hidden");
    note.classList.add("is-full");
    ESA.replayAnim(byId("psCountBox"), "is-shake");
    if (target) ESA.replayAnim(target, "is-shake");
  }

  /** Adds / removes a participant. Returns false if the roster is full. */
  function psToggle(pid, target) {
    var i = ps.selected.indexOf(pid);
    if (i >= 0) {
      ps.selected.splice(i, 1);
      ESA.Audio.play("toggleOff");
    } else {
      if (psFull()) { psFullFeedback(target); return false; }
      ps.selected.push(pid);
      ESA.Audio.play("toggleOn");
    }
    psRender();
    return true;
  }

  function psToggleVariant(charId, v, target) {
    var p = ESA.Participants.forVariant(charId, v);
    return p ? psToggle(p.participantId, target) : false;
  }

  function psBuild() {
    var host = byId("psRoster");
    host.innerHTML = "";
    ps.tiles = ps.entries.map(function (e, i) {
      var b = ESA.rosterTile(e, i, "ps", { onGuestDeleted: psGuestDeleted });
      if (e.kind === "char") {
        b.insertAdjacentHTML("beforeend",
          '<span class="ps-vars" aria-hidden="true"><i class="pv-n">N</i><i class="pv-e">E</i></span>');
      }
      if (e.kind !== "add") b.insertAdjacentHTML("beforeend", '<span class="ps-check" aria-hidden="true"></span>');
      b.addEventListener("click", function () { ps.focus = i; psActivate(i); });
      host.appendChild(b);
      return b;
    });
    ps.cols = ESA.sizeRoster(host, host.parentNode, ps.entries.length, null, { max: 180 });
  }

  /** A Guest was deleted: rebuild (psRender drops them from the picks). */
  function psGuestDeleted() {
    if (App.state !== "participants") return;
    ps.entries = ESA.rosterEntries();
    ps.focus = Math.min(ps.focus, ps.entries.length - 1);
    psBuild();
    psRender();
  }

  function psActivate(i) {
    var e = ps.entries[i];
    if (!e) return;
    if (e.kind === "char") openVariantSheet(e.c);
    else if (e.kind === "guest") psToggle(e.p.participantId, ps.tiles[i]);
    else psAddGuest();
  }

  function psAddGuest() {
    if (psFull()) { psFullFeedback(ps.tiles[ps.tiles.length - 1]); return; }
    ESA.Guests.openCreator({
      onDone: function (p) {
        if (App.state !== "participants") return;
        ps.entries = ESA.rosterEntries();
        if (!psFull() && !psHas(p.participantId)) ps.selected.push(p.participantId);
        psBuild();
        psRender();
      }
    });
  }

  function psRender() {
    // Drop anything that no longer exists (e.g. guests cleared).
    ps.selected = ps.selected.filter(function (pid) {
      var p = ESA.Participants.get(pid);
      return p && !p.removed;
    });
    ps.tiles.forEach(function (t, i) {
      var e = ps.entries[i];
      var on = false;
      if (e.kind === "char") {
        var n = !!psVariantPid(e.c.id, "normal"), v = !!psVariantPid(e.c.id, "evil");
        t.classList.toggle("has-normal", n);
        t.classList.toggle("has-evil", v);
        on = n || v;
      } else if (e.kind === "guest") {
        on = psHas(e.p.participantId);
      }
      t.classList.toggle("is-on", on);
      t.classList.toggle("is-focus", i === ps.focus);
      if (e.kind !== "add") t.setAttribute("aria-pressed", on ? "true" : "false");
    });

    var n = ps.selected.length;
    byId("psCount").textContent = n;
    byId("psMax").textContent = MAX();
    byId("psCountBox").classList.toggle("is-full", n >= MAX());
    var f = ESA.Tournament.formatFor(n);
    byId("psFormat").innerHTML = f
      ? "<b>Format</b>" + esc(formatLine(f))
      : "<b>Format</b>Select at least 2 players";
    byId("psStartBtn").disabled = !f || !ESA.Games.tournamentPool().length;
    var normals = ps.entries.filter(function (e) { return e.kind === "char"; });
    var allNormal = normals.length && normals.every(function (e) { return psVariantPid(e.c.id, "normal"); });
    byId("psAllBtn").textContent = allNormal ? "Clear All" : "Select All";
    byId("psClearGuestsBtn").classList.toggle("hidden", !ESA.Participants.guests().length);

    psRenderPicked();

    var note = byId("psNote");
    var total = ESA.Characters.count();
    var msg = "";
    if (n >= MAX()) {
      msg = "Roster full — " + MAX() + " / " + MAX() + " players.";
    } else if (!ESA.Games.tournamentPool().length) {
      msg = "No games are marked tournamentEligible in the game registry.";
    } else if (total < 2 && n < 2) {
      msg = "Add Guests (or more ESA members to js/characters.js) to run a tournament.";
    }
    note.textContent = msg;
    note.classList.toggle("hidden", !msg);
    note.classList.toggle("is-full", n >= MAX());
  }

  /** Compact selected list: one chip per participant, tap the x to remove. */
  function psRenderPicked() {
    var host = byId("psPicked");
    host.textContent = "";
    host.classList.toggle("is-empty", !ps.selected.length);
    if (!ps.selected.length) {
      host.appendChild(document.createTextNode("Nobody selected yet"));
      return;
    }
    ps.selected.forEach(function (pid) {
      var p = ESA.Participants.get(pid);
      var c = ESA.Participants.avatar(p);
      if (!c) return;
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "ps-chip" + (c.evil ? " is-evil" : "") + (p.type === "guest" ? " is-guest" : "");
      chip.style.setProperty("--cc", c.color);
      chip.setAttribute("aria-label", "Remove " + p.displayName);
      chip.innerHTML = '<span class="t-face xs">' + portraitImg(c) + "</span>";
      var nm = document.createElement("span");
      nm.className = "pc-name";
      ESA.setNameEl(nm, c);
      chip.appendChild(nm);
      chip.insertAdjacentHTML("beforeend", '<span class="pc-x" aria-hidden="true">&times;</span>');
      chip.addEventListener("click", function () { psToggle(pid); });
      host.appendChild(chip);
    });
  }

  function psToggleAll() {
    var normals = ps.entries.filter(function (e) { return e.kind === "char"; });
    var allNormal = normals.every(function (e) { return psVariantPid(e.c.id, "normal"); });
    if (allNormal) {
      ps.selected = [];
      ESA.Audio.play("toggleOff");
    } else {
      normals.forEach(function (e) {
        var p = ESA.Participants.forVariant(e.c.id, "normal");
        if (!psHas(p.participantId) && !psFull()) ps.selected.push(p.participantId);
      });
      ESA.Audio.play("toggleOn");
    }
    psRender();
  }

  function psClearGuests() {
    Modal.confirm({
      title: "Clear All Guests?",
      body: "Every Guest made this session is removed. Roster picks and control settings stay.",
      safe: "Keep Guests",
      danger: "Clear Guests",
      onConfirm: function () {
        ESA.Participants.clearGuests();
        ps.entries = ESA.rosterEntries();
        ps.focus = Math.min(ps.focus, ps.entries.length - 1);
        psBuild();
        psRender();
      }
    });
  }

  function psStart() {
    var ids = ps.selected.slice();
    if (!ESA.Tournament.formatFor(ids.length) || !ESA.Games.tournamentPool().length || ids.length > MAX()) {
      ESA.Audio.play("denied");
      ESA.replayAnim(byId("psFormat"), "is-shake");
      return;
    }
    ESA.Audio.play("lockIn");
    App.session.pendingParticipants = ids;
    App.go("tourIntro");
  }

  /* --- Normal / Evil sheet ------------------------------------------- */
  function openVariantSheet(base) {
    var focus = 0;
    var m = {
      type: "custom",
      cls: "variant-sheet",
      build: function (card) {
        var head = document.createElement("div");
        head.className = "vsh-head";
        head.innerHTML = '<div class="modal-kicker">Choose Variant</div>';
        var title = document.createElement("h2");
        title.className = "modal-title";
        title.textContent = base.displayName;
        head.appendChild(title);
        card.appendChild(head);

        var row = document.createElement("div");
        row.className = "vsh-row";
        ESA.Participants.VARIANTS.forEach(function (v, i) {
          var av = ESA.Avatars.forVariant(base.id, v);
          var b = document.createElement("button");
          b.type = "button";
          b.className = "vsh-opt" + (v === "evil" ? " is-evil" : "");
          b.setAttribute("data-v", v);
          b.style.setProperty("--cc", av.color);
          b.innerHTML = '<span class="vsh-art art-box">' + ESA.bodyArtHTML(av, "normal", "vsh-figure") + "</span>" +
                        '<span class="vsh-name">' + "" + "</span>" +
                        '<span class="vsh-status"></span>';
          ESA.setNameEl(b.querySelector(".vsh-name"), av);
          b.addEventListener("click", function () {
            focus = i;
            psToggleVariant(base.id, v, b);
            m.refresh(card);
          });
          b.addEventListener("mouseenter", function () { focus = i; m.refresh(card); });
          row.appendChild(b);
        });
        card.appendChild(row);

        var foot = document.createElement("div");
        foot.className = "vsh-foot";
        foot.innerHTML = '<span class="vsh-count"></span>';
        var done = document.createElement("button");
        done.type = "button";
        done.className = "btn btn-gold vsh-done";
        done.textContent = "Done";
        done.addEventListener("click", function () { ESA.Audio.play("uiBack"); Modal.pop(); });
        foot.appendChild(done);
        card.appendChild(foot);
        card.insertAdjacentHTML("beforeend",
          '<div class="modal-hint"><b>&larr; &rarr;</b> choose &middot; <b>Space</b> add / remove &middot; <b>Esc</b> done</div>');
        m.refresh(card);
      },
      refresh: function (card) {
        var opts = card.querySelectorAll(".vsh-opt");
        Array.prototype.forEach.call(opts, function (b, i) {
          var v = b.getAttribute("data-v");
          var on = !!psVariantPid(base.id, v);
          b.classList.toggle("is-on", on);
          b.classList.toggle("is-focus", i === focus);
          b.setAttribute("aria-pressed", on ? "true" : "false");
          b.querySelector(".vsh-status").textContent = on ? "✓ Selected"
            : (psFull() ? "Roster full" : (ESA.Touch && ESA.Touch.active ? "Tap to add" : "Available"));
        });
        card.querySelector(".vsh-count").textContent = ps.selected.length + " / " + MAX() + " selected";
      },
      onKey: function (code, e) {
        var card = Modal.layer.querySelector(".modal-card");
        if (!card) return true;
        var dir = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1 }[code];
        if (dir) {
          e.preventDefault();
          focus = (focus + dir + 2) % 2;
          ESA.Audio.play("uiMove");
          m.refresh(card);
          return true;
        }
        if (code === "Space" || code === "Enter" || code === "NumpadEnter") {
          var ae = document.activeElement;
          if (ae && ae.tagName === "BUTTON" && card.contains(ae)) return false;   // Tab users: focused button
          e.preventDefault();
          var b = card.querySelectorAll(".vsh-opt")[focus];
          if (b) b.click();
          return true;
        }
        if (code === "Backspace") { e.preventDefault(); ESA.Audio.play("uiBack"); Modal.pop(); return true; }
        return false;
      },
      onEscape: function () { Modal.pop(); }
    };
    ESA.Audio.play("uiClick");
    Modal.push(m);
  }

  App.register("participants", {
    el: "participantScreen",
    parent: "mode",
    crumb: "Tournament · Participants",
    enter: function () {
      ps.entries = ESA.rosterEntries();
      var prev = App.session.pendingParticipants;
      if (prev) {
        ps.selected = prev.filter(function (pid) { var p = ESA.Participants.get(pid); return p && !p.removed; });
      } else {
        // First visit: everyone on the permanent roster, Normal variants
        // (the previous "all selected" default).
        ps.selected = [];
        ESA.Characters.list().forEach(function (c) {
          if (ps.selected.length < MAX()) ps.selected.push(ESA.Participants.forVariant(c.id, "normal").participantId);
        });
      }
      ps.focus = 0;
      psBuild();
      psRender();
    },
    onResize: function () {
      ps.cols = ESA.sizeRoster(byId("psRoster"), byId("psRoster").parentNode, ps.entries.length, null, { max: 180 });
    },
    onKey: function (code) {
      var dir = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down",
                  ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right" }[code];
      var e = ps.entries[ps.focus];
      if (dir) {
        var next = ESA.gridMove(ps.focus, dir, ps.entries.length, ps.cols);
        if (next !== ps.focus) { ps.focus = next; ESA.Audio.play("uiMove"); psRender(); }
      } else if (code === "Space") {
        psActivate(ps.focus);
      } else if ((code === "KeyN" || code === "KeyE") && e && e.kind === "char") {
        psToggleVariant(e.c.id, code === "KeyE" ? "evil" : "normal", ps.tiles[ps.focus]);
      } else if (code === "KeyG") {
        psAddGuest();
      } else if (ESA.isEnter(code)) {
        psStart();
      }
    }
  });

  /* ================================================================== *
   * TOURNAMENT INTRO - the format reveal
   * ================================================================== */
  function tiBegin() {
    var ids = App.session.pendingParticipants || [];
    var pool = ESA.Games.tournamentPool();
    if (!ESA.Tournament.formatFor(ids.length) || !pool.length) { ESA.Audio.play("denied"); return; }
    App.session.tournament = new ESA.Tournament(ids, {
      gamePool: function () { return ESA.Games.tournamentPool().map(function (g) { return g.id; }); }
    });
    ESA.Audio.play("start");
    App.go("draw");
  }

  App.register("tourIntro", {
    el: "tourIntroScreen",
    parent: "participants",
    crumb: "Tournament",
    enter: function () {
      var ids = App.session.pendingParticipants || [];
      var f = ESA.Tournament.formatFor(ids.length);
      byId("tiFaces").innerHTML = ids.map(function (id, i) {
        return '<span class="ti-face" style="--i:' + i + '">' + face(id) +
               "<small>" + nameHTML(id) + "</small></span>";
      }).join("");
      byId("tiFormat").innerHTML = f ? formatSteps(f).map(function (s, i) {
        return (i ? '<span class="ti-arrow" style="--i:' + i + '"></span>' : "") +
               '<span class="ti-step" style="--i:' + i + '"><b>' + esc(s.k) + "</b><small>" + esc(s.v) + "</small></span>";
      }).join("") : "";
      ESA.replayAnim(byId("tourIntroScreen"), "is-playing");
    },
    onKey: function (code) { if (ESA.isConfirm(code)) tiBegin(); }
  });

  /* ================================================================== *
   * FLOW - what happens next
   * ================================================================== */
  var Flow = {
    describeNext: function (t) {
      if (t.phase === "complete") return "Crown the Champion";
      var r = t.currentRound();
      if (!r.gameId) {
        if (t.isFinal(r) && !r.presented) return "Enter The Final";
        return "Draw " + roundLabel(t, r) + " Game";
      }
      var m = t.nextMatch();
      if (m) return "Play: " + name(m.a) + " vs " + name(m.b);
      return "Continue";
    },

    next: function () {
      var t = T();
      if (!t) return;
      if (t.phase === "complete") { App.go("champion"); return; }
      var r = t.currentRound();
      if (!r.gameId) {
        App.go(t.isFinal(r) && !r.presented ? "final" : "draw");
        return;
      }
      var m = t.nextMatch();
      if (m) {
        App.go("intro", {
          def: gameOf(r.gameId),
          setup: { p1: m.a, p2: m.b },
          context: { mode: "tournament", matchId: m.id, tag: matchTag(t, r, m) }
        });
        return;
      }
      this.afterRound();
    },

    /** Called once every match in the current round has a result. */
    afterRound: function () {
      var t = T();
      var r = t.currentRound();
      if (!r.complete) { App.go("hub"); return; }
      var wasLeague = r.kind === "league";
      var info = t.advance();
      if (!info) { App.go("hub"); return; }
      if (wasLeague) {
        App.go("standings", {
          fromOrder: r.startOrder,
          after: roundLabel(t, r),
          final: info.type === "knockoutStart"
        });
      } else {
        App.go("bracket", { finishedRound: r.index });
      }
    }
  };

  /* ================================================================== *
   * HUB
   * ================================================================== */
  function hubRender() {
    var t = T();
    var r = t.currentRound();
    var league = r.kind === "league";

    byId("hubPhase").textContent = t.phase === "complete" ? "Tournament Complete"
      : league ? "League Stage" : "Knockout Stage";
    byId("hubTitle").textContent = league
      ? "Round " + r.number + " of " + t.format.leagueRounds
      : r.name;

    // Progress strip: every round of the event, current one lit.
    var steps = [];
    for (var i = 1; i <= t.format.leagueRounds; i++) steps.push({ label: "R" + i, kind: "league", n: i });
    t.format.knockoutRounds.forEach(function (n) {
      steps.push({ label: n === "The Final" ? "Final" : n === "Semifinals" ? "SF" : "QF", kind: "ko", name: n });
    });
    var currentIdx = league ? r.number - 1 : t.format.leagueRounds + (r.number - 1);
    byId("hubProgress").innerHTML = steps.map(function (s, k) {
      var cls = k < currentIdx || t.phase === "complete" ? "is-done" : k === currentIdx ? "is-now" : "";
      return '<span class="hp-step ' + cls + '">' + s.label + "</span>";
    }).join('<i class="hp-link"></i>');

    // Round panel
    var g = r.gameId ? gameOf(r.gameId) : null;
    var next = t.nextMatch();
    var html = '<div class="hr-game ' + (g ? "" : "is-pending") + '"' + (g ? ' style="--accent:' + esc(g.accent) + '"' : "") + ">" +
      '<span class="hr-game-art">' + (g ? ESA.Games.iconHTML(g) : "?") + "</span>" +
      '<span class="hr-game-text"><small>' + esc(roundLabel(t, r)) + " Game</small><b>" +
      (g ? esc(g.title) : "Not drawn yet") + "</b></span></div>";
    html += '<div class="hr-list">';
    r.matches.forEach(function (m) {
      var state = m.status === "done" ? "is-done" : (m === next && g ? "is-next" : "");
      var aCls = m.status === "done" ? (m.winner === m.a ? "is-winner" : m.draw ? "" : "is-loser") : "";
      var bCls = m.status === "done" ? (m.winner === m.b ? "is-winner" : m.draw ? "" : "is-loser") : "";
      html += '<div class="hr-match ' + state + '">' +
        '<span class="hr-p a ' + aCls + '">' + face(m.a, "sm") + "<span>" + nameHTML(m.a) + "</span></span>" +
        '<span class="hr-score">' + (m.status === "done" ? m.scoreA + "<i>–</i>" + m.scoreB
          : (m === next && g ? "NEXT" : "VS")) + "</span>" +
        '<span class="hr-p b ' + bCls + '"><span>' + nameHTML(m.b) + "</span>" + face(m.b, "sm") + "</span>" +
        (m.draw ? '<span class="hr-tag">Tie</span>' : "") +
        "</div>";
    });
    r.byes.forEach(function (id) {
      html += '<div class="hr-match is-bye"><span class="hr-p a">' + face(id, "sm") + "<span>" + nameHTML(id) +
              '</span></span><span class="hr-score">BYE</span><span class="hr-p b"><span>+3 pts</span></span></div>';
    });
    html += "</div>";
    byId("hubRound").innerHTML = html;

    // Side panel
    var side = byId("hubSide");
    if (league) {
      side.innerHTML = '<div class="hs-title">Standings</div>' + miniStandingsHTML(t);
      byId("hubViewBtn").textContent = "View Standings";
    } else {
      side.innerHTML = '<div class="hs-title">Knockouts</div>' + miniKnockoutHTML(t);
      byId("hubViewBtn").textContent = "View Bracket";
    }

    byId("hubNextBtn").innerHTML = esc(Flow.describeNext(t)) + ' <span class="kbd-hint">Enter</span>';
  }

  App.register("hub", {
    el: "hubScreen",
    crumb: "Tournament · Hub",
    back: function () { leaveTournamentConfirm(); },
    enter: function () {
      if (!requireTournament()) return;
      hubRender();
    },
    onKey: function (code) {
      if (ESA.isConfirm(code)) Flow.next();
      else if (code === "KeyV") hubView();
    }
  });

  function hubView() {
    var t = T();
    if (!t) return;
    ESA.Audio.play("uiClick");
    if (t.currentRound().kind === "league") {
      App.go("standings", { view: true, fromOrder: t.currentRound().startOrder, after: "" });
    } else {
      App.go("bracket", { view: true });
    }
  }

  /* ================================================================== *
   * GAME DRAW - the signature ceremony
   * ================================================================== */
  var draw = { gen: 0, spinning: false, landed: false, result: null, target: null };
  var CARD_W = 210, CARD_GAP = 18;

  function reelCardHTML(g) {
    return '<div class="reel-card" style="--accent:' + esc(g.accent) + '">' +
             '<span class="rc-art">' + ESA.Games.iconHTML(g) + "</span>" +
             '<span class="rc-title">' + esc(g.title) + "</span></div>";
  }

  function drawLand() {
    if (draw.landed) return;
    draw.landed = true;
    draw.spinning = false;
    var g = gameOf(draw.result.gameId);
    var reel = byId("drawReel");
    reel.style.transition = "none";
    reel.style.transform = "translate3d(" + draw.finalX + "px,0,0)";
    if (draw.target) draw.target.classList.add("is-picked");
    var screen = byId("drawScreen");
    screen.classList.add("is-landed");
    screen.style.setProperty("--accent", g.accent);
    byId("drawResultTitle").textContent = g.title;
    byId("drawContinueBtn").innerHTML = 'Reveal Fixtures <span class="kbd-hint">Enter</span>';
    ESA.Audio.play("slam");
    App.timers.after(140, function () { ESA.Audio.play("reveal"); });
  }

  function drawContinue() {
    if (draw.spinning) { draw.gen++; drawLand(); return; }
    App.go("fixtures");
  }

  App.register("draw", {
    el: "drawScreen",
    parent: "hub",
    crumb: "Tournament · Game Draw",
    enter: function () {
      if (!requireTournament()) return;
      var t = T();
      var r = t.currentRound();
      draw.gen++;
      draw.landed = false;
      draw.spinning = false;
      draw.result = t.drawGame();            // committed once, here
      var screen = byId("drawScreen");
      screen.classList.remove("is-landed");

      var label = t.isFinal(r) ? "The Final" : roundLabel(t, r);
      byId("drawKicker").textContent = r.kind === "league" ? "League Stage · " + label : label;
      byId("drawResultKicker").textContent = label + " Game";
      byId("drawResultSub").textContent = t.isFinal(r)
        ? "One game. One champion."
        : "Every " + label + " match plays this game.";
      byId("drawContinueBtn").innerHTML = 'Skip <span class="kbd-hint">Enter</span>';

      var ex = byId("drawExcluded");
      if (draw.result.excluded) {
        ex.innerHTML = "<b>" + esc(gameOf(draw.result.excluded).title) + "</b> sits this one out &mdash; it was played last round";
        ex.classList.remove("hidden");
      } else {
        ex.classList.add("hidden");
      }

      // Build the reel: shuffled cycles of the eligible pool, target last.
      var pool = draw.result.pool.map(gameOf).filter(Boolean);
      if (!pool.length) pool = [gameOf(draw.result.gameId)];
      var seq = [];
      var cycles = Math.max(4, Math.ceil(22 / pool.length));
      for (var c = 0; c < cycles; c++) {
        var cyc = pool.slice().sort(function () { return Math.random() - 0.5; });
        // Never show the same cabinet twice in a row across cycle seams.
        if (pool.length > 1 && seq.length && cyc[0] === seq[seq.length - 1]) cyc.push(cyc.shift());
        seq = seq.concat(cyc);
      }
      var picked = gameOf(draw.result.gameId);
      if (pool.length > 1 && seq[seq.length - 1] === picked) seq.pop();
      seq.push(picked);
      draw.targetIndex = seq.length - 1;
      // Something visible beyond the target, never a copy of it right beside it.
      var others = pool.filter(function (g) { return g !== picked; });
      seq = seq.concat((others.length ? others : pool).slice(0, 2));
      var reel = byId("drawReel");
      reel.innerHTML = seq.map(reelCardHTML).join("");
      draw.target = reel.children[draw.targetIndex];
      reel.style.transition = "none";
      reel.style.transform = "translate3d(0,0,0)";
    },
    afterEnter: function () {
      var reel = byId("drawReel");
      var win = reel.parentNode;
      var step = CARD_W + CARD_GAP;
      draw.finalX = Math.round(win.clientWidth / 2 - CARD_W / 2 - draw.targetIndex * step);

      if (draw.result.alreadyDrawn) { drawLand(); return; }

      var gen = draw.gen;
      var startX = Math.round(win.clientWidth / 2 - CARD_W / 2);
      reel.style.transform = "translate3d(" + startX + "px,0,0)";
      void reel.offsetWidth;
      draw.spinning = true;
      var DURATION = 3400;
      reel.style.transition = "transform " + DURATION + "ms cubic-bezier(.08,.6,.12,1)";
      reel.style.transform = "translate3d(" + draw.finalX + "px,0,0)";
      ESA.Audio.play("whoosh");

      // Ticks slow down with the reel.
      var elapsed = 0, gap = 45;
      (function tick() {
        if (gen !== draw.gen || !draw.spinning) return;
        ESA.Audio.play("reelTick");
        elapsed += gap;
        gap = Math.min(420, gap * 1.11);
        if (elapsed < DURATION - 120) App.timers.after(gap, tick);
      })();
      App.timers.after(DURATION + 60, function () { if (gen === draw.gen) drawLand(); });
    },
    onKey: function (code) { if (ESA.isConfirm(code)) drawContinue(); }
  });

  /* ================================================================== *
   * FIXTURE REVEAL
   * ================================================================== */
  var fx = { gen: 0, revealed: false };

  function fxReveal() {
    if (fx.revealed) return;
    fx.revealed = true;
    fx.gen++;
    byId("fixtureScreen").classList.add("is-revealed");
    ESA.Audio.play("reveal");
  }

  App.register("fixtures", {
    el: "fixtureScreen",
    parent: "hub",
    crumb: "Tournament · Fixtures",
    enter: function () {
      if (!requireTournament()) return;
      var t = T();
      var r = t.currentRound();
      var g = gameOf(r.gameId);
      fx.revealed = false;
      byId("fixtureScreen").classList.remove("is-revealed");
      byId("fxKicker").textContent = r.kind === "league" ? "League Stage" : "Knockout Stage";
      byId("fxTitle").textContent = r.kind === "league" ? "Round " + r.number + " Fixtures" : r.name;
      byId("fxGame").innerHTML = g ? '<span class="fg-art">' + ESA.Games.iconHTML(g) + "</span><span>Playing <b>" +
                                     esc(g.title) + "</b></span>" : "";

      var ko = r.kind === "ko";
      var list = "";
      r.matches.forEach(function (m, i) {
        var sa = ko ? t.seedOf(m.a) : null, sb = ko ? t.seedOf(m.b) : null;
        list += '<div class="fx-row" style="--i:' + i + '">' +
          '<span class="fx-p a">' + (sa ? '<small class="seed">' + sa + "</small>" : "") + face(m.a) +
            "<span>" + nameHTML(m.a) + "</span></span>" +
          '<span class="fx-vs">VS</span>' +
          '<span class="fx-p b"><span>' + nameHTML(m.b) + "</span>" + face(m.b) +
            (sb ? '<small class="seed">' + sb + "</small>" : "") + "</span></div>";
      });
      r.byes.forEach(function (id, i) {
        list += '<div class="fx-row is-bye" style="--i:' + (r.matches.length + i) + '">' +
          '<span class="fx-p a">' + face(id) + "<span>" + nameHTML(id) + "</span></span>" +
          '<span class="fx-vs">BYE</span><span class="fx-p b"><span>Sits out &middot; +3 pts</span></span></div>';
      });
      byId("fxList").innerHTML = list;

      // Shuffle cards: participant portraits flicker before the reveal.
      var people = [];
      r.matches.forEach(function (m) { people.push(m.a, m.b); });
      people = people.concat(r.byes);
      var count = Math.min(people.length, 8);
      var sh = "";
      for (var k = 0; k < count; k++) sh += '<span class="fx-card" style="--i:' + k + '">' + face(people[k]) + "</span>";
      byId("fxShuffle").innerHTML = sh;
      fx.people = people;
    },
    afterEnter: function () {
      var gen = ++fx.gen;
      var cards = byId("fxShuffle").querySelectorAll(".fx-card img");
      var everyone = T().participants;
      var ticks = 0;
      (function flick() {
        if (gen !== fx.gen) return;
        for (var i = 0; i < cards.length; i++) {
          var c = av(everyone[Math.floor(Math.random() * everyone.length)]);
          if (c) ESA.setArt(cards[i], c, "normal", "head");
        }
        if (ticks++ % 2 === 0) ESA.Audio.play("reelTick");
        if (ticks < 14) App.timers.after(65, flick);
        else fxReveal();
      })();
    },
    onKey: function (code) {
      if (!ESA.isConfirm(code)) return;
      if (!fx.revealed) fxReveal();
      else App.go("hub");
    }
  });

  /* ================================================================== *
   * STANDINGS
   * ================================================================== */
  var ROW_H = 46;

  App.register("standings", {
    el: "standingsScreen",
    parent: "hub",
    crumb: "Tournament · Standings",
    back: function () {
      // After the last league round the knockouts are already seeded:
      // Back still goes to the hub, which shows the knockout round.
      ESA.Audio.play("uiBack");
      App.go("hub");
    },
    enter: function (p) {
      if (!requireTournament()) return;
      var t = T();
      var rows = t.standings();
      var q = t.format.qualifiers;
      var from = p.fromOrder || rows.map(function (r) { return r.id; });
      var n = rows.length;

      // Rows shrink a little for big fields so the table fits 1366x768.
      var avail = Math.max(240, window.innerHeight - 330);
      ROW_H = Math.max(34, Math.min(50, Math.floor(avail / (n + 1))));

      byId("stKicker").textContent = p.final ? "League Stage Complete" : "League Stage";
      byId("stTitle").textContent = p.final ? "Final League Standings"
        : p.after ? "Standings after " + p.after : "Standings";

      var table = byId("stTable");
      table.style.setProperty("--row-h", ROW_H + "px");
      table.style.height = (ROW_H * (n + 1)) + "px";
      var html = '<div class="st-row st-headrow"><span class="c-pos">#</span><span class="c-name">Player</span>' +
                 '<span class="c-n">P</span><span class="c-n">W</span><span class="c-n">D</span><span class="c-n">L</span>' +
                 '<span class="c-n">Bye</span><span class="c-n">+/-</span><span class="c-pts">Pts</span><span class="c-tag"></span></div>';
      rows.forEach(function (r, i) {
        var was = from.indexOf(r.id);
        if (was < 0) was = i;
        var move = was - i;
        var arrow = move > 0 ? '<i class="mv up">&#9650;' + move + "</i>"
                  : move < 0 ? '<i class="mv down">&#9660;' + (-move) + "</i>" : '<i class="mv same">&ndash;</i>';
        var cls = (i < q ? "is-q" : "is-out") + (r.decidedByLot && p.final ? " by-lot" : "");
        var tag = p.final ? (i < q ? "Qualified" : "Eliminated") : "";
        html += '<div class="st-row ' + cls + '" data-from="' + was + '" data-to="' + i + '" style="--y:' + (was + 1) + '">' +
          '<span class="c-pos">' + (i + 1) + "</span>" +
          '<span class="c-name">' + face(r.id, "sm") + "<b>" + nameHTML(r.id) + "</b>" + arrow + "</span>" +
          '<span class="c-n">' + r.played + '</span><span class="c-n">' + r.wins + '</span><span class="c-n">' + r.draws +
          '</span><span class="c-n">' + r.losses + '</span><span class="c-n">' + r.byes + '</span><span class="c-n">' +
          (r.diff > 0 ? "+" : "") + r.diff + '</span><span class="c-pts">' + r.points + "</span>" +
          '<span class="c-tag">' + tag + "</span></div>";
      });
      html += '<div class="st-qline" style="--y:' + (q + 1) + '"><span>Qualification line &middot; top ' + q + "</span></div>";
      table.innerHTML = html;
      table.classList.toggle("is-final", !!p.final);
      table.classList.remove("is-settled");

      var lot = rows.some(function (r, i) { return r.decidedByLot && p.final && (i === q - 1 || i === q); });
      var banner = byId("stBanner");
      banner.classList.toggle("hidden", !lot);
      banner.innerHTML = lot ? "Dead level on points, wins and score difference &mdash; <b>drawing lots</b> to settle it" : "";
      byId("standingsScreen").classList.remove("is-settled");
    },
    afterEnter: function () {
      var table = byId("stTable");
      App.timers.after(260, function () {
        var rows = table.querySelectorAll(".st-row[data-to]");
        for (var i = 0; i < rows.length; i++) rows[i].style.setProperty("--y", Number(rows[i].getAttribute("data-to")) + 1);
        ESA.Audio.play("whoosh");
      });
      App.timers.after(1100, function () {
        table.classList.add("is-settled");
        byId("standingsScreen").classList.add("is-settled");
        if (App.params.final) ESA.Audio.play("reveal");
      });
    },
    onKey: function (code) { if (ESA.isConfirm(code)) stContinue(); }
  });

  function stContinue() {
    if (App.params.final) App.go("bracket", { intro: true });
    else App.go("hub");
  }

  /* ================================================================== *
   * KNOCKOUT BRACKET
   * ================================================================== */
  function bracketHTML(t, p) {
    var f = t.format;
    var ko = t.knockoutRounds();
    var cols = f.knockoutRounds.length;
    var html = "";
    var size = f.qualifiers;

    for (var c = 0; c < cols; c++) {
      var r = ko[c];
      var count = size / Math.pow(2, c + 1);
      var justFilled = p.finishedRound !== undefined && r && r.index === p.finishedRound + 1;
      html += '<div class="br-col" style="--c:' + c + '"><div class="br-col-name">' + esc(f.knockoutRounds[c]) +
              (r && r.gameId ? "<small>" + esc(gameOf(r.gameId).title) + "</small>" : "<small>&nbsp;</small>") + "</div>";
      html += '<div class="br-col-body">';
      for (var k = 0; k < count; k += (count > 1 ? 2 : 1)) {
        html += '<div class="br-pair' + (count === 1 ? " is-single" : "") + '">';
        for (var j = k; j < Math.min(k + 2, count); j++) {
          var m = r ? r.matches[j] : null;
          html += matchBox(t, m, justFilled);
        }
        if (c < cols - 1) html += '<span class="br-join"></span>';
        html += "</div>";
      }
      html += "</div></div>";
    }

    // Champion slot
    var champ = t.champion;
    html += '<div class="br-col br-champ-col" style="--c:' + cols + '"><div class="br-col-name">Champion<small>&nbsp;</small></div>' +
            '<div class="br-col-body"><div class="br-champ ' + (champ ? "is-crowned" : "") + '">' +
            '<svg viewBox="0 0 100 100" aria-hidden="true"><use href="#icoTrophy" /></svg>' +
            (champ ? face(champ) + "<b>" + nameHTML(champ) + "</b>" : "<b>?</b>") + "</div></div></div>";
    return html;
  }

  function matchBox(t, m, justFilled) {
    if (!m) {
      return '<div class="br-match is-tbd"><div class="br-entrant is-tbd"><span class="br-name">TBD</span></div>' +
             '<div class="br-entrant is-tbd"><span class="br-name">TBD</span></div></div>';
    }
    var html = '<div class="br-match' + (m.status === "done" ? " is-done" : "") + (justFilled ? " just-filled" : "") + '">';
    [[m.a, m.scoreA], [m.b, m.scoreB]].forEach(function (e) {
      var id = e[0];
      var cls = m.status === "done" ? (m.winner === id ? "is-winner" : "is-loser") : "";
      var seed = t.seedOf(id);
      html += '<div class="br-entrant ' + cls + '">' +
              '<span class="br-seed">' + (seed || "") + "</span>" + face(id, "sm") +
              '<span class="br-name">' + nameHTML(id) + "</span>" +
              '<span class="br-score">' + (m.status === "done" ? e[1] : "") + "</span></div>";
    });
    return html + "</div>";
  }

  App.register("bracket", {
    el: "bracketScreen",
    parent: "hub",
    crumb: "Tournament · Bracket",
    enter: function (p) {
      if (!requireTournament()) return;
      var t = T();
      byId("brKicker").textContent = p.intro ? "Qualified for the Knockouts" : "Knockout Stage";
      byId("brTitle").textContent = t.phase === "complete" ? "Final Bracket" : t.currentRound().name;
      var el = byId("bracket");
      el.innerHTML = bracketHTML(t, p);
      el.style.setProperty("--cols", t.format.knockoutRounds.length + 1);
      ESA.replayAnim(byId("bracketScreen"), "is-playing");
    },
    afterEnter: function () { ESA.Audio.play("whoosh"); },
    onKey: function (code) { if (ESA.isConfirm(code)) brContinue(); }
  });

  function brContinue() {
    var t = T();
    if (!t) return;
    App.go(t.phase === "complete" ? "champion" : "hub");
  }

  /* ================================================================== *
   * THE FINAL
   * ================================================================== */
  function finalSide(id) {
    var c = av(id);
    return '<div class="fn-art-wrap art-box">' + ESA.bodyArtHTML(c, "selected", "fn-art") + "</div>" +
           '<div class="fn-name">' + nameHTML(id) + "</div>";
  }

  App.register("final", {
    el: "finalScreen",
    parent: "hub",
    crumb: "Tournament · The Final",
    enter: function () {
      if (!requireTournament()) return;
      var t = T();
      var r = t.currentRound();
      var m = r.matches[0];
      r.presented = true;
      byId("fnA").innerHTML = finalSide(m.a);
      byId("fnB").innerHTML = finalSide(m.b);
      byId("fnA").style.setProperty("--cc", av(m.a).color);
      byId("fnB").style.setProperty("--cc", av(m.b).color);
      ESA.replayAnim(byId("finalScreen"), "is-playing");
    },
    afterEnter: function () { ESA.Audio.play("versus"); },
    onKey: function (code) { if (ESA.isConfirm(code)) App.go("draw"); }
  });

  /* ================================================================== *
   * CHAMPION
   * ================================================================== */
  var CONFETTI = ["#f3c35a", "#fff6e4", "#e5a92f", "#fdeec4", "#4aa3ff", "#ff6a5c"];

  App.register("champion", {
    el: "championScreen",
    crumb: "Tournament · Champion",
    back: function () { ESA.Audio.play("uiBack"); chHome(); },
    enter: function () {
      if (!requireTournament()) return;
      var t = T();
      var c = av(t.champion);
      if (!c) return;
      var art = byId("chArt");
      ESA.setArt(art, c, "victory", "body");
      art.className = "art-frame ch-art" + (c.victoryAnimation ? " " + c.victoryAnimation : "");
      ESA.setNameEl(byId("chName"), c);
      byId("championScreen").style.setProperty("--cc", c.color);

      var row = t.table[t.champion];
      var fin = t.knockoutRounds().slice(-1)[0].matches[0];
      var beaten = fin.winner === fin.a ? fin.b : fin.a;
      byId("chRecord").innerHTML = "League: <b>" + row.wins + "W " + row.draws + "D " + row.losses + "L</b> &middot; " +
        row.points + " pts &middot; Beat <b>" + nameHTML(beaten) + "</b> in the final (" +
        esc(gameOf(t.currentRound().gameId).title) + ")";

      var conf = "";
      for (var i = 0; i < 38; i++) {
        conf += '<i style="--x:' + (Math.random() * 100).toFixed(1) + "%;--d:" + (Math.random() * 2.4).toFixed(2) +
                "s;--t:" + (3.2 + Math.random() * 2.6).toFixed(2) + "s;--r:" + Math.round(Math.random() * 720 - 360) +
                "deg;--c:" + CONFETTI[i % CONFETTI.length] + '"></i>';
      }
      byId("chConfetti").innerHTML = conf;
      ESA.replayAnim(byId("championScreen"), "is-playing");
    },
    afterEnter: function () { ESA.Audio.play("fanfare"); },
    leave: function () {
      byId("chConfetti").innerHTML = "";
      App.session.tournament = null;
    },
    onKey: function (code) { if (ESA.isConfirm(code)) chAgain(); }
  });

  function chHome() { App.go("mode"); }
  function chAgain() { App.go("participants"); }

  /* ================================================================== *
   * Play-screen integration
   * ================================================================== */
  ESA.TournamentUI = {
    /** Records the finished match once and returns the result card actions. */
    onMatchEnd: function (run, result) {
      var t = T();
      var ctx = run.context;
      var m = t && t.findMatch(ctx.matchId);
      var toHub = { label: "Tournament Hub", kind: "ghost", onClick: function () { App.go("hub"); } };
      if (!t || !m) return { result: result, actions: [toHub] };

      var scores = result.scores || { p1: 0, p2: 0 };
      var winnerId = result.winner ? run.setup[result.winner] : null;
      var res = t.recordResult(m.id, { winner: winnerId, scoreA: scores.p1, scoreB: scores.p2 });
      var r = t.roundOf(m);

      if (res.replay) {
        result.kicker = t.isFinal(r) ? "The Final" : r.name;
        result.title = "Dead Heat";
        result.text = "Knockout matches need a winner. Run it back!";
        return {
          result: result,
          actions: [
            { label: "Replay Match", kind: "gold", onClick: function () {
              App.startMatch(run.def, run.setup, run.context);
            } },
            toHub
          ]
        };
      }

      if (!res.ok) return { result: result, actions: [toHub] };

      if (r.kind === "league") {
        result.text = winnerId
          ? name(winnerId) + " takes 3 points. " + (result.text || "")
          : "A point each. " + (result.text || "");
      } else if (t.isFinal(r)) {
        result.kicker = "The Final";
        result.title = name(winnerId) + " Wins It All";
      } else {
        result.text = name(winnerId) + " advances. " + (result.text || "");
      }

      var label = r.complete
        ? (r.kind === "league" ? "See Standings" : t.isFinal(r) ? "Crown the Champion" : "See Bracket")
        : "Continue";
      return {
        result: result,
        actions: [{ label: label, kind: "gold", onClick: function () { Flow.afterRound(); } }]
      };
    },

    pauseMenu: function (run) {
      var t = T();
      var ko = t && t.currentRound().kind === "ko";
      return {
        type: "menu",
        kicker: run.context.tag || "Tournament",
        title: "Paused",
        onEscape: App.resume,
        items: App.withTouchSetup([
          { label: "Resume", kind: "safe", action: App.resume },
          { label: "Tournament Hub", action: function () {
            Modal.confirm({
              title: "Leave Match?",
              body: "This match will be reset. It stays in the schedule and can be replayed from the hub.",
              safe: "Continue Playing",
              danger: "Go to Hub",
              onConfirm: function () { App.go("hub"); }
            });
          } },
          { label: ko ? "View Bracket" : "View Standings", action: function () {
            Modal.push({
              type: "menu",
              kicker: "Tournament",
              title: ko ? "Knockouts" : "Standings",
              html: ko ? miniKnockoutHTML(t) : miniStandingsHTML(t),
              escLabel: "back",
              items: [{ label: "Back", kind: "safe", action: function () { Modal.pop(); } }],
              onEscape: function () { Modal.pop(); }
            });
          } },
          { label: "Exit Tournament", kind: "danger", action: leaveTournamentConfirm }
        ])
      };
    }
  };

  /* ================================================================== *
   * Wiring (once, at boot)
   * ================================================================== */
  ESA.TournamentScreens = {
    init: function () {
      byId("psStartBtn").addEventListener("click", psStart);
      byId("psAllBtn").addEventListener("click", psToggleAll);
      byId("psClearGuestsBtn").addEventListener("click", psClearGuests);
      byId("tiBeginBtn").addEventListener("click", tiBegin);
      byId("hubNextBtn").addEventListener("click", function () { Flow.next(); });
      byId("hubViewBtn").addEventListener("click", hubView);
      byId("drawContinueBtn").addEventListener("click", drawContinue);
      byId("fxContinueBtn").addEventListener("click", function () {
        if (!fx.revealed) fxReveal(); else App.go("hub");
      });
      byId("stContinueBtn").addEventListener("click", stContinue);
      byId("brContinueBtn").addEventListener("click", brContinue);
      byId("fnDrawBtn").addEventListener("click", function () { App.go("draw"); });
      byId("chHomeBtn").addEventListener("click", chHome);
      byId("chAgainBtn").addEventListener("click", chAgain);
    }
  };

})(window.ESA);
