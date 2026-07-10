import { useState, useEffect } from "react";
import { Link } from "react-router";
import { loadRegistry, fetchAndMergeRegistryFromServer, winRate, gameWinRate } from "~/lib/playerRegistry";
import type { RegisteredPlayer } from "~/lib/playerRegistry";

export function meta() {
  return [{ title: "david.exe — Players" }];
}

type SortKey = "name" | "events" | "wins" | "losses" | "draws" | "points" | "winRate" | "gwRate";
type SortDir = "asc" | "desc";

const SORT_DEFAULTS: Record<SortKey, SortDir> = {
  name: "asc",
  events: "desc",
  wins: "desc",
  losses: "asc",
  draws: "desc",
  points: "desc",
  winRate: "desc",
  gwRate: "desc",
};

function sortPlayers(
  players: RegisteredPlayer[],
  key: SortKey,
  dir: SortDir
): RegisteredPlayer[] {
  return [...players].sort((a, b) => {
    let cmp = 0;
    if (key === "name") cmp = a.name.localeCompare(b.name);
    else if (key === "events") cmp = a.eventsPlayed - b.eventsPlayed;
    else if (key === "wins") cmp = a.matchWins - b.matchWins;
    else if (key === "losses") cmp = a.matchLosses - b.matchLosses;
    else if (key === "draws") cmp = a.matchDraws - b.matchDraws;
    else if (key === "points") cmp = a.matchPoints - b.matchPoints;
    else if (key === "winRate") cmp = winRate(a) - winRate(b);
    else if (key === "gwRate")  cmp = (gameWinRate(a) ?? 0) - (gameWinRate(b) ?? 0);
    return dir === "asc" ? cmp : -cmp;
  });
}

export default function Players() {
  const [players, setPlayers] = useState<RegisteredPlayer[]>(() =>
    loadRegistry()
  );
  const [sortKey, setSortKey] = useState<SortKey>("winRate");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    fetchAndMergeRegistryFromServer().then(setPlayers);
  }, []);

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(SORT_DEFAULTS[key]);
    }
  }

  function refresh() {
    setPlayers(loadRegistry());
  }

  const sorted = sortPlayers(players, sortKey, sortDir);
  const totalEvents = players.reduce((s, p) => Math.max(s, p.eventsPlayed), 0);

  function SortHeader({
    col,
    label,
    className = "",
  }: {
    col: SortKey;
    label: string;
    className?: string;
  }) {
    const active = sortKey === col;
    return (
      <th
        className={`px-3 py-3 cursor-pointer select-none hover:text-slate-200 transition-colors ${
          active ? "text-green-400" : "text-slate-400"
        } ${className}`}
        onClick={() => handleSort(col)}
      >
        {label}
        {active && (
          <span className="ml-1 text-xs">{sortDir === "desc" ? "↓" : "↑"}</span>
        )}
      </th>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-3xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-mono font-bold text-green-400">david.exe</h1>
            <p className="text-slate-400 text-sm">Player Records</p>
          </div>
          <nav className="flex gap-2">
            <Link
              to="/"
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              ← Event
            </Link>
            <Link
              to="/info"
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              Info
            </Link>
            <button
              onClick={refresh}
              className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
            >
              Refresh
            </button>
          </nav>
        </div>

        {players.length === 0 ? (
          <div className="bg-slate-800 rounded-2xl p-12 text-center">
            <p className="text-slate-400 text-lg">No player records yet.</p>
            <p className="text-slate-500 text-sm mt-2">
              Complete an event to start building history.
            </p>
          </div>
        ) : (
          <>
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "Players", value: players.length },
                { label: "Events tracked", value: totalEvents },
                {
                  label: "Best win rate",
                  value:
                    sorted[0] && sorted[0].eventsPlayed > 0
                      ? `${(winRate(sorted[0]) * 100).toFixed(0)}% ${sorted[0].name}`
                      : "—",
                },
              ].map(({ label, value }) => (
                <div key={label} className="bg-slate-800 rounded-xl p-4">
                  <div className="text-slate-400 text-xs uppercase tracking-wider">{label}</div>
                  <div className="text-white font-semibold mt-1 truncate">{value}</div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className="bg-slate-800 rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wider border-b border-slate-700 text-left">
                    <th className="px-4 py-3 w-8 text-slate-400">#</th>
                    <SortHeader col="name" label="Player" className="text-left px-4" />
                    <SortHeader col="events" label="Events" className="text-center" />
                    <SortHeader col="wins" label="W" className="text-center" />
                    <SortHeader col="losses" label="L" className="text-center" />
                    <SortHeader col="draws" label="D" className="text-center" />
                    <SortHeader col="points" label="Pts" className="text-right" />
                    <SortHeader col="winRate" label="Win%" className="text-right" />
                    <SortHeader col="gwRate" label="GW%" className="text-right pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((p, i) => {
                    const wr  = winRate(p);
                    const gwr = gameWinRate(p);
                    const totalMatches = p.matchWins + p.matchLosses + p.matchDraws;
                    return (
                      <tr
                        key={p.name}
                        className={`border-t border-slate-700 ${
                          i === 0 ? "bg-slate-700/30" : ""
                        }`}
                      >
                        <td className="px-4 py-3 text-slate-500 text-center">{i + 1}</td>
                        <td className="px-4 py-3 font-medium">
                          <Link
                            to={`/players/${p.id}`}
                            className="text-white hover:text-green-400 transition-colors"
                          >
                            {p.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-center text-slate-400">{p.eventsPlayed}</td>
                        <td className="px-3 py-3 text-center text-green-400 font-medium">{p.matchWins}</td>
                        <td className="px-3 py-3 text-center text-red-400 font-medium">{p.matchLosses}</td>
                        <td className="px-3 py-3 text-center text-yellow-400 font-medium">{p.matchDraws}</td>
                        <td className="px-3 py-3 text-right font-bold">{p.matchPoints}</td>
                        {/* Match Win % with mini bar */}
                        <td className="px-3 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {totalMatches > 0 && (
                              <div className="w-12 h-1.5 bg-slate-600 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-green-500 rounded-full"
                                  style={{ width: `${wr * 100}%` }}
                                />
                              </div>
                            )}
                            <span className={`font-medium tabular-nums ${
                              wr >= 0.65 ? "text-green-400" : wr >= 0.5 ? "text-slate-300" : "text-red-400"
                            }`}>
                              {totalMatches === 0 ? "—" : `${(wr * 100).toFixed(1)}%`}
                            </span>
                          </div>
                        </td>
                        {/* Game Win % */}
                        <td className="px-3 py-3 pr-4 text-right tabular-nums text-slate-400">
                          {gwr === null ? "—" : `${(gwr * 100).toFixed(1)}%`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
