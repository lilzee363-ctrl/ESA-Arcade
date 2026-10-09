/* ==========================================================================
   ESA ARCADE - power-ups (shared)
   Optional chaos pickups for two-player movement games (Air Hockey now,
   Head Soccer next). Games that don't opt in never touch this file.

   OPTING IN
   ---------
   1. In the game's registry entry:
        powerUps: { enabled: true, types: ["smack", "garaEhYaAmr", "shrink", "reverse"] }
   2. In the game constructor:
        this.powerUps = ESA.PowerUps.createSession(config, {
          players: { p1: adapter, p2: adapter },
          spawn:   { findSpot, isClear },           // where pickups may appear
          statusAnchors: { p1: {x, y, align}, p2: {...} }, // where status pills go
          crowdY:  number                           // optional, GARA crowd baseline
        });
      createSession() returns null when config is missing or disabled, so
      the game must treat this.powerUps as optional.
   3. Each frame: powerUps.update(dt, canCollect) and query
        isStunned(slot), isReversed(slot), colliderScale(slot), visualScale(slot)
   4. Lifecycle: startSpawning() at GO, resetRound() on a goal / faceoff,
      stop() at match end, destroy() on exit.
   5. Draw: drawPickups(), drawPlayerOverlays(), drawEffects(), drawStatusBar().

   PLAYER ADAPTER (the game owns its players; the session only asks)
   --------------
     id                     BASE character id (cameo exclusion; guests: any)
     color                  identity colour (status pills)
     getAnchor()            -> { x, y, top }  collider centre + sprite top
     getReach()             -> pickup touch radius (current collider)
     showHurtSprite(ms)     switch to hurtSprite (stun start)
     restoreNormalSprite()  back to normalSprite (stun end / clear)
     nudge(dx, dy)          optional: small knockback on a SMACK
     onStatusChange(kind, active)  optional: e.g. re-clamp after a shrink

   TIMING
   ------
   No setTimeout anywhere. The session has its own clock that only moves
   inside update(dt). A paused game doesn't call update(), so spawn timers,
   effect durations and cameo animations all freeze and resume from where
   they were. destroy() drops everything; nothing can fire afterwards.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var TAU = Math.PI * 2;
  var types = Object.create(null);
  var order = [];

  var SHRINK_SCALE = 0.58;     // exactly one shrink size - never compounds
  var SHRINK_COLLIDE_MS = 200; // collider eases between sizes
  var SHRINK_POP_MS = 280;     // sprite pops (with overshoot) between sizes
  var CAMEO_IMPACT_AT = 0.32;  // fraction of the SMACK cameo life

  var STATUS_COLORS = {
    stunned: "#ffd766",
    shrunk: "#7bd88f",
    reversed: "#c58cff",
    immune: "#9fe3ff"
  };

  /* ------------------------------------------------------------------ *
   * Cameo casting
   * ------------------------------------------------------------------ */

  /** Random available character not in `excludeIds` with loaded art, or null. */
  function pickCameo(excludeIds) {
    var ex = excludeIds || [];
    var pool = ESA.Characters.list().filter(function (c) {
      return ex.indexOf(c.id) < 0 && !!ESA.Assets.get(c.id + "_normal");
    });
    return pool.length ? ESA.pick(pool) : null;
  }

  /* ================================================================== *
   * Spawner - one pickup on the field at a time.
   * ================================================================== */

  /**
   * opts: types, minDelay (15), maxDelay (22), lifetime (10), radius (17),
   *       findSpot(attempt) -> {x, y}, isClear(x, y, r) -> bool
   */
  function Spawner(opts) {
    this.opts = opts || {};
    this.radius = this.opts.radius || 17;
    this.active = null;      // { type, x, y, age, life }
    this.armed = false;
    this.started = false;    // has the first timer been armed this match?
    this.wait = 0;           // seconds until the next spawn attempt
    this.clock = 0;          // local seconds, advances only in update()
    this.lastType = null;
  }

  Spawner.prototype._delay = function () {
    var o = this.opts;
    return ESA.rand(o.minDelay || 15, o.maxDelay || 22);
  };

  /** Start counting toward the first spawn with a fresh random timer. */
  Spawner.prototype.arm = function () {
    this.armed = true;
    this.started = true;
    this.wait = this._delay();
  };

  /**
   * Stop spawning and remove any pickup. With `keepTimer` the countdown is
   * frozen rather than lost, so frequent goals don't starve a match of
   * power-ups. A pickup that was on the field counts as expired: the next
   * one gets a fresh timer.
   */
  Spawner.prototype.disarm = function (keepTimer) {
    if (this.active) this.wait = this._delay();
    this.armed = false;
    this.active = null;
    if (!keepTimer) this.wait = 0;
  };

  /** Continue a frozen countdown, but never sooner than `minWait` seconds. */
  Spawner.prototype.resume = function (minWait) {
    if (!(this.wait > 0)) this.wait = this._delay();
    this.wait = Math.max(this.wait, minWait || 0);
    this.armed = true;
  };

  Spawner.prototype.clear = function () {
    this.disarm(false);
    this.started = false;
    this.lastType = null;
  };

  Spawner.prototype.update = function (dt) {
    this.clock += dt;
    if (this.active) {
      this.active.age += dt;
      if (this.active.age >= this.active.life) {
        // Nobody took it: fade out and wait a full fresh delay.
        this.active = null;
        if (this.armed) this.wait = this._delay();
      }
      return;
    }
    if (!this.armed) return;
    this.wait -= dt;
    if (this.wait <= 0) this._spawn();
  };

  /** Equal odds, except the previous type sits out when alternatives exist. */
  Spawner.prototype._pickType = function () {
    var list = (this.opts.types && this.opts.types.length) ? this.opts.types : order;
    var last = this.lastType;
    var pool = list.filter(function (t) { return t !== last; });
    return ESA.pick(pool.length ? pool : list);
  };

  Spawner.prototype._spawn = function () {
    var o = this.opts;
    if (typeof o.findSpot !== "function") { this.wait = this._delay(); return; }
    for (var i = 0; i < 24; i++) {
      var s = o.findSpot(i);
      if (!s || !isFinite(s.x) || !isFinite(s.y)) continue;
      if (typeof o.isClear === "function" && !o.isClear(s.x, s.y, this.radius)) continue;
      var type = this._pickType();
      this.lastType = type;
      this.active = { type: type, x: s.x, y: s.y, age: 0, life: o.lifetime || 10 };
      ESA.Audio.play("powerSpawn");
      return;
    }
    // Players are camping every legal spot - try again shortly.
    this.wait = 1.2;
  };

  /**
   * collectors: [{ who, x, y, r, can }]. The closest eligible collector that
   * touches the pickup takes it. Returns { type, x, y, who } once and starts
   * a fresh random delay, or null.
   */
  Spawner.prototype.tryCollect = function (collectors) {
    var a = this.active;
    if (!a || a.age < 0.25) return null;            // brief pop-in grace
    var best = null, bestD = Infinity;
    for (var i = 0; i < collectors.length; i++) {
      var c = collectors[i];
      if (c.can === false) continue;
      var d = ESA.dist(c.x, c.y, a.x, a.y);
      if (d <= c.r + this.radius && d < bestD) { best = c; bestD = d; }
    }
    if (!best) return null;
    var out = { type: a.type, x: a.x, y: a.y, who: best.who };
    this.active = null;
    if (this.armed) this.wait = this._delay();
    return out;
  };

  Spawner.prototype.draw = function (ctx) {
    var a = this.active;
    if (!a) return;
    var def = types[a.type];
    if (!def) return;

    var r = this.radius;
    var pop = ESA.easeOutBack(Math.min(1, a.age / 0.35));
    var fadeOut = ESA.clamp((a.life - a.age) / 0.6, 0, 1);
    var blink = (a.life - a.age < 2) ? (0.55 + 0.45 * Math.abs(Math.sin(a.age * 9))) : 1;
    var pulse = 1 + Math.sin(this.clock * 5) * 0.06;
    var alpha = fadeOut * blink;

    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.globalAlpha = alpha;

    // Label plate under the token so players learn what each one does.
    ctx.save();
    ctx.scale(pop, pop);
    ctx.font = "800 10px " + ESA.FONT_DISPLAY;
    ctx.letterSpacing = "1.5px";
    var tw = ctx.measureText(def.short).width + 12;
    ESA.roundRect(ctx, -tw / 2, r + 7, tw, 15, 7);
    ctx.fillStyle = "rgba(7,23,40,.92)";
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = def.color;
    ctx.stroke();
    ctx.fillStyle = "#fff6e4";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(def.short, 0.75, r + 15);
    ctx.restore();

    ctx.scale(pop * pulse, pop * pulse);

    // Soft glow (flat fill, no shadowBlur).
    ctx.fillStyle = def.color;
    ctx.globalAlpha = alpha * 0.18;
    ctx.beginPath(); ctx.arc(0, 0, r * 1.75, 0, TAU); ctx.fill();
    ctx.globalAlpha = alpha;

    // Token: navy disc, gold rim, type-colour inner ring.
    ctx.fillStyle = "#081a30";
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = ESA.COLORS.gold;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = def.color;
    ctx.beginPath(); ctx.arc(0, 0, r - 4, 0, TAU); ctx.stroke();

    // Spinning tick marks.
    ctx.save();
    ctx.rotate(this.clock * 1.6);
    ctx.strokeStyle = "rgba(253,238,196,.65)";
    ctx.lineWidth = 2;
    for (var i = 0; i < 4; i++) {
      ctx.rotate(TAU / 4);
      ctx.beginPath(); ctx.moveTo(r + 4, 0); ctx.lineTo(r + 8, 0); ctx.stroke();
    }
    ctx.restore();

    if (typeof def.drawIcon === "function") def.drawIcon(ctx, r * 0.62);
    ctx.restore();
  };

  /* ================================================================== *
   * Shared effect renderers
   * ================================================================== */

  function drawDizzy(ctx, x, y, t) {
    for (var i = 0; i < 3; i++) {
      var a = t * 5 + i * (TAU / 3);
      ctx.save();
      ctx.translate(x + Math.cos(a) * 20, y + Math.sin(a) * 6);
      ctx.rotate(a);
      ESA.drawStar(ctx, 6, i === 1 ? "#fff6e4" : "#ffd766");
      ctx.restore();
    }
  }

  /** Comic speech bubble with a tail toward (tx, ty). t = 0..1 of its life. */
  function drawSpeechBubble(ctx, x, y, tx, ty, text, t, opts) {
    opts = opts || {};
    var size = opts.size || 22;
    var pop = ESA.easeOutBack(Math.min(1, t / 0.12));
    var alpha = t > 0.88 ? Math.max(0, 1 - (t - 0.88) / 0.12) : 1;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = "800 " + size + "px " + ESA.FONT_DISPLAY;
    var tw = ctx.measureText(text).width;
    var bw = tw + 30, bh = size + 22;

    ctx.translate(x, y);
    ctx.scale(pop, pop);
    ctx.rotate(Math.sin(t * 60) * 0.02);

    ctx.fillStyle = "#fff6e4";
    ctx.strokeStyle = "#071728";
    ctx.lineWidth = 3;
    var tdx = (tx - x) / Math.max(pop, 0.01), tdy = (ty - y) / Math.max(pop, 0.01);
    ctx.beginPath();
    ctx.moveTo(-12, bh / 2 - 6);
    ctx.lineTo(tdx * 0.85, tdy * 0.85);
    ctx.lineTo(12, bh / 2 - 6);
    ctx.closePath();
    ctx.fill(); ctx.stroke();

    ESA.roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 14);
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ESA.COLORS.goldDeep;
    ESA.roundRect(ctx, -bw / 2 + 4, -bh / 2 + 4, bw - 8, bh - 8, 10);
    ctx.stroke();
    ctx.fillStyle = "#fff6e4";
    ctx.fillRect(-10, bh / 2 - 9, 20, 6);

    ctx.fillStyle = "#c62f27";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 0, 2);
    ctx.restore();
  }

  /** A few crowd silhouettes rising from `baseY`. t = 0..1. */
  function drawCrowd(ctx, cx, baseY, t, count) {
    count = count || 4;
    var rise = t < 0.2 ? ESA.easeOut(t / 0.2) : t > 0.8 ? 1 - ESA.easeIn((t - 0.8) / 0.2) : 1;
    ctx.save();
    ctx.globalAlpha = 0.95 * rise;
    ctx.strokeStyle = "rgba(243,195,90,.55)";
    ctx.lineWidth = 1.5;
    for (var i = 0; i < count; i++) {
      var off = (i - (count - 1) / 2) * 46;
      var bob = Math.sin(t * 30 + i * 1.7) * 3;
      var sh = baseY + (1 - rise) * 40;
      var hy = sh - 24 + bob;
      ctx.fillStyle = "#1c3a5e";
      ctx.beginPath();
      ctx.moveTo(cx + off - 20, sh + 10);
      ctx.quadraticCurveTo(cx + off - 20, sh - 8, cx + off, sh - 8);
      ctx.quadraticCurveTo(cx + off + 20, sh - 8, cx + off + 20, sh + 10);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + off, hy, 10, 0, TAU);
      ctx.fill(); ctx.stroke();
      if (i % 2 === 0) {
        ctx.fillStyle = "#f3c35a";
        ctx.font = "800 16px " + ESA.FONT_DISPLAY;
        ctx.textAlign = "center";
        ctx.fillText("!", cx + off, hy - 16);
      }
    }
    ctx.restore();
  }

  /** SMACK cameo: swoops in from `fromX`, whacks (tx, ty), leaves. phase 0..1. */
  function drawCameo(ctx, cameo, fromX, tx, ty, phase) {
    var inT = Math.min(1, phase / CAMEO_IMPACT_AT);
    var outT = phase > 0.62 ? (phase - 0.62) / 0.38 : 0;
    var side = fromX < tx ? -1 : 1;
    var standX = tx + side * 46;
    var x, y, rot;

    if (outT > 0) {
      x = ESA.lerp(standX, fromX, ESA.easeIn(outT));
      y = ty - 10 - Math.sin(outT * Math.PI) * 60;
      rot = side * -0.4 * outT;
    } else {
      x = ESA.lerp(fromX, standX, ESA.easeOut(inT));
      y = ty - 10 - Math.sin(inT * Math.PI) * 70;
      rot = inT < 1 ? side * 0.35 * (1 - inT) : side * -0.28 * Math.max(0, 1 - (phase - CAMEO_IMPACT_AT) * 8);
    }

    ctx.save();
    ctx.globalAlpha = outT > 0.85 ? Math.max(0, 1 - (outT - 0.85) / 0.15) : 1;
    if (cameo) {
      if (inT < 1 || outT > 0) {
        ctx.strokeStyle = "rgba(253,238,196,.5)";
        ctx.lineWidth = 2;
        for (var i = 0; i < 3; i++) {
          var ly = y - 60 + i * 22;
          ctx.beginPath(); ctx.moveTo(x + side * 34, ly); ctx.lineTo(x + side * 80, ly); ctx.stroke();
        }
      }
      ESA.drawSprite(ctx, cameo.id, false, x, y + 52, { height: 104, flip: side > 0, rotate: rot });
      ctx.font = "800 12px " + ESA.FONT_DISPLAY;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      var label = cameo.displayName.toUpperCase();
      var w = ctx.measureText(label).width + 16;
      ESA.roundRect(ctx, x - w / 2, y - 76, w, 18, 9);
      ctx.fillStyle = "rgba(7,23,40,.9)";
      ctx.fill();
      ctx.strokeStyle = cameo.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = "#fff6e4";
      ctx.fillText(label, x, y - 67);
    } else {
      // Nobody else is on the roster: the emblem itself flies in.
      var em = ESA.Assets.get("emblem");
      ctx.translate(x, y);
      ctx.rotate(rot * 2);
      if (em && em.width) ctx.drawImage(em, -36, -36, 72, 72);
      else { ctx.fillStyle = ESA.COLORS.gold; ctx.beginPath(); ctx.arc(0, 0, 30, 0, TAU); ctx.fill(); }
    }
    ctx.restore();
  }

  /** Small two-way arrows badge (REVERSE icon + overhead indicator). */
  function drawReverseArrows(ctx, s, color) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.6, s * 0.26);
    ctx.lineCap = "round";
    // Top arrow ->
    ctx.beginPath(); ctx.moveTo(-s * 0.85, -s * 0.38); ctx.lineTo(s * 0.5, -s * 0.38); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(s * 0.95, -s * 0.38); ctx.lineTo(s * 0.4, -s * 0.8); ctx.lineTo(s * 0.4, s * 0.04); ctx.closePath(); ctx.fill();
    // Bottom arrow <-
    ctx.beginPath(); ctx.moveTo(s * 0.85, s * 0.42); ctx.lineTo(-s * 0.5, s * 0.42); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-s * 0.95, s * 0.42); ctx.lineTo(-s * 0.4, 0); ctx.lineTo(-s * 0.4, s * 0.84); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  /* ================================================================== *
   * Pickup types
   *   status    the status effect it inflicts on the OPPONENT
   *   activate  session, bySlot, targetSlot - status already pre-checked
   * ================================================================== */

  function register(def) {
    if (!def || !def.id || types[def.id]) return;
    types[def.id] = def;
    order.push(def.id);
  }

  /* SMACK - a random other ESA member runs in and whacks the opponent. */
  register({
    id: "smack",
    label: "SMACK",
    short: "SMACK",
    color: "#ff9a3c",
    status: "stunned",
    duration: 3000,
    activate: function (s, by, target) {
      var ex = [s.players.p1.id, s.players.p2.id];
      var a = s.players[target].getAnchor();
      s.text(a.x, a.top - 6, "SMACK!", "#ffd766", 22);
      s.anims.push({
        kind: "smack", target: target, t0: s.clock, life: 1150, impacted: false,
        cameo: pickCameo(ex),
        // Enters from the target's own back-wall side, like an ambush.
        fromX: target === "p1" ? -70 : s.width + 70
      });
    },
    // Called by the session when the cameo connects.
    impact: function (s, anim) {
      var t = anim.target, ad = s.players[t], a = ad.getAnchor();
      ESA.Audio.play("bonk");
      ESA.Stage.shake(9);
      if (!s.inflict(t, "stunned", this.duration)) return;
      if (ad.nudge) ad.nudge((anim.fromX < a.x ? 1 : -1) * 170, 0);
      s.text(a.x, a.top - 20, "WHACK!", "#ffd766", 26);
      for (var i = 0; i < 6; i++) {
        s.fx.spawn({
          type: "star", x: a.x + ESA.rand(-18, 18), y: a.y - 20 + ESA.rand(-14, 14),
          vx: ESA.rand(-150, 150), vy: ESA.rand(-170, -50),
          life: ESA.rand(0.5, 0.8), size: ESA.rand(6, 10), color: "#ffd766", gravity: 260
        });
      }
    },
    drawIcon: function (ctx, s) {
      ctx.save();
      ctx.fillStyle = "#ffd766";
      ctx.strokeStyle = "#7a3d0c";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(s * 0.25, -s * 1.05);
      ctx.lineTo(-s * 0.55, s * 0.12);
      ctx.lineTo(-s * 0.02, s * 0.12);
      ctx.lineTo(-s * 0.3, s * 1.05);
      ctx.lineTo(s * 0.6, -s * 0.2);
      ctx.lineTo(s * 0.05, -s * 0.2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  });

  /* GARA EH YA AMR??!! - the opponent is overwhelmed by the question. */
  register({
    id: "garaEhYaAmr",
    label: "GARA EH YA AMR??!!",
    short: "GARA",
    text: "GARA EH YA AMR??!!",
    color: "#4fb7e6",
    status: "stunned",
    duration: 3000,
    activate: function (s, by, target) {
      if (!s.inflict(target, "stunned", this.duration)) return;
      ESA.Audio.play("gara");
      ESA.Stage.shake(5);
      // One bubble per activation; it is gone before the stun ends.
      s.anims.push({ kind: "gara", target: target, t0: s.clock, life: 2400, text: this.text });
    },
    drawIcon: function (ctx, s) {
      ctx.save();
      ctx.fillStyle = "#fff6e4";
      ctx.strokeStyle = "#071728";
      ctx.lineWidth = 1.5;
      ESA.roundRect(ctx, -s * 1.0, -s * 0.85, s * 2.0, s * 1.4, s * 0.45);
      ctx.fill(); ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.35, s * 0.5);
      ctx.lineTo(-s * 0.6, s * 1.05);
      ctx.lineTo(s * 0.05, s * 0.52);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#c62f27";
      ctx.fillRect(-s * 0.12, -s * 0.62, s * 0.24, s * 0.62);
      ctx.beginPath(); ctx.arc(0, s * 0.27, s * 0.14, 0, TAU); ctx.fill();
      ctx.restore();
    }
  });

  /* SHRINK - the opponent's sprite AND collider drop to 58% for 7 s. */
  register({
    id: "shrink",
    label: "SHRINK",
    short: "SHRINK",
    color: STATUS_COLORS.shrunk,
    status: "shrunk",
    duration: 7000,
    activate: function (s, by, target) {
      if (!s.inflict(target, "shrunk", this.duration)) return;
      var a = s.players[target].getAnchor();
      ESA.Audio.play("shrink");
      s.text(a.x, a.top - 6, "SHRUNK!", STATUS_COLORS.shrunk, 22);
      s.fx.spawn({ type: "ring", x: a.x, y: a.y, size: 60, size2: 14, life: 0.3, color: STATUS_COLORS.shrunk });
    },
    drawIcon: function (ctx, s) {
      // Four arrows pointing in at a tiny figure.
      ctx.save();
      ctx.strokeStyle = STATUS_COLORS.shrunk;
      ctx.fillStyle = STATUS_COLORS.shrunk;
      ctx.lineWidth = 1.8;
      ctx.lineCap = "round";
      for (var i = 0; i < 4; i++) {
        ctx.save();
        ctx.rotate(Math.PI / 4 + i * Math.PI / 2);
        ctx.beginPath(); ctx.moveTo(s * 1.05, 0); ctx.lineTo(s * 0.5, 0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.4, 0); ctx.lineTo(s * 0.68, -s * 0.22); ctx.lineTo(s * 0.68, s * 0.22); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      ctx.fillStyle = "#fff6e4";
      ctx.beginPath(); ctx.arc(0, -s * 0.12, s * 0.13, 0, TAU); ctx.fill();
      ctx.fillRect(-s * 0.1, 0, s * 0.2, s * 0.26);
      ctx.restore();
    }
  });

  /* REVERSE - the opponent's directional movement is inverted for 7 s. */
  register({
    id: "reverse",
    label: "REVERSE",
    short: "REVERSE",
    color: STATUS_COLORS.reversed,
    status: "reversed",
    duration: 7000,
    activate: function (s, by, target) {
      if (!s.inflict(target, "reversed", this.duration)) return;
      var a = s.players[target].getAnchor();
      ESA.Audio.play("reverse");
      s.text(ESA.clamp(a.x, 140, s.width - 140), a.top - 10, "CONTROLS REVERSED!", STATUS_COLORS.reversed, 22, 1.2);
    },
    drawIcon: function (ctx, s) { drawReverseArrows(ctx, s, STATUS_COLORS.reversed); }
  });

  /* ================================================================== *
   * Session - one per match, owned by the game.
   * ================================================================== */
  var SLOTS = ["p1", "p2"];
  function other(slot) { return slot === "p1" ? "p2" : "p1"; }

  function Session(config, opts) {
    var self = this;
    this.opts = opts;
    this.types = (config.types || order).filter(function (t) { return !!types[t]; });
    this.players = opts.players;
    this.width = opts.width || ESA.W;
    this.height = opts.height || ESA.H;
    this.clock = 0;          // ms, advances only in update()
    this.anims = [];         // cosmetic sequences (cameo, bubble)
    this.fx = new ESA.ParticleField(90);
    this.destroyed = false;

    this.status = {};
    SLOTS.forEach(function (slot) {
      var ad = self.players[slot];
      self.status[slot] = ESA.StatusEffects.create({
        onStart: function (kind, e) {
          if (kind === "stunned" && ad.showHurtSprite) ad.showHurtSprite(e.duration);
          if (ad.onStatusChange) ad.onStatusChange(kind, true);
        },
        onEnd: function (kind) {
          if (kind === "stunned" && ad.restoreNormalSprite) ad.restoreNormalSprite();
          if (ad.onStatusChange) ad.onStatusChange(kind, false);
        }
      });
    });

    var sp = opts.spawn || {};
    this.spawner = new Spawner({
      types: this.types,
      minDelay: sp.minDelay || 15,
      maxDelay: sp.maxDelay || 22,
      lifetime: sp.lifetime || 10,
      radius: sp.radius || 17,
      findSpot: sp.findSpot,
      isClear: sp.isClear
    });
  }

  /* --- Lifecycle ---------------------------------------------------- */

  /** Gameplay is live (GO): start or continue the spawn countdown. */
  Session.prototype.startSpawning = function () {
    if (this.destroyed) return;
    if (!this.spawner.started) this.spawner.arm();
    else this.spawner.resume(3.5);    // never right off a faceoff
  };

  /** Goal / faceoff: drop every effect, pickup and animation. */
  Session.prototype.resetRound = function () {
    this.status.p1.clear();
    this.status.p2.clear();
    this.anims.length = 0;
    this.fx.clear();
    this.spawner.disarm(true);
  };

  /** Match over: like resetRound, and the spawner fully stops. */
  Session.prototype.stop = function () {
    this.resetRound();
    this.spawner.clear();
  };

  Session.prototype.destroy = function () {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
  };

  /* --- Per-frame ----------------------------------------------------- */
  Session.prototype.update = function (dt, canCollect) {
    if (this.destroyed) return;
    this.clock += dt * 1000;
    this.status.p1.update(this.clock);
    this.status.p2.update(this.clock);
    this.fx.update(dt);
    this.spawner.update(dt);

    for (var i = this.anims.length - 1; i >= 0; i--) {
      var a = this.anims[i];
      var phase = (this.clock - a.t0) / a.life;
      if (a.kind === "smack" && !a.impacted && phase >= CAMEO_IMPACT_AT) {
        a.impacted = true;
        types.smack.impact(this, a);
      }
      if (phase >= 1) this.anims.splice(i, 1);
    }

    if (canCollect) this._collect();
  };

  Session.prototype._collect = function () {
    var self = this;
    var got = this.spawner.tryCollect(SLOTS.map(function (slot) {
      var ad = self.players[slot], a = ad.getAnchor();
      return { who: slot, x: a.x, y: a.y, r: ad.getReach(), can: !self.isStunned(slot) };
    }));
    if (got) this.activate(got.type, got.who, got.x, got.y);
  };

  /**
   * Fires pickup `type` collected by `bySlot`. The target is always the
   * opponent. Immunity on the target consumes the pickup with feedback.
   */
  Session.prototype.activate = function (type, bySlot, x, y) {
    var def = types[type];
    if (!def || this.destroyed) return;
    var target = other(bySlot);
    ESA.Audio.play("tokenBonus");
    if (x !== undefined) this.fx.spawn({ type: "ring", x: x, y: y, size: 10, size2: 60, life: 0.4, color: def.color });

    var verdict = this.status[target].check(def.status, this.clock);
    if (verdict !== "ok") { this.refuse(target, verdict, def.status); return; }
    def.activate(this, bySlot, target);
  };

  /** Apply a status to `slot`. Shows IMMUNE!/ALREADY feedback on refusal. */
  Session.prototype.inflict = function (slot, kind, ms) {
    var r = this.status[slot].apply(kind, ms, this.clock);
    if (r === "applied") return true;
    this.refuse(slot, r, kind);
    return false;
  };

  Session.prototype.refuse = function (slot, verdict, kind) {
    var a = this.players[slot].getAnchor();
    var msg = verdict === "immune" ? "IMMUNE!" : "ALREADY " + ESA.StatusEffects.label(kind) + "!";
    this.text(a.x, a.top - 8, msg, STATUS_COLORS.immune, 20);
    this.fx.spawn({ type: "ring", x: a.x, y: a.y, size: 20, size2: 48, life: 0.35, color: STATUS_COLORS.immune });
    ESA.Audio.play("denied");
  };

  /** Floating arcade text, kept inside the arena. */
  Session.prototype.text = function (x, y, msg, color, size, life) {
    this.fx.spawn({
      type: "text", x: ESA.clamp(x, 110, this.width - 110), y: Math.max(28, y),
      vy: -38, text: msg, font: size || 20, color: color || "#ffd766", life: life || 0.9, drag: 0.95
    });
  };

  /* --- Queries for the game ---------------------------------------- */
  Session.prototype.isStunned = function (slot) { return this.status[slot].has("stunned"); };
  Session.prototype.isReversed = function (slot) { return this.status[slot].has("reversed"); };
  Session.prototype.isImmune = function (slot) { return this.status[slot].isImmune(this.clock); };

  /** 0 = normal, 1 = fully shrunk, eased (no overshoot) - for physics. */
  Session.prototype._shrinkAmount = function (slot, ms) {
    var st = this.status[slot], e = st.get("shrunk");
    if (e) return ESA.clamp((this.clock - e.start) / ms, 0, 1);
    var le = st.lastEnded.shrunk;
    if (le && le.reason === "expired") return 1 - ESA.clamp((this.clock - le.at) / ms, 0, 1);
    return 0;
  };

  /** Multiplier for the game's real collider radius. */
  Session.prototype.colliderScale = function (slot) {
    return 1 - (1 - SHRINK_SCALE) * this._shrinkAmount(slot, SHRINK_COLLIDE_MS);
  };

  /** Multiplier for sprite size, with an arcade pop on the way in and out. */
  Session.prototype.visualScale = function (slot) {
    var st = this.status[slot], e = st.get("shrunk");
    if (e) {
      var t = (this.clock - e.start) / SHRINK_POP_MS;
      return t >= 1 ? SHRINK_SCALE : ESA.lerp(1, SHRINK_SCALE, ESA.easeOutBack(Math.max(0, t)));
    }
    var le = st.lastEnded.shrunk;
    if (le && le.reason === "expired") {
      var u = (this.clock - le.at) / SHRINK_POP_MS;
      if (u < 1) return ESA.lerp(SHRINK_SCALE, 1, ESA.easeOutBack(Math.max(0, u)));
    }
    return 1;
  };

  /* --- Drawing ------------------------------------------------------- */
  Session.prototype.drawPickups = function (ctx) { this.spawner.draw(ctx); };

  /** Per-player indicators: dizzy stars, reverse badge, immunity shimmer. */
  Session.prototype.drawPlayerOverlays = function (ctx) {
    var now = this.clock;
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i], ad = this.players[slot], a = ad.getAnchor(), st = this.status[slot];
      if (st.has("stunned")) drawDizzy(ctx, a.x, a.top - 8, now / 1000);
      if (st.has("reversed")) {
        ctx.save();
        ctx.translate(a.x, a.top - (st.has("stunned") ? 26 : 12));
        var bob = Math.sin(now / 140) * 0.08;
        ctx.scale(1 + bob, 1 + bob);
        ctx.fillStyle = "rgba(7,23,40,.88)";
        ESA.roundRect(ctx, -15, -10, 30, 20, 7);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = STATUS_COLORS.reversed;
        ctx.stroke();
        drawReverseArrows(ctx, 8, STATUS_COLORS.reversed);
        ctx.restore();
      }
      if (st.isImmune(now)) {
        ctx.save();
        ctx.globalAlpha = 0.45 + 0.35 * Math.sin(now / 90);
        ctx.strokeStyle = STATUS_COLORS.immune;
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -now / 30;
        ctx.beginPath(); ctx.arc(a.x, a.y, ad.getReach() + 10, 0, TAU); ctx.stroke();
        ctx.restore();
      }
    }
  };

  /** Cameo / bubble sequences and floating text. */
  Session.prototype.drawEffects = function (ctx) {
    var now = this.clock;
    for (var i = 0; i < this.anims.length; i++) {
      var e = this.anims[i];
      var phase = ESA.clamp((now - e.t0) / e.life, 0, 1);
      var a = this.players[e.target].getAnchor();
      if (e.kind === "smack") {
        drawCameo(ctx, e.cameo, e.fromX, a.x, a.y, phase);
        if (e.impacted && phase < CAMEO_IMPACT_AT + 0.12) {
          var k = (phase - CAMEO_IMPACT_AT) / 0.12;
          ctx.save();
          ctx.globalAlpha = 1 - k;
          ctx.translate(a.x, a.y - 20);
          ctx.rotate(k * 0.6);
          ESA.drawStar(ctx, 26 + k * 24, "#fff6e4");
          ctx.restore();
        }
      } else if (e.kind === "gara") {
        drawCrowd(ctx, ESA.clamp(a.x, 120, this.width - 120), this.opts.crowdY || this.height - 30, Math.min(1, phase * 1.6), 4);
        drawSpeechBubble(ctx, ESA.clamp(a.x, 170, this.width - 170), Math.max(46, a.top - 52),
                         a.x, a.top + 4, e.text, phase, { size: 22 });
      }
    }
    this.fx.draw(ctx);
  };

  /**
   * Compact status pills with countdowns, e.g. "SHRUNK 6.8", at the
   * game-supplied anchors (kept off the playfield).
   */
  Session.prototype.drawStatusBar = function (ctx) {
    var anchors = this.opts.statusAnchors;
    if (!anchors) return;
    var now = this.clock;
    for (var i = 0; i < SLOTS.length; i++) {
      var slot = SLOTS[i], an = anchors[slot], st = this.status[slot];
      if (!an) continue;
      var items = st.list().map(function (e) {
        return { label: ESA.StatusEffects.label(e.kind), left: e.until - now, total: e.duration, color: STATUS_COLORS[e.kind] };
      });
      if (st.isImmune(now)) items.push({ label: "IMMUNE", left: st.immunityLeft(now), total: st.immunityMs, color: STATUS_COLORS.immune });
      var x = an.x, dir = an.align === "right" ? -1 : 1;
      for (var k = 0; k < items.length; k++) {
        var it = items[k], w = 104, h = 19;
        var px = dir > 0 ? x : x - w;
        ctx.save();
        ESA.roundRect(ctx, px, an.y - h / 2, w, h, 6);
        ctx.fillStyle = "rgba(4,14,26,.92)";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = it.color;
        ctx.stroke();
        // Owner notch in the player's colour.
        ctx.fillStyle = this.players[slot].color;
        ctx.fillRect(dir > 0 ? px + 3 : px + w - 6, an.y - 5, 3, 10);
        // Drain bar.
        ctx.fillStyle = it.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(px + 9, an.y + h / 2 - 4, (w - 18) * ESA.clamp(it.left / it.total, 0, 1), 2);
        ctx.globalAlpha = 1;
        ctx.font = "800 10px " + ESA.FONT_DISPLAY;
        ctx.letterSpacing = "1.5px";
        ctx.textBaseline = "middle";
        ctx.textAlign = "left";
        ctx.fillStyle = it.color;
        ctx.fillText(it.label, px + 11, an.y - 1);
        ctx.textAlign = "right";
        ctx.fillStyle = "#fff6e4";
        ctx.fillText((Math.max(0, it.left) / 1000).toFixed(1), px + w - 9, an.y - 1);
        ctx.restore();
        x += dir * (w + 6);
      }
    }
  };

  /* ================================================================== *
   * Public API
   * ================================================================== */
  ESA.PowerUps = {
    SHRINK_SCALE: SHRINK_SCALE,
    CAMEO_IMPACT_AT: CAMEO_IMPACT_AT,
    COLORS: STATUS_COLORS,

    register: register,
    get: function (id) { return types[id] || null; },
    ids: function () { return order.slice(); },

    /** null when the game hasn't opted in - callers treat power-ups as optional. */
    createSession: function (config, opts) {
      if (!config || !config.enabled) return null;
      return new Session(config, opts || {});
    },

    Spawner: Spawner,
    Session: Session,
    pickCameo: pickCameo,
    drawDizzy: drawDizzy,
    drawSpeechBubble: drawSpeechBubble,
    drawCrowd: drawCrowd,
    drawCameo: drawCameo
  };

})(window.ESA);
