/* ==========================================================================
   ESA ARCADE - Air Hockey CPU strategy
   Plugs into the generic CPU controller (js/cpu.js). It only ever outputs
   a stick direction (length <= 1) and an occasional DASH press; the game
   applies speed limits, the centre line, cooldowns, stun and REVERSE.

   HOW IT THINKS (cheap on purpose - a few dozen flops per decision)
   -----------------------------------------------------------------
   Every `think` seconds (+ jitter) it takes a snapshot of the puck and
   picks a STATE and a target point:
     DEFEND     puck coming at our goal fast: predict where it crosses our
                defence line (straight line + up to N wall bounces) and get
                in front of it.
     INTERCEPT  puck coming at us, but slowly enough to meet it early:
                step out to where it will be, lined up toward their goal,
                and hit it back on the way through.
     SETUP      puck loose on our half: get BEHIND it relative to an aim
                point in their goal (going round it if we are on the wrong
                side), with a short run-up. The aim is COMMITTED for a
                moment so the setup point does not keep jumping around.
     STRIKE     lined up well enough: drive THROUGH the puck toward the
                aim (dash if it is ready, close, and the lane is worth it).
     RECOVER    puck got behind us: circle round it on the goal side
                instead of shoving it into our own net.
     NEUTRAL    puck on their half: guard the goal, shading its lane, and
                maybe grab a pickup when it is safe.
   Setup never loops forever: after `setupMax` seconds without a clean line
   it takes the imperfect hit if the puck is in front of it, otherwise it
   backs off to defend for a beat.

   Human-like: a new plan only takes effect after a REACTION delay, aim and
   positions carry per-decision noise, some decisions are deliberate
   mistakes (hesitate / misjudge / overcommit). Between decisions the stick
   just steers toward the current target.

   It never reads hidden state: no spawn timers, no RNG, no future frames.
   It does not know it is REVERSED and never compensates - a reversed CPU
   really does run the wrong way, exactly like a human would at first.
   ========================================================================== */

