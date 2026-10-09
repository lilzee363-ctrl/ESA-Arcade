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

   V4.1
   - SOLO: tokens MOVE - each one drifts on its own heading and speed,
     bounces off the arena edge and changes course every few seconds
     (cheap straight-line motion, no pathfinding). You have to chase.
   - BIG (+3) TOKEN, every mode: lives BONUS_LIFE seconds, shown by a
     draining ring around it, then pops away if nobody takes it.
   - PICKUPS, every mode (one on the floor at a time, alternating fairly):
       SPEED BOOTS  x1.35 movement for 5 s (a second pair refreshes the
                    timer - never stacks)
       MAGNET       for 6 s, tokens within 170 px glide to you (refreshes,
                    never stacks; the big token is pulled more weakly)
   - TRAPS: up to 3 at once (the cap rises over the round), each lives 7-9 s,
     arms after a short visible grace, and a player who steps on one is
     STUNNED for exactly 4.0 s (no movement, no collecting). Spent on contact.
   - REVERSE (cursed pickup, 1 in 5 pickups): the COLLECTOR's own movement
     is inverted for 5 s; another Reverse refreshes it (never cancels).
   - FAIRNESS (Casual / Tournament): pickups and traps only spawn on spots
     roughly as far from P1 as from P2, and never right next to anyone.
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
  // Solo moving tokens: px/s range, and seconds between course changes.
  var DRIFT_SPEED = [38, 78];
  var DRIFT_TURN = [1.4, 3.4];
  // The +3 token's lifetime (seconds), every mode.
  var BONUS_LIFE = 6.5;
  // Pickups (Speed Boots / Magnet) and traps.
  var PICKUP_EVERY = [9, 14], PICKUP_LIFE = 8, PICKUP_R = 18;
  var BOOTS_MS = 5000, BOOTS_MULT = 1.35;
  var MAGNET_MS = 6000, MAGNET_R = 170, MAGNET_PULL = 300;
  /*
   * TRAPS (V4.1 balance pass - see tools/sim/coinrush-sim.js). Several can
   * be on the floor at once; the CAP rises over the round (grace -> 1 ->
   * 2 -> 3) and spawns come faster as it goes on. Each trap lives its own
   * TRAP.life, so they overlap. Placement (trapSpot) is strict: a spot
   * that isn't fair and safe is REJECTED and retried shortly, never forced.
   * Previous single-trap tuning: first [6, 9] s, then one every [6, 10] s
   * after the last one ended, 7 s life, max 1 (~3-4 per match).
   */
  var TRAP = {
    first: [3.5, 5],                                  // grace after GO
    every: { early: [4.8, 5.8], late: [2.5, 3.2] },   // between spawns (eases with progress)
    life: [7, 9],                                     // seconds on the floor (if not sprung)
    cap: [[0.18, 1], [0.6, 2], [1, 3]],               // [until progress, max active]
    soloStretch: 1.15,                                // Solo: intervals x this (no 2nd player
                                                      // blocking spots, so it would run denser)
    soloStretch: 1.15,                                // Solo: intervals x this - with no 2nd player
                                                      // blocking spots it would otherwise run denser
    stopAt: 3,                                        // no NEW trap in the final seconds
    retry: 0.5,                                       // after a rejected (unsafe) spot
    gap: 165,                                         // min centre distance between traps
    fromPlayer: 160,                                  // min distance from either player
    fairSpread: 140,                                  // versus: |dist to P1 - dist to P2| allowed
    boxIn: 230,                                       // a player may have at most ONE trap this close
    fromToken: 52                                     // never right on top of a token
  };
  var TRAP_ARM = 0.6, TRAP_R = 22;
  var TRAP_STUN_MS = 4000;
  // REVERSE (cursed pickup): the collector's OWN movement is inverted.
  // Re-collecting refreshes to the full duration - it never toggles back.
  var REVERSE_MS = 5000;
  var REVERSE_COLOR = "#c58cff";
  var FAIR_SPREAD = 90;           // |dist to P1 - dist to P2| allowed in versus
  var SAFE_FROM_PLAYER = 150;     // nothing spawns closer than this to anyone
  var pickupBag = null;           // shared ShuffleBag: boots / magnet alternate fairly

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
    this.clock = 0;               // seconds of live play (pauses with the game)
    this.pickup = null;           // { type, x, y, age }
    this.traps = [];              // [{ x, y, age, life }] - up to the TRAP cap
    this.nextPickupAt = 0;
    this.nextTrapAt = 0;
    this.players.forEach(function (p) { p.fx = { boots: 0, magnet: 0, stun: 0, reverse: 0 }; p.reversed = false; p.baseSpeed = PLAYER_SPEED; });
    this.trapRejects = 0;         // unsafe trap spots refused (dev / sim metric)
    // Boots / magnet / boots / magnet / REVERSE per bag: Reverse is 1 pick in
    // 5 and the bag never deals the same pick twice in a row.
    if (!pickupBag) pickupBag = new ESA.ShuffleBag(["boots", "magnet", "boots", "magnet", "reverse"]);
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
    this.clock = 0;
    this.pickup = null;
    this.traps = [];
    this.trapRejects = 0;
    this.nextPickupAt = ESA.rand(5, 8);           // never straight off GO
    this.nextTrapAt = ESA.rand(TRAP.first[0], TRAP.first[1]);
    this.players.forEach(function (p) {
      p.fx.boots = p.fx.magnet = p.fx.stun = p.fx.reverse = 0;
      p.reversed = false;
      p.speed = PLAYER_SPEED; p.frozen = false; p.hurtUntil = 0;
    });

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
    this.pickup = null;
    this.traps.length = 0;
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
    var a = Math.random() * Math.PI * 2;
    var sp = ESA.rand(DRIFT_SPEED[0], DRIFT_SPEED[1]) * (bonus ? 0.8 : 1);
    return {
      x: spot.x,
      y: spot.y,
      bonus: bonus,
      phase: Math.random() * Math.PI * 2,
      born: 0,            // grow-in progress, 0 -> 1
      collected: false,
      expired: false,     // a +3 token that timed out (pops, no score)
      popT: 0,
      respawnIn: 0,
      life: bonus ? BONUS_LIFE : Infinity,
      // Solo drift: every token its own heading, speed and turn rhythm.
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      turnIn: ESA.rand(DRIFT_TURN[0], DRIFT_TURN[1])
    };
  };

  /** Solo: a token drifts, bounces off the edge, and changes course now and then. */
  CoinRush.prototype.drift = function (t, dt) {
    var area = spawnArea();
    t.turnIn -= dt;
    if (t.turnIn <= 0) {
      var sp = Math.hypot(t.vx, t.vy) || DRIFT_SPEED[0];
      var a = Math.atan2(t.vy, t.vx) + ESA.rand(-1.6, 1.6);
      t.vx = Math.cos(a) * sp; t.vy = Math.sin(a) * sp;
      t.turnIn = ESA.rand(DRIFT_TURN[0], DRIFT_TURN[1]);
    }
    t.x += t.vx * dt; t.y += t.vy * dt;
    if (t.x < area.left) { t.x = area.left; t.vx = Math.abs(t.vx); }
    if (t.x > area.right) { t.x = area.right; t.vx = -Math.abs(t.vx); }
    if (t.y < area.top) { t.y = area.top; t.vy = Math.abs(t.vy); }
    if (t.y > area.bottom) { t.y = area.bottom; t.vy = -Math.abs(t.vy); }
  };

  /** Magnet: tokens near a magnet holder glide toward them (nearest holder wins). */
  CoinRush.prototype.magnetPull = function (t, dt, b1, b2) {
    var best = null, bestD = MAGNET_R;
    var list = [[this.p1, b1], [this.p2, b2]];
    for (var i = 0; i < list.length; i++) {
      var p = list[i][0], b = list[i][1];
      if (!p || !b || p.fx.magnet <= 0 || p.fx.stun > 0) continue;
      var d = ESA.dist(t.x, t.y, b.cx, b.cy);
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best || bestD < 1) return;
    // Stronger as it closes in; the big token is heavier.
    var pull = MAGNET_PULL * (0.45 + 0.55 * (1 - bestD / MAGNET_R)) * (t.bonus ? 0.6 : 1);
    var step = Math.min(bestD, pull * dt);
    t.x += (best.cx - t.x) / bestD * step;
    t.y += (best.cy - t.y) / bestD * step;
    t.magnetT = 0.15;             // little visual tell
  };

  /*
   * FAIR SPOT for pickups / traps. Versus: about as far from P1 as from P2
   * (within FAIR_SPREAD) and never closer than SAFE_FROM_PLAYER to anyone,
   * so neither side gets a free one or an unavoidable trap. Falls back to
   * the fairest candidate found.
   */
  CoinRush.prototype.fairSpot = function () {
    var area = spawnArea(), best = null, bestScore = Infinity;
    var c1 = ESA.bodyBounds(this.p1), c2 = this.p2 ? ESA.bodyBounds(this.p2) : null;
    for (var i = 0; i < 40; i++) {
      var x = ESA.rand(area.left + 30, area.right - 30), y = ESA.rand(area.top + 20, area.bottom - 20);
      var d1 = ESA.dist(x, y, c1.cx, c1.cy), d2 = c2 ? ESA.dist(x, y, c2.cx, c2.cy) : d1;
      var near = Math.min(d1, d2);
      var spread = Math.abs(d1 - d2);
      var clash = 0;
      for (var k = 0; k < this.tokens.length; k++) {
        var t = this.tokens[k];
        if (!t.collected && ESA.dist(x, y, t.x, t.y) < 60) clash += 60;
      }
      if (this.pickup && ESA.dist(x, y, this.pickup.x, this.pickup.y) < 120) clash += 120;
      for (var j = 0; j < this.traps.length; j++) {
        if (ESA.dist(x, y, this.traps[j].x, this.traps[j].y) < 120) clash += 120;
      }
      var score = Math.max(0, spread - FAIR_SPREAD) * 2 + Math.max(0, SAFE_FROM_PLAYER - near) * 3 + clash;
      if (score === 0) return { x: x, y: y };
      if (score < bestScore) { bestScore = score; best = { x: x, y: y }; }
    }
    return best;
  };

  /** An ms countdown; float residue (1e-11 ms after 240 frames) counts as done. */
  function tick(ms, dt) {
    var left = ms - dt * 1000;
    return left > 1e-6 ? left : 0;
  }

  /** Max traps on the floor at progress k (0..1). */
  function trapCap(k) {
    for (var i = 0; i < TRAP.cap.length; i++) if (k < TRAP.cap[i][0]) return TRAP.cap[i][1];
    return TRAP.cap[TRAP.cap.length - 1][1];
  }

  /*
   * TRAP SPOT - unlike fairSpot there is NO fallback: a spot must pass
   * every rule or the spawn is skipped (and retried shortly).
   *   - away from the walls (a lane always runs between trap and edge)
   *   - >= TRAP.fromPlayer from both players (nothing lands under anyone)
   *   - versus: about as far from P1 as from P2 (neutral pressure)
   *   - >= TRAP.gap from every other trap (no walls of jaws, gaps a body fits through)
   *   - never a SECOND trap within TRAP.boxIn of a player (can't be boxed in)
   *   - not on a token or the pickup (everything stays collectable)
   */
  CoinRush.prototype.trapSpot = function () {
    var area = spawnArea();
    var c1 = ESA.bodyBounds(this.p1), c2 = this.p2 ? ESA.bodyBounds(this.p2) : null;
    var centres = c2 ? [c1, c2] : [c1];
    var traps = this.traps;
    function near(c) {
      var n = 0;
      for (var j = 0; j < traps.length; j++) if (ESA.dist(traps[j].x, traps[j].y, c.cx, c.cy) < TRAP.boxIn) n++;
      return n;
    }
    var crowded = centres.map(near);
    for (var i = 0; i < 40; i++) {
      var x = ESA.rand(area.left + 40, area.right - 40), y = ESA.rand(area.top + 28, area.bottom - 28);
      var ok = true;
      for (var p = 0; p < centres.length && ok; p++) {
        var d = ESA.dist(x, y, centres[p].cx, centres[p].cy);
        if (d < TRAP.fromPlayer || (d < TRAP.boxIn && crowded[p] > 0)) ok = false;
      }
      if (ok && c2 && Math.abs(ESA.dist(x, y, c1.cx, c1.cy) - ESA.dist(x, y, c2.cx, c2.cy)) > TRAP.fairSpread) ok = false;
      for (var k = 0; k < traps.length && ok; k++) if (ESA.dist(x, y, traps[k].x, traps[k].y) < TRAP.gap) ok = false;
      for (var t = 0; t < this.tokens.length && ok; t++) {
        var tk = this.tokens[t];
        if (!tk.collected && ESA.dist(x, y, tk.x, tk.y) < TRAP.fromToken) ok = false;
      }
      if (ok && this.pickup && ESA.dist(x, y, this.pickup.x, this.pickup.y) < 90) ok = false;
      if (ok) return { x: x, y: y };
    }
    return null;
  };

  /** Traps: age / expire / spring, then maybe spawn one (see TRAP). */
  CoinRush.prototype.updateTraps = function (dt, b1, b2) {
    for (var i = this.traps.length - 1; i >= 0; i--) {
      var tr = this.traps[i];
      tr.age += dt;
      var gone = tr.age >= tr.life;
      if (!gone && tr.age >= TRAP_ARM) {
        var hit = this.touching(tr.x, tr.y, TRAP_R, b1, b2);
        if (hit) { gone = true; this.springTrap(hit, tr); }
      }
      if (gone) {
        this.traps.splice(i, 1);
        // A freed slot is never refilled the same instant.
        this.nextTrapAt = Math.max(this.nextTrapAt, this.clock + 1);
      }
    }
    if (this.clock < this.nextTrapAt || this.timeLeft <= TRAP.stopAt) return;
    if (this.traps.length >= trapCap(this.progress())) return;
    var spot = this.trapSpot();
    if (!spot) { this.trapRejects++; this.nextTrapAt = this.clock + TRAP.retry; return; }
    this.traps.push({ x: spot.x, y: spot.y, age: 0, life: ESA.rand(TRAP.life[0], TRAP.life[1]) });
    ESA.Audio.play("denied");
    var k = this.progress();
    var stretch = this.single ? TRAP.soloStretch : 1;
    this.nextTrapAt = this.clock + stretch * ESA.rand(ESA.lerp(TRAP.every.early[0], TRAP.every.late[0], k),
                                            ESA.lerp(TRAP.every.early[1], TRAP.every.late[1], k));
  };

  /** Pickups, traps and timed effects. Live play only. */
  CoinRush.prototype.updateExtras = function (dt, b1, b2) {
    var self = this;
    this.clock += dt;

    // Timed effects (ms countdowns) - a fresh pickup REFRESHES, never stacks.
    this.players.forEach(function (p) {
      var f = p.fx;
      f.boots = Math.max(0, f.boots - dt * 1000);
      f.magnet = Math.max(0, f.magnet - dt * 1000);
      // Reverse keeps counting down while stunned (a stun doesn't pause it).
      f.reverse = tick(f.reverse, dt);
      p.reversed = f.reverse > 0;
      if (f.stun > 0) {
        f.stun = tick(f.stun, dt);
        if (f.stun === 0) { p.frozen = false; p.hurtUntil = 0; }
      }
      p.speed = PLAYER_SPEED * (f.boots > 0 ? BOOTS_MULT : 1);
    });

    // Pickup: one on the floor at a time; boots / magnet from a shared bag.
    if (this.pickup) {
      var pk = this.pickup;
      pk.age += dt;
      if (pk.age >= PICKUP_LIFE) { this.pickup = null; this.nextPickupAt = this.clock + ESA.rand(PICKUP_EVERY[0], PICKUP_EVERY[1]); }
      else if (pk.age > 0.25) {
        var who = this.touching(pk.x, pk.y, PICKUP_R, b1, b2);
        if (who) {
          this.pickup = null;
          this.nextPickupAt = this.clock + ESA.rand(PICKUP_EVERY[0], PICKUP_EVERY[1]);
          this.grant(who, pk);
        }
      }
    } else if (this.clock >= this.nextPickupAt && this.timeLeft > 4) {
      var s = this.fairSpot();
      if (s) { this.pickup = { type: pickupBag.next(), x: s.x, y: s.y, age: 0 }; ESA.Audio.play("powerSpawn"); }
      else this.nextPickupAt = this.clock + 1;
    }

    // Traps: visible, armed after a short grace, each gone after its own life.
    this.updateTraps(dt, b1, b2);
  };

  /** Which player's body touches a circle (closest wins); a stunned player never counts. */
  CoinRush.prototype.touching = function (x, y, r, b1, b2) {
    var h1 = this.p1.fx.stun <= 0 && ESA.circleHitsRect(x, y, r, b1);
    var h2 = !!b2 && this.p2.fx.stun <= 0 && ESA.circleHitsRect(x, y, r, b2);
    if (!h1 && !h2) return null;
    if (h1 && h2) return ESA.dist(b1.cx, b1.cy, x, y) <= ESA.dist(b2.cx, b2.cy, x, y) ? this.p1 : this.p2;
    return h1 ? this.p1 : this.p2;
  };

  CoinRush.prototype.grant = function (p, pk) {
    if (pk.type === "reverse") {
      // Cursed: the COLLECTOR's own controls flip. Refresh, never toggle.
      p.fx.reverse = REVERSE_MS;
      p.reversed = true;
      ESA.Audio.play("penalty");
      this.fx.spawn({ type: "ring", x: pk.x, y: pk.y, size: 10, size2: 74, life: 0.45, color: REVERSE_COLOR });
      this.fx.spawn({
        type: "text", x: pk.x, y: pk.y - 22, vx: 0, vy: -50, gravity: 0, drag: 0.98, life: 1, font: 20,
        text: "CONTROLS REVERSED!", color: "#e2c8ff"
      });
      return;
    }
    var boots = pk.type === "boots";
    if (boots) p.fx.boots = BOOTS_MS; else p.fx.magnet = MAGNET_MS;     // refresh, never stack
    ESA.Audio.play("tokenBonus");
    this.fx.spawn({ type: "ring", x: pk.x, y: pk.y, size: 10, size2: 70, life: 0.4, color: boots ? "#7bd88f" : "#ff6a5c" });
    this.fx.spawn({
      type: "text", x: pk.x, y: pk.y - 22, vx: 0, vy: -50, gravity: 0, drag: 0.98, life: 0.9, font: 20,
      text: boots ? "SPEED BOOTS!" : "MAGNET!", color: boots ? "#a6f0b6" : "#ffb3a8"
    });
  };

  CoinRush.prototype.springTrap = function (p, tr) {
    p.fx.stun = TRAP_STUN_MS;             // exactly 4.0 s of live play
    p.frozen = true;
    p.vx = p.vy = 0;
    ESA.Audio.play("penalty");
    ESA.Stage.shake(10);
    this.fx.burst(tr.x, tr.y, 14, {
      colors: ["#ff5a4f", "#2a2a33", "#ffd766"], speedMin: 80, speedMax: 240,
      lifeMin: 0.3, lifeMax: 0.6, sizeMin: 2, sizeMax: 5, gravity: 300
    });
    this.fx.spawn({
      type: "text", x: tr.x, y: tr.y - 30, vx: 0, vy: -46, gravity: 0, drag: 0.98, life: 1, font: 22,
      text: "TRAPPED!", color: "#ffd0cc"
    });
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
    for (var rv = 0; rv < this.players.length; rv++) this.players[rv].reversed = this.players[rv].fx.reverse > 0;
    ESA.movePlayer(this.p1, dt, ESA.BOUNDS, canMove);
    if (this.p2) ESA.movePlayer(this.p2, dt, ESA.BOUNDS, canMove);

    // Body boxes once per frame, after movement.
    var b1 = ESA.bodyBounds(this.p1);
    var b2 = this.p2 ? ESA.bodyBounds(this.p2) : null;
    // Solo ramp: fewer tokens on the floor as the run goes on.
    var live = 0;
    var cap = this.single ? Math.round(ESA.lerp(SOLO_TOKENS[0], SOLO_TOKENS[1], this.progress())) : Infinity;
    for (var n = 0; n < this.tokens.length; n++) if (!this.tokens[n].collected) live++;

    if (this.state === "playing") this.updateExtras(dt, b1, b2);
    // A trapped player shows their hurt art for exactly as long as the stun
    // (kept alive per frame so a pause can't let the art run out early).
    for (var s = 0; s < this.players.length; s++) {
      var pl = this.players[s];
      if (pl.fx.stun > 0) { pl.hurtFor = TRAP_STUN_MS; pl.hurtUntil = now + 150; }
    }

    // Tokens keep breathing during the countdown so the arena feels alive.
    for (var i = 0; i < this.tokens.length; i++) {
      var t = this.tokens[i];
      t.phase += dt * 2.2;
      if (t.born < 1) t.born = Math.min(1, t.born + dt * 4.2);
      if (t.popT > 0) t.popT = Math.max(0, t.popT - dt * 5);
      if (t.magnetT > 0) t.magnetT -= dt;

      if (!t.collected && this.state === "playing") {
        // The +3 token is only around for BONUS_LIFE seconds.
        if (t.bonus) {
          t.life -= dt;
          if (t.life <= 0) {
            t.collected = true; t.expired = true; t.popT = 1; t.respawnIn = 0.6;
            this.bonusActive = false;
            continue;
          }
        }
        if (this.single) this.drift(t, dt);
        this.magnetPull(t, dt, b1, b2);
      }

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
      // A stunned (trapped) player can't collect.
      var hit1 = this.p1.fx.stun <= 0 && ESA.circleHitsRect(t.x, t.y, r, b1);
      var hit2 = !!b2 && this.p2.fx.stun <= 0 && ESA.circleHitsRect(t.x, t.y, r, b2);
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

    for (var tj = 0; tj < this.traps.length; tj++) this.drawTrap(ctx, this.traps[tj], now);
    for (var i = 0; i < this.tokens.length; i++) {
      this.drawToken(ctx, this.tokens[i], now);
    }
    if (this.pickup) this.drawPickup(ctx, this.pickup, now);

    var self = this;
    this.players.forEach(function (p) { if (p.fx.magnet > 0) self.drawMagnetField(ctx, p, now); });
    if (this.p2) {
      var order = (this.p1.y <= this.p2.y) ? [this.p1, this.p2] : [this.p2, this.p1];
      ESA.drawCharacter(ctx, order[0], now);
      ESA.drawCharacter(ctx, order[1], now);
    } else {
      ESA.drawCharacter(ctx, this.p1, now);
    }
    this.players.forEach(function (p) { self.drawEffects(ctx, p, now); });

    this.fx.draw(ctx);
  };

  /* --- V4.1 extras: art ---------------------------------------------- */

  /** Trap: dark iron jaws with warning stripes - unmistakably NOT a coin. */
  CoinRush.prototype.drawTrap = function (ctx, tr, now) {
    var armed = tr.age >= TRAP_ARM;
    var left = tr.life - tr.age;
    var pop = ESA.easeOutBack(Math.min(1, tr.age / 0.3));
    var fade = Math.min(1, left / 0.5);
    var blink = left < 1.6 ? 0.6 + 0.4 * Math.abs(Math.sin(tr.age * 9)) : 1;
    var R = TRAP_R;
    ctx.save();
    ctx.translate(tr.x, tr.y);
    ctx.globalAlpha = fade * blink * (armed ? 1 : 0.55);
    ctx.scale(pop, pop * 0.62);                       // lies flat on the floor
    // Warning ring (red / black hazard dashes).
    ctx.lineWidth = 5;
    ctx.strokeStyle = "#1b1b22";
    ctx.beginPath(); ctx.arc(0, 0, R + 9, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([7, 7]);
    ctx.lineDashOffset = -now / 60;
    ctx.strokeStyle = "#e8584f";
    ctx.stroke();
    ctx.setLineDash([]);
    // Plate + jaws.
    ctx.fillStyle = "#2a2a33";
    ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#c9ccd6";
    for (var i = 0; i < 10; i++) {
      var a = (i / 10) * Math.PI * 2;
      ctx.save();
      ctx.rotate(a);
      ctx.beginPath(); ctx.moveTo(R - 1, -4); ctx.lineTo(R - 11, 0); ctx.lineTo(R - 1, 4); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = armed ? "#ff3b30" : "#7a2a26";
    ctx.beginPath(); ctx.arc(0, 0, 6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    // Lifetime: a thin draining arc (upright, not squashed).
    ctx.save();
    ctx.globalAlpha = 0.7 * fade;
    ctx.strokeStyle = "#ff8f86";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(tr.x, tr.y - R * 0.62 - 14, 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, left / tr.life));
    ctx.stroke();
    ctx.restore();
  };

  /** Pickup token: navy disc, gold rim, icon, label plate (Air Hockey style). */
  CoinRush.prototype.drawPickup = function (ctx, pk, now) {
    if (pk.type === "reverse") { this.drawReversePickup(ctx, pk, now); return; }
    var boots = pk.type === "boots";
    var col = boots ? "#7bd88f" : "#ff6a5c";
    var left = PICKUP_LIFE - pk.age;
    var pop = ESA.easeOutBack(Math.min(1, pk.age / 0.35));
    var alpha = Math.min(1, left / 0.6) * (left < 2 ? 0.55 + 0.45 * Math.abs(Math.sin(pk.age * 9)) : 1);
    var bob = Math.sin(now / 260) * 3;
    var r = PICKUP_R;
    ctx.save();
    ctx.translate(pk.x, pk.y + bob);
    ctx.globalAlpha = alpha;
    ctx.scale(pop, pop);
    if (!ESA.Quality || ESA.Quality.fx.glows) {
      ctx.globalAlpha = alpha * 0.2;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.fillStyle = "#081a30";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 3; ctx.strokeStyle = ESA.COLORS.gold; ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = col;
    ctx.beginPath(); ctx.arc(0, 0, r - 4, 0, Math.PI * 2); ctx.stroke();
    if (boots) drawBoot(ctx, r * 0.62); else drawMagnet(ctx, r * 0.62);
    // Label plate.
    ctx.font = "800 10px " + ESA.FONT_DISPLAY;
    ctx.letterSpacing = "1.5px";
    var label = boots ? "BOOTS" : "MAGNET";
    var tw = ctx.measureText(label).width + 12;
    ESA.roundRect(ctx, -tw / 2, r + 6, tw, 15, 7);
    ctx.fillStyle = "rgba(7,23,40,.92)"; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = col; ctx.stroke();
    ctx.fillStyle = "#fff6e4"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, 0.75, r + 14);
    ctx.restore();
  };

  /*
   * REVERSE: a CURSED pickup, so it deliberately breaks the pickup look -
   * no gold rim (good pickups have one), a dark violet core, a spinning
   * dashed hazard rim, crossed "swap" arrows and a nervous jitter.
   */
  CoinRush.prototype.drawReversePickup = function (ctx, pk, now) {
    var left = PICKUP_LIFE - pk.age;
    var pop = ESA.easeOutBack(Math.min(1, pk.age / 0.35));
    var alpha = Math.min(1, left / 0.6) * (left < 2 ? 0.55 + 0.45 * Math.abs(Math.sin(pk.age * 9)) : 1);
    var r = PICKUP_R;
    var jx = Math.sin(now / 37) * 1.4, jy = Math.cos(now / 53) * 1.2;
    ctx.save();
    ctx.translate(pk.x + jx, pk.y + Math.sin(now / 260) * 3 + jy);
    ctx.globalAlpha = alpha;
    ctx.scale(pop, pop);
    if (!ESA.Quality || ESA.Quality.fx.glows) {
      ctx.globalAlpha = alpha * (0.2 + 0.1 * Math.sin(now / 120));
      ctx.fillStyle = REVERSE_COLOR;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.9, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = alpha;
    }
    ctx.fillStyle = "#1c0b2e";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
    ctx.save();
    ctx.rotate(-now / 700);
    ctx.lineWidth = 3; ctx.strokeStyle = REVERSE_COLOR; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
    if (ESA.PowerUps && ESA.PowerUps.drawReverseArrows) ESA.PowerUps.drawReverseArrows(ctx, r * 0.62, "#e2c8ff");
    ctx.font = "800 10px " + ESA.FONT_DISPLAY;
    ctx.letterSpacing = "1.5px";
    var tw = ctx.measureText("REVERSE").width + 12;
    ESA.roundRect(ctx, -tw / 2, r + 6, tw, 15, 7);
    ctx.fillStyle = "rgba(28,11,46,.94)"; ctx.fill();
    ctx.lineWidth = 1.2; ctx.strokeStyle = REVERSE_COLOR; ctx.stroke();
    ctx.fillStyle = "#e2c8ff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("REVERSE", 0.75, r + 14);
    ctx.restore();
  };

  function drawBoot(ctx, s) {
    ctx.save();
    ctx.fillStyle = "#7bd88f"; ctx.strokeStyle = "#103a1c"; ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(-s * 0.3, -s); ctx.lineTo(s * 0.25, -s); ctx.lineTo(s * 0.25, s * 0.2);
    ctx.lineTo(s * 1.0, s * 0.45); ctx.lineTo(s * 1.0, s * 0.85); ctx.lineTo(-s * 0.45, s * 0.85);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // Wing.
    ctx.fillStyle = "#fff6e4";
    ctx.beginPath(); ctx.moveTo(-s * 0.3, -s * 0.5); ctx.lineTo(-s * 1.05, -s * 0.85); ctx.lineTo(-s * 0.85, -s * 0.35);
    ctx.lineTo(-s * 1.1, -s * 0.2); ctx.lineTo(-s * 0.3, -s * 0.05); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawMagnet(ctx, s) {
    ctx.save();
    ctx.lineWidth = s * 0.55; ctx.lineCap = "butt";
    ctx.strokeStyle = "#ff5a4f";
    ctx.beginPath(); ctx.arc(0, -s * 0.05, s * 0.7, Math.PI, 0, true); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.7, -s * 0.05); ctx.lineTo(-s * 0.7, -s * 0.85);
    ctx.moveTo(s * 0.7, -s * 0.05); ctx.lineTo(s * 0.7, -s * 0.85); ctx.stroke();
    ctx.strokeStyle = "#e6ecf5";
    ctx.beginPath(); ctx.moveTo(-s * 0.7, -s * 0.6); ctx.lineTo(-s * 0.7, -s * 0.95);
    ctx.moveTo(s * 0.7, -s * 0.6); ctx.lineTo(s * 0.7, -s * 0.95); ctx.stroke();
    ctx.restore();
  }

  /** Faint pulsing field so everyone can see the magnet's reach. */
  CoinRush.prototype.drawMagnetField = function (ctx, p, now) {
    var b = ESA.bodyBounds(p);
    ctx.save();
    ctx.globalAlpha = 0.16 + 0.06 * Math.sin(now / 160);
    ctx.strokeStyle = "#ff6a5c";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.lineDashOffset = now / 40;
    ctx.beginPath(); ctx.arc(b.cx, b.cy, MAGNET_R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  };

  /** Above-head status: dizzy stars when trapped, small timed pills otherwise. */
  CoinRush.prototype.drawEffects = function (ctx, p, now) {
    var f = p.fx, top = ESA.bodyTop(p) - 14;
    if (f.stun > 0 && ESA.PowerUps) ESA.PowerUps.drawDizzy(ctx, p.x, top + 6, now / 1000);
    var items = [];
    if (f.stun > 0) items.push(["STUNNED", f.stun, "#ffd766"]);
    if (f.boots > 0) items.push(["BOOTS", f.boots, "#7bd88f"]);
    if (f.magnet > 0) items.push(["MAGNET", f.magnet, "#ff8f86"]);
    if (f.reverse > 0) items.push(["REVERSED", f.reverse, REVERSE_COLOR]);
    if (f.boots > 0 && (!ESA.Quality || ESA.Quality.fx.trails)) {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = "#7bd88f";
      ctx.beginPath(); ctx.ellipse(p.x, p.y + 2, 30, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    for (var i = 0; i < items.length; i++) {
      var it = items[i], y = top - 18 - i * 18, w = 88;
      ctx.save();
      ESA.roundRect(ctx, p.x - w / 2, y - 8, w, 16, 8);
      ctx.fillStyle = "rgba(4,14,26,.88)"; ctx.fill();
      ctx.lineWidth = 1.2; ctx.strokeStyle = it[2]; ctx.stroke();
      ctx.font = "800 9px " + ESA.FONT_DISPLAY;
      ctx.letterSpacing = "1px";
      ctx.textBaseline = "middle";
      ctx.fillStyle = it[2]; ctx.textAlign = "left";
      ctx.fillText(it[0], p.x - w / 2 + 7, y + 0.5);
      ctx.fillStyle = "#fff6e4"; ctx.textAlign = "right";
      ctx.fillText((it[1] / 1000).toFixed(1), p.x + w / 2 - 6, y + 0.5);
      ctx.restore();
    }
  };

  CoinRush.prototype.drawToken = function (ctx, t, now) {
    if (t.collected && t.popT <= 0) return;

    var img = ESA.Assets.get(t.bonus ? "tokenBonus" : "token");
    var size = t.bonus ? BONUS_SIZE : TOKEN_SIZE;
    var bob = Math.sin(t.phase) * (t.bonus ? 6 : 4.5);
    var grow = ESA.easeOutBack(ESA.clamp(t.born, 0, 1));

    // Collected tokens pop outward as they vanish (expired ones shrink away).
    var pop = t.collected ? (t.expired ? t.popT : 1 + (1 - t.popT) * 0.9) : 1;
    var alpha = t.collected ? t.popT : 1;
    // The +3 token blinks in its final second and a half.
    if (t.bonus && !t.collected && t.life < 1.5) alpha *= 0.55 + 0.45 * Math.abs(Math.sin(t.life * 10));

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

    /* --- Lifetime ring on the bonus token (drains clockwise) --------- */
    if (t.bonus && !t.collected && isFinite(t.life)) {
      var frac = ESA.clamp(t.life / BONUS_LIFE, 0, 1);
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineWidth = 4;
      ctx.strokeStyle = "rgba(7,23,40,.55)";
      ctx.beginPath(); ctx.arc(0, 0, size * 0.5 + 6, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = frac < 0.3 ? "#ff8f86" : "#fff6e4";
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(0, 0, size * 0.5 + 6, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
      ctx.restore();
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
                 "A normal token is worth 1. The rare glowing token is worth 3 - but only for a few seconds. " +
                 "Grab <b>Speed Boots</b> and <b>Magnets</b>, dodge the <b>traps</b> (4 s stun) - and avoid the cursed <b>Reverse</b>, it flips your own controls. Most points wins.",
    mode: MATCH_SECONDS + " seconds",
    icon: { img: "assets/Branding/Golden Canadian Pharaoh Emblem.png" },
    controls: "arena",
    touch: { movement: "joystick", actions: [], help: ["JOYSTICK — MOVE", "TOKENS — COLLECT AS MANY AS YOU CAN", "TRAPS — 4 S STUN · BOOTS / MAGNET — HELP", "REVERSE — CURSED: FLIPS YOUR CONTROLS"],
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
                         "Normal tokens are worth 1, the rare glowing token is worth 3 for a few seconds. In Solo the tokens " +
                         "<b>move</b> - chase them. Grab Speed Boots and Magnets, dodge traps and the cursed Reverse. Beat your session best.",
            touchDescription: "A solo run. ESA tokens drop across the arena - <b>use the joystick to run over them</b>. " +
                              "Gold tokens are worth 3 for a few seconds. The tokens move - chase them, grab Boots and Magnets, dodge traps and the cursed Reverse. Beat your session best." },
    enabled: true,
    create: function (api, setup) { return new CoinRush(api, setup); }
  });

})(window.ESA);
