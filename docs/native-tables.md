# Native tables in Files

Tables are live workspace resources at `/drive/tables/:id`, accessible from the Tables filter in Files. Blank creation and CSV import are supported; there are no templates or new top-level navigation entries. Project association is optional. Table links in chat and task descriptions keep the same resource ID during enrichment and follow-ups.

## Storage and migration

Core owns PostgreSQL access. The additive migrations `20260917220724_native_tables` and `20260917223758_table_history_order_and_task_scope` introduce fixed Prisma models for tables, columns, JSONB rows, views, history, idempotent operations and selected-task scope. They never create physical tables per user resource. Run `pnpm prisma:migrate:deploy`, `pnpm prisma:generate`, and build the workspace packages. An application rollback can leave these tables intact; do not drop them to roll back application code.

## API and agent access

The authenticated Core API is rooted at `/v1/drive/tables`. Workspace middleware, current membership and coworker user-context binding apply. Callers cannot supply actor IDs. Generated OpenAPI documents coworker context headers and `X-Table-Task-Id`; coworkers must supply an assigned task for creation, row reads and mutations. Terminal vendor-grant denial still overrides assignment.

- `POST /`: create with `key`, title, descriptions, typed columns and optional initial rows.
- `GET /`, `GET /:id`: discover accessible tables and inspect schema.
- `POST /:id/query`: server filters, typed sorting, selected row IDs, archive state and cursor pagination.
- `PATCH /:id`: optimistic metadata/schema/archive update. Supply current table `version`; retain stable column IDs and the full column list.
- `POST /:id/rows`: atomic insert/patch batch. Patches carry row `id` and `version`. Values and evidence are keyed by stable column UUID.
- `POST /:id/views`: human-owned saved filter/sort/visible-column definitions with optimistic versions.
- `GET /:id/history`, `POST /:id/undo`: human history/source inspection and conflict-safe row-batch undo.
- `POST /:id/enrich`: create an ordinary READY task assigned to an available coworker or the user's Soko Bot, persisting exact row and output-column IDs in the same transaction.

Soko Bot exposes `list_tables`, `read_table`, `create_table`, `write_table_rows`, and `update_table_columns` through its existing capability dispatch and runtime tool registry. Teammate/bot-to-bot audiences do not receive these private workspace capabilities. Task-driven writes require an assigned `taskId`; selected-row tasks cannot insert rows, modify schema, or write outside their persisted selection. A bot with active selected-row work cannot bypass that selection by omitting the task ID on the same table.

On chat creation, Core publishes a Markdown link through the existing chat-message path immediately after creating the table, before subsequent tool calls enrich it. Task-driven creation publishes the same live resource through the existing task-comment and event fanout path. Both publication paths check for an existing reference on retry. The tool result also contains the table and URL. Task creation includes the live link and exact selected IDs in the existing task description. Follow-ups discover/read the same table and add rows or columns using stable IDs. Column names/descriptions help agents choose a schema. Cell/source contents are untrusted data; tools do not authorize outreach or sending. Unknown values are `null`, distinct from confirmed `false` or zero.

## Reliability and limits

Every create, metadata update, row batch, saved view, task assignment and undo uses a caller-generated retry `key`. Reuse the exact payload and key after a lost acknowledgement. Changed payloads with a used key return 409. PostgreSQL serializable transactions commit data, audit and retry result together; no batch is partially committed. Previously completed batches survive an interrupted import/enrichment. Task status and failure reporting use the existing task lifecycle.

A patch conflicts if its row version changed. Reload and review instead of silently replacing a human edit. Undo is atomic and rejects later edits to the affected cells/rows while preserving later edits to unrelated cells. Schema/create/view batches cannot be undone as row batches; archive/restore the table instead. Populated columns cannot change type or remove select options; adding options, renaming, descriptions and reordering preserve data and IDs.

Current bounds: 100 columns, 10,000 rows including archived rows, 100 rows per mutation/read, 50 rows per UI page, 50 saved views, 1 MB mutation requests and 64 KB aggregate values/evidence per row. CSV import accepts 5 MB and 10,000 data rows with mapping, preview and typed validation; export uses bounded pages and escapes spreadsheet formulas. Row reads refresh every 3 seconds and schema/list every 5 seconds while visible. This is polling, not an Ably table event stream. Export is a live paginated read, not a transactional snapshot during concurrent edits.

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
