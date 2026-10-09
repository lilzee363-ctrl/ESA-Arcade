/* ==========================================================================
   ESA ARCADE - PARTICIPANTS
   A PARTICIPANT is a person in the current arcade session. A CHARACTER is
   the permanent roster art (js/characters.js). They are NOT the same thing:

     participant-03  roster  Zima, Normal       -> avatar "zima"
     participant-04  roster  Zima, Evil         -> avatar "zima~evil"
     participant-05  guest   "OMAR" + appearance -> avatar "guest~participant-05"

   participantId is the ONLY competitive identity: fixtures, standings,
   brackets and match setups ({ p1, p2 }) all carry participantIds, so
   Normal Zima and Evil Zima are two completely separate players.

   Participant shape
     participantId    "participant-07" - unique, never reused this session
     type             "roster" | "guest"
     displayName      "Zima" | "Evil Zima" | the guest's nickname
     characterId      base roster id ("zima") | null for guests
     variant          "normal" | "evil" | null for guests
     guestAppearance  null | { skin, hair, hairColor, wearColor, top, topColor,
                               bottomColor, accessory } (see js/guests.js)

   Uniqueness: the session holds at most ONE participant per exact roster
   variant (forVariant() finds-or-creates it), so "Normal Zima x4" cannot
   exist. Anyone else plays as a Guest; every Guest gets its own id.

   Storage: the session pool lives in sessionStorage only (survives a
   refresh, gone when the tab closes). Nothing here is ever written to
   localStorage - Guests are temporary by design.

   GUEST FACE PHOTOS (V4.1, optional): guestPhoto is a small square JPEG
   data URL made ON THIS DEVICE by the Guest creator (js/guests.js) - it
   is never uploaded, sent to any service or written to localStorage. It
   lives in this participant object and, only while it is small
   (<= PHOTO_MAX_CHARS, ~45 KB), in the same sessionStorage session entry,
   so it also disappears when the tab closes. Too big / storage full: it
   simply stays in memory for this page only.

   AVATARS (ESA.Avatars) are the VISUAL side, keyed by avatar id. Games
   only ever see avatars (player.character) and never need to know about
   variants or the Guest creator. A roster entry IS its Normal avatar; an
   Evil avatar inherits from it (same trim, spriteH, PNG files), so the two
   are mechanically identical.

   CPU OPPONENTS (Solo) are participants too, but in their own namespace:
     cpu-airhockey-hard-03  cpu  Saif, Normal, hard -> avatar "saif"
   addCpu() creates one; it lives in memory only, never appears in list()
   or a roster, is never saved, and its id can never equal a human
   participant-NN id. It resolves / describes like any other participant,
   so games, the HUD and results need no CPU-specific code.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var STORE_KEY = "esaArcade.session.v1";
  var VARIANTS = ["normal", "evil"];
  var NAME_MAX = 16;
  var PHOTO_MAX_CHARS = 60000;
  var PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+\/=]+$/;
  function cleanPhoto(s) { return typeof s === "string" && s.length <= PHOTO_MAX_CHARS * 2 && PHOTO_RE.test(s) ? s : null; }

  var pool = Object.create(null);      // participantId -> participant
  var order = [];                      // live (not removed) participantIds
  var seq = 0;                         // participant-NN counter
  var guestSeq = 0;                    // "Guest N" fallback counter
  var loaded = false;
  var cpuPool = Object.create(null);   // cpu participantId -> participant (memory only)
  var cpuSeq = 0;

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function nextId() {
    var id;
    do { seq++; id = "participant-" + pad2(seq); } while (pool[id]);
    return id;
  }

  /* ------------------------------------------------------------------ *
   * Nicknames are TEXT. They are only ever rendered via textContent or
   * ESA.esc(); here we also strip control / bidi-override characters
   * (layout safety) and cap the length by code point (Arabic-safe).
   * ------------------------------------------------------------------ */
  var STRIP = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿<>]/g;
  function cleanName(s) {
    s = String(s == null ? "" : s).replace(STRIP, "").replace(/\s+/g, " ").trim();
    var chars = Array.from(s);
    if (chars.length > NAME_MAX) s = chars.slice(0, NAME_MAX).join("").trim();
    return s;
  }

  function variantName(c, variant) {
    return variant === "evil" ? "Evil " + c.displayName : c.displayName;
  }

  /* ------------------------------------------------------------------ *
   * Session persistence (sessionStorage only; failures are harmless).
   * ------------------------------------------------------------------ */
  function save() {
    var data = {
      v: 1, seq: seq, guestSeq: guestSeq,
      list: order.map(function (id) {
        var p = pool[id];
        return {
          participantId: p.participantId, type: p.type,
          characterId: p.characterId, variant: p.variant,
          displayName: p.type === "guest" ? p.displayName : undefined,
          guestNumber: p.guestNumber || undefined,
          guestAppearance: p.guestAppearance,
          // Session-only, and only while small (see GUEST FACE PHOTOS).
          guestPhoto: p.guestPhoto && p.guestPhoto.length <= PHOTO_MAX_CHARS ? p.guestPhoto : undefined
        };
      })
    };
    try { window.sessionStorage.setItem(STORE_KEY, JSON.stringify(data)); }
    catch (e) {
      // Quota: retry without photos (they stay in memory for this page).
      try {
        data.list.forEach(function (d) { delete d.guestPhoto; });
        window.sessionStorage.setItem(STORE_KEY, JSON.stringify(data));
      } catch (e2) { /* private mode etc. */ }
    }
  }

  function load() {
    if (loaded) return;
    loaded = true;
    var raw = null;
    try { raw = window.sessionStorage.getItem(STORE_KEY); } catch (e) { return; }
    if (!raw) return;
    var data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !Array.isArray(data.list)) return;
    seq = Math.max(0, Math.min(9999, data.seq | 0));
    guestSeq = Math.max(0, Math.min(9999, data.guestSeq | 0));
    data.list.forEach(function (d) {
      if (!d || typeof d.participantId !== "string" || !/^participant-\d{2,4}$/.test(d.participantId)) return;
      if (pool[d.participantId]) return;
      if (d.type === "roster") {
        var c = ESA.Characters.get(d.characterId);
        var v = VARIANTS.indexOf(d.variant) >= 0 ? d.variant : null;
        if (!c || !v || find(c.id, v)) return;
        adopt(makeRoster(d.participantId, c, v));
      } else if (d.type === "guest") {
        var name = cleanName(d.displayName) || ("Guest " + Math.max(1, d.guestNumber | 0));
        var app = ESA.Guests ? ESA.Guests.sanitize(d.guestAppearance) : null;
        if (!app) return;
        adopt(makeGuest(d.participantId, name, app, Math.max(0, d.guestNumber | 0), cleanPhoto(d.guestPhoto)));
      }
    });
  }

  function adopt(p) {
    pool[p.participantId] = p;
    order.push(p.participantId);
    return p;
  }

  function makeRoster(id, c, variant) {
    return {
      participantId: id,
      type: "roster",
      displayName: variantName(c, variant),
      characterId: c.id,
      variant: variant,
      guestAppearance: null
    };
  }

  function makeGuest(id, name, appearance, number, photo) {
    return {
      participantId: id,
      type: "guest",
      displayName: name,
      characterId: null,
      variant: null,
      guestAppearance: appearance,
      guestPhoto: photo || null,
      guestNumber: number || 0
    };
  }

  function find(characterId, variant) {
    for (var i = 0; i < order.length; i++) {
      var p = pool[order[i]];
      if (p.type === "roster" && p.characterId === characterId && p.variant === variant) return p;
    }
    return null;
  }

  function nameTaken(name, exceptId) {
    var key = name.toLowerCase();
    var taken = order.some(function (id) {
      return id !== exceptId && pool[id].displayName.toLowerCase() === key;
    });
    if (taken) return true;
    // A guest called "Zima" would be indistinguishable from roster Zima.
    return ESA.Characters.list().some(function (c) {
      return VARIANTS.some(function (v) { return variantName(c, v).toLowerCase() === key; });
    });
  }

  /** "Omar" -> "Omar" or, if that name is already in the session, "Omar 2". */
  function uniqueName(name, exceptId) {
    if (!nameTaken(name, exceptId)) return name;
    for (var n = 2; n < 100; n++) {
      var suffix = " " + n;
      var base = Array.from(name).slice(0, NAME_MAX - suffix.length).join("").trim();
      if (!nameTaken(base + suffix, exceptId)) return base + suffix;
    }
    return name;
  }

  /* ================================================================== *
   * Public API
   * ================================================================== */
  var P = {
    VARIANTS: VARIANTS.slice(),
    NAME_MAX: NAME_MAX,

    /** Max ACTIVE participants in one tournament / session roster. */
    get MAX_ACTIVE() { return (ESA.Tournament && ESA.Tournament.MAX_PARTICIPANTS) || 25; },

    get: function (id) { load(); return pool[id] || null; },

    /** Live session participants (roster variants first used + guests). */
    list: function () { load(); return order.map(function (id) { return pool[id]; }); },

    guests: function () {
      return this.list().filter(function (p) { return p.type === "guest"; });
    },

    /** Existing participant for an exact roster variant, or null. */
    findVariant: function (characterId, variant) { load(); return find(characterId, variant); },

    /** THE participant for an exact roster variant (created on first use). */
    forVariant: function (characterId, variant) {
      load();
      var c = ESA.Characters.get(characterId);
      if (!c) return null;
      variant = variant === "evil" ? "evil" : "normal";
      var p = find(c.id, variant);
      if (p) return p;
      p = adopt(makeRoster(nextId(), c, variant));
      save();
      return p;
    },

    /** Label for a roster variant without creating a participant. */
    variantName: function (characterId, variant) {
      var c = ESA.Characters.get(characterId);
      return c ? variantName(c, variant) : "";
    },

    /** Next automatic guest label, e.g. "Guest 3". */
    nextGuestLabel: function () { load(); return "Guest " + (guestSeq + 1); },

    /**
     * Adds a temporary Guest. `nickname` may be blank (-> "Guest N").
     * `appearance` is sanitised against the Guest creator's parts.
     */
    addGuest: function (nickname, appearance, photo) {
      load();
      var app = ESA.Guests ? ESA.Guests.sanitize(appearance) : null;
      if (!app) return null;
      guestSeq++;
      var name = cleanName(nickname) || ("Guest " + guestSeq);
      var id = nextId();
      var p = adopt(makeGuest(id, uniqueName(name, id), app, guestSeq, cleanPhoto(photo)));
      save();
      return p;
    },

    /** Replace (data URL) or remove (null) a Guest's face photo - same Guest. */
    setGuestPhoto: function (id, photo) {
      load();
      var p = pool[id];
      if (!p || p.type !== "guest") return false;
      p.guestPhoto = photo ? cleanPhoto(photo) : null;
      if (ESA.Guests) ESA.Guests.refresh(p);    // rebuild only the cached art
      save();
      return true;
    },

    /** Removes a Guest from the session. Objects stay resolvable in memory
        so a setup that still references them never breaks mid-flow. */
    removeGuest: function (id) {
      load();
      var p = pool[id];
      if (!p || p.type !== "guest") return false;
      var i = order.indexOf(id);
      if (i >= 0) order.splice(i, 1);
      p.removed = true;
      if (ESA.Guests) ESA.Guests.forget(p);     // cached art + avatar registration
      p.guestPhoto = null;                      // the face photo is gone from memory too
      save();                                   // ...and from the sessionStorage entry
      return true;
    },

    /** Clears every Guest (a genuinely new session). Touch-control and
        sound preferences live in localStorage and are NOT affected. */
    clearGuests: function () {
      this.guests().forEach(function (p) { this.removeGuest(p.participantId); }, this);
      guestSeq = 0;
      save();
    },

    cleanName: cleanName,

    /**
     * A CPU opponent drawn as a roster character. `tag` names the game
     * ("airhockey"), `difficulty` is "easy" | "normal" | "hard". The
     * character never affects difficulty - that is AI behaviour only.
     */
    addCpu: function (characterId, variant, difficulty, tag) {
      var c = ESA.Characters.get(characterId);
      if (!c) return null;
      variant = variant === "evil" ? "evil" : "normal";
      cpuSeq++;
      var id = "cpu-" + String(tag || "game").toLowerCase().replace(/[^a-z0-9]/g, "") + "-" +
               (difficulty || "normal") + "-" + pad2(cpuSeq);
      var p = {
        participantId: id,
        type: "cpu",
        displayName: variantName(c, variant),
        characterId: c.id,
        variant: variant,
        difficulty: difficulty || "normal",
        guestAppearance: null
      };
      cpuPool[id] = p;
      return p;
    },

    isCpu: function (ref) { var p = this.resolve(ref); return !!p && p.type === "cpu"; },

    /**
     * Resolves anything a setup might carry to a participant:
     * a participant, a participantId, or (legacy / migration) a plain
     * character id ("zima" -> Normal Zima, "zima~evil" -> Evil Zima).
     */
    resolve: function (ref) {
      load();
      if (!ref) return null;
      if (typeof ref === "object") return ref.participantId ? ref : null;
      if (pool[ref]) return pool[ref];
      if (cpuPool[ref]) return cpuPool[ref];
      var m = /^(.+)~evil$/.exec(ref);
      if (m && ESA.Characters.get(m[1])) return this.forVariant(m[1], "evil");
      if (ESA.Characters.get(ref)) return this.forVariant(ref, "normal");
      return null;
    },

    /** Visual avatar for a participant (games, menus, VS, tournament UI). */
    avatar: function (ref) {
      var p = this.resolve(ref);
      if (!p) return null;
      if (p.type === "guest") return ESA.Guests ? ESA.Guests.avatarFor(p) : null;
      return ESA.Avatars.forVariant(p.characterId, p.variant);
    },

    /** Uniqueness key: same key = same identity on a roster. */
    identityKey: function (ref) {
      var p = this.resolve(ref);
      if (!p) return "";
      if (p.type === "cpu") return "cpu:" + p.participantId;
      return p.type === "guest" ? "guest:" + p.participantId : p.characterId + ":" + p.variant;
    }
  };
  ESA.Participants = P;

  /** Escaped display name with the premium EVIL treatment for Evil variants. */
  ESA.nameHTML = function (ref) {
    var p = P.resolve(ref);
    if (!p) return "";
    if ((p.type === "roster" || p.type === "cpu") && p.variant === "evil") {
      var c = ESA.Characters.get(p.characterId);
      // One inline wrapper, so flex-column parents keep it on one line.
      return '<span class="evil-name"><span class="evil-word">Evil</span> ' + ESA.esc(c ? c.displayName : p.displayName) + "</span>";
    }
    return ESA.esc(p.displayName);
  };

  /* ================================================================== *
   * AVATARS - visual resolver shared by DOM and canvas.
   * ================================================================== */
  var avatars = Object.create(null);

  function hexToRgb(h) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(h || ""));
    if (!m) return [192, 135, 31];
    var n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(a, b, t) {
    var x = hexToRgb(a), y = hexToRgb(b);
    var c = x.map(function (v, i) { return Math.round(v + (y[i] - v) * t); });
    return "#" + c.map(function (v) { return (v < 16 ? "0" : "") + v.toString(16); }).join("");
  }
  ESA.mixColor = mix;

  function makeEvil(base) {
    // Inherits EVERYTHING (art paths, trim, spriteH, ui, slots) from the
    // registry entry - only identity and presentation fields differ.
    var a = Object.create(base);
    a.id = base.id + "~evil";
    a.baseId = base.id;
    a.variant = "evil";
    a.evil = true;
    a.displayName = variantName(base, "evil");
    a.name = a.displayName;
    a.color = mix(base.color, "#c0142f", 0.55);
    a.colorDeep = mix(base.colorDeep, "#2a0510", 0.55);
    a.tagline = "Same face. Worse intentions.";
    return a;
  }

  ESA.Avatars = {
    /** Avatar by key: "zima" (the registry entry), "zima~evil", "guest~...". */
    get: function (key) {
      if (!key) return null;
      if (typeof key === "object") return key;
      if (avatars[key]) return avatars[key];
      var c = ESA.Characters.get(key);
      if (c) return c;
      var m = /^(.+)~evil$/.exec(key);
      if (m) {
        var base = ESA.Characters.get(m[1]);
        if (base) return (avatars[key] = makeEvil(base));
      }
      return null;
    },

    forVariant: function (characterId, variant) {
      return this.get(variant === "evil" ? characterId + "~evil" : characterId);
    },

    /** Guests register their generated avatar here. */
    register: function (a) { if (a && a.id) avatars[a.id] = a; },
    forget: function (key) { delete avatars[key]; }
  };

  /* ================================================================== *
   * Who is playing a match. setup = { p1, p2 } of participantIds (plain
   * character ids are still accepted and resolve to Normal variants).
   * If both sides would show the same colour, P2 takes its slot colour so
   * the two can always be told apart.
   * ================================================================== */
  ESA.describeMatchup = function (setup) {
    // A Score Attack run has no P2 at all: { p1 } only. p2 then describes
    // nobody (character null) and `single` is true.
    var single = !setup.p2;
    var a = P.resolve(setup.p1), b = single ? null : P.resolve(setup.p2);
    var c1 = P.avatar(a), c2 = P.avatar(b);
    var mirror = !!(a && b && a.participantId === b.participantId);
    var sameColour = mirror || (c1 && c2 && c1.color === c2.color);
    function side(slot, p, c, other) {
      var name = p ? p.displayName : "?";
      return {
        slot: slot,
        participant: p,
        participantId: p ? p.participantId : null,
        character: c,
        name: mirror ? name + " " + slot.toUpperCase() : name,
        color: slot === "p2" && sameColour ? ESA.CONTROLS.p2.color : (c ? c.color : "#c0871f")
      };
    }
    return { mirror: mirror, single: single, p1: side("p1", a, c1), p2: side("p2", b, c2) };
  };

})(window.ESA);
