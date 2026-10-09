/* ==========================================================================
   ESA ARCADE - core runtime
   Utilities, timer ownership, input, audio hooks, asset loading, screen
   transitions and the particle pool. Everything here is shared by all games.

   Loaded as a plain script (no modules) so index.html still works from file://
   ========================================================================== */

window.ESA = window.ESA || {};

(function (ESA) {
  "use strict";

  /* ------------------------------------------------------------------ *
   * Maths helpers
   * ------------------------------------------------------------------ */
  ESA.clamp = function (v, min, max) { return v < min ? min : v > max ? max : v; };
  ESA.lerp = function (a, b, t) { return a + (b - a) * t; };
  ESA.rand = function (min, max) { return min + Math.random() * (max - min); };
  ESA.randInt = function (min, max) { return Math.floor(min + Math.random() * (max - min + 1)); };
  ESA.pick = function (arr) { return arr[Math.floor(Math.random() * arr.length)]; };
  ESA.chance = function (p) { return Math.random() < p; };
  ESA.dist = function (ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); };
  ESA.easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
  ESA.easeIn = function (t) { return t * t * t; };
  ESA.easeOutBack = function (t) {
    var c = 1.70158, c3 = c + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  };

  /**
   * ShuffleBag - fair, anti-streak random picks (V4.1).
   * Every item appears `copies` times per bag, the bag is shuffled, and a
   * refill never starts with the item that just ended the previous bag. So
   * the same pick can never come up twice in a row while alternatives
   * exist, and every item is represented evenly over time.
   *   var bag = new ESA.ShuffleBag(["a", "b", "c"]);  bag.next();
   */
  function ShuffleBag(items, copies) {
    this.items = (items || []).slice();
    this.copies = Math.max(1, copies || 1);
    this.bag = [];
    this.last = null;
  }
  ShuffleBag.prototype.next = function () {
    if (!this.items.length) return null;
    if (!this.bag.length) this._refill();
    this.last = this.bag.pop();
    return this.last;
  };
  ShuffleBag.prototype._refill = function () {
    var b = [];
    for (var c = 0; c < this.copies; c++) b.push.apply(b, this.items);
    for (var i = b.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = b[i]; b[i] = b[j]; b[j] = t;
    }
    // next() pops from the END: never open a bag with the previous pick,
    // and never put two equal picks next to each other inside it.
    for (var k = b.length - 1; k > 0; k--) {
      var clash = b[k] === (k === b.length - 1 ? this.last : b[k + 1]);
      if (!clash) continue;
      for (var m = k - 1; m >= 0; m--) {
        if (b[m] !== b[k] && (m === 0 || b[m - 1] !== b[k]) && b[m] !== (k === b.length - 1 ? this.last : b[k + 1])) {
          var s = b[k]; b[k] = b[m]; b[m] = s; break;
        }
      }
    }
    this.bag = b;
  };
  ShuffleBag.prototype.reset = function () { this.bag.length = 0; this.last = null; };
  ESA.ShuffleBag = ShuffleBag;

  /** Guards against NaN / Infinity leaking into positions. */
  ESA.safe = function (v, fallback) {
    return (typeof v === "number" && isFinite(v)) ? v : fallback;
  };

  ESA.$ = function (sel) { return document.querySelector(sel); };
  ESA.byId = function (id) { return document.getElementById(id); };

  /* ------------------------------------------------------------------ *
   * TimerGroup
   * Every setTimeout/setInterval in the project belongs to a group so it
   * can be cancelled wholesale. This is what keeps rapid
   * play -> back -> play -> rematch cycles from stacking timers.
   *
   * Timeouts can also be paused and resumed (the in-game pause menu), so
   * a countdown or round banner never advances behind the pause overlay.
   * ------------------------------------------------------------------ */
  function TimerGroup() {
    this._timeouts = [];      // { id, fn, due, remaining }
    this._intervals = [];
    this._paused = false;
  }
  TimerGroup.prototype._schedule = function (entry, ms) {
    var self = this;
    entry.due = performance.now() + ms;
    entry.id = setTimeout(function () {
      var i = self._timeouts.indexOf(entry);
      if (i >= 0) self._timeouts.splice(i, 1);
      entry.fn();
    }, ms);
  };
  TimerGroup.prototype.after = function (ms, fn) {
    var entry = { id: 0, fn: fn, due: 0, remaining: ms };
    this._timeouts.push(entry);
    if (!this._paused) this._schedule(entry, ms);
    return entry;
  };
  TimerGroup.prototype.every = function (ms, fn) {
    var id = setInterval(fn, ms);
    this._intervals.push(id);
    return id;
  };
  /** Freeze every pending timeout, remembering how long each had left. */
  TimerGroup.prototype.pause = function () {
    if (this._paused) return;
    this._paused = true;
    var now = performance.now();
    for (var i = 0; i < this._timeouts.length; i++) {
      var e = this._timeouts[i];
      clearTimeout(e.id);
      e.remaining = Math.max(0, e.due - now);
    }
  };
  TimerGroup.prototype.resume = function () {
    if (!this._paused) return;
    this._paused = false;
    var pending = this._timeouts.slice();
    for (var i = 0; i < pending.length; i++) this._schedule(pending[i], pending[i].remaining);
  };
  TimerGroup.prototype.clear = function () {
    for (var i = 0; i < this._timeouts.length; i++) clearTimeout(this._timeouts[i].id);
    for (var j = 0; j < this._intervals.length; j++) clearInterval(this._intervals[j]);
    this._timeouts.length = 0;
    this._intervals.length = 0;
    this._paused = false;
  };
  ESA.TimerGroup = TimerGroup;

  /* ------------------------------------------------------------------ *
   * Audio
   * Synthesised through WebAudio so the project ships with zero audio
   * files and zero licensing questions. Every game calls named hooks
   * (ESA.Audio.play("tokenPickup")), so dropping in real samples later is
   * a one-line change per sound -- see Audio.register().
   *
   * Audio is never required: every path is wrapped and failures are mute.
   * ------------------------------------------------------------------ */
  var Audio_ = {
    enabled: true,
    _ctx: null,
    _files: Object.create(null),   // name -> HTMLAudioElement template
    _ready: false,

    /** Register a real audio file for a hook name (future use). */
    register: function (name, url) {
      try {
        var a = new window.Audio(url);
        a.preload = "auto";
        this._files[name] = a;
      } catch (e) { /* ignore */ }
    },

    /** Must be called from a user gesture before the first sound. */
    unlock: function () {
      try {
        if (!this._ctx) {
          var AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this._ctx = new AC();
        }
        if (this._ctx.state === "suspended") this._ctx.resume();
        this._ready = true;
      } catch (e) { this._ctx = null; }
    },

    setEnabled: function (on) {
      this.enabled = !!on;
      try { localStorage.setItem("esa.sound", on ? "1" : "0"); } catch (e) { /* ignore */ }
    },

    loadPreference: function () {
      try {
        var v = localStorage.getItem("esa.sound");
        if (v !== null) this.enabled = v === "1";
      } catch (e) { /* ignore */ }
      return this.enabled;
    },

    /** Low-level synth voice. */
    tone: function (opt) {
      if (!this.enabled) return;
      try {
        this.unlock();
        if (!this._ctx) return;
        var ctx = this._ctx;
        var t0 = ctx.currentTime + (opt.delay || 0);
        var dur = opt.dur || 0.09;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = opt.type || "square";
        osc.frequency.setValueAtTime(opt.freq, t0);
        if (opt.to) {
          osc.frequency.exponentialRampToValueAtTime(Math.max(24, opt.to), t0 + dur);
        }
        var vol = (opt.gain === undefined ? 0.05 : opt.gain);
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + dur + 0.02);
      } catch (e) { /* audio is optional */ }
    },

    /** Filtered noise burst - used for explosions and impacts. */
    noise: function (opt) {
      if (!this.enabled) return;
      try {
        this.unlock();
        if (!this._ctx) return;
        var ctx = this._ctx;
        var dur = opt.dur || 0.3;
        var rate = ctx.sampleRate;
        var len = Math.max(1, Math.floor(rate * dur));
        var buf = ctx.createBuffer(1, len, rate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, opt.decay || 2);
        }
        var src = ctx.createBufferSource();
        src.buffer = buf;
        var filter = ctx.createBiquadFilter();
        filter.type = opt.filter || "lowpass";
        filter.frequency.setValueAtTime(opt.freq || 900, ctx.currentTime);
        if (opt.freqTo) {
          filter.frequency.exponentialRampToValueAtTime(
            Math.max(40, opt.freqTo), ctx.currentTime + dur);
        }
        var gain = ctx.createGain();
        gain.gain.setValueAtTime(opt.gain === undefined ? 0.16 : opt.gain, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
        src.connect(filter).connect(gain).connect(ctx.destination);
        src.start();
      } catch (e) { /* audio is optional */ }
    },

    /** Named hooks. Add a file with register() to override any of these. */
    play: function (name) {
      if (!this.enabled) return;
      var f = this._files[name];
      if (f) {
        try { var n = f.cloneNode(); n.volume = 0.7; n.play(); return; } catch (e) { /* fall through */ }
      }
      var A = this;
      switch (name) {
        case "uiHover":     A.tone({ freq: 440, dur: .04, type: "sine", gain: .018 }); break;
        case "uiClick":     A.tone({ freq: 620, to: 820, dur: .07, type: "square", gain: .035 }); break;
        case "uiBack":      A.tone({ freq: 420, to: 280, dur: .09, type: "square", gain: .032 }); break;
        case "start":
          A.tone({ freq: 523, dur: .09, type: "square", gain: .045 });
          A.tone({ freq: 784, dur: .12, type: "square", gain: .045, delay: .085 });
          A.tone({ freq: 1046, dur: .2, type: "square", gain: .04, delay: .18 });
          break;
        case "countdown":   A.tone({ freq: 560, dur: .1, type: "square", gain: .05 }); break;
        case "go":
          A.tone({ freq: 740, dur: .1, type: "square", gain: .06 });
          A.tone({ freq: 1108, dur: .22, type: "square", gain: .055, delay: .09 });
          break;
        case "tokenPickup": A.tone({ freq: 880, to: 1320, dur: .08, type: "sine", gain: .05 }); break;
        case "tokenBonus":
          A.tone({ freq: 880, dur: .07, type: "sine", gain: .05 });
          A.tone({ freq: 1174, dur: .07, type: "sine", gain: .05, delay: .06 });
          A.tone({ freq: 1568, dur: .18, type: "sine", gain: .05, delay: .12 });
          break;
        case "bombPass":    A.tone({ freq: 300, to: 520, dur: .09, type: "triangle", gain: .05 }); break;
        case "bombTick":    A.tone({ freq: 1500, dur: .028, type: "square", gain: .028 }); break;
        case "bombTickHot": A.tone({ freq: 1900, dur: .03, type: "square", gain: .04 }); break;
        case "explosion":
          A.noise({ dur: .55, freq: 1400, freqTo: 90, gain: .22, decay: 1.6 });
          A.tone({ freq: 140, to: 40, dur: .45, type: "sawtooth", gain: .09 });
          break;
        case "bonk":
          A.noise({ dur: .1, freq: 2200, freqTo: 400, gain: .12, decay: 3 });
          A.tone({ freq: 220, to: 110, dur: .12, type: "square", gain: .07 });
          break;
        case "bonkMiss":    A.tone({ freq: 150, to: 96, dur: .09, type: "square", gain: .03 }); break;
        case "penalty":
          A.noise({ dur: .3, freq: 700, freqTo: 70, gain: .14, decay: 2 });
          A.tone({ freq: 180, to: 70, dur: .3, type: "sawtooth", gain: .06 });
          break;
        case "roundWin":
          A.tone({ freq: 659, dur: .1, type: "square", gain: .05 });
          A.tone({ freq: 880, dur: .18, type: "square", gain: .05, delay: .1 });
          break;
        case "matchWin":
          A.tone({ freq: 523, dur: .11, type: "square", gain: .055 });
          A.tone({ freq: 659, dur: .11, type: "square", gain: .055, delay: .11 });
          A.tone({ freq: 784, dur: .11, type: "square", gain: .055, delay: .22 });
          A.tone({ freq: 1046, dur: .34, type: "square", gain: .06, delay: .33 });
          break;
        case "draw":
          A.tone({ freq: 440, dur: .14, type: "triangle", gain: .05 });
          A.tone({ freq: 392, dur: .26, type: "triangle", gain: .05, delay: .14 });
          break;
        /* --- V3 menu + ceremony hooks --------------------------------- */
        case "uiMove":      A.tone({ freq: 520, dur: .035, type: "square", gain: .022 }); break;
        case "lockIn":
          A.tone({ freq: 392, dur: .06, type: "square", gain: .045 });
          A.tone({ freq: 784, dur: .14, type: "square", gain: .045, delay: .05 });
          break;
        case "unlock":      A.tone({ freq: 600, to: 330, dur: .1, type: "square", gain: .03 }); break;
        case "denied":      A.tone({ freq: 160, dur: .12, type: "square", gain: .035 }); break;
        case "toggleOn":    A.tone({ freq: 660, to: 990, dur: .06, type: "square", gain: .03 }); break;
        case "toggleOff":   A.tone({ freq: 500, to: 330, dur: .06, type: "square", gain: .025 }); break;
        case "pause":       A.tone({ freq: 700, to: 350, dur: .12, type: "triangle", gain: .05 }); break;
        case "resume":      A.tone({ freq: 350, to: 700, dur: .12, type: "triangle", gain: .05 }); break;
        case "whoosh":      A.noise({ dur: .28, freq: 600, freqTo: 2600, filter: "bandpass", gain: .06, decay: 1.4 }); break;
        case "reelTick":    A.tone({ freq: 1250, dur: .018, type: "square", gain: .018 }); break;
        case "slam":
          A.noise({ dur: .25, freq: 900, freqTo: 80, gain: .14, decay: 2 });
          A.tone({ freq: 196, to: 98, dur: .2, type: "square", gain: .06 });
          break;
        case "reveal":
          A.tone({ freq: 659, dur: .09, type: "square", gain: .045 });
          A.tone({ freq: 988, dur: .22, type: "square", gain: .045, delay: .08 });
          break;
        case "versus":
          A.noise({ dur: .35, freq: 300, freqTo: 3000, filter: "bandpass", gain: .08, decay: 1.2 });
          A.tone({ freq: 110, to: 220, dur: .32, type: "sawtooth", gain: .05 });
          break;
        case "fanfare":
          A.tone({ freq: 523, dur: .12, type: "square", gain: .05 });
          A.tone({ freq: 659, dur: .12, type: "square", gain: .05, delay: .12 });
          A.tone({ freq: 784, dur: .12, type: "square", gain: .05, delay: .24 });
          A.tone({ freq: 1046, dur: .18, type: "square", gain: .055, delay: .36 });
          A.tone({ freq: 784, dur: .1, type: "square", gain: .045, delay: .56 });
          A.tone({ freq: 1046, dur: .5, type: "square", gain: .06, delay: .68 });
          break;
        /* --- Air Hockey / power-ups ----------------------------------- */
        case "puckHit":
          A.noise({ dur: .05, freq: 3000, freqTo: 900, filter: "bandpass", gain: .07, decay: 3 });
          A.tone({ freq: 620, to: 380, dur: .05, type: "square", gain: .03 });
          break;
        case "puckWall":    A.tone({ freq: 260, to: 200, dur: .04, type: "triangle", gain: .04 }); break;
        case "goal":
          A.noise({ dur: .4, freq: 500, freqTo: 3200, filter: "bandpass", gain: .1, decay: 1.4 });
          A.tone({ freq: 392, dur: .1, type: "square", gain: .05 });
          A.tone({ freq: 587, dur: .1, type: "square", gain: .05, delay: .09 });
          A.tone({ freq: 784, dur: .24, type: "square", gain: .055, delay: .18 });
          break;
        case "powerSpawn":
          A.tone({ freq: 660, to: 990, dur: .08, type: "sine", gain: .04 });
          A.tone({ freq: 990, to: 1320, dur: .1, type: "sine", gain: .035, delay: .08 });
          break;
        case "gara":
          A.tone({ freq: 520, to: 330, dur: .16, type: "sawtooth", gain: .045 });
          A.tone({ freq: 440, to: 260, dur: .2, type: "sawtooth", gain: .045, delay: .16 });
          A.tone({ freq: 660, to: 880, dur: .14, type: "square", gain: .04, delay: .38 });
          break;
        case "shrink":      A.tone({ freq: 880, to: 220, dur: .22, type: "square", gain: .045 }); break;
        case "reverse":
          A.tone({ freq: 330, to: 660, dur: .1, type: "square", gain: .04 });
          A.tone({ freq: 660, to: 330, dur: .12, type: "square", gain: .04, delay: .1 });
          break;
        default: break;
      }
    }
  };
  ESA.Audio = Audio_;

  /* ------------------------------------------------------------------ *
   * Input
   * One keydown/keyup pair for the whole app. Held keys clear on blur and
   * on tab hide so nobody ever gets stuck walking into a wall.
   * ------------------------------------------------------------------ */
  var GAME_KEYS = [
    "KeyW", "KeyA", "KeyS", "KeyD",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "KeyJ", "KeyK", "KeyL", "Space", "Enter", "NumpadEnter"
  ];
  var MENU_KEYS = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"];

  var Input = {
    held: Object.create(null),
    // Press order: code -> sequence number of its latest press. Lets
    // movement resolve OPPOSING held keys as "last pressed wins".
    order: Object.create(null),
    _seq: 0,
    /** "play" blocks gameplay keys, "menu" blocks navigation keys, null blocks nothing. */
    mode: null,
    /** Replaced (never appended to) by main.js, so handlers can't stack. */
    onPress: null,

    isDown: function (code) { return !!this.held[code]; },

    /** When a held key was pressed (0 if it is not held). Higher = newer. */
    pressedAt: function (code) { return this.held[code] ? (this.order[code] || 0) : 0; },

    clear: function () {
      var k;
      for (k in this.held) delete this.held[k];
      for (k in this.order) delete this.order[k];
    },

    setMode: function (mode) {
      if (this.mode !== mode) this.clear();
      this.mode = mode;
    },

    _shouldBlock: function (code) {
      if (this.mode === "play") return GAME_KEYS.indexOf(code) >= 0;
      if (this.mode === "menu") return MENU_KEYS.indexOf(code) >= 0;
      return false;
    },

    install: function () {
      var self = this;

      window.addEventListener("keydown", function (e) {
        // Typing in a text field (Guest nickname) stays typing: only
        // Escape / Enter reach the app, and nothing is blocked or held.
        var t = e.target;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
          if (e.code === "Escape" || e.code === "Enter" || e.code === "NumpadEnter") {
            if (!e.repeat && self.onPress) self.onPress(e.code, e);
          }
          return;
        }
        if (self._shouldBlock(e.code)) e.preventDefault();
        // HELD STATE is the truth for movement; key-repeat is never used to
        // move anyone. A repeat still re-asserts the key as held, so a key
        // that was already down when held state was cleared (pause, resume,
        // a mode change) comes back on its own instead of staying dead
        // until it is released and pressed again.
        if (!self.held[e.code]) self.order[e.code] = ++self._seq;   // a NEW press is the newest
        self.held[e.code] = true;
        if (e.repeat) return;                 // presses (menus, DASH, bonks) fire once
        if (self.onPress) self.onPress(e.code, e);
      }, { passive: false });

      window.addEventListener("keyup", function (e) {
        delete self.held[e.code];
        delete self.order[e.code];
      });

      // Any loss of focus drops every held key.
      window.addEventListener("blur", function () { self.clear(); });
      document.addEventListener("visibilitychange", function () {
        if (document.hidden) self.clear();
      });
      // Context menu / alt-tab on some platforms fires neither of the above.
      window.addEventListener("pagehide", function () { self.clear(); });
    }
  };
  ESA.Input = Input;

  /* ------------------------------------------------------------------ *
   * Assets
   * ------------------------------------------------------------------ */
  var Assets = {
    images: Object.create(null),
    failed: [],

    get: function (key) { return this.images[key] || null; },

    /** Resolves even if some images fail, so a missing file never bricks the app. */
    load: function (manifest) {
      var self = this;
      var keys = Object.keys(manifest);
      var jobs = keys.map(function (key) {
        return new Promise(function (resolve) {
          var img = new Image();
          img.onload = function () { self.images[key] = img; resolve(); };
          img.onerror = function () {
            self.failed.push(manifest[key]);
            console.warn("[ESA] Could not load asset:", manifest[key]);
            resolve();
          };
          img.src = manifest[key];
        });
      });
      return Promise.all(jobs);
    },

    /**
     * Draws an image once into an offscreen canvas at a fixed size.
     * Used for the ESA token so the 1254px emblem is not rescaled every frame.
     */
    prerender: function (key, srcKey, size) {
      var img = this.images[srcKey];
      if (!img || !img.width) return null;
      var c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      var g = c.getContext("2d");
      g.imageSmoothingQuality = "high";
      // Preserve aspect ratio inside the square.
      var ratio = img.width / img.height;
      var w = ratio >= 1 ? size : size * ratio;
      var h = ratio >= 1 ? size / ratio : size;
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
      this.images[key] = c;
      return c;
    }
  };
  ESA.Assets = Assets;

  /* ------------------------------------------------------------------ *
   * Screens + transition veil
   * ------------------------------------------------------------------ */
  var Screens = {
    current: null,
    busy: false,
    _timers: new TimerGroup(),
    _veil: null,

    init: function () { this._veil = ESA.byId("veil"); },

    /** Immediate swap with no veil (used for boot). */
    set: function (id) {
      var all = document.querySelectorAll(".screen");
      for (var i = 0; i < all.length; i++) {
        all[i].classList.toggle("is-active", all[i].id === id);
      }
      this.current = id;
    },

    /**
     * Wipe out, run `swap`, wipe back in. Overlapping calls are ignored so a
     * mashed button can never leave two screens active at once.
     */
    go: function (id, swap, onDone) {
      if (this.busy) return;
      var self = this;
      this.busy = true;
      this._timers.clear();

      var veil = this._veil;
      veil.classList.remove("is-out");
      veil.classList.add("is-in");

      this._timers.after(310, function () {
        if (typeof swap === "function") swap();
        self.set(id);
        veil.classList.remove("is-in");
        veil.classList.add("is-out");

        self._timers.after(380, function () {
          veil.classList.remove("is-out");
          self.busy = false;
          if (typeof onDone === "function") onDone();
        });
      });
    }
  };
  ESA.Screens = Screens;

  /* ------------------------------------------------------------------ *
   * Particles
   * A fixed-capacity pool. Nothing is allocated once the pool is warm, and
   * the cap keeps even the explosion comfortable on campus hardware.
   * ------------------------------------------------------------------ */
  function ParticleField(capacity) {
    this.cap = capacity || 220;
    this.items = new Array(this.cap);
    for (var i = 0; i < this.cap; i++) {
      this.items[i] = { alive: false };
    }
    this.cursor = 0;
  }

  ParticleField.prototype.spawn = function (o) {
    // Round-robin over the pool: the oldest particle is recycled when full.
    var p = null;
    for (var tries = 0; tries < this.cap; tries++) {
      var cand = this.items[this.cursor];
      this.cursor = (this.cursor + 1) % this.cap;
      if (!cand.alive) { p = cand; break; }
    }
    if (!p) { p = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.cap; }

    p.alive = true;
    p.type = o.type || "dot";
    p.x = o.x; p.y = o.y;
    p.vx = o.vx || 0; p.vy = o.vy || 0;
    p.life = 0;
    p.maxLife = o.life || 0.6;
    p.size = o.size || 4;
    p.size2 = o.size2 || p.size;
    p.color = o.color || "#f3c35a";
    p.gravity = o.gravity === undefined ? 0 : o.gravity;
    p.drag = o.drag === undefined ? 0.92 : o.drag;
    p.rot = o.rot || 0;
    p.vrot = o.vrot || 0;
    p.text = o.text || "";
    p.font = o.font || 0;
    p.fade = o.fade === undefined ? true : o.fade;
    return p;
  };

  ParticleField.prototype.burst = function (x, y, count, o) {
    o = o || {};
    // Decoration only: lower quality tiers spawn fewer sparks (js/quality.js).
    if (ESA.Quality) count = ESA.Quality.count(count);
    for (var i = 0; i < count; i++) {
      var a = (o.angle === undefined ? Math.random() * Math.PI * 2
                                     : o.angle + ESA.rand(-o.spread || -0.6, o.spread || 0.6));
      var sp = ESA.rand(o.speedMin || 60, o.speedMax || 200);
      this.spawn({
        type: o.type || "dot",
        x: x + ESA.rand(-4, 4),
        y: y + ESA.rand(-4, 4),
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: ESA.rand(o.lifeMin || 0.35, o.lifeMax || 0.75),
        size: ESA.rand(o.sizeMin || 2, o.sizeMax || 5),
        color: o.colors ? ESA.pick(o.colors) : (o.color || "#f3c35a"),
        gravity: o.gravity === undefined ? 320 : o.gravity,
        drag: o.drag === undefined ? 0.93 : o.drag,
        rot: Math.random() * Math.PI,
        vrot: ESA.rand(-9, 9)
      });
    }
  };

  ParticleField.prototype.update = function (dt) {
    for (var i = 0; i < this.cap; i++) {
      var p = this.items[i];
      if (!p.alive) continue;
      p.life += dt;
      if (p.life >= p.maxLife) { p.alive = false; continue; }
      p.vy += p.gravity * dt;
      var d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
    }
  };

  ParticleField.prototype.draw = function (ctx) {
    // Only particles that transform the context pay for save/restore; the
    // plain ones (rings, sparks, dots) just set alpha - far cheaper with a
    // full pool on a phone.
    var base = ctx.globalAlpha;
    for (var i = 0; i < this.cap; i++) {
      var p = this.items[i];
      if (!p.alive) continue;
      var t = p.life / p.maxLife;
      var alpha = p.fade ? (1 - t) : 1;
      ctx.globalAlpha = base * Math.max(0, alpha);

      if (p.type === "ring") {
        var rr = ESA.lerp(p.size, p.size2, ESA.easeOut(t));
        ctx.beginPath();
        ctx.arc(p.x, p.y, rr, 0, Math.PI * 2);
        ctx.lineWidth = Math.max(1, 5 * (1 - t));
        ctx.strokeStyle = p.color;
        ctx.stroke();
        continue;
      }
      if (p.type === "spark") {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = Math.max(1, p.size * 0.5);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.vx * 0.022, p.y - p.vy * 0.022);
        ctx.stroke();
        ctx.lineCap = "butt";
        continue;
      }
      if (p.type !== "text" && p.type !== "confetti" && p.type !== "star") {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - t * 0.45), 0, Math.PI * 2);
        ctx.fill();
        continue;
      }

      ctx.save();

      if (p.type === "text") {
        ctx.translate(p.x, p.y);
        ctx.font = "700 " + (p.font || 26) + "px " + ESA.FONT_DISPLAY;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "rgba(6,18,33,.75)";
        ctx.strokeText(p.text, 0, 0);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, 0, 0);

      } else if (p.type === "confetti") {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        // Flutter: the strip narrows as it spins.
        ctx.scale(Math.cos(p.rot * 1.6), 1);
        ctx.fillRect(-p.size * 0.5, -p.size * 0.9, p.size, p.size * 1.8);

      } else {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        drawStar(ctx, p.size, p.color);
      }
      ctx.restore();
    }
    ctx.globalAlpha = base;
  };

  /** Any particle still alive? (lets a finished screen stop redrawing) */
  ParticleField.prototype.busy = function () {
    for (var i = 0; i < this.cap; i++) if (this.items[i].alive) return true;
    return false;
  };

  ParticleField.prototype.clear = function () {
    for (var i = 0; i < this.cap; i++) this.items[i].alive = false;
  };

  function drawStar(ctx, r, color) {
    ctx.beginPath();
    for (var i = 0; i < 5; i++) {
      var outer = (i / 5) * Math.PI * 2 - Math.PI / 2;
      var inner = outer + Math.PI / 5;
      ctx.lineTo(Math.cos(outer) * r, Math.sin(outer) * r);
      ctx.lineTo(Math.cos(inner) * r * 0.45, Math.sin(inner) * r * 0.45);
    }
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(60,38,4,.55)";
    ctx.stroke();
  }
  ESA.drawStar = drawStar;
  ESA.ParticleField = ParticleField;

  /* ------------------------------------------------------------------ *
   * Shared constants
   * ------------------------------------------------------------------ */
  ESA.FONT_DISPLAY = '"Bahnschrift", "DIN Alternate", "Arial Narrow", "Segoe UI", system-ui, sans-serif';
  ESA.FONT_UI = '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif';

  ESA.COLORS = {
    navy: "#071728",
    navyDeep: "#030b16",
    navyMid: "#0e2c4d",
    gold: "#f3c35a",
    goldDeep: "#c0871f",
    goldPale: "#fdeec4",
    cream: "#fff6e4",
    sand: "#e6d3a8",
    sandDeep: "#c3a879",
    zima: "#2f7fd8",
    shaza: "#9560ac",
    danger: "#e8584f"
  };

  /** Logical arena size. Never changes, so physics is resolution independent. */
  ESA.W = 960;
  ESA.H = 540;

})(window.ESA);