(function (ESA) {
  "use strict";

  /**
   * Difficulty = behaviour only (the drawn character never matters).
   *   think      seconds between decisions (plus up to 35% jitter)
   *   react      [min, max] seconds before a new decision takes effect
   *   aimNoise   px of random error on the aim point in the far goal
   *   posNoise   px of random error on defensive / intercept positions
   *   maxStick   max stick deflection (1 = the game's normal top speed -
   *              never more; Hard is exactly as fast as a human)
   *   bounces    wall bounces it can foresee (0 = straight line only)
   *   drag       true: accounts for puck slow-down when predicting
   *   lead       seconds it leads a moving puck when setting up a shot
   *   attack     chance per decision to go for a loose puck on our half
   *   intercept  chance to step out and meet a slow incoming puck
   *   interceptMax  incoming puck speed (px/s) it still dares to meet
   *   strikeTol  how far off the line (x mallet radius) it still strikes
   *   setupMax   seconds of setup before it takes the imperfect hit
   *   commit     seconds an aim point stays chosen
   *   dash       chance to use a ready dash when lined up for a shot
   *   dashRange  px from the puck where it considers dashing
   *   runup      extra px it backs off behind the puck before striking
   *   smartAim   chance to aim at the corner away from the goalie
   *   bank       chance to aim a bank shot off a rail when the lane is blocked
   *   pickup     chance per decision to go for a pickup when it is safe
   *   mistake    chance per decision of a misjudged position
   *   hesitate   chance per decision to just keep doing what it was doing
   *   overcommit chance a strike runs on far past the puck
   *   depth      px in front of our goal line where it defends
   *   press      px it creeps forward from its deep spot when the puck is
   *              far away on their half (ready for the rebound)
   */
  var PARAMS = {
    easy: {
      think: 0.30, react: [0.20, 0.32], aimNoise: 50, posNoise: 30, maxStick: 0.72,
      bounces: 0, drag: false, lead: 0, attack: 0.62, intercept: 0.2, interceptMax: 260,
      strikeTol: 1.15, setupMax: 1.5, commit: 0.4, dash: 0.1, dashRange: 70, runup: 26,
      smartAim: 0.12, bank: 0, pickup: 0.12, mistake: 0.18, hesitate: 0.16, overcommit: 0.3,
      depth: 96, press: 0
    },
    normal: {
      think: 0.17, react: [0.11, 0.18], aimNoise: 26, posNoise: 13, maxStick: 0.9,
      bounces: 1, drag: false, lead: 0.1, attack: 0.9, intercept: 0.6, interceptMax: 430,
      strikeTol: 0.95, setupMax: 1.0, commit: 0.65, dash: 0.42, dashRange: 96, runup: 56,
      smartAim: 0.5, bank: 0.25, pickup: 0.35, mistake: 0.07, hesitate: 0.05, overcommit: 0.08,
      depth: 86, press: 40
    },
    hard: {
      think: 0.10, react: [0.065, 0.11], aimNoise: 12, posNoise: 6, maxStick: 1,
      bounces: 2, drag: true, lead: 0.16, attack: 0.96, intercept: 0.6, interceptMax: 450,
      strikeTol: 0.8, setupMax: 0.75, commit: 0.8, dash: 0.75, dashRange: 110, runup: 70,
      smartAim: 0.85, bank: 0.5, pickup: 0.55, mistake: 0.025, hesitate: 0.015, overcommit: 0.03,
      depth: 80, press: 70
    }
  };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function chance(p) { return Math.random() < p; }

  /**
   * Where will the puck's centre be when it reaches x = lineX? Returns
   * { y, t } in a reused object, or null if it is not heading there
   * within `horizon` seconds. One division; wall bounces folded
   * analytically, but only as many as this CPU can "see".
   */
  var PRED = { y: 0, t: 0 };
  function predict(g, px, py, vx, vy, lineX, bounces, useDrag, horizon) {
    if (Math.abs(vx) < 1) return null;
    var dx = lineX - px;
    if (dx / vx <= 0) return null;
    var t, travel;
    if (useDrag) {
      // x(t) = px + vx (1 - e^{-kt}) / k  with k = -ln(drag); same for y.
      var k = -Math.log(g.puckDrag);
      var f = 1 - (dx * k) / vx;            // = e^{-kt}
      if (f <= 0.02) return null;           // stops before it gets there
      t = -Math.log(f) / k;
      travel = vy * (1 - f) / k;
    } else {
      t = dx / vx;
      travel = vy * t;
    }
    if (t > horizon) return null;
    var top = g.top + g.puckR, bot = g.bottom - g.puckR;
    var y = py + travel;
    for (var i = 0; i < bounces && (y < top || y > bot); i++) {
      if (y < top) y = top + (top - y) * g.wallE;
      else y = bot - (y - bot) * g.wallE;
    }
    PRED.y = clamp(y, top, bot);            // beyond its foresight: just the rail
    PRED.t = t;
    return PRED;
  }

  function Brain(opts) {
    this.slot = opts.slot;
    this.P = PARAMS[opts.difficulty] || PARAMS.normal;
    this.reset();
  }

  Brain.prototype.reset = function () {
    this.clock = 0;
    this.nextThink = 0;
    // The plan being executed, and the one waiting out its reaction delay.
    this.cur = { mode: "neutral", tx: NaN, ty: NaN, strike: false, dash: false };
    this.pend = { mode: "neutral", tx: 0, ty: 0, strike: false, dash: false, at: -1 };
    this.aimY = 0;                // committed aim point in their goal
    this.aimUntil = -1;
    this.setupT = 0;              // seconds spent setting up the current attack
    this.noAttackUntil = -1;      // short back-off after a failed setup
    this.wasLive = false;
  };

  /** A spot in their goal mouth: kept for `commit` seconds once chosen. */
  Brain.prototype.aim = function (v, px, py) {
    var g = v.geo, P = this.P;
    if (this.clock < this.aimUntil) return this.aimY;
    // Better CPUs pick the corner AWAY from the goalie (it's on screen).
    var spot = chance(P.smartAim) ? (v.opY < g.cy ? 1 : -1) * rand(0.35, 0.72) : rand(-0.65, 0.65);
    var ay = g.cy + spot * g.goalHalf + rand(-P.aimNoise, P.aimNoise);
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
   * Line up behind (px, py) toward the aim and either set up or strike.
   * Writes the plan into `p`. Returns true if it is a strike.
   */
  Brain.prototype.lineUp = function (v, p, px, py, forceHit) {
    var g = v.geo, P = this.P, s = v.side, r = v.meR, pr = g.puckR;
    var farX = s > 0 ? g.left : g.right;
    var ay = this.aim(v, px, py);
    var dx = farX - px, dy = ay - py, d = Math.hypot(dx, dy) || 1;
    var ux = dx / d, uy = dy / d;
    var relX = px - v.meX, relY = py - v.meY;
    var along = relX * ux + relY * uy;                     // > 0: puck is in front of us
    var across = relX * -uy + relY * ux;                   // signed miss distance
    var tol = r * P.strikeTol;
    if (along > 0 && (Math.abs(across) < tol || forceHit)) {
      // STRIKE: drive straight through the puck toward the aim.
      var far = chance(P.overcommit) ? 260 : 140;
      p.mode = "strike";
      p.strike = true;
      p.tx = px + ux * far;
      p.ty = py + uy * far;
      var dist = Math.hypot(relX, relY);
      // Dash only when it pays: ready, close, well lined up, lane not shut.
      var lane = py + (ay - py) * ((v.opX - px) / (farX - px || 1));
      var open = Math.abs(lane - v.opY) > v.opR + pr || Math.abs(v.opX - px) < r * 2;
      p.dash = v.dashReady && dist < P.dashRange && Math.abs(across) < r * 0.7 && open && chance(P.dash);
      return true;
    }
    // SETUP: the contact point minus a run-up.
    var back = r + pr + 6 + P.runup;
    p.mode = "setup";
    if (along < r * 0.4) {
      // Wrong side of the puck: go round it (never through it), on the
      // side we are already on.
      var side = across >= 0 ? -1 : 1;
      var wing = r + pr + 18;
      p.tx = px - ux * (r + pr) * 0.6 + -uy * side * wing;
      p.ty = py - uy * (r + pr) * 0.6 + ux * side * wing;
    } else {
      p.tx = px - ux * back;
      p.ty = py - uy * back;
    }
    return false;
  };

  /* --- Decision ------------------------------------------------------ */
  Brain.prototype.think = function (v) {
    var g = v.geo, P = this.P, s = v.side;
    var p = this.pend;

    // Hesitation: sometimes it simply keeps doing what it was doing.
    if (this.cur.mode !== "neutral" && chance(P.hesitate)) return;

    var goalX = s > 0 ? g.right : g.left;          // ours
    var r = v.meR, pr = g.puckR;
    var px = v.puckX, py = v.puckY, pvx = v.puckVX, pvy = v.puckVY;
    var toward = s * pvx;                           // > 0: coming at our goal
    var speed = Math.hypot(pvx, pvy);
    // "Ours" = reachable from our half: a puck resting on the centre line
    // (every kickoff) is still within a mallet's reach from our side.
    var onOurs = s * (px - g.cx) > -pr * 0.8;
    var defX = goalX - s * P.depth;
    var homeY = g.cy + (py - g.cy) * 0.45;
    var mistake = chance(P.mistake);
    var prevMode = this.cur.mode;
    p.strike = false; p.dash = false;

    var behindUs = onOurs && s * (px - v.meX) > -4;
    var pred;

    if (behindUs && Math.abs(px - goalX) > pr + 4) {
      // RECOVER: the puck is between us and our own goal.
      var around = (v.meY <= py ? -1 : 1) * (r + pr + 18);
      p.mode = "recover";
      p.tx = px + s * (r + pr + 14);
      p.ty = py + around;
    } else if (toward > 40 && toward < P.interceptMax && !mistake &&
               (prevMode === "intercept" || chance(P.intercept)) &&
               (pred = predict(g, px, py, pvx, pvy, goalX - s * (P.depth + 45), P.bounces, P.drag, 1.4)) &&
               Math.hypot(goalX - s * (P.depth + 45) - v.meX, pred.y - v.meY) < g.moveSpeed * P.maxStick * pred.t * 0.7) {
      // INTERCEPT: a slow incoming puck we can comfortably beat to the
      // spot. Get into its path a little in front of the goal, already
      // lined up toward their goal, wait, and only strike when it arrives
      // - never charge out and leave the net open.
      var ix = goalX - s * (P.depth + 45), iy = pred.y + rand(-P.posNoise, P.posNoise) * 0.5;
      if (Math.hypot(px - v.meX, py - v.meY) < r + pr + 60) {
        this.lineUp(v, p, px, py, true);           // it's here: hit it back
      } else {
        var farX2 = s > 0 ? g.left : g.right;
        var ay2 = this.aim(v, ix, iy);
        var ddx = farX2 - ix, ddy = ay2 - iy, dl = Math.hypot(ddx, ddy) || 1;
        p.mode = "intercept";
        p.tx = ix - ddx / dl * (r + pr + 4);
        p.ty = iy - ddy / dl * (r + pr + 4);
      }
    } else if (toward > (onOurs ? 140 : 60)) {
      // DEFEND: get in front of where it will cross our defence line.
      pred = predict(g, px, py, pvx, pvy, defX, P.bounces, P.drag, 0.6 + P.bounces * 0.45);
      var y = pred ? pred.y : homeY;              // too far ahead to read: shade the lane
      y += rand(-P.posNoise, P.posNoise) * (mistake ? 3 : 1);
      p.mode = "defend";
      p.tx = defX;
      p.ty = clamp(y, g.mouthTop - r * 1.2, g.mouthBot + r * 1.2);
    } else if (onOurs && this.clock >= this.noAttackUntil && (prevMode === "setup" || prevMode === "strike" || chance(P.attack))) {
      // SETUP -> STRIKE. Lead a moving puck a little (better CPUs more).
      var lx = px + pvx * P.lead, ly = py + pvy * P.lead;
      ly = clamp(ly, g.top + pr, g.bottom - pr);
      if (mistake) { lx += rand(-26, 26); ly += rand(-26, 26); }   // misjudged contact point
      var overdue = this.setupT > P.setupMax;
      var hit = this.lineUp(v, p, lx, ly, overdue);
      if (!hit && overdue) {
        // Still no line after setupMax: back off and defend for a beat.
        this.noAttackUntil = this.clock + rand(0.35, 0.6);
        this.setupT = 0;
        p.mode = "neutral";
        p.tx = goalX - s * (P.depth + 30);
        p.ty = homeY;
      }
    } else if (!onOurs && v.hasPickup && toward <= 0 && s * (px - g.cx) < -150 && chance(P.pickup)) {
      // Safe moment (puck deep on their side, leaving): grab the pickup.
      p.mode = "pickup";
      p.tx = g.cx + s * (r + 1);
      p.ty = v.pickupY;
    } else {
      // NEUTRAL: guard, shading toward the puck's lane. Better CPUs creep
      // up while the puck is far away so they can pounce on rebounds.
      p.mode = "neutral";
      var far = !onOurs && toward <= 0 ? P.press : 0;
      p.tx = goalX - s * (P.depth + 40 + far);
      p.ty = homeY + rand(-P.posNoise, P.posNoise) * (mistake ? 3 : 1);
    }

    // Setup clock: grows only while it keeps setting up; a strike or any
    // other state resets it.
    if (p.mode !== "setup") this.setupT = 0;

    // Our own half only (the game clamps too - this just avoids aiming at walls).
    var minX = s > 0 ? g.cx + r : g.left + r, maxX = s > 0 ? g.right - r : g.cx - r;
    p.tx = clamp(p.tx, minX, maxX);
    p.ty = clamp(p.ty, g.top + r, g.bottom - r);
    // Continuing the same attack keeps its momentum (the human already
    // "knows" what they are doing); a new idea waits out a reaction delay.
    var same = (p.mode === prevMode) || (prevMode === "setup" && p.mode === "strike");
    p.at = this.clock + (same ? rand(0, P.react[0] * 0.5) : rand(P.react[0], P.react[1]));
  };

  /* --- Per frame ------------------------------------------------------ */
  Brain.prototype.update = function (dt, v, out) {
    out.x = 0; out.y = 0;
    if (!v.geo) return;
    this.clock += dt;

    // Countdown, goal celebrations, match end: hands off. A fresh faceoff
    // starts with a fresh read after a human-like beat.
    if (!v.live) { this.wasLive = false; this.cur.tx = NaN; this.cur.mode = "neutral"; this.setupT = 0; return; }
    if (!this.wasLive) {
      this.wasLive = true;
      this.nextThink = this.clock + rand(this.P.react[0], this.P.react[1]);
      this.pend.at = -1;
      this.aimUntil = -1;
    }
    // STUNNED: no stick, no dash, and the plan goes stale.
    if (v.stunned) { this.cur.tx = NaN; this.cur.mode = "neutral"; this.pend.at = -1; this.setupT = 0; return; }

    if (this.cur.mode === "setup") this.setupT += dt;

    if (this.clock >= this.nextThink) {
      this.think(v);
      this.nextThink = this.clock + this.P.think * (1 + Math.random() * 0.35);
    }
    var p = this.pend;
    if (p.at >= 0 && this.clock >= p.at) {
      var c = this.cur;
      c.mode = p.mode; c.tx = p.tx; c.ty = p.ty; c.strike = p.strike; c.dash = p.dash;
      p.at = -1;
    }

    var cur = this.cur;
    if (isNaN(cur.tx)) return;
    var dx = cur.tx - v.meX, dy = cur.ty - v.meY;
    var d = Math.hypot(dx, dy);
    if (d < 3) return;
    // Full deflection while striking; ease in near any other target so it
    // settles instead of jittering around the spot.
    var mag = cur.strike ? 1 : Math.min(1, d / 38);
    mag *= this.P.maxStick;
    out.x = dx / d * mag;
    out.y = dy / d * mag;

    if (cur.dash) {
      cur.dash = false;                     // one press per decision
      if (v.dashReady) out.action = "action1";
    }
  };

  ESA.CPU.registerStrategy("airHockey", {
    params: PARAMS,
    create: function (opts) { return new Brain(opts); }
  });

})(window.ESA);
