/* ==========================================================================
   ESA ARCADE - CLUTCH deterministic scenario + invariant tests (DEV ONLY)
     node tools/sim/clutch-tests.js
   Uses the REAL js/clutch.js and js/bonkbooth.js (tools/sim/harness.js).
   Thresholds / bonuses are read from a live Bonk Booth instance, so the
   tests always check what the game actually ships.
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const H = require("./harness");
const env = H.load({ seed: 11 });
const E = env.ESA;
const DT = 1 / 60;
let pass = 0, fail = 0;
function ok(name, cond, info) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (info !== undefined ? "  -> " + JSON.stringify(info) : "")); }
}

function bonk(ctx) {
  const g = new E.BonkBooth({ endMatch() {}, context: ctx || { mode: "casual" } }, H.setup(E, ctx && ctx.single));
  g.start();
  return g;
}
const g0 = bonk();
const C = g0.clutch;
const T1 = C.tiers[0], T2 = C.tiers[1], HOLD = C.hold;
console.log("Bonk CLUTCH config:", JSON.stringify({ tiers: C.tiers, hold: HOLD }));

/* ---------------------------------------------------------------- */
console.log("\nSCENARIOS (fresh state, deficit reached directly)");
function stateFor(a, b) {
  const c = E.Clutch.create({ tiers: C.tiers, hold: HOLD });
  c.update({ p1: a, p2: b });
  return { p1: c.label("p1") || "NORMAL", p2: c.label("p2") || "NORMAL" };
}
const expectFor = d => d >= T2.gap ? T2.label : d >= T1.gap ? T1.label : "NORMAL";
const scenarios = [[2, 1], [5, 4], [4, 1], [8, 5], [9, 4], [10, 4], [12, 5], [13, 3], [15, 4], [20, 6], [3, 3], [-1, 3], [0, -4]];
console.log("  score    leader  deficit  expected     actual");
scenarios.forEach(([a, b]) => {
  const s = stateFor(a, b), lead = a === b ? "-" : a > b ? "P1" : "P2", d = Math.abs(a - b);
  const trailer = a > b ? "p2" : "p1", leader = a > b ? "p1" : "p2";
  const exp = a === b ? "NORMAL" : expectFor(d);
  const act = a === b ? (s.p1 === "NORMAL" && s.p2 === "NORMAL" ? "NORMAL" : "BOTH?") : s[trailer];
  const leaderClean = a === b || s[leader] === "NORMAL";
  console.log("  " + (a + "-" + b).padEnd(8) + " " + lead.padEnd(7) + " " + String(d).padEnd(8) + " " + exp.padEnd(12) + " " + act);
  ok("  " + a + "-" + b + ": trailer " + exp + ", leader never assisted", act === exp && leaderClean, s);
});

/* ---------------------------------------------------------------- */
console.log("\nHYSTERESIS + STEP-DOWN (trailer closes the gap one point at a time)");
{
  const c = E.Clutch.create({ tiers: C.tiers, hold: HOLD });
  const lead = 4 + T2.gap + 2;           // leader score; trailer starts 12 down
  const trace = [];
  for (let tr = 4; tr <= lead + 1; tr++) { c.update({ p1: lead, p2: tr }); trace.push([lead - tr, c.label("p2") || "NORMAL", c.bonus("p2")]); }
  trace.forEach(t => console.log("  deficit " + String(t[0]).padStart(3) + "  ->  " + t[1].padEnd(9) + "  +" + Math.round(t[2] * 100) + "%"));
  const at = d => trace.find(t => t[0] === d)[1];
  ok("CLUTCH II holds until deficit drops below " + (T2.gap - HOLD), at(T2.gap) === T2.label && at(T2.gap - HOLD) === T2.label && at(T2.gap - HOLD - 1) === T1.label);
  ok("CLUTCH I holds until deficit drops below " + (T1.gap - HOLD), at(T1.gap - HOLD) === T1.label && at(T1.gap - HOLD - 1) === "NORMAL");
  ok("NORMAL once close; leader-turned-trailer only gets it at a real gap", at(0) === "NORMAL" && at(-1) === "NORMAL");
  const order = trace.map(t => t[1]).filter((v, i, a) => i === 0 || v !== a[i - 1]);
  ok("steps II -> I -> NORMAL monotonically (no flicker)", JSON.stringify(order) === JSON.stringify([T2.label, T1.label, "NORMAL"]), order);
}
{
  // Bounce around each threshold: +1 / -1 repeatedly must not toggle.
  const c = E.Clutch.create({ tiers: C.tiers, hold: HOLD });
  let flips = 0, prev = null;
  [5, 4, 5, 4, 5, 4, 5, 4, 10, 9, 10, 9, 10, 9].forEach(d => {
    c.update({ p1: 20, p2: 20 - d }); const l = c.label("p2");
    if (prev !== null && l !== prev) flips++; prev = l;
  });
  ok("a score bouncing +/-1 at each threshold never oscillates (I held at 4, II held at 9: one change, I -> II)", flips === 1, flips);
}

