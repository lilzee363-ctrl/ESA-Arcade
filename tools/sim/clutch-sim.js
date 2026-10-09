/* ==========================================================================
   ESA ARCADE - CLUTCH outcome simulation (DEVELOPMENT ONLY)
     node tools/sim/clutch-sim.js real     [trials] [--only scenarioKey]
     node tools/sim/clutch-sim.js abstract [trials]
     node tools/sim/clutch-sim.js baseline [trials]   (full equal matches: Bonk score scale)

   Both modes start a head-to-head Bonk Booth match at 40% elapsed with a
   given deficit and play it out under four skill assumptions, once with
   CLUTCH and once without (same seeds), then compare outcomes.

   REAL:     the actual js/bonkbooth.js + js/clutch.js; "players" are bots
             with a log-normal reaction time measured from the moment a
             target starts to rise, a wrong-hole slip rate, a bomb-mistake
             rate, one press at a time (attention) and occasional late
             presses. Everything else - windows, queueing, penalties,
             CLUTCH - is the shipped code.
   ABSTRACT: a fast probability model of the same rules (same difficulty
             curve and window lengths, real ESA.Clutch for tier changes),
             ignoring overlapping targets and queue congestion.
   Neither models human psychology, fatigue, learning or tilt.
   ========================================================================== */
"use strict";

const H = require("./harness");
const args = process.argv.slice(2);
const MODE = args[0] || "abstract";
const TRIALS = Number(args[1]) || (MODE === "abstract" ? 20000 : 3000);
const ONLY = args.indexOf("--only") >= 0 ? args[args.indexOf("--only") + 1] : null;
// --variant activeOnly: what-if CLUTCH did NOT stretch the wind-up (tell) - comparison only.
const VARIANT = args.indexOf("--variant") >= 0 ? args[args.indexOf("--variant") + 1] : null;
const env = H.load({ seed: 1 });
const E = env.ESA;
const rnd = () => env.random();
const DT = 1 / 60;
const MATCH = 42, START_AT = 0.4;

/** log-normal reaction time with the given median and spread. */
function rt(median, sigma) {
  const u = Math.max(1e-12, rnd()), v = rnd();
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return median * Math.exp(sigma * z);
}

// Skill profiles: rt = median reaction (s), slip = wrong-hole chance per target,
// bomb = chance of hitting a bomb, late = chance of pressing anyway once too late.
const P = (rt, slip, bomb) => ({ rt, sigma: 0.28, slip, bomb, late: 0.35 });
const SKILL = {
  A_equal:          { label: "A equal future play",            leader: P(0.52, 0.04, 0.08), trailer: P(0.52, 0.04, 0.08) },
  B_leaderSmall:    { label: "B leader slightly better",       leader: P(0.50, 0.035, 0.07), trailer: P(0.55, 0.045, 0.09) },
  C_leaderModerate: { label: "C leader moderately better",     leader: P(0.47, 0.03, 0.06), trailer: P(0.60, 0.06, 0.11) },
  D_trailerBetter:  { label: "D trailer now playing better",   leader: P(0.55, 0.045, 0.09), trailer: P(0.48, 0.03, 0.06) }
};
const GAPS = { mild: 3, substantial: 6, severe: 11 };

/* ================================================================== *
 * REAL: drive the shipped Bonk Booth with bots.
 * ================================================================== */
function makeBot(g, side, prof) {
  const plan = new Map();          // target -> { at, hole, kind }
  let busyUntil = -1;
  return function tick() {
    const now = g.clock;
    for (const t of g.targets[side]) {
      if (plan.has(t) || t.phase === "tell") continue;
      // First frame this target is visibly rising: decide what this player will do.
      let at = now + rt(prof.rt, prof.sigma);
      at = Math.max(at, busyUntil + 0.16);            // one press at a time
      if (t.type === "bomb") { plan.set(t, rnd() < prof.bomb ? { at, hole: t.hole } : { at: Infinity }); continue; }
      if (rnd() < prof.slip) {
        const wrong = [0, 1, 2].filter(h => h !== t.hole)[Math.floor(rnd() * 2)];
        plan.set(t, { at, hole: wrong, then: { at: at + 0.22, hole: t.hole } });
      } else plan.set(t, { at, hole: t.hole });
      busyUntil = plan.get(t).then ? plan.get(t).then.at : at;
    }
    for (const [t, p] of plan) {
      if (p.at > now) continue;
      const alive = g.targets[side].includes(t);
      const up = alive && !t.resolved && !t.attempted && (t.phase === "rise" || t.phase === "active" || (t.phase === "retreat" && t.rise >= 0.5));
      if (p.hole === t.hole && !up) {
        if (rnd() < prof.late) g.attempt(side, p.hole);   // a too-late swing: -1 (or "EARLY"/ignored)
      } else g.attempt(side, p.hole);
      if (p.then) { plan.set(t, p.then); } else plan.set(t, { at: Infinity });
      if (!alive) plan.delete(t);
    }
    for (const t of plan.keys()) if (!g.targets[side].includes(t) && plan.get(t).at === Infinity) plan.delete(t);
  };
}

