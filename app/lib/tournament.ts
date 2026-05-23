export type MatchResult = "pending" | "p1" | "p2" | "draw";
export type GameOutcome = "p1" | "p2" | "draw";

export interface Player {
  id: string;
  name: string;
}

export interface Pairing {
  id: string;
  player1Id: string;
  player2Id: string | null; // null = bye
  games: GameOutcome[]; // individual game results, max 3
  result: MatchResult; // computed from games
  timedOut: boolean; // match ended due to time
}

// Result when time is called based on current game wins
export function timeoutResult(p1GameWins: number, p2GameWins: number): MatchResult {
  if (p1GameWins > p2GameWins) return "p1";
  if (p2GameWins > p1GameWins) return "p2";
  return "draw";
}

export interface Round {
  number: number;
  pairings: Pairing[];
}

export interface Standing {
  playerId: string;
  name: string;
  // Match-level
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  points: number;
  opponentIds: string[];
  // Game-level (individual games within matches)
  gameWins: number;
  gameLosses: number;
  gameDraws: number;
  // Tiebreakers (filled in pass 2 of computeStandings)
  omwPct: number;  // Opponent Match Win %  (floor 33%)
  gwPct: number;   // Game Win %            (floor 33%)
  ogwPct: number;  // Opponent Game Win %   (floor 33%)
}

// Derive match result from up to 3 game outcomes (best of 3)
export function computeMatchResult(games: GameOutcome[]): MatchResult {
  const p1Wins = games.filter((g) => g === "p1").length;
  const p2Wins = games.filter((g) => g === "p2").length;
  if (p1Wins >= 2) return "p1";
  if (p2Wins >= 2) return "p2";
  if (games.length >= 3) {
    if (p1Wins > p2Wins) return "p1";
    if (p2Wins > p1Wins) return "p2";
    return "draw"; // 1-1-1 or 0-0-3
  }
  return "pending";
}

const FLOOR = 1 / 3; // 33.33% — WotC minimum for all percentage tiebreakers

function rawMwPct(s: Standing): number {
  const total = s.wins + s.losses + s.draws;
  return total === 0 ? FLOOR : Math.max(FLOOR, s.wins / total);
}

function rawGwPct(s: Standing): number {
  const total = s.gameWins + s.gameLosses + s.gameDraws;
  return total === 0 ? FLOOR : Math.max(FLOOR, s.gameWins / total);
}

export function computeStandings(players: Player[], rounds: Round[]): Standing[] {
  const map = new Map<string, Standing>();
  for (const p of players) {
    map.set(p.id, {
      playerId: p.id,
      name: p.name,
      wins: 0, losses: 0, draws: 0, byes: 0, points: 0,
      opponentIds: [],
      gameWins: 0, gameLosses: 0, gameDraws: 0,
      omwPct: FLOOR, gwPct: FLOOR, ogwPct: FLOOR,
    });
  }

  // ── Pass 1: accumulate raw match and game tallies ─────────────────────────
  for (const round of rounds) {
    for (const pairing of round.pairings) {
      if (pairing.result === "pending") continue;
      const s1 = map.get(pairing.player1Id)!;

      if (pairing.player2Id === null) {
        // Bye: automatic match win, no games tracked
        s1.wins++; s1.byes++; s1.points += 3;
        continue;
      }

      const s2 = map.get(pairing.player2Id)!;
      s1.opponentIds.push(pairing.player2Id);
      s2.opponentIds.push(pairing.player1Id);

      // Match result
      if (pairing.result === "p1") {
        s1.wins++; s1.points += 3; s2.losses++;
      } else if (pairing.result === "p2") {
        s2.wins++; s2.points += 3; s1.losses++;
      } else {
        s1.draws++; s1.points += 1;
        s2.draws++; s2.points += 1;
      }

      // Individual game outcomes
      for (const g of pairing.games) {
        if (g === "p1")        { s1.gameWins++; s2.gameLosses++; }
        else if (g === "p2")   { s2.gameWins++; s1.gameLosses++; }
        else                   { s1.gameDraws++; s2.gameDraws++; }
      }
    }
  }

  // ── Pass 2: compute percentage tiebreakers ────────────────────────────────
  for (const s of map.values()) {
    s.gwPct = rawGwPct(s);

    const opponents = s.opponentIds.map((id) => map.get(id)!);
    if (opponents.length === 0) {
      s.omwPct = FLOOR;
      s.ogwPct = FLOOR;
    } else {
      // Average over all opponent appearances (duplicates count if played twice)
      s.omwPct = opponents.reduce((sum, opp) => sum + rawMwPct(opp), 0) / opponents.length;
      s.ogwPct = opponents.reduce((sum, opp) => sum + rawGwPct(opp), 0) / opponents.length;
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.points    !== a.points)    return b.points    - a.points;
    if (b.omwPct    !== a.omwPct)    return b.omwPct    - a.omwPct;
    if (b.gwPct     !== a.gwPct)     return b.gwPct     - a.gwPct;
    if (b.ogwPct    !== a.ogwPct)    return b.ogwPct    - a.ogwPct;
    return a.name.localeCompare(b.name);
  });
}