/* ---------------------------------------------------------------- */
console.log("\nRESET");
{
  const g = bonk();
  g.addScore("p1", 15);
  ok("assist is live after a 15-point gap", g.clutch.label("p2") === T2.label);
  g.start();
  ok("rematch / start() resets CLUTCH", g.clutch.level.p1 === 0 && g.clutch.level.p2 === 0 && g.score.p1 === 0);
  const g2 = bonk({ mode: "tournament", matchId: "m2" });
  ok("next match (new instance, e.g. Tournament next match) starts clean", !!g2.clutch && g2.clutch.level.p2 === 0 && g2.clutch !== g.clutch);
  g.destroy();
  ok("solo Bonk has no CLUTCH at all", bonk({ mode: "solo", single: true }).clutch === null);
}

/* ---------------------------------------------------------------- */
console.log("\nINVARIANTS (real Bonk Booth, both players trailing in turn, many frames)");
{
  const g = bonk();
  g.state = "playing";
  // Record every target popped and the event it came from.
  const pops = [];
  const origFill = g.fill.bind(g);
  g.fill = function (side) {
    const before = this.targets[side].length, q = this.queue[side].slice();
    origFill(side);
    const added = this.targets[side].slice(before);
    added.forEach((t, i) => pops.push({ side, t, ev: q[i], bonus: this.clutch.bonus(side), lvl: this.clutch.level[side], mine: this.score[side], theirs: this.score[side === "p1" ? "p2" : "p1"] }));
  };
  // Score changes happen ONLY inside attempt() (a press / tap).
  let inPress = false, scoreOutsidePress = 0;
  const origAttempt = g.attempt.bind(g);
  g.attempt = function (s, h) { inPress = true; try { origAttempt(s, h); } finally { inPress = false; } };
  const origAdd = g.addScore.bind(g);
  g.addScore = function (s, d) { if (!inPress) scoreOutsidePress++; origAdd(s, d); };

  // Phase 1: P1 leads by 12 (P2 is CLUTCH II); phase 2: P2 leads by 6 (P1 is CLUTCH I).
  g.score.p1 = 12; g.score.p2 = 0; g.clutch.update(g.score);
  const s0 = { p1: g.score.p1, p2: g.score.p2 };
  for (let i = 0; i < 60 * 15; i++) g.update(DT, i * 16.7);
  ok("no input for 15 s -> neither score changes (CLUTCH never scores)", g.score.p1 === s0.p1 && g.score.p2 === s0.p2, g.score);
  ok("no target was hit automatically (none resolved without a press)", pops.every(p => !p.t.resolved));
  g.score.p1 = 0; g.score.p2 = 6; g.clutch.update(g.score);
  for (let i = 0; i < 60 * 12; i++) g.update(DT, i * 16.7);

  const lead = pops.filter(p => p.bonus === 0), assisted = pops.filter(p => p.bonus > 0);
  ok("both phases produced pops (" + lead.length + " unassisted, " + assisted.length + " assisted)", lead.length > 10 && assisted.length > 10);
  ok("leader / unassisted targets: windows exactly the shared event's", lead.every(p =>
    p.t.activeFor === p.ev.activeFor && p.t.tellFor === p.ev.tellFor && p.t.riseFor === p.ev.riseFor && p.t.retreatFor === p.ev.retreatFor));
  ok("assisted normal targets: activeFor x (1 + bonus) exactly", assisted.filter(p => p.ev.type === "normal").every(p =>
    Math.abs(p.t.activeFor - p.ev.activeFor * (1 + p.bonus)) < 1e-12));
  ok("assisted bombs are NEVER stretched", assisted.filter(p => p.ev.type === "bomb").every(p => p.t.activeFor === p.ev.activeFor && p.t.tellFor === p.ev.tellFor));
  ok("rise / retreat / stun timings never changed by CLUTCH", pops.every(p => p.t.riseFor === p.ev.riseFor && p.t.retreatFor === p.ev.retreatFor && p.t.stunFor === p.ev.stunFor));
  ok("hazard assignment unchanged: every target's type is its shared event's type", pops.every(p => p.t.type === p.ev.type));
  ok("only the trailer is ever assisted (assisted side's score < rival's at pop time)", assisted.every(p => p.mine < p.theirs));
  ok("assistance is only ever tier I / tier II amounts", assisted.every(p => p.bonus === T1.bonus || p.bonus === T2.bonus));
  ok("no score changed outside a player's press", scoreOutsidePress === 0, scoreOutsidePress);

  // Same press, same result, assisted or not.
  const gA = bonk(), gB = bonk();
  [gA, gB].forEach(x => { x.state = "playing"; });
  gB.score.p1 = 15; gB.clutch.update(gB.score);     // in gB, P2 is CLUTCH II, P1 leads
  const put = (x, side) => { x.targets[side] = [{ side, hole: 1, type: "normal", phase: "active", t: 0, tellFor: 0.2, riseFor: 0.1, activeFor: 0.8, retreatFor: 0.1, stunFor: 0.3, cue: 1, rise: 1, resolved: false, attempted: false, hitType: null, reactT: 0 }]; x.queue[side] = []; };
  ["p1", "p2"].forEach(side => { put(gA, side); put(gB, side); });
  const before = { A: Object.assign({}, gA.score), B: Object.assign({}, gB.score) };
  gA.clock = gB.clock = 5;
  gA.attempt("p1", 1); gB.attempt("p1", 1); gA.attempt("p2", 1); gB.attempt("p2", 1);
  ok("leader's press: +1 with or without CLUTCH active (controls unchanged)", gA.score.p1 - before.A.p1 === 1 && gB.score.p1 - before.B.p1 === 1);
  ok("trailer's press: +1 exactly - CLUTCH adds nothing on a hit", gA.score.p2 - before.A.p2 === 1 && gB.score.p2 - before.B.p2 === 1);
  gA.clock = gB.clock = 6;
  gA.attempt("p2", 0); gB.attempt("p2", 0);
  ok("trailer's miss still costs -1 under CLUTCH", gA.score.p2 - before.A.p2 === 0 && gB.score.p2 - before.B.p2 === 0);
}

