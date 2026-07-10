import type { Player, Round } from "./tournament";

// ── Storage keys ─────────────────────────────────────────────────────────────

export const EVENT_IDS_KEY = "david-exe-event-ids";
export const LEGACY_STATE_KEY = "david-exe-state"; // old single-event key

export function eventStorageKey(id: string): string {
  return `david-exe-event-${id}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type Phase = "event-setup" | "playing" | "between-drafts" | "event-complete";

export interface EventState {
  id: string;
  name: string;
  createdAt: string;
  numDrafts: number;
  roundsPerDraft: number;
  playerCount: number;
  playerNames: string[];
  phase: Phase;
  players: Player[];
  drafts: Round[][];
  currentDraftIdx: number;
  currentRoundInDraft: number;
  statsRecorded: boolean;
}

const MAX_PLAYERS = 12;

function defaultEventState(id: string, name: string): EventState {
  return {
    id,
    name,
    createdAt: new Date().toISOString(),
    numDrafts: 4,
    roundsPerDraft: 3,
    playerCount: 8,
    playerNames: Array(MAX_PLAYERS).fill(""),
    phase: "event-setup",
    players: [],
    drafts: [],
    currentDraftIdx: 0,
    currentRoundInDraft: 1,
    statsRecorded: false,
  };
}

function autoName(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

export function loadEventIds(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(EVENT_IDS_KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

function persistIds(ids: string[]): void {
  localStorage.setItem(EVENT_IDS_KEY, JSON.stringify(ids));
}

export function loadEvent(id: string): EventState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(eventStorageKey(id));
    return raw ? (JSON.parse(raw) as EventState) : null;
  } catch {
    return null;
  }
}

export function saveEvent(state: EventState): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(eventStorageKey(state.id), JSON.stringify(state));
}

/** Create a new blank event, register its ID, and return it. */
export function createEvent(): EventState {
  const id = String(Date.now());
  const state = defaultEventState(id, autoName());
  persistIds([id, ...loadEventIds()]); // newest first
  saveEvent(state);
  return state;
}

/** Remove an event from storage and the ID list. */
export function deleteEvent(id: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(eventStorageKey(id));
  persistIds(loadEventIds().filter((i) => i !== id));
}

/** Load all events in ID-list order (newest first). */
export function loadAllEvents(): EventState[] {
  return loadEventIds()
    .map(loadEvent)
    .filter((e): e is EventState => e !== null);
}

// ── Server sync (fire-and-forget, failures are silent) ────────────────────────

/** Fetch all events from the server and merge into localStorage.
 *  Server data wins for shared events; local-only events are preserved. */
export async function fetchAndMergeFromServer(): Promise<EventState[]> {
  try {
    const res = await fetch("/api/events");
    if (!res.ok) return loadAllEvents();
    const serverEvents = (await res.json()) as EventState[];

    const localIds = loadEventIds();
    const serverIds = new Set(serverEvents.map((e) => e.id));

    // Save server events into localStorage (overwriting stale local copies)
    serverEvents.forEach(saveEvent);

    // Preserve events that only exist locally (recently created, not yet synced)
    const localOnlyIds = localIds.filter((id) => !serverIds.has(id));

    // Rebuild ID list: server order first, then any local-only events
    persistIds([...serverEvents.map((e) => e.id), ...localOnlyIds]);

    return loadAllEvents();
  } catch {
    return loadAllEvents(); // Offline — use whatever is in localStorage
  }
}

/** Push a single event state to the server. */
export async function syncEventToServer(state: EventState): Promise<void> {
  try {
    await fetch(`/api/events/${state.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
  } catch {
    // Offline — localStorage is the fallback
  }
}

/** Tell the server to delete an event. */
export async function deleteEventFromServer(id: string): Promise<void> {
  try {
    await fetch(`/api/events/${id}`, { method: "DELETE" });
  } catch {
    // Offline — will be out of sync until next merge
  }
}

// ── One-time migration from old single-event key ──────────────────────────────

export function migrateLegacyEvent(): void {
  if (typeof window === "undefined") return;
  const raw = localStorage.getItem(LEGACY_STATE_KEY);
  if (!raw) return;

  try {
    const old = JSON.parse(raw) as Partial<EventState> & { phase?: Phase };
    // Only migrate if the event had actually been started (players entered)
    const hasPlayers =
      Array.isArray(old.players) && old.players.length > 0;
    const hasNames =
      Array.isArray(old.playerNames) && old.playerNames.some((n) => n);

    if (!hasPlayers && !hasNames) {
      localStorage.removeItem(LEGACY_STATE_KEY);
      return;
    }

    const id = "legacy";
    if (!loadEvent(id)) {
      const migrated: EventState = {
        id,
        name: "Imported Event",
        createdAt: new Date().toISOString(),
        numDrafts: old.numDrafts ?? 4,
        roundsPerDraft: old.roundsPerDraft ?? 3,
        playerCount: old.playerCount ?? 8,
        playerNames: old.playerNames ?? Array(MAX_PLAYERS).fill(""),
        phase: old.phase ?? "event-setup",
        players: old.players ?? [],
        drafts: old.drafts ?? [],
        currentDraftIdx: old.currentDraftIdx ?? 0,
        currentRoundInDraft: old.currentRoundInDraft ?? 1,
        statsRecorded: old.statsRecorded ?? false,
      };
      const ids = loadEventIds();
      if (!ids.includes(id)) persistIds([...ids, id]); // legacy at end
      saveEvent(migrated);
    }
  } catch {
    // Corrupt data — just drop it
  } finally {
    localStorage.removeItem(LEGACY_STATE_KEY);
  }
}
