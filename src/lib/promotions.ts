import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";
import type { ClientStatus } from "./types";

export type PromotionKind = "PROMOTION" | "COIN_OF_WEEK";

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  kind: PromotionKind;
  active: boolean;
  createdAt: string;
}

interface PromotionRowDb {
  id: string;
  name: string;
  description: string | null;
  kind: PromotionKind;
  active: number;
  created_at: string;
}

function mapPromotion(row: PromotionRowDb): Promotion {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

/** Past + present campaigns of a given kind, newest first. */
export async function listPromotions(kind: PromotionKind = "PROMOTION"): Promise<Promotion[]> {
  await ready();
  const res = await db.execute({
    sql: "SELECT * FROM promotions WHERE kind = ? ORDER BY created_at DESC",
    args: [kind],
  });
  return (res.rows as unknown as PromotionRowDb[]).map(mapPromotion);
}

export async function getActivePromotion(kind: PromotionKind = "PROMOTION"): Promise<Promotion | undefined> {
  await ready();
  const res = await db.execute({
    sql: "SELECT * FROM promotions WHERE active = 1 AND kind = ? ORDER BY created_at DESC LIMIT 1",
    args: [kind],
  });
  const row = (res.rows[0] as unknown as PromotionRowDb) ?? undefined;
  return row ? mapPromotion(row) : undefined;
}

/** Every currently-active campaign across all kinds — used by the Dashboard call queue. */
export async function listActivePromotions(): Promise<Promotion[]> {
  await ready();
  const res = await db.execute(
    "SELECT * FROM promotions WHERE active = 1 ORDER BY kind, created_at DESC"
  );
  return (res.rows as unknown as PromotionRowDb[]).map(mapPromotion);
}

/** Starts a campaign, deactivating any other active one OF THE SAME KIND — one push per channel,
 * but a Promotion and a Coin of the Week can run at the same time. */
export async function createPromotion(
  name: string,
  description: string | null,
  kind: PromotionKind = "PROMOTION"
): Promise<Promotion> {
  await ready();
  const id = randomUUID();
  await db.batch(
    [
      { sql: "UPDATE promotions SET active = 0 WHERE active = 1 AND kind = ?", args: [kind] },
      {
        sql: "INSERT INTO promotions (id, name, description, kind, active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
        args: [id, name, description, kind, localDateTimeString()],
      },
    ],
    "write"
  );
  const res = await db.execute({ sql: "SELECT * FROM promotions WHERE id = ?", args: [id] });
  return mapPromotion(res.rows[0] as unknown as PromotionRowDb);
}

export async function endPromotion(id: string): Promise<void> {
  await ready();
  await db.execute({ sql: "UPDATE promotions SET active = 0 WHERE id = ?", args: [id] });
}

/** Brings a past campaign back as the active one for its kind (swapping out whatever is
 * currently active there). Its email/text touches and timestamp-based call progress were never
 * deleted, so everything picks up right where it left off. */
export async function reactivatePromotion(id: string): Promise<void> {
  await ready();
  await db.batch(
    [
      {
        sql: "UPDATE promotions SET active = 0 WHERE active = 1 AND kind = (SELECT kind FROM promotions WHERE id = ?)",
        args: [id],
      },
      { sql: "UPDATE promotions SET active = 1 WHERE id = ?", args: [id] },
    ],
    "write"
  );
}

/** Marks every current book client as emailed/texted for a promotion, in one shot (upsert —
 * safe to call again after a re-send, it just refreshes the timestamp). */
async function markAllTouched(promotionId: string, column: "emailed_at" | "texted_at"): Promise<number> {
  await ready();
  const clientsRes = await db.execute("SELECT id FROM book_clients");
  const clientIds = (clientsRes.rows as unknown as { id: string }[]).map((r) => r.id);
  const now = localDateTimeString();
  const statements = clientIds.map((clientId) => ({
    sql: `INSERT INTO promotion_touches (id, promotion_id, book_client_id, ${column})
          VALUES (?, ?, ?, ?)
          ON CONFLICT(promotion_id, book_client_id) DO UPDATE SET ${column} = excluded.${column}`,
    args: [randomUUID(), promotionId, clientId, now],
  }));
  if (statements.length > 0) {
    await db.batch(statements, "write");
  }
  return statements.length;
}

export async function markAllEmailed(promotionId: string): Promise<number> {
  return markAllTouched(promotionId, "emailed_at");
}

export async function markAllTexted(promotionId: string): Promise<number> {
  return markAllTouched(promotionId, "texted_at");
}

export interface PromotionProgress {
  totalClients: number;
  emailedCount: number;
  textedCount: number;
  calledCount: number;
}

// A client counts as "called about" a campaign once they have a call logged at or after the
// campaign started — so a single call automatically counts toward every campaign active at that
// moment (Promotion and Coin of the Week alike), with no per-call tagging.
export async function getPromotionProgress(promotionId: string): Promise<PromotionProgress> {
  await ready();
  const [totalRes, emailedRes, textedRes, calledRes] = await Promise.all([
    db.execute("SELECT COUNT(*) as cnt FROM book_clients"),
    db.execute({
      sql: "SELECT COUNT(*) as cnt FROM promotion_touches WHERE promotion_id = ? AND emailed_at IS NOT NULL",
      args: [promotionId],
    }),
    db.execute({
      sql: "SELECT COUNT(*) as cnt FROM promotion_touches WHERE promotion_id = ? AND texted_at IS NOT NULL",
      args: [promotionId],
    }),
    db.execute({
      sql: `SELECT COUNT(DISTINCT l.book_client_id) as cnt
            FROM book_call_log_entries l
            WHERE l.timestamp >= (SELECT created_at FROM promotions WHERE id = ?)`,
      args: [promotionId],
    }),
  ]);
  const count = (res: { rows: unknown[] }) => Number((res.rows[0] as { cnt: number | string }).cnt);
  return {
    totalClients: count(totalRes),
    emailedCount: count(emailedRes),
    textedCount: count(textedRes),
    calledCount: count(calledRes),
  };
}

export interface PromotionCallTarget {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  status: ClientStatus;
  lifetimeValue: number;
}

function mapCallTarget(r: {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  status: ClientStatus;
  lifetime_value: number;
}): PromotionCallTarget {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    status: r.status,
    lifetimeValue: r.lifetime_value,
  };
}

