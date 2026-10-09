/* ==========================================================================
   ESA ARCADE - CLUTCH (shared, opt-in comeback assist) - V4.1
   A small, SKILL-PRESERVING edge for a player who has fallen meaningfully
   behind in a head-to-head game. It never awards points, never removes
   hazards and never decides a winner - it only gives the trailing player
   a little more of something the game defines (Bonk Booth: a slightly
   longer window to react to a target).

   It is NOT a fix for unfair randomness: games must be fair first (Bonk
   Booth's shared target schedule), CLUTCH only softens a real skill gap.

   OPTING IN (one call per match)
     this.clutch = ESA.Clutch.create({
       tiers: [ { gap: 5,  bonus: 0.08, label: "CLUTCH I" },    // CLUTCH I
                { gap: 10, bonus: 0.15, label: "CLUTCH II" } ],  // CLUTCH II
       hold: 2                                   // gap hysteresis in points
     });
     each frame / scoring change:  this.clutch.update({ p1: s1, p2: s2 })
     when applying the edge:        1 + this.clutch.bonus("p1")
     to show it (optional):         this.clutch.label("p1")  -> "" | "CLUTCH"

   Only the TRAILING player can have a tier. A tier switches on when the
   deficit reaches its gap and off only once the deficit falls below
   (gap - hold), so a score bouncing around a threshold never flickers.
   Games that don't opt in never load any of this into their logic. Today
   only Bonk Booth (versus) uses it.
   ========================================================================== */

(function (ESA) {
  "use strict";

  function Clutch(opts) {
    opts = opts || {};
    this.tiers = (opts.tiers || []).slice().sort(function (a, b) { return a.gap - b.gap; });
    this.hold = opts.hold === undefined ? 0.75 : opts.hold;
    this.level = { p1: 0, p2: 0 };        // index into tiers + 1 (0 = none)
  }

  Clutch.prototype.update = function (scores) {
    var a = scores.p1 || 0, b = scores.p2 || 0;
    this._side("p1", b - a);
    this._side("p2", a - b);
  };

  Clutch.prototype._side = function (slot, deficit) {
    var lvl = this.level[slot];
    // Raise to the highest tier the deficit has reached...
    for (var i = this.tiers.length - 1; i >= 0; i--) {
      if (deficit >= this.tiers[i].gap) { if (i + 1 > lvl) lvl = i + 1; break; }
    }
    // ...and drop tiers only once the deficit is clearly below them.
    while (lvl > 0 && deficit < this.tiers[lvl - 1].gap - this.hold) lvl--;
    this.level[slot] = lvl;
  };

  Clutch.prototype.bonus = function (slot) {
    var l = this.level[slot];
    return l ? this.tiers[l - 1].bonus : 0;
  };

  Clutch.prototype.label = function (slot) {
    var l = this.level[slot];
    return l ? (this.tiers[l - 1].label || "CLUTCH") : "";
  };

  Clutch.prototype.reset = function () { this.level.p1 = this.level.p2 = 0; };

  ESA.Clutch = {
    create: function (opts) { return new Clutch(opts); }
  };

})(window.ESA);