/* ---------------------------------------------------------------- */
console.log("\nSCOPE (static)");
{
  const js = path.join(H.ROOT, "js");
  const users = fs.readdirSync(js).filter(f => f.endsWith(".js") && f !== "clutch.js" &&
    /ESA\.Clutch\b/.test(fs.readFileSync(path.join(js, f), "utf8")));
  ok("only bonkbooth.js uses ESA.Clutch", JSON.stringify(users) === JSON.stringify(["bonkbooth.js"]), users);
  const src = fs.readFileSync(path.join(js, "clutch.js"), "utf8");
  ok("clutch.js never touches score, targets, input or hazards", !/score\s*[+\-]?=|addScore|targets|attempt|onKey|bomb/i.test(src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")));
  const bb = fs.readFileSync(path.join(js, "bonkbooth.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const uses = bb.split("\n").filter(l => /clutch/.test(l)).map(l => l.trim());
  ok("Bonk reads CLUTCH only for: create, reset, update(score), bonus(side) in fill, label in draw",
     uses.every(l => /Clutch\.create|clutch\.reset|clutch\.update\(this\.score\)|clutch\.bonus\(side\)|drawClutch|clutch\.label|var CLUTCH|this\.clutch \?|if \(this\.clutch\) this\.drawClutch/.test(l)), uses);
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exitCode = fail ? 1 : 0;
