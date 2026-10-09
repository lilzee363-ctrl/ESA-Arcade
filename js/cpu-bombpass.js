/* ==========================================================================
   ESA ARCADE - Bomb Pass CPU strategy (V4.1)
   Plugs into the generic CPU controller (js/cpu.js): it only ever outputs a
   stick direction (length <= 1) - full deflection on EVERY difficulty, so
   it moves exactly as fast, and with exactly the same acceleration, as a
   human (the game applies its own movement model). There is no pass
   button - the game hands the bomb over on contact.

   OBJECTIVES
     HUNT    we hold the bomb: close the distance and TAG.
             - pursuit-intercept: aim where you WILL be (lead from your
               observed velocity, weighted by prediction quality)
             - cut-off: come in from the open-space side so running away
               means running toward a wall / corner
             - a cornered target is rushed straight in
             - the pass needs a fresh contact (V4.1): after a whiff on the
               cooldown it backs off a step to re-arm, then re-engages
             - fuse almost out: all-in, no shadowing
     ESCAPE  you hold the bomb: keep distance, use open floor.
             - score a ring of candidate directions: room from your
               predicted position, a "can you get there first" margin,
               wall / corner danger, continuity (no dithering)
             - side-step (juke) a committed straight charge
             - use your pass cooldown to put real distance in

   DIFFICULTY = thinking only (shared profile, js/cpu.js): reaction and
   decision cadence, prediction quality, route error, mistakes and how many
   escape routes it considers. Hard is never faster - just smarter.

   What it sees is what a player sees: both positions, who holds the bomb,
   the PASS COOLDOWN pill and the visible fuse ring. Your movement is
   estimated from successive positions, like an eye would. Never the RNG.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var U = ESA.CPU.util;
  var rand = U.rand, clamp = U.clamp, chance = U.chance;

  /*
   * Game-specific extras on top of the shared profile (js/cpu.js):
   *   lead      how much of your observed velocity it trusts (x prediction)
   *   cutoff    px it biases a long chase toward your open-space side
   *   dirs      escape directions considered
   *   look      px lookahead of each escape candidate
   *   margin    weight of "I reach that spot well before you"
   *   wallFear  weight of wall / corner danger
   *   juke      chance to side-step a committed charge
   *   commit    s an escape route is kept unless clearly worse
   */
  var PARAMS = ESA.CPU.tune({
    easy:   { lead: 0.35, cutoff: 30, dirs: 6,  look: 130, margin: 0.25, wallFear: 0.45, juke: 0.12, commit: 0.45 },
    normal: { lead: 0.7,  cutoff: 60, dirs: 10, look: 160, margin: 0.5,  wallFear: 0.75, juke: 0.3,  commit: 0.3 },
    hard:   { lead: 1.0,  cutoff: 85, dirs: 14, look: 180, margin: 0.75, wallFear: 0.95, juke: 0.5,  commit: 0.2 }
  });

  function Brain(opts) {
    this.P = opts.profile || PARAMS.normal;
    this.reset();
  }

  Brain.prototype.reset = function () {
    this.clock = 0;
    this.nextThink = 0;
    this.cur = { tx: NaN, ty: NaN, ease: false };
    this.pend = { tx: 0, ty: 0, ease: false, at: -1 };
    this.mode = "idle";
    this.lastOpX = NaN; this.lastOpY = NaN;
    this.opVX = 0; this.opVY = 0;          // smoothed estimate of your movement
    this.escX = NaN; this.escY = NaN; this.escUntil = -1;
    this.wasLive = false;
  };

  /** Danger of standing at (x, y): 0 in open floor, rising near walls / corners. */
  function wallDanger(b, x, y) {
    var m = 95;
    var dl = Math.max(0, m - (x - b.left)), dr = Math.max(0, m - (b.right - x));
    var dt = Math.max(0, m - (y - b.top)), db = Math.max(0, m - (b.bottom - y));
    var hx = Math.max(dl, dr), hy = Math.max(dt, db);
    return hx + hy + (hx > 0 && hy > 0 ? hx * hy / 28 : 0);   // corners are worst
  }

  /**
   * Pursuit intercept: earliest t at which we (speed s) can stand where the
   * target (p + v t) will be. Falls back to the current position.
   */
  function intercept(mx, my, px, py, vx, vy, s, maxT) {
    var best = 0;
    for (var t = 0.05; t <= maxT; t += 0.05) {
      var x = px + vx * t, y = py + vy * t;
      if (Math.hypot(x - mx, y - my) <= s * t) { best = t; break; }
      best = t;
    }
    return best;
  }

  Brain.prototype.think = function (v) {
    var P = this.P, b = v.bounds, p = this.pend;
    if (this.mode !== "idle" && chance(P.hesitate)) return;
    var mistake = chance(P.mistake);
    var dx = v.opX - v.meX, dy = v.opY - v.meY;
    var dist = Math.hypot(dx, dy) || 1;
    var prevMode = this.mode;
    var lead = mistake ? 0 : P.lead * P.prediction;

    if (v.iHold) {
      /* --- HUNT ------------------------------------------------------ */
      this.mode = "hunt";
      var vx = this.opVX * lead, vy = this.opVY * lead;
      var t = intercept(v.meX, v.meY, v.opX, v.opY, vx, vy, v.speed, 1.2);
      var tx = clamp(v.opX + vx * t, b.left, b.right), ty = clamp(v.opY + vy * t, b.top, b.bottom);
      var cornered = wallDanger(b, v.opX, v.opY) > 70;
      // Long chase: approach from the open-space side - their escape lane.
      if (!cornered && dist > v.transferDist * 1.7) {
        var cx = (b.left + b.right) / 2 - tx, cy = (b.top + b.bottom) / 2 - ty;
        var cl = Math.hypot(cx, cy) || 1;
        var k = P.cutoff * Math.min(1, dist / 260);
        tx += cx / cl * k; ty += cy / cl * k;
      }
      // Route error (a hurried human doesn't run a perfect line).
      var w = rand(-P.routeError, P.routeError) * (mistake ? 2.5 : 1);
      tx += -dy / dist * w; ty += dx / dist * w;

      var hurry = v.fuse < 2.5;            // fuse almost out: all-in
      if (!hurry && !v.armed && dist < v.rearmDist + 6) {
        // Just whiffed / just passed back: step out to make a NEW contact.
        tx = v.meX - dx / dist * 40; ty = v.meY - dy / dist * 40;
      } else if (!hurry && v.cooldown > 0.3 && dist < v.transferDist * 1.5) {
        // Pass not ready yet: shadow one step off, ready to pounce.
        tx = v.opX - dx / dist * v.transferDist * 1.35;
        ty = v.opY - dy / dist * v.transferDist * 1.35;
      }
      p.tx = tx; p.ty = ty; p.ease = false;
    } else {
      /* --- ESCAPE ---------------------------------------------------- */
      this.mode = "escape";
      var ox = v.opX + this.opVX * 0.35 * lead, oy = v.opY + this.opVY * 0.35 * lead;
      var n = P.dirs, best = -Infinity, bx = v.meX, by = v.meY;
      var away = Math.atan2(v.meY - oy, v.meX - ox);
      for (var i = 0; i < n; i++) {
        // A full ring of options, biased to start from "straight away".
        var a = away + (i / n) * Math.PI * 2;
        var x = clamp(v.meX + Math.cos(a) * P.look, b.left, b.right);
        var y = clamp(v.meY + Math.sin(a) * P.look, b.top, b.bottom);
        var dOp = Math.hypot(x - ox, y - oy), dMe = Math.hypot(x - v.meX, y - v.meY);
        var score = dOp + (dOp - dMe) * P.margin - wallDanger(b, x, y) * P.wallFear;
        // Running THROUGH you is never an escape.
        var dot = ((x - v.meX) * dx + (y - v.meY) * dy) / ((dMe || 1) * dist);
        if (dot > 0.35 && dist < 260) score -= 220 * dot;
        // Keep a route for a moment unless something is clearly better.
        if (this.clock < this.escUntil && Math.hypot(x - this.escX, y - this.escY) < 50) score += 40;
        if (mistake) score += rand(-120, 120);
        if (score > best) { best = score; bx = x; by = y; }
      }
      // A committed charge close in: side-step across its line.
      var opSp = Math.hypot(this.opVX, this.opVY);
      var closing = opSp > 70 && (this.opVX * -dx + this.opVY * -dy) / (opSp * dist) > 0.8;
      if (closing && dist < v.transferDist * 1.9 && chance(P.juke)) {
        var px_ = -dy / dist, py_ = dx / dist, j = P.look * 0.85;
        var ax = clamp(v.meX + px_ * j, b.left, b.right), ay = clamp(v.meY + py_ * j, b.top, b.bottom);
        var cx2 = clamp(v.meX - px_ * j, b.left, b.right), cy2 = clamp(v.meY - py_ * j, b.top, b.bottom);
        var sa = Math.hypot(ax - ox, ay - oy) - wallDanger(b, ax, ay);
        var sc = Math.hypot(cx2 - ox, cy2 - oy) - wallDanger(b, cx2, cy2);
        if (sa >= sc) { bx = ax; by = ay; } else { bx = cx2; by = cy2; }
      }
      if (Math.hypot(bx - this.escX, by - this.escY) > 50 || !(this.clock < this.escUntil)) {
        this.escX = bx; this.escY = by; this.escUntil = this.clock + P.commit;
      }
      p.tx = bx + rand(-P.routeError, P.routeError) * 0.5;
      p.ty = by + rand(-P.routeError, P.routeError) * 0.5;
      p.ease = true;
    }
    p.at = this.clock + U.reactDelay(P, this.mode === prevMode);
  };

  Brain.prototype.update = function (dt, v, out) {
    out.x = 0; out.y = 0;
    if (!v.bounds) return;
    this.clock += dt;

    // Watch how you move (an eye, not the game's internals).
    if (dt > 0 && !isNaN(this.lastOpX)) {
      var k = Math.min(1, dt * 6);
      this.opVX += ((v.opX - this.lastOpX) / dt - this.opVX) * k;
      this.opVY += ((v.opY - this.lastOpY) / dt - this.opVY) * k;
    }
    this.lastOpX = v.opX; this.lastOpY = v.opY;

    if (!v.live) {
      this.wasLive = false;
      this.cur.tx = NaN;
      this.mode = "idle";
      this.opVX = this.opVY = 0;
      return;
    }
    if (!this.wasLive) {
      this.wasLive = true;
      this.nextThink = this.clock + rand(this.P.reaction[0], this.P.reaction[1]);
      this.pend.at = -1;
    }
    // Who holds the bomb flipped: a new situation - think now (after a
    // human-like reaction delay, applied in think()).
    var holdNow = !!v.iHold;
    if (holdNow !== this.lastHold) { this.lastHold = holdNow; this.nextThink = Math.min(this.nextThink, this.clock); }

    if (this.clock >= this.nextThink) {
      this.think(v);
      this.nextThink = this.clock + U.nextDecision(this.P);
    }
    var p = this.pend;
    if (p.at >= 0 && this.clock >= p.at) {
      this.cur.tx = p.tx; this.cur.ty = p.ty; this.cur.ease = p.ease;
      p.at = -1;
    }
    if (isNaN(this.cur.tx)) return;
    var dx = this.cur.tx - v.meX, dy = this.cur.ty - v.meY;
    var d = Math.hypot(dx, dy);
    if (d < 4) return;
    // Full stick on every difficulty; only an escape eases in at its spot
    // (exactly like a thumb settling) instead of jittering around it.
    var mag = this.cur.ease ? Math.min(1, d / 26) : 1;
    out.x = dx / d * mag;
    out.y = dy / d * mag;
  };

  ESA.CPU.registerStrategy("bomb", {
    params: PARAMS,
    create: function (opts) { return new Brain(opts); }
  });

})(window.ESA);
