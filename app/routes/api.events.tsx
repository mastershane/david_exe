/**
 * Resource route — no UI.
 *
 * GET  /api/events   → returns all events as JSON
 * POST /api/events   → upserts a single event (body: EventState JSON)
 */

import type { ActionFunctionArgs } from "react-router";
import { dbGetAllEvents, dbUpsertEvent } from "~/lib/db.server";
import type { EventState } from "~/lib/eventStore";

export async function loader() {
  const events = await dbGetAllEvents();
  return Response.json(events);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const state = (await request.json()) as EventState;
  await dbUpsertEvent(state);
  return Response.json({ ok: true });
}
