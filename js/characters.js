/* ==========================================================================
   ESA ARCADE - characters
   Roster data, the shared movement function, and the sprite renderer with
   its lightweight idle / walk / recoil animation.

   The roster stays data driven: adding a future ESA member means adding one
   object here plus a normal/hurt image pair. No game file hard-codes a name.
   ========================================================================== */

(function (ESA) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Roster
   * ------------------------------------------------------------------ */
  ESA.characters = {
    zima: {
      id: "zima",
      name: "Zima",
      normalSrc: "assets/zima_normal.png",
      hurtSrc: "assets/zima_hurt.png",
      color: "#2f7fd8",
      colorDeep: "#15497f",
      // Arena movement
      controls: { up: "KeyW", left: "KeyA", down: "KeyS", right: "KeyD" },
      controlLabel: "W A S D",
      // Bonk Booth
      bonkKeys: ["KeyA", "KeyS", "KeyD"],
      bonkLabel: "A S D",
      spriteH: 126
    },
    shaza: {
      id: "shaza",
      name: "Shaza",
      normalSrc: "assets/shaza_normal.png",
      hurtSrc: "assets/shaza_hurt.png",
      color: "#9560ac",
      colorDeep: "#5d3570",
      controls: { up: "ArrowUp", left: "ArrowLeft", down: "ArrowDown", right: "ArrowRight" },
      controlLabel: "Arrow Keys",
      bonkKeys: ["KeyJ", "KeyK", "KeyL"],
      bonkLabel: "J K L",
      spriteH: 122
    }
  };

  /** Stable play order. Future members append here. */
  ESA.roster = ["zima", "shaza"];

  /** Image manifest built from the roster plus branding. */
  ESA.buildManifest = function () {
    var m = {
      emblem: "assets/Branding/Golden Canadian Pharaoh Emblem.png"
    };
    ESA.roster.forEach(function (id) {
      var c = ESA.characters[id];
      m[id + "_normal"] = c.normalSrc;
      m[id + "_hurt"] = c.hurtSrc;
    });
    return m;
  };

  /* ------------------------------------------------------------------ *
   * Player factory
   * `y` is the FEET anchor. Collisions use the feet position for both
   * players, so comparisons stay symmetric and tokens on the floor line up.
   * ------------------------------------------------------------------ */
  ESA.makePlayer = function (characterId, x, y, opts) {
    opts = opts || {};
    var c = ESA.characters[characterId];
    return {
      character: c,
      x: x,
      y: y,
      spawnX: x,
      spawnY: y,
      speed: opts.speed || 180,
      facing: opts.facing || "right",
      r: opts.r || 34,            // collision radius, independent of artwork
      moving: false,
      animTime: 0,
      lean: 0,
      hurtUntil: 0,
      hurtFor: 0,
      recoilX: 0,
      recoilY: 0
    };
  };

  /* ------------------------------------------------------------------ *
   * Movement
   * Preserved from V1: 8-way, normalised diagonals, clamped to the arena.
   * `enabled` is false during the countdown and after a match ends.
   * ------------------------------------------------------------------ */
  ESA.movePlayer = function (p, dt, bounds, enabled) {
    var c = p.character.controls;
    var dx = 0, dy = 0;

    if (enabled) {
      dx = (ESA.Input.isDown(c.right) ? 1 : 0) - (ESA.Input.isDown(c.left) ? 1 : 0);
      dy = (ESA.Input.isDown(c.down) ? 1 : 0) - (ESA.Input.isDown(c.up) ? 1 : 0);
    }

    p.moving = (dx !== 0 || dy !== 0);

    if (p.moving) {
      var len = Math.hypot(dx, dy) || 1;
      p.x += (dx / len) * p.speed * dt;
      p.y += (dy / len) * p.speed * dt;
      if (dx < -0.1) p.facing = "left";
      if (dx > 0.1) p.facing = "right";
    }

    // Recoil decays toward zero (knockback from a bomb pass or a hit).
    if (p.recoilX || p.recoilY) {
      p.x += p.recoilX * dt;
      p.y += p.recoilY * dt;
      var decay = Math.pow(0.0045, dt);
      p.recoilX *= decay;
      p.recoilY *= decay;
      if (Math.abs(p.recoilX) < 1) p.recoilX = 0;
      if (Math.abs(p.recoilY) < 1) p.recoilY = 0;
    }

    // Guard against any NaN sneaking in, then clamp inside the arena.
    p.x = ESA.clamp(ESA.safe(p.x, p.spawnX), bounds.left, bounds.right);
    p.y = ESA.clamp(ESA.safe(p.y, p.spawnY), bounds.top, bounds.bottom);

    // Animation clock advances faster while walking.
    p.animTime += dt * (p.moving ? 9.2 : 2.1);

    var targetLean = p.moving ? (p.facing === "left" ? -0.07 : 0.07) : 0;
    p.lean += (targetLean - p.lean) * Math.min(1, dt * 9);
  };

  /** Keeps two players from standing exactly on top of each other. */
  ESA.separate = function (a, b, minDist) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var d = Math.hypot(dx, dy);
    if (d >= minDist) return;
    if (d < 0.001) { dx = 1; dy = 0; d = 1; }
    var push = (minDist - d) / 2;
    a.x -= (dx / d) * push;
    a.y -= (dy / d) * push;
    b.x += (dx / d) * push;
    b.y += (dy / d) * push;
  };

  /* ------------------------------------------------------------------ *
   * Sprite rendering
   * ------------------------------------------------------------------ */

  /** True while the character should show the hurt artwork. */
  ESA.isHurt = function (p, now) {
    return p.hurtUntil > 0 && now < p.hurtUntil;
  };

  /** Trigger the hurt state plus a recoil push. */
  ESA.hurt = function (p, now, ms, pushX, pushY) {
    p.hurtFor = ms || 1200;
    p.hurtUntil = now + p.hurtFor;
    p.recoilX = pushX || 0;
    p.recoilY = pushY || 0;
  };

  /** Where the character's torso sits, for anchoring the bomb / markers. */
  ESA.bodyTop = function (p) {
    return p.y - p.character.spriteH * 0.92;
  };

  /**
   * Low-level sprite blit used by both the arena and the Bonk Booth.
   * `cx, cy` is the feet anchor. Options: flip, height, bounce, scaleX,
   * scaleY, rotate, alpha.
   */
  ESA.drawSprite = function (ctx, charId, hurt, cx, cy, o) {
    o = o || {};
    var img = ESA.Assets.get(charId + (hurt ? "_hurt" : "_normal"));
    if (!img || !img.width) return;

    var h = o.height || ESA.characters[charId].spriteH;
    var w = h * (img.width / img.height);
    var sx = o.scaleX === undefined ? 1 : o.scaleX;
    var sy = o.scaleY === undefined ? 1 : o.scaleY;

    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha = o.alpha;
    ctx.translate(cx, cy - (o.bounce || 0));
    if (o.rotate) ctx.rotate(o.rotate);
    ctx.scale(o.flip ? -sx : sx, sy);
    ctx.drawImage(img, -w / 2, -h, w, h);
    ctx.restore();
  };

  /**
   * Full arena character: contact shadow, animated sprite, name plate.
   * All life comes from transforms -- no per-frame image work.
   */
  ESA.drawCharacter = function (ctx, p, now, opts) {
    opts = opts || {};
    var hurt = ESA.isHurt(p, now);
    var h = p.character.spriteH;

    /* --- Animation state ------------------------------------------- */
    var bounce = 0, scaleX = 1, scaleY = 1, rot = p.lean;

    if (p.moving) {
      // Walk cycle: a lifted step with a small squash on each landing.
      var lift = Math.abs(Math.sin(p.animTime));
      bounce = lift * 7;
      scaleY = 1 + lift * 0.05 - (1 - lift) * 0.035;
      scaleX = 1 - (scaleY - 1) * 0.75;
    } else {
      // Idle: slow breathing bob.
      var idle = Math.sin(p.animTime);
      bounce = idle * 2.2 + 2.2;
      scaleY = 1 + idle * 0.016;
      scaleX = 1 - idle * 0.012;
    }

    if (hurt) {
      // Recoil: a sharp pop that settles, plus a shaken tilt.
      var t = 1 - (p.hurtUntil - now) / Math.max(1, p.hurtFor);  // 0 -> 1
      var punch = Math.max(0, 1 - t * 4);                        // first quarter
      scaleX *= 1 + punch * 0.18;
      scaleY *= 1 - punch * 0.12;
      rot += Math.sin(now / 34) * 0.05 * (1 - t);
      bounce += punch * 6;
    }

    if (opts.scale) { scaleX *= opts.scale; scaleY *= opts.scale; }

    /* --- Contact shadow -------------------------------------------- */
    var shadowSquash = 1 - (bounce / 42);
    ctx.save();
    ctx.globalAlpha = 0.26 * shadowSquash;
    ctx.fillStyle = "#22180c";
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 2, 40 * shadowSquash, 11 * shadowSquash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* --- Sprite ----------------------------------------------------- */
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.32)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    ESA.drawSprite(ctx, p.character.id, hurt, p.x, p.y, {
      height: h,
      flip: p.facing === "left",
      bounce: bounce,
      scaleX: scaleX,
      scaleY: scaleY,
      rotate: rot
    });
    ctx.restore();

    /* --- Name plate -------------------------------------------------- */
    if (opts.nameplate !== false) {
      var label = p.character.name.toUpperCase();
      ctx.save();
      ctx.font = "700 13px " + ESA.FONT_DISPLAY;
      var tw = ctx.measureText(label).width;
      var pw = tw + 22;
      var py = p.y + 9;

      ctx.globalAlpha = 0.92;
      ESA.roundRect(ctx, p.x - pw / 2, py, pw, 21, 10);
      ctx.fillStyle = "rgba(7,23,40,.88)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = p.character.color;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.fillStyle = "#fff6e4";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.letterSpacing = "1px";
      ctx.fillText(label, p.x, py + 11);
      ctx.restore();
    }
  };

})(window.ESA);
