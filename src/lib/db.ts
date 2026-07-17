import { createClient, type Client } from "@libsql/client";

declare global {
  var __prcDb: Client | undefined;
  var __prcDbReady: Promise<void> | undefined;
}

const url = process.env.TURSO_DATABASE_URL ?? "file:./data/app.db";
const authToken = process.env.TURSO_AUTH_TOKEN;

const db = global.__prcDb ?? createClient({ url, authToken });
if (process.env.NODE_ENV !== "production") {
  global.__prcDb = db;
}

const STATUS_CHECK = "('NO_DISPO','CALLBACK','NOT_AVAILABLE','NOT_INTERESTED','SOLD')";

async function ensureSchema(): Promise<void> {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS book_clients (
      id TEXT PRIMARY KEY,
      email TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'NO_DISPO' CHECK(status IN ${STATUS_CHECK}),
      notes TEXT,
      callback_scheduled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS book_call_log_entries (
      id TEXT PRIMARY KEY,
      book_client_id TEXT NOT NULL REFERENCES book_clients(id) ON DELETE CASCADE,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      note_text TEXT NOT NULL,
      resulting_status TEXT NOT NULL CHECK(resulting_status IN ${STATUS_CHECK})
    );

    CREATE INDEX IF NOT EXISTS idx_book_call_log_client ON book_call_log_entries(book_client_id);

    CREATE TABLE IF NOT EXISTS shipments (
      id TEXT PRIMARY KEY,
      book_client_id TEXT NOT NULL REFERENCES book_clients(id) ON DELETE CASCADE,
      carrier TEXT NOT NULL,
      tracking_number TEXT NOT NULL,
      notes TEXT,
      shipped_at TEXT NOT NULL DEFAULT (datetime('now')),
      shipped_call_done INTEGER NOT NULL DEFAULT 0,
      delivered_at TEXT,
      delivered_call_done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_shipments_book_client ON shipments(book_client_id);

    CREATE TABLE IF NOT EXISTS clients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      opener TEXT,
      first_sale_date TEXT NOT NULL,
      first_sale_amount REAL,
      status TEXT NOT NULL CHECK(status IN ${STATUS_CHECK}),
      notes TEXT,
      book_client_id TEXT REFERENCES book_clients(id) ON DELETE SET NULL,
      callback_scheduled_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS call_log_entries (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      note_text TEXT NOT NULL,
      resulting_status TEXT NOT NULL CHECK(resulting_status IN ${STATUS_CHECK})
    );

    CREATE INDEX IF NOT EXISTS idx_call_log_client ON call_log_entries(client_id);

    CREATE TABLE IF NOT EXISTS reminders (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      due_at TEXT,
      done INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // book_clients already existed before secondary_phone was added — CREATE TABLE IF NOT EXISTS
  // above is a no-op against that existing table, so the column needs an explicit ALTER.
  try {
    await db.execute("ALTER TABLE book_clients ADD COLUMN secondary_phone TEXT");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/duplicate column/i.test(message)) throw err;
  }
}

// Ensures the schema exists before any query runs, without re-running executeMultiple on every
// import (Next.js may re-evaluate this module across requests in dev).
export function ready(): Promise<void> {
  if (!global.__prcDbReady) {
    global.__prcDbReady = ensureSchema();
  }
  return global.__prcDbReady;
}

export default db;
