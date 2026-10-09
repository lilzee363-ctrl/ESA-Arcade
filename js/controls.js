/* ==========================================================================
   ESA ARCADE - control sources (shared)
   Games never ask "is W held?". They ask for a player slot's normalized
   intent:
     ESA.Controls.vector(slot)  -> { x, y } with length <= 1
     game.onAction(slot, name)  <- discrete presses ("action1", "action2")

   Sources register as providers. Built in today:
     keyboard  W A S D / arrows (exactly the old digital, normalized vector)
     touch     the virtual joystick (js/touch.js registers itself)
     cpu       a CPU opponent (js/cpu.js) - registered per match

   MOVEMENT IS STATE, NOT EVENTS
   -----------------------------
   vector() is read by the game loop every frame. Keyboard: four HELD
   directions, resolved PER AXIS with LAST PRESSED WINS - holding A and
   then pressing D moves right at once (no dead stop); release D while A
   is still down and you go left again immediately. Up/down works the
   same way, independently. Non-opposing directions combine (W + D =
   up-right), then the vector is normalised so a diagonal is never faster
   than a straight line. Press order comes from ESA.Input.pressedAt(). Touch: the analog
   joystick vector. CPU: its stick. Nothing here is debounced, throttled
   or queued; DASH and other presses are the only one-shot inputs.

   SOLO KEYBOARD
   -------------
   With one human on the keyboard (setKeyboardAlias(true), set by app.js
   for Solo runs) the P2 keys are a second set of keys for P1: arrows move
   P1 too and Enter dashes for P1. Each direction counts once however many
   keys press it, so W + Up is not faster than W.

   SLOT OWNERSHIP
   --------------
   By default a slot is driven by every human source at once (keyboard +
   touch). claim(slot, name) hands a slot to ONE source exclusively: only
   that provider's vector counts and only actions fired with that source
   reach the game. Solo uses it so the arrow keys / Enter can never steer
   the CPU's side. release(slot) gives it back. Games never see any of this.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var providers = [];
  var owners = { p1: null, p2: null };     // slot -> provider name, or null = humans
  var ZERO = { x: 0, y: 0 };
  var alias = false;                        // Solo: P2 keys also drive P1
  var KV = { x: 0, y: 0 };                  // reused - no per-frame allocation

  /** Newest press among the keys for one direction (0 = none held). */
  function newest(c, o, dir) {
    var t = ESA.Input.pressedAt(c[dir]);
    return o ? Math.max(t, ESA.Input.pressedAt(o[dir])) : t;
  }

  /** One axis, last pressed wins: -1, 0 or +1. */
  function axis(neg, pos) { return pos > neg ? 1 : neg > pos ? -1 : 0; }

  /**
   * Digital keyboard direction from the four HELD directions. Opposing
   * keys on an axis: the most recently pressed one wins (and the older
   * one takes over again when it is released). Normalized so diagonals
   * are not faster.
   */
  function keyboardVector(slot) {
    var c = ESA.CONTROLS[slot] && ESA.CONTROLS[slot].move;
    if (!c) return null;
    if (alias && slot === "p2") return null;          // its keys belong to P1 now
    var o = alias && slot === "p1" ? ESA.CONTROLS.p2.move : null;
    var dx = axis(newest(c, o, "left"), newest(c, o, "right"));
    var dy = axis(newest(c, o, "up"), newest(c, o, "down"));
    if (!dx && !dy) return null;
    var len = Math.hypot(dx, dy);
    KV.x = dx / len; KV.y = dy / len;
    return KV;
  }

  ESA.Controls = {
    /**
     * provider: { name, vector(slot) -> {x, y} | null, exclusive? }
     * An `exclusive` provider (the CPU) only ever drives a slot it has
     * claimed. Returns a function that removes it again.
     */
    addProvider: function (p) {
      providers.push(p);
      return function () {
        var i = providers.indexOf(p);
        if (i >= 0) providers.splice(i, 1);
      };
    },

    /** Give `slot` exclusively to the source called `name`. */
    claim: function (slot, name) { if (slot in owners) owners[slot] = name || null; },

    /** Hand `slot` back to the human sources. */
    release: function (slot) {
      if (slot === undefined) { owners.p1 = owners.p2 = null; return; }
      if (slot in owners) owners[slot] = null;
    },

    owner: function (slot) { return owners[slot] || null; },

    /** Solo: one human on the keyboard - the P2 keys drive P1 as well. */
    setKeyboardAlias: function (on) { alias = !!on; },
    keyboardAlias: function () { return alias; },

    /** Combined movement intent for a slot; never longer than 1. */
    vector: function (slot) {
      var own = owners[slot] || null;
      var x = 0, y = 0;
      for (var i = 0; i < providers.length; i++) {
        var p = providers[i];
        if (own ? p.name !== own : p.exclusive) continue;
        var v = p.vector(slot);
        if (v) { x += v.x; y += v.y; }
      }
      var len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
      if (!isFinite(x) || !isFinite(y)) return { x: ZERO.x, y: ZERO.y };
      return { x: x, y: y };
    },

    /** Set by app.js: routes a discrete action to the running game. */
    onAction: null,

    /**
     * Any source (keyboard, touch button, CPU) fires an action through here.
     * `source` defaults to a human source; a claimed slot only accepts its
     * owner's actions.
     */
    fireAction: function (slot, action, source) {
      if (alias && slot === "p2" && source === "keyboard") slot = "p1";   // Enter = P1's DASH in Solo
      var own = owners[slot] || null;
      if (own ? source !== own : source === "cpu") return;
      if (typeof this.onAction === "function") this.onAction(slot, action);
    }
  };

  ESA.Controls.addProvider({ name: "keyboard", vector: keyboardVector });

})(window.ESA);
