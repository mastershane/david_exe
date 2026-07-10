/**
 * Resource route — no UI.
 *
 * GET /api/registry  → returns all registered players as JSON
 * PUT /api/registry  → replaces registry (body: RegisteredPlayer[] JSON)
 */

import type { ActionFunctionArgs } from "react-router";
import { dbGetRegistry, dbUpsertRegistry } from "~/lib/db.server";
import type { RegisteredPlayer } from "~/lib/playerRegistry";

export async function loader() {
  const players = await dbGetRegistry();
  return Response.json(players);
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "PUT") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const players = (await request.json()) as RegisteredPlayer[];
  await dbUpsertRegistry(players);
  return Response.json({ ok: true });
}
