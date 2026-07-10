import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import {
  loadAllEvents,
  createEvent,
  deleteEvent,
  deleteEventFromServer,
  migrateLegacyEvent,
  fetchAndMergeFromServer,
  syncEventToServer,
} from "~/lib/eventStore";
import type { EventState, Phase } from "~/lib/eventStore";

export function meta() {
  return [{ title: "david.exe — Events" }];
}

// ── Status display helpers ────────────────────────────────────────────────────

const PHASE_LABEL: Record<Phase, string> = {
  "event-setup": "Setup",
  "playing": "In Progress",
  "between-drafts": "Between Drafts",
  "event-complete": "Complete",
};

const PHASE_BADGE: Record<Phase, string> = {
  "event-setup":    "bg-slate-700 text-slate-400",
  "playing":        "bg-green-600/20 text-green-400 ring-1 ring-green-500/30",
  "between-drafts": "bg-blue-600/20 text-blue-400 ring-1 ring-blue-500/30",
  "event-complete": "bg-slate-700/60 text-slate-500",
};

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventState[]>([]);
  const [hasMounted, setHasMounted] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  useEffect(() => {
    migrateLegacyEvent();
    // Show localStorage events immediately for instant paint
    setEvents(loadAllEvents());
    setHasMounted(true);
    // Then fetch from server and update (server is source of truth)
    fetchAndMergeFromServer().then(setEvents);
  }, []);

  if (!hasMounted) return <div className="min-h-screen bg-slate-900" />;

  function handleNewEvent() {
    const event = createEvent();
    syncEventToServer(event); // immediately push the new event to the DB
    navigate(`/event/${event.id}`);
  }

  function handleDelete(id: string) {
    if (confirmDelete !== id) {
      setConfirmDelete(id);
      return;
    }
    deleteEvent(id);
    deleteEventFromServer(id); // fire-and-forget
    setEvents((prev) => prev.filter((e) => e.id !== id));
    setConfirmDelete(null);
  }

  const active   = events.filter((e) => e.phase !== "event-complete");
  const complete = events.filter((e) => e.phase === "event-complete");

  return (
    <div className="min-h-screen bg-slate-900 text-white p-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-mono font-bold text-green-400">david.exe</h1>
            <p className="text-slate-400 text-sm">MTG Draft — Swiss Pairing</p>
          </div>
          <nav className="flex items-center gap-3">
            <Link to="/players" className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Players ↗
            </Link>
            <Link to="/settings" className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Settings ↗
            </Link>
            <Link to="/info" className="text-sm text-slate-400 hover:text-slate-200 transition-colors">
              Info ↗
            </Link>
          </nav>
        </div>

        {/* Event list header + new button */}
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">
            Events{events.length > 0 && ` (${events.length})`}
          </h2>
          <button
            onClick={handleNewEvent}
            className="bg-green-600 hover:bg-green-500 text-white font-semibold px-4 py-2 rounded-xl text-sm transition-colors"
          >
            + New Event
          </button>
        </div>

        {/* Empty state */}
        {events.length === 0 && (
          <div className="bg-slate-800 rounded-2xl p-12 text-center space-y-4">
            <p className="text-slate-300 font-semibold text-lg">No events yet</p>
            <p className="text-slate-500 text-sm">
              Create an event to start tracking Swiss pairings.
            </p>
            <button
              onClick={handleNewEvent}
              className="bg-green-600 hover:bg-green-500 text-white font-semibold px-6 py-3 rounded-xl transition-colors"
            >
              + New Event
            </button>
          </div>
        )}

        {/* Active / in-progress events */}
        {active.length > 0 && (
          <ul className="space-y-3">
            {active.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                confirmDelete={confirmDelete}
                onDelete={handleDelete}
                onCancelDelete={() => setConfirmDelete(null)}
              />
            ))}
          </ul>
        )}

        {/* Completed events */}
        {complete.length > 0 && (
          <section className="space-y-3">
            <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wider">
              Completed
            </h3>
            <ul className="space-y-3">
              {complete.map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  confirmDelete={confirmDelete}
                  onDelete={handleDelete}
                  onCancelDelete={() => setConfirmDelete(null)}
                />
              ))}
            </ul>
          </section>
        )}

      </div>
    </div>
  );
}

// ── Event card ────────────────────────────────────────────────────────────────

function EventCard({
  event,
  confirmDelete,
  onDelete,
  onCancelDelete,
}: {
  event: EventState;
  confirmDelete: string | null;
  onDelete: (id: string) => void;
  onCancelDelete: () => void;
}) {
  const isConfirming = confirmDelete === event.id;

  // Progress description shown under the name
  const progress = (() => {
    if (event.phase === "event-setup") {
      return `${event.playerCount} players · ${event.numDrafts} draft${event.numDrafts !== 1 ? "s" : ""} · ${event.roundsPerDraft} rounds each`;
    }
    if (event.phase === "event-complete") {
      const total = event.numDrafts * event.roundsPerDraft;
      return `${event.numDrafts} draft${event.numDrafts !== 1 ? "s" : ""} · ${total} rounds played`;
    }
    return `Draft ${event.currentDraftIdx + 1} of ${event.numDrafts} · Round ${event.currentRoundInDraft} of ${event.roundsPerDraft}`;
  })();

  // Comma-separated player list (prefer locked-in players over pre-filled names)
  const playerLine =
    event.players.length > 0
      ? event.players.map((p) => p.name).join(", ")
      : event.playerNames.filter(Boolean).join(", ");

  const createdDate = new Date(event.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  return (
    <li className="bg-slate-800 rounded-xl overflow-hidden">
      {/* Main clickable area */}
      <Link
        to={`/event/${event.id}`}
        className="flex items-start gap-4 px-5 py-4 hover:bg-slate-750 transition-colors group"
      >
        {/* Status dot */}
        <div className="pt-1 shrink-0">
          <span
            className={`block w-2 h-2 rounded-full ${
              event.phase === "playing"
                ? "bg-green-400"
                : event.phase === "between-drafts"
                ? "bg-blue-400"
                : event.phase === "event-setup"
                ? "bg-slate-500"
                : "bg-slate-700"
            }`}
          />
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + badge */}
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="font-semibold text-white group-hover:text-green-400 transition-colors">
              {event.name}
            </span>
            <span
              className={`text-xs px-2 py-0.5 rounded-full font-medium ${PHASE_BADGE[event.phase]}`}
            >
              {PHASE_LABEL[event.phase]}
            </span>
          </div>
          {/* Progress */}
          <p className="text-sm text-slate-400">{progress}</p>
          {/* Players */}
          {playerLine && (
            <p className="text-xs text-slate-600 mt-0.5 truncate">{playerLine}</p>
          )}
        </div>

        {/* Date */}
        <span className="text-xs text-slate-600 shrink-0 pt-0.5">{createdDate}</span>
      </Link>

      {/* Delete row */}
      <div className="border-t border-slate-700/50 px-5 py-2 flex items-center justify-end gap-3">
        {isConfirming ? (
          <>
            <span className="text-xs text-slate-400">Delete this event?</span>
            <button
              onClick={() => onDelete(event.id)}
              className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
            >
              Yes, delete
            </button>
            <button
              onClick={onCancelDelete}
              className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            onClick={() => onDelete(event.id)}
            className="text-xs text-slate-700 hover:text-red-400 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
    </li>
  );
}
