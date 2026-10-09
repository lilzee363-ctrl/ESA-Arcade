/* ==========================================================================
   ESA ARCADE - Solo SESSION STATS
   What happened in Solo during THIS browser session. No accounts, no
   server, no global leaderboard.

   Storage: sessionStorage "esaArcade.soloStats.v1" - survives a refresh
   and in-site navigation in the same tab, gone with the tab. Never
   localStorage (that holds touch-control preferences only; the two are
   never mixed). Contents are plain gameplay counters plus the display
   names the player already chose - nothing sensitive. (Data saved by the
   first Solo build, shape v1, is migrated into the Versus record.)

   Two separate records, because they measure different things:

   VERSUS RECORD  (soloModeType "cpu-versus": Air Hockey, Bomb Pass)
     W / D / L      per match, from the human's point of view
     win streak     win +1, loss -> 0, DRAW leaves it unchanged (it neither
                    extends nor breaks a run). Best streak = max ever.
     win rate       wins / matches (draws count as matches, not wins)
     HARD CPU DEFEATED  +1 for every WIN against a Hard CPU, in any
                    CPU-versus game. Never for Score Attack, Easy, Normal,
                    a draw, a loss or an abandoned match.
     kept overall, per difficulty, per game and per human participant
     (participantId - Zima / Evil Zima / each Guest are separate).

   SCORE ATTACK   (soloModeType "score-attack": Coin Rush, Bonk Booth, and
                   any future game that reports a numeric score)
     per game: attempts, latest score, best score this session.
     A Score Attack run NEVER touches W/D/L, streaks or Hard CPU Defeated.

   Exactly once: every Solo match / run gets a unique matchId when it
   starts; both record calls refuse an id they have already seen, and the
   seen ids are saved with the stats, so a duplicate callback, a rematch,
   back navigation or a refresh can never count the same result twice.
   Only COMPLETED matches / runs are recorded - quitting or restarting
   records nothing (there are no forfeits and no partial runs).
   ========================================================================== */

