# Native tables in Files

Tables are live workspace resources at `/drive/tables/:id`, accessible from the Tables filter in Files. Blank creation and CSV import are supported; there are no templates or new top-level navigation entries. Project association is optional. Table links in chat and task descriptions keep the same resource ID during enrichment and follow-ups.

## Storage and migration

Core owns PostgreSQL access. The additive migrations `20260917220724_native_tables` and `20260917223758_table_history_order_and_task_scope` introduce fixed Prisma models for tables, columns, JSONB rows, views, history, idempotent operations and selected-task scope. They never create physical tables per user resource. Run `pnpm prisma:migrate:deploy`, `pnpm prisma:generate`, and build the workspace packages. An application rollback can leave these tables intact; do not drop them to roll back application code.

## API and agent access

The authenticated Core API is rooted at `/v1/drive/tables`. Workspace middleware, current membership and coworker user-context binding apply. Callers cannot supply actor IDs. Generated OpenAPI documents coworker context headers and `X-Table-Task-Id`; direct coworker and Soko Bot API credentials must supply an active assigned task for discovery, schema/row reads and mutations. Only the authenticated in-process owner-chat turn grants task-free bot authority; request JSON cannot claim that provenance. Selected-task discovery returns only its bound table. Terminal vendor-grant denial still overrides assignment.

- `POST /`: create with `key`, title, descriptions, typed columns and optional initial rows.
- `GET /`, `GET /:id`: discover accessible tables and inspect schema.
- `POST /:id/query`: server filters, typed sorting, selected row IDs, archive state and cursor pagination.
- `PATCH /:id`: optimistic metadata/schema/archive update. Supply current table `version`; retain stable column IDs and the full column list.
- `POST /:id/rows`: atomic insert/patch batch. Patches carry row `id` and `version`. Values and evidence are keyed by stable column UUID.
- `POST /:id/views`: human-owned saved filter/sort/visible-column definitions with optimistic versions.
- `GET /:id/history`, `POST /:id/undo`: human history/source inspection and conflict-safe row-batch undo.
- `POST /:id/enrich`: create an ordinary READY task assigned to an available coworker or the user's Soko Bot, persisting exact row and output-column IDs in the same transaction.

Soko Bot exposes `list_tables`, `read_table`, `create_table`, `write_table_rows`, and `update_table_columns` through its existing capability dispatch and runtime tool registry. Teammate/bot-to-bot audiences do not receive these private workspace capabilities. All task-driven tools, including discovery and reads, require an assigned `taskId`; selected-row tasks cannot insert rows, modify schema, or write outside their persisted selection. A bot with active selected-row work cannot bypass that selection by omitting the task ID on the same table.

On chat creation, Core publishes a Markdown link through the existing chat-message path immediately after creating the table, before subsequent tool calls enrich it. Task-driven creation publishes the same live resource through the existing task-comment and event fanout path. Both publication paths use a stable UUID derived from the durable table ID, destination kind/ID and bot identity. Their existing PostgreSQL transactions insert under that primary key with conflict handling, so distinct tool receipts, turns or processes cannot create duplicate references. Retries recheck current publication authority. Task event/delegation writes remain atomic. Realtime retries refer to the same stored message/event; external notification delivery remains best-effort and is not an exactly-once guarantee. The tool result also contains the table and URL. Task creation includes the live link and exact selected IDs in the existing task description. Follow-ups discover/read the same table and add rows or columns using stable IDs. Column names/descriptions help agents choose a schema. Cell/source contents are untrusted data; tools do not authorize outreach or sending. Unknown values are `null`, distinct from confirmed `false` or zero.

## Publication delivery boundary and preview adoption

The stored table and chat message/task event are durable and deduplicated. A table-publication retry rechecks current authority, republishes the stored message realtime event, and schedules cache invalidation and direct-message notifications again. This recovers interruption after the message commit but before effects were scheduled. It does not replay mention dispatch or change ordinary non-table tool retry policy.

Soko Bot's effects use direct-message notifications, not counted room notifications. Their existing PostgreSQL unique key (recipient, kind, room, message, message key) and `createNotification` conflict handling prevent duplicate notification rows and repeated banner publication, including after a notification is read. Cache invalidation is safe to repeat. The counted-room notification helper has weaker deduplication; it is not used for this recovery.

External delivery remains best-effort: termination after a notification row commits but before its external publish can leave that notification stored without a banner/realtime notification. Replays preserve the existing row and do not resend its banner. There is no durable effects-completion marker or background repair if no tool retry occurs. Ordinary Ably failures are caught by the realtime helpers; injected boundary exceptions model interrupted execution, not a live provider outage. Reliable eventual external delivery would require durable delivery tracking and an explicit external-delivery policy in the shared notification subsystem, outside this change; exactly-once external delivery is not promised. This residual R4 limitation is for coordinator disposition.

Deterministic publication IDs are a clean introduction for this unmerged feature, based on its authorized delivery history: no earlier deployment or requirement to preserve a persistent preview was identified. This is not a production-data survey. If a preview containing pre-fix random-ID publications must be retained, an explicit adoption/migration step must establish their verified durable-operation/destination identity before replay. No content-match fallback or automatic deletion is provided. Existing preview data and review artifacts remain untouched.

