/* ==========================================================================
   ESA ARCADE - Air Hockey
   The characters ARE the mallets. Each player owns one half of the table;
   first to the target score wins (Casual 5, Tournament 3 - read from the
   match context, same implementation for both).

   States: countdown -> playing -> goal -> (countdown | matchEnd)
   Only "playing" accepts input, scores goals or collects pickups.

   Timing: everything gameplay-related runs on clocks that only advance
   inside update(): this.clock (dashes, hurt sprites) and the shared
   power-up session (pickups, stun / shrink / reverse, cameo). Pausing the
   game or tearing it down therefore freezes / stops all of it with no
   timers to chase.

   Power-ups come from the shared ESA.PowerUps session (js/powerups.js);
   this file only supplies player adapters and reads isStunned /
   isReversed / colliderScale / visualScale. The only TimerGroup use is the shared countdown and goal banner,
   and every callback re-checks state + generation before acting.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var W = ESA.W, H = ESA.H;
  var TAU = Math.PI * 2;

  /* --- Match length ------------------------------------------------- */
  var TARGETS = { casual: 5, tournament: 3 };
  function targetFor(context) {
    return (context && context.mode === "tournament") ? TARGETS.tournament : TARGETS.casual;
  }
  // Tournament matches also have a hard clock (live play only). Casual: none.
  var TOURNAMENT_SECONDS = 90;
  function timeLimitFor(context) {
    return (context && context.mode === "tournament") ? TOURNAMENT_SECONDS : 0;
  }
  function clockText(sec) {
    var s = Math.max(0, Math.ceil(sec));
    return Math.floor(s / 60) + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
  }

  /* --- Table geometry (logical 960x540) ----------------------------- */
  var RINK = { left: 74, right: 886, top: 60, bottom: 480 };
  var CX = (RINK.left + RINK.right) / 2;
  var CY = (RINK.top + RINK.bottom) / 2;
  var GOAL_HALF = 74;                       // goal mouth half-height
  var MOUTH_TOP = CY - GOAL_HALF, MOUTH_BOT = CY + GOAL_HALF;
  var POCKET = 46;                          // goal pocket depth (> puck diameter)

  /* --- Characters-as-mallets ---------------------------------------- */
  // One collider for EVERYONE. Visual sprite size is separate and never
  // affects reach, so wide artwork is not a mechanical advantage.
  var MALLET_R = 30;
  var SPRITE_H = 84;                        // standard display height
  var SPRITE_MAX_W = 72;                    // very wide art is scaled down to fit
  var MOVE_SPEED = 290;
  /*
   * Mallet response (per second, exponential approach - frame-rate
   * independent). One shared rate used to drive start, stop, turns AND
   * reversals (it was 11/s, ~0.21 s to 90% for everything), which is what
   * testers felt as stiffness. Each is now tuned on its own:
   *   ACCEL     speeding up along the stick direction     ~0.11 s to 90%
   *   OVERSPEED shedding speed above the target (dash end) ~0.09 s
   *   REVERSE   velocity pointing AGAINST the stick       ~0.08 s
   *   TURN      sideways velocity when the stick turns    ~0.09 s
   *   BRAKE     stick released                            ~0.13 s to 10%
   * Top speed (MOVE_SPEED) and the dash are unchanged: this is response,
   * not a speed buff. A little glide remains, so it never teleports.
   */
  var ACCEL = 21, OVERSPEED = 26, REVERSE = 30, TURN = 26, BRAKE = 18;
  var DASH_SPEED = 600;
  var DASH_TIME = 0.16;                     // seconds of burst
  var DASH_COOLDOWN = 1.7;
  var DASH_HIT_WINDOW = 0.26;               // a hit this soon after a dash counts as a dash hit

  /* --- Puck -------------------------------------------------------- */
  var PUCK_R = 15;
  var PUCK_MAX = 980;
  var PUCK_DRAG = 0.9;                      // fraction of speed kept per second
  var WALL_E = 0.9;                         // wall restitution
  var MALLET_E = 0.9;                       // mallet restitution
  var MALLET_CARRY = 0.3;                   // how much sideways mallet motion steers the puck
  var DASH_HIT_BONUS = 1.15;
  var STUCK_SPEED = 18, STUCK_TIME = 5;     // failsafe nudge for a dead puck

  /* --- Power-ups (shared system, js/powerups.js) -------------------- */
  var POWER_UPS = { enabled: true, types: ["smack", "garaEhYaAmr", "shrink", "reverse"] };
  var PICKUP_JITTER_X = 12;                 // pickups stay reachable by both players

  /**
   * Per-player match modifiers. All neutral today; a future comeback /
   * handicap system can change these without touching the physics.
   */
  function neutralMods() { return { speed: 1, dashCooldown: 1, radius: 1 }; }

  /** Read-only table facts for CPU strategies (the same numbers as above). */
  var GEO = Object.freeze({
    left: RINK.left, right: RINK.right, top: RINK.top, bottom: RINK.bottom,
    cx: CX, cy: CY, mouthTop: MOUTH_TOP, mouthBot: MOUTH_BOT, goalHalf: GOAL_HALF,
    malletR: MALLET_R, puckR: PUCK_R, puckDrag: PUCK_DRAG, wallE: WALL_E,
    moveSpeed: MOVE_SPEED, dashSpeed: DASH_SPEED, dashTime: DASH_TIME
  });

  /* ================================================================== */
  function AirHockey(api, setup) {
    this.api = api;
    this.target = targetFor(api && api.context);
    this.timeLimit = timeLimitFor(api && api.context);   // seconds, 0 = untimed
    this.timeLeft = this.timeLimit;
    this.shownTime = null;
    this.suddenDeath = false;
    this.timers = new ESA.TimerGroup();     // paused/resumed by app.js
    this.fx = new ESA.ParticleField(160);
    this.gen = 0;                           // bumps on destroy; stale callbacks bail
    this.clock = 0;                         // ms of simulated play

    var who = ESA.describeMatchup(setup);
    // Optional disc labels from the match context (Solo: YOU / CPU).
    this.tags = (api && api.context && api.context.slotTags) || null;
    this.mods = { p1: neutralMods(), p2: neutralMods() };
    this.p1 = this.makeMallet(who.p1, "right");
    this.p2 = this.makeMallet(who.p2, "left");

    this.puck = { x: CX, y: CY, vx: 0, vy: 0, trail: [] };
    this.scores = { p1: 0, p2: 0 };
    this.state = "idle";
    this.reported = false;
    this.slowTime = 0;
    this.lastHitSound = 0;
    this.lastWallSound = 0;
    this.goalFlash = { left: 0, right: 0 };

    var self = this;
    // Optional: null when power-ups are disabled, and the game plays as normal.
    this.powerUps = ESA.PowerUps ? ESA.PowerUps.createSession(POWER_UPS, {
      players: { p1: this.adapter(this.p1), p2: this.adapter(this.p2) },
      spawn: {
        minDelay: 15, maxDelay: 22, lifetime: 10, radius: 17,
        // Near the centre line (small jitter) so both players reach it
        // equally - neither half gets a free power-up.
        findSpot: function () {
          return { x: CX + ESA.rand(-PICKUP_JITTER_X, PICKUP_JITTER_X), y: ESA.rand(RINK.top + 50, RINK.bottom - 50) };
        },
        isClear: function (x, y, r) {
          return ESA.dist(x, y, self.p1.x, self.p1.y) > self.p1.r + r + 70 &&
                 ESA.dist(x, y, self.p2.x, self.p2.y) > self.p2.r + r + 70 &&
                 ESA.dist(x, y, self.puck.x, self.puck.y) > PUCK_R + r + 30;
        }
      },
      // Status pills live in the cabinet frame above the rink, one per side.
      statusAnchors: { p1: { x: RINK.left - 4, y: 34, align: "left" }, p2: { x: RINK.right + 4, y: 34, align: "right" } },
      crowdY: H - 30
    }) : null;
  }

  /**
   * Player adapter for the shared power-up session. Everything Air Hockey
   * specific (game clock, collider radius, clamping) stays in here.
   */
  AirHockey.prototype.adapter = function (p) {
    var self = this;
    return {
      id: p.character.baseId || p.character.id,   // base roster id: Evil Zima excludes Zima cameos
      color: p.color,
      getAnchor: function () {
        var h = p.spriteH * self.visualScale(p);
        return { x: p.x, y: p.y, top: p.y - h * 0.5 };
      },
      getReach: function () { return p.r; },
      showHurtSprite: function (ms) {
        p.hurtFor = ms + 400;
        p.hurtUntil = self.clock + ms + 400;     // ended explicitly by restoreNormalSprite
      },
      restoreNormalSprite: function () {
        if (p.hurtUntil > self.clock) { p.hurtFor = 220; p.hurtUntil = self.clock + 110; }
      },
      nudge: function (dx, dy) { p.vx = dx; p.vy = dy || 0; p.dashT = 0; },
      onStatusChange: function (kind) {
        if (kind === "stunned") p.dashT = 0;
        if (kind === "shrunk") self.applyRadius(p);
      }
    };
  };

  /* --- Power-up queries (all safe without a session) ------------------ */
  AirHockey.prototype.isStunned = function (p) { return !!this.powerUps && this.powerUps.isStunned(p.slot); };
  AirHockey.prototype.isReversed = function (p) { return !!this.powerUps && this.powerUps.isReversed(p.slot); };
  AirHockey.prototype.visualScale = function (p) { return this.powerUps ? this.powerUps.visualScale(p.slot) : 1; };

  /**
   * The REAL collider: base radius x match modifier x shrink. Re-clamps so
   * a radius change can never embed a player in a wall or across the line.
   */
  AirHockey.prototype.applyRadius = function (p) {
    var scale = this.powerUps ? this.powerUps.colliderScale(p.slot) : 1;
    p.r = MALLET_R * this.mods[p.slot].radius * scale;
    this.clampToHalf(p);
  };

  AirHockey.prototype.makeMallet = function (who, facing) {
    var p = ESA.makePlayer(who, 0, 0, { facing: facing, speed: MOVE_SPEED });
    var mods = this.mods[who.slot];
    p.r = MALLET_R * mods.radius;
    // Standard display size: same height for all, wide art shrunk to fit.
    var natural = ESA.spriteSize(p.character.id, false, SPRITE_H);
    p.spriteH = natural.w > SPRITE_MAX_W ? SPRITE_H * (SPRITE_MAX_W / natural.w) : SPRITE_H;
    p.vx = 0; p.vy = 0;           // steered velocity
    p.mvx = 0; p.mvy = 0;         // actual displacement velocity (after clamps)
    p.dirX = facing === "right" ? 1 : -1; p.dirY = 0;
    p.dashT = 0; p.dashCd = 0; p.lastDashAt = -1e9;
    p.cheerUntil = 0;
    return p;
  };

  /* ------------------------------------------------------------------ *
   * Lifecycle
   * ------------------------------------------------------------------ */
  AirHockey.prototype.start = function () {
    this.scores.p1 = 0;
    this.scores.p2 = 0;
    ESA.UI.setScore("p1", 0);
    ESA.UI.setScore("p2", 0);
    this.timeLeft = this.timeLimit;
    this.suddenDeath = false;
    this.shownTime = null;
    this.updateClock();
    if (this.powerUps) this.powerUps.stop();
    this.resetRound(null);
  };

  /** Puts everyone back for a faceoff. `serveTo` gets the puck on their side. */
  AirHockey.prototype.resetRound = function (serveTo) {
    var self = this;
    var gen = this.gen;
    var now = this.clock;

    // Normal size, controls and sprites for every faceoff.
    if (this.powerUps) this.powerUps.resetRound();
    this.placeMallet(this.p1, RINK.left + 120, CY);
    this.placeMallet(this.p2, RINK.right - 120, CY);
    [this.p1, this.p2].forEach(function (p) {
      // Fade back to the normal sprite instead of popping.
      if (p.hurtUntil > now) { p.hurtFor = 220; p.hurtUntil = now + 110; }
      p.cheerUntil = 0;
      self.applyRadius(p);
    });

    var px = serveTo === "p1" ? CX - 130 : serveTo === "p2" ? CX + 130 : CX;
    this.puck.x = px; this.puck.y = CY; this.puck.vx = 0; this.puck.vy = 0;
    this.puck.trail.length = 0;
    this.slowTime = 0;
    ESA.Input.clear();

    this.state = "countdown";
    ESA.UI.countdown(this.timers, function () {
      if (gen !== self.gen || self.state !== "countdown") return;
      self.state = "playing";
      // The session never spawns straight off a kickoff - and never again
      // once sudden death has started.
      if (self.powerUps && !self.suddenDeath) self.powerUps.startSpawning();
    });
  };

  AirHockey.prototype.placeMallet = function (p, x, y) {
    p.x = x; p.y = y; p.spawnX = x; p.spawnY = y;
    p.vx = p.vy = p.mvx = p.mvy = 0;
    p.dashT = 0; p.dashCd = 0; p.lastDashAt = -1e9;
    p.moving = false;
    p.dirX = p.slot === "p1" ? 1 : -1; p.dirY = 0;
  };

  AirHockey.prototype.destroy = function () {
    this.state = "destroyed";
    this.gen++;
    this.timers.clear();
    this.fx.clear();
    if (this.powerUps) this.powerUps.destroy();
    this.puck.trail.length = 0;
    ESA.Input.clear();
  };

  /* ------------------------------------------------------------------ *
   * Input
   * ------------------------------------------------------------------ */
  /**
   * Keyboard: Space (P1) / Enter (P2) are each slot's action1. Routed
   * through ESA.Controls like every other source, so a slot owned by
   * someone else (a Solo CPU) ignores the key.
   */
  AirHockey.prototype.onKeyDown = function (code) {
    if (code === ESA.CONTROLS.p1.action) ESA.Controls.fireAction("p1", "action1", "keyboard");
    else if (code === ESA.CONTROLS.p2.action || code === "NumpadEnter") ESA.Controls.fireAction("p2", "action1", "keyboard");
  };

  /** Any source (keyboard, touch DASH button, CPU). */
  AirHockey.prototype.onAction = function (slot, action) {
    if (this.state !== "playing" || action !== "action1") return;
    if (slot === "p1" || slot === "p2") this.dash(this[slot]);
  };

  /**
   * What a player can SEE, for a CPU strategy (js/cpu-airhockey.js). Fills
   * a caller-owned object (no per-frame allocation). Deliberately excludes
   * anything hidden: no RNG, no spawn timer, no future puck state - and no
   * REVERSE flag, so a CPU can't quietly pre-invert its stick.
   */
  AirHockey.prototype.observe = function (slot, v) {
    var me = this[slot], op = this[slot === "p1" ? "p2" : "p1"];
    if (!me) return v;
    var pk = this.puck;
    var a = this.powerUps && this.powerUps.spawner && this.powerUps.spawner.active;
    v.geo = GEO;
    v.live = this.state === "playing";
    v.side = slot === "p1" ? -1 : 1;           // -1: defends the left goal, +1: the right
    v.meX = me.x; v.meY = me.y; v.meR = me.r;
    v.meVX = me.mvx; v.meVY = me.mvy;
    v.dashReady = me.dashCd <= 0;
    v.stunned = this.isStunned(me);
    v.opX = op.x; v.opY = op.y; v.opR = op.r;
    v.puckX = pk.x; v.puckY = pk.y; v.puckVX = pk.vx; v.puckVY = pk.vy;
    v.hasPickup = !!a;
    v.pickupX = a ? a.x : 0; v.pickupY = a ? a.y : 0;
    return v;
  };

  /** Lets the touch overlay dim a stunned player's controls. */
  AirHockey.prototype.touchState = function (slot) {
    var p = this[slot];
    return { disabled: !!p && this.isStunned(p) };
  };

  /**
   * Movement intent from ESA.Controls (keyboard = the old normalized digital
   * vector; touch joystick = analog, length <= 1). REVERSE flips the
   * resulting vector - never the keys or the on-screen joystick.
   */
  AirHockey.prototype.inputDir = function (p) {
    var v = ESA.Controls.vector(p.slot);
    var dx = v.x, dy = v.y;
    if (this.isReversed(p)) { dx = -dx; dy = -dy; }
    return (dx || dy) ? { x: dx, y: dy } : null;
  };

  AirHockey.prototype.dash = function (p) {
    if (p.dashCd > 0 || this.isStunned(p)) return;
    var d = this.inputDir(p) || { x: p.dirX, y: p.dirY };
    var dl = Math.hypot(d.x, d.y) || 1;          // dash is always full strength
    p.vx = d.x / dl * DASH_SPEED;
    p.vy = d.y / dl * DASH_SPEED;
    p.dashT = DASH_TIME;
    p.dashCd = DASH_COOLDOWN * this.mods[p.slot].dashCooldown;
    p.lastDashAt = this.clock;
    ESA.Audio.play("whoosh");
    this.fx.spawn({ type: "ring", x: p.x, y: p.y, size: p.r * 0.8, size2: p.r * 1.9, life: 0.3, color: p.color });
  };

  /* ------------------------------------------------------------------ *
   * Update
   * ------------------------------------------------------------------ */
  AirHockey.prototype.update = function (dt) {
    if (this.state === "destroyed" || this.state === "idle") return;
    this.clock += dt * 1000;

    this.fx.update(dt);
    this.goalFlash.left = Math.max(0, this.goalFlash.left - dt * 0.9);
    this.goalFlash.right = Math.max(0, this.goalFlash.right - dt * 0.9);

    var playing = this.state === "playing";
    this.steer(this.p1, dt, playing);
    this.steer(this.p2, dt, playing);

    if (playing || this.state === "goal") this.stepPuck(dt);

    // Tournament clock: ticks only during live play. A goal scored this
    // frame has already moved the state on, so goal and clock can never
    // both decide the match.
    if (this.state === "playing" && this.timeLimit && !this.suddenDeath) {
      this.timeLeft = Math.max(0, this.timeLeft - dt);
      this.updateClock();
      if (this.timeLeft <= 0) this.timeUp();
    }

    // Status timers, cameo, pickups. Collection only while still playing,
    // so a goal scored this frame always wins over a pickup.
    if (this.powerUps) this.powerUps.update(dt, this.state === "playing");

    if (this.state === "playing") this.updateStuck(dt);

    // Puck trail for readability at speed.
    var t = this.puck.trail;
    t.push(this.puck.x, this.puck.y);
    if (t.length > 12) t.splice(0, 2);
  };

  /** Smooth, slightly weighty 8-way steering, clamped to the player's own half. */
  AirHockey.prototype.steer = function (p, dt, enabled) {
    var stunned = this.isStunned(p);
    var dir = (enabled && !stunned) ? this.inputDir(p) : null;
    // Track the (possibly animating) shrink collider; speeds are untouched.
    this.applyRadius(p);
    var maxSp = MOVE_SPEED * this.mods[p.slot].speed;

    if (stunned) p.dashT = 0;
    if (dir) { var dl = Math.hypot(dir.x, dir.y); p.dirX = dir.x / dl; p.dirY = dir.y / dl; }
    p.moving = !!dir;

    if (p.dashT > 0) {
      p.dashT -= dt;                         // burst holds its velocity
    } else if (dir) {
      // Split velocity into ALONG the stick and SIDEWAYS to it, and steer
      // each at its own rate: old momentum stops fighting a new direction
      // almost at once, while speeding up keeps a touch of weight.
      var mag = Math.min(1, Math.hypot(dir.x, dir.y));   // analog stick: partial = slower
      var ux = p.dirX, uy = p.dirY;
      var along = p.vx * ux + p.vy * uy;
      var sx = p.vx - along * ux, sy = p.vy - along * uy;
      var target = mag * maxSp;
      var rate = along < 0 ? REVERSE : along > target ? OVERSPEED : ACCEL;
      along += (target - along) * (1 - Math.exp(-rate * dt));
      var keepSide = Math.exp(-TURN * dt);
      p.vx = along * ux + sx * keepSide;
      p.vy = along * uy + sy * keepSide;
    } else {
      var keep = Math.exp(-BRAKE * dt);      // controlled stop, tiny glide
      p.vx *= keep;
      p.vy *= keep;
      if (Math.abs(p.vx) < 4) p.vx = 0;
      if (Math.abs(p.vy) < 4) p.vy = 0;
    }
    p.dashCd = Math.max(0, p.dashCd - dt);

    var ox = p.x, oy = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    this.clampToHalf(p);
    // Blocked per AXIS: pushing into the centre line / a rail stops only
    // that component; the free one (e.g. sliding up the centre line on a
    // diagonal) keeps its full speed.
    if (p.x !== ox + p.vx * dt) p.vx = 0;
    if (p.y !== oy + p.vy * dt) p.vy = 0;
    p.mvx = dt > 0 ? (p.x - ox) / dt : 0;
    p.mvy = dt > 0 ? (p.y - oy) / dt : 0;

    p.animTime += dt * (p.moving ? 9 : 2.1);
    var targetLean = ESA.clamp(p.vx / maxSp, -1, 1) * 0.08;
    p.lean += (targetLean - p.lean) * Math.min(1, dt * 9);
  };

  AirHockey.prototype.clampToHalf = function (p) {
    var r = p.r;
    var minX = p.slot === "p1" ? RINK.left + r : CX + r;
    var maxX = p.slot === "p1" ? CX - r : RINK.right - r;
    p.x = ESA.clamp(ESA.safe(p.x, p.spawnX), minX, maxX);
    p.y = ESA.clamp(ESA.safe(p.y, p.spawnY), RINK.top + r, RINK.bottom - r);
  };

  /* --- Puck physics ------------------------------------------------- */
  AirHockey.prototype.stepPuck = function (dt) {
    var pk = this.puck;
    var speed = Math.hypot(pk.vx, pk.vy);
    // Sub-step so no single move exceeds half a puck radius: no tunnelling.
    var steps = ESA.clamp(Math.ceil((speed * dt) / (PUCK_R * 0.5)), 1, 16);
    var h = dt / steps;

    for (var i = 0; i < steps; i++) {
      pk.x += pk.vx * h;
      pk.y += pk.vy * h;
      this.collideWalls();
      if (this.state === "playing") {
        // A few relaxation passes settle corner / centre-line pins fully.
        for (var it = 0; it < 4; it++) {
          this.collideMallet(this.p1);
          this.collideMallet(this.p2);
          this.collideWalls();
          var moved1 = this.unsqueeze(this.p1);
          var moved2 = this.unsqueeze(this.p2);
          if (!moved1 && !moved2) break;
        }
        if (this.checkGoal()) break;
      }
    }

    // Gentle glide loss; heavy braking once it's in the net.
    var keep = this.state === "goal" ? Math.pow(0.02, dt) : Math.pow(PUCK_DRAG, dt);
    pk.vx *= keep;
    pk.vy *= keep;

    speed = Math.hypot(pk.vx, pk.vy);
    if (speed > PUCK_MAX) { pk.vx *= PUCK_MAX / speed; pk.vy *= PUCK_MAX / speed; }

    // Never let NaN / Infinity survive a frame.
    if (!isFinite(pk.x) || !isFinite(pk.y) || !isFinite(pk.vx) || !isFinite(pk.vy)) {
      pk.x = CX; pk.y = CY; pk.vx = 0; pk.vy = 0;
    }
  };

  AirHockey.prototype.wallSound = function () {
    if (this.clock - this.lastWallSound < 70) return;
    this.lastWallSound = this.clock;
    ESA.Audio.play("puckWall");
  };

  AirHockey.prototype.collideWalls = function () {
    var pk = this.puck, r = PUCK_R;
    var L = RINK.left, R = RINK.right;
    var inMouth = pk.y > MOUTH_TOP && pk.y < MOUTH_BOT;
    var hit = false;

    // Side walls - open only across the goal mouth.
    if (pk.x - r < L && !inMouth && pk.x >= L) {
      pk.x = L + r; if (pk.vx < 0) { pk.vx = -pk.vx * WALL_E; hit = true; }
    }
    if (pk.x + r > R && !inMouth && pk.x <= R) {
      pk.x = R - r; if (pk.vx > 0) { pk.vx = -pk.vx * WALL_E; hit = true; }
    }

    // Inside a goal pocket: confined between the posts and the back wall.
    if (pk.x < L || pk.x > R) {
      if (pk.y - r < MOUTH_TOP) { pk.y = MOUTH_TOP + r; if (pk.vy < 0) pk.vy = -pk.vy * 0.5; }
      if (pk.y + r > MOUTH_BOT) { pk.y = MOUTH_BOT - r; if (pk.vy > 0) pk.vy = -pk.vy * 0.5; }
      if (pk.x - r < L - POCKET) { pk.x = L - POCKET + r; if (pk.vx < 0) pk.vx = -pk.vx * 0.2; }
      if (pk.x + r > R + POCKET) { pk.x = R + POCKET - r; if (pk.vx > 0) pk.vx = -pk.vx * 0.2; }
    }

    // Top / bottom rails.
    if (pk.y - r < RINK.top) { pk.y = RINK.top + r; if (pk.vy < 0) { pk.vy = -pk.vy * WALL_E; hit = true; } }
    if (pk.y + r > RINK.bottom) { pk.y = RINK.bottom - r; if (pk.vy > 0) { pk.vy = -pk.vy * WALL_E; hit = true; } }

    // Goal posts are round corners the puck can glance off.
    this.collidePost(L, MOUTH_TOP); this.collidePost(L, MOUTH_BOT);
    this.collidePost(R, MOUTH_TOP); this.collidePost(R, MOUTH_BOT);

    if (hit && Math.hypot(pk.vx, pk.vy) > 120) this.wallSound();
  };

  AirHockey.prototype.collidePost = function (px, py) {
    var pk = this.puck;
    var dx = pk.x - px, dy = pk.y - py;
    var d = Math.hypot(dx, dy);
    if (d >= PUCK_R || d < 1e-4) return;
    var nx = dx / d, ny = dy / d;
    pk.x = px + nx * PUCK_R;
    pk.y = py + ny * PUCK_R;
    var vn = pk.vx * nx + pk.vy * ny;
    if (vn < 0) { pk.vx -= (1 + WALL_E) * vn * nx; pk.vy -= (1 + WALL_E) * vn * ny; this.wallSound(); }
  };

  AirHockey.prototype.collideMallet = function (p) {
    var pk = this.puck;
    var min = p.r + PUCK_R;
    var dx = pk.x - p.x, dy = pk.y - p.y;
    var d = Math.hypot(dx, dy);
    if (d >= min) return;

    var nx, ny;
    if (d < 1e-4) { nx = p.slot === "p1" ? 1 : -1; ny = 0; }
    else { nx = dx / d; ny = dy / d; }

    pk.x = p.x + nx * min;
    pk.y = p.y + ny * min;

    // Kinematic mallet: reflect the RELATIVE velocity along the normal.
    var rvx = pk.vx - p.mvx, rvy = pk.vy - p.mvy;
    var vn = rvx * nx + rvy * ny;
    if (vn >= 0) return;

    pk.vx -= (1 + MALLET_E) * vn * nx;
    pk.vy -= (1 + MALLET_E) * vn * ny;

    // The mallet's sideways motion nudges the puck's direction a little.
    var mn = p.mvx * nx + p.mvy * ny;
    pk.vx += (p.mvx - mn * nx) * MALLET_CARRY;
    pk.vy += (p.mvy - mn * ny) * MALLET_CARRY;

    var dashHit = (this.clock - p.lastDashAt) < DASH_HIT_WINDOW * 1000;
    if (dashHit) { pk.vx *= DASH_HIT_BONUS; pk.vy *= DASH_HIT_BONUS; }

    var sp = Math.hypot(pk.vx, pk.vy);
    if (sp > PUCK_MAX) { pk.vx *= PUCK_MAX / sp; pk.vy *= PUCK_MAX / sp; sp = PUCK_MAX; }

    if (-vn > 60) {
      if (this.clock - this.lastHitSound > 60) {
        this.lastHitSound = this.clock;
        ESA.Audio.play("puckHit");
      }
      var hx = p.x + nx * p.r, hy = p.y + ny * p.r;
      var n = dashHit ? 10 : (sp > 500 ? 6 : 3);
      this.fx.burst(hx, hy, n, {
        colors: dashHit ? ["#fff6e4", p.color, "#f3c35a"] : ["#fdeec4", "#f3c35a"],
        speedMin: 60, speedMax: dashHit ? 260 : 170, lifeMin: 0.18, lifeMax: 0.38,
        sizeMin: 1.5, sizeMax: 3.5, gravity: 0, type: "spark",
        angle: Math.atan2(ny, nx), spread: 0.9
      });
      if (dashHit) {
        this.fx.spawn({ type: "ring", x: hx, y: hy, size: 6, size2: 40, life: 0.3, color: "#fff6e4" });
        ESA.Stage.shake(4);
      }
    }
  };

  /**
   * If the puck is pinned between a mallet and a wall the wall wins, so the
   * mallet gets pushed back instead. Prevents puck/mallet interpenetration.
   * Returns true if the mallet had to move.
   */
  AirHockey.prototype.unsqueeze = function (p) {
    var pk = this.puck;
    var min = p.r + PUCK_R;
    var dx = p.x - pk.x, dy = p.y - pk.y;
    var d = Math.hypot(dx, dy);
    if (d >= min - 0.5) return false;
    if (d < 1e-4) { dx = p.slot === "p1" ? -1 : 1; dy = 0; d = 1; }
    p.x = pk.x + (dx / d) * min;
    p.y = pk.y + (dy / d) * min;
    this.clampToHalf(p);
    return true;
  };

  AirHockey.prototype.checkGoal = function () {
    var pk = this.puck;
    // FULLY across the goal line.
    if (pk.x + PUCK_R < RINK.left) { this.scoreGoal("p2"); return true; }
    if (pk.x - PUCK_R > RINK.right) { this.scoreGoal("p1"); return true; }
    return false;
  };

  /** Dead-puck failsafe: an air jet gives a puck that has sat still a gentle push. */
  AirHockey.prototype.updateStuck = function (dt) {
    var pk = this.puck;
    if (Math.hypot(pk.vx, pk.vy) > STUCK_SPEED) { this.slowTime = 0; return; }
    this.slowTime += dt;
    if (this.slowTime < STUCK_TIME) return;
    this.slowTime = 0;
    var a = Math.atan2(CY - pk.y, (pk.x < CX ? 1 : -1) * 120);
    pk.vx = Math.cos(a) * 170;
    pk.vy = Math.sin(a) * 170;
    this.fx.spawn({ type: "ring", x: pk.x, y: pk.y, size: PUCK_R, size2: PUCK_R * 3, life: 0.4, color: "#9fe3ff" });
  };

  /* --- Goals --------------------------------------------------------- */
  AirHockey.prototype.scoreGoal = function (scorerSlot) {
    if (this.state !== "playing") return;      // scoring lock
    this.state = "goal";

    var self = this;
    var gen = this.gen;
    var scorer = this[scorerSlot];
    var conceder = scorerSlot === "p1" ? this.p2 : this.p1;
    var now = this.clock;

    this.scores[scorerSlot] += 1;
    ESA.UI.setScore(scorerSlot, this.scores[scorerSlot]);
    var matchOver = this.scores[scorerSlot] >= this.target || this.suddenDeath;

    // Power-ups never outlive a goal: stun / shrink / reverse, the pickup
    // and any cameo in flight all end here (normal sprites restored first,
    // so the concede reaction below always wins).
    if (this.powerUps) this.powerUps.resetRound();
    this.p1.dashT = this.p2.dashT = 0;

    // Concede reaction: hurt sprite until the reset.
    conceder.hurtFor = 60000;
    conceder.hurtUntil = now + 60000;
    scorer.hurtUntil = 0;
    scorer.cheerUntil = now + 1700;

    var side = scorerSlot === "p1" ? "right" : "left";
    this.goalFlash[side] = 1;
    var gx = side === "right" ? RINK.right : RINK.left;
    this.fx.burst(gx, CY, 22, {
      colors: ["#f3c35a", "#fff6e4", scorer.color],
      speedMin: 90, speedMax: 320, lifeMin: 0.35, lifeMax: 0.8,
      sizeMin: 2, sizeMax: 5, gravity: 0, drag: 0.9,
      angle: side === "right" ? Math.PI : 0, spread: 1.3
    });
    this.fx.spawn({ type: "ring", x: gx, y: CY, size: 12, size2: 120, life: 0.55, color: "#f3c35a" });

    ESA.Stage.hitStop(150);
    ESA.Stage.shake(10);
    ESA.Stage.flash(0.3, "#f3c35a");
    ESA.Audio.play("goal");

    this.timers.after(520, function () {
      if (gen !== self.gen || self.state !== "goal") return;
      ESA.Audio.play(matchOver ? "matchWin" : "roundWin");
      ESA.UI.banner(self.timers, scorer.name.toUpperCase() + " SCORES",
        matchOver ? "GAME!" : "GOAL!", matchOver ? 900 : 950, function () {
          if (gen !== self.gen || self.state !== "goal") return;
          if (matchOver) self.finishMatch(scorer);
          else self.resetRound(conceder.slot);
        });
    });
  };

  /** HUD centre: target score, plus the clock in Tournament play. */
  AirHockey.prototype.updateClock = function () {
    if (this.suddenDeath) {
      if (this.shownTime !== "sd") { this.shownTime = "sd"; ESA.UI.setCenter("Sudden Death", "Next Goal", true); }
      return;
    }
    if (!this.timeLimit) {
      if (this.shownTime !== "target") { this.shownTime = "target"; ESA.UI.setCenter("First to", String(this.target), false); }
      return;
    }
    var txt = clockText(this.timeLeft);
    if (txt === this.shownTime) return;
    this.shownTime = txt;
    var secs = Math.ceil(this.timeLeft);
    ESA.UI.setCenter("First to " + this.target, txt, secs <= 10);
    if (secs <= 5 && secs > 0 && this.state === "playing") ESA.Audio.play("countdown");
  };

  /** 0:00 in Tournament: leader wins, a tie goes to sudden death. */
  AirHockey.prototype.timeUp = function () {
    if (this.state !== "playing") return;
    this.state = "timeUp";                       // the one authoritative state
    var self = this, gen = this.gen;
    if (this.powerUps) this.powerUps.stop();     // no pickup, no effect, no spawn timer
    this.p1.dashT = this.p2.dashT = 0;
    this.puck.vx *= 0.2; this.puck.vy *= 0.2;
    ESA.Stage.flash(0.25, "#fff6e4");

    var a = this.scores.p1, b = this.scores.p2;
    if (a !== b) {
      var winner = a > b ? this.p1 : this.p2;
      winner.cheerUntil = this.clock + 60000;
      ESA.Audio.play("matchWin");
      ESA.UI.banner(this.timers, "TIME!", winner.name.toUpperCase() + " WINS", 1000, function () {
        if (gen !== self.gen || self.state !== "timeUp") return;
        self.finishMatch(winner, "time");
      });
      return;
    }

    this.suddenDeath = true;
    this.updateClock();
    ESA.Audio.play("versus");
    ESA.Stage.shake(6);
    ESA.UI.banner(this.timers, "SUDDEN DEATH", "NEXT GOAL WINS", 1300, function () {
      if (gen !== self.gen || self.state !== "timeUp") return;
      self.resetRound(null);                     // fair centre faceoff, normal everything
    });
  };

  AirHockey.prototype.finishMatch = function (winner, how) {
    if (this.reported) return;
    this.reported = true;
    this.state = "matchEnd";
    if (this.powerUps) this.powerUps.stop();
    var loser = winner === this.p1 ? this.p2 : this.p1;
    winner.cheerUntil = this.clock + 60000;

    for (var i = 0; i < 30; i++) {
      this.fx.spawn({
        type: "confetti",
        x: ESA.rand(80, W - 80), y: ESA.rand(-40, 60),
        vx: ESA.rand(-60, 60), vy: ESA.rand(40, 140),
        life: ESA.rand(1.4, 2.4), size: ESA.rand(5, 9),
        color: ESA.pick(["#f3c35a", "#fff6e4", winner.color, "#4fb7e6"]),
        gravity: 110, drag: 0.985, vrot: ESA.rand(-7, 7)
      });
    }

    var a = this.scores[winner.slot], b = this.scores[loser.slot];
    this.api.endMatch({
      winner: winner.slot,
      kicker: "Match Over",
      title: winner.name + " Wins",
      text: how === "time" ? "Ahead " + a + "–" + b + " when the clock hit 0:00."
          : this.suddenDeath ? "Won it " + a + "–" + b + " in sudden death."
          : (b === 0 ? "A clean sheet, " : "Took it ") + a + "–" + b + " at the air hockey table.",
      scores: { p1: this.scores.p1, p2: this.scores.p2 }
    });
  };

  /* ------------------------------------------------------------------ *
   * Draw
   * ------------------------------------------------------------------ */
  AirHockey.prototype.draw = function (ctx) {
    var self = this;
    var layer = ESA.Stage.layer("airhockey-" + this.target, function (g) { self.drawTable(g); });
    ESA.Stage.blit(ctx, layer);

    this.drawGoalGlow(ctx, "left");
    this.drawGoalGlow(ctx, "right");

    if (this.powerUps) this.powerUps.drawPickups(ctx);

    this.drawBase(ctx, this.p1);
    this.drawBase(ctx, this.p2);

    var order = this.p1.y <= this.p2.y ? [this.p1, this.p2] : [this.p2, this.p1];
    this.drawPlayer(ctx, order[0]);
    this.drawPlayer(ctx, order[1]);

    // The puck always draws above characters so it is never lost.
    if (this.state !== "idle") this.drawPuck(ctx);

    if (this.powerUps) {
      this.powerUps.drawPlayerOverlays(ctx);
      this.powerUps.drawEffects(ctx);
      this.powerUps.drawStatusBar(ctx);
    }
    this.fx.draw(ctx);
  };

  /** The static machine: cabinet frame, rails, rink, markings, emblem. Cached. */
  AirHockey.prototype.drawTable = function (g) {
    var L = RINK.left, R = RINK.right, T = RINK.top, B = RINK.bottom;
    var gold = ESA.COLORS.gold, goldDeep = ESA.COLORS.goldDeep;

    /* --- Cabinet backdrop ------------------------------------------- */
    var bg = g.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#06111f");
    bg.addColorStop(0.5, "#030a14");
    bg.addColorStop(1, "#06111f");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);

    // Pixel bulbs along the top and bottom of the machine.
    for (var i = 0; i < 40; i++) {
      var bx = 30 + i * ((W - 60) / 39);
      var on = i % 2 === 0;
      g.fillStyle = on ? "rgba(243,195,90,.85)" : "rgba(243,195,90,.28)";
      g.fillRect(Math.round(bx) - 2, 14, 4, 4);
      g.fillRect(Math.round(bx) - 2, H - 18, 4, 4);
    }
    g.fillStyle = "rgba(243,195,90,.12)";
    g.fillRect(24, 22, W - 48, 1);
    g.fillRect(24, H - 23, W - 48, 1);

    // CRT scanlines on the cabinet; the rink drawn on top stays clean.
    g.fillStyle = "rgba(0,0,0,.18)";
    for (var sy = 0; sy < H; sy += 3) g.fillRect(0, sy, W, 1);

    /* --- Goal pockets (behind the rails) ---------------------------- */
    [L - POCKET - 8, R].forEach(function (x) {
      g.fillStyle = "#01050b";
      ESA.roundRect(g, x, MOUTH_TOP - 8, POCKET + 8, GOAL_HALF * 2 + 16, 8);
      g.fill();
      g.strokeStyle = "rgba(243,195,90,.55)";
      g.lineWidth = 2;
      g.stroke();
      // Net mesh.
      g.strokeStyle = "rgba(253,238,196,.08)";
      g.lineWidth = 1;
      g.beginPath();
      for (var ny = MOUTH_TOP; ny <= MOUTH_BOT; ny += 10) { g.moveTo(x + 3, ny); g.lineTo(x + POCKET + 5, ny); }
      for (var nx = x + 6; nx < x + POCKET + 6; nx += 10) { g.moveTo(nx, MOUTH_TOP - 4); g.lineTo(nx, MOUTH_BOT + 4); }
      g.stroke();
    });

    /* --- Gold rails -------------------------------------------------- */
    var railG = g.createLinearGradient(0, T - 16, 0, B + 16);
    railG.addColorStop(0, "#f8d98a");
    railG.addColorStop(0.5, "#c0871f");
    railG.addColorStop(1, "#8e6314");
    g.fillStyle = railG;
    ESA.roundRect(g, L - 14, T - 14, (R - L) + 28, (B - T) + 28, 30);
    g.fill();

    /* --- Rink surface ------------------------------------------------ */
    var surf = g.createRadialGradient(CX, CY, 40, CX, CY, (R - L) * 0.62);
    surf.addColorStop(0, "#123a63");
    surf.addColorStop(0.6, "#0b2744");
    surf.addColorStop(1, "#071a30");
    g.fillStyle = surf;
    ESA.roundRect(g, L, T, R - L, B - T, 20);
    g.fill();

    // Cut the goal mouths through the rails.
    g.fillStyle = "#071a30";
    g.fillRect(L - 15, MOUTH_TOP, 16, GOAL_HALF * 2);
    g.fillRect(R - 1, MOUTH_TOP, 16, GOAL_HALF * 2);

    // Air holes - the signature air-hockey texture.
    g.save();
    ESA.roundRect(g, L, T, R - L, B - T, 20);
    g.clip();
    g.fillStyle = "rgba(160,205,255,.09)";
    for (var hy = T + 12; hy < B; hy += 20) {
      for (var hx = L + 12 + ((hy / 20) % 2) * 10; hx < R; hx += 20) {
        g.fillRect(hx, hy, 2, 2);
      }
    }
    g.restore();

    /* --- Markings ---------------------------------------------------- */
    g.save();
    // Centre line: gold with a white core.
    g.fillStyle = "rgba(243,195,90,.75)";
    g.fillRect(CX - 3, T, 6, B - T);
    g.fillStyle = "rgba(255,246,228,.6)";
    g.fillRect(CX - 1, T, 2, B - T);

    // Centre circle with the official emblem.
    g.strokeStyle = "rgba(255,246,228,.5)";
    g.lineWidth = 2.5;
    g.beginPath(); g.arc(CX, CY, 76, 0, TAU); g.stroke();
    g.fillStyle = "rgba(3,11,22,.55)";
    g.beginPath(); g.arc(CX, CY, 62, 0, TAU); g.fill();
    var emblem = ESA.Assets.get("emblem");
    if (emblem && emblem.width) {
      g.globalAlpha = 0.6;
      var es = 108;
      g.drawImage(emblem, CX - es / 2, CY - es / 2, es, es);
      g.globalAlpha = 1;
    }
    g.strokeStyle = "rgba(243,195,90,.7)";
    g.lineWidth = 1.5;
    g.beginPath(); g.arc(CX, CY, 62, 0, TAU); g.stroke();

    // Faceoff circles.
    g.strokeStyle = "rgba(255,246,228,.16)";
    g.lineWidth = 2;
    [CX - 220, CX + 220].forEach(function (fx) {
      g.beginPath(); g.arc(fx, CY, 46, 0, TAU); g.stroke();
      g.fillStyle = "rgba(243,195,90,.35)";
      g.beginPath(); g.arc(fx, CY, 4, 0, TAU); g.fill();
    });

    // Goal creases.
    [[L, -Math.PI / 2, Math.PI / 2], [R, Math.PI / 2, Math.PI * 1.5]].forEach(function (c) {
      g.fillStyle = "rgba(243,195,90,.07)";
      g.beginPath(); g.moveTo(c[0], CY); g.arc(c[0], CY, 98, c[1], c[2]); g.closePath(); g.fill();
      g.strokeStyle = "rgba(243,195,90,.6)";
      g.lineWidth = 2.5;
      g.beginPath(); g.arc(c[0], CY, 98, c[1], c[2]); g.stroke();
    });

    // Goal lines.
    g.fillStyle = "rgba(255,246,228,.75)";
    g.fillRect(L - 1, MOUTH_TOP, 3, GOAL_HALF * 2);
    g.fillRect(R - 2, MOUTH_TOP, 3, GOAL_HALF * 2);
    g.restore();

    // Inner rail edge highlight.
    g.strokeStyle = "rgba(255,246,228,.35)";
    g.lineWidth = 1.5;
    ESA.roundRect(g, L + 3, T + 3, R - L - 6, B - T - 6, 17);
    g.stroke();
    g.strokeStyle = "rgba(60,38,4,.6)";
    g.lineWidth = 2;
    ESA.roundRect(g, L - 14, T - 14, (R - L) + 28, (B - T) + 28, 30);
    g.stroke();

    // Gold posts at each goal mouth.
    [[L, MOUTH_TOP], [L, MOUTH_BOT], [R, MOUTH_TOP], [R, MOUTH_BOT]].forEach(function (p) {
      g.fillStyle = gold;
      g.beginPath(); g.arc(p[0], p[1], 5, 0, TAU); g.fill();
      g.strokeStyle = goldDeep;
      g.lineWidth = 1.5;
      g.stroke();
    });

    /* --- Machine plate ---------------------------------------------- */
    g.font = "800 13px " + ESA.FONT_DISPLAY;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.letterSpacing = "4px";
    g.fillStyle = "rgba(243,195,90,.85)";
    g.fillText("ESA AIR HOCKEY  ★  FIRST TO " + this.target, CX, H - 32);
    g.font = "800 11px " + ESA.FONT_DISPLAY;
    g.letterSpacing = "3px";
    g.fillStyle = "rgba(74,163,255,.8)";
    g.textAlign = "left";
    g.fillText("◀ P1 GOAL", L - 6, H - 32);
    g.fillStyle = "rgba(255,106,92,.8)";
    g.textAlign = "right";
    g.fillText("P2 GOAL ▶", R + 6, H - 32);
    g.letterSpacing = "0px";
  };

  AirHockey.prototype.drawGoalGlow = function (ctx, side) {
    var x = side === "left" ? RINK.left : RINK.right;
    var flash = this.goalFlash[side];
    var pulse = 0.5 + 0.5 * Math.sin(this.clock / 520 + (side === "left" ? 0 : Math.PI));
    var a = 0.14 + pulse * 0.06 + flash * 0.55;
    var col = side === "left" ? "74,163,255" : "255,106,92";
    var grad = ctx.createRadialGradient(x, CY, 6, x, CY, 120 + flash * 60);
    grad.addColorStop(0, "rgba(" + (flash > 0.05 ? "243,195,90" : col) + "," + a.toFixed(3) + ")");
    grad.addColorStop(1, "rgba(" + col + ",0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - 180, CY - 180, 360, 360);
  };

  /** The mallet disc each character stands in: shows reach and dash cooldown. */
  AirHockey.prototype.drawBase = function (ctx, p) {
    var now = this.clock;
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = p.color;
    ctx.stroke();

    // Dash meter around the disc: fills while recharging, gold when ready.
    var max = DASH_COOLDOWN * this.mods[p.slot].dashCooldown;
    var ready = p.dashCd <= 0;
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    if (ready) {
      ctx.globalAlpha = 0.55 + 0.25 * Math.sin(now / 160);
      ctx.strokeStyle = ESA.COLORS.gold;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, 0, TAU); ctx.stroke();
    } else {
      var f = 1 - p.dashCd / max;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = "rgba(255,255,255,.35)";
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r + 5, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
    }

    // Slot tag under the disc so mirror matches stay readable.
    ctx.globalAlpha = 0.9;
    ctx.font = "800 10px " + ESA.FONT_DISPLAY;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = ESA.CONTROLS[p.slot].color;
    ctx.fillText((this.tags && this.tags[p.slot]) || ESA.CONTROLS[p.slot].short, p.x, p.y + p.r + 15);
    ctx.restore();
  };

  AirHockey.prototype.drawPlayer = function (ctx, p) {
    var now = this.clock;
    var stunned = this.isStunned(p);
    // SHRINK scales the drawn character (the collider is scaled separately
    // in applyRadius, so the two always match).
    var h = p.spriteH * this.visualScale(p);
    var bounce = 0, sx = 1, sy = 1, rot = p.lean, jitter = 0;

    if (now < p.cheerUntil) {
      var c = Math.abs(Math.sin(now / 110));
      bounce = c * 12;
      sy = 1 + c * 0.05;
      sx = 1 - c * 0.04;
    } else if (p.moving) {
      var lift = Math.abs(Math.sin(p.animTime));
      bounce = lift * 4;
      sy = 1 + lift * 0.04 - (1 - lift) * 0.03;
      sx = 1 - (sy - 1) * 0.75;
    } else {
      var idle = Math.sin(p.animTime);
      bounce = idle * 1.6 + 1.6;
      sy = 1 + idle * 0.014;
    }

    if (stunned) {
      jitter = Math.sin(now / 22) * 3.5;
      rot += Math.sin(now / 70) * 0.06;
    }

    // Dash afterimage.
    if (p.dashT > 0) {
      ESA.drawSprite(ctx, p.character.id, false, p.x - p.vx * 0.035, p.y + h * 0.5 - p.vy * 0.035, {
        height: h, flip: p.facing === "left", alpha: 0.3, bounce: bounce
      });
    }

    // Collider centre sits mid-body: feet are half a sprite below it.
    ESA.drawSpriteBlend(ctx, p.character.id, ESA.hurtBlend(p, now), p.x + jitter, p.y + h * 0.5, {
      height: h, flip: p.facing === "left", bounce: bounce, scaleX: sx, scaleY: sy, rotate: rot
    });

    if (ESA.DEBUG_HITBOX) {
      ctx.save();
      ctx.strokeStyle = "rgba(0,255,170,.9)";
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  };

  AirHockey.prototype.drawPuck = function (ctx) {
    var pk = this.puck;
    var speed = Math.hypot(pk.vx, pk.vy);

    // Motion trail when moving fast.
    if (speed > 380) {
      var t = pk.trail;
      ctx.save();
      for (var i = 0; i < t.length - 2; i += 2) {
        ctx.globalAlpha = 0.05 + (i / t.length) * 0.2;
        ctx.fillStyle = "#f3c35a";
        ctx.beginPath(); ctx.arc(t[i], t[i + 1], PUCK_R * (0.5 + 0.5 * i / t.length), 0, TAU); ctx.fill();
      }
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ctx.beginPath(); ctx.ellipse(pk.x + 2, pk.y + 4, PUCK_R, PUCK_R * 0.85, 0, 0, TAU); ctx.fill();

    ctx.fillStyle = "#f3c35a";
    ctx.beginPath(); ctx.arc(pk.x, pk.y, PUCK_R, 0, TAU); ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#8e6314";
    ctx.stroke();
    ctx.fillStyle = "#c0871f";
    ctx.beginPath(); ctx.arc(pk.x, pk.y, PUCK_R * 0.58, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(255,246,228,.85)";
    ctx.beginPath(); ctx.arc(pk.x - 4, pk.y - 4, 3.5, 0, TAU); ctx.fill();
    ctx.restore();
  };

  ESA.AirHockey = AirHockey;

  ESA.Games.register({
    id: "airHockey",
    title: "Air Hockey",
    tagline: "Your character IS the mallet. First to the target score wins.",
    description: "<b>Your character is the mallet.</b> Stay on your half and knock the puck into " +
                 "the other goal. <b>Space / Enter</b> fires a short dash. Grab pickups to hit your rival " +
                 "with a SMACK, a GARA EH YA AMR??!!, a SHRINK or a REVERSE.",
    mode: "First to " + TARGETS.casual,
    // Same game, shorter tournament matches: only the labels change here,
    // the game reads its target from the match context.
    forContext: function (context) {
      var n = targetFor(context);
      var t = timeLimitFor(context);
      return t
        ? { mode: "First to " + n + " · " + clockText(t), hud: { centerLabel: "First to " + n, centerValue: clockText(t), pips: 0 } }
        : { mode: "First to " + n, hud: { centerLabel: "First to", centerValue: String(n), pips: 0 } };
    },
    icon: { symbol: "#icoPuck" },
    controls: "hockey",
    touch: { movement: "joystick", actions: [{ id: "action1", label: "DASH" }],
             help: ["JOYSTICK — MOVE", "DASH — BURST", "PICKUPS — HIT YOUR RIVAL"],
             description: "<b>Your character is the mallet.</b> Use the joystick to stay on your half and knock the " +
                          "puck into the other goal. <b>Tap DASH</b> for a burst of speed. Grab pickups to hit your " +
                          "rival with a SMACK, a GARA EH YA AMR??!!, a SHRINK or a REVERSE." },
    powerUps: POWER_UPS,
    hud: { centerLabel: "First to", centerValue: String(TARGETS.casual), pips: 0 },
    accent: "#5ad1ff",
    canTie: false,
    tournamentEligible: true,
    // Solo vs CPU: first to 5, no clock (strategy in js/cpu-airhockey.js).
    soloEligible: true,
    soloModeType: "cpu-versus",
    solo: { blurb: "First to 5 vs the CPU. WASD + Space to dash.", touchBlurb: "First to 5 vs the CPU. Joystick + DASH.",
            description: "<b>Your character is the mallet.</b> Move with <b>W A S D</b>, stay on your half and knock the puck " +
                         "past the CPU. <b>Space</b> fires a short dash. Grab pickups to hit the CPU with a SMACK, " +
                         "a GARA EH YA AMR??!!, a SHRINK or a REVERSE - they work on it exactly like on a human." },
    enabled: true,
    create: function (api, setup) { return new AirHockey(api, setup); }
  });

})(window.ESA);
