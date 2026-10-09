/* ==========================================================================
   ESA ARCADE - Bomb Pass
   Touch your opponent to hand off the bomb. First to 3 rounds.

   States: countdown -> playing -> roundEnd -> (countdown | matchEnd)
   Movement and the fuse only advance while state === "playing", which is
   what stops scores changing during a countdown or after the match ends.

   V4.1
   - Every legitimate hand-off adds PASS_BONUS (+1.0 s) to the fuse, capped
     at the round's starting fuse, so cornering someone and passing on the
     last fraction of a second no longer wins for free.
   - One pass = one physical contact: after a hand-off the pair must
     SEPARATE (beyond REARM_DIST) before the bomb can change hands again,
     on top of the short pass cooldown. Staying glued together can't
     trade the bomb (and its +1 s) back and forth.
   - The fuse is visible: a compact ring around the bomb plus a small
     seconds badge, more urgent in the last seconds. Ticking audio stays.
   - OVERTIME: two players trading the bomb every second would refund the
     fuse forever, so once a round has run longer than its starting fuse
     the fuse burns progressively faster (x1 -> x2 over OVERTIME_RAMP s).
     Every pass still adds its full +1 s; the round just can't stall.
   - Movement uses the shared momentum model (ESA.SMOOTH_MOVE): same top
     speed, softer starts / stops and quicker turns.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var W = ESA.W, H = ESA.H;

  var WINS_NEEDED = 3;
  var PLAYER_SPEED = 180;        // was 235 in V1 - deliberately slower
  var TRANSFER_DIST = 76;        // centre-to-centre contact distance
  var TRANSFER_COOLDOWN = 0.9;   // immunity so the bomb cannot ping-pong
  /*
   * The hand-off shove. It used to be 260 px/s (faster than walking) with
   * the shared slow fade, which took the stick away for ~0.33 s after
   * every pass (~50 px of forced slide) - exactly when players want to
   * juke. Now a shorter, snappier shove: each player still clears ~24 px
   * (plus the cooldown above), and steering is back within ~0.17 s.
   * Speed, transfer distance and cooldown are unchanged.
   */
  var PASS_SHOVE = 200;
  var PASS_SHOVE_DECAY = 0.0002;
  var ROUND_START_COOLDOWN = 1.1;
  var FUSE_MIN = 10, FUSE_MAX = 18;
  var PASS_BONUS = 1.0;          // seconds added to the fuse by every real pass
  var REARM_DIST = TRANSFER_DIST + 12;   // must separate this far before the next pass
  var FUSE_URGENT = 3;           // last seconds: the countdown turns red and pulses
  var OVERTIME_RAMP = 8;         // s for the overtime burn to reach x2

  function BombPass(api, setup) {
    this.api = api;
    var who = ESA.describeMatchup(setup);
    this.timers = new ESA.TimerGroup();
    this.fx = new ESA.ParticleField(200);

    var opts = function (facing) {
      return { speed: PLAYER_SPEED, facing: facing, recoilDecay: PASS_SHOVE_DECAY, smooth: ESA.SMOOTH_MOVE };
    };
    this.p1 = ESA.makePlayer(who.p1, 250, 370, opts("right"));
    this.p2 = ESA.makePlayer(who.p2, W - 250, 370, opts("left"));
    this.armed = true;            // false right after a pass, until the pair separates
    this.passFlash = 0;           // +1s badge pop, 0..1

    this.wins = { p1: 0, p2: 0 };
    this.round = 1;
    this.state = "idle";

    this.holder = null;
    this.passCooldown = 0;
    this.showCooldown = false;    // only after a real hand-off, not at round start
    this.fuse = 0;
    this.fuseLeft = 0;
    this.tickAccum = 0;
    this.sparkAccum = 0;
    this.blastT = 0;              // explosion bloom, 0..1
    this.blastX = 0;
    this.blastY = 0;
  }

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */
  BombPass.prototype.start = function () {
    this.wins.p1 = 0;
    this.wins.p2 = 0;
    this.round = 1;
    ESA.UI.setWins("p1", 0);
    ESA.UI.setWins("p2", 0);
    ESA.UI.setCenter("Round", "1", false);
    this.beginRound();
  };

  BombPass.prototype.beginRound = function () {
    var self = this;

    this.p1.x = 250; this.p1.y = 370; this.p1.facing = "right";
    this.p2.x = W - 250; this.p2.y = 370; this.p2.facing = "left";
    this.p1.hurtUntil = 0; this.p2.hurtUntil = 0;
    this.p1.recoilX = this.p1.recoilY = 0;
    this.p2.recoilX = this.p2.recoilY = 0;
    this.p1.vx = this.p1.vy = this.p2.vx = this.p2.vy = 0;

    this.holder = Math.random() < 0.5 ? this.p1 : this.p2;
    this.showCooldown = false;
    this.armed = true;
    this.passFlash = 0;
    this.passCooldown = ROUND_START_COOLDOWN;
    this.fuse = ESA.rand(FUSE_MIN, FUSE_MAX);
    this.fuseLeft = this.fuse;
    this.roundT = 0;
    this.tickAccum = 0;
    this.blastT = 0;
    this.fx.clear();

    this.state = "countdown";
    ESA.UI.setCenter("Round", String(this.round), false);

    ESA.UI.countdown(this.timers, function () {
      // Controls unlock exactly when GO appears.
      if (self.state === "countdown") self.state = "playing";
    });
  };

  BombPass.prototype.destroy = function () {
    this.state = "destroyed";
    this.timers.clear();
    this.fx.clear();
  };

  /* ------------------------------------------------------------------ *
   * Update
   * ------------------------------------------------------------------ */
  BombPass.prototype.update = function (dt, now) {
    this.fx.update(dt);

    if (this.blastT > 0) this.blastT = Math.max(0, this.blastT - dt * 1.6);
    if (this.passFlash > 0) this.passFlash = Math.max(0, this.passFlash - dt * 1.4);

    var canMove = (this.state === "playing");
    ESA.movePlayer(this.p1, dt, ESA.BOUNDS, canMove);
    ESA.movePlayer(this.p2, dt, ESA.BOUNDS, canMove);

    if (this.state !== "playing") return;

    // Keep bodies from fully overlapping so a pass reads clearly.
    ESA.separate(this.p1, this.p2, 56);

    /* --- Hand-off ---------------------------------------------------- */
    this.passCooldown -= dt;
    var d = ESA.dist(this.p1.x, this.p1.y, this.p2.x, this.p2.y);

    // A pass needs a NEW contact: once separated, the next touch counts.
    if (!this.armed && d > REARM_DIST) this.armed = true;
    if (d < TRANSFER_DIST && this.passCooldown <= 0 && this.armed) {
      this.transfer(d);
    }

    /* --- Fuse -------------------------------------------------------- */
    this.roundT += dt;
    this.fuseLeft -= dt * this.burnRate();

    // Ticking speeds up as the fuse burns down, without revealing the time.
    var interval = this.fuseLeft < 2 ? 0.17
                 : this.fuseLeft < 4 ? 0.3
                 : this.fuseLeft < 7 ? 0.52
                 : 0.85;
    this.tickAccum += dt;
    if (this.tickAccum >= interval) {
      this.tickAccum = 0;
      ESA.Audio.play(this.fuseLeft < 4 ? "bombTickHot" : "bombTick");
    }

    // Fuse sparks, emitted proportionally to tension.
    var tension = this.tension();
    this.sparkAccum += dt * (6 + tension * 34);
    while (this.sparkAccum >= 1) {
      this.sparkAccum -= 1;
      var bp = this.bombPos(now);
      this.fx.spawn({
        type: "spark",
        x: bp.x + ESA.rand(-3, 3),
        y: bp.y - 26 + ESA.rand(-3, 3),
        vx: ESA.rand(-55, 55),
        vy: ESA.rand(-90, -24),
        life: ESA.rand(0.22, 0.45),
        size: ESA.rand(2, 3.6),
        color: ESA.chance(0.5) ? "#ffd766" : "#ff9a3c",
        gravity: 170,
        drag: 0.9
      });
    }

    if (this.fuseLeft <= 0) this.explode(now);
  };

  BombPass.prototype.transfer = function (d) {
    this.holder = (this.holder === this.p1) ? this.p2 : this.p1;
    this.passCooldown = TRANSFER_COOLDOWN;
    this.showCooldown = true;
    this.armed = false;           // exactly one pass per contact

    // +1 s for every real pass, never above the round's starting fuse.
    var before = this.fuseLeft;
    this.fuseLeft = Math.min(this.fuse, this.fuseLeft + PASS_BONUS);
    this.passGain = this.fuseLeft - before;
    this.passFlash = 1;
    if (this.fuseLeft >= 4) this.tickAccum = 0;   // the tick tempo relaxes with the fuse

    // Shove both players apart so they are not instantly back in contact.
    var dx = (this.p2.x - this.p1.x) / Math.max(d, 1);
    var dy = (this.p2.y - this.p1.y) / Math.max(d, 1);
    this.p1.recoilX = -dx * PASS_SHOVE; this.p1.recoilY = -dy * PASS_SHOVE;
    this.p2.recoilX = dx * PASS_SHOVE;  this.p2.recoilY = dy * PASS_SHOVE;

    var mx = (this.p1.x + this.p2.x) / 2;
    var my = (this.p1.y + this.p2.y) / 2 - 70;
    this.fx.burst(mx, my, 10, {
      colors: ["#f3c35a", "#fff6e4", "#ff9a3c"],
      speedMin: 70, speedMax: 190, lifeMin: 0.25, lifeMax: 0.5,
      sizeMin: 2, sizeMax: 4.5, gravity: 190
    });
    this.fx.spawn({ type: "ring", x: mx, y: my, size: 10, size2: 56, life: 0.4, color: "#f3c35a" });
    if (this.passGain > 0.05) {
      var bp = this.bombPos(performance.now());
      this.fx.spawn({
        type: "text", x: bp.x + 40, y: bp.y - 24, vx: 0, vy: -40, gravity: 0, drag: 0.97,
        life: 0.8, font: 17, text: "+" + this.passGain.toFixed(this.passGain < 0.95 ? 1 : 0) + "s", color: "#9fe3ff"
      });
    }

    ESA.Audio.play("bombPass");
    ESA.Stage.shake(4);
  };

  BombPass.prototype.explode = function (now) {
    var loser = this.holder;
    var winner = (loser === this.p1) ? this.p2 : this.p1;
    var self = this;

    this.state = "roundEnd";          // guards against a second explosion

    var bp = this.bombPos(now);
    this.blastX = bp.x;
    this.blastY = bp.y;
    this.blastT = 1;

    // Knock the loser away from the blast.
    var away = (loser.x < W / 2) ? -1 : 1;
    ESA.hurt(loser, now, 1900, away * 300, -120);

    ESA.Stage.hitStop(110);
    ESA.Stage.shake(22);
    ESA.Stage.flash(0.72, "#fff3d0");
    ESA.Audio.play("explosion");

    this.fx.burst(bp.x, bp.y - 20, 34, {
      colors: ["#ffd766", "#ff9a3c", "#e8584f", "#fff6e4"],
      speedMin: 110, speedMax: 430, lifeMin: 0.4, lifeMax: 0.95,
      sizeMin: 3, sizeMax: 8, gravity: 420, drag: 0.9
    });
    this.fx.spawn({ type: "ring", x: bp.x, y: bp.y - 20, size: 16, size2: 190, life: 0.55, color: "#fff2c9" });
    this.fx.spawn({ type: "ring", x: bp.x, y: bp.y - 20, size: 10, size2: 130, life: 0.75, color: "#ff9a3c" });
    for (var i = 0; i < 5; i++) {
      this.fx.spawn({
        type: "star", x: loser.x + ESA.rand(-30, 30), y: loser.y - 150 + ESA.rand(-20, 20),
        vx: ESA.rand(-70, 70), vy: ESA.rand(-150, -70),
        life: ESA.rand(0.7, 1.1), size: ESA.rand(8, 13), color: "#ffd766", gravity: 180
      });
    }

    this.wins[winner.slot] += 1;
    var w = this.wins[winner.slot];
    ESA.UI.setWins(winner.slot, w);

    var matchOver = (w >= WINS_NEEDED);

    this.timers.after(620, function () {
      if (self.state !== "roundEnd") return;
      ESA.Audio.play(matchOver ? "matchWin" : "roundWin");
      ESA.UI.banner(
        self.timers,
        matchOver ? "Match Point" : "Round " + self.round,
        winner.name.toUpperCase() + " WINS",
        matchOver ? 900 : 1250,
        function () {
          if (self.state !== "roundEnd") return;
          if (matchOver) {
            self.finishMatch(winner);
          } else {
            self.round += 1;
            self.beginRound();
          }
        }
      );
    });
  };

  BombPass.prototype.finishMatch = function (winner) {
    this.state = "matchEnd";
    var loser = (winner === this.p1) ? this.p2 : this.p1;

    this.celebrate(winner.x, 150);

    this.api.endMatch({
      winner: winner.slot,
      kicker: "Match Over",
      title: winner.name + " Wins",
      text: "Took the match " + this.wins[winner.slot] + "–" +
            this.wins[loser.slot] + ". Nerves of steel.",
      scores: { p1: this.wins.p1, p2: this.wins.p2 }
    });
  };

  BombPass.prototype.celebrate = function (x, y) {
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

  /**
   * What a player can SEE, for a CPU strategy (js/cpu-bombpass.js). Fills a
   * caller-owned object (no per-frame allocation). Who holds the bomb, the
   * PASS COOLDOWN pill and (V4.1) the fuse countdown are all on screen.
   * Never the RNG or the next round's fuse.
   */
  BombPass.prototype.observe = function (slot, v) {
    var me = this[slot], op = this[slot === "p1" ? "p2" : "p1"];
    if (!me) return v;
    v.bounds = ESA.BOUNDS;
    v.live = this.state === "playing";
    v.speed = PLAYER_SPEED;
    v.transferDist = TRANSFER_DIST;
    v.rearmDist = REARM_DIST;
    v.meX = me.x; v.meY = me.y;
    v.opX = op.x; v.opY = op.y;
    v.iHold = this.holder === me;
    v.cooldown = this.showCooldown ? Math.max(0, this.passCooldown) : 0;
    v.armed = this.armed;
    v.fuse = Math.max(0, this.fuseLeft);
    v.tension = this.tension();
    return v;
  };

  /* ------------------------------------------------------------------ *
   * Helpers
   * ------------------------------------------------------------------ */

  /** 1 normally; ramps to 2 once the round outlasts its starting fuse. */
  BombPass.prototype.burnRate = function () {
    var over = this.roundT - this.fuse;
    return over > 0 ? 1 + Math.min(1, over / OVERTIME_RAMP) : 1;
  };

  /** 0 = calm, 1 = about to blow. Drives every escalation cue. */
  BombPass.prototype.tension = function () {
    if (this.fuseLeft > 7) return 0;
    return ESA.clamp(1 - this.fuseLeft / 7, 0, 1);
  };

  BombPass.prototype.bombPos = function (now) {
    var h = this.holder || this.p1;
    var tension = this.tension();
    var bob = Math.sin(now / (260 - tension * 150)) * (4 + tension * 4);
    // Deterministic shiver (the fuse ring reads the same position in a frame).
    var jitter = tension > 0.55 ? Math.sin(now / 17) * 0.5 * tension * 5 : 0;
    return {
      x: h.x + jitter,
      // Clamped so the fuse spark never clips the top of the arena.
      y: Math.max(54, ESA.bodyTop(h) - 22 + bob)
    };
  };

  /* ------------------------------------------------------------------ *
   * Draw
   * ------------------------------------------------------------------ */
  BombPass.prototype.draw = function (ctx, now) {
    var layer = ESA.Stage.layer("arena-bomb", function (g) {
      ESA.drawArenaLayer(g, { tone: "warm", accent: "#8e4a2a" });
    });
    ESA.Stage.blit(ctx, layer);

    var tension = this.tension();

    // Danger wash creeping in from the edges as the fuse burns down.
    if (tension > 0.05 && this.state === "playing") {
      var pulse = 0.5 + 0.5 * Math.sin(now / (300 - tension * 190));
      var a = tension * tension * 0.42 * (0.55 + pulse * 0.45);
      var grad = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.95);
      grad.addColorStop(0, "rgba(232,88,79,0)");
      grad.addColorStop(1, "rgba(200,40,34," + a.toFixed(3) + ")");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
    }

    // Draw the character further back first so overlaps read correctly.
    var order = (this.p1.y <= this.p2.y) ? [this.p1, this.p2] : [this.p2, this.p1];
    ESA.drawCharacter(ctx, order[0], now);
    ESA.drawCharacter(ctx, order[1], now);

    if (this.state === "playing" || this.state === "countdown") {
      this.drawBomb(ctx, now, tension);
      this.drawFuse(ctx, now);
    }

    if (this.blastT > 0) this.drawBlast(ctx);

    this.fx.draw(ctx);

    // Cooldown pill, so players understand why a touch did nothing.
    if (this.showCooldown && this.passCooldown > 0 && this.state === "playing") {
      var t = this.passCooldown / TRANSFER_COOLDOWN;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t * 2.2);
      ESA.roundRect(ctx, W / 2 - 86, H - 46, 172, 28, 14);
      ctx.fillStyle = "rgba(7,23,40,.82)";
      ctx.fill();
      ctx.strokeStyle = "rgba(243,195,90,.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Drain bar
      ESA.roundRect(ctx, W / 2 - 80, H - 25, 160 * t, 3, 2);
      ctx.fillStyle = "#f3c35a";
      ctx.fill();
      ctx.fillStyle = "#fdeec4";
      ctx.font = "700 12px " + ESA.FONT_DISPLAY;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.letterSpacing = "2px";
      ctx.fillText("PASS COOLDOWN", W / 2, H - 34);
      ctx.restore();
    }
  };

  /** Hand-drawn cartoon bomb. Scales its menace with `tension`. */
  BombPass.prototype.drawBomb = function (ctx, now, tension) {
    var p = this.bombPos(now);
    var pulse = 1 + Math.sin(now / (230 - tension * 160)) * (0.06 + tension * 0.11);
    var r = 20;

    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.scale(pulse, pulse);

    // Heat glow
    if (tension > 0.02) {
      var glow = ctx.createRadialGradient(0, 0, r * 0.6, 0, 0, r * (2.6 + tension));
      glow.addColorStop(0, "rgba(255,150,60," + (0.34 * tension).toFixed(3) + ")");
      glow.addColorStop(1, "rgba(255,120,40,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(0, 0, r * (2.6 + tension), 0, Math.PI * 2);
      ctx.fill();
    }

    // Fuse cord
    ctx.strokeStyle = "#8e6314";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(6, -r + 2);
    ctx.quadraticCurveTo(20, -r - 12, 13, -r - 25);
    ctx.stroke();

    // Fuse spark
    var sparkR = 4 + tension * 3 + Math.sin(now / 55) * 1.6;
    ctx.fillStyle = "#fff0b8";
    ctx.beginPath(); ctx.arc(13, -r - 26, sparkR, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,170,60,.55)";
    ctx.beginPath(); ctx.arc(13, -r - 26, sparkR * 2.1, 0, Math.PI * 2); ctx.fill();

    // Cap
    ctx.fillStyle = "#3a2d1c";
    ESA.roundRect(ctx, -3, -r - 6, 14, 10, 3);
    ctx.fill();

    // Body
    var body = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.15, 0, 0, r * 1.15);
    body.addColorStop(0, "#4a5a70");
    body.addColorStop(0.45, "#1d2a3c");
    body.addColorStop(1, "#0c131f");
    ctx.fillStyle = body;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

    // Gold band - the ESA touch
    ctx.strokeStyle = "rgba(243,195,90," + (0.5 + tension * 0.5).toFixed(2) + ")";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(0, 2, r * 0.92, r * 0.3, 0, 0, Math.PI * 2);
    ctx.stroke();

    // Specular highlight
    ctx.fillStyle = "rgba(255,255,255,.35)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.36, -r * 0.42, r * 0.26, r * 0.17, -0.6, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  };

  /**
   * The visible fuse: a thin ring around the bomb that drains clockwise,
   * plus a compact seconds badge beside it. Calm gold, warming to orange,
   * then red with a gentle pulse in the last FUSE_URGENT seconds. Small on
   * purpose - it rides with the bomb and never covers the arena.
   */
  BombPass.prototype.drawFuse = function (ctx, now) {
    var left = Math.max(0, this.fuseLeft);
    var frac = this.fuse > 0 ? ESA.clamp(left / this.fuse, 0, 1) : 0;
    var p = this.bombPos(now);
    var urgent = left <= FUSE_URGENT && this.state === "playing";
    var col = urgent ? "#ff4d4d" : left <= 6 ? "#ff9a3c" : "#f3c35a";
    var pulse = urgent ? 0.5 + 0.5 * Math.sin(now / 90) : 0;
    var R = 31;

    ctx.save();
    ctx.lineCap = "round";
    // Track
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = "rgba(7,23,40,.85)";
    ctx.lineWidth = 5;
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2); ctx.stroke();
    // Remaining fuse
    ctx.globalAlpha = 0.95;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3 + pulse * 1.2;
    ctx.beginPath();
    ctx.arc(p.x, p.y, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();

    // Seconds badge: whole seconds while calm, tenths when it matters.
    var txt = left < FUSE_URGENT ? left.toFixed(1) : String(Math.ceil(left));
    var bx = p.x + R + 8, by = p.y + 2;
    if (bx + 40 > W - 8) bx = p.x - R - 48;           // keep it on screen near the right wall
    var pop = 1 + this.passFlash * 0.25;
    ctx.translate(bx + 20, by);
    ctx.scale(pop, pop);
    ctx.globalAlpha = 0.92;
    ESA.roundRect(ctx, -20, -11, 40, 22, 11);
    ctx.fillStyle = urgent ? "rgba(60,6,10,.9)" : "rgba(7,23,40,.86)";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = this.passFlash > 0.05 ? "#9fe3ff" : col;
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = urgent ? "#ffd0cc" : "#fff6e4";
    ctx.font = "800 13px " + ESA.FONT_DISPLAY;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(txt + "s", 0, 1);
    if (this.burnRate() > 1.01) {
      ctx.font = "800 8px " + ESA.FONT_DISPLAY;
      ctx.letterSpacing = "1.5px";
      ctx.fillStyle = "#ff9a3c";
      ctx.fillText("OVERTIME", 0, 19);
    }
    ctx.restore();
  };

  /** Expanding fireball left behind at the moment of the blast. */
  BombPass.prototype.drawBlast = function (ctx) {
    var t = 1 - this.blastT;                 // 0 -> 1
    var r = 26 + ESA.easeOut(t) * 180;
    ctx.save();
    ctx.globalAlpha = this.blastT * 0.85;
    var g = ctx.createRadialGradient(this.blastX, this.blastY - 20, 0, this.blastX, this.blastY - 20, r);
    g.addColorStop(0, "rgba(255,255,230,.95)");
    g.addColorStop(0.35, "rgba(255,190,80,.8)");
    g.addColorStop(0.7, "rgba(232,88,79,.45)");
    g.addColorStop(1, "rgba(232,88,79,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(this.blastX, this.blastY - 20, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  ESA.BombPass = BombPass;

  ESA.Games.register({
    id: "bomb",
    title: "Bomb Pass",
    tagline: "Holding it? Chase. Not holding it? Run. Every pass buys a second.",
    description: "One of you is holding a live bomb. <b>Touch your opponent to pass it.</b> " +
                 "Every pass adds <b>+1 second</b> to the fuse. Don't be the one holding it when it blows.",
    mode: "First to " + WINS_NEEDED + " rounds",
    icon: { symbol: "#icoBomb" },
    controls: "arena",
    touch: { movement: "joystick", actions: [], help: ["JOYSTICK — MOVE", "GET CLOSE — TAG THE BOMB ONTO YOUR RIVAL"],
             description: "One of you is holding a live bomb. <b>Steer into your opponent to pass it</b> — no button needed. Every pass adds <b>+1 second</b> to the fuse. Watch the ring." },
    hud: { centerLabel: "Round", centerValue: "1", pips: WINS_NEEDED },
    accent: "#e8584f",
    canTie: false,
    tournamentEligible: true,
    // Solo vs CPU: same rules, first to 3 (strategy in js/cpu-bombpass.js).
    soloEligible: true,
    soloModeType: "cpu-versus",
    solo: { blurb: "First to 3 rounds vs the CPU. Tag it, or run.", touchBlurb: "First to 3 rounds vs the CPU. Tag it, or run.",
            description: "One of you is holding a live bomb. <b>Touch the CPU to pass it</b> - no button, just get close. " +
                         "Move with <b>W A S D</b>. Every pass adds <b>+1 second</b> to the fuse - watch the ring. Don't be the one holding it." },
    enabled: true,
    create: function (api, setup) { return new BombPass(api, setup); }
  });

})(window.ESA);
