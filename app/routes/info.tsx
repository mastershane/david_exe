import { Link } from "react-router";

export function meta() {
  return [{ title: "david.exe — How It Works" }];
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-slate-800 rounded-2xl p-6 space-y-4">
      <h2 className="text-lg font-bold text-green-400 uppercase tracking-wider">{title}</h2>
      {children}
    </section>
  );
}

function Rule({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="font-semibold text-white">{label}</div>
      <div className="text-slate-400 text-sm leading-relaxed">{children}</div>
    </div>
  );
}

function Divider() {
  return <hr className="border-slate-700" />;
}

export default function Info() {
  return (
    <div className="min-h-screen text-white p-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-mono font-bold text-green-400">david.exe</h1>
            <p className="text-slate-400 text-sm">How It Works</p>
          </div>
          <Link
            to="/"
            className="px-4 py-2 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
          >
            ← Event
          </Link>
        </div>

        {/* ── Pairings ──────────────────────────────────────────────────── */}
        <Section title="Pairings">
          <Rule label="Swiss system">
            Every round, players are paired against opponents with a similar record.
            Unlike single-elimination, every player continues playing every round regardless
            of wins or losses.
          </Rule>

          <Divider />

          <Rule label="Optimal matching">
            Each round, the app finds the pairing arrangement with the smallest total
            point-difference across all matches. It does this by enumerating every possible
            way to pair the field and scoring each arrangement — not just the greedy
            top-vs-second approach. For up to 12 players this takes milliseconds.
          </Rule>

          <Divider />

          <Rule label="Rematch avoidance">
            Rematches are heavily penalised. If two players have already been paired in any
            previous round of the <em>entire event</em> (across all drafts), the engine
            will only rematch them as an absolute last resort.
          </Rule>

          <Divider />

          <Rule label="Byes">
            When there is an odd number of players, one player receives a bye. Byes are
            assigned to the lowest-ranked player who has not yet received one. A bye counts
            as a match win (3 points) for tiebreaker purposes.
          </Rule>

          <Divider />

          <Rule label="Cross-draft memory">
            Standings and rematch history are cumulative across every draft in the event.
            The Swiss pairing engine always sees the full event record, so tiebreakers and
            rematch avoidance work correctly even when moving from Draft 1 to Draft 2, etc.
          </Rule>
        </Section>

        {/* ── Ranking ───────────────────────────────────────────────────── */}
        <Section title="Ranking &amp; Tiebreakers">
          <p className="text-slate-400 text-sm leading-relaxed">
            Rankings follow the official WotC Competitive Rules tiebreaker order.
            Each criterion is only consulted when the previous one is tied.
          </p>

          {/* Step-by-step */}
          <ol className="space-y-4 mt-2">
            {[
              {
                step: "1",
                label: "Match Points",
                detail:
                  "Win = 3 pts · Draw = 1 pt · Loss = 0 pts · Bye = 3 pts. This is always the primary ranking criterion.",
              },
              {
                step: "2",
                label: "Opponent Match-Win % (OMW%)",
                detail:
                  "The average match-win percentage of every opponent you have faced. Beating stronger opponents is worth more. Each opponent's win rate is floored at 33⅓% so that a run of early-round byes doesn't unfairly punish you.",
              },
              {
                step: "3",
                label: "Game Win % (GW%)",
                detail:
                  "Your personal game win percentage across all games played, also floored at 33⅓%. Winning 2–0 is rewarded over winning 2–1.",
              },
              {
                step: "4",
                label: "Opponent Game-Win % (OGW%)",
                detail:
                  "The average game-win percentage of every opponent you have faced, floored at 33⅓%. A final catch-all for mirror-image records.",
              },
              {
                step: "5",
                label: "Alphabetical",
                detail:
                  "If all four tiebreakers are identical the players are ordered alphabetically. This is extremely rare.",
              },
            ].map(({ step, label, detail }) => (
              <li key={step} className="flex gap-4">
                <div className="shrink-0 w-7 h-7 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-green-400">
                  {step}
                </div>
                <div className="space-y-1 pt-0.5">
                  <div className="font-semibold text-white">{label}</div>
                  <div className="text-slate-400 text-sm leading-relaxed">{detail}</div>
                </div>
              </li>
            ))}
          </ol>

          <Divider />

          <Rule label="The 33⅓% floor">
            WotC rules require that no opponent contributes a win rate below 33⅓% when
            calculating OMW% and OGW%. This prevents players from being penalised for
            receiving byes or for facing opponents who had an unusually bad event.
          </Rule>
        </Section>

        {/* ── Matches ───────────────────────────────────────────────────── */}
        <Section title="Match Format">
          <Rule label="Best of 3">
            Each match is played as best-of-three games. The first player to win 2 games
            wins the match. Drawn games count as draws (neither player's win total increases
            for that game).
          </Rule>

          <Divider />

          <Rule label="Time-outs">
            If time is called before a match finishes, click <span className="text-orange-400 font-medium">Call Time</span>.
            The current game is evaluated immediately:{" "}
            <ul className="list-disc list-inside mt-1 space-y-0.5">
              <li>If one player leads in the current game, they win that game.</li>
              <li>If the game is tied, it ends as a draw.</li>
            </ul>
            The match result is then determined from the completed game record. A match
            that ends 1–0 (one game decided, one drawn) is recorded as a win for the
            player who won the game.
          </Rule>
        </Section>

      </div>
    </div>
  );
}
