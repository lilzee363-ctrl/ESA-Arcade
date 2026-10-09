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

   CHARACTERS ARE NOT PARTICIPANTS
   -------------------------------
   A character is permanent roster ART. Who is actually playing is a
   PARTICIPANT (js/participants.js): a roster character in its Normal or
   Evil variant, or a temporary Guest. Every sprite / geometry helper below
   takes an AVATAR KEY ("zima", "zima~evil", "guest~participant-07") and
   resolves it through ESA.Avatars, so games never need to know which kind
   of participant they are drawing. Gameplay geometry always comes from
   the base art, so variants can never change a collider.
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
      action: "Space",            // in-game action (e.g. Air Hockey dash)
      booth: ["KeyA", "KeyS", "KeyD"],
      // Character Select / menus
      select: { up: "KeyW", left: "KeyA", down: "KeyS", right: "KeyD", lock: "Space" },
      selectLabel: { move: "W A S D", lock: "Space" },
      // Per-scheme labels: `text` for compact HUD, `caps` for key caps.
      schemes: {
        arena: { text: "W A S D", caps: ["W", "A", "S", "D"] },
        booth: { text: "A S D", caps: ["A", "S", "D"] },
        hockey: { text: "W A S D + Space", caps: ["W", "A", "S", "D", "SPC"] }
      }
    },
    p2: {
      label: "Player 2",
      short: "P2",
      color: "#ff6a5c",
      move: { up: "ArrowUp", left: "ArrowLeft", down: "ArrowDown", right: "ArrowRight" },
      action: "Enter",
      booth: ["KeyJ", "KeyK", "KeyL"],
      select: { up: "ArrowUp", left: "ArrowLeft", down: "ArrowDown", right: "ArrowRight", lock: "Enter" },
      selectLabel: { move: "Arrows", lock: "Enter" },
      schemes: {
        arena: { text: "Arrow Keys", caps: ["←", "↑", "↓", "→"] },
        booth: { text: "J K L", caps: ["J", "K", "L"] },
        hockey: { text: "Arrows + Enter", caps: ["←", "↑", "↓", "→", "ENT"] }
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

  /**
   * Optional PRESENTATION-ONLY tuning for menu art (VS, select panels,
   * final, champion). Never read by gameplay, colliders or physics.
   *   ui: { scale: 1, offsetX: 0, offsetY: 0 }
   * scale multiplies the drawn height; offsets are fractions of that height
   * (+x right, +y down). Delete the field once a sprite is re-cropped.
   */
  function normaliseUi(u) {
    u = u || {};
    var num = function (v, d) { v = Number(v); return isFinite(v) ? v : d; };
    return {
      scale: ESA.clamp(num(u.scale, 1), 0.6, 1.4),
      offsetX: ESA.clamp(num(u.offsetX, 0), -0.5, 0.5),
      offsetY: ESA.clamp(num(u.offsetY, 0), -0.5, 0.5)
    };
  }

  /**
   * Optional Evil-variant eye anchors, in IMAGE-FILE pixels, per art state:
   *   evil: {
   *     normal: { r: 15, eyes: [[x, y], [x, y, 0.6]] },          // visible eyes
   *     hurt:   { r: 14, lens: [[cx, cy, rx, ry], ...], eyes: [...] } // glasses
   *   }
   * eyes  [x, y, intensity?]  pupil centres; intensity < 1 for a closed /
   *                           squinting eye (a dim ember instead of a glare).
   * lens  [cx, cy, rx, ry]    glasses lenses: a red glow THROUGH the glass,
   *                           with the pupils (eyes) burning inside it.
   * r     pupil glow radius in file pixels.
   * A state with no data falls back to a conservative eye-line glow (see
   * js/variants.js) and is reported in the console as needing tuning.
   * Check anchors with index.html?eyes (dev only).
   */
  function normaliseEyes(e) {
    if (!e) return null;
    var out = {};
    ["normal", "hurt"].forEach(function (k) {
      var s = e[k];
      if (!s) return;
      var pts = function (list, n) {
        return (list || []).filter(function (p) { return p && p.length >= n; }).map(function (p) { return p.slice(); });
      };
      out[k] = { r: Number(s.r) || 14, eyes: pts(s.eyes, 2), lens: pts(s.lens, 4) };
    });
    return out;
  }

  /**
   * PRESENTATION-ONLY: may this art be drawn horizontally flipped?
   *   mirrorSafe: true | false | { normal: bool, hurt: bool }
   * Art with baked-in text, numbers or logos must say false, or that text
   * reads backwards whenever the character stands on the right. Default true.
   */
  function normaliseMirror(m) {
    if (m === false) return { normal: false, hurt: false };
    if (m && typeof m === "object") return { normal: m.normal !== false, hurt: m.hurt !== false };
    return { normal: true, hurt: true };
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
     *   ui            optional menu-art tuning { scale, offsetX, offsetY }
     *                 (presentation only - see normaliseUi)
     *   evil          optional Evil-variant eye anchors (see normaliseEyes).
     *                 Every character automatically gets an Evil variant
     *                 built from these SAME image files - never add
     *                 evil_*.png assets.
     *   mirrorSafe    optional, presentation only (see normaliseMirror):
     *                 false (or { normal, hurt }) for art with readable
     *                 text / numbers / logos. Such art is never flipped -
     *                 placement alone puts it on its side. The Evil variant
     *                 inherits the same rule.
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
        trim: normaliseTrim(def.trim),
        ui: normaliseUi(def.ui),
        evilEyes: normaliseEyes(def.evil),
        mirrorSafe: normaliseMirror(def.mirrorSafe)
      };
      // Avatar fields (see js/participants.js). A registry entry IS the
      // Normal-variant avatar; Evil avatars inherit from it.
      c.baseId = c.id;
      c.variant = "normal";
      c.evil = false;
      c.isGuest = false;
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
    evil: {
      normal: { r: 15, eyes: [[183, 285], [318, 275]] },
      hurt:   { r: 14, eyes: [[205, 300, 0.55], [335, 233]] }
    },
    mirrorSafe: false,                          // PSG crest ("PARIS") + Nike logos, both states
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
    evil: {   // glasses in the normal art; they fly off in the hurt art
      normal: { r: 13, lens: [[265, 252, 60, 48], [418, 232, 52, 44]], eyes: [[290, 243], [418, 224]] },
      hurt:   { r: 13, eyes: [[228, 240, 0.55], [352, 178]] }
    },
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
    evil: {
      normal: { r: 15, eyes: [[495, 428], [627, 406]] },
      hurt:   { r: 14, eyes: [[405, 530, 0.55], [522, 470]] }
    },
    mirrorSafe: { normal: true, hurt: false },  // hurt: "LaGooGoo" lettering
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
    evil: {   // clear-framed glasses
      normal: { r: 16, lens: [[455, 385, 72, 50], [655, 352, 70, 48]], eyes: [[478, 374], [642, 343]] },
      hurt:   { r: 14, lens: [[220, 380, 75, 55], [410, 320, 70, 50]], eyes: [[232, 378, 0.5], [400, 318, 0.5]] }
    },
    mirrorSafe: { normal: true, hurt: false },  // hurt: "WAAAA2" lettering
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
    evil: {   // wire glasses, three-quarter view
      normal: { r: 11, lens: [[590, 238, 40, 30], [672, 272, 34, 30]], eyes: [[583, 240], [658, 268]] },
      hurt:   { r: 12, lens: [[340, 305, 42, 32], [432, 262, 38, 30]], eyes: [[355, 308], [420, 270, 0.55]] }
    },
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
    evil: {
      normal: { r: 13, eyes: [[466, 302], [574, 290]] },
      hurt:   { r: 13, eyes: [[272, 697], [367, 688]] }
    },
    mirrorSafe: false,                          // IDEAS cup, MARKETING VP, AMR badge; hurt: speech bubbles
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
    evil: {   // round wire glasses
      normal: { r: 13, lens: [[405, 333, 45, 38], [562, 312, 46, 38]], eyes: [[420, 330], [555, 308]] },
      hurt:   { r: 13, lens: [[355, 515, 50, 40], [548, 488, 50, 42]], eyes: [[355, 520, 0.55], [550, 490]] }
    },
    mirrorSafe: false,                          // shirt / shorts number "1", both states
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
    evil: {
      normal: { r: 12, eyes: [[447, 272], [515, 238]] },
      hurt:   { r: 13, eyes: [[451, 380], [575, 410]] }
    },
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
    evil: {
      normal: { r: 14, eyes: [[466, 278], [580, 234]] },
      hurt:   { r: 14, eyes: [[300, 525, 0.55], [462, 480]] }
    },
    mirrorSafe: { normal: false, hurt: true },  // normal: the 6 / 7 numbers
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
  /** Avatar for a key ("zima", "zima~evil", "guest~...") or a character object. */
  function vis(key) {
    if (key && typeof key === "object") return key;
    return ESA.Avatars ? ESA.Avatars.get(key) : ESA.Characters.get(key);
  }
  ESA.visualOf = vis;

  /**
   * May this avatar's art (normal or hurt state) be drawn flipped?
   * Roster entries carry mirrorSafe; Evil avatars inherit it from their
   * base entry (same PNGs, same rule). Guests are generated art with no
   * text, so they default to safe unless their avatar says otherwise.
   * Presentation only - never consulted by movement, colliders or physics.
   */
  ESA.canMirror = function (charId, hurt) {
    var c = vis(charId);
    var m = c && c.mirrorSafe;
    if (m === false) return false;
    if (!m || typeof m !== "object") return true;
    return hurt ? m.hurt !== false : m.normal !== false;
  };

  ESA.spriteBox = function (charId, hurt) {
    var c = vis(charId);
    var t = c && c.trim && c.trim[hurt ? "hurt" : "normal"];
    if (t) return t;
    // Geometry always comes from the BASE art (an Evil variant measures
    // exactly like its Normal self).
    var img = ESA.Assets.get(((c && c.baseId) || charId) + (hurt ? "_hurt" : "_normal"));
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
    var c = vis(charId);
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
   *   "body" - the full visible character in an .art-frame: a box with the
   *            aspect ratio of the VISIBLE art (trim), sized by CSS to fit
   *            its slot, with the <img> placed inside so the transparent
   *            padding falls outside the frame. Works in every browser, so
   *            every fighter stands at the same height regardless of how
   *            much padding their PNG has. (Replaces object-view-box, which
   *            only Chromium supports - Safari showed the padding, making
   *            tightly-cropped files look far bigger than padded ones.)
   * ------------------------------------------------------------------ */
  function headCrop(c, b) {
    var side = Math.min(b.w, b.h * 0.56);
    var x = b.x + b.w / 2 - side / 2;
    var y = Math.max(0, b.y - side * 0.03);
    return { x: x, y: y, side: side };
  }

  /** Square head crop (file pixels) of a character's normal art, or null. */
  ESA.headCrop = function (c) {
    return c && c.trim ? headCrop(c, c.trim.normal) : null;
  };

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

  function artSrc(c, which) {
    return which === "hurt" ? c.art.hurt : which === "victory" ? c.art.victory
         : which === "selected" ? c.art.selected : c.art.normal;
  }

  /** Inline styles for a body frame and its <img> (see "body" above). */
  ESA.bodyFrame = function (c, which) {
    var t = c && c.trim && c.trim[which === "hurt" ? "hurt" : "normal"];
    var ui = (c && c.ui) || { scale: 1, offsetX: 0, offsetY: 0 };
    var frame = "--ui-s:" + ui.scale + ";--ui-x:" + ui.offsetX + ";--ui-y:" + ui.offsetY + ";";
    if (!t) return { frame: frame, img: "" };     // untrimmed: CSS contain-fits the whole file
    var pct = function (v) { return (v * 100).toFixed(3) + "%"; };
    return {
      frame: frame + "--ar:" + (t.w / t.h).toFixed(4) + ";",
      img: "left:" + pct(-t.x / t.w) + ";top:" + pct(-t.y / t.h) + ";" +
           "width:" + pct(t.fileW / t.w) + ";height:" + pct(t.fileH / t.h) + ";object-fit:fill;"
    };
  };

  /** Markup for a body-framed character: <span class="art-frame CLS"><img></span>. */
  ESA.bodyArtHTML = function (c, which, cls, attrs) {
    var f = ESA.bodyFrame(c, which);
    var q = function (s) { return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;"); };
    var V = ESA.Variants;
    var evil = !!(c && c.evil);
    var fixed = c && !ESA.canMirror(c, which === "hurt");
    return '<span class="art-frame ' + q(cls || "") + (evil ? " is-evil" : "") + (fixed ? " no-mirror" : "") +
           '" style="' + q(f.frame) + '"' + (attrs || "") + '>' +
           '<img class="art-img" src="' + q(artSrc(c, which)) + '" alt="" draggable="false" style="' + q(f.img) + '" />' +
           (evil && V ? V.bodyOverlayHTML(c, which) : "") + "</span>";
  };

  /** Point an existing <img> (or .art-frame) at a character's art in a given framing. */
  ESA.setArt = function (img, c, which, framing) {
    if (!img || !c) return;
    if (framing === "body" && img.classList.contains("art-frame")) {
      var f = ESA.bodyFrame(c, which);
      var inner = img.querySelector(".art-img");
      img.setAttribute("style", f.frame);
      if (inner.getAttribute("src") !== artSrc(c, which)) inner.setAttribute("src", artSrc(c, which));
      inner.setAttribute("style", f.img);
      // Side-flipping CSS (P2 select panel, VS, Final) skips mirror-unsafe art.
      img.classList.toggle("no-mirror", !ESA.canMirror(c, which === "hurt"));
      if (ESA.Variants) ESA.Variants.decorate(img, c, which, "body");
      return;
    }
    var src = which === "hurt" ? c.art.hurt : which === "victory" ? c.art.victory
            : which === "selected" ? c.art.selected : c.art.normal;
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
    var trimKey = which === "hurt" ? "hurt" : "normal";
    img.setAttribute("style", framing === "head" ? ESA.headStyle(c) : ESA.bodyStyle(c, trimKey));
    if (framing === "head" && ESA.Variants) ESA.Variants.decorate(img, c, which, "head");
  };

  /* ESA.describeMatchup (who is playing a match) lives in js/participants.js:
     setups carry PARTICIPANT ids, which it resolves to a name + avatar. */

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
      participantId: who.participantId || null,
      character: who.character,         // resolved avatar (visual only)
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
      recoilY: 0,
      // Fraction of a knockback left after one second (games may tune it:
      // a lower value = a shorter, snappier shove).
      recoilDecay: opts.recoilDecay || 0.0045,
      // Optional momentum model (see movePlayer). null = classic instant
      // start / stop, exactly as before.
      smooth: opts.smooth || null,
      vx: 0,
      vy: 0
    };
  };

  /*
   * Momentum model for arena movement (V4.1, Bomb Pass). Per second,
   * exponential approach - frame-rate independent. Velocity is split into
   * ALONG the stick and SIDEWAYS to it and each part is steered at its
   * own rate, so a new direction takes over almost at once while starting
   * and stopping keep a touch of weight. The TOP SPEED is still p.speed:
   * velocity only ever approaches it from below (nothing overshoots).
   *   accel    speeding up along the stick         ~0.09 s to 90%
   *   reverse  velocity pointing against the stick ~0.07 s
   *   turn     sideways velocity on a turn          ~0.08 s
   *   brake    stick released                      ~0.10 s to 10%
   */
  ESA.SMOOTH_MOVE = { accel: 26, reverse: 34, turn: 30, brake: 23 };

  /* ------------------------------------------------------------------ *
   * Movement
   * Preserved from V1: 8-way, normalised diagonals, clamped to the arena.
   * `enabled` is false during the countdown and after a match ends.
   * ------------------------------------------------------------------ */
  ESA.movePlayer = function (p, dt, bounds, enabled) {
    // Normalized intent from every source (keyboard: identical to the old
    // digital WASD / arrows vector; touch: analog joystick, length <= 1).
    var v = enabled && !p.frozen ? ESA.Controls.vector(p.slot) : null;
    // A game may set p.reversed (Coin Rush's cursed REVERSE pickup): the
    // already-resolved intent (last-pressed-wins, normalised diagonals, or
    // the analog stick) is flipped on both axes - nothing else changes.
    if (v && p.reversed) v = { x: -v.x, y: -v.y };
    var dx = v ? v.x : 0, dy = v ? v.y : 0;
    if (v && p.track) ESA.Dash.track(p.track, v);

    var held = (dx !== 0 || dy !== 0);
    var ox = p.x, oy = p.y;

    if (p.smooth) {
      var S = p.smooth;
      if (held) {
        var mag = Math.min(1, Math.hypot(dx, dy));
        var ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
        var along = p.vx * ux + p.vy * uy;
        var sx = p.vx - along * ux, sy = p.vy - along * uy;
        var target = mag * p.speed;
        var rate = along < 0 ? S.reverse : along > target ? S.turn : S.accel;
        along += (target - along) * (1 - Math.exp(-rate * dt));
        var keepSide = Math.exp(-S.turn * dt);
        p.vx = along * ux + sx * keepSide;
        p.vy = along * uy + sy * keepSide;
      } else {
        var keep = Math.exp(-S.brake * dt);
        p.vx *= keep; p.vy *= keep;
        if (Math.abs(p.vx) < 3) p.vx = 0;
        if (Math.abs(p.vy) < 3) p.vy = 0;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.moving = held || Math.hypot(p.vx, p.vy) > 30;
      // Facing follows real motion, with a little hysteresis (no flicker).
      if (p.vx < -24 || (held && dx < -0.1)) p.facing = "left";
      else if (p.vx > 24 || (held && dx > 0.1)) p.facing = "right";
    } else {
      p.moving = held;
      if (p.moving) {
        p.x += dx * p.speed * dt;
        p.y += dy * p.speed * dt;
        if (dx < -0.1) p.facing = "left";
        if (dx > 0.1) p.facing = "right";
      }
    }

    // Recoil decays toward zero (knockback from a bomb pass or a hit).
    if (p.recoilX || p.recoilY) {
      p.x += p.recoilX * dt;
      p.y += p.recoilY * dt;
      var decay = Math.pow(p.recoilDecay, dt);
      p.recoilX *= decay;
      p.recoilY *= decay;
      if (Math.abs(p.recoilX) < 1) p.recoilX = 0;
      if (Math.abs(p.recoilY) < 1) p.recoilY = 0;
    }

    // Guard against any NaN sneaking in, then clamp inside the arena.
    var cx = ESA.clamp(ESA.safe(p.x, p.spawnX), bounds.left, bounds.right);
    var cy = ESA.clamp(ESA.safe(p.y, p.spawnY), bounds.top, bounds.bottom);
    if (p.smooth) {
      // A wall stops only the blocked axis, so sliding along it stays smooth
      // and no stored velocity "sticks" the player to the wall.
      if (cx !== p.x) p.vx = 0;
      if (cy !== p.y) p.vy = 0;
    }
    p.x = cx; p.y = cy;
    p.mvx = dt > 0 ? (p.x - ox) / dt : 0;
    p.mvy = dt > 0 ? (p.y - oy) / dt : 0;

    // Animation clock advances faster while walking.
    p.animTime += dt * (p.moving ? 9.2 : 2.1);

    var targetLean = p.smooth ? ESA.clamp(p.vx / p.speed, -1, 1) * 0.07
                   : (p.moving ? (p.facing === "left" ? -0.07 : 0.07) : 0);
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
    var c = vis(charId);
    // Mirror safety: art with readable text is never flipped. The sprite
    // still stands at (cx, cy) on its own side - only its facing differs.
    var flip = !!o.flip && ESA.canMirror(c || charId, hurt);
    // Evil variants and Guests draw from a pre-rendered, cached canvas
    // (built ONCE per base asset / state - never per frame). Normal
    // characters draw their PNG exactly as before.
    var src = c && ESA.Variants ? ESA.Variants.source(c, hurt) : null;
    var img = src ? src.img : ESA.Assets.get(((c && c.baseId) || charId) + (hurt ? "_hurt" : "_normal"));
    if (!img || !img.width) return;

    // Only the visible part of the file is drawn (transparent padding is
    // skipped), scaled so the NORMAL art stands `height` px tall. Size
    // always comes from the base art, so variants never change it.
    var size = ESA.spriteSize(charId, hurt, o.height);
    var b = size.box;
    var w = size.w, h = size.h;
    var sx = o.scaleX === undefined ? 1 : o.scaleX;
    var sy = o.scaleY === undefined ? 1 : o.scaleY;

    ctx.save();
    if (o.alpha !== undefined) ctx.globalAlpha *= o.alpha;
    ctx.translate(cx, cy - (o.bounce || 0));
    if (o.rotate) ctx.rotate(o.rotate);
    ctx.scale(flip ? -sx : sx, sy);
    if (src) {
      // The cached canvas covers file space from (fx0, fy0) at k canvas px
      // per file px (with room for the Evil aura around the visible box).
      var s = w / b.w;
      ctx.drawImage(img, -w / 2 + (src.fx0 - b.x) * s, -h + (src.fy0 - b.y) * s,
                    img.width / src.k * s, img.height / src.k * s);
    } else {
      ctx.drawImage(img, b.x, b.y, b.w, b.h, -w / 2, -h, w, h);
    }
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
    // Mid-crossfade both states must face the same way: if either one is
    // mirror-unsafe, neither is flipped for the ~110 ms of the fade.
    var flip = o.flip;
    if (flip && !(ESA.canMirror(charId, false) && ESA.canMirror(charId, true))) o.flip = false;
    o.alpha = base * (1 - blend);
    ESA.drawSprite(ctx, charId, false, cx, cy, o);
    o.alpha = base * blend;
    ESA.drawSprite(ctx, charId, true, cx, cy, o);
    o.alpha = base;
    o.flip = flip;
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
    // shadowBlur on a large sprite is one of the most expensive canvas
    // operations on phones; lower quality tiers keep only the contact shadow.
    if (!ESA.Quality || ESA.Quality.fx.shadows) {
      ctx.shadowColor = "rgba(0,0,0,.32)";
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 6;
    }
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
      // Evil variants: "EVIL" in crimson ahead of the base name, on a
      // darker plate - same shape, so the HUD rhythm never changes.
      var evil = !!p.character.evil;
      var label = p.name.toUpperCase();
      var lead = evil && label.indexOf("EVIL ") === 0 ? "EVIL " : "";
      var rest = lead ? label.slice(lead.length) : label;
      ctx.save();
      ctx.font = "700 13px " + ESA.FONT_DISPLAY;
      if (lead) ctx.letterSpacing = "1px";      // measured with spacing: drawn in two parts
      var lw = lead ? ctx.measureText(lead).width : 0;
      var tw = lw + ctx.measureText(rest).width;
      var pw = tw + 22;
      var py = p.y + 9;

      ctx.globalAlpha = 0.92;
      ESA.roundRect(ctx, p.x - pw / 2, py, pw, 21, 10);
      ctx.fillStyle = evil ? "rgba(22,4,14,.92)" : "rgba(7,23,40,.88)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = p.color;
      ctx.stroke();

      ctx.globalAlpha = 1;
      ctx.textBaseline = "middle";
      ctx.letterSpacing = "1px";
      if (lead) {
        var x0 = p.x - tw / 2;
        ctx.textAlign = "left";
        ctx.fillStyle = "#ff4d5e";
        ctx.fillText(lead, x0, py + 11);
        ctx.fillStyle = "#fff6e4";
        ctx.fillText(rest, x0 + lw, py + 11);
      } else {
        ctx.fillStyle = "#fff6e4";
        ctx.textAlign = "center";
        ctx.fillText(label, p.x, py + 11);
      }
      ctx.restore();
    }
  };

})(window.ESA);
