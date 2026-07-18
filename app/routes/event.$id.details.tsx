import { useState, useEffect } from "react";
import { Link, useParams } from "react-router";
import { loadEvent, fetchAndMergeFromServer } from "~/lib/eventStore";
import type { EventState } from "~/lib/eventStore";
import type { Pairing, Player } from "~/lib/tournament";

export function meta() {
  return [{ title: "david.exe — Event Details" }];
}

const RESULT_LABEL: Record<string, string> = {
  p1: "W",
  p2: "L",
  draw: "D",
  pending: "—",
};

const RESULT_COLOR: Record<string, string> = {
  p1: "text-green-400",
  p2: "text-red-400",
  draw: "text-yellow-400",
  pending: "text-slate-500",
};

function gameScore(pairing: Pairing): string {
  const p1w = pairing.games.filter((g) => g === "p1").length;
  const p2w = pairing.games.filter((g) => g === "p2").length;
  if (pairing.games.length === 0) return "—";
  return `${p1w}–${p2w}${pairing.timedOut ? " T" : ""}`;
}

function PairingRow({
  pairing,
  nameOf,
}: {
  pairing: Pairing;
  nameOf: (id: string | null) => string;
}) {
  const isBye = pairing.player2Id === null;
  const p1name = nameOf(pairing.player1Id);
  const p2name = isBye ? "BYE" : nameOf(pairing.player2Id);

  // From p1's perspective
  const p1ResultKey = isBye ? "p1" : pairing.result;
  const p2ResultKey = isBye
    ? "p1"
    : pairing.result === "p1"
    ? "p2"
    : pairing.result === "p2"
    ? "p1"
    : pairing.result;

  return (
    <div className="bg-slate-800 rounded-xl px-4 py-3 space-y-2">
      {/* Players row */}
      <div className="flex items-center gap-3 text-sm">
        {/* P1 */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`text-xs font-bold w-5 text-center shrink-0 ${
              isBye ? "text-slate-500" : RESULT_COLOR[p1ResultKey]
            }`}
          >
            {isBye ? "BYE" : RESULT_LABEL[p1ResultKey]}
          </span>
          <span className="text-white font-medium truncate">{p1name}</span>
        </div>

        {/* Score */}
        {!isBye && (
          <span className="text-xs text-slate-500 shrink-0 font-mono">
            {gameScore(pairing)}
          </span>
        )}

        {/* vs divider */}
        <span className="text-slate-600 text-xs shrink-0">vs</span>

        {/* P2 */}
        <div className="flex items-center gap-2 flex-1 min-w-0 justify-end">
          <span className="text-slate-400 font-medium truncate text-right">
            {p2name}
          </span>
          {!isBye && (
            <span
              className={`text-xs font-bold w-5 text-center shrink-0 ${RESULT_COLOR[p2ResultKey]}`}
            >
              {RESULT_LABEL[p2ResultKey]}
            </span>
          )}
        </div>
      </div>

      {/* Notes */}
      {pairing.notes && (
        <p className="text-xs text-slate-400 italic border-t border-slate-700 pt-2">
          "{pairing.notes}"
        </p>
      )}
    </div>
  );
}

export default function EventDetails() {
  const { id } = useParams<{ id: string }>();
  const [event, setEvent] = useState<EventState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    const local = loadEvent(id);
    if (local) {
      setEvent(local);
      setLoading(false);
    }
    fetchAndMergeFromServer().then((all) => {
      const found = all.find((e) => e.id === id);
      if (found) setEvent(found);
      setLoading(false);
    });
  }, [id]);

  if (loading && !event) {
    return (
      <div className="min-h-screen text-white p-4 flex items-center justify-center">
        <p className="text-slate-500">Loading…</p>
      </div>
    );
  }

  if (!event) {
    return (
      <div className="min-h-screen text-white p-4 flex items-center justify-center">
        <p className="text-slate-500">Event not found.</p>
      </div>
    );
  }

  const nameOf = (pid: string | null): string => {
    if (!pid) return "?";
    return event.players.find((p) => p.id === pid)?.name ?? "Unknown";
  };

  const createdDate = new Date(event.createdAt).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  // Collect all notes across all pairings
  const allNotes: { draft: number; round: number; pairing: Pairing }[] = [];
  event.drafts.forEach((draft, di) => {
    draft.forEach((round, ri) => {
      round.pairings.forEach((pairing) => {
        if (pairing.notes) allNotes.push({ draft: di + 1, round: ri + 1, pairing });
      });
    });
  });

  return (
    <div className="min-h-screen text-white p-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="space-y-1">
          <Link
            to={`/event/${event.id}`}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            ← back to event
          </Link>
          <h1 className="text-2xl font-bold text-white">{event.name}</h1>
          <p className="text-sm text-slate-400">{createdDate}</p>
          <p className="text-xs text-slate-600">
            {event.players.map((p) => p.name).join(" · ")}
          </p>
        </div>

        {/* Notes summary (if any) */}
        {allNotes.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Match Notes
            </h2>
            <div className="space-y-2">
              {allNotes.map(({ draft, round, pairing }) => {
                const p1 = nameOf(pairing.player1Id);
                const p2 = pairing.player2Id ? nameOf(pairing.player2Id) : null;
                return (
                  <div
                    key={pairing.id}
                    className="bg-slate-800 rounded-xl px-4 py-3 space-y-1"
                  >
                    <p className="text-xs text-slate-500">
                      Draft {draft} · Round {round} —{" "}
                      <span className="text-slate-400">
                        {p1}{p2 ? ` vs ${p2}` : " (bye)"}
                      </span>
                    </p>
                    <p className="text-sm text-slate-300 italic">"{pairing.notes}"</p>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* Per-draft rounds */}
        {event.drafts.map((draft, di) => (
          <section key={di} className="space-y-4">
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
              Draft {di + 1}
            </h2>

            {draft.length === 0 && (
              <p className="text-xs text-slate-600">No rounds played.</p>
            )}

            {draft.map((round, ri) => (
              <div key={ri} className="space-y-2">
                <h3 className="text-xs font-medium text-slate-600 uppercase tracking-wider px-1">
                  Round {round.number}
                </h3>
                {round.pairings.length === 0 ? (
                  <p className="text-xs text-slate-700 px-1">No pairings.</p>
                ) : (
                  <div className="space-y-2">
                    {round.pairings.map((pairing) => (
                      <PairingRow
                        key={pairing.id}
                        pairing={pairing}
                        nameOf={nameOf}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}

        {event.drafts.length === 0 && (
          <div className="bg-slate-800 rounded-xl p-8 text-center">
            <p className="text-slate-500 text-sm">No rounds have been played yet.</p>
          </div>
        )}

      </div>
    </div>
  );
}
