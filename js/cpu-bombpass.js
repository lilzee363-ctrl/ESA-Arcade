/* ==========================================================================
   ESA ARCADE - Bomb Pass CPU strategy
   Plugs into the generic CPU controller (js/cpu.js) exactly like the Air
   Hockey one: it only outputs a stick direction (length <= 1). There is no
   pass button - the game hands the bomb over on contact, so the CPU simply
   has to get close (CHASE) or stay away (ESCAPE). Same speed, same arena,
   same transfer distance as a human.

     CHASE   we hold the bomb: close the distance. Easy runs straight at
             where you ARE (and wobbles); Normal leads you a little; Hard
             leads you further and comes in from the open-space side, so
             you get pushed toward walls and corners instead of running
             free.
     ESCAPE  you hold the bomb: score a ring of candidate directions by
             distance from you minus wall / corner danger, pick the best.
             Easy looks at few directions and barely fears corners;
             Hard looks at more, uses your movement, and side-steps
             (jukes) when you commit to a charge.

   What it sees is what a player sees: both positions, who holds the bomb,
   the PASS COOLDOWN pill and how hard the fuse is fizzing/ticking. Your
   movement is estimated from successive positions, like an eye would.
   Never the hidden fuse time, never the RNG.
   ========================================================================== */

(function (ESA) {
  "use strict";

  /**
   *   think     seconds between decisions (+ up to 35% jitter)
   *   react     [min, max] reaction delay before a new plan takes effect
   *   maxStick  stick deflection cap (1 = normal top speed, never more)
   *   lead      how far ahead (x time-to-reach) it predicts your position
   *   cutoff    px it biases its chase toward the open-space side of you
   *   wobble    px of sideways error on the chase target
   *   dirs      candidate escape directions it considers
   *   look      px lookahead of each escape candidate
   *   margin    weight of "I get there well before you" in escape scoring
   *   wallFear  weight of wall / corner danger when escaping
   *   juke      chance to side-step when you charge in close
   *   hesitate  chance per decision to keep the old plan
   *   mistake   chance per decision of a plainly poor choice
   */
  var PARAMS = {
    easy: {
      think: 0.32, react: [0.22, 0.36], maxStick: 0.9, lead: 0, cutoff: 0, wobble: 45,
      dirs: 5, look: 110, margin: 0, wallFear: 0.25, juke: 0.05, hesitate: 0.18, mistake: 0.2
    },
    normal: {
      think: 0.18, react: [0.12, 0.2], maxStick: 0.95, lead: 0.3, cutoff: 30, wobble: 22,
      dirs: 5, look: 150, margin: 0.3, wallFear: 0.6, juke: 0.08, hesitate: 0.05, mistake: 0.06
    },
    hard: {
      think: 0.11, react: [0.07, 0.12], maxStick: 1, lead: 0.45, cutoff: 70, wobble: 8,
      dirs: 5, look: 170, margin: 0.5, wallFear: 0.8, juke: 0.15, hesitate: 0.015, mistake: 0.02
    }
  };

  function rand(a, b) { return a + Math.random() * (b - a); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function chance(p) { return Math.random() < p; }

  function Brain(opts) {
    this.P = PARAMS[opts.difficulty] || PARAMS.normal;
    this.reset();
  }

  Brain.prototype.reset = function () {
    this.clock = 0;
    this.nextThink = 0;
    this.cur = { tx: NaN, ty: NaN };
    this.pend = { tx: 0, ty: 0, at: -1 };
    this.mode = "idle";
    this.lastOpX = NaN; this.lastOpY = NaN;
    this.opVX = 0; this.opVY = 0;          // smoothed estimate of your movement
    this.wasLive = false;
  };

  /** Danger of standing at (x, y): 0 in open floor, rising near walls / corners. */
  function wallDanger(b, x, y) {
    var m = 90;
    var dl = Math.max(0, m - (x - b.left)), dr = Math.max(0, m - (b.right - x));
    var dt = Math.max(0, m - (y - b.top)), db = Math.max(0, m - (b.bottom - y));
    var hx = Math.max(dl, dr), hy = Math.max(dt, db);
    return hx + hy + (hx > 0 && hy > 0 ? hx * hy / 30 : 0);   // corners are worst
  }

  Brain.prototype.think = function (v) {
    var P = this.P, b = v.bounds, p = this.pend;
    if (this.mode !== "idle" && chance(P.hesitate)) return;
    var mistake = chance(P.mistake);
    var dx = v.opX - v.meX, dy = v.opY - v.meY;
    var dist = Math.hypot(dx, dy) || 1;
    var prevMode = this.mode;

    if (v.iHold) {
      /* --- CHASE --------------------------------------------------- */
      this.mode = "chase";
      // Time to reach you at our speed; lead your movement by part of it.
      var tReach = dist / (v.speed * P.maxStick);
      var lead = mistake ? 0 : P.lead * Math.min(tReach, 1.2);
      var tx = v.opX + this.opVX * lead, ty = v.opY + this.opVY * lead;
      // Come in from the open-space side: sit between you and the centre,
      // so running away means running toward a wall.
      if (dist > v.transferDist * 1.6 && P.cutoff) {
        var cx = (b.left + b.right) / 2 - tx, cy = (b.top + b.bottom) / 2 - ty;
        var cl = Math.hypot(cx, cy) || 1;
        tx += cx / cl * P.cutoff; ty += cy / cl * P.cutoff;
      }
      // Beginners veer: a sideways error on the line to the target.
      var w = rand(-P.wobble, P.wobble) * (mistake ? 2 : 1);
      tx += -dy / dist * w; ty += dx / dist * w;
      // Pass cooldown showing: no point touching yet - shadow at a step.
      if (v.cooldown > 0.25 && dist < v.transferDist * 1.4) {
        tx = v.opX - dx / dist * v.transferDist * 1.5;
        ty = v.opY - dy / dist * v.transferDist * 1.5;
      }
      p.tx = tx; p.ty = ty;
    } else {
      /* --- ESCAPE -------------------------------------------------- */
      this.mode = "escape";
      // Where you will be shortly (Hard reads your movement better).
      var ox = v.opX + this.opVX * P.lead * 0.5, oy = v.opY + this.opVY * P.lead * 0.5;
      var best = -Infinity, bx = v.meX, by = v.meY;
      var base = Math.atan2(v.meY - oy, v.meX - ox);      // straight away from you
      var n = P.dirs;
      for (var i = 0; i < n; i++) {
        // Candidates fan out around "straight away", plus the sides.
        var a = base + (i - (n - 1) / 2) * (Math.PI * 1.6 / Math.max(1, n - 1));
        var x = clamp(v.meX + Math.cos(a) * P.look, b.left, b.right);
        var y = clamp(v.meY + Math.sin(a) * P.look, b.top, b.bottom);
        // Same speed as you, so a spot is safe if we get there well before
        // you do (margin), and better the further it is from you overall.
        var dOp = Math.hypot(x - ox, y - oy), dMe = Math.hypot(x - v.meX, y - v.meY);
        var score = (dOp - dMe) * P.margin + dOp - wallDanger(b, x, y) * P.wallFear;
        if (mistake) score += rand(-80, 80);
        if (score > best) { best = score; bx = x; by = y; }
      }
      // You charging in close: side-step instead of running in a line.
      var opSp = Math.hypot(this.opVX, this.opVY);
      var closing = opSp > 60 && (this.opVX * -dx + this.opVY * -dy) / (opSp * dist) > 0.8;
      if (closing && dist < v.transferDist * 1.7 && chance(P.juke)) {
        // Step across your line of charge, to whichever side has more room.
        var px_ = -dy / dist, py_ = dx / dist, j = P.look * 0.8;
        var ax = clamp(v.meX + px_ * j, b.left, b.right), ay = clamp(v.meY + py_ * j, b.top, b.bottom);
        var cx2 = clamp(v.meX - px_ * j, b.left, b.right), cy2 = clamp(v.meY - py_ * j, b.top, b.bottom);
        var sa = Math.hypot(ax - ox, ay - oy) - wallDanger(b, ax, ay);
        var sc = Math.hypot(cx2 - ox, cy2 - oy) - wallDanger(b, cx2, cy2);
        if (sa >= sc) { bx = ax; by = ay; } else { bx = cx2; by = cy2; }
      }
      p.tx = bx; p.ty = by;
    }
    p.at = this.clock + (this.mode === prevMode ? rand(0, P.react[0] * 0.5) : rand(P.react[0], P.react[1]));
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
      this.nextThink = this.clock + rand(this.P.react[0], this.P.react[1]);
      this.pend.at = -1;
    }

    if (this.clock >= this.nextThink) {
      this.think(v);
      this.nextThink = this.clock + this.P.think * (1 + Math.random() * 0.35);
    }
    var p = this.pend;
    if (p.at >= 0 && this.clock >= p.at) {
      this.cur.tx = p.tx; this.cur.ty = p.ty;
      p.at = -1;
    }
    if (isNaN(this.cur.tx)) return;
    var dx = this.cur.tx - v.meX, dy = this.cur.ty - v.meY;
    var d = Math.hypot(dx, dy);
    if (d < 4) return;
    // Chasing: full stick right up to contact. Escaping: ease in at the spot.
    var mag = this.mode === "chase" ? 1 : Math.min(1, d / 30);
    mag *= this.P.maxStick;
    out.x = dx / d * mag;
    out.y = dy / d * mag;
  };

  ESA.CPU.registerStrategy("bomb", {
    params: PARAMS,
    create: function (opts) { return new Brain(opts); }
  });

})(window.ESA);
