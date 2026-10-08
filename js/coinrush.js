/* ==========================================================================
   ESA ARCADE - Coin Rush
   Sixty seconds of collecting ESA tokens. The collectible is the official
   emblem (assets/Branding/Golden Canadian Pharaoh Emblem.png), pre-rendered
   once at two sizes so the 1254px source is never rescaled per frame.

   Normal token = +1. Rare bonus token = +3, distinguished only by the
   effects around it - the emblem artwork itself is never altered.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var W = ESA.W, H = ESA.H;

  var MATCH_SECONDS = 60;
  var PLAYER_SPEED = 185;        // was 240 in V1
  var TOKEN_COUNT = 7;
  var PICKUP_RADIUS = 44;
  var TOKEN_SIZE = 46;
  var BONUS_SIZE = 62;
  var MIN_FROM_PLAYER = 155;     // never drop a token in someone's lap
  var MIN_FROM_TOKEN = 112;
  var BONUS_CHANCE = 0.14;
  var URGENT_AT = 10;

  /** Inset so a token is always fully reachable, never under the frame. */
  function spawnArea() {
    var b = ESA.BOUNDS;
    return { left: b.left + 16, right: b.right - 16, top: b.top + 8, bottom: b.bottom - 14 };
  }

  function CoinRush(api) {
    this.api = api;
    this.timers = new ESA.TimerGroup();
    this.fx = new ESA.ParticleField(220);

    this.p1 = ESA.makePlayer("zima", 230, 370, { speed: PLAYER_SPEED, facing: "right" });
    this.p2 = ESA.makePlayer("shaza", W - 230, 370, { speed: PLAYER_SPEED, facing: "left" });

    this.score = { zima: 0, shaza: 0 };
    this.timeLeft = MATCH_SECONDS;
    this.state = "idle";
    this.tokens = [];
    this.bonusActive = false;
    this.lastShownSecond = -1;
  }

  CoinRush.meta = {
    id: "coin",
    title: "Coin Rush",
    mode: "60 seconds",
    rules: "ESA tokens drop across the arena. <b>Run over them to collect.</b> " +
           "A normal token is worth 1. The rare glowing token is worth 3. " +
           "Most points when the clock hits zero wins.",
    hud: { centerLabel: "Time", centerValue: "60", pips: 0 },
    controls: "arena"
  };

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */
  CoinRush.prototype.start = function () {
    var self = this;

    // Pre-render the emblem at both token sizes (device-pixel aware).
    var q = Math.min(window.devicePixelRatio || 1, 2) * 2;
    ESA.Assets.prerender("token", "emblem", Math.round(TOKEN_SIZE * q));
    ESA.Assets.prerender("tokenBonus", "emblem", Math.round(BONUS_SIZE * q));

    this.score.zima = 0;
    this.score.shaza = 0;
    this.timeLeft = MATCH_SECONDS;
    this.lastShownSecond = -1;
    this.bonusActive = false;
    this.fx.clear();

    this.p1.x = 230; this.p1.y = 370; this.p1.facing = "right";
    this.p2.x = W - 230; this.p2.y = 370; this.p2.facing = "left";
    this.p1.recoilX = this.p1.recoilY = this.p2.recoilX = this.p2.recoilY = 0;

    this.tokens = [];
    for (var i = 0; i < TOKEN_COUNT; i++) {
      this.tokens.push(this.makeToken(false));
    }

    ESA.UI.setScore("zima", 0);
    ESA.UI.setScore("shaza", 0);
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
  CoinRush.prototype.findSpot = function () {
    var area = spawnArea();
    var best = null, bestScore = -1;

    for (var attempt = 0; attempt < 40; attempt++) {
      var x = ESA.rand(area.left, area.right);
      var y = ESA.rand(area.top, area.bottom);

      var dp = Math.min(
        ESA.dist(x, y, this.p1.x, this.p1.y),
        ESA.dist(x, y, this.p2.x, this.p2.y)
      );
      var dt = Infinity;
      for (var i = 0; i < this.tokens.length; i++) {
        var t = this.tokens[i];
        if (!t || t.collected) continue;
        dt = Math.min(dt, ESA.dist(x, y, t.x, t.y));
      }

      if (dp >= MIN_FROM_PLAYER && dt >= MIN_FROM_TOKEN) {
        return { x: x, y: y };
      }

      // Score candidates so the fallback is still a reasonable spot.
      var score = Math.min(dp / MIN_FROM_PLAYER, 1) + Math.min(dt / MIN_FROM_TOKEN, 1);
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
    var id = player.character.id;
    this.score[id] += value;
    ESA.UI.setScore(id, this.score[id]);

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
    ESA.movePlayer(this.p2, dt, ESA.BOUNDS, canMove);

    // Tokens keep breathing during the countdown so the arena feels alive.
    for (var i = 0; i < this.tokens.length; i++) {
      var t = this.tokens[i];
      t.phase += dt * 2.2;
      if (t.born < 1) t.born = Math.min(1, t.born + dt * 4.2);
      if (t.popT > 0) t.popT = Math.max(0, t.popT - dt * 5);

      if (t.collected) {
        t.respawnIn -= dt;
        if (t.respawnIn <= 0 && this.state === "playing") {
          this.tokens[i] = this.makeToken(true);
        }
        continue;
      }

      if (this.state !== "playing") continue;

      // Closest player wins a contested token; collect() is idempotent.
      var d1 = ESA.dist(this.p1.x, this.p1.y, t.x, t.y);
      var d2 = ESA.dist(this.p2.x, this.p2.y, t.x, t.y);
      if (d1 < PICKUP_RADIUS || d2 < PICKUP_RADIUS) {
        this.collect(d1 <= d2 ? this.p1 : this.p2, t);
      }
    }

    if (this.state !== "playing") return;

    ESA.separate(this.p1, this.p2, 50);

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

    var z = this.score.zima, s = this.score.shaza;
    var winnerId = z === s ? null : (z > s ? "zima" : "shaza");

    if (winnerId) {
      var name = ESA.characters[winnerId].name;
      var margin = Math.abs(z - s);
      ESA.Audio.play("matchWin");
      this.celebrate();
      this.api.endMatch({
        winnerId: winnerId,
        kicker: "Time",
        title: name + " Wins",
        text: margin === 1
          ? "Won it by a single token. Brutal."
          : "Collected " + margin + " more tokens over sixty seconds.",
        zima: z, shaza: s
      });
    } else {
      ESA.Audio.play("draw");
      this.api.endMatch({
        winnerId: null,
        kicker: "Time",
        title: "Dead Heat",
        text: "Identical scores. Nobody gets bragging rights.",
        zima: z, shaza: s
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

    var order = (this.p1.y <= this.p2.y) ? [this.p1, this.p2] : [this.p2, this.p1];
    ESA.drawCharacter(ctx, order[0], now);
    ESA.drawCharacter(ctx, order[1], now);

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

})(window.ESA);
