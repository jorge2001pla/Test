/**
 * Additive schema for the 30-day follow-up system. Nothing here alters or drops an existing
 * column; legacy tables only gain nullable columns. Timestamps are UTC ISO instants ("…Z");
 * business dates are Eastern YYYY-MM-DD strings. Pure SQL text — no db import (db.ts runs it).
 */
const NOW = "(strftime('%Y-%m-%dT%H:%M:%fZ','now'))";

export const FOLLOWUP_SCHEMA = `
  -- One canonical person across the 50% list (clients) and the book (book_clients).
  CREATE TABLE IF NOT EXISTS parties (
    id TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    primary_phone TEXT,
    email TEXT,
    timezone TEXT,                       -- IANA zone for the client's local time (null = unknown)
    timezone_source TEXT,                -- 'manual' | 'area_code'
    opening_date TEXT,                   -- ET date the original Morgan promo order entered the company system
    opening_date_source TEXT,            -- 'manual' | 'clients.first_sale_date' | 'backfill'
    first_call_deal INTEGER NOT NULL DEFAULT 0,
    latest_qualifying_sale_date TEXT,
    last_attempt_at TEXT,
    last_conversation_at TEXT,
    interests TEXT,
    last_pitch TEXT,
    last_objection TEXT,
    restrictions TEXT NOT NULL DEFAULT '{}',   -- JSON: noCalls,noTexts,noEmail,noPromoEmail,doNotContact
    ghost INTEGER NOT NULL DEFAULT 0,
    ghost_at TEXT,
    reactivation_state TEXT NOT NULL DEFAULT 'NONE',  -- NONE | ELIGIBLE | SELECTED | DISMISSED
    reactivation_at TEXT,
    pause_reason TEXT,                   -- documented reason an active client has no next action
    pause_until TEXT,
    merged_into TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE IF NOT EXISTS fu_orders (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id),
    sale_date TEXT NOT NULL,             -- ET business date
    amount REAL,
    profit REAL,
    qualifying INTEGER NOT NULL DEFAULT 1,
    kind TEXT NOT NULL DEFAULT 'SALE',   -- SALE | PROMO_OPENER | OPENER_ONLY (someone else's promo)
    first_call INTEGER NOT NULL DEFAULT 0,
    commission_kind TEXT,                -- FIRST_CALL | IN_WINDOW | AFTER_WINDOW | UNKNOWN
    commission_rate REAL,
    products TEXT,
    notes TEXT,
    source TEXT NOT NULL DEFAULT 'manual',  -- manual | backfill | shipment
    idem_key TEXT UNIQUE,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_fu_orders_party ON fu_orders(party_id, sale_date);

  CREATE TABLE IF NOT EXISTS fu_cycles (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id),
    order_id TEXT REFERENCES fu_orders(id),
    start_date TEXT NOT NULL,            -- sale date = day 1
    end_date TEXT NOT NULL,              -- day 30 = start + 29
    status TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE | CLOSED
    close_reason TEXT,                   -- NO_RESPONSE | CLOSED_MISSED_STEPS | RESTARTED | GHOST | CANCELLED
    closed_at TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_fu_cycles_party ON fu_cycles(party_id, status);
  -- At most ONE active cycle per person, enforced by the database.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_fu_cycles_active ON fu_cycles(party_id) WHERE status = 'ACTIVE';

  CREATE TABLE IF NOT EXISTS fu_tasks (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id),
    cycle_id TEXT REFERENCES fu_cycles(id),
    order_id TEXT REFERENCES fu_orders(id),
    shipment_id TEXT,
    category TEXT NOT NULL,              -- CALLBACK | DELIVERY | SHIPMENT | SERVICE | CADENCE | REACTIVATION | MANUAL
    type TEXT NOT NULL,                  -- CALL | TEXT | EMAIL | TASK
    channel TEXT,                        -- DIALER | CELL | TEXT | EMAIL | null
    purpose TEXT NOT NULL,
    due_date TEXT NOT NULL,              -- ET business date
    due_at TEXT,                         -- exact UTC instant (callbacks / timed tasks)
    cadence_day INTEGER,
    cadence_key TEXT,
    voicemail INTEGER NOT NULL DEFAULT 0,
    text_step INTEGER NOT NULL DEFAULT 0,
    different_period INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | COMPLETED | CANCELLED | SUPERSEDED
    status_reason TEXT,
    status_at TEXT,
    completed_contact_id TEXT,
    dedupe_key TEXT,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW},
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_fu_tasks_party ON fu_tasks(party_id, status);
  CREATE INDEX IF NOT EXISTS idx_fu_tasks_due ON fu_tasks(status, due_date);
  -- No duplicate PENDING task for the same obligation, whichever view created it.
  CREATE UNIQUE INDEX IF NOT EXISTS uq_fu_tasks_dedupe ON fu_tasks(dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status = 'PENDING';

  CREATE TABLE IF NOT EXISTS fu_task_events (
    id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES fu_tasks(id),
    at TEXT NOT NULL DEFAULT ${NOW},
    event TEXT NOT NULL,                 -- CREATED | COMPLETED | CANCELLED | SUPERSEDED | RESCHEDULED | MISSED | NOTE
    reason TEXT,
    detail TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_fu_task_events_task ON fu_task_events(task_id);

  CREATE TABLE IF NOT EXISTS fu_contacts (
    id TEXT PRIMARY KEY,
    party_id TEXT NOT NULL REFERENCES parties(id),
    occurred_at TEXT NOT NULL,           -- UTC instant of the contact
    channel TEXT NOT NULL,               -- DIALER_CALL | CELL_CALL | VOICEMAIL | TEXT | EMAIL
    direction TEXT NOT NULL DEFAULT 'OUT',
    outcome TEXT NOT NULL,               -- see outcomes.ts
    attempted INTEGER NOT NULL DEFAULT 1,
    reached INTEGER NOT NULL DEFAULT 0,  -- a real conversation happened
    voicemail_left INTEGER NOT NULL DEFAULT 0,
    purpose TEXT,
    task_id TEXT,
    cycle_id TEXT,
    shipment_id TEXT,
    pitch TEXT,
    objection_category TEXT,
    objection_note TEXT,
    next_action TEXT,
    notes TEXT,
    receipt_confirmed INTEGER NOT NULL DEFAULT 0,
    idem_key TEXT UNIQUE,
    legacy_ref TEXT,
    created_at TEXT NOT NULL DEFAULT ${NOW}
  );
  CREATE INDEX IF NOT EXISTS idx_fu_contacts_party ON fu_contacts(party_id, occurred_at);

  CREATE TABLE IF NOT EXISTS fu_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ${NOW}
  );

  CREATE TABLE IF NOT EXISTS fu_merge_log (
    id TEXT PRIMARY KEY,
    kept_party_id TEXT NOT NULL,
    merged_party_id TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT ${NOW},
    snapshot TEXT,
    conflicts TEXT
  );

  CREATE TABLE IF NOT EXISTS fu_duplicate_dismissals (
    party_a TEXT NOT NULL,
    party_b TEXT NOT NULL,
    at TEXT NOT NULL DEFAULT ${NOW},
    PRIMARY KEY (party_a, party_b)
  );

  CREATE TABLE IF NOT EXISTS fu_backfill_runs (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL DEFAULT ${NOW},
    summary TEXT NOT NULL
  );
`;

