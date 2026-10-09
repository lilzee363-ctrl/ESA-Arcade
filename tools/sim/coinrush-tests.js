/* ==========================================================================
   ESA ARCADE - Coin Rush deterministic tests (DEVELOPMENT ONLY)
     node tools/sim/coinrush-tests.js
   Runs the REAL js/coinrush.js + shared movement headless (tools/sim/harness.js)
   and checks Reverse, stun timing, effect interactions and resets.
   ========================================================================== */
"use strict";

const H = require("./harness");
const env = H.load({ seed: 5 });
const E = env.ESA;
const DT = 1 / 60;
let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (info !== undefined ? "  -> " + JSON.stringify(info) : "")); }
}

/** A live versus game with nothing on the floor that could interfere. */
function fresh(single) {
  const g = new E.CoinRush({ endMatch() {}, context: { mode: single ? "solo" : "casual", single: !!single } }, H.setup(E, single));
  g.start();
  g.tokens.forEach(t => { t.x = -9999; t.y = -9999; });     // keep tokens away from the test
  g.nextPickupAt = g.nextTrapAt = 1e9;                        // no spawns unless a test asks
  env.intents.p1 = { x: 0, y: 0 }; env.intents.p2 = { x: 0, y: 0 };
  return g;
}
function step(g, n) { for (let i = 0; i < n; i++) { g.tokens.forEach(t => { t.x = -9999; t.y = -9999; }); g.update(DT, i * 16.67); } }
function move(g, p, intent, frames) {
  env.intents[p.slot] = intent;
  const x0 = p.x, y0 = p.y;
  step(g, frames);
  env.intents[p.slot] = { x: 0, y: 0 };
  return { dx: p.x - x0, dy: p.y - y0 };
}
const reverse = (g, p) => g.grant(p, { type: "reverse", x: p.x, y: p.y });

console.log("REVERSE - controls");
{
  const g = fresh(); const p = g.p1; p.x = 480; p.y = 380;
  const n = move(g, p, { x: 1, y: 0 }, 10);
  reverse(g, p); p.x = 480; p.y = 380;
  const r = move(g, p, { x: 1, y: 0 }, 10);
  ok("right while reversed moves LEFT (same distance)", r.dx < 0 && Math.abs(r.dx + n.dx) < 1e-6, { n, r });
  p.x = 480; p.y = 380;
  const u = move(g, p, { x: 0, y: -1 }, 10);
  ok("up while reversed moves DOWN", u.dy > 0 && Math.abs(u.dx) < 1e-9, u);
  p.x = 480; p.y = 380;
  const d = move(g, p, { x: Math.SQRT1_2, y: Math.SQRT1_2 }, 10);
  ok("diagonal (normalised) inverts to the exact opposite diagonal", d.dx < 0 && d.dy < 0 && Math.abs(d.dx - d.dy) < 1e-6 &&
     Math.abs(Math.hypot(d.dx, d.dy) - Math.hypot(n.dx, 0)) < 1e-6, d);
  p.x = 480; p.y = 380;
  const a = move(g, p, { x: 0.3, y: -0.5 }, 10);
  ok("analog stick: both axes negated, magnitude kept", Math.abs(a.dx / a.dy - (-0.3 / 0.5)) < 1e-6 && a.dx < 0 && a.dy > 0, a);
  ok("opponent is NOT reversed", !g.p2.reversed && g.p2.fx.reverse === 0);
  const o = move(g, g.p2, { x: 1, y: 0 }, 10);
  ok("opponent still moves normally", o.dx > 0, o);
}

console.log("REVERSE - duration / refresh / no toggle");
{
  const g = fresh(); const p = g.p1;
  reverse(g, p);
  ok("collect -> 5.0 s", p.fx.reverse === 5000 && p.reversed);
  step(g, 120);                                   // 2 s
  ok("after 2 s ~3.0 s left", Math.abs(p.fx.reverse - 3000) < 20, p.fx.reverse);
  reverse(g, p);
  ok("second Reverse REFRESHES to 5.0 s (does not toggle off)", p.fx.reverse === 5000 && p.reversed);
  const r = (p.x = 480, p.y = 380, move(g, p, { x: 1, y: 0 }, 5));
  ok("still reversed after the refresh", r.dx < 0, r);
  step(g, 300);                                   // well past 5 s
  ok("expires to exactly 0 and controls return", p.fx.reverse === 0 && !p.reversed);
  const n = (p.x = 480, p.y = 380, move(g, p, { x: 1, y: 0 }, 5));
  ok("normal controls after expiry", n.dx > 0, n);
}