/** Book clients not yet called about this promotion, biggest lifetime value first. */
export async function listNotCalledAboutPromotion(promotionId: string): Promise<PromotionCallTarget[]> {
  await ready();
  const res = await db.execute({
    sql: `SELECT bc.id, bc.first_name, bc.last_name, bc.phone, bc.status, bc.lifetime_value
          FROM book_clients bc
          WHERE bc.status != 'NOT_INTERESTED'
            AND NOT EXISTS (
              SELECT 1 FROM book_call_log_entries l
              WHERE l.book_client_id = bc.id
                AND l.timestamp >= (SELECT created_at FROM promotions WHERE id = ?)
            )
          ORDER BY bc.lifetime_value DESC, bc.last_name, bc.first_name`,
    args: [promotionId],
  });
  return (res.rows as unknown as Parameters<typeof mapCallTarget>[0][]).map(mapCallTarget);
}

/** Book clients with no call logged since the given local timestamp, biggest value first — used
 * to fill the Dashboard queue with campaign targets not yet worked. */
export async function listClientsNotCalledSince(sinceIso: string): Promise<PromotionCallTarget[]> {
  await ready();
  const res = await db.execute({
    sql: `SELECT bc.id, bc.first_name, bc.last_name, bc.phone, bc.status, bc.lifetime_value
          FROM book_clients bc
          WHERE bc.status != 'NOT_INTERESTED'
            AND NOT EXISTS (
              SELECT 1 FROM book_call_log_entries l
              WHERE l.book_client_id = bc.id AND l.timestamp >= ?
            )
          ORDER BY bc.lifetime_value DESC, bc.last_name, bc.first_name`,
    args: [sinceIso],
  });
  return (res.rows as unknown as Parameters<typeof mapCallTarget>[0][]).map(mapCallTarget);
}
