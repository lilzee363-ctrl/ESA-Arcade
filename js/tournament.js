/* ==========================================================================
   ESA ARCADE - TOURNAMENT MANAGER (pure logic, no DOM)
   Owns the format, pairings, byes, the game draw, results, standings and
   the knockout bracket. Minigames never touch this directly: the app
   reports each finished match through recordResult() exactly once.

   FORMAT (Champions-League style: short league, then knockouts)
     2 players      2 league rounds  -> Final
     3 players      3 league rounds  -> Final (top 2)
     4-11 players   3 league rounds  -> Semifinals (top 4)
     12+ players    4 league rounds  -> Quarterfinals (top 8)
   Nobody plays more than one match per round, so nobody plays more than
   4 league matches. Odd player counts give one bye per round; a bye counts
   as a win (3 points, Swiss convention) so everyone ends the league with
   the same number of results. Byes rotate before anyone gets a second.

   SCORING   win 3 · tie 1 · loss 0 · bye 3
   TIEBREAK  points -> wins -> score differential -> drawn lots

   IDENTITY  Every id in here is a PARTICIPANT id (js/participants.js),
             never a character id - Normal Zima and Evil Zima are two
             separate players with separate records. Up to
             MAX_PARTICIPANTS (25) per tournament; the format above already
             scales to that (verified 2-25: no self-pairing, no double
             booking, no league rematches beyond the 2-player case).
   ========================================================================== */

