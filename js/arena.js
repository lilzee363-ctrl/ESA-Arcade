/* ==========================================================================
   ESA ARCADE - stage and UI
   ESA.Stage : the canvas renderer (device-pixel scaling, screen shake,
               flashes, hit-stop) plus the shared arena artwork.
   ESA.UI    : the DOM presentation layer (HUD, countdown, banners, result).

   Arena backgrounds are fully static, so each one is rendered once into an
   offscreen canvas and blitted per frame. That keeps the per-frame cost to a
   single drawImage no matter how detailed the floor gets.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var W = ESA.W, H = ESA.H;

  /** Rounded rect with a fallback for browsers without ctx.roundRect. */
  ESA.roundRect = function (ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, r);
      return;
    }
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  };

  /** The walkable rectangle, in logical arena coordinates (feet anchor). */
  ESA.BOUNDS = { left: 62, right: W - 62, top: 178, bottom: H - 32 };

  /* ================================================================== *
   * Stage
   * ================================================================== */
  var Stage = {
    canvas: null,
    ctx: null,
    scale: 1,

    shakeAmount: 0,
    flashAlpha: 0,
    flashColor: "#ffffff",
    frozenUntil: 0,

    _layers: Object.create(null),

    init: function (canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.resize();
    },

    /** Matches the backing store to the CSS size, capped for performance. */
    resize: function () {
      if (!this.canvas) return;
      var dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (dpr === this.scale && this.canvas.width === Math.round(W * dpr)) return;
      this.scale = dpr;
      this.canvas.width = Math.round(W * dpr);
      this.canvas.height = Math.round(H * dpr);
      this._layers = Object.create(null);   // cached layers were built at the old scale
    },

    /* --- Screen effects --------------------------------------------- */
    shake: function (amount) {
      this.shakeAmount = Math.min(26, Math.max(this.shakeAmount, amount));
    },
    flash: function (alpha, color) {
      this.flashAlpha = Math.max(this.flashAlpha, alpha);
      this.flashColor = color || "#ffffff";
    },
    /** Brief freeze on impact. The main loop skips updates while frozen. */
    hitStop: function (ms) {
      this.frozenUntil = performance.now() + ms;
    },
    isFrozen: function (now) { return now < this.frozenUntil; },

    updateFX: function (dt) {
      this.shakeAmount *= Math.pow(0.0025, dt);
      if (this.shakeAmount < 0.3) this.shakeAmount = 0;
      this.flashAlpha -= dt * 3.4;
      if (this.flashAlpha < 0) this.flashAlpha = 0;
    },

    resetFX: function () {
      this.shakeAmount = 0;
      this.flashAlpha = 0;
      this.frozenUntil = 0;
    },

    /** Start a frame: reset transform, apply DPR and shake, clear. */
    begin: function () {
      var ctx = this.ctx;
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (this.shakeAmount > 0.3) {
        ctx.translate(
          (Math.random() - 0.5) * this.shakeAmount,
          (Math.random() - 0.5) * this.shakeAmount
        );
      }
      return ctx;
    },

    /** Finish a frame: draw the impact flash over everything. */
    end: function () {
      if (this.flashAlpha <= 0) return;
      var ctx = this.ctx;
      ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      ctx.globalAlpha = Math.min(1, this.flashAlpha);
      ctx.fillStyle = this.flashColor;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    },

    /**
     * Render-once offscreen layer, cached by key and rebuilt if the device
     * scale changes. `render(ctx)` draws in logical 960x540 coordinates.
     */
    layer: function (key, render) {
      var cached = this._layers[key];
      if (cached) return cached;

      var c = document.createElement("canvas");
      c.width = Math.round(W * this.scale);
      c.height = Math.round(H * this.scale);
      var g = c.getContext("2d");
      g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
      render(g);
      this._layers[key] = c;
      return c;
    },

    /** Drop cached layers whose key starts with `prefix`, except `keep`. */
    evictLayers: function (prefix, keep) {
      for (var k in this._layers) {
        if (k !== keep && k.indexOf(prefix) === 0) delete this._layers[k];
      }
    },

    /** Blit a cached layer at logical size. */
    blit: function (ctx, layerCanvas) {
      ctx.drawImage(layerCanvas, 0, 0, W, H);
    }
  };
  ESA.Stage = Stage;

  /* ================================================================== *
   * Arena artwork
   * ================================================================== */

  /** Small Egyptian stepped motif, repeated along a border run. */
  function motifRun(g, x, y, count, step, color, alpha) {
    g.save();
    g.globalAlpha = alpha;
    g.fillStyle = color;
    for (var i = 0; i < count; i++) {
      var px = x + i * step;
      g.fillRect(px, y, step * 0.42, 3);
      g.fillRect(px + step * 0.52, y - 3, 3, 6);
      g.fillRect(px + step * 0.52, y + 3, step * 0.3, 3);
    }
    g.restore();
  }

  /**
   * The shared arena floor. `opts.tone` picks the stone palette and
   * `opts.accent` tints the court lines for each game.
   */
  ESA.drawArenaLayer = function (g, opts) {
    opts = opts || {};
    var warm = opts.tone !== "cool";
    var top = warm ? "#ddc99e" : "#d4d0c0";
    var bottom = warm ? "#a98a56" : "#a09e8b";
    var line = warm ? "rgba(76,50,16,.2)" : "rgba(48,54,62,.2)";
    var accent = opts.accent || ESA.COLORS.goldDeep;

    /* --- Stone floor ------------------------------------------------ */
    var grad = g.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, top);
    grad.addColorStop(1, bottom);
    g.fillStyle = grad;
    g.fillRect(0, 0, W, H);

    /* --- Large sandstone slabs -------------------------------------- */
    var tile = 96;
    g.strokeStyle = line;
    g.lineWidth = 2;
    g.beginPath();
    for (var x = tile; x < W; x += tile) { g.moveTo(x, 0); g.lineTo(x, H); }
    for (var y = tile; y < H; y += tile) { g.moveTo(0, y); g.lineTo(W, y); }
    g.stroke();

    // Alternating slab shading gives the floor depth without noise.
    g.save();
    g.globalAlpha = 0.05;
    g.fillStyle = warm ? "#6b4a1c" : "#3c444c";
    for (var ty = 0; ty < H; ty += tile) {
      for (var tx = 0; tx < W; tx += tile) {
        if (((tx / tile) + (ty / tile)) % 2 === 0) g.fillRect(tx, ty, tile, tile);
      }
    }
    g.restore();

    /* --- Emblem watermark ------------------------------------------- */
    var emblem = ESA.Assets.get("emblem");
    if (emblem && emblem.width) {
      g.save();
      g.globalAlpha = 0.055;
      var s = 300;
      g.drawImage(emblem, W / 2 - s / 2, H / 2 - s / 2 + 14, s, s);
      g.restore();
    }

    /* --- Court markings --------------------------------------------- */
    var b = ESA.BOUNDS;
    var cx = b.left - 20, cy = b.top - 34;
    var cw = (b.right - b.left) + 40, ch = (b.bottom - b.top) + 56;

    g.save();
    g.globalAlpha = 0.42;
    g.strokeStyle = accent;
    g.lineWidth = 3;
    ESA.roundRect(g, cx, cy, cw, ch, 26);
    g.stroke();
    g.globalAlpha = 0.2;
    g.lineWidth = 1.5;
    ESA.roundRect(g, cx + 9, cy + 9, cw - 18, ch - 18, 19);
    g.stroke();
    g.restore();

    /* --- Gold inlay frame ------------------------------------------- */
    g.save();
    // Dark seat behind the inlay so the gold reads crisply on sandstone.
    g.strokeStyle = "rgba(40,24,4,.42)";
    g.lineWidth = 8;
    ESA.roundRect(g, 16, 16, W - 32, H - 32, 20);
    g.stroke();
    g.strokeStyle = ESA.COLORS.gold;
    g.globalAlpha = 0.85;
    g.lineWidth = 4;
    ESA.roundRect(g, 16, 16, W - 32, H - 32, 20);
    g.stroke();
    g.globalAlpha = 0.4;
    g.lineWidth = 1.5;
    ESA.roundRect(g, 25, 25, W - 50, H - 50, 14);
    g.stroke();
    g.restore();

    // Corner notches, a restrained nod to Egyptian cornerstones.
    g.save();
    g.globalAlpha = 0.55;
    g.fillStyle = ESA.COLORS.gold;
    var corners = [[16, 16, 1, 1], [W - 16, 16, -1, 1], [16, H - 16, 1, -1], [W - 16, H - 16, -1, -1]];
    corners.forEach(function (c) {
      g.fillRect(c[0], c[1] - (c[3] > 0 ? 0 : 3), 34 * c[2], 3);
      g.fillRect(c[0] - (c[2] > 0 ? 0 : 3), c[1], 3, 34 * c[3]);
    });
    g.restore();

    /* --- Motif strips ----------------------------------------------- */
    motifRun(g, 54, 42, 18, 48, ESA.COLORS.goldDeep, 0.26);
    motifRun(g, 54, H - 42, 18, 48, ESA.COLORS.goldDeep, 0.26);

    /* --- Vignette ---------------------------------------------------- */
    var vig = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.82);
    vig.addColorStop(0, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(28,16,2,.34)");
    g.fillStyle = vig;
    g.fillRect(0, 0, W, H);
  };

  /* ================================================================== *
   * UI - DOM presentation
   * ================================================================== */
  var UI = {
    _countGen: 0,
    _bannerGen: 0,
    _scores: { p1: null, p2: null },
    _wins: { p1: 0, p2: 0 },

    el: {},

    init: function () {
      var id = ESA.byId;
      this.el = {
        countdown: id("countdownLayer"),
        banner: id("bannerLayer"),
        label: id("hudLabel"),
        value: id("hudValue"),
        center: id("hudCenter"),
        hud: { p1: id("hudP1"), p2: id("hudP2") },
        face: { p1: id("faceP1"), p2: id("faceP2") },
        name: { p1: id("nameP1"), p2: id("nameP2") },
        score: { p1: id("scoreP1"), p2: id("scoreP2") },
        pips: { p1: id("pipsP1"), p2: id("pipsP2") },
        keys: { p1: id("keysP1"), p2: id("keysP2") },
        result: id("resultOverlay"),
        resultActions: id("resultActions"),
        resultTitle: id("resultTitle"),
        resultKicker: id("resultKicker"),
        resultText: id("resultText"),
        resultExtra: id("resultExtra"),
        resultPortrait: id("resultPortrait"),
        resultPortraitImg: id("resultPortraitImg"),
        resultScore: { p1: id("resultScoreP1"), p2: id("resultScoreP2") },
        playTitle: id("playTitle"),
        playMode: id("playMode")
      };
    },

    /* --- HUD ------------------------------------------------------- */

    /**
     * Configure the HUD for a game. `pips` > 0 shows round markers.
     * cfg.players = ESA.describeMatchup(setup); cfg.scheme = control scheme.
     */
    configure: function (cfg) {
      var self = this;
      this.el.playTitle.textContent = cfg.title;
      this.el.playMode.textContent = cfg.mode || "";
      this.el.label.textContent = cfg.centerLabel || "";
      this.el.value.textContent = cfg.centerValue || "—";
      this.el.center.classList.remove("is-urgent");
      this._players = cfg.players;
      // Score Attack (one player): the right-hand panel shows the session
      // best instead of a rival.
      var single = !!cfg.single;
      this.el.hud.p2.classList.toggle("is-best", single);
      this.el.hud.p1.parentNode.classList.toggle("is-single", single);
      // Solo: the key lines carry YOU / CPU · HARD, shown on touch too.
      this.el.hud.p1.parentNode.classList.toggle("is-solo", !!cfg.keys);

      ESA.SLOTS.forEach(function (slot) {
        if (slot === "p2" && single) {
          var h = self.el.hud.p2;
          h.style.setProperty("--pc", "var(--gold-400)");
          self.el.face.p2.removeAttribute("src");
          self.el.name.p2.textContent = "Session Best";
          self.el.keys.p2.textContent = cfg.bestLabel || "";
          self._scores.p2 = null;
          self.setScore("p2", cfg.best === null || cfg.best === undefined ? "—" : cfg.best);
          self._buildPips("p2", 0);
          return;
        }
        var who = cfg.players[slot];
        self.el.hud[slot].style.setProperty("--pc", who.color);
        ESA.setArt(self.el.face[slot], who.character, "normal", "head");
        self.el.name[slot].textContent = who.name;
        self.el.keys[slot].textContent = (cfg.keys && cfg.keys[slot]) ||
          (ESA.CONTROLS[slot].short + " · " + ESA.controlsFor(slot, cfg.scheme).text);
        self._scores[slot] = null;
        self.setScore(slot, 0);
        self._buildPips(slot, cfg.pips || 0);
      });
    },

    _buildPips: function (side, count) {
      var host = this.el.pips[side];
      host.innerHTML = "";
      this._wins[side] = 0;
      for (var i = 0; i < count; i++) {
        var d = document.createElement("span");
        d.className = "pip";
        host.appendChild(d);
      }
    },

    /** Animates the number whenever it actually changes. */
    setScore: function (side, value) {
      var el = this.el.score[side];
      var prev = this._scores[side];
      if (prev === value) return;

      el.textContent = value;
      this._scores[side] = value;
      if (prev === null) return;

      var cls = value > prev ? "bump" : "bump-down";
      el.classList.remove("bump", "bump-down");
      void el.offsetWidth;            // restart the animation
      el.classList.add(cls);
    },

    setWins: function (side, wins) {
      var host = this.el.pips[side];
      var pips = host.children;
      for (var i = 0; i < pips.length; i++) {
        var on = i < wins;
        var wasOn = pips[i].classList.contains("on");
        pips[i].classList.toggle("on", on);
        if (on && !wasOn) {
          pips[i].classList.remove("just-on");
          void pips[i].offsetWidth;
          pips[i].classList.add("just-on");
        }
      }
      this._wins[side] = wins;
    },

    setCenter: function (label, value, urgent) {
      if (label !== undefined && label !== null) this.el.label.textContent = label;
      if (value !== undefined && value !== null) {
        if (this.el.value.textContent !== String(value)) {
          this.el.value.textContent = value;
        }
      }
      this.el.center.classList.toggle("is-urgent", !!urgent);
    },

    /* --- Countdown -------------------------------------------------- */

    /**
     * 3 - 2 - 1 - GO!. `onGo` fires the instant GO appears, which is when
     * controls unlock. A generation token means a restart mid-countdown
     * cancels the old sequence instead of stacking a second one.
     */
    countdown: function (timers, onGo) {
      var self = this;
      var gen = ++this._countGen;
      var layer = this.el.countdown;
      layer.innerHTML = "";

      var steps = ["3", "2", "1", "GO!"];
      var i = 0;

      function beat() {
        if (gen !== self._countGen) return;
        layer.innerHTML = "";

        var isGo = (i === steps.length - 1);

        var ring = document.createElement("div");
        ring.className = "countdown-ring";
        var num = document.createElement("div");
        num.className = "countdown-num" + (isGo ? " is-go" : "");
        num.textContent = steps[i];
        layer.appendChild(ring);
        layer.appendChild(num);

        ESA.Audio.play(isGo ? "go" : "countdown");

        if (isGo) {
          if (typeof onGo === "function") onGo();
          timers.after(640, function () {
            if (gen === self._countGen) layer.innerHTML = "";
          });
        } else {
          i++;
          timers.after(740, beat);
        }
      }

      beat();
    },

    cancelCountdown: function () {
      this._countGen++;
      if (this.el.countdown) this.el.countdown.innerHTML = "";
    },

    /* --- Banner ----------------------------------------------------- */

    banner: function (timers, kicker, main, holdMs, onDone) {
      var self = this;
      var gen = ++this._bannerGen;
      var layer = this.el.banner;
      layer.innerHTML = "";

      var box = document.createElement("div");
      box.className = "banner";
      var k = document.createElement("span");
      k.className = "b-kicker";
      k.textContent = kicker;
      var m = document.createElement("span");
      m.className = "b-main";
      m.textContent = main;
      box.appendChild(k);
      box.appendChild(m);
      layer.appendChild(box);

      timers.after(holdMs, function () {
        if (gen !== self._bannerGen) return;
        box.classList.add("is-out");
        timers.after(300, function () {
          if (gen !== self._bannerGen) return;
          layer.innerHTML = "";
          if (typeof onDone === "function") onDone();
        });
      });
    },

    cancelBanner: function () {
      this._bannerGen++;
      if (this.el.banner) this.el.banner.innerHTML = "";
    },

    /* --- Result ----------------------------------------------------- */

    /**
     * @param {object} r        { winner: "p1"|"p2"|null, kicker, title, text, scores,
     *                            extra?: DOM node shown under the text (Solo record),
     *                            outcome?: "win" | "loss" | "draw" (styling hook) }
     * @param {Array}  actions  [{ label, kind: "gold"|"ghost"|"small", onClick }]
     *                          The first action is the Enter default.
     */
    showResult: function (r, actions) {
      var e = this.el;
      var players = this._players;
      e.resultKicker.textContent = r.kicker || "Match Over";
      e.resultTitle.textContent = r.title;
      e.resultText.textContent = r.text || "";
      if (e.resultExtra) {
        e.resultExtra.innerHTML = "";
        if (r.extra) e.resultExtra.appendChild(r.extra);
        e.resultExtra.classList.toggle("hidden", !r.extra);
      }
      var card = e.result.firstElementChild;
      if (card) {
        card.classList.remove("is-win", "is-loss", "is-draw-out", "is-solo", "is-run");
        if (r.outcome === "run") card.classList.add("is-solo", "is-run");     // Score Attack: no versus score line
        else if (r.outcome) card.classList.add("is-solo", r.outcome === "draw" ? "is-draw-out" : "is-" + r.outcome);
      }
      ESA.SLOTS.forEach(function (slot) {
        e.resultScore[slot].textContent = r.scores ? r.scores[slot] : 0;
        if (players) e.resultScore[slot].style.color = players[slot].color;
      });

      if (r.winner && players) {
        var champ = players[r.winner].character;
        e.resultPortrait.classList.remove("is-draw");
        ESA.setArt(e.resultPortraitImg, champ, "normal", "head");
      } else {
        e.resultPortrait.classList.add("is-draw");
        e.resultPortraitImg.src = "assets/Branding/Golden Canadian Pharaoh Emblem.png";
        e.resultPortraitImg.setAttribute("style", "width:100%;height:100%;object-fit:contain");
      }

      e.resultActions.innerHTML = "";
      (actions || []).forEach(function (a, i) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "btn " + (a.kind === "gold" ? "btn-gold" : "btn-ghost") +
                      (a.kind === "small" ? " btn-small" : "") + (i === 0 ? " is-default" : "");
        b.innerHTML = a.label + (i === 0 ? ' <span class="kbd-hint">Enter</span>' : "");
        b.addEventListener("click", a.onClick);
        e.resultActions.appendChild(b);
      });

      e.result.classList.remove("hidden");
      // Restart the entrance animation on a rematch -> result cycle.
      if (card) { card.style.animation = "none"; void card.offsetWidth; card.style.animation = ""; }
    },

    hideResult: function () {
      this.el.result.classList.add("hidden");
      if (this.el.resultActions) this.el.resultActions.innerHTML = "";
      if (this.el.resultExtra) { this.el.resultExtra.innerHTML = ""; this.el.resultExtra.classList.add("hidden"); }
    },

    /** Activates the default (first) result action - Enter on the result card. */
    triggerDefaultResult: function () {
      var b = this.el.resultActions && this.el.resultActions.firstElementChild;
      if (b) b.click();
    },

    isResultVisible: function () {
      return !this.el.result.classList.contains("hidden");
    },

    /** Wipe every transient UI element. Called on every teardown. */
    clearAll: function () {
      this.cancelCountdown();
      this.cancelBanner();
      this.hideResult();
      this.el.center.classList.remove("is-urgent");
    }
  };
  ESA.UI = UI;

})(window.ESA);
