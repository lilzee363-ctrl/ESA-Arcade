/* ==========================================================================
   ESA ARCADE - adaptive QUALITY for decoration (V4.1)
   Watches sustained frame timing of the ONE game loop and picks a tier:

     high    everything (default)
     medium  no canvas shadowBlur on sprites, fewer particles, lighter menu
             ambience (no blurred light sweep / dust)
     low     + no puck trail / pickup glow, a third of the particles, a
             lower canvas resolution cap, static menu ambience

   What it may change is DECORATION ONLY. It never touches input polling,
   physics steps, collision, CPU decisions, timers, speeds or the arena's
   logical 960x540 size - a match plays identically on every tier.

   No flapping: frame times are averaged over WINDOW_MS windows. It steps
   DOWN one tier after 2 consecutive slow windows, and back UP only after
   5 consecutive fast windows with at least UP_COOLDOWN_MS since the last
   change. If a tier proves too heavy straight after an upgrade, that tier
   becomes the ceiling for the rest of the session.

   Only gameplay is measured (no extra animation loop runs in menus); the
   tier carries over to the menus through body.q-medium / body.q-low.
   The last tier is remembered for this tab (sessionStorage) as a hint.

   Dev only: index.html?perf shows FPS, frame time, tier and how many
   requestAnimationFrame callbacks run per frame. ?quality=low|medium|high
   pins a tier for testing.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var TIERS = ["low", "medium", "high"];
  var WINDOW_MS = 3000;
  var SLOW_MS = 23;            // avg frame slower than ~43 fps
  var FAST_MS = 18.2;          // avg frame faster than ~55 fps
  var DOWN_AFTER = 2, UP_AFTER = 5;
  var UP_COOLDOWN_MS = 30000;
  var HITCH_MS = 250;          // longer gaps (tab switch, GC pause) are ignored
  var STORE = "esaArcade.quality.v1";

  var FX = {
    high:   { name: "high",   shadows: true,  particles: 1,    trails: true,  glows: true,  dprCap: 2 },
    medium: { name: "medium", shadows: false, particles: 0.65, trails: true,  glows: true,  dprCap: 2 },
    low:    { name: "low",    shadows: false, particles: 0.35, trails: false, glows: false, dprCap: 1.25 }
  };

  var search = window.location.search;
  var pinned = (/[?&]quality=(low|medium|high)\b/.exec(search) || [])[1] || null;
  var PERF = /[?&]perf\b/.test(search);

  var Q = {
    tier: "high",
    fx: FX.high,
    ceiling: 2,                 // index into TIERS
    _sum: 0, _n: 0, _start: 0, _slow: 0, _fast: 0, _changedAt: 0, _upgradedAt: -1e9,
    listeners: [],

    init: function () {
      var t = pinned;
      if (!t) { try { t = window.sessionStorage.getItem(STORE); } catch (e) { t = null; } }
      this.set(TIERS.indexOf(t) >= 0 ? t : "high", true);
      if (PERF) Perf.install();
    },

    /** Called by systems that want to react (e.g. the stage's DPR cap). */
    onChange: function (fn) { this.listeners.push(fn); },

    set: function (tier, silent) {
      if (TIERS.indexOf(tier) < 0 || (tier === this.tier && !silent)) return;
      this.tier = tier;
      this.fx = FX[tier];
      var b = document.body;
      if (b) {
        b.classList.toggle("q-medium", tier === "medium");
        b.classList.toggle("q-low", tier === "low");
      }
      this._changedAt = performance.now();
      this._slow = this._fast = 0;
      if (!pinned) { try { window.sessionStorage.setItem(STORE, tier); } catch (e) { /* ignore */ } }
      for (var i = 0; i < this.listeners.length; i++) { try { this.listeners[i](tier); } catch (e) { /* ignore */ } }
    },

    /** Particle counts scale with the tier (at least one survives). */
    count: function (n) { return n <= 1 ? n : Math.max(1, Math.round(n * this.fx.particles)); },

    /** The game loop reports every simulated frame's real duration. */
    frame: function (ms) {
      if (pinned || !(ms > 0) || ms > HITCH_MS || document.hidden) return;
      var now = performance.now();
      if (!this._n) this._start = now;
      this._sum += ms; this._n++;
      if (now - this._start < WINDOW_MS) return;
      var avg = this._sum / this._n;
      this._sum = 0; this._n = 0;
      this._judge(avg, now);
    },

    /** Gameplay stopped (exit / pause): drop the partial window. */
    idle: function () { this._sum = 0; this._n = 0; },

    _judge: function (avg, now) {
      var i = TIERS.indexOf(this.tier);
      if (avg > SLOW_MS) {
        this._fast = 0;
        if (++this._slow >= DOWN_AFTER && i > 0) {
          // Too heavy straight after an upgrade: this tier is the new ceiling.
          if (now - this._upgradedAt < 20000) this.ceiling = i - 1;
          this.set(TIERS[i - 1]);
        }
      } else if (avg < FAST_MS) {
        this._slow = 0;
        if (++this._fast >= UP_AFTER && i < this.ceiling && now - this._changedAt > UP_COOLDOWN_MS) {
          this._upgradedAt = now;
          this.set(TIERS[i + 1]);
        }
      } else {
        this._slow = this._fast = 0;
      }
    }
  };
  ESA.Quality = Q;

  /* ------------------------------------------------------------------ *
   * ?perf overlay (developer only, hidden from normal users)
   * ------------------------------------------------------------------ */
  var Perf = {
    el: null, frames: 0, ms: 0, raf: 0, last: 0, rafCalls: 0, rafFrames: 0,

    install: function () {
      var self = this;
      // Count requestAnimationFrame callbacks per frame (duplicate loops show up as > 1).
      var orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function (cb) { self.rafCalls++; return orig(cb); };
      this.el = document.createElement("div");
      this.el.style.cssText = "position:fixed;right:6px;bottom:6px;z-index:9999;padding:4px 8px;border-radius:6px;" +
        "background:rgba(0,0,0,.72);color:#9fe3ff;font:11px/1.35 monospace;pointer-events:none;white-space:pre";
      document.body.appendChild(this.el);
      // The overlay's own ticker (dev only) measures menus and games alike.
      var prev = performance.now();
      var tick = function (t) {
        self.rafFrames++;
        self.frames++;
        self.ms += t - prev;
        prev = t;
        orig(tick);
      };
      orig(tick);
      setInterval(function () { self.report(); }, 500);
    },

    report: function () {
      if (!this.el) return;
      var fps = this.frames * 2;
      var avg = this.frames ? this.ms / this.frames : 0;
      // Our own ticker is one callback per frame; anything beyond it is the app.
      var loops = this.rafFrames ? Math.max(0, this.rafCalls / this.rafFrames) : 0;
      this.el.textContent = "FPS " + fps + "  " + avg.toFixed(1) + " ms\nquality " + Q.tier +
        (pinned ? " (pinned)" : "") + "\nRAF loops " + loops.toFixed(1) +
        "\nstate " + ((ESA.App && ESA.App.state) || "-");
      this.frames = 0; this.ms = 0; this.rafCalls = 0; this.rafFrames = 0;
    }
  };

})(window.ESA);