(function (root) {
  "use strict";

  var ESA = root.ESA = root.ESA || {};

  var POINTS = { win: 3, draw: 1, loss: 0, bye: 3 };
  var MAX_PARTICIPANTS = 25;
  var KO_NAMES = { 8: "Quarterfinals", 4: "Semifinals", 2: "The Final" };

  function shuffle(arr, rng) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /** Format for n players, or null if n is too small to hold a tournament. */
  function formatFor(n) {
    if (n < 2) return null;
    var leagueRounds, qualifiers;
    if (n === 2)       { leagueRounds = 2; qualifiers = 2; }
    else if (n === 3)  { leagueRounds = 3; qualifiers = 2; }
    else if (n <= 11)  { leagueRounds = 3; qualifiers = 4; }
    else               { leagueRounds = 4; qualifiers = 8; }

    var ko = [];
    for (var q = qualifiers; q >= 2; q /= 2) ko.push(KO_NAMES[q]);
    return {
      players: n,
      leagueRounds: leagueRounds,
      qualifiers: qualifiers,
      knockoutRounds: ko,
      hasBye: n % 2 === 1
    };
  }

  /** Standard bracket seeding so the top seeds can only meet late. */
  function seedOrder(q) {
    var arr = [1, 2];
    while (arr.length < q) {
      var next = [], size = arr.length * 2 + 1;
      for (var i = 0; i < arr.length; i++) next.push(arr[i], size - arr[i]);
      arr = next;
    }
    return arr;
  }

  /* ================================================================== *
   * Tournament
   * ================================================================== */

  /**
   * @param {string[]} participants  participant ids, no duplicates (max 25)
   * @param {object}   opts          { gamePool: () => string[], rng: () => number }
   */
  function Tournament(participants, opts) {
    opts = opts || {};
    var seen = Object.create(null);
    var ids = [];
    (participants || []).forEach(function (id) {
      if (id && !seen[id]) { seen[id] = true; ids.push(id); }
    });

    this.format = formatFor(ids.length);
    if (!this.format) throw new Error("A tournament needs at least 2 participants.");
    if (ids.length > MAX_PARTICIPANTS) throw new Error("A tournament holds at most " + MAX_PARTICIPANTS + " participants.");

    this.rng = opts.rng || Math.random;
    this.gamePool = opts.gamePool || function () { return []; };
    this.participants = ids;
    this.phase = "league";            // league | knockout | complete
    this.rounds = [];
    this.gameHistory = [];            // game id per round, in draw order
    this.champion = null;
    this._matchSeq = 0;
    this._met = Object.create(null);  // "a|b" -> times played

    // Hidden lots, only ever used as the last tiebreak.
    var lots = shuffle(ids.map(function (_, i) { return i; }), this.rng);
    this.table = Object.create(null);
    for (var i = 0; i < ids.length; i++) {
      this.table[ids[i]] = {
        id: ids[i], played: 0, wins: 0, draws: 0, losses: 0, byes: 0,
        points: 0, scoreFor: 0, scoreAgainst: 0, lot: lots[i]
      };
    }

    this._createLeagueRound();
  }

  var T = Tournament.prototype;

  /* --- Queries ------------------------------------------------------ */

  T.currentRound = function () { return this.rounds[this.rounds.length - 1] || null; };

  T.leagueRounds = function () {
    return this.rounds.filter(function (r) { return r.kind === "league"; });
  };

  T.knockoutRounds = function () {
    return this.rounds.filter(function (r) { return r.kind === "ko"; });
  };

  T.nextMatch = function () {
    var r = this.currentRound();
    if (!r) return null;
    for (var i = 0; i < r.matches.length; i++) {
      if (r.matches[i].status === "pending") return r.matches[i];
    }
    return null;
  };

  T.findMatch = function (id) {
    for (var i = 0; i < this.rounds.length; i++) {
      var ms = this.rounds[i].matches;
      for (var j = 0; j < ms.length; j++) if (ms[j].id === id) return ms[j];
    }
    return null;
  };

  T.roundOf = function (match) { return this.rounds[match.roundIndex]; };

  T.isFinal = function (round) {
    round = round || this.currentRound();
    return !!round && round.kind === "ko" && round.matches.length === 1;
  };

  T.matchesPlayedBy = function (id) {
    var n = 0;
    this.rounds.forEach(function (r) {
      r.matches.forEach(function (m) {
        if (m.status === "done" && (m.a === id || m.b === id)) n++;
      });
    });
    return n;
  };

  T.timesMet = function (a, b) { return this._met[key(a, b)] || 0; };

  function key(a, b) { return a < b ? a + "|" + b : b + "|" + a; }

  /** Rows sorted by points, wins, differential, then lots. */
  T.standings = function () {
    var rows = this.participants.map(function (id) {
      var r = this.table[id];
      var copy = {};
      for (var k in r) copy[k] = r[k];
      copy.diff = r.scoreFor - r.scoreAgainst;
      return copy;
    }, this);

    rows.sort(compareRows);

    // Flag rows whose order was only settled by the drawn lots.
    for (var i = 0; i < rows.length; i++) {
      rows[i].position = i + 1;
      rows[i].decidedByLot = false;
    }
    for (var j = 1; j < rows.length; j++) {
      if (sameOnMerit(rows[j - 1], rows[j])) {
        rows[j - 1].decidedByLot = true;
        rows[j].decidedByLot = true;
      }
    }
    return rows;
  };

  function compareRows(a, b) {
    return (b.points - a.points) ||
           (b.wins - a.wins) ||
           (b.diff - a.diff) ||
           (a.lot - b.lot);
  }

  function sameOnMerit(a, b) {
    return a.points === b.points && a.wins === b.wins && a.diff === b.diff;
  }

  T.standingsOrder = function () {
    return this.standings().map(function (r) { return r.id; });
  };

  /* --- Round creation ----------------------------------------------- */

  T._newRound = function (kind, name, number) {
    var r = {
      index: this.rounds.length,
      kind: kind,             // league | ko
      number: number,         // 1-based within its phase
      name: name,
      gameId: null,
      matches: [],
      byes: [],
      complete: false,
      startOrder: this.standingsOrder()
    };
    this.rounds.push(r);
    return r;
  };

  T._newMatch = function (round, a, b) {
    var m = {
      id: "m" + (++this._matchSeq),
      roundIndex: round.index,
      a: a, b: b,
      status: "pending",
      winner: null,
      scoreA: 0, scoreB: 0,
      draw: false,
      replays: 0
    };
    round.matches.push(m);
    return m;
  };

  T._createLeagueRound = function () {
    var number = this.leagueRounds().length + 1;
    var round = this._newRound("league", "Round " + number, number);

    // Round 1 is a blind draw; later rounds pair players on similar points.
    var order = number === 1
      ? shuffle(this.participants.slice(), this.rng)
      : this.standingsOrder();

    var pairs;

    // Odd count: one player sits out. Candidates are those with the fewest
    // byes, lowest-ranked first; take the first whose absence still allows
    // a rematch-free pairing of everybody else.
    if (order.length % 2 === 1) {
      var table = this.table;
      var fewest = Infinity;
      order.forEach(function (id) { fewest = Math.min(fewest, table[id].byes); });
      var candidates = order.filter(function (id) { return table[id].byes === fewest; }).reverse();

      var byeId = candidates[0];
      for (var c = 0; c < candidates.length; c++) {
        var rest = order.filter(function (id) { return id !== candidates[c]; });
        var clean = this._pairWithBudget(rest, 0);
        if (clean) { byeId = candidates[c]; pairs = clean; break; }
      }

      order = order.filter(function (id) { return id !== byeId; });
      round.byes.push(byeId);
      table[byeId].byes += 1;
      table[byeId].points += POINTS.bye;
    }

    if (!pairs) pairs = this._pairAvoidingRematches(order);
    for (var p = 0; p < pairs.length; p++) this._newMatch(round, pairs[p][0], pairs[p][1]);
    return round;
  };

  /**
   * Backtracking pairing. First tries with zero rematches, then allows the
   * smallest number of rematches that makes a full pairing possible (only
   * happens with very small fields, e.g. 2 players).
   */
  T._pairAvoidingRematches = function (order) {
    for (var budget = 0; budget <= order.length / 2; budget++) {
      var result = this._pairWithBudget(order, budget);
      if (result) return result;
    }
    // Unreachable in practice; pair in order as a last resort.
    var out = [];
    for (var i = 0; i + 1 < order.length; i += 2) out.push([order[i], order[i + 1]]);
    return out;
  };

  /** Full pairing using at most `budget` rematches, or null. */
  T._pairWithBudget = function (order, budget) {
    var self = this;
    var steps = 0;              // hard cap so a huge field can never hang the page
    return solve(order.slice(), budget);

    function solve(rest, budgetLeft) {
      if (rest.length === 0) return [];
      if (++steps > 50000) return null;
      var a = rest[0];
      for (var j = 1; j < rest.length; j++) {
        var b = rest[j];
        var cost = self.timesMet(a, b) > 0 ? 1 : 0;
        if (cost > budgetLeft) continue;
        var remaining = rest.slice(1, j).concat(rest.slice(j + 1));
        var sub = solve(remaining, budgetLeft - cost);
        if (sub) return [[a, b]].concat(sub);
      }
      return null;
    }
  };

  T._createKnockoutRound = function (entrants) {
    var size = entrants.length;
    var number = this.knockoutRounds().length + 1;
    var round = this._newRound("ko", KO_NAMES[size] || ("Round of " + size), number);
    for (var i = 0; i + 1 < entrants.length; i += 2) {
      this._newMatch(round, entrants[i], entrants[i + 1]);
    }
    return round;
  };

  /* --- Game draw ---------------------------------------------------- */

  /**
   * Draws the game for the current round (once - repeat calls return the
   * same game). The previous round's game is excluded whenever another
   * eligible game exists, and games played less often weigh more.
   */
  T.drawGame = function () {
    var round = this.currentRound();
    var pool = this.gamePool().slice();
    var previous = this.gameHistory[this.gameHistory.length - 1] || null;

    if (round.gameId) {
      return { gameId: round.gameId, pool: pool, excluded: null, alreadyDrawn: true };
    }
    if (!pool.length) return { gameId: null, pool: [], excluded: null };

    var eligible = pool.filter(function (g) { return g !== previous; });
    var excluded = eligible.length < pool.length ? previous : null;
    if (!eligible.length) { eligible = pool; excluded = null; }

    var history = this.gameHistory;
    var weights = eligible.map(function (g) {
      var plays = 0;
      for (var i = 0; i < history.length; i++) if (history[i] === g) plays++;
      return 1 / (1 + plays);
    });
    var total = weights.reduce(function (s, w) { return s + w; }, 0);
    var roll = this.rng() * total;
    var pick = eligible[eligible.length - 1];
    for (var k = 0; k < eligible.length; k++) {
      roll -= weights[k];
      if (roll <= 0) { pick = eligible[k]; break; }
    }

    round.gameId = pick;
    this.gameHistory.push(pick);
    return { gameId: pick, pool: eligible, excluded: excluded, alreadyDrawn: false };
  };

  /* --- Results ------------------------------------------------------ */

  /**
   * Records a finished match. Safe to call twice: the second call is
   * ignored. A tied knockout match is not recorded - it must be replayed.
   *
   * @param {string} matchId
   * @param {object} res  { winner: participantId | null, scoreA, scoreB }
   * @returns {object} { ok, reason?, replay?, roundComplete? }
   */
  T.recordResult = function (matchId, res) {
    var m = this.findMatch(matchId);
    if (!m) return { ok: false, reason: "unknown-match" };
    if (m.status === "done") return { ok: false, reason: "already-recorded" };

    var round = this.rounds[m.roundIndex];
    if (round !== this.currentRound()) return { ok: false, reason: "not-current-round" };

    var winner = res && res.winner;
    if (winner && winner !== m.a && winner !== m.b) return { ok: false, reason: "bad-winner" };

    if (round.kind === "ko" && !winner) {
      m.replays += 1;
      return { ok: true, replay: true };
    }

    m.status = "done";
    m.winner = winner || null;
    m.draw = !winner;
    m.scoreA = toInt(res.scoreA);
    m.scoreB = toInt(res.scoreB);
    this._met[key(m.a, m.b)] = (this._met[key(m.a, m.b)] || 0) + 1;

    if (round.kind === "league") {
      var A = this.table[m.a], B = this.table[m.b];
      A.played++; B.played++;
      A.scoreFor += m.scoreA; A.scoreAgainst += m.scoreB;
      B.scoreFor += m.scoreB; B.scoreAgainst += m.scoreA;
      if (!winner) {
        A.draws++; B.draws++;
        A.points += POINTS.draw; B.points += POINTS.draw;
      } else {
        var W = winner === m.a ? A : B, L = winner === m.a ? B : A;
        W.wins++; L.losses++;
        W.points += POINTS.win; L.points += POINTS.loss;
      }
    }

    round.complete = round.matches.every(function (x) { return x.status === "done"; });
    return { ok: true, roundComplete: round.complete };
  };

  function toInt(v) {
    v = Number(v);
    return isFinite(v) ? Math.round(v) : 0;
  }

  /**
   * Moves the tournament on once the current round is complete.
   * @returns {object|null} { type: "leagueRound" | "knockoutStart" | "knockoutRound" | "champion" }
   */
  T.advance = function () {
    var round = this.currentRound();
    if (!round || !round.complete || this.phase === "complete") return null;

    if (round.kind === "league") {
      if (this.leagueRounds().length < this.format.leagueRounds) {
        this._createLeagueRound();
        return { type: "leagueRound" };
      }
      this.phase = "knockout";
      var order = this.standingsOrder().slice(0, this.format.qualifiers);
      var seeded = seedOrder(this.format.qualifiers).map(function (s) { return order[s - 1]; });
      this._createKnockoutRound(seeded);
      return { type: "knockoutStart", qualified: order };
    }

    var winners = round.matches.map(function (m) { return m.winner; });
    if (winners.length === 1) {
      this.champion = winners[0];
      this.phase = "complete";
      return { type: "champion", champion: this.champion };
    }
    this._createKnockoutRound(winners);
    return { type: "knockoutRound" };
  };

  /** Seed number (1-based league position) for a knockout entrant. */
  T.seedOf = function (id) {
    var ko = this.knockoutRounds()[0];
    if (!ko) return null;
    var order = ko.startOrder;
    var i = order.indexOf(id);
    return i >= 0 ? i + 1 : null;
  };

  ESA.Tournament = Tournament;
  ESA.Tournament.formatFor = formatFor;
  ESA.Tournament.seedOrder = seedOrder;
  ESA.Tournament.POINTS = POINTS;
  ESA.Tournament.MAX_PARTICIPANTS = MAX_PARTICIPANTS;

  if (typeof module !== "undefined" && module.exports) module.exports = Tournament;

})(typeof window !== "undefined" ? window : globalThis);
