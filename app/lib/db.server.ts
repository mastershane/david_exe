/**
 * Server-only DB module (.server.ts keeps this out of the client bundle).
 *
 * Supports two modes controlled by environment variables:
 *   Local dev  → TURSO_DATABASE_URL=file:./local.db  (no auth token needed)
 *   Production → TURSO_DATABASE_URL=libsql://<name>.turso.io
 *                TURSO_AUTH_TOKEN=<token>
 *
 * If TURSO_DATABASE_URL is not set the module still exports safe no-op
 * functions so the app works without a DB (localStorage-only mode).
 */

import { createClient } from "@libsql/client";
import type { Client } from "@libsql/client";
import type { EventState } from "./eventStore";
import type { RegisteredPlayer } from "./playerRegistry";

// ── Lazy singleton client ─────────────────────────────────────────────────────

let _client: Client | null = null;

function getDB(): Client | null {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) return null; // DB not configured → localStorage-only mode
  if (!_client) {
    _client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  }
  return _client;
}

// ── Schema init ───────────────────────────────────────────────────────────────

let _initialized = false;

async function ensureInit(db: Client): Promise<void> {
  if (_initialized) return;
  await db.execute(`
    CREATE TABLE IF NOT EXISTS events (
      id         TEXT PRIMARY KEY,
      state      TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS registry (
      id         INTEGER PRIMARY KEY CHECK (id = 1),
      data       TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
  _initialized = true;
}

// ── Event operations ──────────────────────────────────────────────────────────

export async function dbGetAllEvents(): Promise<EventState[]> {
  const db = getDB();
  if (!db) return [];
  await ensureInit(db);
  const result = await db.execute(
    "SELECT state FROM events ORDER BY created_at DESC"
  );
  return result.rows.map((r) => JSON.parse(r.state as string) as EventState);
}

export async function dbGetEvent(id: string): Promise<EventState | null> {
  const db = getDB();
  if (!db) return null;
  await ensureInit(db);
  const result = await db.execute({
    sql: "SELECT state FROM events WHERE id = ?",
    args: [id],
  });
  if (result.rows.length === 0) return null;
  return JSON.parse(result.rows[0].state as string) as EventState;
}

export async function dbUpsertEvent(state: EventState): Promise<void> {
  const db = getDB();
  if (!db) return;
  await ensureInit(db);
  const now = new Date().toISOString();
  await db.execute({
    sql: `
      INSERT INTO events (id, state, created_at, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        state      = excluded.state,
        updated_at = excluded.updated_at
    `,
    args: [state.id, JSON.stringify(state), state.createdAt, now],
  });
}

export async function dbDeleteEvent(id: string): Promise<void> {
  const db = getDB();
  if (!db) return;
  await ensureInit(db);
  await db.execute({ sql: "DELETE FROM events WHERE id = ?", args: [id] });
}

// ── Player registry operations ────────────────────────────────────────────────

export async function dbGetRegistry(): Promise<RegisteredPlayer[]> {
  const db = getDB();
  if (!db) return [];
  await ensureInit(db);
  const result = await db.execute(
    "SELECT data FROM registry WHERE id = 1"
  );
  if (result.rows.length === 0) return [];
  return JSON.parse(result.rows[0].data as string) as RegisteredPlayer[];
}

export async function dbUpsertRegistry(players: RegisteredPlayer[]): Promise<void> {
  const db = getDB();
  if (!db) return;
  await ensureInit(db);
  const now = new Date().toISOString();
  await db.execute({
    sql: `
      INSERT INTO registry (id, data, updated_at) VALUES (1, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        data       = excluded.data,
        updated_at = excluded.updated_at
    `,
    args: [JSON.stringify(players), now],
  });
}

/** True if a DB URL is configured (used by health checks / UI indicators). */
export function isDBConfigured(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL);
}
