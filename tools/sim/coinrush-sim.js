/* ==========================================================================
   ESA ARCADE - Coin Rush simulation (DEVELOPMENT ONLY)
     node tools/sim/coinrush-sim.js [rounds] [--file path/to/coinrush.js] [--solo] [--seed N]

   WHAT IS SIMULATED: the real js/coinrush.js (scheduler, trap placement,
   pickups, Reverse, stun, scoring, collisions) at a fixed 60 fps, driven
   by simple BOTS through ESA.Controls.vector - the same entry point as a
   keyboard / joystick. Bots chase the best token, sidestep traps they
   "notice" (imperfect), mostly avoid the Reverse pickup and only partly
   compensate when reversed.
   WHAT IS NOT: human skill, reaction time, eyesight, nerves or fun. Bot
   behaviour shapes the sprung-trap / Reverse numbers; spawn density and
   state correctness do not depend on it much.
   ========================================================================== */
"use strict";

const H = require("./harness");

const args = process.argv.slice(2);
const ROUNDS = Number(args.find(a => /^\d+$/.test(a))) || 1000;
const fileArg = args.indexOf("--file") >= 0 ? args[args.indexOf("--file") + 1] : null;
const SOLO = args.includes("--solo");
const SEED = args.indexOf("--seed") >= 0 ? Number(args[args.indexOf("--seed") + 1]) : 1;

const env = H.load({ seed: SEED, files: fileArg ? { "js/coinrush.js": fileArg } : {} });
const E = env.ESA;
const DT = 1 / 60;

function trapsOf(g) { return g.traps || (g.trap ? [g.trap] : []); }

/** A bot: steer to the most valuable nearby token, around traps it has noticed. */
function botIntent(g, p, other, mem) {
  const b = E.bodyBounds(p);
  let best = null, bestS = -Infinity;
  for (const t of g.tokens) {
    if (t.collected) continue;
    const d = Math.hypot(t.x - b.cx, t.y - b.cy);
    const s = (t.bonus ? 3 : 1) * 260 / (d + 60) - (other ? 0 : 0);
    if (s > bestS) { bestS = s; best = t; }
  }
  if (g.pickup && g.pickup.type !== "reverse") {
    const d = Math.hypot(g.pickup.x - b.cx, g.pickup.y - b.cy);
    if (d < 220) best = g.pickup;
  }
  let vx = 0, vy = 0;
  if (best) { const dx = best.x - b.cx, dy = best.y - b.cy, l = Math.hypot(dx, dy) || 1; vx = dx / l; vy = dy / l; }
  // Hazards the bot has noticed (each trap / reverse pickup is noticed with 85% chance).
  const hazards = trapsOf(g).map(t => ({ x: t.x, y: t.y, o: t }));
  if (g.pickup && g.pickup.type === "reverse") hazards.push({ x: g.pickup.x, y: g.pickup.y, o: g.pickup });
  for (const h of hazards) {
    if (!mem.seen.has(h.o)) mem.seen.set(h.o, env.random() < 0.85);
    if (!mem.seen.get(h.o)) continue;
    // Gap between the hazard and the BODY BOX (what the game tests), not a point.
    const qx = Math.max(b.x, Math.min(h.x, b.x + b.w)), qy = Math.max(b.y, Math.min(h.y, b.y + b.h));
    const dx = qx - h.x, dy = qy - h.y, d = Math.hypot(dx, dy);
    const ex = b.cx - h.x, ey = b.cy - h.y, el = Math.hypot(ex, ey) || 1;      // push away from it
    if (d < 75) { const k = (75 - d) / 75 * 2.4; vx += ex / el * k; vy += ey / el * k; }
  }
  const l = Math.hypot(vx, vy);
  if (l > 1) { vx /= l; vy /= l; }
  // Reversed: the bot realises and compensates only some of the time.
  if (p.fx && p.fx.reverse > 0) {
    if (!mem.revPlan || mem.revPlan.until < g.clock) mem.revPlan = { until: g.clock + 0.6, ok: env.random() < 0.6 };
    if (mem.revPlan.ok) { vx = -vx; vy = -vy; }
  }
  return { x: vx, y: vy };
}

function pct(n, d) { return d ? (100 * n / d) : 0; }
function stats(a) {
  const s = a.slice().sort((x, y) => x - y), n = s.length;
  return { avg: s.reduce((x, y) => x + y, 0) / n, med: n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2, min: s[0], max: s[n - 1] };
}