console.log("REVERSE + other effects");
{
  const g = fresh(); const p = g.p1;
  g.grant(p, { type: "boots", x: 0, y: 0 }); step(g, 30); reverse(g, p);
  step(g, 1);
  const n0 = fresh(); const q = n0.p1; q.x = 480; q.y = 380; const base = move(n0, q, { x: 1, y: 0 }, 10);
  p.x = 480; p.y = 380;
  const r = move(g, p, { x: 1, y: 0 }, 10);
  ok("Reverse + Speed Boots: reversed AND x1.35 speed", r.dx < 0 && Math.abs(-r.dx / base.dx - 1.35) < 0.01, { r: r.dx, base: base.dx });
  ok("both timers run independently", p.fx.boots > 0 && p.fx.reverse > 0 && p.fx.boots !== p.fx.reverse);
}
{
  const g = fresh(); const p = g.p1; p.x = 300; p.y = 380;
  g.grant(p, { type: "magnet", x: 0, y: 0 }); reverse(g, p);
  const b = E.bodyBounds(p);
  const t = g.tokens[0];
  // keep one token in magnet range for this test only
  let before = null, after = null;
  for (let i = 0; i < 10; i++) {
    g.tokens.forEach((k, j) => { if (j) { k.x = -9999; k.y = -9999; } });
    if (i === 0) { t.x = b.cx + 140; t.y = b.cy; t.collected = false; before = t.x; }
    g.update(DT, i * 16.67);
  }
  after = t.x;
  ok("Reverse + Magnet: magnet still pulls tokens in", after < before, { before, after });
}
{
  const g = fresh(); const p = g.p1;
  reverse(g, p);
  step(g, 30);                                    // 0.5 s into Reverse
  g.springTrap(p, { x: p.x, y: p.y });
  ok("stun while reversed: stunned + frozen, still reversed", p.fx.stun === 4000 && p.frozen && p.reversed);
  p.x = 480; p.y = 380;
  const m = move(g, p, { x: 1, y: 0 }, 60);
  ok("no movement at all while stunned", Math.abs(m.dx) < 1e-9 && Math.abs(m.dy) < 1e-9, m);
  ok("Reverse timer keeps running during the stun", Math.abs(p.fx.reverse - (5000 - 1500)) < 25, p.fx.reverse);
  step(g, 210);                                   // stun over at 4.0 s; Reverse (5 s) over at 5.0 s
  ok("no stuck state after stun + reverse both end", p.fx.stun === 0 && !p.frozen && p.fx.reverse === 0 && !p.reversed);
}
{
  const g = fresh(); const p = g.p1;
  g.springTrap(p, { x: p.x, y: p.y });
  step(g, 60);
  reverse(g, p);                                  // collected... (can't actually collect while stunned in play; forced here)
  step(g, 180);                                   // stun ends at 4.0 s, 2.0 s of Reverse left
  ok("stun ends, Reverse resumes naturally", p.fx.stun === 0 && !p.frozen && p.reversed && Math.abs(p.fx.reverse - 2000) < 25, p.fx);
  p.x = 480; p.y = 380;
  const r = move(g, p, { x: 1, y: 0 }, 5);
  ok("...and movement is reversed again", r.dx < 0, r);
}

console.log("TRAP stun - exactly 4 s of live play");
{
  const g = fresh(); const p = g.p1;
  g.springTrap(p, { x: p.x, y: p.y });
  let frames = 0;
  while (p.fx.stun > 0 && frames < 1000) { step(g, 1); frames++; }
  ok("stun lasts exactly 240 frames at 60 fps (4.000 s)", frames === 240, frames);
  ok("frozen cleared with the stun", !p.frozen);
}

console.log("RESET - rematch / exit");
{
  const g = fresh(); const p = g.p1;
  reverse(g, p); g.grant(p, { type: "boots", x: 0, y: 0 }); g.springTrap(g.p2, { x: 0, y: 0 });
  g.traps.push({ x: 400, y: 300, age: 0, life: 9 });
  g.start();                                      // rematch path
  const clean = g.players.every(q => !q.fx.stun && !q.fx.reverse && !q.fx.boots && !q.fx.magnet && !q.frozen && !q.reversed);
  ok("start() (rematch) clears every status + all traps", clean && g.traps.length === 0 && g.trapRejects === 0);
  reverse(g, p);
  g.destroy();
  ok("destroy() (exit) empties traps and pickup", g.traps.length === 0 && g.pickup === null);
  const g2 = fresh();
  ok("a new match never inherits status", g2.players.every(q => !q.fx.reverse && !q.reversed && !q.fx.stun));
}

console.log("SHARED MOVEMENT unchanged for other games");
{
  const p = { slot: "p1", x: 400, y: 300, speed: 200, facing: "right", r: 34, smooth: null, vx: 0, vy: 0, recoilX: 0, recoilY: 0, recoilDecay: 0.0045, character: { id: E.Characters.list()[0].id } };
  env.intents.p1 = { x: 1, y: 0 };
  E.movePlayer(p, 0.1, E.BOUNDS, true);
  ok("no p.reversed flag -> normal movement (Bomb Pass path)", p.x > 400);
  env.intents.p1 = { x: 0, y: 0 };
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