function realTrial(seed, gap, skill, withClutch, leaderSide, startAt) {
  env.reseed(seed);
  const g = new E.BonkBooth({ endMatch() {}, context: { mode: "casual" } }, H.setup(E));
  g.start();
  if (!withClutch) g.clutch = null;
  if (VARIANT === "activeOnly" && g.clutch) {
    const fill = g.fill.bind(g);
    g.fill = function (side) {
      const n = this.targets[side].length, b = this.clutch.bonus(side);
      fill(side);
      this.targets[side].slice(n).forEach(t => { if (t.type === "normal" && b > 0) t.tellFor /= (1 + b); });
    };
  }
  const trailerSide = leaderSide === "p1" ? "p2" : "p1";
  // Lead-in: equal players up to the scenario point, then the deficit is imposed.
  const eq = SKILL.A_equal.leader;
  let bots = { p1: makeBot(g, "p1", eq), p2: makeBot(g, "p2", eq) };
  const stats = { assistedSec: 0, pops: { leader: 0, trailer: 0 } };
  const startLeft = MATCH * (1 - (startAt === undefined ? START_AT : startAt));
  let f = 0, imposed = gap === null;
  while (g.state === "playing" && f < 60 * 60) {
    if (!imposed && g.timeLeft <= startLeft) {
      imposed = true;
      const base = Math.max(g.score.p1, g.score.p2);
      g.score[leaderSide] = base + gap; g.score[trailerSide] = base;
      if (g.clutch) g.clutch.update(g.score);
      bots = { [leaderSide]: makeBot(g, leaderSide, skill.leader), [trailerSide]: makeBot(g, trailerSide, skill.trailer) };
    }
    bots.p1(); bots.p2();
    g.update(DT, f * 16.67);
    if (imposed && g.clutch && g.clutch.bonus(trailerSide) > 0) stats.assistedSec += DT;
    f++;
  }
  return { lead: g.score[leaderSide], trail: g.score[trailerSide], stats };
}

/* ================================================================== *
 * ABSTRACT: per-event probability model of the same rules.
 * ================================================================== */
const CURVE = {     // copied from js/bonkbooth.js CURVE (seconds)
  interval: [[1.2, 1.45], [0.5, 0.64]], rise: [0.18, 0.11], active: [[0.95, 1.15], [0.46, 0.56]],
  retreat: [0.2, 0.14], bomb: [0.12, 0.22]
};
const lerp = (a, b, t) => a + (b - a) * t;
const rr = (r) => lerp(r[0], r[1], rnd());
function abstractTrial(seed, gap, skill, withClutch) {
  env.reseed(seed);
  const tiers = { tiers: [{ gap: 5, bonus: 0.08 }, { gap: 10, bonus: 0.15 }], hold: 2 };
  const live = new E.BonkBooth({ endMatch() {}, context: { mode: "casual" } }, H.setup(E)).clutch;   // real config
  const c = withClutch ? E.Clutch.create({ tiers: live.tiers, hold: live.hold }) : null;
  void tiers;
  const sc = { L: 20 + gap, T: 20 };
  let clock = MATCH * START_AT;
  const one = (prof, k, bonus, ev) => {
    if (ev.bomb) return rnd() < prof.bomb ? -2 : 0;
    let d = 0;
    if (rnd() < prof.slip) d -= 1;
    const win = ev.rise + ev.active * (1 + bonus) + ev.retreat * 0.5;
    if (rt(prof.rt, prof.sigma) <= win) d += 1; else if (rnd() < prof.late) d -= 1;
    return d;
  };
  let assisted = 0;
  while (clock < MATCH) {
    const p = clock / MATCH, k = p * p * (3 - 2 * p);
    const ev = { bomb: rnd() < lerp(CURVE.bomb[0], CURVE.bomb[1], k), rise: lerp(CURVE.rise[0], CURVE.rise[1], k),
                 active: lerp(rr(CURVE.active[0]), rr(CURVE.active[1]), k), retreat: lerp(CURVE.retreat[0], CURVE.retreat[1], k) };
    const bonusT = c ? c.bonus("p2") : 0;
    if (bonusT > 0) assisted++;
    sc.L += one(skill.leader, k, c ? c.bonus("p1") : 0, ev);
    sc.T += one(skill.trailer, k, bonusT, ev);
    if (c) c.update({ p1: sc.L, p2: sc.T });
    clock += lerp(rr(CURVE.interval[0]), rr(CURVE.interval[1]), k);
  }
  return { lead: sc.L, trail: sc.T, stats: { assistedEvents: assisted } };
}