const M = {
  spawned: [], timeAt: [0, 0, 0, 0, 0], midTimeAt: [0, 0, 0, 0, 0], liveFrames: 0, midFrames: 0, lateTimeAt: [0, 0, 0, 0, 0], lateFrames: 0,
  activeSum: 0, midActiveSum: 0, peak: 0, longestGap: [], rejects: 0,
  sprung: { p1: 0, p2: 0 }, exposure: { p1: 0, p2: 0 }, score: { p1: 0, p2: 0 },
  reversePerRound: [], pickupSeq: [], reverseCollected: 0, invalid: [], stunDurations: [], reverseRefreshes: 0,
  reverseDuringStun: 0, ties: 0
};

for (let r = 0; r < ROUNDS; r++) {
  env.reseed(SEED * 100003 + r);
  const g = new E.CoinRush({ endMatch() {}, context: { mode: SOLO ? "solo" : "casual", single: SOLO } }, H.setup(E, SOLO));
  // Rematch path: every 10th round re-starts the SAME instance mid-way, so stale state would show up.
  g.start();
  const seenTraps = new Set(), seenPickups = new Set();
  if (r % 10 === 9) {
    for (let i = 0; i < 1500; i++) {
      g.update(DT, i * 16.67);
      if (g.pickup && !seenPickups.has(g.pickup)) { seenPickups.add(g.pickup); M.pickupSeq.push(g.pickup.type); }
    }
    g.start();
    seenPickups.clear();
  }
  const mems = { p1: { seen: new Map() }, p2: { seen: new Map() } };
  let gapNow = 0, gapMax = 0, firstSpawn = false, revThisRound = 0;
  const stunStart = { p1: -1, p2: -1 };
  const players = g.players;
  // Every stale-status check right after (re)start.
  for (const p of players) {
    if (p.fx.stun || p.fx.reverse || p.fx.boots || p.fx.magnet || p.frozen || p.reversed) M.invalid.push("stale status after start, round " + r);
  }
  let frame = 0;
  while (g.state !== "matchEnd" && frame < 60 * 70) {
    for (const p of players) env.intents[p.slot] = botIntent(g, p, players.find(q => q !== p), mems[p.slot]);
    const prevStun = players.map(p => p.fx.stun), prevRev = players.map(p => p.fx.reverse);
    g.update(DT, frame * 16.67);
    frame++;
    if (g.state !== "playing" && g.state !== "matchEnd") continue;
    const traps = trapsOf(g), n = traps.length;
    for (const t of traps) if (!seenTraps.has(t)) {
      seenTraps.add(t); firstSpawn = true;
      // Placement rules, checked at the moment a trap appears (new scheduler only).
      if (g.traps) {
        for (const p of players) { const b = E.bodyBounds(p); const dd = Math.hypot(t.x - b.cx, t.y - b.cy); if (dd < 155) M.invalid.push("trap spawned too close to " + p.slot + " (" + dd.toFixed(1) + " px, frame-end positions)"); }
        for (const o of traps) if (o !== t && Math.hypot(t.x - o.x, t.y - o.y) < 164.9) M.invalid.push("traps spawned too close together");
        if (traps.length > 3) M.invalid.push("more than 3 traps");
        if (t.x < E.BOUNDS.left + 56 - 0.01 || t.x > E.BOUNDS.right - 56 + 0.01) M.invalid.push("trap against a wall");
      }
    }
    if (g.pickup && !seenPickups.has(g.pickup)) {
      seenPickups.add(g.pickup); M.pickupSeq.push(g.pickup.type);
      if (g.pickup.type === "reverse") revThisRound++;
    }
    M.liveFrames++; M.timeAt[Math.min(n, 4)]++; M.activeSum += n; M.peak = Math.max(M.peak, n);
    const k = g.progress();
    if (k >= 1 / 3 && g.timeLeft > 3) { M.midFrames++; M.midTimeAt[Math.min(n, 4)]++; M.midActiveSum += n; }
    if (k >= 0.6 && g.timeLeft > 3) { M.lateFrames++; M.lateTimeAt[Math.min(n, 4)]++; }
    if (firstSpawn && g.timeLeft > 3) { if (n === 0) { gapNow += DT; gapMax = Math.max(gapMax, gapNow); } else gapNow = 0; }
    players.forEach((p, i) => {
      const f = p.fx, b = E.bodyBounds(p);
      for (const t of traps) if (t.age >= 0.6 && Math.hypot(t.x - b.cx, t.y - (b.cy + 50)) < 200) M.exposure[p.slot] += DT;
      // Status invariants.
      if (f.stun < 0 || f.stun > 4000 || f.reverse < 0 || f.reverse > 5000) M.invalid.push("range " + JSON.stringify(f));
      if ((f.stun > 0) !== !!p.frozen) M.invalid.push("frozen/stun mismatch round " + r);
      if (f.reverse !== undefined && (f.reverse > 0) !== !!p.reversed) M.invalid.push("reversed flag mismatch round " + r);
      if (f.stun === 4000 && prevStun[i] !== 4000) { M.sprung[p.slot]++; stunStart[p.slot] = frame; if (f.reverse > 0) M.reverseDuringStun++; }
      if (f.stun === 0 && prevStun[i] > 0 && stunStart[p.slot] >= 0) { M.stunDurations.push((frame - stunStart[p.slot]) * DT); stunStart[p.slot] = -1; }
      if (f.reverse === 5000 && prevRev[i] !== 5000) { M.reverseCollected++; if (prevRev[i] > 0) M.reverseRefreshes++; }
      if (prevRev[i] > 0 && f.reverse > prevRev[i] && f.reverse !== 5000) M.invalid.push("reverse grew without refresh");
    });
  }
  if (g.state !== "matchEnd") M.invalid.push("round " + r + " never ended");
  M.spawned.push(seenTraps.size); M.longestGap.push(gapMax); M.rejects += g.trapRejects || 0;
  M.reversePerRound.push(revThisRound);
  M.score.p1 += g.score.p1; M.score.p2 += g.score.p2; if (g.score.p1 === g.score.p2) M.ties++;
  g.destroy();
}

