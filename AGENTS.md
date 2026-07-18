<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# What this app is

The Premier Rare Coins **command center** — a CRM Jorge Pla (coin salesman, works it daily from two computers) uses to run his book of clients. It replaced an Excel system. Jorge uses the **live app in a browser**; he does not run code himself.

- **Live URL: https://prc-app-one.vercel.app** — Vercel project `jpprc/prc-app`, GitHub `jorge2001pla/Test`, branch `main`.
- **Deploy**: commit, `git push origin main`, then `npx vercel --prod --yes` (GitHub auto-deploy has been unreliable — always deploy via CLI and verify on the live URL).
- **Stack**: Next.js App Router, Tailwind v4 (CSS-first config in `globals.css`), Turso (libSQL) via `@libsql/client`. **This is production data — one shared live DB, no staging.** Credentials live in gitignored `.env.local` (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`).
- **Dev server**: `npm run dev` on port 3000 (`.claude/launch.json` name: "dev").

# Architecture conventions

- **Schema migrations** run in `src/lib/db.ts` `ensureSchema()` — idempotent `CREATE TABLE IF NOT EXISTS` plus `addColumnIfMissing` ALTERs. The ready() promise is cached on `global` — **restart the dev server after schema changes**.
- Data access lives in `src/lib/*.ts` (async, `await ready()` first). Server Actions in `src/app/actions.ts`. Pages are Server Components (`force-dynamic`); interactive bits are small client components in `src/components/`.
- **Timestamps are naive local strings** (`localDateTimeString()` in `business-logic.ts`), consistent because everything runs on Vercel. **Never create prod data from a local dev session** — local wall-clock vs Vercel time skews campaign/call ordering.
- One-off DB scripts: write a `.mjs` in the project root (for node_modules resolution), parse `.env.local` manually (dotenv isn't installed), run with `node`, **delete it after**, and clean up any test rows you wrote to prod.
- Brand: black/gold/white, design tokens in `globals.css`, dark mode via `.dark` class. Phone numbers are **plain text, never tel: links** (Jorge dials through an internet dialer).

# Business rules (Jorge-defined — don't change without asking)

- **Two client populations**: `clients` = new 15-day/50%-commission window prospects ("50% Follow-Up" tab); `book_clients` = his actual client book. Conversions link via `book_client_id`.
- **Weekly goal**: 10 new book clients/week, week runs **Thursday–Wednesday**, pace counts Mon–Fri only. Only `source='manual'` book clients count (bulk-imported legacy rows have `source='import'` and are excluded from the goal and the never-called nudge).
- **Value tiers**: $10k+ Snapper, $25k+ Wahoo, $50k+ Whale. Goal: 100 Whales = $5M book (Whale Tracker). `lifetime_value` grows via shipment `sale_amount`.
- **Today's Priority = exactly 10 rows**, strict tier order: 50% expiring soon (≤5 days left, uncalled) → callbacks today → shipments needing shipped/delivered call → campaign targets → backlog fill (dormant-after-contact first, then never-contacted, biggest value first).
- **Overdue** = missed callbacks + due reminders only. Expired 15-day windows drop off silently by design.
- **Campaigns** (track-only; Klaviyo does the sending, email-only plan): two kinds, each its own nav tab — `PROMOTION` and `COIN_OF_WEEK`. One active per kind, both can run concurrently. Call attribution is timestamp-based (any call at/after campaign `created_at` counts), so one call clears a client from every active campaign. `NOT_INTERESTED` clients are excluded from campaign lists.
- **CSV export** (Settings → Export Book) emits Klaviyo-ready E.164 phones (`+1XXXXXXXXXX`).
- Dormant threshold: 30 days since last call. Never-called nudge window: 5 days from manual add.

# Working with Jorge

Direct and practical. Prefers a short brainstorm/confirm before big builds, then "do it all." Dashboard must require near-zero thinking each morning. Utility features go in the Settings gear menu, not new nav tabs. Always verify changes in the browser and deploy when done — Jorge uses the live URL, not localhost.
