/* ==========================================================================
   ESA ARCADE - GUESTS
   Temporary participants for anyone not on the permanent roster.

   ART       A small chibi fighter built from reusable SVG layers (back
             hair -> legs -> body + top -> head -> face -> hair / headwear
             -> accessory). One generator draws BOTH states from the same
             appearance: "hurt" only swaps the face (squeezed eyes, wobbly
             mouth, bruise, sweat), tilts the body and adds dizzy stars -
             the same clothes / hair / skin stay. No image files, no
             network, no external services.
   DOM       <img src="data:image/svg+xml,...">  (crisp at any size).
   CANVAS    Rasterised ONCE per guest + state into a small canvas (cached,
             capped at a few guests); games draw it like any sprite.
   FAIRNESS  Every guest has the SAME fixed art box (212 x 392 inside the
             264 x 400 art, roster-like proportions) and the default spriteH, so hair, hats
             and accessories can never change a hitbox, collider, reach or
             speed. Customisation is visual only.
   SESSION   Appearances are plain enum indices, sanitised on every load.
             Nothing here touches localStorage (see js/participants.js).
   PHOTO     (V4.1, optional) "Use my photo": the player picks / takes a
             photo, positions + zooms it in a round crop, and it is
             resized ON THIS DEVICE to a 256x256 JPEG that becomes the
             guest's FACE - masked into the head of the same stylised
             body, clothes and colours. No upload, no network, no AI, no
             accounts: the file is read with a local object URL, drawn to
             a canvas and the original is released straight away. The
             hurt state reuses the SAME face with comic overlays (tilt,
             dizzy stars, sweat, a plaster). Session-only (see
             js/participants.js). Glasses / shades are not drawn over a
             real face; hats, hijab, headphones and chains still are.
   ========================================================================== */

