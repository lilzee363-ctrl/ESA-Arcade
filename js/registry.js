/* ==========================================================================
   ESA ARCADE - GAME REGISTRY
   Every minigame registers itself here (see the bottom of each game file).
   The Game Library, the intro screen, the HUD and the Tournament game draw
   all read from this list, so a new game needs no menu or tournament code.

   ADDING A NEW GAME
   -----------------
   1. Write js/yourgame.js with a constructor  function YourGame(api, setup)
      exposing start(), update(dt, now), draw(ctx, now), destroy() and an
      optional onKeyDown(code). `setup` is { p1: characterId, p2: characterId }.
      When the match ends call api.endMatch(result) ONCE, where result is
        { winner: "p1" | "p2" | null, scores: { p1, p2 }, kicker, title, text }
   2. At the bottom of that file call ESA.Games.register({...}).
   3. Add a <script> tag for it in index.html (before js/app.js).
   ========================================================================== */

(function (ESA) {
  "use strict";

  var games = [];
  var byId = Object.create(null);

  ESA.Games = {
    /**
     *   id                  unique key
     *   title               display name
     *   tagline             one-line pitch for the library card
     *   description         longer rules text (HTML allowed: <b>)
     *   mode                short format label, e.g. "60 seconds"
     *   icon                { symbol: "#svgSymbolId" } or { img: "path.png" }
     *   controls            control scheme: "arena" | "booth"
     *   hud                 { centerLabel, centerValue, pips }
     *   accent              CSS colour for the cabinet theme
     *   canTie              true if the game can end level
     *   tournamentEligible  enters the Tournament game draw
     *   enabled             false hides it everywhere
     *   create(api, setup)  returns a new game instance
     */
    register: function (def) {
      if (!def || !def.id || byId[def.id] || typeof def.create !== "function") {
        console.warn("[ESA] Game skipped (missing id/create or duplicate):", def && def.id);
        return;
      }
      var g = {
        id: def.id,
        title: def.title || def.id,
        tagline: def.tagline || "",
        description: def.description || "",
        mode: def.mode || "",
        icon: def.icon || { img: "assets/Branding/Golden Canadian Pharaoh Emblem.png" },
        controls: def.controls || "arena",
        hud: def.hud || { centerLabel: "", centerValue: "", pips: 0 },
        accent: def.accent || "#f3c35a",
        canTie: !!def.canTie,
        tournamentEligible: def.tournamentEligible !== false,
        enabled: def.enabled !== false,
        create: def.create
      };
      games.push(g);
      byId[g.id] = g;
    },

    get: function (id) { return byId[id] || null; },

    /** Enabled games in registration order. */
    list: function () {
      return games.filter(function (g) { return g.enabled; });
    },

    /** Games allowed into the tournament draw. */
    tournamentPool: function () {
      return games.filter(function (g) { return g.enabled && g.tournamentEligible; });
    },

    /** Markup for a game's icon - used by library cards, intro and draw. */
    iconHTML: function (g) {
      if (g.icon && g.icon.symbol) {
        return '<svg class="art-move" viewBox="0 0 100 100" aria-hidden="true"><use href="' +
               g.icon.symbol + '" /></svg>';
      }
      var src = (g.icon && g.icon.img) || "assets/Branding/Golden Canadian Pharaoh Emblem.png";
      return '<img class="art-move" src="' + src + '" alt="" />';
    }
  };

})(window.ESA);
