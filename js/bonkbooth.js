/* ==========================================================================
   ESA ARCADE - Bonk Booth
   A carnival booth with three holes per player. Your rival pops out; hit the
   matching key. Bombs are a trap - leave them alone.

   Every target runs a readable four-stage cycle so non-gamers get real
   reaction time:   tell -> rise -> active -> retreat
   ========================================================================== */

(function (ESA) {
  "use strict";

  var W = ESA.W, H = ESA.H;

  var MATCH_SECONDS = 42;
  var BOMB_PENALTY = 2;     // hitting a bomb; a wrong hole / key is -1
  var URGENT_AT = 10;

  var HOLE_Y = 392;
  var HOLE_RX = 62;
  var HOLE_RY = 19;
  var HOLE_X = {
    p1: [104, 250, 396],
    p2: [W - 396, W - 250, W - 104]
  };
  var SLOTS = ["p1", "p2"];
  var SPRITE_H = 152;

  /*
   * Hole placement. Every hole is drawn in the ORIGINAL desktop coordinates
   * (HOLE_X / HOLE_Y) and then mapped to {x, y, s} here, so the desktop
   * booth is pixel-identical (identity mapping) while touch devices get a
   * head-to-head layout: each player's three holes form an arc on their own
   * half, facing the rival across the centre divider, so two pairs of hands
   * never reach into the same area.
   */
  var DESKTOP_LAYOUT = {
    p1: HOLE_X.p1.map(function (x) { return { x: x, y: HOLE_Y, s: 1 }; }),
    p2: HOLE_X.p2.map(function (x) { return { x: x, y: HOLE_Y, s: 1 }; })
  };
  var TOUCH_S = 0.7;
  var TOUCH_ARC = [{ x: 148, y: 218 }, { x: 252, y: 341 }, { x: 148, y: 462 }];
  var TOUCH_LAYOUT = {
    p1: TOUCH_ARC.map(function (h) { return { x: h.x, y: h.y, s: TOUCH_S }; }),
    p2: TOUCH_ARC.map(function (h) { return { x: W - h.x, y: h.y, s: TOUCH_S }; })
  };
  var TAP_REACH = 125;          // max distance (logical px) from a hole's centre
  var CLIP_TOP = HOLE_Y - 168;

  /*
   * Difficulty curve. Every stage duration eases from its EARLY value to its
   * LATE value over the match (smoothstep on match progress), so the start is
   * comfortable, the middle tightens and the last ~10 s are the sharpest -
   * the late window is still ~0.9 s from the first glow, so always humanly
   * hittable. Values are seconds; [min, max] pairs are randomised per target.
   */
  var CURVE = {
    gap:        { early: [0.55, 0.75], late: [0.18, 0.28] },   // empty booth between pop-ups
    tell:       { early: 0.40, late: 0.24 },                   // hole glows (wind-up)
    rise:       { early: 0.20, late: 0.13 },
    active:     { early: [1.05, 1.30], late: [0.52, 0.62] },   // up and hittable
    bombActive: { early: [1.10, 1.35], late: [0.75, 0.90] },   // bombs linger: correct play is nothing
    retreat:    { early: 0.22, late: 0.16 },
    /* How long a bonked target stays up showing its hurt art. Without this
       the hurt pose flashes by in a couple of frames and the payoff is invisible. */
    stun:       { early: 0.46, late: 0.34 },
    bombChance: { early: 0.12, late: 0.20 }
  };
  /* A correct key while the target is sinking still counts while it is
     at least this far up (it is visibly there) - avoids frame-perfect misses. */
  var LATE_GRACE_RISE = 0.5;

  function BonkBooth(api, setup) {
    this.api = api;
    this.timers = new ESA.TimerGroup();
    this.fx = new ESA.ParticleField(200);

    var who = ESA.describeMatchup(setup);
    this.players = { p1: who.p1, p2: who.p2 };
    // The booth backdrop bakes in names and colours, so cache it per matchup.
    // Touch devices get the head-to-head layout (chosen once per match).
    this.touchLayout = !!(ESA.Touch && ESA.Touch.active);
    this.layout = this.touchLayout ? TOUCH_LAYOUT : DESKTOP_LAYOUT;
    this.layerKey = "arena-bonk:" + who.p1.name + "|" + who.p1.color + "|" +
                    who.p2.name + "|" + who.p2.color + (this.touchLayout ? "|touch" : "");

    this.score = { p1: 0, p2: 0 };
    this.timeLeft = MATCH_SECONDS;
    this.state = "idle";
    this.lastShownSecond = -1;

    this.targets = { p1: null, p2: null };
    this.swing = { p1: null, p2: null };   // mallet feedback
    this.holeGlow = { p1: [0, 0, 0], p2: [0, 0, 0] };
    this.holeMiss = { p1: [0, 0, 0], p2: [0, 0, 0] };   // red "wrong hole" flash
  }

  /** Whose face appears in a given player's holes: their opponent's slot. */
  function victimOf(side) {
    return side === "p1" ? "p2" : "p1";
  }

  /** "#2f7fd8" -> "47,127,216" for rgba() strings. */
  function rgbOf(hex) {
    var h = String(hex || "#c0871f").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) n = 0xc0871f;
    return ((n >> 16) & 255) + "," + ((n >> 8) & 255) + "," + (n & 255);
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */
  BonkBooth.prototype.start = function () {
    var self = this;

    this.score.p1 = 0;
    this.score.p2 = 0;
    this.timeLeft = MATCH_SECONDS;
    this.lastShownSecond = -1;
    this.fx.clear();
    this.swing.p1 = null;
    this.swing.p2 = null;
    this.holeGlow.p1 = [0, 0, 0];
    this.holeGlow.p2 = [0, 0, 0];
    this.holeMiss.p1 = [0, 0, 0];
    this.holeMiss.p2 = [0, 0, 0];

    this.targets.p1 = this.makeTarget("p1", 0.5);
    this.targets.p2 = this.makeTarget("p2", 0.8);

    // Only the current matchup's backdrop stays cached.
    ESA.Stage.evictLayers("arena-bonk:", this.layerKey);

    ESA.UI.setScore("p1", 0);
    ESA.UI.setScore("p2", 0);
    ESA.UI.setCenter("Time", MATCH_SECONDS, false);

    this.state = "countdown";
    ESA.UI.countdown(this.timers, function () {
      if (self.state === "countdown") self.state = "playing";
    });
  };

  BonkBooth.prototype.destroy = function () {
    this.state = "destroyed";
    this.timers.clear();
    this.fx.clear();
  };

  /* ------------------------------------------------------------------ *
   * Targets
   * ------------------------------------------------------------------ */

  /** 0 at the start of the match, 1 at the end. */
  BonkBooth.prototype.progress = function () {
    return ESA.clamp(1 - this.timeLeft / MATCH_SECONDS, 0, 1);
  };

  /** Difficulty 0..1: smoothstep of progress - gentle start, steady middle ramp. */
  BonkBooth.prototype.difficulty = function () {
    var p = this.progress();
    return p * p * (3 - 2 * p);
  };

  /** A curve value at difficulty k (random within [min, max] pairs). */
  function curve(name, k) {
    var c = CURVE[name];
    var a = Array.isArray(c.early) ? ESA.rand(c.early[0], c.early[1]) : c.early;
    var b = Array.isArray(c.late) ? ESA.rand(c.late[0], c.late[1]) : c.late;
    return ESA.lerp(a, b, k);
  }

  /**
   * One target EVENT per player: gap -> tell -> rise -> active -> retreat.
   * Each event accepts exactly one meaningful attempt from its owner
   * (`attempted`); once used, further presses in the same event are ignored.
   */
  BonkBooth.prototype.makeTarget = function (side, gapOverride) {
    var k = this.difficulty();
    var prev = this.targets[side];
    var hole = ESA.randInt(0, 2);
    // Avoid the same hole twice in a row so the booth stays lively.
    if (prev && prev.hole === hole) hole = (hole + 1 + ESA.randInt(0, 1)) % 3;

    var isBomb = ESA.chance(curve("bombChance", k));

    return {
      side: side,
      hole: hole,
      type: isBomb ? "bomb" : "normal",
      phase: "gap",
      t: 0,
      gapFor: gapOverride !== undefined ? gapOverride : curve("gap", k),
      tellFor: curve("tell", k),
      riseFor: curve("rise", k),
      activeFor: curve(isBomb ? "bombActive" : "active", k),
      retreatFor: curve("retreat", k),
      stunFor: curve("stun", k),
      rise: 0,
      resolved: false,      // scored or bomb hit: hold up, then drop
      attempted: false,     // this player's one attempt for this event is used
      gapMissed: false,     // one "nothing there" penalty per empty gap, max
      hitType: null,
      reactT: 0
    };
  };

  BonkBooth.prototype.advance = function (side, dt) {
    var t = this.targets[side];
    if (!t) { this.targets[side] = this.makeTarget(side); return; }

    t.t += dt;
    if (t.reactT > 0) t.reactT = Math.max(0, t.reactT - dt);

    switch (t.phase) {
      case "gap":
        if (t.t >= t.gapFor) { t.phase = "tell"; t.t = 0; }
        break;

      case "tell":
        // Hole glows and a shadow swells: the readable wind-up.
        this.holeGlow[side][t.hole] = Math.max(this.holeGlow[side][t.hole], t.t / t.tellFor);
        if (t.t >= t.tellFor) { t.phase = "rise"; t.t = 0; }
        break;

      case "rise":
        t.rise = ESA.easeOut(ESA.clamp(t.t / t.riseFor, 0, 1));
        if (t.t >= t.riseFor) { t.phase = "active"; t.t = 0; t.rise = 1; }
        break;

      case "active":
        t.rise = 1;
        if (t.t >= t.activeFor) { t.phase = "retreat"; t.t = 0; }
        break;

      case "stunned":
        // Held up after a successful hit so the hurt art actually reads.
        t.rise = 1;
        if (t.t >= t.stunFor) { t.phase = "retreat"; t.t = 0; }
        break;

      case "retreat":
        var dur = t.resolved ? t.retreatFor * 0.6 : t.retreatFor;
        t.rise = 1 - ESA.easeIn(ESA.clamp(t.t / dur, 0, 1));
        if (t.t >= dur) this.targets[side] = this.makeTarget(side);
        break;
    }
  };

  /* ------------------------------------------------------------------ *
   * Input
   * ------------------------------------------------------------------ */
  BonkBooth.prototype.onKeyDown = function (code) {
    if (this.state !== "playing") return;

    for (var i = 0; i < SLOTS.length; i++) {
      var side = SLOTS[i];
      var idx = ESA.CONTROLS[side].booth.indexOf(code);
      if (idx >= 0) this.attempt(side, idx);
    }
  };

  /**
   * Touch: a tap only ever counts for the side of the divider it landed on,
   * and only for the nearest of that side's holes. One call per finger
   * (pointerdown), so a tap can never count twice.
   */
  BonkBooth.prototype.onTap = function (x, y) {
    if (this.state !== "playing") return;
    var side = x < W / 2 ? "p1" : "p2";
    var best = -1, bestD = TAP_REACH;
    for (var h = 0; h < 3; h++) {
      var L = this.layout[side][h];
      // Aim point sits above the hole, where the rival's head pops up.
      var d = Math.hypot(x - L.x, y - (L.y - 46 * L.s));
      if (d < bestD) { bestD = d; best = h; }
    }
    if (best >= 0) this.attempt(side, best);
  };

  /** A point relative to a hole (desktop offsets), in screen coordinates. */
  BonkBooth.prototype.holePt = function (side, h, dy) {
    var L = this.layout[side][h];
    return { x: L.x, y: L.y + dy * L.s };
  };

  /**
   * Resolve one press / tap for `side` on `holeIndex`.
   *
   *   correct hole while the rival is up            +1  (uses the attempt)
   *   bomb hole while the bomb is up                -2  (uses the attempt)
   *   wrong hole, or a late press as it sinks       -1  (uses the attempt)
   *   any press while the booth is empty (gap)      -1  (once per gap)
   *   correct hole during the glow, before it rises  0  "EARLY" - not an attempt
   *   anything after the attempt is used             ignored, no penalty
   *
   * Because the FIRST press of an event decides it, mashing all three keys
   * (or tapping all three holes) can't farm the right one: two of three
   * orders lose a point and lock the event before the correct key lands.
   * The lock is per player and per event, so it never blocks the next
   * target or the other player.
   */
  BonkBooth.prototype.attempt = function (side, holeIndex) {
    if (this.state !== "playing") return;
    var t = this.targets[side];
    if (!t || t.attempted || t.resolved) return;

    var self = this;
    var at = function (dy) { return self.holePt(side, holeIndex, dy); };
    var cx = at(0).x;

    if (t.phase === "gap") {
      if (t.gapMissed) return;
      t.gapMissed = true;
      this.swing[side] = { hole: holeIndex, t: 0.24 };
      this.penalise(side, holeIndex, "MISS");
      return;
    }

    if (t.phase === "tell" && holeIndex === t.hole) {
      // Reading the glow is fine - just not yet. No penalty, no lock.
      this.swing[side] = { hole: holeIndex, t: 0.24 };
      this.fx.spawn({
        type: "text", x: cx, y: at(-44).y, vx: 0, vy: -40,
        gravity: 0, drag: 0.98, life: 0.4, font: 17,
        text: "EARLY", color: "#9db2c7"
      });
      return;
    }

    // Mallet comes down - the swing always reads.
    this.swing[side] = { hole: holeIndex, t: 0.24 };
    t.attempted = true;

    var up = t.phase === "rise" || t.phase === "active" ||
             (t.phase === "retreat" && t.rise >= LATE_GRACE_RISE);

    if (!up || t.hole !== holeIndex) {
      var late = t.phase === "retreat" && t.hole === holeIndex;
      this.penalise(side, holeIndex, late ? "LATE"
        : (this.touchLayout ? "WRONG HOLE" : "WRONG KEY"));
      return;
    }

    t.resolved = true;
    t.reactT = 0.34;
    t.phase = "stunned";      // hold them up for a beat, then drop
    t.t = 0;

    if (t.type === "bomb") {
      // The worst mistake in the booth: -2, with a heavier hit than a wrong hole.
      t.hitType = "bomb";
      this.score[side] -= BOMB_PENALTY;
      ESA.UI.setScore(side, this.score[side]);
      ESA.Audio.play("penalty");
      ESA.Stage.shake(16);
      ESA.Stage.flash(0.42, "#ff8f86");
      this.holeMiss[side][holeIndex] = 1.8;   // red rim lingers longer than a -1

      this.fx.burst(cx, at(-58).y, 22, {
        colors: ["#e8584f", "#ff9a3c", "#ffd766", "#fff6e4"],
        speedMin: 90, speedMax: 320, lifeMin: 0.35, lifeMax: 0.75,
        sizeMin: 3, sizeMax: 6.5, gravity: 380
      });
      this.fx.spawn({ type: "ring", x: cx, y: at(-58).y, size: 12, size2: 120, life: 0.45, color: "#e8584f" });
      this.fx.spawn({
        type: "text", x: cx, y: at(-96).y, vx: 0, vy: -58,
        gravity: 0, drag: 0.99, life: 0.9, font: 40,
        text: "−" + BOMB_PENALTY, color: "#ff3b30"
      });
      this.fx.spawn({
        type: "text", x: cx, y: at(-52).y, vx: 0, vy: -34,
        gravity: 0, drag: 0.98, life: 0.7, font: 16,
        text: "BOMB!", color: "#ffd0cc"
      });

    } else {
      t.hitType = "bonk";
      this.score[side] += 1;
      ESA.UI.setScore(side, this.score[side]);
      ESA.Audio.play("bonk");
      ESA.Stage.shake(7);

      this.fx.burst(cx, at(-92).y, 10, {
        colors: ["#fdeec4", "#f3c35a"],
        speedMin: 60, speedMax: 170, lifeMin: 0.25, lifeMax: 0.5,
        sizeMin: 2, sizeMax: 4, gravity: 300
      });
      for (var s = 0; s < 3; s++) {
        this.fx.spawn({
          type: "star", x: cx + ESA.rand(-26, 26), y: at(-112).y + ESA.rand(-14, 14),
          vx: ESA.rand(-90, 90), vy: ESA.rand(-170, -90),
          life: ESA.rand(0.5, 0.85), size: ESA.rand(7, 11),
          color: "#ffd766", gravity: 260
        });
      }
      this.fx.spawn({
        type: "text", x: cx, y: at(-126).y, vx: 0, vy: -56,
        gravity: 0, drag: 0.99, life: 0.72, font: 30,
        text: "+1", color: "#ffd766"
      });
    }
  };

  /** Wrong hole / key, late, or swinging at an empty booth: -1 and a red pop. */
  BonkBooth.prototype.penalise = function (side, holeIndex, label) {
    var self = this;
    var at = function (dy) { return self.holePt(side, holeIndex, dy); };
    var cx = at(0).x;

    this.score[side] -= 1;
    ESA.UI.setScore(side, this.score[side]);
    ESA.Audio.play("bonkMiss");
    this.holeMiss[side][holeIndex] = 1;

    this.fx.spawn({ type: "ring", x: cx, y: at(-30).y, size: 10, size2: 70, life: 0.3, color: "#e8584f" });
    this.fx.spawn({
      type: "text", x: cx, y: at(-70).y, vx: 0, vy: -50,
      gravity: 0, drag: 0.99, life: 0.62, font: 28,
      text: "−1", color: "#ff5a4f"
    });
    this.fx.spawn({
      type: "text", x: cx, y: at(-38).y, vx: 0, vy: -30,
      gravity: 0, drag: 0.98, life: 0.55, font: 14,
      text: label, color: "#ffb3ae"
    });
  };

  /* ------------------------------------------------------------------ *
   * Update
   * ------------------------------------------------------------------ */
  BonkBooth.prototype.update = function (dt, now) {
    this.fx.update(dt);

    for (var i = 0; i < SLOTS.length; i++) {
      var side = SLOTS[i];
      if (this.swing[side]) {
        this.swing[side].t -= dt;
        if (this.swing[side].t <= 0) this.swing[side] = null;
      }
      for (var h = 0; h < 3; h++) {
        this.holeGlow[side][h] = Math.max(0, this.holeGlow[side][h] - dt * 2.6);
        this.holeMiss[side][h] = Math.max(0, this.holeMiss[side][h] - dt * 3.2);
      }
    }

    if (this.state !== "playing") return;

    this.advance("p1", dt);
    this.advance("p2", dt);

    this.timeLeft -= dt;
    if (this.timeLeft < 0) this.timeLeft = 0;

    var shown = Math.ceil(this.timeLeft);
    if (shown !== this.lastShownSecond) {
      this.lastShownSecond = shown;
      ESA.UI.setCenter("Time", shown, shown <= URGENT_AT && shown > 0);
      if (shown <= 5 && shown > 0) ESA.Audio.play("countdown");
    }

    if (this.timeLeft <= 0) this.finish();
  };

  BonkBooth.prototype.finish = function () {
    this.state = "matchEnd";
    ESA.UI.setCenter("Time", 0, false);

    var z = this.score.p1, s = this.score.p2;
    var winner = z === s ? null : (z > s ? "p1" : "p2");

    if (winner) {
      ESA.Audio.play("matchWin");
      this.celebrate();
      this.api.endMatch({
        winner: winner,
        kicker: "Booth Closed",
        title: this.players[winner].name + " Wins",
        text: Math.max(z, s) > 0
          ? "Finished on " + Math.max(z, s) + (Math.max(z, s) === 1 ? " point" : " points") + " against " +
            this.players[victimOf(winner)].name + ". Accuracy pays."
          : "Fewer wrong hits than " + this.players[victimOf(winner)].name + ". Accuracy pays.",
        scores: { p1: z, p2: s }
      });
    } else {
      ESA.Audio.play("draw");
      this.api.endMatch({
        winner: null,
        kicker: "Booth Closed",
        title: "Dead Heat",
        text: "Perfectly balanced bonking. Somehow.",
        scores: { p1: z, p2: s }
      });
    }
  };

  BonkBooth.prototype.celebrate = function () {
    for (var i = 0; i < 34; i++) {
      this.fx.spawn({
        type: "confetti",
        x: ESA.rand(80, W - 80), y: ESA.rand(-40, 60),
        vx: ESA.rand(-60, 60), vy: ESA.rand(40, 140),
        life: ESA.rand(1.4, 2.4), size: ESA.rand(5, 9),
        color: ESA.pick(["#f3c35a", "#fff6e4", "#e8584f", "#2f7fd8", "#9560ac"]),
        gravity: 110, drag: 0.985, vrot: ESA.rand(-7, 7)
      });
    }
  };

  /* ================================================================== *
   * Booth artwork
   * ================================================================== */

  /** Everything that never moves, rendered once. */
  function drawBoothLayer(g, players, layout, touch) {
    /* --- Back wall --------------------------------------------------- */
    var wall = g.createLinearGradient(0, 0, 0, H);
    wall.addColorStop(0, "#0d2a49");
    wall.addColorStop(0.55, "#07192e");
    wall.addColorStop(1, "#040e1c");
    g.fillStyle = wall;
    g.fillRect(0, 0, W, H);

    // Restrained chevron weave on the back wall.
    g.save();
    g.globalAlpha = 0.08;
    g.strokeStyle = "#f3c35a";
    g.lineWidth = 2;
    g.beginPath();
    for (var cx = -40; cx < W + 40; cx += 34) {
      for (var cy = 96; cy < H - 60; cy += 34) {
        g.moveTo(cx, cy + 10);
        g.lineTo(cx + 17, cy);
        g.lineTo(cx + 34, cy + 10);
      }
    }
    g.stroke();
    g.restore();

    // Booth spotlights: a soft pool of light above each hole, so the back
    // wall reads as a lit attraction rather than an empty panel.
    SLOTS.forEach(function (side) {
      if (touch) {
        // Head-to-head: a soft pool of light behind each hole instead.
        layout[side].forEach(function (L) {
          var pool = g.createRadialGradient(L.x, L.y - 50, 4, L.x, L.y - 50, 92);
          pool.addColorStop(0, "rgba(243,195,90,.16)");
          pool.addColorStop(1, "rgba(243,195,90,0)");
          g.fillStyle = pool;
          g.fillRect(L.x - 100, L.y - 150, 200, 200);
        });
        return;
      }
      HOLE_X[side].forEach(function (hx) {
        var cone = g.createLinearGradient(0, 132, 0, HOLE_Y - 6);
        cone.addColorStop(0, "rgba(243,195,90,.13)");
        cone.addColorStop(1, "rgba(243,195,90,0)");
        g.save();
        g.fillStyle = cone;
        g.beginPath();
        g.moveTo(hx - 34, 132);
        g.lineTo(hx + 34, 132);
        g.lineTo(hx + 96, HOLE_Y - 6);
        g.lineTo(hx - 96, HOLE_Y - 6);
        g.closePath();
        g.fill();
        g.restore();
      });
    });

    /* --- Side colour columns ---------------------------------------- */
    [[players.p1.color, 0, 1], [players.p2.color, W, -1]].forEach(function (c) {
      var grad = g.createLinearGradient(c[1], 0, c[1] + 120 * c[2], 0);
      grad.addColorStop(0, "rgba(" + rgbOf(c[0]) + ",.22)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = grad;
      g.fillRect(Math.min(c[1], c[1] + 120 * c[2]), 90, 120, H - 90);
    });

    /* --- Centre divider ---------------------------------------------- */
    g.save();
    g.globalAlpha = 0.5;
    var div = g.createLinearGradient(0, 96, 0, H - 40);
    div.addColorStop(0, "rgba(243,195,90,0)");
    div.addColorStop(0.3, "rgba(243,195,90,.8)");
    div.addColorStop(1, "rgba(243,195,90,.15)");
    g.fillStyle = div;
    g.fillRect(W / 2 - 1.5, 96, 3, H - 136);
    g.restore();

    /* --- Marquee ------------------------------------------------------ */
    var mw = 460, mh = 62, mx = W / 2 - mw / 2, my = 16;

    g.save();
    g.shadowColor = "rgba(0,0,0,.5)";
    g.shadowBlur = 20;
    g.shadowOffsetY = 6;
    var plaque = g.createLinearGradient(0, my, 0, my + mh);
    plaque.addColorStop(0, "#15406c");
    plaque.addColorStop(1, "#071a30");
    g.fillStyle = plaque;
    ESA.roundRect(g, mx, my, mw, mh, 14);
    g.fill();
    g.restore();

    g.strokeStyle = "#f3c35a";
    g.lineWidth = 2.5;
    ESA.roundRect(g, mx, my, mw, mh, 14);
    g.stroke();
    g.save();
    g.globalAlpha = 0.35;
    g.lineWidth = 1;
    ESA.roundRect(g, mx + 6, my + 6, mw - 12, mh - 12, 9);
    g.stroke();
    g.restore();

    // Emblem on each end of the marquee
    var emblem = ESA.Assets.get("emblem");
    if (emblem && emblem.width) {
      g.drawImage(emblem, mx + 14, my + 9, 44, 44);
      g.drawImage(emblem, mx + mw - 58, my + 9, 44, 44);
    }

    g.fillStyle = "#fff6e4";
    g.font = "700 27px " + ESA.FONT_DISPLAY;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.letterSpacing = "5px";
    g.fillText("BONK BOOTH", W / 2, my + 27);
    g.font = "700 11px " + ESA.FONT_DISPLAY;
    g.letterSpacing = "4px";
    g.fillStyle = "#e5a92f";
    g.fillText("ESA ARCADE ATTRACTION", W / 2, my + 48);
    g.letterSpacing = "0px";

    /* --- Side name plates --------------------------------------------- */
    SLOTS.forEach(function (side) {
      var c = players[side];
      var px = touch ? (side === "p1" ? W / 2 - 150 : W / 2 + 150)
                     : (side === "p1" ? W * 0.25 : W * 0.75);
      g.save();
      g.fillStyle = "rgba(4,14,26,.6)";
      ESA.roundRect(g, px - 96, 100, 192, 28, 14);
      g.fill();
      g.strokeStyle = c.color;
      g.lineWidth = 1.5;
      ESA.roundRect(g, px - 96, 100, 192, 28, 14);
      g.stroke();
      g.fillStyle = "#dce9f6";
      g.font = "700 13px " + ESA.FONT_DISPLAY;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.letterSpacing = "3px";
      g.fillText(c.name.toUpperCase() + "'S SIDE", px, 115);
      g.restore();
    });

    /* --- Head-to-head VS badge (touch layout) ------------------------ */
    if (touch) {
      g.save();
      g.fillStyle = "rgba(4,14,26,.9)";
      g.beginPath(); g.arc(W / 2, H / 2 + 20, 30, 0, Math.PI * 2); g.fill();
      g.strokeStyle = "#f3c35a";
      g.lineWidth = 2.5;
      g.stroke();
      g.fillStyle = "#f3c35a";
      g.font = "800 22px " + ESA.FONT_DISPLAY;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("VS", W / 2, H / 2 + 21);
      // Tap-zone tint per side.
      [[players.p1.color, 0], [players.p2.color, W / 2]].forEach(function (c) {
        g.fillStyle = "rgba(" + rgbOf(c[0]) + ",.05)";
        g.fillRect(c[1], 136, W / 2, H - 188);
      });
      g.restore();
    }

    /* --- Counter ------------------------------------------------------ */
    var counterY = H - 52;
    var wood = g.createLinearGradient(0, counterY, 0, H);
    wood.addColorStop(0, "#1b4873");
    wood.addColorStop(1, "#0a1f38");
    g.fillStyle = wood;
    g.fillRect(0, counterY, W, H - counterY);
    g.fillStyle = "#f3c35a";
    g.globalAlpha = 0.55;
    g.fillRect(0, counterY, W, 3);
    g.globalAlpha = 1;

    // Stepped motif along the counter face
    g.save();
    g.globalAlpha = 0.22;
    g.fillStyle = "#f3c35a";
    for (var sx = 12; sx < W - 10; sx += 32) {
      g.fillRect(sx, counterY + 14, 14, 3);
      g.fillRect(sx + 18, counterY + 20, 9, 3);
    }
    g.restore();

    /* --- Outer booth frame -------------------------------------------- */
    g.strokeStyle = "rgba(243,195,90,.45)";
    g.lineWidth = 4;
    ESA.roundRect(g, 10, 10, W - 20, H - 20, 18);
    g.stroke();
  }

  /** The hole itself: rim, dark interior, inner shadow. */
  function drawHoleBack(g, cx, glow, miss) {
    // Rim shadow on the booth floor
    g.save();
    g.globalAlpha = 0.5;
    g.fillStyle = "#030c18";
    g.beginPath();
    g.ellipse(cx, HOLE_Y + 8, HOLE_RX + 10, HOLE_RY + 7, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // Gold rim
    g.save();
    g.strokeStyle = glow > 0.02 ? "#ffe6a8" : "#c0871f";
    g.globalAlpha = 0.55 + glow * 0.45;
    g.lineWidth = 4;
    g.beginPath();
    g.ellipse(cx, HOLE_Y, HOLE_RX + 5, HOLE_RY + 4, 0, 0, Math.PI * 2);
    g.stroke();
    g.restore();

    // Opening
    var inner = g.createRadialGradient(cx, HOLE_Y - 4, 4, cx, HOLE_Y, HOLE_RX);
    inner.addColorStop(0, "#000308");
    inner.addColorStop(1, "#0d1d2e");
    g.fillStyle = inner;
    g.beginPath();
    g.ellipse(cx, HOLE_Y, HOLE_RX, HOLE_RY, 0, 0, Math.PI * 2);
    g.fill();

    // Red flash after a wrong hit on this hole
    if (miss > 0.02) {
      g.save();
      g.globalAlpha = Math.min(1, miss);
      g.strokeStyle = "#ff5a4f";
      g.lineWidth = 5;
      g.beginPath();
      g.ellipse(cx, HOLE_Y, HOLE_RX + 7, HOLE_RY + 6, 0, 0, Math.PI * 2);
      g.stroke();
      g.globalAlpha = Math.min(1, miss) * 0.35;
      g.fillStyle = "#e8584f";
      g.beginPath();
      g.ellipse(cx, HOLE_Y, HOLE_RX, HOLE_RY, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }

    // Anticipation glow spilling out of the hole
    if (glow > 0.02) {
      g.save();
      g.globalAlpha = Math.min(1, glow) * 0.5;
      var gg = g.createRadialGradient(cx, HOLE_Y, 2, cx, HOLE_Y, HOLE_RX * 1.5);
      gg.addColorStop(0, "rgba(243,195,90,.85)");
      gg.addColorStop(1, "rgba(243,195,90,0)");
      g.fillStyle = gg;
      g.beginPath();
      g.ellipse(cx, HOLE_Y - 6, HOLE_RX * 1.5, HOLE_RY * 2.4, 0, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  /** The front lip, drawn over the character so they emerge from inside. */
  function drawHoleLip(g, cx) {
    g.save();
    g.beginPath();
    g.ellipse(cx, HOLE_Y, HOLE_RX + 5, HOLE_RY + 4, 0, 0, Math.PI, false);
    g.closePath();
    var lip = g.createLinearGradient(0, HOLE_Y, 0, HOLE_Y + HOLE_RY + 6);
    lip.addColorStop(0, "#102c4a");
    lip.addColorStop(1, "#061729");
    g.fillStyle = lip;
    g.fill();
    g.strokeStyle = "rgba(243,195,90,.6)";
    g.lineWidth = 2.5;
    g.stroke();
    g.restore();
  }

  function drawKeycap(g, cx, label, color, pressed) {
    var y = HOLE_Y + 40 + (pressed ? 3 : 0);
    g.save();
    if (!pressed) {
      g.fillStyle = "rgba(2,8,16,.85)";
      ESA.roundRect(g, cx - 23, y + 4, 46, 34, 9);
      g.fill();
    }
    var grad = g.createLinearGradient(0, y, 0, y + 34);
    grad.addColorStop(0, pressed ? color : "#1d4e80");
    grad.addColorStop(1, pressed ? color : "#0b2240");
    g.fillStyle = grad;
    ESA.roundRect(g, cx - 23, y, 46, 34, 9);
    g.fill();
    g.strokeStyle = pressed ? "#fff6e4" : color;
    g.lineWidth = 2;
    ESA.roundRect(g, cx - 23, y, 46, 34, 9);
    g.stroke();

    g.fillStyle = "#fff6e4";
    g.font = "700 18px " + ESA.FONT_DISPLAY;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(label, cx, y + 18);
    g.restore();
  }

  /** Touch layout: the tappable pad under each hole, in its owner's colour. */
  function drawTapPad(g, cx, color, hit) {
    g.save();
    g.globalAlpha = hit ? 0.55 : 0.22;
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(cx, HOLE_Y - 40, HOLE_RX + 46, 118, 0, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = hit ? 1 : 0.6;
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.setLineDash([10, 8]);
    g.stroke();
    g.restore();
  }

  /** Cartoon bomb rising from a hole - clearly a thing not to hit. */
  function drawBoothBomb(g, cx, cy, now) {
    var r = 30;
    g.save();
    g.translate(cx, cy);

    var pulse = 1 + Math.sin(now / 110) * 0.06;
    g.scale(pulse, pulse);

    var warn = g.createRadialGradient(0, 0, r * 0.5, 0, 0, r * 2.3);
    warn.addColorStop(0, "rgba(232,88,79,.45)");
    warn.addColorStop(1, "rgba(232,88,79,0)");
    g.fillStyle = warn;
    g.beginPath(); g.arc(0, 0, r * 2.3, 0, Math.PI * 2); g.fill();

    g.strokeStyle = "#8e6314";
    g.lineWidth = 5;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(9, -r + 3);
    g.quadraticCurveTo(28, -r - 16, 19, -r - 34);
    g.stroke();

    var sr = 6 + Math.sin(now / 50) * 2;
    g.fillStyle = "#fff0b8";
    g.beginPath(); g.arc(19, -r - 35, sr, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,170,60,.5)";
    g.beginPath(); g.arc(19, -r - 35, sr * 2, 0, Math.PI * 2); g.fill();

    var body = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.15);
    body.addColorStop(0, "#4a5a70");
    body.addColorStop(0.45, "#1d2a3c");
    body.addColorStop(1, "#0c131f");
    g.fillStyle = body;
    g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();

    g.strokeStyle = "rgba(232,88,79,.9)";
    g.lineWidth = 3.5;
    g.beginPath();
    g.ellipse(0, 3, r * 0.9, r * 0.3, 0, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = "rgba(255,255,255,.3)";
    g.beginPath();
    g.ellipse(-r * 0.36, -r * 0.42, r * 0.25, r * 0.16, -0.6, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  /** Mallet swinging down onto a hole. */
  function drawMallet(g, cx, t) {
    // t goes 0.24 -> 0; swing down then lift.
    var p = 1 - (t / 0.24);
    var angle = -1.0 + ESA.easeOut(Math.min(1, p * 1.8)) * 1.25;
    var y = HOLE_Y - 96;

    g.save();
    g.translate(cx + 56, y);
    g.rotate(angle);

    g.fillStyle = "#8e6314";
    ESA.roundRect(g, -7, 0, 14, 74, 7);
    g.fill();
    g.strokeStyle = "#5c400c";
    g.lineWidth = 2;
    ESA.roundRect(g, -7, 0, 14, 74, 7);
    g.stroke();

    g.fillStyle = "#f3c35a";
    ESA.roundRect(g, -40, -34, 80, 38, 12);
    g.fill();
    g.strokeStyle = "#c0871f";
    g.lineWidth = 3;
    ESA.roundRect(g, -40, -34, 80, 38, 12);
    g.stroke();
    g.fillStyle = "rgba(255,246,228,.6)";
    ESA.roundRect(g, -31, -27, 22, 10, 5);
    g.fill();

    g.restore();
  }

  /* ------------------------------------------------------------------ *
   * Draw
   * ------------------------------------------------------------------ */
  BonkBooth.prototype.draw = function (ctx, now) {
    var players = this.players;
    var layout = this.layout, touch = this.touchLayout;
    var layer = ESA.Stage.layer(this.layerKey, function (g) { drawBoothLayer(g, players, layout, touch); });
    ESA.Stage.blit(ctx, layer);

    // Marquee bulbs - the only animated part of the booth chrome.
    var mw = 460, mx = W / 2 - mw / 2;
    for (var b = 0; b < 12; b++) {
      var bx = mx + 18 + (b / 11) * (mw - 36);
      var lit = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now / 240 + b * 0.7));
      ctx.save();
      ctx.globalAlpha = lit;
      ctx.fillStyle = "#ffe9a8";
      ctx.beginPath(); ctx.arc(bx, 86, 3.2, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = lit * 0.35;
      ctx.beginPath(); ctx.arc(bx, 86, 8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    // Holes, back to front: back rim, character, front lip, keycap.
    for (var i = 0; i < SLOTS.length; i++) {
      var side = SLOTS[i];
      var t = this.targets[side];
      var color = this.players[side].color;
      var labels = ESA.controlsFor(side, "booth").caps;

      for (var h = 0; h < 3; h++) {
        var cx = HOLE_X[side][h];
        var glow = this.holeGlow[side][h];
        var L = this.layout[side][h];
        // Map the desktop-space hole art onto this layout slot.
        ctx.save();
        ctx.translate(L.x, L.y);
        ctx.scale(L.s, L.s);
        ctx.translate(-cx, -HOLE_Y);

        if (this.touchLayout) drawTapPad(ctx, cx, color, this.swing[side] && this.swing[side].hole === h);
        drawHoleBack(ctx, cx, glow, this.holeMiss[side][h]);

        if (t && t.hole === h && t.rise > 0.001) {
          this.drawOccupant(ctx, side, t, cx, now);
        }

        drawHoleLip(ctx, cx);

        if (!this.touchLayout) {
          var pressed = ESA.Input.isDown(ESA.CONTROLS[side].booth[h]);
          drawKeycap(ctx, cx, labels[h], color, pressed);
        }
        ctx.restore();
      }

      // Mallet last, over all three holes (as on desktop before).
      if (this.swing[side]) {
        var sh = this.swing[side].hole, SL = this.layout[side][sh];
        ctx.save();
        ctx.translate(SL.x, SL.y);
        ctx.scale(SL.s, SL.s);
        ctx.translate(-HOLE_X[side][sh], -HOLE_Y);
        drawMallet(ctx, HOLE_X[side][sh], this.swing[side].t);
        ctx.restore();
      }
    }

    this.fx.draw(ctx);
  };

  /** Draw whatever is currently in the hole, clipped to the opening. */
  BonkBooth.prototype.drawOccupant = function (ctx, side, t, cx, now) {
    var hidden = SPRITE_H + 24;
    var feetY = HOLE_Y + hidden * (1 - t.rise);

    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - HOLE_RX - 6, CLIP_TOP, (HOLE_RX + 6) * 2, (HOLE_Y + 4) - CLIP_TOP);
    ctx.clip();
    // Attempt already used on this pop-up: show it greyed out - it can't score now.
    if (t.attempted && !t.resolved) ctx.globalAlpha = 0.4;

    if (t.type === "bomb") {
      drawBoothBomb(ctx, cx, feetY - 46, now);
    } else {
      var victim = this.players[victimOf(side)].character.id;
      var wasHit = (t.hitType === "bonk");

      // Squash on impact, settling over reactT.
      var sx = 1, sy = 1, rot = 0;
      if (wasHit && t.reactT > 0) {
        var k = t.reactT / 0.3;
        sx = 1 + k * 0.22;
        sy = 1 - k * 0.2;
        rot = Math.sin(now / 32) * 0.07 * k;
      } else if (t.phase === "active") {
        // Gentle idle wobble while they are up and taunting.
        sy = 1 + Math.sin(now / 240) * 0.02;
        rot = Math.sin(now / 420) * 0.03;
      }

      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,.4)";
      ctx.shadowBlur = 16;
      ctx.shadowOffsetY = 4;
      // Quick crossfade into the hurt art right after the bonk lands.
      var blend = wasHit ? ESA.clamp((0.34 - t.reactT) / 0.09, 0, 1) : 0;
      ESA.drawSpriteBlend(ctx, victim, blend, cx, feetY, {
        height: SPRITE_H,
        flip: side === "p2",
        scaleX: sx,
        scaleY: sy,
        rotate: rot
      });
      ctx.restore();
    }

    ctx.restore();
  };

  ESA.BonkBooth = BonkBooth;

  ESA.Games.register({
    id: "bonk",
    title: "Bonk Booth",
    tagline: "Your rival pops out of three holes. Hit the matching key. Wrong key costs a point.",
    description: "Your rival pops out of your three holes. <b>Hit the key under the hole</b> " +
                 "before they drop back down: <b>+1</b>. Wrong key: <b>−1</b> — one swing per pop-up, so mashing loses. " +
                 "Leave bombs alone — hitting one is <b>−2</b>. It gets faster as the clock runs down.",
    mode: MATCH_SECONDS + " seconds",
    icon: { symbol: "#icoMallet" },
    controls: "booth",
    touch: { movement: "none", actions: [], interaction: "directTap",
             help: ["TAP YOUR RIVAL — +1", "WRONG HOLE — −1 · ONE TAP PER POP-UP", "BOMB — LEAVE IT ALONE (−2)"],
             tagline: "Your rival pops out of your three holes. Tap the right one. Wrong hole costs a point.",
             description: "Your rival pops out of the three holes on <b>your side of the screen</b>. " +
                          "<b>Tap them</b> before they drop back down: <b>+1</b>. Wrong hole: <b>−1</b> — one tap per pop-up, so spamming loses. " +
                          "Leave bombs alone — hitting one is <b>−2</b>. It gets faster as the clock runs down." },
    hud: { centerLabel: "Time", centerValue: String(MATCH_SECONDS), pips: 0 },
    accent: "#4fb7c9",
    canTie: true,
    tournamentEligible: true,
    enabled: true,
    create: function (api, setup) { return new BonkBooth(api, setup); }
  });

})(window.ESA);