/** [table, column, definition] — nullable/defaulted additions to existing tables. */
export const FOLLOWUP_COLUMNS: [string, string, string][] = [
  ["reminders", "due_time", "TEXT"],          // optional HH:MM Eastern for a timed reminder
  ["notes", "remind_date", "TEXT"],            // optional note reminder (ET date + time)
  ["notes", "remind_time", "TEXT"],
  ["notes", "remind_done", "INTEGER NOT NULL DEFAULT 0"],
  ["clients", "party_id", "TEXT"],
  ["book_clients", "party_id", "TEXT"],
  ["shipments", "party_id", "TEXT"],
  ["shipments", "order_id", "TEXT"],
  ["shipments", "expected_delivery", "TEXT"],
  ["shipments", "delivered_date", "TEXT"],        // ET business date, set when delivery is recorded
  ["shipments", "receipt_confirmed_at", "TEXT"],  // UTC instant — client actually confirmed receipt
  ["shipments", "satisfaction", "TEXT"],
  ["shipments", "exception", "TEXT"],             // open shipment exception / service issue text
  ["shipments", "exception_at", "TEXT"],
  ["shipments", "exception_resolved_at", "TEXT"],
];

export const FOLLOWUP_INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_clients_party ON clients(party_id);
  CREATE INDEX IF NOT EXISTS idx_book_clients_party ON book_clients(party_id);
  CREATE INDEX IF NOT EXISTS idx_shipments_party ON shipments(party_id);
`;
