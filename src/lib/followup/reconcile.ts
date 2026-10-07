/**
 * Reconcile: idempotent housekeeping run on every queue load and after mutations. It never
 * invents contact history and never creates catch-up calls:
 *  1. legacy callbacks → tasks
 *  2. overdue cadence steps collapse to the latest (older ones recorded as MISSED, history kept)
 *  3. same-day duplicate cadence steps collapse to one
 *  4. ended cycles close ("No response" / "Closed with missed steps" / "Completed")
 *  5. GHOST / do-not-contact people have outbound tasks cancelled
 */
import { cycleHasEnded } from "./commission";
import { etDate } from "./dates";
import { afterChange } from "./tasks";
import { closeTask, ensurePartyForBook, ensurePartyForClient, iso, logTaskEvent, q, run, type Stmt, type TaskRow } from "./store";

interface CycleRow {
  id: string;
  party_id: string;
  start_date: string;
  end_date: string;
}

export async function reconcile(now: Date = new Date()): Promise<{ changes: number }> {
  const today = etDate(now);
  const stmts: Stmt[] = [];
  const touched = new Set<string>();

  // 0a. A legacy callback on a record with no canonical id yet → give it one first.
  for (const { id } of await q<{ id: string }>("SELECT id FROM clients WHERE party_id IS NULL AND status = 'CALLBACK' AND callback_scheduled_at IS NOT NULL")) {
    await ensurePartyForClient(id);
  }
  for (const { id } of await q<{ id: string }>("SELECT id FROM book_clients WHERE party_id IS NULL AND status = 'CALLBACK' AND callback_scheduled_at IS NOT NULL")) {
    await ensurePartyForBook(id);
  }

  // 0. Legacy callbacks only exist for parties that already have a canonical id; ingest them.
  const legacy = await q<{ party_id: string }>(
    `SELECT DISTINCT party_id FROM (
       SELECT party_id FROM clients WHERE party_id IS NOT NULL AND status = 'CALLBACK' AND callback_scheduled_at IS NOT NULL
       UNION ALL
       SELECT party_id FROM book_clients WHERE party_id IS NOT NULL AND status = 'CALLBACK' AND callback_scheduled_at IS NOT NULL)`
  );
  for (const { party_id } of legacy) touched.add(party_id);

  // 1 + 2. Cadence roll-up per active cycle.
  const pend = await q<TaskRow>(
    `SELECT t.* FROM fu_tasks t JOIN fu_cycles c ON c.id = t.cycle_id AND c.status = 'ACTIVE'
     WHERE t.category = 'CADENCE' AND t.status = 'PENDING' ORDER BY t.party_id, t.due_date, t.cadence_day`
  );
  const byParty = new Map<string, TaskRow[]>();
  for (const t of pend) byParty.set(t.party_id, [...(byParty.get(t.party_id) ?? []), t]);
  for (const [partyId, list] of byParty) {
    const keep = new Set<string>();
    const due = list.filter((t) => t.due_date <= today);
    if (due.length) keep.add(due[due.length - 1].id); // only the latest due step stays actionable
    const seenDates = new Set<string>(due.length ? [due[due.length - 1].due_date] : []);
    for (const t of list.filter((x) => x.due_date > today)) {
      if (seenDates.has(t.due_date)) continue; // never two cadence calls on one day
      seenDates.add(t.due_date);
      keep.add(t.id);
    }
    for (const t of list) {
      if (keep.has(t.id)) continue;
      const missed = t.due_date <= today;
      if (missed) stmts.push(logTaskEvent(t.id, "MISSED", "Step was due and not done", now));
      stmts.push(...closeTask(t.id, "SUPERSEDED",
        missed ? "Missed — rolled into the latest due step (no catch-up call)" : "Same-day duplicate step collapsed", now));
      touched.add(partyId);
    }
  }

  // 3. Close ended cycles.
  const ended = (await q<CycleRow>("SELECT id, party_id, start_date, end_date FROM fu_cycles WHERE status = 'ACTIVE'"))
    .filter((c) => cycleHasEnded(c.start_date, today));
  for (const c of ended) {
    const missedEvents = Number((await q<{ n: number }>(
      `SELECT COUNT(*) AS n FROM fu_task_events e JOIN fu_tasks t ON t.id = e.task_id
       WHERE t.cycle_id = ? AND e.event = 'MISSED'`, [c.id]))[0]?.n ?? 0);
    const reached = Number((await q<{ n: number }>(
      "SELECT COUNT(*) AS n FROM fu_contacts WHERE party_id = ? AND reached = 1 AND occurred_at >= ?",
      [c.party_id, `${c.start_date}T00:00:00Z`]))[0]?.n ?? 0);

    const leftover = await q<TaskRow>("SELECT * FROM fu_tasks WHERE cycle_id = ? AND category = 'CADENCE' AND status = 'PENDING'", [c.id]);
    for (const t of leftover) stmts.push(...closeTask(t.id, "CANCELLED", "30-day cycle ended", now));
    const missed = leftover.length > 0 || missedEvents > 0;
    const reason = missed ? "CLOSED_MISSED_STEPS" : reached ? "COMPLETED" : "NO_RESPONSE";
    stmts.push({ sql: "UPDATE fu_cycles SET status = 'CLOSED', close_reason = ?, closed_at = ? WHERE id = ? AND status = 'ACTIVE'",
      args: [reason, iso(now), c.id] });
    // Unresponsive (or finished) and not suppressed → eligible for the reactivation pool. Only
    // flagged, never auto-enrolled: Jorge reviews and selects who to work.
    stmts.push({
      sql: `UPDATE parties SET reactivation_state = 'ELIGIBLE', reactivation_at = ?
            WHERE id = ? AND reactivation_state = 'NONE' AND ghost = 0
              AND COALESCE(json_extract(restrictions,'$.doNotContact'),0) = 0`,
      args: [iso(now), c.party_id],
    });
    touched.add(c.party_id);
  }

  // 4. Suppressed people never keep outbound tasks (service issues survive).
  const supp = await q<TaskRow>(
    `SELECT t.* FROM fu_tasks t JOIN parties p ON p.id = t.party_id
     WHERE t.status = 'PENDING' AND t.category NOT IN ('SERVICE')
       AND NOT (t.category = 'SHIPMENT' AND t.type = 'TASK')
       AND (p.ghost = 1 OR COALESCE(json_extract(p.restrictions,'$.doNotContact'),0) = 1)`
  );
  for (const t of supp) {
    stmts.push(...closeTask(t.id, "CANCELLED", "Outreach suppressed (GHOST / do-not-contact)", now));
    touched.add(t.party_id);
  }

  await run(stmts);
  for (const id of touched) await afterChange(id, now);
  return { changes: stmts.length };
}
