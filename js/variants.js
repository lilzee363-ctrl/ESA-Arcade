/* ==========================================================================
   ESA ARCADE - CHARACTER VARIANT RENDERING (Normal / Evil)
   ONE Evil look, shared by every screen and every game:

     tone    slightly darker, a touch more contrast, a little less colour
     aura    a thin crimson rim + a soft deep-purple haze around the figure
     eyes    red, glowing pupils (per-character anchors in js/characters.js)
     lenses  for glasses: a red glow THROUGH the lens, pupils burning inside

   Built from the SAME base PNGs (zima_normal.png / zima_hurt.png ...) - no
   evil_* files exist. Re-cropping a base sprite later improves both
   variants automatically.

   CANVAS (games)  source(avatar, hurt) returns a canvas rendered ONCE per
                   base asset + state and cached for the page's lifetime
                   (at most 2 per roster character). Nothing is rebuilt
                   per frame; drawing it costs one drawImage, like a PNG.
   DOM (menus)     the same tone via a CSS filter (built from the same
                   numbers below), the aura via drop-shadow on full-body
                   art, and absolutely-positioned eye / lens glows placed
                   from the same anchors. decorate() always removes the old
                   overlay first, so revisiting screens never stacks layers.

   Gameplay never reads anything here: an Evil avatar inherits trim,
   spriteH and every collider input from its Normal registry entry.

   Dev only: open index.html?eyes to draw cyan anchor crosshairs on every
   eye / lens (canvas and DOM). Missing anchors are listed in the console.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var DEBUG_EYES = /[?&]eyes\b/.test(window.location.search);

  /* ------------------------------------------------------------------ *
   * The look. Every renderer reads these numbers.
   * ------------------------------------------------------------------ */
  var LOOK = {
    tone: { brightness: 0.8, contrast: 1.16, saturate: 0.84 },
    // Aura radii as fractions of the sprite's drawn height.
    rim:  { color: "rgba(226, 26, 62, 0.85)", size: 0.007 },
    haze: { color: "rgba(112, 18, 128, 0.55)", size: 0.03 },
    // Pupil glow (radial stops, inner -> outer) and wider bloom.
    iris: [[0, "rgba(255, 238, 228, 1)"], [0.2, "rgba(255, 96, 96, 1)"],
           [0.48, "rgba(226, 18, 42, 0.95)"], [1, "rgba(150, 0, 28, 0)"]],
    bloom: [[0, "rgba(255, 46, 70, 0.5)"], [1, "rgba(255, 0, 40, 0)"]],
    bloomScale: 2.5,
    // Glass lens glow.
    lens: [[0, "rgba(255, 58, 72, 0.5)"], [0.62, "rgba(196, 10, 44, 0.26)"],
           [1, "rgba(150, 0, 30, 0)"]]
  };

  function toneFilter() {
    var t = LOOK.tone;
    return "brightness(" + t.brightness + ") contrast(" + t.contrast + ") saturate(" + t.saturate + ")";
  }

  function cssStops(stops, alphaScale) {
    return stops.map(function (s) {
      var col = alphaScale === undefined ? s[1] : s[1].replace(/,\s*([\d.]+)\)$/, function (_, a) {
        return ", " + (Number(a) * alphaScale).toFixed(3) + ")";
      });
      return col + " " + Math.round(s[0] * 100) + "%";
    }).join(", ");
  }

  /** Pushes the shared look into CSS custom properties (DOM rendering). */
  function installCss() {
    var r = document.documentElement.style;
    r.setProperty("--evil-tone", toneFilter());
    r.setProperty("--evil-rim-color", LOOK.rim.color);
    r.setProperty("--evil-haze-color", LOOK.haze.color);
    r.setProperty("--evil-iris", "radial-gradient(circle closest-side, " + cssStops(LOOK.iris) + ")");
    r.setProperty("--evil-bloom", "radial-gradient(circle closest-side, " + cssStops(LOOK.bloom) + ")");
    r.setProperty("--evil-lens", "radial-gradient(closest-side, " + cssStops(LOOK.lens) + ")");
  }

  /* ------------------------------------------------------------------ *
   * Eye anchors: per-character data, else a conservative eye-line glow.
   * ------------------------------------------------------------------ */
  var warned = Object.create(null);

  function eyeSpec(base, which) {
    var state = which === "hurt" ? "hurt" : "normal";
    var spec = base.evilEyes && base.evilEyes[state];
    if (spec && (spec.eyes.length || spec.lens.length)) return spec;
    if (!warned[base.id + state]) {
      warned[base.id + state] = true;
      console.info("[ESA] Evil " + base.id + " (" + state + ") has no eye anchors - using a soft eye-line glow. " +
                   "Add evil." + state + " to its registry entry (check with ?eyes).");
    }
    // Fallback: one soft, wide lens-style glow across the likely eye line
    // of the normal head crop. Deliberately vague rather than misplaced
    // dots. Hurt art can be posed anywhere, so it keeps tone + aura only.
    var k = ESA.headCrop(base);
    if (!k || state === "hurt") return { r: 0, eyes: [], lens: [] };
    return { r: 0, eyes: [], lens: [[k.x + k.side / 2, k.y + k.side * 0.47, k.side * 0.3, k.side * 0.075]], soft: true };
  }

  /* ================================================================== *
   * CANVAS - cached Evil sprites
   * ================================================================== */
  var cache = Object.create(null);      // "zima|normal" -> { img, k, fx0, fy0 }
  var TARGET_H = 540;                   // cached art height (px): crisp at 2x DPR
  var canvasFilter = (function () {
    try {
      var g = document.createElement("canvas").getContext("2d");
      if (!("filter" in g)) return false;
      g.filter = "brightness(0.5)";
      return g.filter === "brightness(0.5)";
    } catch (e) { return false; }
  })();

  function gradient(g, x, y, r, stops, alpha) {
    var gr = g.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(function (s) {
      gr.addColorStop(s[0], alpha === undefined || alpha === 1 ? s[1]
        : s[1].replace(/,\s*([\d.]+)\)$/, function (_, a) { return ", " + (Number(a) * alpha) + ")"; }));
    });
    return gr;
  }

  /** Paints the eye / lens glows for a spec, mapping file px -> canvas px. */
  function paintEyes(g, spec, map, scale) {
    g.save();
    spec.lens.forEach(function (L) {
      var p = map(L[0], L[1]);
      var rx = L[2] * scale, ry = L[3] * scale;
      g.save();
      g.translate(p.x, p.y);
      g.scale(1, ry / rx);
      g.globalCompositeOperation = "screen";
      g.fillStyle = gradient(g, 0, 0, rx, LOOK.lens, spec.soft ? 0.7 : 1);
      g.beginPath(); g.arc(0, 0, rx, 0, Math.PI * 2); g.fill();
      g.restore();
    });
    spec.eyes.forEach(function (E) {
      var p = map(E[0], E[1]);
      var k = E.length > 2 ? E[2] : 1;
      var r = spec.r * scale * (0.55 + 0.45 * k);
      g.globalCompositeOperation = "screen";
      g.fillStyle = gradient(g, p.x, p.y, r * LOOK.bloomScale, LOOK.bloom, k);
      g.beginPath(); g.arc(p.x, p.y, r * LOOK.bloomScale, 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = "source-over";
      g.fillStyle = gradient(g, p.x, p.y, r, LOOK.iris, 0.35 + 0.65 * k);
      g.beginPath(); g.arc(p.x, p.y, r, 0, Math.PI * 2); g.fill();
    });
    g.restore();
    if (DEBUG_EYES) {
      g.save();
      g.strokeStyle = "#00ffe1";
      g.lineWidth = 2;
      spec.eyes.concat(spec.lens).forEach(function (E) {
        var p = map(E[0], E[1]);
        g.beginPath();
        g.moveTo(p.x - 10, p.y); g.lineTo(p.x + 10, p.y);
        g.moveTo(p.x, p.y - 10); g.lineTo(p.x, p.y + 10);
        g.stroke();
      });
      spec.lens.forEach(function (L) {
        var p = map(L[0], L[1]);
        g.beginPath(); g.ellipse(p.x, p.y, L[2] * scale, L[3] * scale, 0, 0, Math.PI * 2); g.stroke();
      });
      g.restore();
    }
  }

  function buildEvil(base, hurt) {
    var img = ESA.Assets.get(base.id + (hurt ? "_hurt" : "_normal"));
    if (!img || !img.width) return null;
    var t = ESA.spriteBox(base.id, hurt);
    var k = Math.min(1, TARGET_H / t.h);
    var pad = Math.ceil(t.h * (LOOK.haze.size * 2.2));        // file px of aura room
    var fx0 = t.x - pad, fy0 = t.y - pad;
    var cw = Math.ceil((t.w + pad * 2) * k), ch = Math.ceil((t.h + pad * 2) * k);
    var c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    var g = c.getContext("2d");
    g.imageSmoothingQuality = "high";
    var dx = pad * k, dy = pad * k, dw = t.w * k, dh = t.h * k;
    var H = dh;                                               // drawn height for aura sizes

    // 1. Aura: shadows only (the figure itself is drawn off-canvas).
    var OFF = cw + ch + 200;
    [LOOK.haze, LOOK.rim].forEach(function (a) {
      g.save();
      g.shadowColor = a.color;
      g.shadowBlur = Math.max(1.5, H * a.size);
      g.shadowOffsetX = OFF;
      g.drawImage(img, t.x, t.y, t.w, t.h, dx - OFF, dy, dw, dh);
      g.restore();
    });

    // 2. The figure, toned. Same filter string as the DOM where canvas
    //    filters exist; otherwise a composite approximation.
    if (canvasFilter) {
      g.save();
      g.filter = toneFilter();
      g.drawImage(img, t.x, t.y, t.w, t.h, dx, dy, dw, dh);
      g.restore();
    } else {
      var tmp = document.createElement("canvas");
      tmp.width = cw; tmp.height = ch;
      var q = tmp.getContext("2d");
      q.drawImage(img, t.x, t.y, t.w, t.h, dx, dy, dw, dh);
      q.globalCompositeOperation = "multiply";
      q.fillStyle = "rgb(196, 188, 200)";
      q.fillRect(0, 0, cw, ch);
      q.globalCompositeOperation = "destination-in";
      q.drawImage(img, t.x, t.y, t.w, t.h, dx, dy, dw, dh);
      g.drawImage(tmp, 0, 0);
    }

    // 3. Eyes / lenses on top (unfiltered, so the red reads clearly).
    var spec = eyeSpec(base, hurt ? "hurt" : "normal");
    paintEyes(g, spec, function (x, y) { return { x: (x - fx0) * k, y: (y - fy0) * k }; }, k);

    return { img: c, k: k, fx0: fx0, fy0: fy0 };
  }

  /* ================================================================== *
   * DOM - matching overlay markup
   * ================================================================== */
  function pct(v) { return (v * 100).toFixed(2) + "%"; }

  /** Overlay HTML (no user text) for a frame of the given file-space box. */
  function overlayHTML(base, which, box, extraCls) {
    var spec = eyeSpec(base, which === "hurt" ? "hurt" : "normal");
    var html = '<span class="evil-eyes ' + (extraCls || "") + '" aria-hidden="true">';
    spec.lens.forEach(function (L) {
      html += '<i class="ee-lens' + (spec.soft ? " is-soft" : "") + '" style="left:' + pct((L[0] - box.x) / box.w) +
              ";top:" + pct((L[1] - box.y) / box.h) + ";width:" + pct(L[2] * 2 / box.w) +
              ";height:" + pct(L[3] * 2 / box.h) + '"></i>';
    });
    spec.eyes.forEach(function (E) {
      var k = E.length > 2 ? E[2] : 1;
      var d = spec.r * 2 * (0.55 + 0.45 * k);
      html += '<i class="ee-eye" style="left:' + pct((E[0] - box.x) / box.w) + ";top:" + pct((E[1] - box.y) / box.h) +
              ";width:" + pct(d / box.w) + ";--ee-a:" + (0.35 + 0.65 * k).toFixed(2) + '"></i>';
    });
    if (DEBUG_EYES) {
      spec.eyes.concat(spec.lens).forEach(function (E) {
        html += '<i class="ee-debug" style="left:' + pct((E[0] - box.x) / box.w) + ";top:" + pct((E[1] - box.y) / box.h) + '"></i>';
      });
    }
    return html + "</span>";
  }

  function baseOf(c) { return c && c.evil ? ESA.Characters.get(c.baseId) : null; }

  var V = {
    LOOK: LOOK,
    DEBUG_EYES: DEBUG_EYES,

    /**
     * Cached canvas source for drawSprite, or null to draw the plain PNG.
     * Evil: built once per base asset + state. Guests: see js/guests.js.
     */
    source: function (c, hurt) {
      if (c.isGuest) return ESA.Guests ? ESA.Guests.source(c, hurt) : null;
      if (!c.evil) return null;
      var key = c.baseId + (hurt ? "|hurt" : "|normal");
      var hit = cache[key];
      if (hit) return hit;
      var base = baseOf(c);
      var built = base ? buildEvil(base, hurt) : null;
      if (built) cache[key] = built;
      return built;
    },

    /** Builds an avatar's cached art ahead of time (behind the veil). */
    warm: function (c) {
      if (!c) return;
      if (c.isGuest) { if (ESA.Guests) ESA.Guests.warm(c); return; }
      if (!c.evil) return;
      this.source(c, false);
      this.source(c, true);
    },

    /** Overlay markup for full-body art inside an .art-frame. */
    bodyOverlayHTML: function (c, which) {
      var base = baseOf(c);
      if (!base) return "";
      var t = ESA.spriteBox(base.id, which === "hurt");
      return overlayHTML(base, which, t, "is-body");
    },

    /** Overlay markup for a head crop (square, overflow:hidden container). */
    headOverlayHTML: function (c) {
      var base = baseOf(c);
      var k = base && ESA.headCrop(base);
      if (!k) return "";
      return overlayHTML(base, "normal", { x: k.x, y: k.y, w: k.side, h: k.side }, "is-head");
    },

    /**
     * Applies / removes the Evil treatment on an existing element:
     * "head" -> el is the <img>, overlay goes in its container;
     * "body" -> el is the .art-frame. Old overlays are always removed
     * first, so re-rendering can never stack duplicate layers.
     */
    decorate: function (el, c, which, framing) {
      if (!el) return;
      var host = framing === "head" ? el.parentNode : el;
      if (!host) return;
      var old = host.querySelectorAll(":scope > .evil-eyes");
      for (var i = 0; i < old.length; i++) host.removeChild(old[i]);
      var evil = !!(c && c.evil);
      if (framing === "head") el.classList.toggle("is-evil-art", evil);
      else el.classList.toggle("is-evil", evil);
      if (!evil) return;
      var html = framing === "head" ? this.headOverlayHTML(c) : this.bodyOverlayHTML(c, which);
      if (html) host.insertAdjacentHTML("beforeend", html);
    },

    /** Dev helper (console): ESA.Variants.gallery() with ?eyes. */
    gallery: function () {
      var wrap = document.createElement("div");
      wrap.style.cssText = "position:fixed;inset:0;z-index:9999;overflow:auto;background:#0b1320;display:flex;flex-wrap:wrap;gap:10px;padding:10px";
      ESA.Characters.list().forEach(function (base) {
        [false, true].forEach(function (hurt) {
          var src = V.source(ESA.Avatars.get(base.id + "~evil"), hurt);
          if (!src) return;
          var cv = src.img;
          cv.style.cssText = "height:420px;background:#203040";
          cv.title = base.id + (hurt ? " hurt" : " normal");
          wrap.appendChild(cv);
        });
      });
      wrap.addEventListener("click", function () { wrap.remove(); });
      document.body.appendChild(wrap);
    }
  };

  ESA.Variants = V;

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", installCss);
  else installCss();

})(window.ESA);
