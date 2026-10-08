/* ==========================================================================
   ESA ARCADE - characters
   The central CHARACTER REGISTRY, the player-slot control schemes, the
   shared movement function, and the sprite renderer.

   ADDING A NEW ESA MEMBER
   -----------------------
   1. Drop a normal + hurt image pair into assets/.
   2. Add ONE ESA.Characters.register({...}) entry below.
   That's it. Character Select, Tournament participant select, the HUD,
   every minigame and the champion screen read from this registry.

   Controls belong to the PLAYER SLOT (P1 / P2), never to a character, so
   any character can be played on either side of the keyboard.
   ========================================================================== */

(function (ESA) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Player slots - controls live here, not on characters.
   * ------------------------------------------------------------------ */
  ESA.SLOTS = ["p1", "p2"];

  ESA.CONTROLS = {
    p1: {
      label: "Player 1",
      short: "P1",
      color: "#4aa3ff",
      move: { up: "KeyW", left: "KeyA", down: "KeyS", right: "KeyD" },
      booth: ["KeyA", "KeyS", "KeyD"],
      // Character Select / menus
      select: { up: "KeyW", left: "KeyA", down: "KeyS", right: "KeyD", lock: "Space" },
      selectLabel: { move: "W A S D", lock: "Space" },
      // Per-scheme labels: `text` for compact HUD, `caps` for key caps.
      schemes: {
        arena: { text: "W A S D", caps: ["W", "A", "S", "D"] },
        booth: { text: "A S D", caps: ["A", "S", "D"] }
      }
    },
    p2: {
      label: "Player 2",
      short: "P2",
      color: "#ff6a5c",
      move: { up: "ArrowUp", left: "ArrowLeft", down: "ArrowDown", right: "ArrowRight" },
      booth: ["KeyJ", "KeyK", "KeyL"],
      select: { up: "ArrowUp", left: "ArrowLeft", down: "ArrowDown", right: "ArrowRight", lock: "Enter" },
      selectLabel: { move: "Arrows", lock: "Enter" },
      schemes: {
        arena: { text: "Arrow Keys", caps: ["←", "↑", "↓", "→"] },
        booth: { text: "J K L", caps: ["J", "K", "L"] }
      }
    }
  };

  /** Controls for a slot in a given scheme ("arena" | "booth"). */
  ESA.controlsFor = function (slot, scheme) {
    var c = ESA.CONTROLS[slot];
    return (c && c.schemes[scheme]) || c.schemes.arena;
  };

  /* ------------------------------------------------------------------ *
   * Character registry
   * ------------------------------------------------------------------ */
  var registry = Object.create(null);
  var order = [];

  function normaliseTrim(t) {
    if (!t) return null;
    var out = {};
    ["normal", "hurt"].forEach(function (k) {
      var a = t[k];
      if (a && a.length >= 6) out[k] = { x: a[0], y: a[1], w: a[2], h: a[3], fileW: a[4], fileH: a[5] };
    });
    if (!out.normal) return null;
    if (!out.hurt) out.hurt = out.normal;
    return out;
  }

  ESA.Characters = {
    /**
     * Register an ESA member. Required: id, displayName, art.normal, art.hurt.
     *
     *   id            unique key, lower case
     *   displayName   shown everywhere
     *   art.normal    the normalSprite: selection, idle, gameplay default
     *   art.hurt      the hurtSprite: hit / KO / fail moments
     *   art.portrait  optional head-and-shoulders crop for menus
     *   art.selected  optional art shown when locked in
     *   art.victory   optional art for the champion screen
     *   trim          visible bounds of each image inside its file:
     *                   { normal: [x, y, w, h, fileW, fileH], hurt: [...] }
     *                 Art with transparent padding is cropped and scaled in
     *                 code from these numbers - the image files are never
     *                 edited. Omit it for art that is already tightly cropped.
     *   portraitFocus CSS object-position fallback for untrimmed portraits
     *   color         identity colour (HUD, frames)
     *   spriteH       arena sprite height in logical pixels
     *   slots         which player slots may use them (default both)
     *   available     false hides them from every selection screen
     *   tagline       optional one-liner for select screens
     *   victoryAnimation  optional CSS class applied on the champion screen
     */
    register: function (def) {
      if (!def || !def.id || registry[def.id]) {
        console.warn("[ESA] Character skipped (missing or duplicate id):", def && def.id);
        return;
      }
      var art = def.art || {};
      var c = {
        id: def.id,
        displayName: def.displayName || def.id,
        art: {
          normal: art.normal,
          hurt: art.hurt || art.normal,
          portrait: art.portrait || art.normal,
          selected: art.selected || art.normal,
          victory: art.victory || art.normal
        },
        portraitFocus: def.portraitFocus || "center 18%",
        color: def.color || "#c0871f",
        colorDeep: def.colorDeep || "#5c400c",
        spriteH: def.spriteH || 124,
        slots: def.slots || ESA.SLOTS.slice(),
        available: def.available !== false,
        tagline: def.tagline || "",
        victoryAnimation: def.victoryAnimation || null,
        trim: normaliseTrim(def.trim)
      };
      // Explicit sprite names for gameplay code.
      c.normalSprite = c.art.normal;
      c.hurtSprite = c.art.hurt;
      // Legacy aliases kept so older helper code reads naturally.
      c.name = c.displayName;
      c.normalSrc = c.art.normal;
      c.hurtSrc = c.art.hurt;

      registry[c.id] = c;
      order.push(c.id);
    },

    get: function (id) { return registry[id] || null; },

    /** Every available character, in registration order. */
    list: function () {
      return order.map(function (id) { return registry[id]; })
                  .filter(function (c) { return c.available; });
    },

    count: function () { return this.list().length; }
  };

  /* ================================================================== *
   * THE ROSTER - one entry per ESA member.
   * ================================================================== */
  ESA.Characters.register({
    id: "zima",
    displayName: "Zima",
    art: { normal: "assets/zima_normal.png", hurt: "assets/zima_hurt.png" },
    trim: { normal: [0, 0, 567, 903, 567, 903], hurt: [0, 0, 629, 860, 629, 860] },
    color: "#2f7fd8",
    colorDeep: "#15497f",
    spriteH: 126,
    tagline: "Founding member. Refuses to lose."
  });

  ESA.Characters.register({
    id: "shaza",
    displayName: "Shaza",
    art: { normal: "assets/shaza_normal.png", hurt: "assets/shaza_hurt.png" },
    trim: { normal: [0, 0, 629, 848, 629, 848], hurt: [0, 0, 713, 787, 713, 787] },
    color: "#9560ac",
    colorDeep: "#5d3570",
    spriteH: 122,
    tagline: "Calm, collected, dangerous."
  });

  ESA.Characters.register({
    id: "gneady",
    displayName: "Gneady",
    art: { normal: "assets/gneady_normal.png", hurt: "assets/gneady_hurt.png" },
    trim: { normal: [288, 152, 525, 799, 1024, 1024], hurt: [243, 68, 524, 887, 1024, 1024] },
    color: "#7b6cf0",
    colorDeep: "#3e3486",
    spriteH: 124,
    tagline: "Hands up. Already warmed up."
  });

  ESA.Characters.register({
    id: "ahmood",
    displayName: "Ahmood",
    art: { normal: "assets/ahmood_normal.png", hurt: "assets/ahmood_hurt.png" },
    trim: { normal: [177, 55, 669, 913, 1024, 1024], hurt: [123, 55, 759, 913, 1024, 1024] },
    color: "#2fb39a",
    colorDeep: "#16614f",
    spriteH: 124,
    tagline: "Sees every move coming."
  });

  ESA.Characters.register({
    id: "saif",
    displayName: "Saif",
    art: { normal: "assets/saif_normal.png", hurt: "assets/saif_hurt.png" },
    trim: { normal: [266, 71, 492, 898, 1024, 1024], hurt: [198, 70, 612, 899, 1024, 1024] },
    color: "#c28a57",
    colorDeep: "#6b4524",
    spriteH: 126,
    tagline: "Distinguished. Dangerously relaxed."
  });

  ESA.Characters.register({
    id: "amr",
    displayName: "Amr",
    art: { normal: "assets/amr_normal.png", hurt: "assets/amr_hurt.png" },
    trim: { normal: [255, 83, 591, 867, 1024, 1024], hurt: [86, 85, 850, 803, 1024, 1024] },
    color: "#e8b04a",
    colorDeep: "#7a5612",
    spriteH: 124,
    tagline: "Marketing VP. Runs on iced ideas."
  });

  ESA.Characters.register({
    id: "adam",
    displayName: "Adam",
    art: { normal: "assets/adam_normal.png", hurt: "assets/adam_hurt.png" },
    trim: { normal: [237, 70, 564, 899, 1024, 1024], hurt: [124, 73, 758, 896, 1024, 1024] },
    color: "#4fb7e6",
    colorDeep: "#1d5f7e",
    spriteH: 124,
    tagline: "Number one. Nothing gets past."
  });

  ESA.Characters.register({
    id: "maryam",
    displayName: "Maryam",
    art: { normal: "assets/maryam_normal.png", hurt: "assets/maryam_hurt.png" },
    trim: { normal: [296, 67, 444, 889, 1024, 1024], hurt: [221, 70, 566, 884, 1024, 1024] },
    color: "#e8584f",
    colorDeep: "#7e211b",
    spriteH: 124,
    tagline: "Helmet on. Full throttle."
  });

  ESA.Characters.register({
    id: "lama",
    displayName: "Lama",
    art: { normal: "assets/lama_normal.png", hurt: "assets/lama_hurt.png" },
    trim: { normal: [143, 55, 756, 914, 1024, 1024], hurt: [125, 140, 755, 829, 1024, 1024] },
    color: "#ff8fb1",
    colorDeep: "#8a3552",
    spriteH: 124,
    tagline: "Six. Seven. Gone."
  });

  /* ------------------------------------------------------------------ *
   * Compatibility views of the registry.
   * ------------------------------------------------------------------ */
  ESA.characters = new Proxy({}, {
    get: function (_, id) { return ESA.Characters.get(id); }
  });

  /** Image manifest: branding plus every available character's art. */
  ESA.buildManifest = function () {
    var m = { emblem: "assets/Branding/Golden Canadian Pharaoh Emblem.png" };
    ESA.Characters.list().forEach(function (c) {
      m[c.id + "_normal"] = c.art.normal;
      m[c.id + "_hurt"] = c.art.hurt;
    });
    return m;
  };

  /* ================================================================== *
   * Sprite geometry - ONE source of truth for how big a character is.
   * Canvas drawing, menu portraits and gameplay hitboxes all derive from
   * the same visible-art rectangle, so what you see is what collides.
   * ================================================================== */

  /**
   * Source rectangle of the visible art inside the image file.
   * Falls back to the whole loaded image when no trim data exists.
   */
  ESA.spriteBox = function (charId, hurt) {
    var c = ESA.Characters.get(charId);
    var t = c && c.trim && c.trim[hurt ? "hurt" : "normal"];
    if (t) return t;
    var img = ESA.Assets.get(charId + (hurt ? "_hurt" : "_normal"));
    var w = (img && img.width) || 100, h = (img && img.height) || 100;
    return { x: 0, y: 0, w: w, h: h, fileW: w, fileH: h };
  };

  /**
   * Rendered size of a sprite whose NORMAL art is `height` px tall.
   * Hurt art drawn on the same canvas size as the normal art (same artist
   * framing) keeps the normal art's scale, so the character never
   * shrinks or grows when hit; separately cropped files are normalised
   * to the same height instead.
   */
  ESA.spriteSize = function (charId, hurt, height) {
    var c = ESA.Characters.get(charId);
    height = height || (c ? c.spriteH : 124);
    var n = ESA.spriteBox(charId, false);
    if (!hurt) return { w: n.w * (height / n.h), h: height, box: n };
    var b = ESA.spriteBox(charId, true);
    var sameFrame = b.fileW === n.fileW && b.fileH === n.fileH && (b.fileW !== n.w || b.fileH !== n.h);
    var scale = sameFrame ? height / n.h : height / b.h;
    return { w: b.w * scale, h: b.h * scale, box: b };
  };

  /**
   * Gameplay body bounds for a player, in arena coordinates.
   * A centred box derived from the RENDERED sprite (not the feet point):
   * trimmed of the outer edges where hair, arms and props stick out, so
   * contact feels fair and every character uses the same formula.
   */
  ESA.BODY_INSET = { x: 0.16, top: 0.04, bottom: 0.03 };
  ESA.DEBUG_HITBOX = /[?&]hitbox\b/.test(window.location.search);
  ESA.bodyBounds = function (p) {
    var s = ESA.spriteSize(p.character.id, false, p.character.spriteH);
    var ins = ESA.BODY_INSET;
    var w = s.w * (1 - ins.x * 2);
    var h = s.h * (1 - ins.top - ins.bottom);
    var top = p.y - s.h + s.h * ins.top;
    return { x: p.x - w / 2, y: top, w: w, h: h, cx: p.x, cy: top + h / 2 };
  };

  /** Circle (cx, cy, r) vs rectangle overlap. */
  ESA.circleHitsRect = function (cx, cy, r, rect) {
    var nx = ESA.clamp(cx, rect.x, rect.x + rect.w);
    var ny = ESA.clamp(cy, rect.y, rect.y + rect.h);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  };

  /* ------------------------------------------------------------------ *
   * DOM art (menus). Two framings, both computed from the trim data:
   *   "head" - a square head-and-shoulders crop for faces and tiles.
   *            The <img> is positioned inside an overflow:hidden square,
   *            which works in every browser.
   *   "body" - the full visible character, padding removed, via CSS
   *            object-view-box (Chromium). Other browsers simply show the
   *            image with its transparent padding.
   * ------------------------------------------------------------------ */
  function headCrop(c, b) {
    var side = Math.min(b.w, b.h * 0.56);
    var x = b.x + b.w / 2 - side / 2;
    var y = Math.max(0, b.y - side * 0.03);
    return { x: x, y: y, side: side };
  }

  /** Inline style for an <img> filling a square overflow:hidden box. */
  ESA.headStyle = function (c) {
    if (!c || !c.trim) return "width:100%;height:100%;object-fit:cover;object-position:" + (c ? c.portraitFocus : "center");
    var b = c.trim.normal, k = headCrop(c, b);
    var pct = function (v) { return (v * 100).toFixed(2) + "%"; };
    return "position:absolute;max-width:none;object-fit:fill;" +
           "width:" + pct(b.fileW / k.side) + ";height:" + pct(b.fileH / k.side) + ";" +
           "left:" + pct(-k.x / k.side) + ";top:" + pct(-k.y / k.side) + ";";
  };

  /** Inline style for a full-body <img> with the padding removed. */
  ESA.bodyStyle = function (c, which) {
    var t = c && c.trim && c.trim[which || "normal"];
    if (!t) return "";
    return "object-view-box:inset(" + t.y + "px " + (t.fileW - t.x - t.w) + "px " +
           (t.fileH - t.y - t.h) + "px " + t.x + "px);";
  };

  /** Point an existing <img> at a character's art in a given framing. */
  ESA.setArt = function (img, c, which, framing) {
    if (!img || !c) return;
    var src = which === "hurt" ? c.art.hurt : which === "victory" ? c.art.victory
            : which === "selected" ? c.art.selected : c.art.normal;
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    var trimKey = which === "hurt" ? "hurt" : "normal";
    img.setAttribute("style", framing === "head" ? ESA.headStyle(c) : ESA.bodyStyle(c, trimKey));
  };

  /**
   * Resolves who is playing a match. In a mirror match (same character on
   * both sides) the labels gain P1/P2 and P2 takes the slot colour so the
   * two can always be told apart.
   */
  ESA.describeMatchup = function (setup) {
    var c1 = ESA.Characters.get(setup.p1);
    var c2 = ESA.Characters.get(setup.p2);
    var mirror = c1 && c2 && c1.id === c2.id;
    return {
      mirror: mirror,
      p1: { slot: "p1", character: c1, name: mirror ? c1.displayName + " P1" : c1.displayName,
            color: c1.color },
      p2: { slot: "p2", character: c2, name: mirror ? c2.displayName + " P2" : c2.displayName,
            color: mirror ? ESA.CONTROLS.p2.color : c2.color }
    };
  };

  /* ------------------------------------------------------------------ *
   * Player factory
   * `slot` is "p1" | "p2" and decides the controls; `who` is the entry
   * from ESA.describeMatchup(). `y` is the FEET anchor. Collisions use the
   * feet position for both players, so comparisons stay symmetric.
   * ------------------------------------------------------------------ */
  ESA.makePlayer = function (who, x, y, opts) {
    opts = opts || {};
    return {
      slot: who.slot,
      character: who.character,
      name: who.name,
      color: who.color,
      controls: ESA.CONTROLS[who.slot].move,
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
    var c = p.controls;
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

    // Only the visible part of the file is drawn (transparent padding is
    // skipped), scaled so the NORMAL art stands `height` px tall.
    var size = ESA.spriteSize(charId, hurt, o.height);
    var b = size.box;
    var w = size.w, h = size.h;
    var sx = o.scaleX === undefined ? 1 : o.scaleX;
    var sy = o.scaleY === undefined ? 1 : o.scaleY;

    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.translate(cx, cy - (o.bounce || 0));
    if (o.rotate) ctx.rotate(o.rotate);
    ctx.scale(o.flip ? -sx : sx, sy);
    ctx.drawImage(img, b.x, b.y, b.w, b.h, -w / 2, -h, w, h);
    ctx.restore();
  };

  /**
   * Draws normal and hurt art blended by `blend` (0 = normal, 1 = hurt), so
   * switching state is a quick crossfade instead of a hard pop.
   */
  ESA.HURT_FADE_MS = 110;
  ESA.drawSpriteBlend = function (ctx, charId, blend, cx, cy, o) {
    o = o || {};
    if (blend <= 0.001) { ESA.drawSprite(ctx, charId, false, cx, cy, o); return; }
    if (blend >= 0.999) { ESA.drawSprite(ctx, charId, true, cx, cy, o); return; }
    var base = o.alpha === undefined ? 1 : o.alpha;
    o.alpha = base * (1 - blend);
    ESA.drawSprite(ctx, charId, false, cx, cy, o);
    o.alpha = base * blend;
    ESA.drawSprite(ctx, charId, true, cx, cy, o);
    o.alpha = base;
  };

  /** 0..1 hurt blend for an arena player, fading in and out of the hurt art. */
  ESA.hurtBlend = function (p, now) {
    if (!ESA.isHurt(p, now)) return 0;
    var start = p.hurtUntil - p.hurtFor;
    var fade = ESA.HURT_FADE_MS;
    return ESA.clamp(Math.min((now - start) / fade, (p.hurtUntil - now) / fade), 0, 1);
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
    // Shadow width follows the character's rendered width (wide stances
    // get a wider shadow) within sensible limits.
    var shadowW = ESA.clamp(ESA.spriteSize(p.character.id, false, h).w * 0.46, 30, 48);
    ctx.ellipse(p.x, p.y + 2, shadowW * shadowSquash, 11 * shadowSquash, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* --- Sprite ----------------------------------------------------- */
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.32)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 6;
    ESA.drawSpriteBlend(ctx, p.character.id, ESA.hurtBlend(p, now), p.x, p.y, {
      height: h,
      flip: p.facing === "left",
      bounce: bounce,
      scaleX: scaleX,
      scaleY: scaleY,
      rotate: rot
    });
    ctx.restore();

    /* --- Debug: gameplay body bounds (open index.html?hitbox) --------- */
    if (ESA.DEBUG_HITBOX) {
      var bb = ESA.bodyBounds(p);
      ctx.save();
      ctx.strokeStyle = "rgba(0,255,170,.9)";
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(bb.x, bb.y, bb.w, bb.h);
      ctx.restore();
    }

    /* --- Name plate -------------------------------------------------- */
    if (opts.nameplate !== false) {
      var label = p.name.toUpperCase();
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
      ctx.strokeStyle = p.color;
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
