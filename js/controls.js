/* ==========================================================================
   ESA ARCADE - control sources (shared)
   Games never ask "is W held?". They ask for a player slot's normalized
   intent:
     ESA.Controls.vector(slot)  -> { x, y } with length <= 1
     game.onAction(slot, name)  <- discrete presses ("action1", "action2")

   Sources register as providers. Built in today:
     keyboard  W A S D / arrows (exactly the old digital, normalized vector)
     touch     the virtual joystick (js/touch.js registers itself)
   A future CPU opponent registers one more provider for its slot and
   calls ESA.Controls.fireAction() - no game needs rewriting.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var providers = [];

  /** Digital keyboard direction, normalized so diagonals are not faster. */
  function keyboardVector(slot) {
    var c = ESA.CONTROLS[slot] && ESA.CONTROLS[slot].move;
    if (!c) return null;
    var I = ESA.Input;
    var dx = (I.isDown(c.right) ? 1 : 0) - (I.isDown(c.left) ? 1 : 0);
    var dy = (I.isDown(c.down) ? 1 : 0) - (I.isDown(c.up) ? 1 : 0);
    if (!dx && !dy) return null;
    var len = Math.hypot(dx, dy);
    return { x: dx / len, y: dy / len };
  }

  ESA.Controls = {
    /**
     * provider: { name, vector(slot) -> {x, y} | null }
     * Returns a function that removes it again.
     */
    addProvider: function (p) {
      providers.push(p);
      return function () {
        var i = providers.indexOf(p);
        if (i >= 0) providers.splice(i, 1);
      };
    },

    /** Combined movement intent for a slot; never longer than 1. */
    vector: function (slot) {
      var x = 0, y = 0;
      for (var i = 0; i < providers.length; i++) {
        var v = providers[i].vector(slot);
        if (v) { x += v.x; y += v.y; }
      }
      var len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      if (!isFinite(x) || !isFinite(y)) { x = 0; y = 0; }
      return { x: x, y: y };
    },

    /** Set by app.js: routes a discrete action to the running game. */
    onAction: null,

    /** Any source (touch button, future CPU) fires an action through here. */
    fireAction: function (slot, action) {
      if (typeof this.onAction === "function") this.onAction(slot, action);
    }
  };

  ESA.Controls.addProvider({ name: "keyboard", vector: keyboardVector });

})(window.ESA);
