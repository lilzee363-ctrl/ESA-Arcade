/* ==========================================================================
   ESA ARCADE - Air Hockey CPU strategy (V4.1)
   Plugs into the generic CPU controller (js/cpu.js). It only ever outputs a
   stick direction (length <= 1, FULL deflection on every difficulty) and an
   occasional DASH press; the game applies the same speed limit,
   acceleration, centre line, dash strength / cooldown, stun, SHRINK and
   REVERSE it applies to a human. Hard is never physically faster.

   OBJECTIVES (re-decided every `decision` seconds, adopted after a
   human-like reaction delay; between decisions the stick just steers)
     RECOVER   the puck slipped behind us: circle round it on the goal side
               instead of knocking it into our own net.
     DEFEND    a shot is on target and we can't meet it upstream: get on
               the line between the puck's predicted crossing and our goal
               (dash there if it's the only way in time).
     INTERCEPT a moving puck we CAN reach on our half: pick the earliest
               spot on its predicted path we get to first, already lined
               up toward their goal, and hit it back on the way through.
     ATTACK    a loose / slow puck on our half: move BEHIND it relative to
               an aim point in their goal (going round it if needed), take
               a short run-up, then STRIKE through it (dash on the strike
               when it pays). Never a random bump: the contact point,
               approach line and aim are all chosen.
     POWERUP   a pickup is on the line and it's safe (no threat, the puck
               is away or slow): go and take it, dashing if it's contested.
     READY     nothing to do yet: stand on the puck-to-goal line, pressing
               up toward the centre while the puck is far on their side.

   PREDICTION is a short forward simulation of the puck (drag + wall
   bounces), only as far and as accurately as this CPU can "read":
   Easy sees straight lines and no bounces, Hard sees two bounces with drag.

   DIFFICULTY (shared profile, js/cpu.js) = decision quality only:
   reaction / decision cadence, prediction, aim and route error, mistake
   rate, how quickly it notices a pickup and how wisely it weighs it.

   It never reads hidden state: no spawn timers, no RNG, no future frames.
   It is never told it is REVERSED and never compensates - a reversed CPU
   really does run the wrong way, exactly like a human would at first.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var U = ESA.CPU.util;
  var rand = U.rand, clamp = U.clamp, chance = U.chance;

  /*
   * Air Hockey extras on top of the shared profile:
   *   horizon    s of puck flight it simulates (its "read")
   *   depth      px in front of our goal line where it defends
   *   press      px it creeps up from its ready spot when the puck is far away
   *   runup      px of run-up behind the puck before a strike
   *   strikeTol  how far off the shot line (x mallet radius) it still strikes
   *   setupMax   s of setting up before it takes the imperfect hit anyway
   *   commit     s an aim point stays chosen
   *   smartAim   chance to aim at the corner away from the goalie
   *   bank       chance to bank off a rail when the lane is blocked
   *   overcommit chance a strike runs on far past the puck
   *   dashRange  px from the contact point where a strike dash pays off
   */
  var PARAMS = ESA.CPU.tune({
    easy: {
      horizon: 0.75, depth: 90, press: 30, runup: 30, strikeTol: 1.25, setupMax: 1.3,
      commit: 0.45, smartAim: 0.2, bank: 0.05, overcommit: 0.25, dashRange: 80
    },
    normal: {
      horizon: 1.1, depth: 84, press: 70, runup: 50, strikeTol: 0.95, setupMax: 0.95,
      commit: 0.65, smartAim: 0.55, bank: 0.25, overcommit: 0.08, dashRange: 100
    },
    hard: {
      horizon: 1.45, depth: 78, press: 105, runup: 62, strikeTol: 0.75, setupMax: 0.7,
      commit: 0.8, smartAim: 0.85, bank: 0.45, overcommit: 0.03, dashRange: 116
    }
  });

  /* --- Puck simulation (preallocated, no per-decision garbage) -------- */
  var SIM_DT = 1 / 30, SIM_N = 48;
  var SX = new Float32Array(SIM_N), SY = new Float32Array(SIM_N), ST = new Float32Array(SIM_N);

  /**
   * Fills SX/SY/ST with the predicted puck path. Stops at the first wall
   * contact beyond the CPU's `bounces`, or when the puck enters a goal.
   * Returns { n, goal } where goal is -1 / +1 for the left / right goal.
   */
  var SIM = { n: 0, goal: 0, goalT: 0, goalY: 0 };
  function simulate(g, px, py, vx, vy, horizon, bounces, drag) {
    var keep = drag ? Math.pow(g.puckDrag, SIM_DT) : 1;
    var top = g.top + g.puckR, bot = g.bottom - g.puckR;
    var L = g.left + g.puckR, R = g.right - g.puckR;
    var n = 0, b = 0, t = 0;
    SIM.goal = 0;
    while (t < horizon && n < SIM_N) {
      t += SIM_DT;
      px += vx * SIM_DT; py += vy * SIM_DT;
      if (py < top || py > bot) {
        if (b >= bounces) break;
        if (py < top) py = top + (top - py); else py = bot - (py - bot);
        vy = -vy * g.wallE; b++;
      }
      var inMouth = py > g.mouthTop && py < g.mouthBot;
      if (!inMouth && (px < L || px > R)) {
        if (b >= bounces) break;
        if (px < L) px = L + (L - px); else px = R - (px - R);
        vx = -vx * g.wallE; b++;
      }
      vx *= keep; vy *= keep;
      SX[n] = px; SY[n] = py; ST[n] = t; n++;
      if (px < g.left || px > g.right) {
        SIM.goal = px < g.left ? -1 : 1; SIM.goalT = t; SIM.goalY = py;
        break;
      }
    }
    SIM.n = n;
    return SIM;
  }

  function Brain(opts) {
    this.slot = opts.slot;
    this.P = opts.profile || PARAMS.normal;
    this.reset();
  }

  Brain.prototype.reset = function () {
    this.clock = 0;
    this.nextThink = 0;
    // The plan being executed, and the one waiting out its reaction delay.
    this.cur = { mode: "ready", tx: NaN, ty: NaN, full: false, dash: false };
    this.pend = { mode: "ready", tx: 0, ty: 0, full: false, dash: false, at: -1 };
    this.aimY = 0;
    this.aimUntil = -1;
    this.setupT = 0;
    this.wasLive = false;
    // Pickup awareness: a new pickup is only "seen" after a notice delay.
    this.pickX = NaN; this.pickY = NaN; this.pickSeenAt = Infinity; this.pickWant = false; this.pickGamble = false;
  };

  /** A spot in their goal mouth (committed for `commit` seconds once chosen). */
  Brain.prototype.aim = function (v, px, py) {
    var g = v.geo, P = this.P;
    if (this.clock < this.aimUntil) return this.aimY;
    // Better CPUs pick the corner AWAY from the goalie (it's on screen).
    var spot = chance(P.smartAim) ? (v.opY < g.cy ? 1 : -1) * rand(0.35, 0.72) : rand(-0.6, 0.6);
    var ay = g.cy + spot * g.goalHalf + rand(-P.aimError, P.aimError);
    // Goalie parked in the direct lane? Better CPUs bank it off a rail.
    var farX = v.side > 0 ? g.left : g.right;
    var lane = py + (ay - py) * ((v.opX - px) / (farX - px || 1));
    if (Math.abs(lane - v.opY) < v.opR + g.puckR + 6 && chance(P.bank)) {
      ay = ay < g.cy ? 2 * (g.top + g.puckR) - ay : 2 * (g.bottom - g.puckR) - ay;
    }
    this.aimY = ay;
    this.aimUntil = this.clock + P.commit * rand(0.8, 1.2);
    return ay;
  };

  /**
   * ATTACK a contact point (cx, cy) that the puck will occupy in `tHit`
   * seconds (0 = it's there now). Writes the plan into p: SETUP behind it,
   * WAIT for a moving puck to arrive, or STRIKE through it.
   */
  Brain.prototype.attack = function (v, p, cx, cy, tHit, forceHit) {
    var g = v.geo, P = this.P, s = v.side, r = v.meR, pr = g.puckR;
    var speed = g.moveSpeed;
    var farX = s > 0 ? g.left - 10 : g.right + 10;
    var ay = this.aim(v, cx, cy);
    var dx = farX - cx, dy = ay - cy, d = Math.hypot(dx, dy) || 1;
    var ux = dx / d, uy = dy / d;
    var relX = cx - v.meX, relY = cy - v.meY;
    var along = relX * ux + relY * uy;                  // > 0: contact point is in front of us
    var across = relX * -uy + relY * ux;                // signed miss distance off the shot line
    var dist = Math.hypot(relX, relY);
    var tol = r * P.strikeTol;
    var tReach = Math.max(0, dist - (r + pr) * 0.8) / speed;

    var lined = along > 0 && Math.abs(across) < tol;
    if ((lined || forceHit) && tHit <= tReach + 0.12) {
      // STRIKE: drive straight through the contact point toward the aim.
      var far = chance(P.overcommit) ? 250 : 130;
      p.mode = "strike"; p.full = true;
      p.tx = cx + ux * far; p.ty = cy + uy * far;
      // Dash on the strike when it pays: ready, close, well lined up, lane open.
      var lane = cy + (ay - cy) * ((v.opX - cx) / (farX - cx || 1));
      var open = Math.abs(lane - v.opY) > v.opR + pr || v.opStunned;
      p.dash = v.dashReady && dist < P.dashRange + 20 && dist > r + pr - 4 &&
               Math.abs(across) < r * 0.75 && open && chance(P.dashUse);
      return;
    }
    // SETUP: the contact point minus a run-up, on the near side of the puck.
    var back = r + pr + 6 + P.runup;
    p.mode = "setup"; p.full = false;
    if (along < r * 0.35) {
      // Wrong side of the puck: go ROUND it (never through it), on the side
      // we are already on.
      var side = across >= 0 ? -1 : 1;
      var wing = r + pr + 20;
      p.tx = cx - ux * (r + pr) * 0.6 - uy * side * wing;
      p.ty = cy - uy * (r + pr) * 0.6 + ux * side * wing;
    } else {
      p.tx = cx - ux * back;
      p.ty = cy - uy * back;
    }
  };

  /* --- Decision ------------------------------------------------------ */
  Brain.prototype.think = function (v) {
    var g = v.geo, P = this.P, s = v.side, p = this.pend;
    if (this.cur.mode !== "ready" && this.cur.mode !== "powerup" && chance(P.hesitate)) return;

    var r = v.meR, pr = g.puckR, speed = g.moveSpeed;
    var goalX = s > 0 ? g.right : g.left;                // our goal line
    var px = v.puckX, py = v.puckY, pvx = v.puckVX, pvy = v.puckVY;
    var pSpeed = Math.hypot(pvx, pvy);
    var depthOf = function (x) { return s * (x - g.cx); };    // > 0: on our half
    var mistake = chance(P.mistake);
    var prevMode = this.cur.mode;
    p.full = false; p.dash = false;

    // Read the puck: as far ahead as this CPU can see. Poor readers blend
    // the prediction back toward "where it is now".
    var sim = simulate(g, px, py, pvx, pvy, P.horizon, P.bounces, P.prediction >= 0.6);
    var trust = P.prediction;
    var threat = sim.goal === s && sim.goalY > g.mouthTop - pr && sim.goalY < g.mouthBot + pr;
    var threatT = threat ? sim.goalT : Infinity;
    if (v.opStunned && threatT > 0.6) threat = false;   // nothing new is coming for a while

    var behind = depthOf(px) > -pr && s * (px - v.meX) > 2 && Math.abs(px - goalX) > pr + 4;

    // Earliest reachable contact on our half along the predicted path.
    var hitK = -1, hitT = 0, cleanK = -1;
    if (pSpeed > 70 && !behind) {
      for (var k = 0; k < sim.n; k++) {
        var x = SX[k], y = SY[k];
        if (depthOf(x) < -pr * 0.5) continue;                     // still on their half
        if (s * (goalX - x) < r * 0.8) break;                     // already at our line
        var bx = px + (x - px) * trust, by = py + (y - py) * trust;   // what it THINKS
        var tMe = Math.max(0, Math.hypot(bx - v.meX, by - v.meY) - (r + pr) * 0.7) / speed + 0.05;
        if (tMe <= ST[k]) {
          if (hitK < 0) { hitK = k; hitT = ST[k]; }
          // Room for a run-up from behind as well? Then it's a clean shot.
          // ...with SLACK, so it is waiting behind the spot when the puck
          // arrives instead of reaching it at the same instant (which only
          // produces a sideways deflection, not a shot).
          var tClean = (Math.hypot(bx + s * (r + pr + P.runup) - v.meX, by - v.meY) + P.runup + r) / speed;
          if (tClean + 0.18 <= ST[k]) { cleanK = k; break; }
        }
      }
    }

    // Pickup awareness: notice a NEW pickup only after a human-ish delay.
    if (v.hasPickup) {
      if (v.pickupX !== this.pickX || v.pickupY !== this.pickY) {
        this.pickX = v.pickupX; this.pickY = v.pickupY;
        this.pickSeenAt = this.clock + rand(P.notice[0], P.notice[1]);
        this.pickWant = false;
        this.pickGamble = chance((1 - P.opportunity) * 0.6);
      }
    } else {
      this.pickX = this.pickY = NaN; this.pickSeenAt = Infinity; this.pickWant = false;
    }

    if (behind) {
      /* --- RECOVER ------------------------------------------------- */
      // Go AROUND, never through: first side-step out of the puck's row
      // (keeping our distance), then slip in on its goal side.
      var side = v.meY <= py ? -1 : 1;
      var clear = r + pr + 22;
      p.mode = "recover";
      p.full = true;
      if (Math.abs(v.meY - py) < clear - 4 && Math.abs(v.meX - px) < clear + 30) {
        p.tx = v.meX - s * 6;                       // a touch away from the puck, never into it
        p.ty = py + side * clear;
      } else {
        p.tx = px + s * (r + pr + 16);
        p.ty = py + side * clear * (Math.abs(v.meX - px) < clear ? 1 : 0.6);
      }
      if (Math.abs(px - goalX) < 140 && v.dashReady && chance(P.dashUse * 0.5)) p.dash = true;
    } else if (cleanK >= 0 && (!threat || threatT > 1.1 || ST[cleanK] < threatT * 0.5)) {
      /* --- INTERCEPT (and hit it back on the way through) ---------- */
      // Only when there is real time: a shot already on target is BLOCKED
      // first (DEFEND below) - a block rebounds it forward anyway.
      var ix = px + (SX[cleanK] - px) * trust, iy = py + (SY[cleanK] - py) * trust;
      if (mistake) { ix += rand(-28, 28); iy += rand(-28, 28); }
      this.attack(v, p, ix, iy, ST[cleanK], false);
      if (p.mode === "setup") p.mode = "intercept";
    } else if (threat && !(pSpeed < 170 && s * (v.meX - px) > r * 0.5)) {
      /* --- DEFEND (a slow dribble in front of us is cleared instead) */
      var defX = goalX - s * P.depth;
      var dy = sim.goalY;
      // The line from the shot to the goal mouth, at our defence depth.
      for (var j = 0; j < sim.n; j++) { if (s * (SX[j] - defX) >= 0) { dy = SY[j]; break; } }
      dy = py + (dy - py) * Math.max(trust, 0.5) + rand(-P.routeError, P.routeError) * (mistake ? 3 : 1);
      p.mode = "defend";
      p.tx = defX;
      p.ty = clamp(dy, g.mouthTop - r * 1.2, g.mouthBot + r * 1.2);
      var gap = Math.hypot(p.tx - v.meX, p.ty - v.meY);
      p.full = gap > 30;
      // The only way to get there in time? Dash.
      if (v.dashReady && gap > 90 && gap / speed > threatT * 0.85 && chance(P.dashUse)) p.dash = true;
    } else if (depthOf(px) > -pr * 0.8 && pSpeed <= 300) {
      /* --- ATTACK a loose / slow puck on our half ------------------- */
      var lead = 0.12 * trust;
      var lx = clamp(px + pvx * lead, g.left + pr, g.right - pr);
      var ly = clamp(py + pvy * lead, g.top + pr, g.bottom - pr);
      if (mistake) { lx += rand(-24, 24); ly += rand(-24, 24); }   // misjudged contact point
      this.attack(v, p, lx, ly, 0, this.setupT > P.setupMax);
    } else if (hitK >= 0 && depthOf(px) > -pr) {
      /* --- A fast puck loose on our half (not on target): meet it ---- */
      var hx = px + (SX[hitK] - px) * trust, hy = py + (SY[hitK] - py) * trust;
      this.attack(v, p, hx, hy, hitT, true);
      if (p.mode === "setup") p.mode = "intercept";
    } else if (this.wantPickup(v, sim, threat)) {
      /* --- POWERUP ------------------------------------------------- */
      p.mode = "powerup";
      p.tx = g.cx + s * (r + 1);
      p.ty = v.pickupY + rand(-P.routeError, P.routeError) * 0.3;
      p.full = true;
      var dMe = Math.hypot(p.tx - v.meX, p.ty - v.meY);
      var dOp = Math.hypot(g.cx - s * (v.opR + 1) - v.opX, v.pickupY - v.opY);
      // Contested and far enough to matter: dash for it.
      if (v.dashReady && dMe > 110 && dOp < dMe * 1.15 && chance(P.dashUse)) p.dash = true;
    } else {
      /* --- READY: on the puck-to-goal line, pressing up when it's safe */
      p.mode = "ready";
      var far = depthOf(px) < -120 && s * pvx <= 40;
      var rx = goalX - s * (P.depth + 50 + (far ? P.press : 0));
      // Stand on the line from the puck to the centre of our goal.
      var k2 = Math.abs(rx - goalX) / Math.max(1, Math.abs(px - goalX));
      var ry = g.cy + (py - g.cy) * clamp(k2, 0, 1);
      p.tx = rx;
      p.ty = ry + rand(-P.routeError, P.routeError) * (mistake ? 3 : 1);
    }

    // Setup clock: only grows while it keeps setting up the same attack.
    if (p.mode !== "setup") this.setupT = 0;

    // Our own half only (the game clamps too - this just avoids aiming at walls).
    var minX = s > 0 ? g.cx + r : g.left + r, maxX = s > 0 ? g.right - r : g.cx - r;
    p.tx = clamp(p.tx, minX, maxX);
    p.ty = clamp(p.ty, g.top + r, g.bottom - r);
    // Continuing the same idea keeps its momentum; a new one waits out a
    // reaction delay (a goal threat that just appeared is a new idea).
    var same = p.mode === prevMode || (prevMode === "setup" && p.mode === "strike") ||
               (prevMode === "intercept" && p.mode === "strike");
    p.at = this.clock + U.reactDelay(P, same);
  };

  /**
   * Is a pickup worth it right now? Only once noticed, never with a shot
   * coming, and only when the puck can't punish the trip. Poor judges
   * sometimes misread the risk (bad timing) - that's the Easy mistake.
   */
  Brain.prototype.wantPickup = function (v, sim, threat) {
    if (!v.hasPickup || this.clock < this.pickSeenAt) return false;
    var g = v.geo, P = this.P, s = v.side, r = v.meR;
    var dMe = Math.max(0, Math.hypot(g.cx + s * (r + 1) - v.meX, v.pickupY - v.meY) - 40);
    var tMe = dMe / g.moveSpeed;
    var depth = s * (v.puckX - g.cx);
    var coming = s * v.puckVX > 60;                         // heading to our half
    var tPuck = coming ? Math.max(0, -depth) / Math.max(60, s * v.puckVX) : Infinity;
    var safe = !threat && (depth < -60 || Math.hypot(v.puckVX, v.puckVY) < 120) && tPuck > tMe * 1.6 + 0.25;
    if (safe) { this.pickWant = true; return true; }
    // Risky moment: good judges wait; poor judges sometimes go anyway (or
    // overstay a trip that has turned risky). Decided ONCE per pickup, so
    // it is a consistent read, not a coin flip every decision. A shot on
    // target is never ignored - DEFEND outranks POWERUP in think().
    return this.pickGamble;
  };

  /* --- Per frame ------------------------------------------------------ */
  Brain.prototype.update = function (dt, v, out) {
    out.x = 0; out.y = 0;
    if (!v.geo) return;
    this.clock += dt;

    // Countdown, goal celebrations, match end: hands off. A fresh faceoff
    // starts with a fresh read after a human-like beat.
    if (!v.live) {
      this.wasLive = false; this.cur.tx = NaN; this.cur.mode = "ready"; this.setupT = 0; this.pickWant = false;
      return;
    }
    if (!this.wasLive) {
      this.wasLive = true;
      this.nextThink = this.clock + rand(this.P.reaction[0], this.P.reaction[1]);
      this.pend.at = -1;
      this.aimUntil = -1;
    }
    // STUNNED: no stick, no dash, and the plan goes stale.
    if (v.stunned) { this.cur.tx = NaN; this.cur.mode = "ready"; this.pend.at = -1; this.setupT = 0; return; }

    if (this.cur.mode === "setup" || this.cur.mode === "intercept") this.setupT += dt;

    if (this.clock >= this.nextThink) {
      this.think(v);
      this.nextThink = this.clock + U.nextDecision(this.P);
    }
    var p = this.pend;
    if (p.at >= 0 && this.clock >= p.at) {
      var c = this.cur;
      c.mode = p.mode; c.tx = p.tx; c.ty = p.ty; c.full = p.full; c.dash = p.dash;
      p.at = -1;
    }

    var cur = this.cur;
    if (isNaN(cur.tx)) return;
    var dx = cur.tx - v.meX, dy = cur.ty - v.meY;
    var d = Math.hypot(dx, dy);
    if (d < 3) return;
    // Full deflection while striking / racing; ease in near any other spot
    // so it settles instead of jittering (a thumb does the same).
    var mag = cur.full ? 1 : Math.min(1, d / 34);
    out.x = dx / d * mag;
    out.y = dy / d * mag;

    if (cur.dash) {
      cur.dash = false;                     // one press per decision
      // The stick above is already pointing at the target, so the dash
      // (resolved from the current stick by the game) goes the same way.
      if (v.dashReady && d > 20) out.action = "action1";
    }
  };

  ESA.CPU.registerStrategy("airHockey", {
    params: PARAMS,
    create: function (opts) { return new Brain(opts); }
  });

})(window.ESA);