// Score for pairing two players. Higher = better.
// Rematches are penalised so heavily they are only chosen if no alternative exists.
// For equal-point opponents, prefer pairing similar OMW% (mirrors the standings tiebreaker).
function pairWeight(s1: Standing, s2: Standing): number {
  const pointDiff = Math.abs(s1.points - s2.points);
  const isRematch  = s1.opponentIds.includes(s2.playerId);
  const omwDiff    = Math.abs(s1.omwPct - s2.omwPct);
  return -(pointDiff * 1_000) - (isRematch ? 1_000_000 : 0) - (omwDiff * 10);
}

// Enumerate all perfect matchings of `pool` and return the one with the
// highest total weight. Feasible for up to 12 players (≤ 10,395 matchings).
function findOptimalMatching(standings: Standing[]): [Standing, Standing][] {
  if (standings.length === 0) return [];

  const pool = [...standings];
  let bestScore = -Infinity;
  let bestPairs: [Standing, Standing][] = [];

  function recurse(start: number, score: number) {
    if (start >= pool.length) {
      if (score > bestScore) {
        bestScore = score;
        bestPairs = [];
        for (let i = 0; i < pool.length; i += 2) {
          bestPairs.push([pool[i], pool[i + 1]]);
        }
      }
      return;
    }
    // Fix pool[start] and try pairing it with each remaining player.
    // Swap the chosen partner into position start+1, recurse, then swap back.
    for (let i = start + 1; i < pool.length; i++) {
      [pool[start + 1], pool[i]] = [pool[i], pool[start + 1]];
      recurse(start + 2, score + pairWeight(pool[start], pool[start + 1]));
      [pool[start + 1], pool[i]] = [pool[i], pool[start + 1]];
    }
  }

  recurse(0, 0);
  return bestPairs;
}

// standings must be sorted by rank (best first) before calling
export function createPairings(standings: Standing[]): Pairing[] {
  const pairings: Pairing[] = [];
  const pool = [...standings];

  if (pool.length % 2 === 1) {
    // Give bye to the lowest-ranked player who hasn't had one yet
    let byeIdx = pool.length - 1;
    for (let i = pool.length - 1; i >= 0; i--) {
      if (pool[i].byes === 0) { byeIdx = i; break; }
    }
    const [byePlayer] = pool.splice(byeIdx, 1);
    pairings.push({
      id: `bye-${byePlayer.playerId}`,
      player1Id: byePlayer.playerId,
      player2Id: null,
      games: [],
      result: "p1",
      timedOut: false,
    });
  }

  // Find the globally optimal matching for the remaining players
  for (const [p1, p2] of findOptimalMatching(pool)) {
    pairings.push({
      id: `${p1.playerId}-vs-${p2.playerId}`,
      player1Id: p1.playerId,
      player2Id: p2.playerId,
      games: [],
      result: "pending",
      timedOut: false,
    });
  }

  return pairings;
}

export function totalRounds(playerCount: number): number {
  return Math.ceil(Math.log2(playerCount));
}
