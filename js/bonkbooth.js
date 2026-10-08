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
  var BOMB_CHANCE = 0.14;
  var URGENT_AT = 10;

  var HOLE_Y = 392;
  var HOLE_RX = 62;
  var HOLE_RY = 19;
  var HOLE_X = {
    zima:  [104, 250, 396],
    shaza: [W - 396, W - 250, W - 104]
  };
  var SPRITE_H = 152;
  var CLIP_TOP = HOLE_Y - 168;

  /* Stage durations, in seconds. `active` and `gap` ease down over the
     match for a gentle ramp - never into esports territory. */
  var TELL = 0.40;
  var RISE = 0.20;
  var RETREAT = 0.22;
  /* How long a bonked target stays up showing its hurt art. Without this the
     hurt pose flashes by in a couple of frames and the payoff is invisible. */
  var STUN = 0.46;

  function BonkBooth(api) {
    this.api = api;
    this.timers = new ESA.TimerGroup();
    this.fx = new ESA.ParticleField(200);

    this.score = { zima: 0, shaza: 0 };
    this.timeLeft = MATCH_SECONDS;
    this.state = "idle";
    this.lastShownSecond = -1;

    this.targets = { zima: null, shaza: null };
    this.swing = { zima: null, shaza: null };   // mallet feedback
    this.holeGlow = { zima: [0, 0, 0], shaza: [0, 0, 0] };
  }

  BonkBooth.meta = {
    id: "bonk",
    title: "Bonk Booth",
    mode: "42 seconds",
    rules: "Your rival pops out of your three holes. <b>Hit the key under the hole</b> " +
           "before they drop back down. If a bomb appears, leave it alone — bonking it costs you a point.",
    hud: { centerLabel: "Time", centerValue: "42", pips: 0 },
    controls: "booth"
  };

  /** Who appears in a given player's holes: their opponent. */
  function victimOf(side) {
    return side === "zima" ? "shaza" : "zima";
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */
  BonkBooth.prototype.start = function () {
    var self = this;

    this.score.zima = 0;
    this.score.shaza = 0;
    this.timeLeft = MATCH_SECONDS;
    this.lastShownSecond = -1;
    this.fx.clear();
    this.swing.zima = null;
    this.swing.shaza = null;
    this.holeGlow.zima = [0, 0, 0];
    this.holeGlow.shaza = [0, 0, 0];

    this.targets.zima = this.makeTarget("zima", 0.5);
    this.targets.shaza = this.makeTarget("shaza", 0.8);

    ESA.UI.setScore("zima", 0);
    ESA.UI.setScore("shaza", 0);
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

  /** 0 at the start of the match, 1 at the end. Drives the gentle ramp. */
  BonkBooth.prototype.progress = function () {
    return ESA.clamp(1 - this.timeLeft / MATCH_SECONDS, 0, 1);
  };

  BonkBooth.prototype.makeTarget = function (side, gapOverride) {
    var prog = this.progress();
    var prev = this.targets[side];
    var hole = ESA.randInt(0, 2);
    // Avoid the same hole twice in a row so the booth stays lively.
    if (prev && prev.hole === hole) hole = (hole + 1 + ESA.randInt(0, 1)) % 3;

    var isBomb = ESA.chance(BOMB_CHANCE);

    return {
      side: side,
      hole: hole,
      type: isBomb ? "bomb" : "normal",
      phase: "gap",
      t: 0,
      // Bombs linger a touch longer: the correct play is to do nothing.
      activeFor: isBomb
        ? ESA.rand(1.15, 1.45)
        : ESA.lerp(ESA.rand(1.1, 1.4), ESA.rand(0.9, 1.1), prog),
      gapFor: gapOverride !== undefined ? gapOverride
            : ESA.lerp(ESA.rand(0.45, 0.7), ESA.rand(0.3, 0.45), prog),
      rise: 0,
      resolved: false,
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
        this.holeGlow[side][t.hole] = Math.max(this.holeGlow[side][t.hole], t.t / TELL);
        if (t.t >= TELL) { t.phase = "rise"; t.t = 0; }
        break;

      case "rise":
        t.rise = ESA.easeOut(ESA.clamp(t.t / RISE, 0, 1));
        if (t.t >= RISE) { t.phase = "active"; t.t = 0; t.rise = 1; }
        break;

      case "active":
        t.rise = 1;
        if (t.t >= t.activeFor) { t.phase = "retreat"; t.t = 0; }
        break;

      case "stunned":
        // Held up after a successful hit so the hurt art actually reads.
        t.rise = 1;
        if (t.t >= STUN) { t.phase = "retreat"; t.t = 0; }
        break;

      case "retreat":
        var dur = t.resolved ? RETREAT * 0.6 : RETREAT;
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

    for (var i = 0; i < ESA.roster.length; i++) {
      var side = ESA.roster[i];
      var idx = ESA.characters[side].bonkKeys.indexOf(code);
      if (idx >= 0) this.attempt(side, idx);
    }
  };

  BonkBooth.prototype.attempt = function (side, holeIndex) {
    var t = this.targets[side];
    var cx = HOLE_X[side][holeIndex];

    // Mallet comes down regardless - the swing always reads.
    this.swing[side] = { hole: holeIndex, t: 0.24 };

    var hittable = t && !t.resolved && t.hole === holeIndex &&
                   (t.phase === "rise" || t.phase === "active");

    if (!hittable) {
      ESA.Audio.play("bonkMiss");
      this.fx.spawn({
        type: "text", x: cx, y: HOLE_Y - 44, vx: 0, vy: -40,
        gravity: 0, drag: 0.98, life: 0.5, font: 19,
        text: "MISS", color: "#9db2c7"
      });
      return;
    }

    t.resolved = true;
    t.reactT = 0.34;
    t.phase = "stunned";      // hold them up for a beat, then drop
    t.t = 0;

    if (t.type === "bomb") {
      t.hitType = "bomb";
      this.score[side] = Math.max(0, this.score[side] - 1);
      ESA.UI.setScore(side, this.score[side]);
      ESA.Audio.play("penalty");
      ESA.Stage.shake(12);
      ESA.Stage.flash(0.3, "#ffb3ae");

      this.fx.burst(cx, HOLE_Y - 58, 22, {
        colors: ["#e8584f", "#ff9a3c", "#ffd766", "#fff6e4"],
        speedMin: 90, speedMax: 320, lifeMin: 0.35, lifeMax: 0.75,
        sizeMin: 3, sizeMax: 6.5, gravity: 380
      });
      this.fx.spawn({ type: "ring", x: cx, y: HOLE_Y - 58, size: 12, size2: 120, life: 0.45, color: "#e8584f" });
      this.fx.spawn({
        type: "text", x: cx, y: HOLE_Y - 92, vx: 0, vy: -58,
        gravity: 0, drag: 0.99, life: 0.8, font: 30,
        text: "−1", color: "#e8584f"
      });

    } else {
      t.hitType = "bonk";
      this.score[side] += 1;
      ESA.UI.setScore(side, this.score[side]);
      ESA.Audio.play("bonk");
      ESA.Stage.shake(7);

      this.fx.burst(cx, HOLE_Y - 92, 10, {
        colors: ["#fdeec4", "#f3c35a"],
        speedMin: 60, speedMax: 170, lifeMin: 0.25, lifeMax: 0.5,
        sizeMin: 2, sizeMax: 4, gravity: 300
      });
      for (var s = 0; s < 3; s++) {
        this.fx.spawn({
          type: "star", x: cx + ESA.rand(-26, 26), y: HOLE_Y - 112 + ESA.rand(-14, 14),
          vx: ESA.rand(-90, 90), vy: ESA.rand(-170, -90),
          life: ESA.rand(0.5, 0.85), size: ESA.rand(7, 11),
          color: "#ffd766", gravity: 260
        });
      }
      this.fx.spawn({
        type: "text", x: cx, y: HOLE_Y - 126, vx: 0, vy: -56,
        gravity: 0, drag: 0.99, life: 0.72, font: 28,
        text: "+1", color: "#fdeec4"
      });
    }
  };

  /* ------------------------------------------------------------------ *
   * Update
   * ------------------------------------------------------------------ */
  BonkBooth.prototype.update = function (dt, now) {
    this.fx.update(dt);

    for (var i = 0; i < ESA.roster.length; i++) {
      var side = ESA.roster[i];
      if (this.swing[side]) {
        this.swing[side].t -= dt;
        if (this.swing[side].t <= 0) this.swing[side] = null;
      }
      for (var h = 0; h < 3; h++) {
        this.holeGlow[side][h] = Math.max(0, this.holeGlow[side][h] - dt * 2.6);
      }
    }

    if (this.state !== "playing") return;

    this.advance("zima", dt);
    this.advance("shaza", dt);

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

    var z = this.score.zima, s = this.score.shaza;
    var winnerId = z === s ? null : (z > s ? "zima" : "shaza");

    if (winnerId) {
      ESA.Audio.play("matchWin");
      this.celebrate();
      this.api.endMatch({
        winnerId: winnerId,
        kicker: "Booth Closed",
        title: ESA.characters[winnerId].name + " Wins",
        text: "Landed " + Math.max(z, s) + " clean bonks on " +
              ESA.characters[victimOf(winnerId)].name + ".",
        zima: z, shaza: s
      });
    } else {
      ESA.Audio.play("draw");
      this.api.endMatch({
        winnerId: null,
        kicker: "Booth Closed",
        title: "Dead Heat",
        text: "Perfectly balanced bonking. Somehow.",
        zima: z, shaza: s
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
  function drawBoothLayer(g) {
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
    ESA.roster.forEach(function (side) {
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
    [["#2f7fd8", 0, 1], ["#9560ac", W, -1]].forEach(function (c) {
      var grad = g.createLinearGradient(c[1], 0, c[1] + 120 * c[2], 0);
      grad.addColorStop(0, "rgba(" + (c[0] === "#2f7fd8" ? "47,127,216" : "149,96,172") + ",.22)");
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
    ESA.roster.forEach(function (side) {
      var c = ESA.characters[side];
      var px = side === "zima" ? W * 0.25 : W * 0.75;
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
  function drawHoleBack(g, cx, glow) {
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
    var layer = ESA.Stage.layer("arena-bonk", drawBoothLayer);
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
    for (var i = 0; i < ESA.roster.length; i++) {
      var side = ESA.roster[i];
      var t = this.targets[side];
      var color = ESA.characters[side].color;
      var labels = ESA.characters[side].bonkLabel.split(" ");

      for (var h = 0; h < 3; h++) {
        var cx = HOLE_X[side][h];
        var glow = this.holeGlow[side][h];
        drawHoleBack(ctx, cx, glow);

        if (t && t.hole === h && t.rise > 0.001) {
          this.drawOccupant(ctx, side, t, cx, now);
        }

        drawHoleLip(ctx, cx);

        var pressed = ESA.Input.isDown(ESA.characters[side].bonkKeys[h]);
        drawKeycap(ctx, cx, labels[h], color, pressed);
      }

      if (this.swing[side]) {
        drawMallet(ctx, HOLE_X[side][this.swing[side].hole], this.swing[side].t);
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

    if (t.type === "bomb") {
      drawBoothBomb(ctx, cx, feetY - 46, now);
    } else {
      var victim = victimOf(side);
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
      ESA.drawSprite(ctx, victim, wasHit, cx, feetY, {
        height: SPRITE_H,
        flip: side === "shaza",
        scaleX: sx,
        scaleY: sy,
        rotate: rot
      });
      ctx.restore();
    }

    ctx.restore();
  };

  ESA.BonkBooth = BonkBooth;

})(window.ESA);
