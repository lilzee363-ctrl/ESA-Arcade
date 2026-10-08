/* ==========================================================================
   ESA ARCADE - status effects (shared)
   One state object per player for temporary gameplay conditions:
     stunned   - no movement, no action
     shrunk    - smaller sprite AND smaller collider (the game applies it)
     reversed  - directional movement inverted
   plus a single status-immunity window.

   Rules (enforced here, so every game gets them for free):
   - The same effect never stacks, multiplies or extends while active.
   - When any negative effect ENDS NATURALLY the player gets IMMUNITY_MS of
     immunity; hostile effects are refused during it.
   - clear() (goal reset, match end, exit) ends everything at once and does
     NOT grant immunity.

   There are no timers. Time is whatever clock the caller passes in (ms),
   so a game that only advances its clock while running gets pause support
   automatically, and a destroyed game simply stops calling update().
   ========================================================================== */

(function (ESA) {
  "use strict";

  var IMMUNITY_MS = 2000;

  var KINDS = {
    stunned:  { label: "STUNNED",  negative: true },
    shrunk:   { label: "SHRUNK",   negative: true },
    reversed: { label: "REVERSED", negative: true }
  };

  /**
   * opts.onStart(kind, effect)            effect began
   * opts.onEnd(kind, reason, effect)      reason: "expired" | "cleared"
   * opts.immunityMs                       override the 2 s default
   */
  function StatusSet(opts) {
    this.opts = opts || {};
    this.immunityMs = this.opts.immunityMs === undefined ? IMMUNITY_MS : this.opts.immunityMs;
    this.effects = Object.create(null);   // kind -> { kind, start, until, duration }
    this.immuneUntil = 0;
    this.immuneFrom = 0;
    this.lastEnded = Object.create(null); // kind -> { at, reason } (for exit animations)
  }

  /**
   * Try to apply `kind` for `ms` at time `now`.
   * Returns "applied" | "immune" | "active" (already has it - unchanged).
   */
  StatusSet.prototype.apply = function (kind, ms, now) {
    var def = KINDS[kind];
    if (!def) return "unknown";
    if (this.effects[kind]) return "active";
    if (def.negative && this.isImmune(now)) return "immune";
    var e = { kind: kind, start: now, until: now + Math.max(0, ms), duration: Math.max(0, ms) };
    this.effects[kind] = e;
    if (this.opts.onStart) this.opts.onStart(kind, e);
    return "applied";
  };

  /** Would `kind` be accepted right now? Same answers as apply(). */
  StatusSet.prototype.check = function (kind, now) {
    if (this.effects[kind]) return "active";
    if (KINDS[kind] && KINDS[kind].negative && this.isImmune(now)) return "immune";
    return "ok";
  };

  StatusSet.prototype.has = function (kind) { return !!this.effects[kind]; };
  StatusSet.prototype.get = function (kind) { return this.effects[kind] || null; };

  StatusSet.prototype.remaining = function (kind, now) {
    var e = this.effects[kind];
    return e ? Math.max(0, e.until - now) : 0;
  };

  StatusSet.prototype.isImmune = function (now) { return now < this.immuneUntil; };
  StatusSet.prototype.immunityLeft = function (now) { return Math.max(0, this.immuneUntil - now); };

  /** Expire anything due. Natural expiry of a negative effect grants immunity. */
  StatusSet.prototype.update = function (now) {
    var grant = false;
    for (var kind in this.effects) {
      var e = this.effects[kind];
      if (now < e.until) continue;
      delete this.effects[kind];
      this.lastEnded[kind] = { at: e.until, reason: "expired" };
      if (KINDS[kind].negative) grant = true;
      if (this.opts.onEnd) this.opts.onEnd(kind, "expired", e);
    }
    // Immunity starts once the LAST active negative effect has gone.
    if (grant && !this.anyNegative()) {
      this.immuneFrom = now;
      this.immuneUntil = now + this.immunityMs;
    }
  };

  StatusSet.prototype.anyNegative = function () {
    for (var k in this.effects) if (KINDS[k].negative) return true;
    return false;
  };

  /** End everything immediately (goal reset / match end / exit). No immunity. */
  StatusSet.prototype.clear = function () {
    for (var kind in this.effects) {
      var e = this.effects[kind];
      delete this.effects[kind];
      this.lastEnded[kind] = { at: -Infinity, reason: "cleared" };
      if (this.opts.onEnd) this.opts.onEnd(kind, "cleared", e);
    }
    this.immuneUntil = 0;
    this.immuneFrom = 0;
  };

  /** Active kinds, in a stable display order. */
  StatusSet.prototype.list = function () {
    var out = [];
    for (var k in KINDS) if (this.effects[k]) out.push(this.effects[k]);
    return out;
  };

  ESA.StatusEffects = {
    IMMUNITY_MS: IMMUNITY_MS,
    KINDS: KINDS,
    label: function (kind) { return KINDS[kind] ? KINDS[kind].label : String(kind).toUpperCase(); },
    StatusSet: StatusSet,
    create: function (opts) { return new StatusSet(opts); }
  };

})(window.ESA);
