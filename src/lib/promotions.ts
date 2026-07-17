import { randomUUID } from "node:crypto";
import db, { ready } from "./db";
import { localDateTimeString } from "./business-logic";
import type { ClientStatus } from "./types";

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  createdAt: string;
}

interface PromotionRowDb {
  id: string;
  name: string;
  description: string | null;
  active: number;
  created_at: string;
}

function mapPromotion(row: PromotionRowDb): Promotion {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    active: !!row.active,
    createdAt: row.created_at,
  };
}

export async function listPromotions(): Promise<Promotion[]> {
  await ready();
  const res = await db.execute("SELECT * FROM promotions ORDER BY created_at DESC");
  return (res.rows as unknown as PromotionRowDb[]).map(mapPromotion);
}

export async function getActivePromotion(): Promise<Promotion | undefined> {
  await ready();
  const res = await db.execute("SELECT * FROM promotions WHERE active = 1 ORDER BY created_at DESC LIMIT 1");
  const row = (res.rows[0] as unknown as PromotionRowDb) ?? undefined;
  return row ? mapPromotion(row) : undefined;
}

/** Starts a new promotion and deactivates any other active one — only one push at a time. */
export async function createPromotion(name: string, description: string | null): Promise<Promotion> {
  await ready();
  const id = randomUUID();
  await db.batch(
    [
      { sql: "UPDATE promotions SET active = 0 WHERE active = 1", args: [] },
      {
        sql: "INSERT INTO promotions (id, name, description, active, created_at) VALUES (?, ?, ?, 1, ?)",
        args: [id, name, description, localDateTimeString()],
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
      sql: "SELECT COUNT(DISTINCT book_client_id) as cnt FROM book_call_log_entries WHERE promotion_id = ?",
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

/** Book clients not yet called about this promotion, biggest lifetime value first. */
export async function listNotCalledAboutPromotion(promotionId: string): Promise<PromotionCallTarget[]> {
  await ready();
  const res = await db.execute({
    sql: `SELECT bc.id, bc.first_name, bc.last_name, bc.phone, bc.status, bc.lifetime_value
          FROM book_clients bc
          WHERE bc.status != 'NOT_INTERESTED'
            AND NOT EXISTS (
              SELECT 1 FROM book_call_log_entries l
              WHERE l.book_client_id = bc.id AND l.promotion_id = ?
            )
          ORDER BY bc.lifetime_value DESC, bc.last_name, bc.first_name`,
    args: [promotionId],
  });
  const rows = res.rows as unknown as {
    id: string;
    first_name: string | null;
    last_name: string | null;
    phone: string | null;
    status: ClientStatus;
    lifetime_value: number;
  }[];
  return rows.map((r) => ({
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    phone: r.phone,
    status: r.status,
    lifetimeValue: r.lifetime_value,
  }));
}
