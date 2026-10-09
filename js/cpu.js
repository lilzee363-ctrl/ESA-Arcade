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
   ========================================================================== */

(function (ESA) {
  "use strict";

  var DIFFICULTIES = [
    { id: "easy",   label: "Easy",   blurb: "Learning the ropes.", color: "#5fd38a" },
    { id: "normal", label: "Normal", blurb: "Ready for a fight.",  color: "#f3c35a" },
    { id: "hard",   label: "Hard",   blurb: "No mercy.",           color: "#ff5468" }
  ];
  var byDiff = Object.create(null);
  DIFFICULTIES.forEach(function (d) { byDiff[d.id] = d; });

  var strategies = Object.create(null);

  /* ================================================================== *
   * Controller - one per CPU-driven slot, per match.
   * ================================================================== */
  function Controller(gameId, slot, difficulty) {
    var self = this;
    var def = strategies[gameId];
    this.slot = slot;
    this.difficulty = byDiff[difficulty] ? difficulty : "normal";
    this.brain = def.create({ slot: slot, difficulty: this.difficulty });
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
