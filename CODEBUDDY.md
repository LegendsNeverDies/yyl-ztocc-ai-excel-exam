# CODEBUDDY.md

This file provides guidance to CodeBuddy Code when working with code in this repository.

## Repository overview

This folder is **V3 — 运单全流程管理系统** (Waybill Approval V3), the second of two sibling projects in the monorepo (the first, V2 "万能导入", lives in `../2026060502/`). V3 manages the full waybill lifecycle: 录单 → 扫描品控 → 异常上报 → 分级审批 → 执行联动. It is deployed as an **independent** Vercel project and talks to V2 **only** over V2's external HTTP API (`/api/external/waybills/*`); it does **not** touch V2's database. Both reuse the same Neon Postgres instance with `v3_`-prefixed logical isolation.

## Commands

```bash
npm install
npm run dev          # Next.js dev server on port 3001
npm run build        # production build (also the Vercel build command)
npm run lint         # eslint flat config (eslint.config.mjs)

npx tsx scripts/create-tables.ts   # create the 10 v3_ tables + indexes (PREFERRED over db:push)
npm run db:seed                     # scripts/seed.ts → 200 tickets + config + QC rules + users
```

There is **no test runner** in this project. "Verification" is manual: run the dev server and exercise the UI. The seed/verify scripts are data generators, not tests.

To verify the end-to-end V2↔V3 link: start V2 (`npm run dev` in `../2026060502`, then `npx tsx scripts/seed-shipments.ts` to create `WB10001`–`WB10010`), then start V3 (`npm run dev`). V3's `/report` can validate `WB10001` against V2 live; `/sync` shows the call logs.

## Architecture

### The backend is Server Actions, not route handlers

`src/lib/server-actions.ts` (top of file: `"use server"`) is the **entire** API surface. There are no `app/api/*` route files in this project — pages call these exported `async` functions directly (RSC / Server Action invocation). Every action:

1. Calls `getCurrentUser()` (reads the `v3_current_user` cookie — the trusted source).
2. Checks a role permission (`canReport`/`canApproveLevel1`/`canApproveLevel2`/`canScan`/`canQuickRelease` from `src/lib/auth.ts`).
3. Performs the DB work.

Frontend hiding of buttons is **not** security — permission must always be re-checked server-side (the `/report` page hides approve buttons for operators, but `approveTicket` re-checks role + the "cannot approve own ticket" rule).

### Data access (Drizzle over Neon serverless HTTP)

`src/lib/db.ts` exports `db` (drizzle builder) and `sql` (neon tagged template). **Most queries use raw `sql\`...\`` template strings**; only `getTicketsPage` uses the drizzle builder. Notes:

- **Neon's `sql.unsafe()` does NOT work for DDL** — that's why `scripts/create-tables.ts` builds tables with `sql\`CREATE TABLE ...\`` templates, not `drizzle-kit push` (which also tends to hang interactively).
- **Neon HTTP is stateless — there are no multi-statement DB transactions.** The README's "事务保证一致性" is aspirational. Actual consistency comes from: (a) the `version` optimistic lock column, and (b) `executeActions()` doing sequential compensation writes after the status UPDATE. Do not assume `BEGIN/COMMIT` semantics.

### Two state machines — `src/lib/state-machine.ts`

- **Ticket machine**: `pending → level1_reviewing → [amount ≥ thresholdL2] level2_reviewing → executing → done`; `rejected → pending (≤ limit) / closed`; timeouts escalate `pending/level1 → level2`, `level2 → closed`.
- **Scan-batch machine** (independent of ticket state, linked via `ticket_id`): `scanned → qc_passed / qc_hold → released`.

`canTransition` enforces legal edges; `nextStatusOnApprove` branches on amount vs the configurable L2 threshold.

### Concurrency / idempotency / consistency (the core exam surface)

- **Optimistic lock**: every mutating action does `UPDATE v3_tickets ... WHERE id=? AND version=?` then `version+1`. Mismatch → "该工单已被他人处理，请刷新后重试".
- **Idempotency**: a client-generated `requestId` is passed in; `v3_approval_records.request_id` is checked first and the action is skipped if already present. This makes double-clicks safe.
- **Consistency**: when approval reaches `executing`, `executeActions()` (in `server-actions.ts`) generates compensation + inventory linkage + batch unlock, then the ticket is marked `done`. Compensation **direction** (`to_customer` for 物流 / `to_supplier` for 品控) and inventory action are driven by `EXCEPTION_ACTION_MAP` in `src/types/index.ts` — to add exception types, extend that map (and `EXCEPTION_META`), not the state machine.

### Cross-system client — `src/lib/v2-client.ts`

`callV2()` adds an `AbortController` timeout (config `v2_api_timeout_ms`, default 8000) + retries (`v2_api_retry`, default 2), generates a `requestId`, and **always** writes a `v3_sync_logs` row (shown on `/sync`). **Degradation rules — do not change lightly:**

