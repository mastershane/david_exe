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
import { loadRegistry, recordEventStats } from "~/lib/playerRegistry";
import type { MatchRecord } from "~/lib/playerRegistry";
import { loadEvent, saveEvent, deleteEvent, syncEventToServer } from "~/lib/eventStore";
import type { Phase } from "~/lib/eventStore";
import { syncRegistryToServer } from "~/lib/playerRegistry";

export function meta() {
  return [{ title: "david.exe — MTG Draft" }];
}

const MIN_PLAYERS = 6;
const MAX_PLAYERS = 12;

// ── Match-record builder (for career stats) ───────────────────────────────────

function buildMatchRecords(
  players: Player[],
  drafts: Round[][],
  date: string
): Map<string, MatchRecord[]> {
  const idToName = new Map(players.map((p) => [p.id, p.name]));
  const result = new Map<string, MatchRecord[]>(players.map((p) => [p.name, []]));

  drafts.forEach((draft, draftIdx) => {
    draft.forEach((round, roundIdx) => {
      round.pairings.forEach((pairing) => {
        if (pairing.result === "pending") return;
        const draftNum = draftIdx + 1;
        const roundNum = roundIdx + 1;
        const p1Name = idToName.get(pairing.player1Id)!;

        if (pairing.player2Id === null) {
          result.get(p1Name)?.push({ date, draftNum, roundNum, opponent: "BYE", result: "bye", gameScore: "BYE" });
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

        result.get(p1Name)?.push({ date, draftNum, roundNum, opponent: p2Name, result: p1Result, gameScore: `${p1Wins}–${p2Wins}${suffix}` });
        result.get(p2Name)?.push({ date, draftNum, roundNum, opponent: p1Name, result: p2Result, gameScore: `${p2Wins}–${p1Wins}${suffix}` });
      });
    });
  });

  return result;
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
  const [playerCount, setPlayerCount]       = useState(() => saved?.playerCount ?? 8);
  const [playerNames, setPlayerNames]       = useState<string[]>(() => saved?.playerNames ?? Array(MAX_PLAYERS).fill(""));

  // ── Event state ───────────────────────────────────────────────────────────
  const [phase, setPhase]                             = useState<Phase>(() => saved?.phase ?? "event-setup");
  const [players, setPlayers]                         = useState<Player[]>(() => saved?.players ?? []);
  const [drafts, setDrafts]                           = useState<Round[][]>(() => saved?.drafts ?? []);
  const [currentDraftIdx, setCurrentDraftIdx]         = useState(() => saved?.currentDraftIdx ?? 0);
  const [currentRoundInDraft, setCurrentRoundInDraft] = useState(() => saved?.currentRoundInDraft ?? 1);
  const [statsRecorded, setStatsRecorded]             = useState(() => saved?.statsRecorded ?? false);

  // Known names for autocomplete (not persisted in event state)
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
      playerCount,
      playerNames,
      phase,
      players,
      drafts,
      currentDraftIdx,
      currentRoundInDraft,
      statsRecorded,
    };
    saveEvent(state);

    // Debounced server sync — fires 5 s after the last state change.
    // Skip during event-setup (data is still being entered).
    if (phase !== "event-setup") {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
      syncTimerRef.current = setTimeout(() => syncEventToServer(state), 5_000);
    }
  }, [id, name, numDrafts, roundsPerDraft, playerCount, playerNames, phase, players, drafts, currentDraftIdx, currentRoundInDraft, statsRecorded]);

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
  const allResultsIn = currentRound?.pairings.every((p) => p.result !== "pending") ?? false;
  const isLastRoundInDraft = currentRoundInDraft === roundsPerDraft;
  const isLastDraft = currentDraftIdx === numDrafts - 1;
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);
  const totalRoundsInEvent = numDrafts * roundsPerDraft;
  const completedRoundsCount = currentDraftIdx * roundsPerDraft + (currentRoundInDraft - 1);

  // ── Record career stats once when the event finishes ─────────────────────
  useEffect(() => {
    if (phase !== "event-complete" || statsRecorded) return;

    const date = new Date().toISOString();
    const matchesByName = buildMatchRecords(players, drafts, date);

    recordEventStats(
      standings.map((s) => ({
        name: s.name,
        wins: s.wins,
        losses: s.losses,
        draws: s.draws,
        points: s.points,
        gameWins: s.gameWins,
        gameLosses: s.gameLosses,
        gameDraws: s.gameDraws,
        matches: matchesByName.get(s.name) ?? [],
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
    return <div className="min-h-screen bg-slate-900" />;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function handleNameChange(idx: number, value: string) {
    setPlayerNames((prev) => prev.map((n, i) => (i === idx ? value : n)));
  }

  function makePairings(standingsList: Standing[]) {
    return createPairings(standingsList);
  }

  function startEvent() {
    const names = playerNames.slice(0, playerCount).map((n) => n.trim());
    if (names.some((n) => !n)) return;

    const ps: Player[] = names.map((n, i) => ({ id: `p${i}`, name: n }));
    const shuffled = [...ps].sort(() => Math.random() - 0.5);
    const initStandings: Standing[] = shuffled.map((p) => ({
      playerId: p.id,
      name: p.name,
      wins: 0, losses: 0, draws: 0, byes: 0, points: 0,
      opponentIds: [],
      gameWins: 0, gameLosses: 0, gameDraws: 0,
      omwPct: 1 / 3, gwPct: 1 / 3, ogwPct: 1 / 3,
    }));

    setPlayers(ps);
    setDrafts([[{ number: 1, pairings: makePairings(initStandings) }]]);
    setCurrentDraftIdx(0);
    setCurrentRoundInDraft(1);
    setPhase("playing");
    // Immediate sync so the new event appears on other devices right away
    syncEventToServer({
      id: id!,
      name,
      createdAt: saved?.createdAt ?? new Date().toISOString(),
      numDrafts,
      roundsPerDraft,
      playerCount,
      playerNames,
      phase: "playing",
      players: ps,
      drafts: [[{ number: 1, pairings: makePairings(initStandings) }]],
      currentDraftIdx: 0,
      currentRoundInDraft: 1,
      statsRecorded,
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

  function advanceRound() {
    if (!isLastRoundInDraft) {
      const nextRoundNum = currentRoundInDraft + 1;
      updateCurrentDraft((draft) => [
        ...draft,
        { number: nextRoundNum, pairings: makePairings(standings) },
      ]);
      setCurrentRoundInDraft(nextRoundNum);
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
    const names = playerNames.slice(0, playerCount);
    const canStart = names.every((n) => n.trim().length > 0);
    const recommendedRounds = totalRounds(playerCount);

    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <datalist id="known-players">
          {knownPlayerNames.map((n) => <option key={n} value={n} />)}
        </datalist>

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
                <select
                  value={playerCount}
                  onChange={(e) => setPlayerCount(Number(e.target.value))}
                  className="bg-slate-700 rounded-lg px-2 py-1 text-white text-sm border border-slate-600 focus:outline-none focus:border-green-500"
                >
                  {Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => i + MIN_PLAYERS).map((n) => (
                    <option key={n} value={n}>{n} players</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                {Array.from({ length: playerCount }, (_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="text-slate-500 w-5 text-right text-sm shrink-0">{i + 1}</span>
                    <input
                      type="text"
                      value={playerNames[i]}
                      onChange={(e) => handleNameChange(i, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          if (i < playerCount - 1) {
                            document.getElementById(`player-${i + 1}`)?.focus();
                          } else if (canStart) {
                            startEvent();
                          }
                        }
                      }}
                      id={`player-${i}`}
                      list="known-players"
                      placeholder={`Player ${i + 1}`}
                      className="flex-1 bg-slate-700 rounded-lg px-3 py-2 text-white border border-slate-600 focus:outline-none focus:border-green-500 placeholder-slate-500"
                    />
                  </div>
                ))}
              </div>
            </div>

            <button
              onClick={startEvent}
              disabled={!canStart}
              className="w-full bg-green-600 hover:bg-green-500 disabled:bg-slate-700 disabled:text-slate-500 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Start Event
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
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
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
        </div>
      </div>
    );
  }

  // ── Event Complete ────────────────────────────────────────────────────────
  if (phase === "event-complete") {
    const medals = ["🥇", "🥈", "🥉"];

    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
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
    <div className="min-h-screen bg-slate-900 text-white p-4">
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
        <RoundTimer
          roundKey={`${currentDraftIdx}-${currentRoundInDraft}`}
          durationMinutes={appConfig.roundMinutes}
        />

        {/* Pairings */}
        <section>
          <h2 className="text-base font-semibold text-slate-300 uppercase tracking-wider mb-3">
            Pairings — Best of 3
          </h2>
          <div className="space-y-3">
            {currentRound?.pairings.map((pairing) => {
              const p1 = playerMap.get(pairing.player1Id)!;
              const isBye = pairing.player2Id === null;

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
            <StandingsTable standings={standings} />
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
      </div>
    </div>
  );
}

// ── RoundTimer ────────────────────────────────────────────────────────────────

function RoundTimer({ roundKey, durationMinutes }: { roundKey: string; durationMinutes: number }) {
  const totalSeconds = durationMinutes * 60;
  const [secondsLeft, setSecondsLeft] = useState(totalSeconds);
  const [running, setRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setRunning(false);
    setSecondsLeft(durationMinutes * 60);
  }, [roundKey, durationMinutes]);

  useEffect(() => {
    if (running) {
      intervalRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) { setRunning(false); return 0; }
          return prev - 1;
        });
      }, 1000);
    }
    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
    };
  }, [running]);

  function restart() {
    setRunning(false);
    setSecondsLeft(totalSeconds);
  }

  const mins = Math.floor(secondsLeft / 60);
  const secs = secondsLeft % 60;
  const display = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  const expired  = secondsLeft === 0;
  const critical = !expired && secondsLeft < 2 * 60;
  const low      = !expired && !critical && secondsLeft < 5 * 60;

  return (
    <div className="bg-slate-800 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <span className={`text-3xl font-mono font-bold tabular-nums ${
          expired ? "text-red-500" : critical ? "text-red-400" : low ? "text-yellow-400" : "text-white"
        }`}>
          {display}
        </span>
        {expired && (
          <span className="text-xs font-semibold bg-red-500/20 text-red-400 px-2 py-0.5 rounded-full">TIME</span>
        )}
        {!expired && !running && secondsLeft < totalSeconds && (
          <span className="text-xs text-slate-500">paused</span>
        )}
      </div>
      <div className="flex gap-2 shrink-0">
        <button
          onClick={() => setRunning((r) => !r)}
          disabled={expired}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
        >
          {running ? "Pause" : "Start"}
        </button>
        <button
          onClick={restart}
          className="px-3 py-1.5 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors"
        >
          Restart
        </button>
      </div>
    </div>
  );
}

// ── StandingsTable ────────────────────────────────────────────────────────────

function pct(n: number) {
  return `${(n * 100).toFixed(1)}%`;
}

function StandingsTable({
  standings,
  medals,
}: {
  standings: Standing[];
  medals?: string[];
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
          {standings.map((s, i) => (
            <tr
              key={s.playerId}
              className={`border-t border-slate-700 ${
                medals && i === 0 ? "text-yellow-400"
                : medals && i === 1 ? "text-slate-300"
                : medals && i === 2 ? "text-amber-600"
                : "text-slate-400"
              }`}
            >
              <td className="px-3 py-2.5 text-center font-bold">
                {medals ? (medals[i] ?? i + 1) : i + 1}
              </td>
              <td className="px-3 py-2.5 font-medium">{s.name}</td>
              <td className="px-2 py-2.5 text-center text-green-400 font-medium">{s.wins}</td>
              <td className="px-2 py-2.5 text-center text-red-400 font-medium">{s.losses}</td>
              <td className="px-2 py-2.5 text-center text-yellow-400 font-medium">{s.draws}</td>
              <td className="px-2 py-2.5 text-center font-bold">{s.points}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{pct(s.omwPct)}</td>
              <td className="px-2 py-2.5 text-right tabular-nums text-slate-300">{pct(s.gwPct)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums text-slate-300">{pct(s.ogwPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
