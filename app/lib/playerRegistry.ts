export const REGISTRY_KEY = "david-exe-players";

export interface MatchRecord {
  date: string;       // ISO timestamp of event completion
  draftNum: number;   // 1-based draft number within the event
  roundNum: number;   // 1-based round number within the draft
  opponent: string;   // Opponent's name, or "BYE"
  result: "win" | "loss" | "draw" | "bye";
  gameScore: string;  // e.g. "2-1", "1-0 (T)", "BYE"
}

export interface RegisteredPlayer {
  name: string;
  eventsPlayed: number;
  matchWins: number;
  matchLosses: number;
  matchDraws: number;
  matchPoints: number;
  gameWins: number;
  gameLosses: number;
  gameDraws: number;
  matches: MatchRecord[];
}

export function loadRegistry(): RegisteredPlayer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveRegistry(players: RegisteredPlayer[]): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(players));
}

/** Merge one completed event's standings into the persistent registry. */
export function recordEventStats(
  standings: Array<{
    name: string;
    wins: number;
    losses: number;
    draws: number;
    points: number;
    gameWins: number;
    gameLosses: number;
    gameDraws: number;
    matches: MatchRecord[];
  }>
): void {
  const registry = loadRegistry();
  const map = new Map(registry.map((p) => [p.name, { ...p }]));

  for (const s of standings) {
    const existing = map.get(s.name) ?? {
      name: s.name,
      eventsPlayed: 0,
      matchWins: 0,
      matchLosses: 0,
      matchDraws: 0,
      matchPoints: 0,
      gameWins: 0,
      gameLosses: 0,
      gameDraws: 0,
      matches: [],
    };
    map.set(s.name, {
      ...existing,
      eventsPlayed: existing.eventsPlayed + 1,
      matchWins:   existing.matchWins   + s.wins,
      matchLosses: existing.matchLosses + s.losses,
      matchDraws:  existing.matchDraws  + s.draws,
      matchPoints: existing.matchPoints + s.points,
      gameWins:    existing.gameWins    + s.gameWins,
      gameLosses:  existing.gameLosses  + s.gameLosses,
      gameDraws:   existing.gameDraws   + s.gameDraws,
      matches: [...(existing.matches ?? []), ...s.matches],
    });
  }

  saveRegistry([...map.values()].sort((a, b) => a.name.localeCompare(b.name)));
}

export function winRate(p: RegisteredPlayer): number {
  const total = p.matchWins + p.matchLosses + p.matchDraws;
  return total === 0 ? 0 : p.matchWins / total;
}

/** Career game win rate, or null if no games have been recorded. */
export function gameWinRate(p: RegisteredPlayer): number | null {
  const gw = p.gameWins ?? 0;
  const gl = p.gameLosses ?? 0;
  const gd = p.gameDraws ?? 0;
  const total = gw + gl + gd;
  return total === 0 ? null : gw / total;
}