/* ================================================================== */
function summarize(rows) {
  const n = rows.length;
  const w = rows.filter(r => r.lead > r.trail).length, l = rows.filter(r => r.trail > r.lead).length;
  const gaps = rows.map(r => r.lead - r.trail);
  return {
    leaderWin: +(100 * w / n).toFixed(1), trailerWin: +(100 * l / n).toFixed(1), tie: +(100 * (n - w - l) / n).toFixed(1),
    avgFinalGap: +(gaps.reduce((a, b) => a + b, 0) / n).toFixed(2),
    blowout10plus: +(100 * gaps.filter(x => x >= 10).length / n).toFixed(1)
  };
}

if (MODE === "baseline") {
  const rows = [];
  for (let i = 0; i < TRIALS; i++) rows.push(realTrial(9000 + i, null, SKILL.A_equal, true, "p1"));
  const s = rows.map(r => [r.lead, r.trail]).flat().sort((a, b) => a - b);
  const d = rows.map(r => Math.abs(r.lead - r.trail)).sort((a, b) => a - b);
  const q = (a, x) => a[Math.floor(x * (a.length - 1))];
  console.log(JSON.stringify({ trials: TRIALS, finalScore: { avg: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(1), p10: q(s, 0.1), median: q(s, 0.5), p90: q(s, 0.9) },
    finalGapBetweenEqualBots: { median: q(d, 0.5), p75: q(d, 0.75), p90: q(d, 0.9), p97: q(d, 0.97) } }, null, 2));
  // Gap at 40% elapsed between equal bots (how often CLUTCH would even trigger naturally).
  return;
}

const out = [];
for (const sk of Object.keys(SKILL)) for (const gk of Object.keys(GAPS)) {
  const key = sk + "/" + gk;
  if (ONLY && !key.includes(ONLY)) continue;
  const res = {};
  for (const withC of [false, true]) {
    const rows = [];
    for (let i = 0; i < TRIALS; i++) {
      const seed = 1000003 * (Object.keys(GAPS).indexOf(gk) + 1) + 7919 * (Object.keys(SKILL).indexOf(sk) + 1) + i;
      rows.push(MODE === "real" ? realTrial(seed, GAPS[gk], SKILL[sk], withC, i % 2 ? "p2" : "p1")
                                : abstractTrial(seed, GAPS[gk], SKILL[sk], withC));
    }
    res[withC ? "clutch" : "none"] = summarize(rows);
    if (withC) res.clutch.assisted = +(rows.reduce((a, r) => a + (r.stats.assistedSec || r.stats.assistedEvents || 0), 0) / rows.length).toFixed(2);
  }
  res.deltaComebackPts = +(res.clutch.trailerWin - res.none.trailerWin).toFixed(1);
  res.deltaAvgGap = +(res.clutch.avgFinalGap - res.none.avgFinalGap).toFixed(2);
  out.push({ scenario: key, skill: SKILL[sk].label, startDeficit: GAPS[gk], trials: TRIALS, ...res });
}
console.log(JSON.stringify({ mode: MODE, variant: VARIANT, startAtElapsed: START_AT, results: out }, null, 1));
