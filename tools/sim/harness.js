/* ==========================================================================
   ESA ARCADE - headless game harness (DEVELOPMENT ONLY - never loaded by
   index.html, no dependencies). Loads the REAL game scripts into a Node
   `vm` sandbox with a do-nothing DOM / audio / canvas, so simulations and
   tests exercise production code paths rather than a copy of them.

   Randomness: Math.random INSIDE the sandbox is replaced by a seeded PRNG
   (mulberry32) so runs are reproducible. Production RNG is untouched.

     const H = require("./harness");
     const env = H.load({ seed: 1, files: { "js/coinrush.js": "/path/to/other/coinrush.js" } });
     env.ESA ...   env.reseed(42)
   ========================================================================== */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..", "..");

const FILES = [
  "js/core.js", "js/characters.js", "js/participants.js", "js/controls.js",
  "js/dash.js", "js/clutch.js", "js/registry.js", "js/arena.js",
  "js/coinrush.js", "js/bonkbooth.js"
];

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value that is callable, constructible and has every property (all no-ops). */
function blackHole() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(t, k) {
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === "length") return 0;
      if (k === Symbol.iterator) return function* () {};
      if (k === "then") return undefined;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
    has() { return true; }
  });
  return proxy;
}

function load(opts) {
  opts = opts || {};
  const hole = blackHole();
  const store = () => { const m = new Map(); return {
    getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), clear: () => m.clear() }; };
  const fakeEl = () => ({ style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, setAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getContext() { return hole; }, width: 0, height: 0, textContent: "", innerHTML: "" });
  const document = {
    createElement: fakeEl, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, body: fakeEl(), documentElement: fakeEl(), hidden: false
  };
  const sandboxMath = Object.create(Math);
  let rng = mulberry32(opts.seed || 1);
  sandboxMath.random = () => rng();
  const window = {
    location: { search: "", hash: "" }, devicePixelRatio: 1, innerWidth: 1280, innerHeight: 720,
    addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {} }),
    localStorage: store(), sessionStorage: store(), navigator: { userAgent: "node", maxTouchPoints: 0 },
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, Image: function () { return fakeEl(); },
    Audio: function () { return hole; }, AudioContext: undefined
  };
  const ctx = {
    window, document, Math: sandboxMath, console, performance: { now: () => 0 },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {},
    requestAnimationFrame: () => 0, cancelAnimationFrame() {}, navigator: window.navigator,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage, Image: window.Image
  };
  window.window = window; window.document = document; window.Math = sandboxMath;
  vm.createContext(ctx);
  const files = Object.assign({}, opts.files || {});
  for (const rel of FILES) {
    const src = fs.readFileSync(files[rel] || path.join(ROOT, rel), "utf8");
    vm.runInContext(src.replace(/\(window\.ESA\);\s*$/, "(window.ESA);"), ctx, { filename: rel });
  }
  // The sandbox's `window` and global are separate objects: core.js writes window.ESA.
  const ESA = window.ESA;

  // Presentation is irrelevant headless: every UI / audio / stage call is a no-op,
  // except the countdown, which starts play immediately.
  ESA.Audio = hole;
  ESA.Stage = hole;
  ESA.Assets = hole;
  ESA.UI = new Proxy({}, { get(t, k) {
    if (k === "countdown") return function (timers, onGo) { if (onGo) onGo(); };
    return function () {};
  } });

  // Bots drive the shared control layer exactly where human input arrives.
  const intents = { p1: { x: 0, y: 0 }, p2: { x: 0, y: 0 } };
  ESA.Controls.vector = slot => intents[slot];

  return {
    ESA, intents,
    reseed(s) { rng = mulberry32(s); },
    random: () => rng()
  };
}

/** Two roster participants for a versus setup (or { p1 } for Solo). */
function setup(ESA, single) {
  const ch = ESA.Characters.list();
  const p1 = ESA.Participants.forVariant(ch[0].id, "normal").participantId;
  if (single) return { p1 };
  return { p1, p2: ESA.Participants.forVariant(ch[1].id, "normal").participantId };
}

module.exports = { load, setup, ROOT, mulberry32 };