(function (ESA) {
  "use strict";

  var KEY = "esaArcade.soloStats.v1";
  var MAX_IDS = 400;                 // seen matchIds kept (plenty for a session)
  var DIFFS = ["easy", "normal", "hard"];
  var GAME_ID = /^[A-Za-z0-9_-]{1,40}$/;

  function wdl() { return { w: 0, d: 0, l: 0 }; }

  function freshVersus() {
    var byDiff = {};
    DIFFS.forEach(function (d) { byDiff[d] = wdl(); });
    return {
      overall: wdl(),
      streak: 0,
      bestStreak: 0,
      hardDefeated: 0,
      byDifficulty: byDiff,
      byGame: {},
      byPlayer: {},                  // participantId -> { name, evil, guest, w, d, l, order }
      last: null                     // "w" | "d" | "l"
    };
  }

  function fresh() {
    return {
      v: 2,
      versus: freshVersus(),
      scoreAttack: {},               // gameId -> { attempts, latest, best, order }
      seen: []
    };
  }

  function int(v) { v = Math.floor(Number(v)); return isFinite(v) && v > 0 ? Math.min(v, 1e6) : 0; }
  function signed(v) { v = Math.round(Number(v)); return isFinite(v) ? Math.max(-1e6, Math.min(v, 1e6)) : 0; }
  function cleanWdl(o) { o = o || {}; return { w: int(o.w), d: int(o.d), l: int(o.l) }; }

  /** Versus block, from either a v2 `versus` object or a whole v1 save. */
  function cleanVersus(raw) {
    var s = freshVersus();
    if (!raw || typeof raw !== "object") return s;
    s.overall = cleanWdl(raw.overall);
    s.streak = int(raw.streak);
    s.bestStreak = Math.max(int(raw.bestStreak), s.streak);
    s.hardDefeated = int(raw.hardDefeated);
    DIFFS.forEach(function (d) { s.byDifficulty[d] = cleanWdl(raw.byDifficulty && raw.byDifficulty[d]); });
    var games = raw.byGame && typeof raw.byGame === "object" ? raw.byGame : {};
    Object.keys(games).slice(0, 50).forEach(function (id) {
      if (GAME_ID.test(id)) s.byGame[id] = cleanWdl(games[id]);
    });
    var players = raw.byPlayer && typeof raw.byPlayer === "object" ? raw.byPlayer : {};
    Object.keys(players).slice(0, 100).forEach(function (id) {
      var p = players[id];
      if (!/^participant-\d{2,4}$/.test(id) || !p) return;
      var rec = cleanWdl(p);
      rec.name = ESA.Participants ? ESA.Participants.cleanName(p.name) : String(p.name || "").slice(0, 16);
      rec.evil = p.evil === true;
      rec.guest = p.guest === true;
      rec.order = int(p.order);
      s.byPlayer[id] = rec;
    });
    s.last = raw.last === "w" || raw.last === "d" || raw.last === "l" ? raw.last : null;
    return s;
  }

  /** Accept only the shapes we write; anything odd falls back to zero. */
  function sanitize(raw) {
    var s = fresh();
    if (!raw || typeof raw !== "object") return s;
    if (raw.v === 1) {
      s.versus = cleanVersus(raw);             // first Solo build: versus only
    } else if (raw.v === 2) {
      s.versus = cleanVersus(raw.versus);
      var sa = raw.scoreAttack && typeof raw.scoreAttack === "object" ? raw.scoreAttack : {};
      Object.keys(sa).slice(0, 50).forEach(function (id) {
        var g = sa[id];
        if (!GAME_ID.test(id) || !g || !int(g.attempts)) return;
        s.scoreAttack[id] = { attempts: int(g.attempts), latest: signed(g.latest), best: signed(g.best), order: int(g.order) };
      });
    } else {
      return s;
    }
    s.seen = Array.isArray(raw.seen)
      ? raw.seen.filter(function (x) { return typeof x === "string" && x.length < 80; }).slice(-MAX_IDS)
      : [];
    return s;
  }

  var state = null;

  function load() {
    if (state) return state;
    var raw = null;
    try { raw = window.sessionStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    try { state = sanitize(raw ? JSON.parse(raw) : null); } catch (e) { state = fresh(); }
    return state;
  }

  function save() {
    try { window.sessionStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
  }

  function bump(rec, outcome) { rec[outcome] = (rec[outcome] || 0) + 1; }

  /** Marks an id as counted. false if it already was (or is missing). */
  function claim(s, matchId) {
    if (!matchId || typeof matchId !== "string" || s.seen.indexOf(matchId) >= 0) return false;
    s.seen.push(matchId);
    if (s.seen.length > MAX_IDS) s.seen.splice(0, s.seen.length - MAX_IDS);
    return true;
  }

  var matchSeq = 0;

  ESA.SoloStats = {
    KEY: KEY,

    /** A unique id for a Solo match / run about to start. */
    newMatchId: function () {
      matchSeq++;
      return "solo-" + Date.now().toString(36) + "-" + matchSeq + "-" + Math.random().toString(36).slice(2, 7);
    },

    hasRecorded: function (matchId) { return load().seen.indexOf(matchId) >= 0; },

    /**
     * Records one completed CPU-VERSUS match. r = {
     *   matchId, gameId, difficulty, outcome: "w" | "d" | "l",
     *   participant (the HUMAN participant object)
     * }
     * Returns { recorded, firstHardWin, snapshot } - recorded is false (and
     * nothing changes) for an id that was already counted.
     */
    record: function (r) {
      var s = load();
      if (!r || !claim(s, r.matchId)) {
        return { recorded: false, firstHardWin: false, snapshot: this.snapshot() };
      }
      var v = s.versus;
      var o = r.outcome === "w" || r.outcome === "d" ? r.outcome : "l";
      var diff = DIFFS.indexOf(r.difficulty) >= 0 ? r.difficulty : "normal";

      bump(v.overall, o);
      bump(v.byDifficulty[diff], o);
      var gid = GAME_ID.test(r.gameId || "") ? r.gameId : "unknown";
      if (!v.byGame[gid]) v.byGame[gid] = wdl();
      bump(v.byGame[gid], o);

      var p = r.participant;
      if (p && p.participantId && /^participant-\d{2,4}$/.test(p.participantId)) {
        var rec = v.byPlayer[p.participantId];
        if (!rec) {
          rec = v.byPlayer[p.participantId] = wdl();
          rec.order = Object.keys(v.byPlayer).length;
        }
        rec.name = p.displayName;
        rec.evil = p.type === "roster" && p.variant === "evil";
        rec.guest = p.type === "guest";
        bump(rec, o);
      }

      // Streaks: a draw neither extends nor breaks the run.
      if (o === "w") { v.streak++; v.bestStreak = Math.max(v.bestStreak, v.streak); }
      else if (o === "l") v.streak = 0;
      v.last = o;

      // Hard CPU Defeated: any CPU-versus game, Hard, human WIN only.
      var firstHardWin = false;
      if (o === "w" && diff === "hard") {
        v.hardDefeated++;
        firstHardWin = v.hardDefeated === 1;
      }
      save();
      return { recorded: true, firstHardWin: firstHardWin, snapshot: this.snapshot() };
    },

    /**
     * Records one completed SCORE ATTACK run. r = { matchId, gameId, score }.
     * Returns { recorded, newBest, attempts, latest, best, previousBest }.
     * Never touches the Versus record.
     */
    recordScore: function (r) {
      var s = load();
      var gid = r && GAME_ID.test(r.gameId || "") ? r.gameId : null;
      var cur = gid ? s.scoreAttack[gid] : null;
      if (!gid || !claim(s, r.matchId)) {
        return { recorded: false, newBest: false, attempts: cur ? cur.attempts : 0,
                 latest: cur ? cur.latest : null, best: cur ? cur.best : null, previousBest: cur ? cur.best : null };
      }
      var score = signed(r.score);
      var prev = cur ? cur.best : null;
      if (!cur) cur = s.scoreAttack[gid] = { attempts: 0, latest: 0, best: score, order: Object.keys(s.scoreAttack).length };
      cur.attempts++;
      cur.latest = score;
      var newBest = prev === null || score > prev;
      if (newBest) cur.best = score;
      save();
      return { recorded: true, newBest: newBest, attempts: cur.attempts, latest: score, best: cur.best, previousBest: prev };
    },

    /** Best Score Attack result this session for a game, or null. */
    best: function (gameId) {
      var g = load().scoreAttack[gameId];
      return g ? g.best : null;
    },

    /** Read-only copy for screens. Versus fields stay at the top level. */
    snapshot: function () {
      var v = load().versus;
      var n = v.overall.w + v.overall.d + v.overall.l;
      var players = Object.keys(v.byPlayer).map(function (id) {
        var p = v.byPlayer[id];
        return { participantId: id, name: p.name, evil: p.evil, guest: p.guest, w: p.w, d: p.d, l: p.l, order: p.order };
      }).sort(function (a, b) { return a.order - b.order; });
      var sa = load().scoreAttack;
      var scores = Object.keys(sa).map(function (id) {
        var g = sa[id];
        return { gameId: id, attempts: g.attempts, latest: g.latest, best: g.best, order: g.order };
      }).sort(function (a, b) { return a.order - b.order; });
      var runs = 0;
      scores.forEach(function (g) { runs += g.attempts; });
      return {
        overall: cleanWdl(v.overall),
        matches: n,
        winRate: n ? v.overall.w / n : 0,
        streak: v.streak,
        bestStreak: v.bestStreak,
        hardDefeated: v.hardDefeated,
        byDifficulty: { easy: cleanWdl(v.byDifficulty.easy), normal: cleanWdl(v.byDifficulty.normal), hard: cleanWdl(v.byDifficulty.hard) },
        byGame: JSON.parse(JSON.stringify(v.byGame)),
        players: players,
        last: v.last,
        scoreAttack: scores,
        runs: runs
      };
    },

    /** "6W - 1D - 3L" */
    line: function (r) { return r.w + "W - " + r.d + "D - " + r.l + "L"; },

    /** "61.5%" */
    pct: function (x) { return (Math.round(x * 1000) / 10).toFixed(1).replace(/\.0$/, "") + "%"; },

    /** Dev/testing only: wipe this session's Solo record. */
    _reset: function () { state = fresh(); save(); }
  };

})(window.ESA);