## Reliability and limits

Every create, metadata update, row batch, saved view, task assignment and undo uses a caller-generated retry `key`. Reuse the exact payload and key after a lost acknowledgement. Changed payloads or task/owner-chat authority with a used key return 409. Runtime table-tool replays reauthorize and rehydrate mutations through this durable operation store instead of returning the bounded receipt preview; replayed reads refresh the live resource. Failed receipts for create/write/schema table mutations can be claimed for exact-input, reauthorized recovery after domain commit or link-publication failures. Other failed capabilities remain non-replayable; active receipt leases cannot be stolen. The existing redacted 16 KB runtime receipt limit remains intact. PostgreSQL serializable transactions commit data, audit and retry result together; no batch is partially committed. Previously completed batches survive an interrupted import/enrichment. Task status and failure reporting use the existing task lifecycle.

The UI retains unresolved mutation keys, payloads and the original action for an explicit Retry, even when polling removes rows or changes row/table versions. Resolve that attempt before starting another workspace action. Column dialogs freeze ambiguous requests until retried; definitive Core rejections release them for correction. Cell drafts pin edited rows when polling moves them outside the current result, and deliberate view/link navigation warns before discarding edits. Escape allows another edit without refocusing. Typed filter text is validated on blur/save, allowing intermediate input. Enrichment validates required fields before freezing a request and releases it on a definitive rejection.

A patch conflicts if its row version changed. Reload and review instead of silently replacing a human edit. Undo is atomic and rejects later edits to the affected cells/rows while preserving later edits to unrelated cells. Schema/create/view batches cannot be undone as row batches; archive/restore the table instead. Undo validates the final merged row against current schema and aggregate size. Missing values and explicit JSON null both count as unknown for schema changes. Populated columns cannot change type or remove select options; adding options, renaming, descriptions and reordering preserve data and IDs.

Current bounds: 100 columns, 10,000 rows including archived rows, 100 rows per mutation/read, 50 rows per UI page, 50 saved views, 1 MB mutation requests and 64 KB aggregate values/evidence per row. CSV import accepts 5 MB and 10,000 data rows with mapping, preview and typed validation; deterministic chunks respect both 100-row and serialized UTF-8 request bounds; export uses bounded pages and escapes spreadsheet formulas. Row reads refresh every 3 seconds and schema/list every 5 seconds while visible. This is polling, not an Ably table event stream. Export is a live paginated read, not a transactional snapshot during concurrent edits.

## Local verification

Use a disposable local database named `native_tables` with all migrations applied. Do not point the integration suite at a shared or production database.

```sh
RUN_DATABASE_INTEGRATION_TESTS=true DATABASE_URL=postgresql://USER@127.0.0.1:PORT/native_tables pnpm --filter core test src/helpers/data-table.integration.test.ts src/helpers/data-table-values.test.ts --maxWorkers=1
pnpm --filter core test src/services/__tests__/soko-bot-tables.test.ts src/services/soko-bot-runtime.service.test.ts --maxWorkers=1
pnpm --filter web test 'src/app/(app)/drive/tables/table-cell.test.tsx' 'src/app/(app)/drive/tables/table-value.test.ts' --maxWorkers=1
pnpm --filter @sokosumi/utils test --maxWorkers=1
pnpm --filter @sokosumi/soko-bot test --maxWorkers=1
pnpm check
```

On memory-constrained hosts, use `GOMEMLIMIT=1000MiB GOMAXPROCS=2 pnpm --filter core typecheck --singleThreaded` and the same command for `web`, sequentially. Regenerate the client with `pnpm --filter web generate:core:snapshot` after changing Core OpenAPI.

For browser proof, use `.cursor/skills/verify-sokosumi/bin/verify-sokosumi launch`, `doctor` and `sign-in`, then Files → Tables. The harness requires its own portless HTTPS proxy on 443, a browser installation and valid test authentication. Do not stop another checkout's proxy, reuse production credentials or invent signup accounts to bypass those prerequisites. Check keyboard draft/conflict handling, light/dark themes, mobile horizontal overflow, import retries, source history, archived rows/tables, selected-row task links and progressive writes.

## Review regression checks

`data-table-review.integration.test.ts` adds actual authenticated HTTP task-boundary tests, task-context retry fingerprints, null/type/undo invariants, and a 100-row × 100-column patch plus undo with 10,000 audited cells. Audit persistence uses one parameterized JSONB recordset insert; the normal 5-second transaction deadline is unchanged. The new component tests cover polling row removal, lost-ack mutation retries, byte-bounded imports, enrichment correction and typed filters. Runtime receipt tests use actual `executeTool` dispatch.

Run the Core integration files with the explicit isolated database environment described above and `--testTimeout=20000 --hookTimeout=20000` for dynamic auth initialization (this does not change the database transaction deadline). If Vitest temporary module files disappear between workers, use `--fsModuleCache --fsModuleCachePath <worktree-owned-ignored-directory>`; do not change other checkouts or shared services. Authenticated browser and live-provider acceptance remain separate, unverified prerequisites.
