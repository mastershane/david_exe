/**
 * Resource route — no UI.
 *
 * PUT    /api/events/:id  → upsert event (body: EventState JSON)
 * DELETE /api/events/:id  → remove event
 */

import type { ActionFunctionArgs } from "react-router";
import { dbUpsertEvent, dbDeleteEvent } from "~/lib/db.server";
import type { EventState } from "~/lib/eventStore";

export async function action({ request, params }: ActionFunctionArgs) {
  const id = params.id!;

  if (request.method === "PUT" || request.method === "POST") {
    const state = (await request.json()) as EventState;
    if (state.id !== id) {
      return Response.json({ error: "ID mismatch" }, { status: 400 });
    }
    await dbUpsertEvent(state);
    return Response.json({ ok: true });
  }

  if (request.method === "DELETE") {
    await dbDeleteEvent(id);
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Method not allowed" }, { status: 405 });
}
