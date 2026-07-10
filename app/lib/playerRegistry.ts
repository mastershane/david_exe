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
  id: string;         // stable UUID — primary key
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
    if (!raw) return [];
    const players = JSON.parse(raw) as Array<Partial<RegisteredPlayer> & { name: string }>;
    // Migration: add stable IDs to any existing entries that lack them
    let needsSave = false;
    const migrated = players.map((p) => {
      if (!p.id) {
        needsSave = true;
        return { ...p, id: crypto.randomUUID() } as RegisteredPlayer;
      }
      return p as RegisteredPlayer;
    });
    if (needsSave) saveRegistry(migrated);
    return migrated;
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
    id: string;
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
  const map = new Map(registry.map((p) => [p.id, { ...p }]));

  for (const s of standings) {
    const existing = map.get(s.id) ?? {
      id: s.id,
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
    map.set(s.id, {
      ...existing,
      id: s.id,
      name: s.name,
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

/** Create a new player in the registry and return them. Always generates a new UUID. */
export function addPlayerToRegistry(name: string): RegisteredPlayer {
  const newPlayer: RegisteredPlayer = {
    id: crypto.randomUUID(),
    name: name.trim(),
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
  const registry = loadRegistry();
  saveRegistry([...registry, newPlayer].sort((a, b) => a.name.localeCompare(b.name)));
  return newPlayer;
}

// ── Server sync ───────────────────────────────────────────────────────────────

/** Fetch the registry from the server and merge into localStorage.
 *  Server data wins; silent fallback to localStorage on failure. */
export async function fetchAndMergeRegistryFromServer(): Promise<RegisteredPlayer[]> {
  try {
    const res = await fetch("/api/registry");
    if (!res.ok) return loadRegistry();
    const serverPlayers = (await res.json()) as RegisteredPlayer[];
    if (serverPlayers.length > 0) {
      saveRegistry(serverPlayers);
    }
    return serverPlayers.length > 0 ? serverPlayers : loadRegistry();
  } catch {
    return loadRegistry();
  }
}

/** Push the current local registry to the server. */
export async function syncRegistryToServer(players?: RegisteredPlayer[]): Promise<void> {
  const data = players ?? loadRegistry();
  try {
    await fetch("/api/registry", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    // Offline
  }
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
