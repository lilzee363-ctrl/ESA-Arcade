/* ==========================================================================
   ESA ARCADE - CPU opponents (shared)
   A CPU is just one more CONTROL SOURCE. It never touches game state:

     generic controller (this file)          game strategy (js/cpu-<game>.js)
     ------------------------------          -------------------------------
     registers a "cpu" ESA.Controls      <-  decides intent from what a
     provider, claims its slot, ticks        player could SEE: { x, y } in
     the strategy once per frame and         -1..1 and an optional "action1"
     fires its actions through
     ESA.Controls.fireAction(.., "cpu")

   The game reads the CPU's slot exactly like a human's - ESA.Controls.vector
   and game.onAction - so stun, REVERSE, shrink, dash cooldowns and speed
   limits all apply through the game's normal code paths. A strategy cannot
   move a player, set a velocity or skip a cooldown; it can only ask.

   ADDING A CPU TO ANOTHER GAME
   ----------------------------
   1. The game exposes observe(slot, view): fills `view` with what is on
      screen for that player (no hidden state, no RNG, no future).
   2. js/cpu-<game>.js calls
        ESA.CPU.registerStrategy("<gameId>", {
          create: function (opts) {   // opts: { slot, difficulty, params }
            return { update: function (dt, view, intent) {...},
                     reset: function () {...} };
          }
        });
      update() writes intent.x / intent.y and may set intent.action.
   3. Set soloEligible: true in the game's registry entry.
   The Solo menus, difficulty screen, results and Session Stats pick it up.

   DIFFICULTY = THINKING, NEVER PHYSICS (V4.1)
   -------------------------------------------
   Every difficulty plays to WIN: it attacks, defends, reacts to threats
   and uses the game's mechanics. What changes is decision QUALITY - how
   fast it notices and reacts, how well it predicts, how accurate its aim
   and routes are and how often it makes a human mistake. Movement speed,
   acceleration, hitboxes, dash strength / cooldown and every status
   effect are the game's own rules, identical for a human and every CPU:
   the controller hands the game a stick of length <= 1 and nothing else.
   A strategy must NEVER scale its stick down by difficulty (it may ease
   off near a target, exactly like a thumb would).

   The shared PROFILES below are the common language; a strategy merges
   its game-specific extras on top with ESA.CPU.tune(extras) and receives
   the merged table as opts.profile.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var DIFFICULTIES = [
    { id: "easy",   label: "Easy",   blurb: "Plays to win. Thinks slowly.", color: "#5fd38a" },
    { id: "normal", label: "Normal", blurb: "Ready for a fight.",  color: "#f3c35a" },
    { id: "hard",   label: "Hard",   blurb: "No mercy.",           color: "#ff5468" }
  ];
  var byDiff = Object.create(null);
  DIFFICULTIES.forEach(function (d) { byDiff[d.id] = d; });

  /**
   * Shared difficulty profiles - decision quality only.
   *   reaction     [min, max] s before a NEW plan takes effect
   *   decision     s between decisions (+ up to 35% jitter)
   *   prediction   0..1 how far ahead / how well it reads motion
   *   bounces      wall bounces it can foresee
   *   aimError     px of random error on aim points
   *   routeError   px of random error on positions / routes
   *   mistake      chance per decision of a misjudged plan
   *   hesitate     chance per decision to keep the old plan
   *   notice       [min, max] s before it notices a NEW opportunity (pickup)
   *   opportunity  0..1 how wisely it weighs a risky opportunity
   *   dashUse      chance to spend a ready dash when it would pay off
   */
  var PROFILES = {
    easy: {
      reaction: [0.22, 0.34], decision: 0.22, prediction: 0.35, bounces: 0,
      aimError: 46, routeError: 30, mistake: 0.14, hesitate: 0.07,
      notice: [1.0, 1.8], opportunity: 0.45, dashUse: 0.4
    },
    normal: {
      reaction: [0.12, 0.19], decision: 0.13, prediction: 0.7, bounces: 1,
      aimError: 22, routeError: 13, mistake: 0.05, hesitate: 0.025,
      notice: [0.45, 0.8], opportunity: 0.75, dashUse: 0.7
    },
    hard: {
      reaction: [0.065, 0.1], decision: 0.08, prediction: 1, bounces: 2,
      aimError: 9, routeError: 5, mistake: 0.015, hesitate: 0.008,
      notice: [0.15, 0.3], opportunity: 0.95, dashUse: 0.9
    }
  };

  var strategies = Object.create(null);

  /* ================================================================== *
   * Controller - one per CPU-driven slot, per match.
   * ================================================================== */
  function Controller(gameId, slot, difficulty) {
    var self = this;
    var def = strategies[gameId];
    this.slot = slot;
    this.difficulty = byDiff[difficulty] ? difficulty : "normal";
    this.brain = def.create({
      slot: slot, difficulty: this.difficulty,
      profile: (def.params && def.params[this.difficulty]) || PROFILES[this.difficulty]
    });
    this.view = {};                        // reused every frame - no per-frame garbage
    this.intent = { x: 0, y: 0, action: null };
    this.live = { x: 0, y: 0 };            // what the provider reports
    this.dead = false;
    this.removeProvider = ESA.Controls.addProvider({
      name: "cpu",
      exclusive: true,                     // only ever drives a slot it has claimed
      vector: function (s) {
        if (s !== self.slot || self.dead) return null;
        return (self.live.x || self.live.y) ? self.live : null;
      }
    });
    ESA.Controls.claim(slot, "cpu");
  }

  /** Called once per simulated frame by app.js, before game.update(). */
  Controller.prototype.update = function (dt, game) {
    if (this.dead || !game || typeof game.observe !== "function") return;
    var it = this.intent;
    it.action = null;
    game.observe(this.slot, this.view);
    this.brain.update(dt, this.view, it);
    // Sanitise: a strategy can ask for at most full stick deflection.
    var x = isFinite(it.x) ? it.x : 0, y = isFinite(it.y) ? it.y : 0;
    var len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    this.live.x = x; this.live.y = y;
    // Actions go through the same gate as a touch button or a key.
    if (it.action) ESA.Controls.fireAction(this.slot, it.action, "cpu");
  };

  /** Pause / restart: stick centred, pending decisions dropped. */
  Controller.prototype.reset = function () {
    this.live.x = this.live.y = 0;
    this.intent.x = this.intent.y = 0;
    this.intent.action = null;
    if (this.brain.reset) this.brain.reset();
  };

  Controller.prototype.destroy = function () {
    if (this.dead) return;
    this.dead = true;
    this.reset();
    this.removeProvider();
    if (ESA.Controls.owner(this.slot) === "cpu") ESA.Controls.release(this.slot);
  };

  /* ================================================================== *
   * Public API
   * ================================================================== */
  ESA.CPU = {
    DIFFICULTIES: DIFFICULTIES,

    difficulty: function (id) { return byDiff[id] || byDiff.normal; },

    PROFILES: PROFILES,

    /** The shared decision-quality profile for a difficulty. */
    profile: function (id) { return PROFILES[id] || PROFILES.normal; },

    /**
     * Shared profile + game-specific extras, per difficulty:
     *   ESA.CPU.tune({ easy: {...}, normal: {...}, hard: {...} })
     * Extras may add fields or override shared ones, but never a speed.
     */
    tune: function (extras) {
      var out = {};
      DIFFICULTIES.forEach(function (d) {
        var m = {}, k, base = PROFILES[d.id], add = (extras && extras[d.id]) || {};
        for (k in base) m[k] = base[k];
        for (k in add) m[k] = add[k];
        out[d.id] = m;
      });
      return out;
    },

    /** Small helpers every strategy shares (no allocation). */
    util: {
      rand: function (a, b) { return a + Math.random() * (b - a); },
      clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
      chance: function (p) { return Math.random() < p; },
      /** Reaction delay: continuing the same idea is near-instant, a new one waits. */
      reactDelay: function (P, same) {
        return same ? Math.random() * P.reaction[0] * 0.5 : P.reaction[0] + Math.random() * (P.reaction[1] - P.reaction[0]);
      },
      nextDecision: function (P) { return P.decision * (1 + Math.random() * 0.35); }
    },

    /** def: { create(opts) -> { update(dt, view, intent), reset() } } */
    registerStrategy: function (gameId, def) {
      if (!gameId || !def || typeof def.create !== "function") {
        console.warn("[ESA] CPU strategy skipped:", gameId);
        return;
      }
      strategies[gameId] = def;
    },

    hasStrategy: function (gameId) { return !!strategies[gameId]; },

    /** Tuning / tests: a strategy's difficulty table (or null). */
    params: function (gameId) { return (strategies[gameId] && strategies[gameId].params) || null; },

    /** Puts a CPU on `slot` for a match of `gameId`. Returns the controller or null. */
    attach: function (gameId, slot, difficulty) {
      if (!strategies[gameId]) return null;
      return new Controller(gameId, slot, difficulty);
    }
  };

})(window.ESA);
