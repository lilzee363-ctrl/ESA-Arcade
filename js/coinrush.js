/* ==========================================================================
   ESA ARCADE - Coin Rush
   Sixty seconds of collecting ESA tokens. The collectible is the official
   emblem (assets/Branding/Golden Canadian Pharaoh Emblem.png), pre-rendered
   once at two sizes so the 1254px source is never rescaled per frame.

   Normal token = +1. Rare bonus token = +3, distinguished only by the
   effects around it - the emblem artwork itself is never altered.

   SOLO SCORE ATTACK (context.single): one player, no P2, same 60 seconds.
   It gets mildly harder as the clock runs: fewer tokens on the floor at
   once and they land further from you, so the run asks for more movement.
   The run reports result.score; there is no winner.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var W = ESA.W, H = ESA.H;

  var MATCH_SECONDS = 60;
  var PLAYER_SPEED = 185;        // was 240 in V1
  var TOKEN_COUNT = 7;
  var PICKUP_FRACTION = 0.4;     // token pickup radius as a fraction of its drawn size
  var TOKEN_SIZE = 46;
  var BONUS_SIZE = 62;
  var MIN_FROM_PLAYER = 155;     // never drop a token in someone's lap
  var MIN_FROM_TOKEN = 112;
  var BONUS_CHANCE = 0.14;
  var URGENT_AT = 10;
  // Solo Score Attack ramp (start -> end of the run).
  var SOLO_TOKENS = [7, 5];
  var SOLO_MIN_FROM = [155, 245];

  /** Inset so a token is always fully reachable, never under the frame. */
  function spawnArea() {
    var b = ESA.BOUNDS;
    return { left: b.left + 16, right: b.right - 16, top: b.top + 8, bottom: b.bottom - 14 };
  }

  /** Pickup radius of a token, proportional to how big it is drawn. */
  function tokenRadius(t) {
    return (t.bonus ? BONUS_SIZE : TOKEN_SIZE) * PICKUP_FRACTION;
  }

  function CoinRush(api, setup) {
    this.api = api;
    var who = ESA.describeMatchup(setup);
    this.timers = new ESA.TimerGroup();
    this.fx = new ESA.ParticleField(220);
    this.single = !!(api && api.context && api.context.single) || who.single;

    this.p1 = ESA.makePlayer(who.p1, this.single ? W / 2 : 230, 370, { speed: PLAYER_SPEED, facing: "right" });
    this.p2 = this.single ? null : ESA.makePlayer(who.p2, W - 230, 370, { speed: PLAYER_SPEED, facing: "left" });
    this.players = this.single ? [this.p1] : [this.p1, this.p2];

    this.score = { p1: 0, p2: 0 };
    this.timeLeft = MATCH_SECONDS;
    this.state = "idle";
    this.tokens = [];
    this.bonusActive = false;
    this.lastShownSecond = -1;
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */
  CoinRush.prototype.start = function () {
    var self = this;

    // Pre-render the emblem at both token sizes (device-pixel aware).
    var q = Math.min(window.devicePixelRatio || 1, 2) * 2;
    ESA.Assets.prerender("token", "emblem", Math.round(TOKEN_SIZE * q));
    ESA.Assets.prerender("tokenBonus", "emblem", Math.round(BONUS_SIZE * q));

    this.score.p1 = 0;
    this.score.p2 = 0;
    this.timeLeft = MATCH_SECONDS;
    this.lastShownSecond = -1;
    this.bonusActive = false;
    this.fx.clear();

    this.p1.x = this.single ? W / 2 : 230; this.p1.y = 370; this.p1.facing = "right";
    this.p1.recoilX = this.p1.recoilY = 0;
    if (this.p2) {
      this.p2.x = W - 230; this.p2.y = 370; this.p2.facing = "left";
      this.p2.recoilX = this.p2.recoilY = 0;
    }

    this.tokens = [];
    for (var i = 0; i < TOKEN_COUNT; i++) {
      this.tokens.push(this.makeToken(false));
    }

    ESA.UI.setScore("p1", 0);
    if (!this.single) ESA.UI.setScore("p2", 0);   // single: that panel shows the session best
    ESA.UI.setCenter("Time", MATCH_SECONDS, false);

    this.state = "countdown";
    ESA.UI.countdown(this.timers, function () {
      if (self.state === "countdown") self.state = "playing";
    });
  };

  CoinRush.prototype.destroy = function () {
    this.state = "destroyed";
    this.timers.clear();
    this.fx.clear();
    this.tokens.length = 0;
  };

  /* ------------------------------------------------------------------ *
   * Tokens
   * ------------------------------------------------------------------ */

  /**
   * Rejection sampling: keep drawing positions until one is clear of both
   * players and of every other live token. Falls back to the best-scoring
   * candidate so this can never loop forever or produce NaN.
   */
  /** 0 at the start of the run, 1 at the end. */
  CoinRush.prototype.progress = function () {
    return ESA.clamp(1 - this.timeLeft / MATCH_SECONDS, 0, 1);
  };

  CoinRush.prototype.minFromPlayer = function () {
    return this.single ? ESA.lerp(SOLO_MIN_FROM[0], SOLO_MIN_FROM[1], this.progress()) : MIN_FROM_PLAYER;
  };

  CoinRush.prototype.findSpot = function () {
    var area = spawnArea();
    var best = null, bestScore = -1;
    var minFrom = this.minFromPlayer();

    for (var attempt = 0; attempt < 40; attempt++) {
      var x = ESA.rand(area.left, area.right);
      var y = ESA.rand(area.top, area.bottom);

      // Distance to each player's body centre, so a token never spawns
      // inside someone's torso even though their feet are further away.
      var dp = Infinity;
      for (var k = 0; k < this.players.length; k++) {
        var c = ESA.bodyBounds(this.players[k]);
        dp = Math.min(dp, ESA.dist(x, y, c.cx, c.cy));
      }
      var dt = Infinity;
      for (var i = 0; i < this.tokens.length; i++) {
        var t = this.tokens[i];
        if (!t || t.collected) continue;
        dt = Math.min(dt, ESA.dist(x, y, t.x, t.y));
      }

      if (dp >= minFrom && dt >= MIN_FROM_TOKEN) {
        return { x: x, y: y };
      }

      // Score candidates so the fallback is still a reasonable spot.
      var score = Math.min(dp / minFrom, 1) + Math.min(dt / MIN_FROM_TOKEN, 1);
      if (score > bestScore) { bestScore = score; best = { x: x, y: y }; }
    }
    return best || { x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
  };

  CoinRush.prototype.makeToken = function (allowBonus) {
    var spot = this.findSpot();
    var bonus = false;
    if (allowBonus && !this.bonusActive && ESA.chance(BONUS_CHANCE)) {
      bonus = true;
      this.bonusActive = true;
    }
    return {
      x: spot.x,
      y: spot.y,
      bonus: bonus,
      phase: Math.random() * Math.PI * 2,
      born: 0,            // grow-in progress, 0 -> 1
      collected: false,
      popT: 0,
      respawnIn: 0
    };
  };

  CoinRush.prototype.collect = function (player, token) {
    if (token.collected) return;        // one pickup per token, always

    token.collected = true;
    token.popT = 1;
    token.respawnIn = 0.42;
    if (token.bonus) this.bonusActive = false;

    var value = token.bonus ? 3 : 1;
    var slot = player.slot;
    this.score[slot] += value;
    ESA.UI.setScore(slot, this.score[slot]);

    ESA.Audio.play(token.bonus ? "tokenBonus" : "tokenPickup");

    var colors = token.bonus
      ? ["#fff6e4", "#f3c35a", "#ffe9a8", "#e8584f"]
      : ["#f3c35a", "#fdeec4", "#e5a92f"];

    this.fx.burst(token.x, token.y, token.bonus ? 20 : 11, {
      colors: colors,
      speedMin: 70, speedMax: token.bonus ? 290 : 190,
      lifeMin: 0.3, lifeMax: 0.68,
      sizeMin: 2, sizeMax: token.bonus ? 6 : 4.2,
      gravity: 300
    });
    this.fx.spawn({
      type: "ring", x: token.x, y: token.y,
      size: 12, size2: token.bonus ? 108 : 64,
      life: token.bonus ? 0.55 : 0.4, color: "#fdeec4"
    });
    this.fx.spawn({
      type: "text", x: token.x, y: token.y - 16,
      vx: 0, vy: -62, gravity: 0, drag: 0.99,
      life: 0.78, font: token.bonus ? 34 : 26,
      text: "+" + value,
      color: token.bonus ? "#fff6e4" : "#f3c35a"
    });

    if (token.bonus) {
      ESA.Stage.shake(6);
      ESA.Stage.flash(0.16, "#f3c35a");
    }
  };

  /* ------------------------------------------------------------------ *
   * Update
   * ------------------------------------------------------------------ */
  CoinRush.prototype.update = function (dt, now) {
    this.fx.update(dt);

    var canMove = (this.state === "playing");
    ESA.movePlayer(this.p1, dt, ESA.BOUNDS, canMove);
    if (this.p2) ESA.movePlayer(this.p2, dt, ESA.BOUNDS, canMove);

    // Body boxes once per frame, after movement.
    var b1 = ESA.bodyBounds(this.p1);
    var b2 = this.p2 ? ESA.bodyBounds(this.p2) : null;
    // Solo ramp: fewer tokens on the floor as the run goes on.
    var live = 0;
    var cap = this.single ? Math.round(ESA.lerp(SOLO_TOKENS[0], SOLO_TOKENS[1], this.progress())) : Infinity;
    for (var n = 0; n < this.tokens.length; n++) if (!this.tokens[n].collected) live++;

    // Tokens keep breathing during the countdown so the arena feels alive.
    for (var i = 0; i < this.tokens.length; i++) {
      var t = this.tokens[i];
      t.phase += dt * 2.2;
      if (t.born < 1) t.born = Math.min(1, t.born + dt * 4.2);
      if (t.popT > 0) t.popT = Math.max(0, t.popT - dt * 5);

      if (t.collected) {
        t.respawnIn -= dt;
        if (t.respawnIn <= 0 && this.state === "playing" && live < cap) {
          this.tokens[i] = this.makeToken(true);
          live++;
        }
        continue;
      }

      if (this.state !== "playing") continue;

      // Pickup = the token's circle touching the player's BODY box (the
      // rendered sprite, centred on the character), not the feet point.
      // Contested tokens go to the player whose body centre is closer;
      // collect() is idempotent.
      var r = tokenRadius(t);
      var hit1 = ESA.circleHitsRect(t.x, t.y, r, b1);
      var hit2 = !!b2 && ESA.circleHitsRect(t.x, t.y, r, b2);
      if (hit1 || hit2) {
        var winner;
        if (hit1 && hit2) {
          winner = ESA.dist(b1.cx, b1.cy, t.x, t.y) <= ESA.dist(b2.cx, b2.cy, t.x, t.y) ? this.p1 : this.p2;
        } else {
          winner = hit1 ? this.p1 : this.p2;
        }
        this.collect(winner, t);
      }
    }

    if (this.state !== "playing") return;

    if (this.p2) ESA.separate(this.p1, this.p2, 50);

    /* --- Clock ------------------------------------------------------- */
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

  CoinRush.prototype.finish = function () {
    this.state = "matchEnd";              // freezes gameplay immediately
    ESA.UI.setCenter("Time", 0, false);

    if (this.single) {
      // Score Attack: one number, no winner. Solo turns it into RUN COMPLETE.
      var sc = this.score.p1;
      ESA.Audio.play("matchWin");
      this.celebrate();
      this.api.endMatch({
        winner: null,
        single: true,
        score: sc,
        kicker: "Time",
        title: "Run Complete",
        text: "Collected " + sc + (sc === 1 ? " point" : " points") + " in sixty seconds.",
        scores: { p1: sc, p2: 0 }
      });
      return;
    }

    var z = this.score.p1, s = this.score.p2;
    var winner = z === s ? null : (z > s ? this.p1 : this.p2);

    if (winner) {
      var name = winner.name;
      var margin = Math.abs(z - s);
      ESA.Audio.play("matchWin");
      this.celebrate();
      this.api.endMatch({
        winner: winner.slot,
        kicker: "Time",
        title: name + " Wins",
        text: margin === 1
          ? "Won it by a single token. Brutal."
          : "Collected " + margin + " more tokens over sixty seconds.",
        scores: { p1: z, p2: s }
      });
    } else {
      ESA.Audio.play("draw");
      this.api.endMatch({
        winner: null,
        kicker: "Time",
        title: "Dead Heat",
        text: "Identical scores. Nobody gets bragging rights.",
        scores: { p1: z, p2: s }
      });
    }
  };

  CoinRush.prototype.celebrate = function () {
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

  /* ------------------------------------------------------------------ *
   * Draw
   * ------------------------------------------------------------------ */
  CoinRush.prototype.draw = function (ctx, now) {
    var layer = ESA.Stage.layer("arena-coin", function (g) {
      ESA.drawArenaLayer(g, { tone: "warm", accent: "#9a7418" });
    });
    ESA.Stage.blit(ctx, layer);

    // Final-stretch atmosphere: a slow gold pulse around the arena edge.
    if (this.timeLeft <= URGENT_AT && this.timeLeft > 0 && this.state === "playing") {
      var pulse = 0.5 + 0.5 * Math.sin(now / 230);
      var a = (0.1 + pulse * 0.16) * (1 - this.timeLeft / URGENT_AT);
      var grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.34, W / 2, H / 2, H * 0.95);
      grad.addColorStop(0, "rgba(243,195,90,0)");
      grad.addColorStop(1, "rgba(243,195,90," + a.toFixed(3) + ")");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    for (var i = 0; i < this.tokens.length; i++) {
      this.drawToken(ctx, this.tokens[i], now);
    }

    if (this.p2) {
      var order = (this.p1.y <= this.p2.y) ? [this.p1, this.p2] : [this.p2, this.p1];
      ESA.drawCharacter(ctx, order[0], now);
      ESA.drawCharacter(ctx, order[1], now);
    } else {
      ESA.drawCharacter(ctx, this.p1, now);
    }

    this.fx.draw(ctx);
  };

  CoinRush.prototype.drawToken = function (ctx, t, now) {
    if (t.collected && t.popT <= 0) return;

    var img = ESA.Assets.get(t.bonus ? "tokenBonus" : "token");
    var size = t.bonus ? BONUS_SIZE : TOKEN_SIZE;
    var bob = Math.sin(t.phase) * (t.bonus ? 6 : 4.5);
    var grow = ESA.easeOutBack(ESA.clamp(t.born, 0, 1));

    // Collected tokens pop outward as they vanish.
    var pop = t.collected ? (1 + (1 - t.popT) * 0.9) : 1;
    var alpha = t.collected ? t.popT : 1;

    var cx = t.x;
    var cy = t.y + bob;

    ctx.save();
    ctx.globalAlpha = alpha;

    /* --- Ground shadow ---------------------------------------------- */
    ctx.save();
    ctx.globalAlpha = alpha * 0.2;
    ctx.fillStyle = "#3a2a10";
    ctx.beginPath();
    ctx.ellipse(t.x, t.y + size * 0.42, size * 0.3 * grow, size * 0.1 * grow, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.translate(cx, cy);
    ctx.scale(grow * pop, grow * pop);

    /* --- Aura -------------------------------------------------------- */
    var glowR = size * (t.bonus ? 1.15 : 0.66);
    var glowA = t.bonus ? 0.6 + Math.sin(now / 190) * 0.16 : 0.2;
    var glow = ctx.createRadialGradient(0, 0, size * 0.2, 0, 0, glowR);
    glow.addColorStop(0, "rgba(255,221,130," + glowA.toFixed(3) + ")");
    glow.addColorStop(0.55, "rgba(243,195,90," + (glowA * 0.45).toFixed(3) + ")");
    glow.addColorStop(1, "rgba(243,195,90,0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, glowR, 0, Math.PI * 2);
    ctx.fill();

    /* --- Bonus-only treatment ---------------------------------------- */
    if (t.bonus) {
      var ringPulse = 1 + Math.sin(now / 220) * 0.06;

      // Two counter-rotating rings read as "rare" at a glance.
      ctx.save();
      ctx.rotate(now / 900);
      ctx.strokeStyle = "rgba(255,246,228,.9)";
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 9]);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.66 * ringPulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.rotate(-now / 1400);
      ctx.strokeStyle = "rgba(243,195,90,.55)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 14]);
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.82 * ringPulse, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // Orbiting sparkles
      for (var s = 0; s < 4; s++) {
        var a = now / 620 + (s / 4) * Math.PI * 2;
        var rr = size * 0.66;
        ctx.fillStyle = "#fff6e4";
        ctx.beginPath();
        ctx.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.55, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    /* --- The emblem, untouched --------------------------------------- */
    if (img) {
      ctx.drawImage(img, -size / 2, -size / 2, size, size);
    } else {
      // Only reached if the branding PNG failed to load; keeps the game playable.
      ctx.fillStyle = "#e5a92f";
      ctx.beginPath();
      ctx.arc(0, 0, size * 0.36, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = "#8e6314";
      ctx.stroke();
    }

    /* --- Value badge on the bonus token ------------------------------ */
    if (t.bonus) {
      var by = size * 0.52;
      ctx.save();
      ESA.roundRect(ctx, -21, by, 42, 19, 9);
      ctx.fillStyle = "rgba(10,26,45,.92)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = "#f3c35a";
      ctx.stroke();
      ctx.fillStyle = "#fdeec4";
      ctx.font = "700 14px " + ESA.FONT_DISPLAY;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("+3", 0, by + 10);
      ctx.restore();
    }

    ctx.restore();
  };

  ESA.CoinRush = CoinRush;

  ESA.Games.register({
    id: "coin",
    title: "Coin Rush",
    tagline: "Sixty seconds. Collect ESA tokens. Golden ones are worth three.",
    description: "ESA tokens drop across the arena. <b>Run over them to collect.</b> " +
                 "A normal token is worth 1. The rare glowing token is worth 3. " +
                 "Most points when the clock hits zero wins.",
    mode: MATCH_SECONDS + " seconds",
    icon: { img: "assets/Branding/Golden Canadian Pharaoh Emblem.png" },
    controls: "arena",
    touch: { movement: "joystick", actions: [], help: ["JOYSTICK — MOVE", "TOKENS — COLLECT AS MANY AS YOU CAN"],
             description: "ESA tokens drop across the arena. <b>Use the joystick to run over them.</b> Gold tokens are worth three. Most tokens in sixty seconds wins." },
    hud: { centerLabel: "Time", centerValue: String(MATCH_SECONDS), pips: 0 },
    accent: "#f3c35a",
    canTie: true,
    tournamentEligible: true,
    // Solo: a one-player Score Attack run (no CPU, no difficulty).
    soloEligible: true,
    soloModeType: "score-attack",
    solo: { mode: MATCH_SECONDS + " seconds",
            blurb: "Sixty seconds. Grab every token you can.", touchBlurb: "Sixty seconds. Grab every token you can.",
            description: "A solo run. ESA tokens drop across the arena - <b>run over them with W A S D</b>. " +
                         "Normal tokens are worth 1, the rare glowing token is worth 3. The floor thins out and " +
                         "tokens land further away as the clock runs down. Beat your session best.",
            touchDescription: "A solo run. ESA tokens drop across the arena - <b>use the joystick to run over them</b>. " +
                              "Gold tokens are worth 3. They get sparser as the clock runs down. Beat your session best." },
    enabled: true,
    create: function (api, setup) { return new CoinRush(api, setup); }
  });

})(window.ESA);
