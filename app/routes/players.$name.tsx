import { Link, useParams } from "react-router";
import { loadRegistry, winRate, gameWinRate } from "~/lib/playerRegistry";
import type { MatchRecord } from "~/lib/playerRegistry";

export function meta({ params }: { params: { name?: string } }) {
  const name = decodeURIComponent(params.name ?? "Player");
  return [{ title: `david.exe — ${name}` }];
}

// ── Grouping helpers ──────────────────────────────────────────────────────────

interface DraftGroup {
  draftNum: number;
  matches: MatchRecord[];
  wins: number;
  losses: number;
  draws: number;
}

interface EventGroup {
  date: string;
  drafts: DraftGroup[];
  wins: number;
  losses: number;
  draws: number;
}

function groupByEvent(matches: MatchRecord[]): EventGroup[] {
  const byDate = new Map<string, MatchRecord[]>();
  for (const m of matches) {
    const list = byDate.get(m.date) ?? [];
    list.push(m);
    byDate.set(m.date, list);
  }

  return [...byDate.entries()]
    .sort(([a], [b]) => b.localeCompare(a)) // most recent first
    .map(([date, eventMatches]) => {
      const byDraft = new Map<number, MatchRecord[]>();
      for (const m of eventMatches) {
        const list = byDraft.get(m.draftNum) ?? [];
        list.push(m);
        byDraft.set(m.draftNum, list);
      }

      const drafts: DraftGroup[] = [...byDraft.entries()]
        .sort(([a], [b]) => a - b)
        .map(([draftNum, draftMatches]) => {
          const sorted = [...draftMatches].sort((a, b) => a.roundNum - b.roundNum);
          return {
            draftNum,
            matches: sorted,
            wins:   sorted.filter((m) => m.result === "win").length,
            losses: sorted.filter((m) => m.result === "loss").length,
            draws:  sorted.filter((m) => m.result === "draw").length,
          };
        });

      return {
        date,
        drafts,
        wins:   eventMatches.filter((m) => m.result === "win").length,
        losses: eventMatches.filter((m) => m.result === "loss").length,
        draws:  eventMatches.filter((m) => m.result === "draw").length,
      };
    });
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── Result badge ──────────────────────────────────────────────────────────────

function ResultBadge({ result }: { result: MatchRecord["result"] }) {
  const styles: Record<MatchRecord["result"], string> = {
    win:  "bg-green-500/20 text-green-400",
    loss: "bg-red-500/20 text-red-400",
    draw: "bg-yellow-500/20 text-yellow-400",
    bye:  "bg-slate-600 text-slate-400",
  };
  const labels = { win: "W", loss: "L", draw: "D", bye: "BYE" };
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded ${styles[result]}`}>
      {labels[result]}
    </span>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function PlayerDetail() {
  const { name } = useParams();
  const playerName = decodeURIComponent(name ?? "");

  const registry = loadRegistry();
  const player = registry.find((p) => p.name === playerName);

  if (!player) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <p className="text-slate-400 text-lg">Player "{playerName}" not found.</p>
          <Link to="/players" className="text-green-400 hover:underline text-sm">
            ← Back to Players
          </Link>
        </div>
      </div>
    );
  }

  const wr  = winRate(player);
  const gwr = gameWinRate(player);
  const totalMatches = player.matchWins + player.matchLosses + player.matchDraws;
  const events = groupByEvent(player.matches ?? []);

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-mono font-bold text-green-400">david.exe</h1>
            <p className="text-slate-400 text-sm">Match History</p>
          </div>
          <div className="flex gap-2">
            <Link
              to="/players"
              className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              ← Players
            </Link>
            <Link
              to="/info"
              className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              Info
            </Link>
          </div>
        </div>

        {/* Career summary card */}
        <div className="bg-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-2xl font-bold">{player.name}</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Record</div>
              <div className="font-semibold">
                <span className="text-green-400">{player.matchWins}W</span>
                <span className="text-slate-500"> · </span>
                <span className="text-red-400">{player.matchLosses}L</span>
                {player.matchDraws > 0 && (
                  <>
                    <span className="text-slate-500"> · </span>
                    <span className="text-yellow-400">{player.matchDraws}D</span>
                  </>
                )}
              </div>
            </div>

            <div>
              <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Win Rate</div>
              <div className={`font-semibold ${
                wr >= 0.65 ? "text-green-400" : wr >= 0.5 ? "text-white" : "text-red-400"
              }`}>
                {totalMatches === 0 ? "—" : `${(wr * 100).toFixed(1)}%`}
              </div>
            </div>

            <div>
              <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Game Win%</div>
              <div className="text-white font-semibold">
                {gwr === null ? "—" : `${(gwr * 100).toFixed(1)}%`}
              </div>
            </div>

            <div>
              <div className="text-slate-400 text-xs uppercase tracking-wider mb-1">Events</div>
              <div className="text-white font-semibold">{player.eventsPlayed}</div>
            </div>
          </div>
        </div>

        {/* Match history */}
        {events.length === 0 ? (
          <div className="bg-slate-800 rounded-2xl p-8 text-center text-slate-400">
            No detailed match history recorded yet.
            <p className="text-sm mt-1 text-slate-500">
              History is captured when you complete an event.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => (
              <div key={event.date} className="bg-slate-800 rounded-2xl overflow-hidden">
                {/* Event header */}
                <div className="px-5 py-3 bg-slate-700 flex items-center justify-between">
                  <span className="font-semibold text-sm">{formatDate(event.date)}</span>
                  <span className="text-slate-400 text-xs tabular-nums">
                    {event.wins}W–{event.losses}L{event.draws > 0 ? `–${event.draws}D` : ""}
                  </span>
                </div>

                {event.drafts.map((draft, di) => (
                  <div key={draft.draftNum}>
                    {/* Draft sub-header */}
                    <div className={`px-5 py-2 flex items-center justify-between ${
                      di > 0 ? "border-t border-slate-700" : ""
                    } bg-slate-800`}>
                      <span className="text-xs text-slate-400 uppercase tracking-wider font-medium">
                        Draft {draft.draftNum}
                      </span>
                      <span className="text-slate-500 text-xs tabular-nums">
                        {draft.wins}W–{draft.losses}L{draft.draws > 0 ? `–${draft.draws}D` : ""}
                      </span>
                    </div>

                    {/* Matches */}
                    {draft.matches.map((match, mi) => (
                      <div
                        key={mi}
                        className="px-5 py-3 border-t border-slate-700 flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <span className="text-slate-500 text-xs w-5 shrink-0">
                            R{match.roundNum}
                          </span>
                          <span className={`font-medium ${
                            match.opponent === "BYE" ? "text-slate-400" : "text-white"
                          }`}>
                            {match.opponent}
                          </span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-slate-400 text-sm tabular-nums">
                            {match.gameScore}
                          </span>
                          <ResultBadge result={match.result} />
                        </div>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