(function (ESA) {
  "use strict";

  var W = 264, H = 400;
  var OUT = "#1c1310";

  /* ------------------------------------------------------------------ *
   * Parts
   * ------------------------------------------------------------------ */
  var SKIN = [
    { c: "#f7d8bf", name: "Fair" }, { c: "#eebf98", name: "Light" }, { c: "#d9a173", name: "Tan" },
    { c: "#bd8152", name: "Bronze" }, { c: "#93603a", name: "Brown" }, { c: "#62402a", name: "Deep" }
  ];
  var HAIR_COLORS = [
    { c: "#1d1613", name: "Black" }, { c: "#3a2418", name: "Dark brown" }, { c: "#6a4227", name: "Brown" },
    { c: "#9b5a2e", name: "Auburn" }, { c: "#d9b061", name: "Blonde" }, { c: "#a9a39b", name: "Silver" }
  ];
  var FABRIC = [
    { c: "#262d42", name: "Midnight" }, { c: "#f0ebe0", name: "White" }, { c: "#d6403a", name: "Red" },
    { c: "#2f7fd8", name: "Blue" }, { c: "#2fb39a", name: "Teal" }, { c: "#7b6cf0", name: "Violet" },
    { c: "#e8b04a", name: "Gold" }, { c: "#ff8fb1", name: "Pink" }, { c: "#56803e", name: "Olive" },
    { c: "#8a5a3a", name: "Brown" }
  ];
  var PANTS = [
    { c: "#262d42", name: "Midnight" }, { c: "#2e4a78", name: "Denim" }, { c: "#c8b088", name: "Khaki" },
    { c: "#62676f", name: "Grey" }, { c: "#efe9dc", name: "Cream" }, { c: "#56803e", name: "Olive" }
  ];
  var HAIR = [
    { id: "short", name: "Short" }, { id: "curly", name: "Curly" }, { id: "long", name: "Long" },
    { id: "bun", name: "Bun" }, { id: "spiky", name: "Spiky" }, { id: "buzz", name: "Buzz" },
    { id: "hijab", name: "Hijab", wear: true }, { id: "cap", name: "Cap", wear: true },
    { id: "beanie", name: "Beanie", wear: true }
  ];
  var TOPS = [
    { id: "tee", name: "Tee" }, { id: "hoodie", name: "Hoodie" },
    { id: "jersey", name: "Jersey" }, { id: "jacket", name: "Jacket" }
  ];
  var EXTRAS = [
    { id: "none", name: "None" }, { id: "glasses", name: "Glasses" }, { id: "shades", name: "Shades" },
    { id: "headphones", name: "Headphones" }, { id: "chain", name: "Chain" }
  ];

  function ids(list) { return list.map(function (x) { return x.id; }); }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return list[0]; }
  function idx(v, n, d) { v = Number(v); return isFinite(v) && v >= 0 && v < n && Math.floor(v) === v ? v : d; }

  /** Anything (e.g. from sessionStorage) -> a valid appearance, or null. */
  function sanitize(a) {
    if (!a || typeof a !== "object") return null;
    return {
      skin: idx(a.skin, SKIN.length, 2),
      hair: ids(HAIR).indexOf(a.hair) >= 0 ? a.hair : "short",
      hairColor: idx(a.hairColor, HAIR_COLORS.length, 0),
      wearColor: idx(a.wearColor, FABRIC.length, 0),
      top: ids(TOPS).indexOf(a.top) >= 0 ? a.top : "tee",
      topColor: idx(a.topColor, FABRIC.length, 3),
      bottomColor: idx(a.bottomColor, PANTS.length, 0),
      accessory: ids(EXTRAS).indexOf(a.accessory) >= 0 ? a.accessory : "none"
    };
  }

  function rint(n) { return Math.floor(Math.random() * n); }

  /** A valid random appearance from the same parts as the creator. */
  function randomAppearance() {
    var a = {
      skin: rint(SKIN.length),
      hair: HAIR[rint(HAIR.length)].id,
      hairColor: rint(HAIR_COLORS.length),
      wearColor: rint(FABRIC.length),
      top: TOPS[rint(TOPS.length)].id,
      topColor: rint(FABRIC.length),
      bottomColor: rint(PANTS.length),
      // Accessories are a treat, not the default.
      accessory: Math.random() < 0.45 ? "none" : EXTRAS[1 + rint(EXTRAS.length - 1)].id
    };
    // Keep the top and trousers readable against each other.
    if (FABRIC[a.topColor].c === PANTS[a.bottomColor].c) a.bottomColor = (a.bottomColor + 1) % PANTS.length;
    if (a.hair === "hijab" && a.accessory === "headphones") a.accessory = "none";
    return a;
  }

  /* ------------------------------------------------------------------ *
   * SVG generator
   * ------------------------------------------------------------------ */
  function shade(c, t) { return ESA.mixColor(c, "#000000", t); }
  function tint(c, t) { return ESA.mixColor(c, "#ffffff", t); }
  function path(d, fill, extra) { return '<path d="' + d + '" fill="' + fill + '"' + (extra || "") + "/>"; }
  var NOSTROKE = ' stroke="none"';

  function star(cx, cy, r) {
    var d = "";
    for (var i = 0; i < 10; i++) {
      var a = -Math.PI / 2 + i * Math.PI / 5;
      var rr = i % 2 ? r * 0.45 : r;
      d += (i ? "L" : "M") + (cx + Math.cos(a) * rr).toFixed(1) + " " + (cy + Math.sin(a) * rr).toFixed(1);
    }
    return path(d + "Z", "#ffd34d", ' stroke-width="3"');
  }

  var CURLS = [[66, 112, 20], [62, 86, 20], [76, 64, 22], [98, 50, 22], [124, 44, 23], [150, 46, 22],
               [174, 56, 22], [194, 74, 21], [204, 98, 20], [200, 120, 17], [80, 104, 16], [92, 84, 20],
               [116, 76, 20], [142, 74, 20], [168, 82, 20], [186, 100, 16]];

  function hairBack(a, hc) {
    switch (a.hair) {
      case "long":
        return path("M58 120Q52 36 132 32Q212 36 206 120L214 246Q196 260 178 248L172 172L92 172L86 248Q68 260 50 246Z", hc);
      case "curly": case "spiky":
        return path("M60 132Q52 40 132 34Q212 40 204 132Z", hc);
      case "bun":
        return '<circle cx="132" cy="40" r="22" fill="' + hc + '"/>' +
               path("M118 30Q132 24 146 30", "none", ' stroke="' + tint(hc, 0.3) + '" stroke-width="4"');
      default: return "";
    }
  }

  function shortFront(hc) {
    return path("M64 132Q58 62 132 54Q206 62 200 132Q194 102 172 94Q150 108 120 98Q92 102 82 112Q70 118 64 132Z", hc) +
           path("M98 72Q120 62 146 66", "none", ' stroke="' + tint(hc, 0.28) + '" stroke-width="4"');
  }

  function hairFront(a, hc, wc) {
    var hl = tint(hc, 0.28);
    switch (a.hair) {
      case "short": case "bun": return shortFront(hc);
      case "curly":
        return CURLS.map(function (c) {
          return '<circle cx="' + c[0] + '" cy="' + c[1] + '" r="' + c[2] + '" fill="' + hc + '" stroke-width="3.5"/>';
        }).join("") +
        [[92, 76], [124, 38], [170, 50], [72, 60], [196, 92]].map(function (p) {
          return path("M" + (p[0] - 6) + " " + (p[1] + 2) + "Q" + p[0] + " " + (p[1] - 6) + " " + (p[0] + 7) + " " + p[1],
                      "none", ' stroke="' + hl + '" stroke-width="3"');
        }).join("");
      case "long":
        return path("M62 134Q60 50 132 46Q204 50 202 134Q186 90 140 84Q132 98 124 84Q78 90 62 134Z", hc) +
               path("M86 70Q104 58 122 58", "none", ' stroke="' + hl + '" stroke-width="4"');
      case "spiky":
        return path("M62 128L56 96L74 104L70 70L94 84L96 50L116 72L130 40L144 70L164 48L168 82L192 66L190 100L208 94L202 128Q190 104 168 98Q132 110 96 98Q74 104 62 128Z", hc);
      case "buzz":
        return path("M66 122Q64 60 132 56Q200 60 198 122Q186 92 132 88Q78 92 66 122Z", hc, ' stroke-width="3"');
      case "cap":
        return shortFront(hc) +
          path("M62 116Q60 46 132 44Q204 46 202 116Z", wc) +
          path("M150 52Q176 62 186 90", "none", ' stroke="' + tint(wc, 0.25) + '" stroke-width="4"') +
          path("M58 114Q132 96 216 114Q226 126 206 130Q132 116 60 126Z", shade(wc, 0.22)) +
          '<circle cx="132" cy="46" r="5" fill="' + shade(wc, 0.2) + '" stroke-width="3"/>';
      case "beanie":
        return shortFront(hc) +
          path("M60 122Q56 36 132 34Q208 36 204 122Z", wc) +
          path("M56 104Q132 90 208 104L208 130Q132 116 56 130Z", shade(wc, 0.18)) +
          [80, 100, 120, 140, 160, 180].map(function (x) {
            return path("M" + x + " " + (x < 132 ? 101 - (x - 56) * 0.05 : 98 + (x - 132) * 0.05) + "l0 22", "none",
                        ' stroke="' + shade(wc, 0.35) + '" stroke-width="2.5"');
          }).join("") +
          '<circle cx="132" cy="30" r="13" fill="' + tint(wc, 0.22) + '" stroke-width="3.5"/>';
      default: return "";
    }
  }

  function legs(a) {
    var pc = PANTS[a.bottomColor].c, sole = "#cfc7b8", shoe = "#f4f1ea", accent = FABRIC[a.topColor].c;
    return path("M80 294L184 294L182 370L136 370L132 318L128 370L84 370Z", pc) +
      path("M96 300L100 366", "none", ' stroke="' + shade(pc, 0.25) + '" stroke-width="3"') +
      path("M76 380Q76 362 98 362L116 362Q130 364 130 378Q130 392 116 392L84 392Q76 392 76 380Z", shoe) +
      path("M188 380Q188 362 166 362L148 362Q134 364 134 378Q134 392 148 392L180 392Q188 392 188 380Z", shoe) +
      path("M80 386L126 386M138 386L184 386", "none", ' stroke="' + sole + '" stroke-width="3"') +
      path("M90 371L112 371M152 371L174 371", "none", ' stroke="' + accent + '" stroke-width="5"');
  }

  function body(a, sk) {
    var tc = FABRIC[a.topColor].c, dk = shade(tc, 0.2), skd = shade(sk, 0.18);
    var longSleeve = a.top === "hoodie" || a.top === "jacket";
    var out = "";
    // Arms (behind the torso edge).
    [[1, 0], [-1, W]].forEach(function (m) {
      var X = function (x) { return m[0] > 0 ? x : W - x; };
      var P = function (pts) { return pts.map(function (p, i) { return (i ? "L" : "M") + X(p[0]) + " " + p[1]; }).join("") + "Z"; };
      if (longSleeve) {
        out += path("M" + X(82) + " 222Q" + X(60) + " 232 " + X(54) + " 270L" + X(52) + " 290L" + X(78) + " 292L" +
                    X(82) + " 262Q" + X(86) + " 246 " + X(96) + " 238Z", tc);
        out += path("M" + X(52) + " 282L" + X(78) + " 285", "none", ' stroke="' + dk + '" stroke-width="4"');
      } else {
        out += path(P([[58, 254], [52, 290], [78, 292], [82, 258]]), sk);
        out += path("M" + X(82) + " 222Q" + X(62) + " 230 " + X(57) + " 258L" + X(85) + " 262Q" + X(88) + " 246 " +
                    X(96) + " 238Z", tc);
        if (a.top === "jersey") out += path("M" + X(58) + " 250L" + X(85) + " 254", "none", ' stroke="#f0ebe0" stroke-width="4"');
      }
      out += '<circle cx="' + X(65) + '" cy="296" r="15" fill="' + sk + '"/>';
    });
    // Neck, then torso.
    out += path("M114 192L150 192L150 222L114 222Z", skd);
    out += path("M74 240Q76 214 106 210L158 210Q188 214 190 240L186 304Q132 314 78 304Z", tc);
    out += path("M160 214Q188 216 190 240L186 304Q172 308 160 306Z", "#000", NOSTROKE + ' opacity=".14"');
    switch (a.top) {
      case "tee":
        out += path("M110 211Q132 228 154 211", "none", ' stroke="' + shade(tc, 0.35) + '" stroke-width="4"');
        break;
      case "hoodie":
        out += path("M90 216Q132 252 174 216L166 207Q132 236 98 207Z", dk);
        out += path("M121 228L118 258M143 228L146 258", "none", ' stroke="#f0ebe0" stroke-width="3"');
        out += path("M100 272L164 272L170 300L94 300Z", shade(tc, 0.12), ' stroke-width="3"');
        break;
      case "jersey":
        out += path("M110 210L132 238L154 210", "none", ' stroke="#f0ebe0" stroke-width="7"');
        out += path("M110 210L132 238L154 210", "none", ' stroke-width="2"');
        out += '<text x="132" y="292" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" ' +
               'font-size="34" fill="#f0ebe0" stroke="' + OUT + '" stroke-width="2">10</text>';
        break;
      case "jacket":
        out += path("M118 210L146 210L144 306L120 307Z", "#f0ebe0");
        out += path("M118 212L121 306M146 212L143 306", "none", ' stroke="' + dk + '" stroke-width="4"');
        out += path("M98 226L110 232M166 232L154 226", "none", ' stroke="' + dk + '" stroke-width="3"');
        break;
    }
    if (a.accessory === "chain") {
      out += path("M108 213Q132 254 156 213", "none", ' stroke="#e3b341" stroke-width="5"');
      out += '<circle cx="132" cy="240" r="7" fill="#f3c35a" stroke="#8e6314" stroke-width="2.5"/>';
    }
    return out;
  }

  function hijabDrape(wc) {
    return path("M44 150Q38 40 132 32Q226 40 220 150Q222 214 196 232Q160 250 132 250Q104 250 68 232Q42 214 44 150Z", wc) +
           path("M80 224Q132 246 184 224", "none", ' stroke="' + shade(wc, 0.25) + '" stroke-width="3"');
  }

  function face(a, sk, hc, hurt) {
    var skd = shade(sk, 0.22), out = "";
    if (a.hair !== "hijab") {
      out += '<ellipse cx="66" cy="142" rx="13" ry="17" fill="' + sk + '"/><ellipse cx="198" cy="142" rx="13" ry="17" fill="' + sk + '"/>';
      out += path("M62 136Q68 142 64 150M202 136Q196 142 200 150", "none", ' stroke="' + skd + '" stroke-width="3"');
    }
    out += '<ellipse cx="132" cy="134" rx="68" ry="72" fill="' + sk + '"/>';
    out += '<ellipse cx="96" cy="166" rx="11" ry="7" fill="#ff7d72" opacity=".32" stroke="none"/>' +
           '<ellipse cx="168" cy="166" rx="11" ry="7" fill="#ff7d72" opacity=".32" stroke="none"/>';
    out += path("M128 158Q132 165 137 159", "none", ' stroke="' + skd + '" stroke-width="3.5"');
    var brow = a.hair === "hijab" || a.hair === "cap" || a.hair === "beanie" ? "#2a1d16" : shade(hc, 0.1);
    if (!hurt) {
      out += path("M94 120Q107 112 121 119M143 119Q157 112 170 120", "none", ' stroke="' + brow + '" stroke-width="6"');
      [[108, 110], [156, 158]].forEach(function (e) {
        out += '<ellipse cx="' + e[0] + '" cy="142" rx="12" ry="14" fill="#fff" stroke-width="3"/>' +
               '<circle cx="' + e[1] + '" cy="145" r="8.5" fill="#3b2416" stroke="none"/>' +
               '<circle cx="' + e[1] + '" cy="146" r="4.5" fill="#0c0806" stroke="none"/>' +
               '<circle cx="' + (e[1] + 3) + '" cy="141" r="2.8" fill="#fff" stroke="none"/>';
      });
      out += path("M117 177Q132 194 147 177Q132 184 117 177Z", "#8a2c24", ' stroke-width="3"');
    } else {
      out += path("M94 124Q106 118 120 112M144 112Q158 118 170 124", "none", ' stroke="' + brow + '" stroke-width="6"');
      out += path("M98 134L118 143L98 152M166 134L146 143L166 152", "none", ' stroke-width="5"');
      out += path("M114 184Q122 172 130 181Q138 172 150 184Q140 198 132 193Q124 198 114 184Z", "#7a1f1a", ' stroke-width="3"');
      out += path("M120 180L144 180", "none", ' stroke="#fff" stroke-width="3" opacity=".9"');
      out += path("M168 156L178 150M170 164L182 158", "none", ' stroke="#e0453a" stroke-width="3"');
      out += path("M196 84Q187 100 196 107Q205 100 196 84Z", "#8fd3ff", ' stroke-width="2.5"');
    }
    return out;
  }

  function extras(a, hurt) {
    var tc = FABRIC[a.topColor].c, out = "";
    switch (a.accessory) {
      case "glasses":
        out += '<circle cx="108" cy="142" r="19" fill="#fff" fill-opacity=".12" stroke-width="4"/>' +
               '<circle cx="156" cy="142" r="19" fill="#fff" fill-opacity=".12" stroke-width="4"/>' +
               path("M127 140Q132 136 137 140M89 138L70 134M175 138L194 134", "none", ' stroke-width="4"');
        break;
      case "shades":
        out += '<g' + (hurt ? ' transform="rotate(9 132 142)"' : "") + ">" +
          path("M88 130Q88 126 92 126L124 126Q128 126 127 132L124 150Q122 158 112 158L100 158Q90 158 89 150Z", "#15121a", ' stroke-width="3.5"') +
          path("M176 130Q176 126 172 126L140 126Q136 126 137 132L140 150Q142 158 152 158L164 158Q174 158 175 150Z", "#15121a", ' stroke-width="3.5"') +
          path("M127 132Q132 129 137 132M88 132L70 128M176 132L194 128", "none", ' stroke-width="4"') +
          path("M95 134L105 131M145 134L155 131", "none", ' stroke="#fff" stroke-width="3" opacity=".55"') + "</g>";
        break;
      case "headphones":
        out += path("M58 140Q54 28 132 26Q210 28 206 140", "none", ' stroke-width="13"') +
               path("M58 140Q54 28 132 26Q210 28 206 140", "none", ' stroke="' + tc + '" stroke-width="6"') +
               '<rect x="42" y="122" width="26" height="42" rx="11" fill="#2a2a33" stroke-width="3.5"/>' +
               '<rect x="196" y="122" width="26" height="42" rx="11" fill="#2a2a33" stroke-width="3.5"/>' +
               '<rect x="49" y="132" width="12" height="22" rx="6" fill="' + tc + '" stroke="none"/>' +
               '<rect x="203" y="132" width="12" height="22" rx="6" fill="' + tc + '" stroke="none"/>';
        break;
    }
    return out;
  }

  /**
   * The photo face: the cropped picture masked into the head oval, with an
   * outline so it sits in the cartoon like a sticker. Hurt: the SAME face,
   * a red flush, a sweat drop, a plaster and a crack in the frame.
   */
  function photoFace(photo, sk, hurt) {
    var out = '<ellipse cx="132" cy="134" rx="74" ry="80" fill="' + sk + '"/>' +
      '<image x="58" y="54" width="148" height="160" preserveAspectRatio="xMidYMid slice" clip-path="url(#gf)" ' +
      'href="' + photo + '" xlink:href="' + photo + '"/>' +
      '<ellipse cx="132" cy="134" rx="74" ry="80" fill="none" stroke-width="5"/>';
    if (hurt) {
      out += '<ellipse cx="132" cy="134" rx="74" ry="80" fill="#ff3b30" opacity=".16" stroke="none"/>' +
             path("M196 84Q187 100 196 107Q205 100 196 84Z", "#8fd3ff", ' stroke-width="2.5"') +
             '<g transform="rotate(-28 92 92)"><rect x="70" y="84" width="44" height="16" rx="6" fill="#f2c79b" stroke-width="3"/>' +
             '<path d="M86 88v8M98 88v8" stroke="#c99a6c" stroke-width="2"/></g>' +
             path("M190 168L176 178L186 186L172 200", "none", ' stroke-width="3.5"');
    }
    return out;
  }

  /** Full SVG markup for an appearance (`hurt` = the reaction state, `photo` = optional face). */
  function svg(a, hurt, photo) {
    var sk = SKIN[a.skin].c, hc = HAIR_COLORS[a.hairColor].c, wc = FABRIC[a.wearColor].c;
    var hijab = a.hair === "hijab";
    var wear = a.hair === "cap" || a.hair === "beanie";
    var fig;
    if (photo) {
      // Photo face: keep the body, clothes, headwear and hair FRAMING (long
      // hair, a hijab, a cap / beanie), never cartoon features over a face.
      var ph = { hair: a.hair === "long" ? "long" : "none", accessory: a.accessory === "glasses" || a.accessory === "shades" ? "none" : a.accessory,
                 topColor: a.topColor };
      fig = hairBack(ph, hc) + legs(a) + body(a, sk) + (hijab ? hijabDrape(wc) : "") +
            photoFace(photo, sk, hurt) +
            (hijab ? path("M58 112Q62 50 132 44Q202 50 206 112Q186 76 132 72Q78 76 58 112Z", wc)
                   : wear ? '<g transform="translate(0 -36)">' + hairFront({ hair: a.hair }, hc, wc).replace(shortFront(hc), "") + "</g>" : "") +
            extras(ph, hurt);
    } else {
      fig = hairBack(a, hc) + legs(a) + body(a, sk) + (hijab ? hijabDrape(wc) : "") +
            face(a, sk, hc, hurt) + (hijab ? path("M64 132Q66 70 132 64Q198 70 200 132Q186 98 132 94Q78 98 64 132Z", wc) : hairFront(a, hc, wc)) +
            extras(a, hurt);
    }
    var s = '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ' + W + " " + H + '" width="' + W + '" height="' + H + '">' +
            (photo ? '<defs><clipPath id="gf"><ellipse cx="132" cy="134" rx="74" ry="80"/></clipPath></defs>' : "") +
            '<g stroke="' + OUT + '" stroke-width="4.5" stroke-linejoin="round" stroke-linecap="round">';
    if (hurt) {
      s += '<g transform="rotate(-5 132 396)">' + fig + "</g>" +
           '<ellipse cx="132" cy="58" rx="92" ry="18" fill="none" stroke="#ffd34d" stroke-width="3" stroke-dasharray="14 10" opacity=".75"/>' +
           star(48, 60, 14) + star(214, 46, 12) + star(232, 96, 9);
    } else {
      s += fig;
    }
    return s + "</g></svg>";
  }

  function dataUrl(markup) { return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup); }

  /* ------------------------------------------------------------------ *
   * Avatars + cached rasters
   * ------------------------------------------------------------------ */
  // Visible figure inside the 264 x 400 art (hair top -> shoe soles, hand to
  // hand). FIXED for every guest - accessories never change it.
  var BOX = { x: 26, y: 6, w: 212, h: 392, fileW: W, fileH: H };
  var RASTER_K = 1.3;                  // canvas px per art px (~520px tall)
  var MAX_RASTERS = 16;                // ~8 guests' normal + hurt kept warm
  var rasters = Object.create(null);   // "guest~id|normal" -> { image, canvas, used }
  var avatarsById = Object.create(null);

  function avatarFor(p) {
    if (!p || p.type !== "guest") return null;
    var hit = avatarsById[p.participantId];
    if (hit) return hit;
    var a = sanitize(p.guestAppearance);
    var photo = p.guestPhoto || null;
    var normal = dataUrl(svg(a, false, photo)), hurt = dataUrl(svg(a, true, photo));
    var top = FABRIC[a.topColor].c;
    var av = {
      id: "guest~" + p.participantId,
      baseId: null,
      variant: null,
      evil: false,
      isGuest: true,
      participantId: p.participantId,
      displayName: p.displayName,
      name: p.displayName,
      color: top === "#f0ebe0" ? "#d9cdb3" : top,
      colorDeep: shade(top, 0.5),
      spriteH: 124,                      // the roster default - identical gameplay
      trim: { normal: BOX, hurt: BOX },
      ui: { scale: 1, offsetX: 0, offsetY: 0 },
      art: { normal: normal, hurt: hurt, portrait: normal, selected: normal, victory: normal },
      portraitFocus: "center 18%",
      slots: ESA.SLOTS.slice(),
      available: true,
      tagline: "Guest fighter",
      victoryAnimation: null,
      evilEyes: null
    };
    avatarsById[p.participantId] = av;
    ESA.Avatars.register(av);
    return av;
  }

  function rasterEntry(av, hurt) {
    var key = av.id + (hurt ? "|hurt" : "|normal");
    var e = rasters[key];
    if (!e) {
      e = rasters[key] = { image: new Image(), canvas: null, used: 0 };
      e.image.decoding = "async";
      e.image.src = hurt ? av.art.hurt : av.art.normal;
    }
    e.used = performance.now();
    return e;
  }

  function trim() {
    var keys = Object.keys(rasters).filter(function (k) { return rasters[k].canvas; });
    if (keys.length <= MAX_RASTERS) return;
    keys.sort(function (a, b) { return rasters[a].used - rasters[b].used; });
    for (var i = 0; i < keys.length - MAX_RASTERS; i++) rasters[keys[i]].canvas = null;
  }

  /** A guest's photo changed: rebuild only its cached art (same participant). */
  function refresh(p) {
    var av = avatarsById[p.participantId];
    if (!av) return;
    delete rasters[av.id + "|normal"];
    delete rasters[av.id + "|hurt"];
    delete avatarsById[p.participantId];
    ESA.Avatars.forget(av.id);
    avatarFor(p);
  }

  /* ------------------------------------------------------------------ *
   * PHOTO - local only. Read with an object URL, shrunk to a working
   * canvas (<= 1024 px), cropped by the player, exported as a 256 px JPEG.
   * ------------------------------------------------------------------ */
  var PHOTO_OUT = 256;
  var CROP_VIEW = 260;                 // crop window, CSS px (square)
  var WORK_MAX = 1024;

  function loadPhotoFile(file, done) {
    if (!file) { done(null); return; }
    if (file.type && !/^image\//.test(file.type)) { done(null); return; }
    var url;
    try { url = URL.createObjectURL(file); } catch (e) { done(null); return; }
    var img = new Image();
    img.decoding = "async";
    img.onload = function () {
      var iw = img.naturalWidth, ih = img.naturalHeight;
      var k = Math.min(1, WORK_MAX / Math.max(iw, ih));
      var c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(iw * k));
      c.height = Math.max(1, Math.round(ih * k));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);          // the full-size original is released now
      img.src = "";
      done(c);
    };
    img.onerror = function () { URL.revokeObjectURL(url); done(null); };
    img.src = url;
  }

  /** Cover-fit geometry of the working image inside the square crop view. */
  function cropGeom(cr, S) {
    var w = cr.img.width, h = cr.img.height;
    var s = Math.max(S / w, S / h) * cr.zoom;
    var dw = w * s, dh = h * s;
    var mx = Math.max(0, (dw - S) / 2), my = Math.max(0, (dh - S) / 2);
    cr.ox = Math.max(-mx, Math.min(mx, cr.ox));
    cr.oy = Math.max(-my, Math.min(my, cr.oy));
    return { x: (S - dw) / 2 + cr.ox, y: (S - dh) / 2 + cr.oy, w: dw, h: dh };
  }

  function exportPhoto(cr) {
    var out = document.createElement("canvas");
    out.width = out.height = PHOTO_OUT;
    var g = out.getContext("2d");
    var k = PHOTO_OUT / CROP_VIEW, d = cropGeom(cr, CROP_VIEW);
    g.imageSmoothingQuality = "high";
    g.drawImage(cr.img, d.x * k, d.y * k, d.w * k, d.h * k);
    var url = out.toDataURL("image/jpeg", 0.85);
    if (url.length > 58000) url = out.toDataURL("image/jpeg", 0.7);
    return url;
  }

  function source(av, hurt) {
    var e = rasterEntry(av, hurt);
    if (!e.canvas) {
      if (!e.image.complete || !e.image.naturalWidth) return null;
      var c = document.createElement("canvas");
      c.width = Math.round(W * RASTER_K);
      c.height = Math.round(H * RASTER_K);
      c.getContext("2d").drawImage(e.image, 0, 0, c.width, c.height);
      e.canvas = c;
      trim();
    }
    return { img: e.canvas, k: RASTER_K, fx0: 0, fy0: 0 };
  }

  /* ================================================================== *
   * CREATOR - Add Guest sheet (custom modal: touch-first, keyboard-ready)
   *   1 nickname  ->  2 Customize | Randomize for me  ->  3 preview
   *   ->  4 Confirm. Cancel / Back never adds anyone.
   * ================================================================== */
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function button(label, cls, onClick) {
    var b = el("button", "btn " + (cls || ""), label);
    b.type = "button";
    b.addEventListener("click", function (ev) { ev.preventDefault(); onClick(); });
    return b;
  }

  function openCreator(opts) {
    opts = opts || {};
    var st = {
      step: "name",
      name: "",
      app: randomAppearance(),
      photo: null,           // 256px JPEG data URL (local), or null
      crop: null,            // { img: working canvas, zoom, ox, oy } while cropping
      photoBack: "name",     // where Back goes from the photo step
      placeholder: ESA.Participants.nextGuestLabel()
    };
    var m;

    function close(added) {
      st.crop = null;                                  // release the working image
      if (!added) st.photo = null;                     // cancelled: the photo is discarded
      ESA.Modal.pop();
      if (added) { if (opts.onDone) opts.onDone(added); }
      else if (opts.onCancel) opts.onCancel();
    }

    function confirm() {
      var p = ESA.Participants.addGuest(st.name, st.app, st.photo);
      st.crop = null;                                  // drop the working image
      if (!p) { ESA.Audio.play("denied"); return; }
      ESA.Audio.play("lockIn");
      close(p);
    }

    function go(step) {
      st.step = step;
      ESA.Audio.play(step === "name" ? "uiBack" : "uiClick");
      ESA.Modal.render();
    }

    function shownName() { return ESA.Participants.cleanName(st.name) || st.placeholder; }

    function preview(card) {
      var box = el("div", "gc-preview");
      var stage = el("div", "gc-stage");
      var img = el("img", "gc-art");
      img.alt = "";
      img.draggable = false;
      img.src = dataUrl(svg(st.app, false, st.photo));
      stage.appendChild(img);
      var ouch = el("img", "gc-ouch");
      ouch.alt = "";
      ouch.draggable = false;
      ouch.src = dataUrl(svg(st.app, true, st.photo));
      ouch.title = "Hurt reaction";
      stage.appendChild(ouch);
      box.appendChild(stage);
      var plate = el("div", "gc-plate");
      plate.appendChild(el("small", "", "Guest"));
      plate.appendChild(el("b", "", shownName()));       // textContent only - never HTML
      box.appendChild(plate);
      card.gcArt = img;
      card.gcOuch = ouch;
      return box;
    }

    function refreshArt(card) {
      if (card.gcArt) card.gcArt.src = dataUrl(svg(st.app, false, st.photo));
      if (card.gcOuch) card.gcOuch.src = dataUrl(svg(st.app, true, st.photo));
    }

    function head(card, title) {
      var h = el("div", "gc-head");
      h.appendChild(el("div", "modal-kicker", "Add Guest"));
      h.appendChild(el("h2", "modal-title", title));
      var x = button("✕", "btn-ghost btn-small gc-close", function () { ESA.Audio.play("uiBack"); close(null); });
      x.setAttribute("aria-label", "Cancel");
      h.appendChild(x);
      card.appendChild(h);
    }

    function buildName(card) {
      head(card, "Who's Playing?");
      var form = el("form", "gc-name");
      form.setAttribute("autocomplete", "off");
      var label = el("label", "gc-label", "Nickname");
      label.setAttribute("for", "gcNameInput");
      var input = el("input", "gc-input");
      input.id = "gcNameInput";
      input.type = "text";
      input.maxLength = ESA.Participants.NAME_MAX * 2;     // code points are capped on save
      input.placeholder = st.placeholder;
      input.value = st.name;
      input.setAttribute("enterkeyhint", "next");
      input.setAttribute("spellcheck", "false");
      input.setAttribute("autocapitalize", "words");
      var hint = el("div", "gc-hint", "Up to " + ESA.Participants.NAME_MAX + " characters · leave blank for “" + st.placeholder + "”");
      input.addEventListener("input", function () {
        if (Array.from(input.value).length > ESA.Participants.NAME_MAX) {
          input.value = Array.from(input.value).slice(0, ESA.Participants.NAME_MAX).join("");
        }
        st.name = input.value;
      });
      form.addEventListener("submit", function (ev) { ev.preventDefault(); st.name = input.value; go("custom"); });
      form.appendChild(label);
      form.appendChild(input);
      form.appendChild(hint);
      card.appendChild(form);

      var choices = el("div", "gc-choices");
      var cust = button("", "btn-gold gc-choice is-primary", function () { st.name = input.value; go("custom"); });
      cust.appendChild(el("b", "", "Customize"));
      cust.appendChild(el("small", "", "Pick skin, hair, outfit"));
      var rnd = button("", "btn-ghost gc-choice", function () { st.name = input.value; st.app = randomAppearance(); go("random"); });
      rnd.appendChild(el("b", "", "Randomize for me"));
      rnd.appendChild(el("small", "", "Instant fighter"));
      var pho = button("", "btn-ghost gc-choice gc-photo-choice", function () {
        st.name = input.value; st.photoBack = "name"; go("photo");
      });
      pho.appendChild(el("b", "", "Use My Photo"));
      pho.appendChild(el("small", "", "Your face, our fighter"));
      choices.appendChild(cust);
      choices.appendChild(rnd);
      choices.appendChild(pho);
      card.appendChild(choices);
      card.gcFocus = (ESA.Touch && ESA.Touch.active) ? null : input;
    }

    function swatchRow(card, title, list, key, labelKey) {
      var row = el("div", "gc-row");
      row.appendChild(el("div", "gc-label", title));
      var opts = el("div", "gc-opts gc-swatches");
      list.forEach(function (sw, i) {
        var b = el("button", "gc-swatch" + (st.app[key] === i ? " is-on" : ""));
        b.type = "button";
        b.style.setProperty("--sw", sw.c);
        b.setAttribute("aria-label", (labelKey || title) + ": " + sw.name);
        b.setAttribute("aria-pressed", st.app[key] === i ? "true" : "false");
        b.addEventListener("click", function () {
          st.app[key] = i;
          ESA.Audio.play("uiMove");
          markOn(opts, b);
          refreshArt(card);
        });
        opts.appendChild(b);
      });
      row.appendChild(opts);
      return row;
    }

    function chipRow(card, title, list, key, after) {
      var row = el("div", "gc-row");
      row.appendChild(el("div", "gc-label", title));
      var opts = el("div", "gc-opts gc-chips");
      list.forEach(function (it) {
        var b = el("button", "gc-chip" + (st.app[key] === it.id ? " is-on" : ""), it.name);
        b.type = "button";
        b.setAttribute("aria-pressed", st.app[key] === it.id ? "true" : "false");
        b.addEventListener("click", function () {
          st.app[key] = it.id;
          ESA.Audio.play("uiMove");
          markOn(opts, b);
          refreshArt(card);
          if (after) after();
        });
        opts.appendChild(b);
      });
      row.appendChild(opts);
      return row;
    }

    function markOn(group, on) {
      var bs = group.querySelectorAll("button");
      for (var i = 0; i < bs.length; i++) {
        bs[i].classList.toggle("is-on", bs[i] === on);
        bs[i].setAttribute("aria-pressed", bs[i] === on ? "true" : "false");
      }
    }

    function buildCustom(card) {
      head(card, "Customize");
      var layout = el("div", "gc-layout");
      layout.appendChild(preview(card));
      var rows = el("div", "gc-rows");
      rows.appendChild(photoRow());
      var colorSlot = el("div", "gc-colorslot");
      function colorRow() {
        colorSlot.textContent = "";
        var wear = byId(HAIR, st.app.hair).wear;
        colorSlot.appendChild(wear
          ? swatchRow(card, "Headwear colour", FABRIC, "wearColor")
          : swatchRow(card, "Hair colour", HAIR_COLORS, "hairColor"));
      }
      rows.appendChild(swatchRow(card, "Skin tone", SKIN, "skin"));
      rows.appendChild(chipRow(card, "Hair / headwear", HAIR, "hair", colorRow));
      rows.appendChild(colorSlot);
      colorRow();
      rows.appendChild(chipRow(card, "Top", TOPS, "top"));
      rows.appendChild(swatchRow(card, "Top colour", FABRIC, "topColor"));
      rows.appendChild(swatchRow(card, "Trousers", PANTS, "bottomColor"));
      rows.appendChild(chipRow(card, "Extra", EXTRAS, "accessory"));
      layout.appendChild(rows);
      card.appendChild(layout);
      // Phones: the preview shrinks once the options scroll (more room for
      // them), and grows back at the top. The listener lives on this
      // render's own element, so it goes away with it.
      rows.addEventListener("scroll", function () {
        var on = card.classList.contains("is-scrolled") ? rows.scrollTop > 4 : rows.scrollTop > 24;
        card.classList.toggle("is-scrolled", on);
      }, { passive: true });

      var foot = el("div", "gc-foot");
      foot.appendChild(button("← Back", "btn-ghost btn-small", function () { go("name"); }));
      foot.appendChild(button("↻ Randomize", "btn-ghost btn-small", function () {
        st.app = randomAppearance();
        ESA.Audio.play("toggleOn");
        ESA.Modal.render();
      }));
      var ok = button("✓ Add Guest", "btn-gold is-primary", confirm);
      foot.appendChild(ok);
      card.appendChild(foot);
      card.gcFocus = (ESA.Touch && ESA.Touch.active) ? null : ok;
    }

    /** Photo controls inside Customize: add / replace / remove, same guest. */
    function photoRow() {
      var row = el("div", "gc-row gc-photo-row");
      row.appendChild(el("div", "gc-label", "Face photo"));
      var opts = el("div", "gc-opts gc-chips");
      if (st.photo) {
        var th = el("img", "gc-photo-thumb");
        th.alt = ""; th.src = st.photo;
        opts.appendChild(th);
        opts.appendChild(button("Replace Photo", "btn-ghost btn-small", function () { st.photoBack = "custom"; st.crop = null; go("photo"); }));
        opts.appendChild(button("Remove Photo", "btn-ghost btn-small", function () {
          st.photo = null; ESA.Audio.play("toggleOff"); ESA.Modal.render();
        }));
      } else {
        opts.appendChild(button("Use My Photo", "btn-ghost btn-small", function () { st.photoBack = "custom"; go("photo"); }));
      }
      row.appendChild(opts);
      row.appendChild(el("div", "gc-photo-note", "Your photo stays on this device and this session only - it is never uploaded."));
      return row;
    }

    /* PHOTO step: pick / take a photo, then position + zoom it in the oval. */
    function buildPhoto(card) {
      head(card, st.crop ? "Frame Your Face" : "Use My Photo");
      var box = el("div", "gc-photo");
      var note = el("div", "gc-photo-note", "Your photo stays on this device and this session only - it is never uploaded or shared.");

      function picker(label, cls, capture) {
        var inp = el("input", "gc-file");
        inp.type = "file";
        inp.accept = "image/jpeg,image/png,image/webp,image/*";
        if (capture) inp.setAttribute("capture", "user");
        inp.addEventListener("change", function () {
          var f = inp.files && inp.files[0];
          inp.value = "";
          if (!f) return;
          loadPhotoFile(f, function (c) {
            if (!c) { ESA.Audio.play("denied"); status.textContent = "That file couldn't be opened as a photo. Try a JPEG or PNG."; return; }
            st.crop = { img: c, zoom: 1.15, ox: 0, oy: 0 };
            ESA.Audio.play("uiClick");
            ESA.Modal.render();
          });
        });
        var b = button(label, cls, function () { inp.click(); });
        box.appendChild(inp);
        return b;
      }
      var status = el("div", "gc-hint", "");

      if (!st.crop) {
        var pick = el("div", "gc-choices gc-photo-pick");
        pick.appendChild(picker("Choose Photo", "btn-gold gc-choice is-primary", false));
        // Phones / tablets: straight to the front camera where supported.
        if (ESA.Touch && ESA.Touch.active) pick.appendChild(picker("Take Selfie", "btn-ghost gc-choice", true));
        else pick.classList.add("is-single");     // no camera button: centre the one action
        box.appendChild(pick);
        box.appendChild(status);
        box.appendChild(note);
        card.appendChild(box);
        var foot0 = el("div", "gc-foot");
        foot0.appendChild(button("← Back", "btn-ghost btn-small", function () { go(st.photoBack); }));
        card.appendChild(foot0);
        return;
      }

      // Crop view: drag to position, slider to zoom; the oval is the face.
      var wrap = el("div", "gc-crop-wrap");
      var cv = el("canvas", "gc-crop");
      var dpr = Math.min(2, window.devicePixelRatio || 1);
      cv.width = cv.height = Math.round(CROP_VIEW * dpr);
      wrap.appendChild(cv);
      var mask = el("span", "gc-crop-mask");
      wrap.appendChild(mask);
      box.appendChild(wrap);
      var cr = st.crop;
      function draw() {
        var g = cv.getContext("2d");
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, CROP_VIEW, CROP_VIEW);
        var d = cropGeom(cr, CROP_VIEW);
        g.drawImage(cr.img, d.x, d.y, d.w, d.h);
      }
      draw();
      var drag = null;
      cv.addEventListener("pointerdown", function (e) {
        e.preventDefault();
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: cr.ox, oy: cr.oy };
        try { cv.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
      });
      cv.addEventListener("pointermove", function (e) {
        if (!drag || drag.id !== e.pointerId) return;
        var r = cv.getBoundingClientRect(), k = CROP_VIEW / (r.width || CROP_VIEW);
        cr.ox = drag.ox + (e.clientX - drag.x) * k;
        cr.oy = drag.oy + (e.clientY - drag.y) * k;
        draw();
      });
      var endDrag = function () { drag = null; };
      cv.addEventListener("pointerup", endDrag);
      cv.addEventListener("pointercancel", endDrag);
      cv.addEventListener("wheel", function (e) {
        e.preventDefault();
        cr.zoom = Math.max(1, Math.min(4, cr.zoom * (e.deltaY < 0 ? 1.08 : 0.93)));
        zoom.value = cr.zoom;
        draw();
      }, { passive: false });
      var zrow = el("label", "gc-zoom");
      zrow.appendChild(el("span", "", "Zoom"));
      var zoom = el("input", "");
      zoom.type = "range"; zoom.min = "1"; zoom.max = "4"; zoom.step = "0.01"; zoom.value = String(cr.zoom);
      zoom.addEventListener("input", function () { cr.zoom = Number(zoom.value) || 1; draw(); });
      zrow.appendChild(zoom);
      box.appendChild(zrow);
      box.appendChild(el("div", "gc-hint", "Drag to position your face inside the oval."));
      box.appendChild(note);
      card.appendChild(box);

      var foot = el("div", "gc-foot is-crop");
      foot.appendChild(button("← Back", "btn-ghost btn-small", function () { st.crop = null; go(st.photoBack); }));
      foot.appendChild(button("Different Photo", "btn-ghost btn-small", function () { st.crop = null; ESA.Modal.render(); }));
      var ok = button("✓ Use This Photo", "btn-gold is-primary", function () {
        st.photo = exportPhoto(cr);
        st.crop = null;                                // release the working image
        ESA.Audio.play("lockIn");
        go("custom");
      });
      foot.appendChild(ok);
      card.appendChild(foot);
      card.gcFocus = (ESA.Touch && ESA.Touch.active) ? null : ok;
    }

    function buildRandom(card) {
      head(card, "Your Guest");
      var layout = el("div", "gc-layout is-random");
      layout.appendChild(preview(card));
      card.appendChild(layout);
      var foot = el("div", "gc-foot");
      foot.appendChild(button("↻ Randomize Again", "btn-ghost", function () {
        st.app = randomAppearance();
        ESA.Audio.play("toggleOn");
        refreshArt(card);
      }));
      foot.appendChild(button("Customize", "btn-ghost", function () { go("custom"); }));
      var ok = button("✓ Use This", "btn-gold is-primary", confirm);
      foot.appendChild(ok);
      card.appendChild(foot);
      card.gcFocus = (ESA.Touch && ESA.Touch.active) ? null : ok;
    }

    m = {
      type: "custom",
      cls: "guest-creator",
      build: function (card) {
        card.setAttribute("data-step", st.step);
        if (st.step === "name") buildName(card);
        else if (st.step === "custom") buildCustom(card);
        else if (st.step === "photo") buildPhoto(card);
        else buildRandom(card);
        if (card.gcFocus) setTimeout(function () { if (card.isConnected) card.gcFocus.focus({ preventScroll: true }); }, 30);
      },
      onKey: function (code, e) {
        var ae = document.activeElement;
        var typing = ae && ae.tagName === "INPUT";
        if (code === "Escape") {
          e.preventDefault();
          if (st.step === "name") { ESA.Audio.play("uiBack"); close(null); }
          else if (st.step === "photo") { st.crop = null; go(st.photoBack); }
          else go("name");
          return true;
        }
        if (typing) return true;                    // the form handles Enter
        if (code === "KeyR" && st.step !== "name") {
          st.app = randomAppearance();
          ESA.Audio.play("toggleOn");
          if (st.step === "random") { var card = ESA.Modal.layer.querySelector(".modal-card"); if (card) refreshArt(card); }
          else ESA.Modal.render();
          return true;
        }
        return arrowFocus(code, e);
      },
      onEscape: function () { close(null); }
    };
    ESA.Audio.play("uiClick");
    ESA.Modal.push(m);
  }

  /** Arrow keys move focus between the sheet's buttons (rows / options). */
  function arrowFocus(code, e) {
    var dir = { ArrowLeft: -1, KeyA: -1, ArrowRight: 1, KeyD: 1, ArrowUp: -2, KeyW: -2, ArrowDown: 2, KeyS: 2 }[code];
    if (!dir) return false;
    e.preventDefault();
    var card = ESA.Modal.layer.querySelector(".modal-card");
    if (!card) return true;
    var all = Array.prototype.slice.call(card.querySelectorAll("button:not([disabled])"));
    if (!all.length) return true;
    var cur = all.indexOf(document.activeElement);
    if (cur < 0) { (card.querySelector(".is-on") || all[0]).focus(); return true; }
    if (Math.abs(dir) === 1) {
      all[(cur + dir + all.length) % all.length].focus();
    } else {
      // Jump to the selected option of the previous / next row group.
      var groups = Array.prototype.slice.call(card.querySelectorAll(".gc-opts, .gc-foot, .gc-choices, .gc-head"));
      var g = groups.findIndex(function (x) { return x.contains(document.activeElement); });
      var next = groups[(g + (dir > 0 ? 1 : -1) + groups.length) % groups.length];
      var target = next && (next.querySelector(".is-on") || next.querySelector("button"));
      if (target) target.focus();
    }
    ESA.Audio.play("uiMove");
    return true;
  }

  ESA.Guests = {
    PARTS: { SKIN: SKIN, HAIR_COLORS: HAIR_COLORS, FABRIC: FABRIC, PANTS: PANTS, HAIR: HAIR, TOPS: TOPS, EXTRAS: EXTRAS },
    sanitize: sanitize,
    random: randomAppearance,
    svg: svg,
    avatarFor: avatarFor,
    source: source,
    /** Starts loading a guest's art so the first game frame has it. */
    warm: function (av) { if (av && av.isGuest) { rasterEntry(av, false); rasterEntry(av, true); } },
    refresh: refresh,
    forget: function (p) {
      var av = avatarsById[p.participantId];
      if (!av) return;
      delete rasters[av.id + "|normal"];
      delete rasters[av.id + "|hurt"];
      delete avatarsById[p.participantId];
      ESA.Avatars.forget(av.id);
    },
    openCreator: openCreator,
    arrowFocus: arrowFocus
  };

})(window.ESA);
