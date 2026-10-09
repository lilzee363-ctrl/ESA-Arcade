/* ==========================================================================
   ESA ARCADE - shared directional DASH (V4.1)
   One dash behaviour for every game that has one (Air Hockey today; a
   future Head Soccer opts in the same way). Two parts:

   DIRECTION   ESA.Dash.direction(facing, vec)
     A dash always goes along the player's REAL movement:
       - stick / keys held        -> that normalized vector, at any angle
                                     (RIGHT, UP-RIGHT, a shallow analog
                                     down-left - never snapped to 4 ways)
       - nothing held             -> the last meaningful facing vector
       - no history at all        -> the facing the game seeded
     `facing` is a small { x, y } object the game owns per player; feed
     it every frame with ESA.Dash.track(facing, vec) so neutral dashes
     remember the last way the player was actually moving.

   DOUBLE-TAP  keyboard: tap a direction twice quickly -> dash.
     Only for games that declare  dash: { action: "action1" }  in their
     registry entry (Bonk Booth's A S D keys are never dash keys). The
     second tap fires the SAME action a DASH key / touch button fires, so
     it goes through the game's own cooldown: two input methods, one
     ability, never an extra dash. The direction is then resolved like any
     other dash, so double-tapping RIGHT while UP is held dashes up-right.

   Touch keeps its dedicated DASH button (no joystick double-tapping);
   it also resolves through direction(), i.e. along the analog stick, or
   the last facing when the stick is centred.
   ========================================================================== */

(function (ESA) {
  "use strict";

  /*
   * Second press of the same direction within this many ms of the first.
   * 250 ms: a deliberate "tap-tap" is ~120-200 ms, while normal walking
   * re-presses (stop, then go again) are almost always slower.
   */
  var DOUBLE_TAP_MS = 250;
  var MIN_VEC = 0.08;           // smaller stick deflections don't count as "moving"

  var enabled = null;           // { action } while a dash game is running
  var taps = { p1: null, p2: null };   // slot -> { dir, at }

  function dirOf(code) {
    var C = ESA.CONTROLS;
    for (var s = 0; s < ESA.SLOTS.length; s++) {
      var slot = ESA.SLOTS[s], mv = C[slot].move;
      for (var d in mv) {
        if (mv[d] !== code) continue;
        // Solo: the P2 keys are a second set of keys for P1.
        if (slot === "p2" && ESA.Controls.keyboardAlias()) slot = "p1";
        return { slot: slot, dir: d };
      }
    }
    return null;
  }

  ESA.Dash = {
    DOUBLE_TAP_MS: DOUBLE_TAP_MS,

    /** A fresh facing memory, seeded with the player's starting direction. */
    facing: function (x, y) { return { x: x || 1, y: y || 0 }; },

    /** Remember the last meaningful movement direction. */
    track: function (facing, vec) {
      if (!vec) return;
      var l = Math.hypot(vec.x, vec.y);
      if (l < MIN_VEC || !isFinite(l)) return;
      facing.x = vec.x / l;
      facing.y = vec.y / l;
    },

    /** Unit dash direction: current movement, else last facing. */
    direction: function (facing, vec) {
      var l = vec ? Math.hypot(vec.x, vec.y) : 0;
      if (l >= MIN_VEC && isFinite(l)) return { x: vec.x / l, y: vec.y / l };
      var f = Math.hypot(facing.x, facing.y);
      return f > 0 ? { x: facing.x / f, y: facing.y / f } : { x: 1, y: 0 };
    },

    /** app.js: a run of `def` started / ended. */
    enable: function (def) {
      enabled = def && def.dash ? def.dash : null;
      taps.p1 = taps.p2 = null;
    },
    disable: function () { enabled = null; taps.p1 = taps.p2 = null; },

    /**
     * Every gameplay key press (never auto-repeat). Returns true when it
     * fired a dash. The press still moves the player as normal.
     */
    keyDown: function (code) {
      if (!enabled) return false;
      var k = dirOf(code);
      if (!k) return false;
      var now = performance.now();
      var last = taps[k.slot];
      if (last && last.dir === k.dir && now - last.at <= DOUBLE_TAP_MS) {
        taps[k.slot] = null;                     // a triple tap is one dash, not two
        ESA.Controls.fireAction(k.slot, enabled.action, "keyboard");
        return true;
      }
      taps[k.slot] = { dir: k.dir, at: now };
      return false;
    }
  };

})(window.ESA);