- `createTicket` (异常上报) and `scanWaybill` (扫描录入): **must** validate against V2 in real time — throw on V2 failure, no fallback.
- `getTicketDetail` / `fetchWaybillByCode({ allowCache: true })`: **may** fall back to the local `v3_waybill_snapshots` copy when V2 is down.
- `flagWaybill` / `unflagWaybill` (异常标记回写): failure returns `false` and **does not block** the main flow.

`fetchWaybillByCode` upserts a snapshot whenever a real-time fetch succeeds.

### Auth / roles

Four roles (`operator`, `approver1`, `approver2`, `qc_manager`). The client `RoleProvider` + floating `RoleSwitcher` (bottom-right) write the `v3_current_user` cookie to simulate login; the server reads that same cookie as the trusted identity. Permission matrix lives in `src/lib/auth.ts`. Rule: the reporter (`reported_by_id`) can never approve their own ticket (enforced in `approveTicket`/`rejectTicket`).

### Config KV — `src/lib/config.ts` + `v3_config`

Thresholds and timeouts (`approval_threshold_l2`, `approval_timeout_minutes`, `qc_hold_timeout_minutes`, `resubmit_limit`, `v2_api_timeout_ms`, `v2_api_retry`) live in `v3_config`, **not** hardcoded. `getConfig`/`getConfigNumber` use a 60s in-memory TTL cache; `approval-engine.ts` reads thresholds from here. Changing a default default value means editing `CONFIG_DEFAULTS` in `src/types/index.ts`, not the engine.

### QC engine — `src/lib/qc-engine.ts`

`evaluateScan` iterates active `v3_qc_rules` ordered by severity; each rule has a `trigger_type` (`quantity_diff`/`damage_level`/`spec_deviation`/`label_error`/`batch_anomaly`) whose `trigger_condition` is a JSON blob of thresholds. First match → `fail` (records `ruleId` + `reason` into `v3_scan_records`). Rules are editable via `/config`.

### Timeout model (no cron)

Instead of a background job, `triggerTimeoutCheck()` runs **lazily on page entry** (called from `getTicketsPage`, `getDashboardStats`, `getMyApprovals`). It scans `due_at < now()` and escalates/closes. Default approval timeout 1440 min, QC-hold timeout 120 min.

## Pages (`src/app/`)

`/` tickets list · `/report` 异常上报 · `/scan` 扫描品控 · `/approval` 分级审批 · `/tickets/[id]` detail + audit log · `/config` 配置中心 · `/sync` 接口监控

## Data model (10 `v3_` tables, full definitions in `src/lib/db-schema.ts`)

`v3_users` · `v3_waybill_snapshots` (read-only copy from V2, fed by `fetchWaybillByCode`) · `v3_sync_logs` (Request-ID tracing) · `v3_tickets` (state machine + `version` lock + `due_at`) · `v3_approval_records` (`request_id` idempotency token) · `v3_compensations` (`direction` + `approval_record_id` traceability) · `v3_inventory` (batch dimension, `locked`/`locked_by_ticket_id`) · `v3_scan_records` (batch status independent, 1:N to ticket) · `v3_qc_rules` (configurable `trigger_condition` JSON) · `v3_config` (thresholds/timeout KV). Note: `amount` columns are stored as numeric **strings** — compare with `Number(...)`, and `due_at`/`version` drive all the concurrency logic above.

## Conventions

- Path alias `@/*` → `src/*`.
- Tailwind v4 (`@tailwindcss/postcss`), `lucide-react` icons, teal accent `#0fc6c2`. Shared primitives in `src/components/shared/`; `cn()` (clsx + tailwind-merge) in `src/lib/utils.ts`.
- **Next.js 16.2.6** (App Router, React 19) — this version has breaking changes vs. older Next.js. Per the monorepo root CODEBUDDY.md, read `node_modules/next/dist/docs/` before writing framework code, and heed deprecation notices.
- All UI copy and comments are Chinese — match that.

## Gotchas / non-obvious

- `npx tsx scripts/create-tables.ts` also `DROP TABLE IF EXISTS v3_test` / `v3_test2` — leftover temp tables from earlier iterations.
- `next.config.ts` raises the Server Action body limit to 10mb (`experimental.serverActions.bodySizeLimit`).
- The `.env.local` is required and not committed: `DATABASE_URL`, `V2_API_BASE_URL` (V2 address), `V2_API_KEY` (must equal V2's `EXTERNAL_API_KEY`), `CURRENT_ROLE` (default role when cookie missing).
- For deeper requirement interpretation, read `ASSUMPTIONS.md` (9 open items + clarifications). For the exact V2↔V3 request/response shapes, auth, timeouts/retries, and degradation, read `API_CONTRACT.md`.
