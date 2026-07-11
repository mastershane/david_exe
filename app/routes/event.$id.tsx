import { useState, useMemo, useEffect, useRef } from "react";
import { Link, useParams, useNavigate } from "react-router";
import type { Player, Round, Standing, GameOutcome } from "~/lib/tournament";
import {
  computeStandings,
  computeMatchResult,
  timeoutResult,
  createPairings,
  totalRounds,
} from "~/lib/tournament";
import { loadConfig, CONFIG_STORAGE_KEY } from "~/lib/config";
import type { AppConfig } from "~/lib/config";
import { loadRegistry, recordEventStats, addPlayerToRegistry } from "~/lib/playerRegistry";
import type { MatchRecord, RegisteredPlayer } from "~/lib/playerRegistry";
import { loadEvent, saveEvent, syncEventToServer } from "~/lib/eventStore";
import type { Phase, TimerState } from "~/lib/eventStore";
import { syncRegistryToServer } from "~/lib/playerRegistry";

export function meta() {
  return [{ title: "david.exe — MTG Draft" }];
}

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 12;

// ── Match-record builder (for career stats) ───────────────────────────────────

// Returns map keyed by player ID → match records for that player
function buildMatchRecords(
  players: Player[],
  drafts: Round[][],
  date: string
): Map<string, MatchRecord[]> {
  const idToName = new Map(players.map((p) => [p.id, p.name]));
  const result = new Map<string, MatchRecord[]>(players.map((p) => [p.id, []]));

  drafts.forEach((draft, draftIdx) => {
    draft.forEach((round, roundIdx) => {
      round.pairings.forEach((pairing) => {
        if (pairing.result === "pending") return;
        const draftNum = draftIdx + 1;
        const roundNum = roundIdx + 1;
        const p1Name = idToName.get(pairing.player1Id)!;

        if (pairing.player2Id === null) {
          result.get(pairing.player1Id)?.push({ date, draftNum, roundNum, opponent: "BYE", result: "bye", gameScore: "BYE" });
          return;
        }

        const p2Name = idToName.get(pairing.player2Id)!;
        const p1Wins = pairing.games.filter((g) => g === "p1").length;
        const p2Wins = pairing.games.filter((g) => g === "p2").length;
        const suffix = pairing.timedOut ? " (T)" : "";
        const p1Result: MatchRecord["result"] =
          pairing.result === "p1" ? "win" : pairing.result === "p2" ? "loss" : "draw";
        const p2Result: MatchRecord["result"] =
          pairing.result === "p2" ? "win" : pairing.result === "p1" ? "loss" : "draw";

        result.get(pairing.player1Id)?.push({ date, draftNum, roundNum, opponent: p2Name, result: p1Result, gameScore: `${p1Wins}–${p2Wins}${suffix}` });
        result.get(pairing.player2Id)?.push({ date, draftNum, roundNum, opponent: p1Name, result: p2Result, gameScore: `${p2Wins}–${p1Wins}${suffix}` });
      });
    });
  });

  return result;
}

// ── Pairing swap ─────────────────────────────────────────────────────────────