// Reverse droughts / repeats across the pickup sequence (the bag persists across rounds, as in the game).
let drought = 0, longest = 0, repeats = 0, revCount = 0;
M.pickupSeq.forEach((t, i) => {
  if (t === "reverse") { revCount++; longest = Math.max(longest, drought); drought = 0; if (M.pickupSeq[i - 1] === "reverse") repeats++; }
  else drought++;
});
longest = Math.max(longest, drought);

const sp = stats(M.spawned), gap = stats(M.longestGap), stun = M.stunDurations.length ? stats(M.stunDurations) : null;
const out = {
  config: { rounds: ROUNDS, mode: SOLO ? "solo" : "versus (2 bots)", file: fileArg || "js/coinrush.js", seed: SEED, roundSeconds: 60 },
  trapsSpawnedPerRound: { avg: +sp.avg.toFixed(2), median: sp.med, min: sp.min, max: sp.max },
  avgActiveTraps: { wholeRound: +(M.activeSum / M.liveFrames).toFixed(2), midLate: +(M.midActiveSum / M.midFrames).toFixed(2) },
  peakSimultaneous: M.peak,
  pctTime_wholeRound: [0, 1, 2, 3].map(n => +pct(M.timeAt[n], M.liveFrames).toFixed(1)),
  pctTime_midLate: [0, 1, 2, 3].map(n => +pct(M.midTimeAt[n], M.midFrames).toFixed(1)),
  pctTime_late: [0, 1, 2, 3].map(n => +pct(M.lateTimeAt[n], M.lateFrames).toFixed(1)),
  pct2plus_midLate: +pct(M.midTimeAt[2] + M.midTimeAt[3] + M.midTimeAt[4], M.midFrames).toFixed(1),
  longestTrapFreeGapSec: { avg: +gap.avg.toFixed(2), worst: +gap.max.toFixed(2), note: "after the first trap, excluding final 3 s" },
  rejectedUnsafeSpawns: { total: M.rejects, perRound: +(M.rejects / ROUNDS).toFixed(2) },
  trapsSprungPerRound: { p1: +(M.sprung.p1 / ROUNDS).toFixed(2), p2: +(M.sprung.p2 / ROUNDS).toFixed(2) },
  hazardExposureSecPerRound: { p1: +(M.exposure.p1 / ROUNDS).toFixed(2), p2: +(M.exposure.p2 / ROUNDS).toFixed(2), note: "armed trap within 200 px" },
  avgScore: { p1: +(M.score.p1 / ROUNDS).toFixed(2), p2: +(M.score.p2 / ROUNDS).toFixed(2) },
  stunSeconds: stun ? { count: M.stunDurations.length, min: +stun.min.toFixed(3), max: +stun.max.toFixed(3) } : null,
  reverse: {
    appearancesPerRound: +(revCount / ROUNDS).toFixed(2), pickupsTotal: M.pickupSeq.length,
    shareOfPickups: +pct(revCount, M.pickupSeq.length).toFixed(1),
    longestDroughtPickups: longest, backToBackRepeats: repeats,
    collected: M.reverseCollected, refreshedWhileActive: M.reverseRefreshes, stunnedWhileReversed: M.reverseDuringStun
  },
  invalidStateTransitions: M.invalid.length, invalidSamples: M.invalid.slice(0, 5)
};
console.log(JSON.stringify(out, null, 2));