function swapInPairings(
  pairings: Round["pairings"],
  idA: string,
  idB: string
): Round["pairings"] {
  let pairingOfA = -1, slotOfA: "p1" | "p2" = "p1";
  let pairingOfB = -1, slotOfB: "p1" | "p2" = "p1";

  for (let i = 0; i < pairings.length; i++) {
    const p = pairings[i];
    if (p.player1Id === idA) { pairingOfA = i; slotOfA = "p1"; }
    else if (p.player2Id === idA) { pairingOfA = i; slotOfA = "p2"; }
    if (p.player1Id === idB) { pairingOfB = i; slotOfB = "p1"; }
    else if (p.player2Id === idB) { pairingOfB = i; slotOfB = "p2"; }
  }

  if (pairingOfA === -1 || pairingOfB === -1 || pairingOfA === pairingOfB) return pairings;

  return pairings.map((p, i) => {
    if (i !== pairingOfA && i !== pairingOfB) return p;
    let updated = { ...p };
    if (i === pairingOfA) {
      if (slotOfA === "p1") updated = { ...updated, player1Id: idB };
      else updated = { ...updated, player2Id: idB };
    }
    if (i === pairingOfB) {
      if (slotOfB === "p1") updated = { ...updated, player1Id: idA };
      else updated = { ...updated, player2Id: idA };
    }
    return { ...updated, games: [], result: "pending" as const, timedOut: false };
  });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function EventPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // Load event state once on mount — all useState initializers read from this
  const [saved] = useState(() => (id ? loadEvent(id) : null));

  // ── Configuration ─────────────────────────────────────────────────────────
  const [name, setName]                     = useState(() => saved?.name ?? "Draft Night");
  const [numDrafts, setNumDrafts]           = useState(() => saved?.numDrafts ?? 4);
  const [roundsPerDraft, setRoundsPerDraft] = useState(() => saved?.roundsPerDraft ?? 3);
  const [selectedPlayers, setSelectedPlayers] = useState<{ id: string; name: string }[]>(
    () => saved?.selectedPlayers ?? []
  );
  const [search, setSearch] = useState("");
  const [registry, setRegistry] = useState<RegisteredPlayer[]>(() => loadRegistry());

  // ── Event state ───────────────────────────────────────────────────────────
  const [phase, setPhase]                             = useState<Phase>(() => saved?.phase ?? "event-setup");
  const [players, setPlayers]                         = useState<Player[]>(() => saved?.players ?? []);
  const [drafts, setDrafts]                           = useState<Round[][]>(() => saved?.drafts ?? []);
  const [currentDraftIdx, setCurrentDraftIdx]         = useState(() => saved?.currentDraftIdx ?? 0);
  const [currentRoundInDraft, setCurrentRoundInDraft] = useState(() => saved?.currentRoundInDraft ?? 1);
  const [statsRecorded, setStatsRecorded]             = useState(() => saved?.statsRecorded ?? false);
  const [timer, setTimer]                             = useState<TimerState | null>(() => saved?.timer ?? null);
  const [confirmEnd, setConfirmEnd]                   = useState(false);
  const [editingPairings, setEditingPairings]         = useState(false);
  const [selectedForSwap, setSelectedForSwap]         = useState<string | null>(null);
  const [confirmDrop, setConfirmDrop]                 = useState<string | null>(null);
  const [draftPairings, setDraftPairings]             = useState<Round["pairings"] | null>(null);
  const [draftDropped, setDraftDropped]               = useState<Set<string>>(new Set());

  // Known names for registry refresh after stats are recorded
  const [knownPlayerNames, setKnownPlayerNames] = useState<string[]>(() =>
    loadRegistry().map((p) => p.name)
  );

  // App config — synced with /settings via StorageEvent
  const [appConfig, setAppConfig] = useState<AppConfig>(() => loadConfig());

  // Ref for debounced server-sync timer
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Persist event to localStorage on every change ─────────────────────────
  useEffect(() => {
    if (!id) return;
    const state = {
      id,
      name,
      createdAt: saved?.createdAt ?? new Date().toISOString(),
      numDrafts,
      roundsPerDraft,
      playerCount: selectedPlayers.length,
      selectedPlayers,
      phase,
      players,
      drafts,
      currentDraftIdx,
      currentRoundInDraft,
      statsRecorded,
      timer,
    };
    saveEvent(state);

    // Debounced server sync — fires 5 s after the last state change.
    // Skip during event-setup (data is still being entered).
    // Timer changes sync immediately (handled separately in handleTimerUpdate).
    if (phase !== "event-setup") {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => syncEventToServer(state), 5_000);
    }
  }, [id, name, numDrafts, roundsPerDraft, selectedPlayers, phase, players, drafts, currentDraftIdx, currentRoundInDraft, statsRecorded, timer]);

  // ── Sync config when /settings saves ─────────────────────────────────────
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === CONFIG_STORAGE_KEY) setAppConfig(loadConfig());
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // ── Derived state ─────────────────────────────────────────────────────────
  const allRounds = useMemo(() => drafts.flat(), [drafts]);
  const standings = useMemo(
    () => computeStandings(players, allRounds, appConfig.tiebreakers),
    [players, allRounds, appConfig]
  );
  const currentDraftRounds = drafts[currentDraftIdx] ?? [];
  const currentRound = currentDraftRounds[currentRoundInDraft - 1];
  const droppedPlayerIds = useMemo(
    () => new Set(players.filter((p) => p.dropped).map((p) => p.id)),
    [players]
  );
  const allResultsIn = (currentRound?.pairings ?? [])
    .filter(
      (p) =>
        !droppedPlayerIds.has(p.player1Id) &&
        (p.player2Id === null || !droppedPlayerIds.has(p.player2Id))
    )
    .every((p) => p.result !== "pending");
  const isLastRoundInDraft = currentRoundInDraft === roundsPerDraft;
  const isLastDraft = currentDraftIdx === numDrafts - 1;
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const totalRoundsInEvent = numDrafts * roundsPerDraft;
  const completedRoundsCount = currentDraftIdx * roundsPerDraft + (currentRoundInDraft - 1);

  // ── Record career stats once when the event finishes ─────────────────────
  useEffect(() => {
    if (phase !== "event-complete" || statsRecorded) return;

    const date = new Date().toISOString();
    const matchesById = buildMatchRecords(players, drafts, date);

    recordEventStats(
      standings.map((s) => ({
        id: s.playerId,
        name: s.name,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        points: s.points,
        gameWins: s.gameWins,
        gameLosses: s.gameLosses,
        gameDraws: s.gameDraws,
        matches: matchesById.get(s.playerId) ?? [],
      }))
    );
    const updatedRegistry = loadRegistry();
    setKnownPlayerNames(updatedRegistry.map((p) => p.name));
    syncRegistryToServer(updatedRegistry); // push merged registry to DB
    setStatsRecorded(true);
  }, [phase, statsRecorded, standings, players, drafts]);

  // ── Hydration guard ───────────────────────────────────────────────────────
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => setHasMounted(true), []);

  // Redirect if event not found
  useEffect(() => {
    if (hasMounted && !saved) navigate("/");
  }, [hasMounted, saved, navigate]);

  if (!hasMounted || !saved) {
    return <div className="min-h-screen" />;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function freshTimer(): TimerState {
    return {
      durationSeconds: appConfig.roundMinutes * 60,
      startedAt: null,
      secondsAtStart: appConfig.roundMinutes * 60,
      running: false,
    };
  }

  // Called by RoundTimer when user presses Start/Pause/Restart.
  // Syncs immediately so other browsers see the change without waiting 5 s.
  function handleTimerUpdate(newTimer: TimerState) {
    setTimer(newTimer);
    syncEventToServer({
      id: id!,
      name,
      createdAt: saved!.createdAt,
      numDrafts,
      roundsPerDraft,
      playerCount: selectedPlayers.length,
      selectedPlayers,
      phase,
      players,
      drafts,
      currentDraftIdx,
      currentRoundInDraft,
      statsRecorded,
      timer: newTimer,
    });
  }

  function makePairings(standingsList: Standing[]) {
    const droppedIds = new Set(players.filter((p) => p.dropped).map((p) => p.id));
    return createPairings(standingsList.filter((s) => !droppedIds.has(s.playerId)));
  }

  function startEvent() {
    if (selectedPlayers.length < MIN_PLAYERS) return;

    // IDs are already stable UUIDs from the registry picker — no lookup needed
    const ps: Player[] = [...selectedPlayers].sort(() => Math.random() - 0.5);
    const initStandings: Standing[] = ps.map((p) => ({
      playerId: p.id,
      name: p.name,
      wins: 0, losses: 0, draws: 0, byes: 0, points: 0,
      opponentIds: [],
      gameWins: 0, gameLosses: 0, gameDraws: 0,
      omwPct: 1 / 3, gwPct: 1 / 3, ogwPct: 1 / 3,
    }));

    const initTimer = freshTimer();
    setPlayers(ps);
    setDrafts([[{ number: 1, pairings: makePairings(initStandings) }]]);
    setCurrentDraftIdx(0);
    setCurrentRoundInDraft(1);
    setTimer(initTimer);
    setPhase("playing");
    // Immediate sync so the new event appears on other devices right away
    syncEventToServer({
      id: id!,
      name,
      createdAt: saved?.createdAt ?? new Date().toISOString(),
      numDrafts,
      roundsPerDraft,
      playerCount: selectedPlayers.length,
      selectedPlayers,
      phase: "playing",
      players: ps,
      drafts: [[{ number: 1, pairings: makePairings(initStandings) }]],
      currentDraftIdx: 0,
      currentRoundInDraft: 1,
      statsRecorded,
      timer: initTimer,
    });
  }

  function updateCurrentDraft(fn: (draft: Round[]) => Round[]) {
    setDrafts((prev) => prev.map((d, i) => (i === currentDraftIdx ? fn(d) : d)));
  }

  function updateCurrentRound(fn: (round: Round) => Round) {
    updateCurrentDraft((draft) =>
      draft.map((r, i) => (i === currentRoundInDraft - 1 ? fn(r) : r))
    );
  }

  function updatePairing(
    pairingId: string,
    fn: (p: (typeof currentRound.pairings)[0]) => (typeof currentRound.pairings)[0]
  ) {
    updateCurrentRound((r) => ({
      ...r,
      pairings: r.pairings.map((p) => (p.id !== pairingId ? p : fn(p))),
    }));
  }

  function recordGame(pairingId: string, outcome: GameOutcome) {
    updatePairing(pairingId, (p) => {
      const newGames = [...p.games, outcome];
      return { ...p, games: newGames, result: computeMatchResult(newGames) };
    });
  }

  function callTime(pairingId: string) {
    updatePairing(pairingId, (p) => {
      const p1Wins = p.games.filter((g) => g === "p1").length;
      const p2Wins = p.games.filter((g) => g === "p2").length;
      return { ...p, timedOut: true, result: timeoutResult(p1Wins, p2Wins) };
    });
  }

  function undoGame(pairingId: string) {
    updatePairing(pairingId, (p) => {
      if (p.timedOut) return { ...p, timedOut: false, result: computeMatchResult(p.games) };
      const newGames = p.games.slice(0, -1);
      return { ...p, games: newGames, result: computeMatchResult(newGames) };
    });
  }

  function enterEditMode() {
    if (!currentRound) return;
    setDraftPairings([...currentRound.pairings]);
    setDraftDropped(new Set(players.filter((p) => p.dropped).map((p) => p.id)));
    setSelectedForSwap(null);
    setConfirmDrop(null);
    setEditingPairings(true);
  }

  function commitEdits() {
    if (draftPairings) {
      updateCurrentRound((round) => ({ ...round, pairings: draftPairings }));
    }
    setPlayers((prev) =>
      prev.map((p) => ({ ...p, dropped: draftDropped.has(p.id) }))
    );
    setEditingPairings(false);
    setDraftPairings(null);
    setSelectedForSwap(null);
    setConfirmDrop(null);
  }

  function cancelEdits() {
    setEditingPairings(false);
    setDraftPairings(null);
    setSelectedForSwap(null);
    setConfirmDrop(null);
  }

  function handleSelectForSwap(playerId: string) {
    if (!selectedForSwap) {
      setSelectedForSwap(playerId);
      return;
    }
    if (selectedForSwap === playerId) {
      setSelectedForSwap(null);
      return;
    }
    const first = selectedForSwap;
    setSelectedForSwap(null);
    setDraftPairings((prev) => (prev ? swapInPairings(prev, first, playerId) : prev));
  }

  function handleSkipRound(playerId: string) {
    setSelectedForSwap(null);
    setDraftPairings((prev) => {
      if (!prev) return prev;
      const pairing = prev.find(
        (p) => p.player1Id === playerId || p.player2Id === playerId
      );
      if (!pairing) return prev;
      const isP1 = pairing.player1Id === playerId;
      const opponentId = isP1 ? pairing.player2Id : pairing.player1Id;
      const remaining = prev.filter((p) => p.id !== pairing.id);
      if (opponentId !== null) {
        remaining.push({
          id: `bye-${opponentId}`,
          player1Id: opponentId,
          player2Id: null,
          games: [],
          result: "p1",
          timedOut: false,
        });
      }
      return remaining;
    });
  }

  function handleDropPlayer(playerId: string) {
    handleSkipRound(playerId);
    setDraftDropped((prev) => new Set([...prev, playerId]));
  }

  function advanceRound() {
    if (!isLastRoundInDraft) {
      const nextRoundNum = currentRoundInDraft + 1;
      updateCurrentDraft((draft) => [
        ...draft,
        { number: nextRoundNum, pairings: makePairings(standings) },
      ]);
      setCurrentRoundInDraft(nextRoundNum);
      setTimer(freshTimer());
    } else if (!isLastDraft) {
      setPhase("between-drafts");
    } else {
      setPhase("event-complete");
    }
  }

  function startNextDraft() {
    const nextIdx = currentDraftIdx + 1;
    setDrafts((prev) => [
      ...prev,
      [{ number: 1, pairings: makePairings(standings) }],
    ]);
    setCurrentDraftIdx(nextIdx);
    setCurrentRoundInDraft(1);
    setTimer(freshTimer());
    setPhase("playing");
  }

  // Back to the events list — event state is already saved in localStorage
  function goToEvents() {
    navigate("/");
  }

  // ── Shared nav links ──────────────────────────────────────────────────────
  const NavLinks = ({ size = "sm" }: { size?: "xs" | "sm" }) => (
    <div className={`flex gap-3 ${size === "xs" ? "text-xs text-slate-500" : "text-sm text-slate-400"}`}>
      <button
        onClick={goToEvents}
        className="hover:text-slate-200 transition-colors"
      >
        ← Events
      </button>
      <Link to="/players" className="hover:text-slate-200 transition-colors">Players ↗</Link>
      <Link to="/settings" className="hover:text-slate-200 transition-colors">Settings ↗</Link>
      <Link to="/info" className="hover:text-slate-200 transition-colors">Info ↗</Link>
    </div>
  );

  // ── Event Setup ───────────────────────────────────────────────────────────
  if (phase === "event-setup") {
    const canStart = selectedPlayers.length >= MIN_PLAYERS && selectedPlayers.length <= MAX_PLAYERS;
    const recommendedRounds = totalRounds(selectedPlayers.length || MIN_PLAYERS);

    const searchTrimmed = search.trim();
    const searchLower = searchTrimmed.toLowerCase();
    const suggestions = registry.filter(
      (p) =>
        !selectedPlayers.some((s) => s.id === p.id) &&
        (searchLower === "" || p.name.toLowerCase().includes(searchLower))
    );
    const exactMatchExists = registry.some(
      (p) => p.name.toLowerCase() === searchLower
    );
    const canCreate = searchTrimmed.length > 0 && !exactMatchExists;

    function addToEvent(p: { id: string; name: string }) {
      if (selectedPlayers.length >= MAX_PLAYERS) return;
      setSelectedPlayers((prev) => [...prev, { id: p.id, name: p.name }]);
      setSearch("");
    }

    function removeFromEvent(id: string) {
      setSelectedPlayers((prev) => prev.filter((p) => p.id !== id));
    }

    function createAndAdd() {
      if (!searchTrimmed) return;
      const newPlayer = addPlayerToRegistry(searchTrimmed);
      setRegistry(loadRegistry());
      addToEvent(newPlayer);
    }

    return (
      <div className="min-h-screen text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="flex items-center justify-between mb-1">
            <h1 className="text-4xl font-mono font-bold text-green-400">david.exe</h1>
            <NavLinks />
          </div>
          <p className="text-slate-400 mb-8">MTG Draft — Swiss Pairing</p>

          <div className="bg-slate-800 rounded-2xl p-6 space-y-6 shadow-xl">

            {/* Event name */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Event Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Friday Night Draft"
                className="w-full bg-slate-700 rounded-lg px-3 py-2 text-white border border-slate-600 focus:outline-none focus:border-green-500 placeholder-slate-500"
              />
            </div>

            {/* Event structure */}
            <div>
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
                Event Structure
              </h2>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Number of Drafts</label>
                  <select
                    value={numDrafts}
                    onChange={(e) => setNumDrafts(Number(e.target.value))}
                    className="w-full bg-slate-700 rounded-lg px-3 py-2 text-white border border-slate-600 focus:outline-none focus:border-green-500"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-slate-400 mb-1">Rounds per Draft</label>
                  <select
                    value={roundsPerDraft}
                    onChange={(e) => setRoundsPerDraft(Number(e.target.value))}
                    className="w-full bg-slate-700 rounded-lg px-3 py-2 text-white border border-slate-600 focus:outline-none focus:border-green-500"
                  >
                    {[2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}{n === recommendedRounds ? " (rec.)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <p className="text-slate-500 text-xs mt-2">
                {numDrafts} draft{numDrafts !== 1 ? "s" : ""} × {roundsPerDraft} rounds ={" "}
                <span className="text-slate-300">{totalRoundsInEvent} total rounds</span>
              </p>
            </div>

            {/* Players */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                  Players
                </h2>
                <span className={`text-xs tabular-nums ${
                  selectedPlayers.length < MIN_PLAYERS ? "text-slate-500"
                  : selectedPlayers.length >= MAX_PLAYERS ? "text-yellow-400"
                  : "text-green-400"
                }`}>
                  {selectedPlayers.length} / {MIN_PLAYERS}–{MAX_PLAYERS}
                </span>
              </div>

              {/* Selected chips */}
              {selectedPlayers.length > 0 && (
                <div className="flex flex-wrap gap-2 mb-3">
                  {selectedPlayers.map((p) => (
                    <span
                      key={p.id}
                      className="flex items-center gap-1.5 bg-slate-700 text-white text-sm px-3 py-1 rounded-full"
                    >
                      {p.name}
                      <button
                        onClick={() => removeFromEvent(p.id)}
                        className="text-slate-400 hover:text-red-400 transition-colors leading-none"
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}

              {/* Search / add */}
              {selectedPlayers.length < MAX_PLAYERS && (
                <div className="space-y-1">
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (suggestions.length > 0) addToEvent(suggestions[0]);
                        else if (canCreate) createAndAdd();
                      }
                    }}
                    placeholder="Search players or type a new name…"
                    className="w-full bg-slate-700 rounded-lg px-3 py-2 text-white border border-slate-600 focus:outline-none focus:border-green-500 placeholder-slate-500 text-sm"
                  />

                  {(suggestions.length > 0 || canCreate) && (
                    <div className="bg-slate-700 rounded-lg overflow-hidden divide-y divide-slate-600">
                      {suggestions.slice(0, 6).map((p) => (
                        <button
                          key={p.id}
                          onClick={() => addToEvent(p)}
                          className="w-full text-left px-3 py-2 hover:bg-slate-600 transition-colors flex items-center justify-between"
                        >
                          <span className="text-white text-sm">{p.name}</span>
                          <span className="text-slate-400 text-xs">
                            {p.eventsPlayed === 0 ? "new" : `${p.eventsPlayed} event${p.eventsPlayed !== 1 ? "s" : ""}`}
                          </span>
                        </button>
                      ))}
                      {canCreate && (
                        <button
                          onClick={createAndAdd}
                          className="w-full text-left px-3 py-2 hover:bg-slate-600 transition-colors flex items-center gap-2"
                        >
                          <span className="text-green-400 text-sm font-medium">+</span>
                          <span className="text-green-400 text-sm">Create "{searchTrimmed}"</span>
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={startEvent}
              disabled={!canStart}
              className="w-full bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {canStart
                ? `Start Event (${selectedPlayers.length} players)`
                : `Select ${MIN_PLAYERS}–${MAX_PLAYERS} players to start`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Between Drafts ────────────────────────────────────────────────────────
  if (phase === "between-drafts") {
    const completedDraft = currentDraftIdx + 1;
    const medals = ["🥇", "🥈", "🥉"];

    return (
      <div className="min-h-screen text-white flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <h1 className="text-4xl font-mono font-bold text-center mb-1 text-green-400">
            {name}
          </h1>
          <p className="text-xl text-center text-slate-300 mb-1 font-semibold">
            Draft {completedDraft} of {numDrafts} Complete
          </p>
          <p className="text-slate-500 text-center text-sm mb-1">
            {completedDraft * roundsPerDraft} of {totalRoundsInEvent} rounds played
          </p>
          <div className="flex justify-center mb-6">
            <NavLinks size="xs" />
          </div>

          <div className="bg-slate-800 rounded-2xl overflow-hidden shadow-xl mb-6">
            <div className="px-6 py-3 bg-slate-700 flex items-center justify-between">
              <h2 className="font-semibold">Overall Standings</h2>
              <span className="text-slate-400 text-sm">after {completedDraft} draft{completedDraft !== 1 ? "s" : ""}</span>
            </div>
            <StandingsTable standings={standings} medals={medals} />
          </div>

          <button
            onClick={startNextDraft}
            className="w-full bg-green-600 hover:bg-green-500 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            Start Draft {completedDraft + 1}
          </button>

          <div className="flex items-center justify-center gap-3 py-1">
            {confirmEnd ? (
              <>
                <span className="text-xs text-slate-400">End event with current standings?</span>
                <button
                  onClick={() => { setPhase("event-complete"); setConfirmEnd(false); }}
                  className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                >
                  Yes, end now
                </button>
                <button
                  onClick={() => setConfirmEnd(false)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => setConfirmEnd(true)}
                className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
              >
                End event early
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Event Complete ────────────────────────────────────────────────────────
  if (phase === "event-complete") {
    const medals = ["🥇", "🥈", "🥉"];

    return (
      <div className="min-h-screen text-white flex items-center justify-center p-4">
        <div className="w-full max-w-lg">
          <h1 className="text-4xl font-mono font-bold text-center mb-1 text-green-400">
            {name}
          </h1>
          <p className="text-2xl text-center text-white mb-1 font-semibold">Event Complete!</p>
          <p className="text-slate-500 text-center text-sm mb-1">
            {numDrafts} draft{numDrafts !== 1 ? "s" : ""} · {totalRoundsInEvent} rounds
          </p>
          <div className="flex justify-center mb-6">
            <NavLinks size="xs" />
          </div>

          <div className="bg-slate-800 rounded-2xl overflow-hidden shadow-xl mb-6">
            <div className="px-6 py-3 bg-slate-700">
              <h2 className="font-semibold">Final Standings</h2>
            </div>
            <StandingsTable standings={standings} medals={medals} />
          </div>

          <button
            onClick={goToEvents}
            className="w-full bg-slate-700 hover:bg-slate-600 text-white font-semibold py-3 rounded-xl transition-colors"
          >
            ← Back to Events
          </button>
        </div>
      </div>
    );
  }

  // ── Playing ───────────────────────────────────────────────────────────────
  const advanceLabel = allResultsIn
    ? isLastRoundInDraft
      ? isLastDraft
        ? "End Event"
        : `Complete Draft ${currentDraftIdx + 1}`
      : `Advance to Round ${currentRoundInDraft + 1}`
    : "Enter all results to continue";

  return (
    <div className="min-h-screen text-white p-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-mono font-bold text-green-400">{name}</h1>
            <NavLinks size="xs" />
          </div>
          <div className="text-right">
            <div className="text-white font-semibold">
              Draft {currentDraftIdx + 1} of {numDrafts} — Round {currentRoundInDraft} of {roundsPerDraft}
            </div>
            <div className="text-slate-500 text-xs">
              {completedRoundsCount} of {totalRoundsInEvent} rounds completed
            </div>
          </div>
        </div>

        {/* Round Timer */}
        {timer && (
          <RoundTimer timer={timer} onUpdate={handleTimerUpdate} />
        )}

        {/* Pairings */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-300 uppercase tracking-wider">
              Pairings — Best of 3
            </h2>
            {editingPairings ? (
              <div className="flex gap-2">
                <button
                  onClick={cancelEdits}
                  className="text-xs font-medium px-3 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={commitEdits}
                  className="text-xs font-medium px-3 py-1 rounded-lg bg-green-600 text-white hover:bg-green-500 transition-colors"
                >
                  Done
                </button>
              </div>
            ) : (
              <button
                onClick={enterEditMode}
                className="text-xs font-medium px-3 py-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
              >
                Edit pairings
              </button>
            )}
          </div>

          {editingPairings && (
            <p className="text-xs text-slate-500 mb-3">
              {selectedForSwap
                ? "Now tap another player to swap with them."
                : "Tap a player to select, then tap who to swap them with. Swapped matches reset to 0–0."}
            </p>
          )}

          <div className="space-y-3">
            {(editingPairings ? draftPairings ?? [] : currentRound?.pairings ?? []).map((pairing) => {
              const p1 = playerMap.get(pairing.player1Id)!;
              const isBye = pairing.player2Id === null;

              if (editingPairings) {
                const p2 = isBye ? null : playerMap.get(pairing.player2Id!)!;

                const playerSlot = (pid: string, pname: string) => (
                  <div className="flex-1 space-y-1.5">
                    <button
                      onClick={() => { setConfirmDrop(null); handleSelectForSwap(pid); }}
                      className={`w-full py-2 rounded-lg text-sm font-semibold transition-colors ${
                        selectedForSwap === pid
                          ? "bg-green-600 text-white ring-2 ring-green-400"
                          : selectedForSwap
                          ? "bg-slate-700 text-white hover:bg-slate-600 ring-1 ring-slate-500"
                          : "bg-slate-700 text-white hover:bg-slate-600"
                      }`}
                    >
                      {pname}
                    </button>
                    {confirmDrop === pid ? (
                      <div className="flex items-center gap-1.5 px-0.5">
                        <span className="text-xs text-slate-400">Drop permanently?</span>
                        <button
                          onClick={() => { handleDropPlayer(pid); setConfirmDrop(null); }}
                          className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
                        >
                          Yes
                        </button>
                        <button
                          onClick={() => setConfirmDrop(null)}
                          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-2 px-0.5">
                        <button
                          onClick={() => handleSkipRound(pid)}
                          className="flex-1 py-1 text-xs text-slate-400 hover:text-yellow-400 hover:bg-yellow-400/10 rounded transition-colors"
                        >
                          Skip round
                        </button>
                        <button
                          onClick={() => setConfirmDrop(pid)}
                          className="flex-1 py-1 text-xs text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                        >
                          Drop
                        </button>
                      </div>
                    )}
                  </div>
                );

                return (
                  <div key={pairing.id} className="bg-slate-800 rounded-xl px-4 py-3 flex items-start gap-3">
                    {playerSlot(pairing.player1Id, p1.name)}
                    {isBye ? (
                      <span className="text-xs text-slate-500 px-2 pt-2.5 shrink-0">BYE</span>
                    ) : (
                      <>
                        <span className="text-slate-600 text-sm shrink-0 pt-2.5">vs</span>
                        {playerSlot(pairing.player2Id!, p2!.name)}
                      </>
                    )}
                  </div>
                );
              }

              if (isBye) {
                return (
                  <div key={pairing.id} className="bg-slate-800 rounded-xl px-5 py-4 flex items-center justify-between">
                    <span className="font-medium">{p1.name}</span>
                    <span className="text-xs text-slate-400 bg-slate-700 px-3 py-1 rounded-full font-medium">
                      BYE — auto win
                    </span>
                  </div>
                );
              }

              const p2 = playerMap.get(pairing.player2Id!)!;
              const p1GameWins = pairing.games.filter((g) => g === "p1").length;
              const p2GameWins = pairing.games.filter((g) => g === "p2").length;
              const gameDraws = pairing.games.filter((g) => g === "draw").length;
              const gamesPlayed = pairing.games.length;
              const matchDone = pairing.result !== "pending";
              const canUndo = pairing.timedOut || gamesPlayed > 0;

              return (
                <div key={pairing.id} className="bg-slate-800 rounded-xl p-5 space-y-4">
                  {/* Score */}
                  <div className="flex items-center justify-between">
                    <div className="flex-1 text-center">
                      <div className={`font-semibold text-lg leading-tight ${
                        matchDone && pairing.result === "p1" ? "text-green-400"
                        : matchDone && pairing.result === "p2" ? "text-slate-500"
                        : "text-white"
                      }`}>
                        {p1.name}
                      </div>
                      <div className="text-4xl font-bold mt-1 tabular-nums">{p1GameWins}</div>
                    </div>

                    <div className="px-4 text-center">
                      <div className="text-slate-500 text-sm font-medium">vs</div>
                      {!matchDone && (
                        <div className="text-slate-600 text-xs mt-1">game {gamesPlayed + 1}</div>
                      )}
                    </div>

                    <div className="flex-1 text-center">
                      <div className={`font-semibold text-lg leading-tight ${
                        matchDone && pairing.result === "p2" ? "text-green-400"
                        : matchDone && pairing.result === "p1" ? "text-slate-500"
                        : "text-white"
                      }`}>
                        {p2.name}
                      </div>
                      <div className="text-4xl font-bold mt-1 tabular-nums">{p2GameWins}</div>
                    </div>
                  </div>

                  {/* Result banner */}
                  {matchDone && (
                    <div className={`text-center text-sm font-medium py-1.5 rounded-lg ${
                      pairing.result === "draw"
                        ? "text-yellow-400 bg-yellow-400/10"
                        : "text-green-400 bg-green-400/10"
                    }`}>
                      {pairing.timedOut && (
                        <span className="text-xs font-semibold bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded mr-2">
                          TIME
                        </span>
                      )}
                      {pairing.result === "p1"
                        ? `${p1.name} wins the match (${p1GameWins}–${p2GameWins})`
                        : pairing.result === "p2"
                        ? `${p2.name} wins the match (${p2GameWins}–${p1GameWins})`
                        : `Draw (${p1GameWins}–${p2GameWins}${gameDraws > 0 ? `–${gameDraws}` : ""})`}
                    </div>
                  )}

                  {/* Game buttons */}
                  {!matchDone && (
                    <>
                      <div className="flex gap-2">
                        <button
                          onClick={() => recordGame(pairing.id, "p1")}
                          className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-green-700 text-slate-300 hover:text-white transition-colors"
                        >
                          {p1.name} wins
                        </button>
                        <button
                          onClick={() => recordGame(pairing.id, "draw")}
                          className="px-4 py-2.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-yellow-700 text-slate-300 hover:text-white transition-colors"
                        >
                          Draw
                        </button>
                        <button
                          onClick={() => recordGame(pairing.id, "p2")}
                          className="flex-1 py-2.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-green-700 text-slate-300 hover:text-white transition-colors"
                        >
                          {p2.name} wins
                        </button>
                      </div>
                      <button
                        onClick={() => callTime(pairing.id)}
                        className="w-full py-1.5 rounded-lg text-xs text-orange-500 hover:text-orange-300 hover:bg-orange-500/10 border border-orange-500/20 hover:border-orange-500/40 transition-colors"
                      >
                        Call Time — end match at current score
                      </button>
                    </>
                  )}

                  {canUndo && (
                    <button
                      onClick={() => undoGame(pairing.id)}
                      className="w-full py-1.5 rounded-lg text-xs text-slate-600 hover:text-slate-400 hover:bg-slate-700 transition-colors"
                    >
                      {pairing.timedOut ? "undo time call" : "undo last game"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Standings */}
        <section>
          <h2 className="text-base font-semibold text-slate-300 uppercase tracking-wider mb-3">
            Overall Standings
          </h2>
          <div className="bg-slate-800 rounded-xl overflow-hidden">
            <StandingsTable
              standings={standings}
              droppedIds={new Set(players.filter((p) => p.dropped).map((p) => p.id))}
            />
          </div>
        </section>

        {/* Advance */}
        <button
          onClick={advanceRound}
          disabled={!allResultsIn}
          className="w-full bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
        >
          {advanceLabel}
        </button>

        {/* End early */}
        <div className="flex items-center justify-center gap-3 py-1">
          {confirmEnd ? (
            <>
              <span className="text-xs text-slate-400">End event with current standings?</span>
              <button
                onClick={() => { setPhase("event-complete"); setConfirmEnd(false); }}
                className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
              >
                Yes, end now
              </button>
              <button
                onClick={() => setConfirmEnd(false)}
                className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setConfirmEnd(true)}
              className="text-xs text-slate-600 hover:text-slate-400 transition-colors"
            >
              End event early
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── RoundTimer ────────────────────────────────────────────────────────────────

function calcSecondsLeft(t: TimerState): number {
  if (!t.running || !t.startedAt) return t.secondsAtStart;
  const elapsed = Math.floor((Date.now() - new Date(t.startedAt).getTime()) / 1000);
  return Math.max(0, t.secondsAtStart - elapsed);
}

function RoundTimer({
  timer,
  onUpdate,
}: {
  timer: TimerState;
  onUpdate: (t: TimerState) => void;
}) {
  const [secondsLeft, setSecondsLeft] = useState(() => calcSecondsLeft(timer));
  const [fullscreen, setFullscreen] = useState(false);

  // Re-sync display when timer state changes from outside (other browser, refresh)
  useEffect(() => {
    setSecondsLeft(calcSecondsLeft(timer));
  }, [timer]);

  // Tick when running
  useEffect(() => {
    if (!timer.running) return;
    const interval = setInterval(() => setSecondsLeft(calcSecondsLeft(timer)), 500);
    return () => clearInterval(interval);
  }, [timer.running, timer.startedAt, timer.secondsAtStart]);

  // Close fullscreen on Escape
  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  function handleToggle() {
    const sl = calcSecondsLeft(timer);
    if (timer.running) {
      onUpdate({ ...timer, running: false, startedAt: null, secondsAtStart: sl });
    } else {
      if (sl <= 0) return;
      onUpdate({ ...timer, running: true, startedAt: new Date().toISOString(), secondsAtStart: sl });
    }
  }

  function handleRestart() {
    onUpdate({ ...timer, running: false, startedAt: null, secondsAtStart: timer.durationSeconds });
  }

  const expired  = secondsLeft <= 0;
  const critical = !expired && secondsLeft < 2 * 60;
  const low      = !expired && !critical && secondsLeft < 5 * 60;
  const timeColor = expired ? "text-red-500" : critical ? "text-red-400" : low ? "text-yellow-400" : "text-white";
  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const display = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

  const controls = (large: boolean) => (
    <div className={`flex gap-3 ${large ? "mt-10" : ""}`} onClick={(e) => e.stopPropagation()}>
      <button
        onClick={handleToggle}
        disabled={expired}
        className={`rounded-xl font-semibold bg-slate-700 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors ${
          large ? "px-10 py-4 text-2xl" : "px-3 py-1.5 text-sm"
        }`}
      >
        {timer.running ? "Pause" : "Start"}
      </button>
      <button
        onClick={handleRestart}
        className={`rounded-xl font-semibold bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors ${
          large ? "px-10 py-4 text-2xl" : "px-3 py-1.5 text-sm"
        }`}
      >
        Restart
      </button>
    </div>
  );

  return (
    <>
      {/* Inline timer card */}
      <div className="bg-slate-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
        <div
          className="flex items-center gap-3 cursor-pointer select-none"
          onClick={() => setFullscreen(true)}
          title="Click to expand"
        >
          <span className={`text-3xl font-mono font-bold tabular-nums ${timeColor}`}>
            {display}
          </span>
          {expired && (
            <span className="text-xs font-semibold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">TIME</span>
          )}
          {!expired && !timer.running && secondsLeft < timer.durationSeconds && (
            <span className="text-xs text-slate-500">paused</span>
          )}
        </div>
        <div className="flex gap-2 shrink-0">
          {controls(false)}
        </div>
      </div>

      {/* Fullscreen overlay */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/95 backdrop-blur-sm cursor-pointer"
          onClick={() => setFullscreen(false)}
        >
          <div className="text-center" onClick={(e) => e.stopPropagation()}>
            <div className={`font-mono font-bold tabular-nums leading-none select-none ${timeColor}`}
                 style={{ fontSize: "clamp(6rem, 25vw, 18rem)" }}>
              {display}
            </div>
            {expired && (
              <div className="mt-4 text-3xl font-bold text-red-400 tracking-widest uppercase">
                Time's Up
              </div>
            )}
            {!expired && !timer.running && secondsLeft < timer.durationSeconds && (
              <div className="mt-4 text-xl text-slate-500">paused</div>
            )}
          </div>
          {controls(true)}
          <button
            className="absolute top-5 right-6 text-slate-600 hover:text-slate-300 text-sm transition-colors"
            onClick={() => setFullscreen(false)}
          >
            ✕ close
          </button>
        </div>
      )}
    </>
  );
}

// ── StandingsTable ────────────────────────────────────────────────────────────

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function StandingsTable({
  standings,
  medals,
  droppedIds,
}: {
  standings: Standing[];
  medals?: string[];
  droppedIds?: Set<string>;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-slate-400 text-xs uppercase tracking-wider text-left border-b border-slate-700">
            <th className="px-3 py-3 w-8">#</th>
            <th className="px-3 py-3">Player</th>
            <th className="px-2 py-3 text-center">W</th>
            <th className="px-2 py-3 text-center">L</th>
            <th className="px-2 py-3 text-center">D</th>
            <th className="px-2 py-3 text-center">Pts</th>
            <th className="px-2 py-3 text-right" title="Opponent Match Win %">OMW%</th>
            <th className="px-2 py-3 text-right" title="Game Win %">GW%</th>
            <th className="px-3 py-3 text-right" title="Opponent Game Win %">OGW%</th>
          </tr>
        </thead>
        <tbody>
          {standings.map((s, i) => {
            const dropped = droppedIds?.has(s.playerId) ?? false;
            return (
              <tr
                key={s.playerId}
                className={`border-t border-slate-700 ${dropped ? "opacity-40" :
                  medals && i === 0 ? "text-yellow-400"
                  : medals && i === 1 ? "text-slate-300"
                  : medals && i === 2 ? "text-amber-600"
                  : "text-slate-400"
                }`}
              >
                <td className="px-3 py-2.5 text-center font-bold">
                  {medals ? (medals[i] ?? i + 1) : i + 1}
                </td>
                <td className="px-3 py-2.5 font-medium">
                  <span>{s.name}</span>
                  {dropped && (
                    <span className="ml-2 text-xs text-red-400 font-normal">dropped</span>
                  )}
                </td>
                <td className="px-2 py-2.5 text-center text-green-400 font-medium">{s.wins}</td>
                <td className="px-2 py-2.5 text-center text-red-400 font-medium">{s.losses}</td>
                <td className="px-2 py-2.5 text-center text-yellow-400 font-medium">{s.draws}</td>
                <td className="px-2 py-2.5 text-center font-bold">{s.points}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{pct(s.omwPct)}</td>
                <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{pct(s.gwPct)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{pct(s.ogwPct)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
