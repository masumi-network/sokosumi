# Proving a migration

Linked from Migrations in [`packages/database/AGENTS.md`](../../packages/database/AGENTS.md).
How to write a migration (naming, timestamps, drift, release timing) is in Migrations in [`packages/database/AGENTS.md`](../../packages/database/AGENTS.md); this page is how to show it works before merge.
Commands run from `packages/database` unless stated otherwise.

## Throwaway PostgreSQL

No Docker or local server is needed: Prisma ships PGlite, an in-memory PostgreSQL.

- **`pnpm exec prisma dev --detach --name <name>`** starts one and prints its URL (the port may differ from the one you ask for). Remove it with `pnpm exec prisma dev stop <name>`, then `pnpm exec prisma dev rm <name>`.
- **`pglite-server`** from `@electric-sql/pglite-socket` (in `node_modules/.pnpm`, a Prisma dependency) takes a fixed port: `node <path>/dist/scripts/server.js -p 55437 -e pg_trgm`. `pg_trgm` is the one extension the migrations need. It accepts one connection unless given `-m <n>`. Start it in the background, wait for `listening` in its log, run your commands, then kill it: with `-r <command>` the server can stay up after the command exits. Put multi-step commands in a script file, because an inline `sh -c '…'` loses its quoting.

Export both `DATABASE_URL` and `DATABASE_URL_UNPOOLED` as the printed URL (`postgresql://postgres:postgres@127.0.0.1:<port>/postgres?sslmode=disable` for `pglite-server`), then `pnpm prisma:migrate:deploy` and `pnpm prisma:check-drift`. A worktree without `.env` files cannot reach a shared database by accident.

Deploy to a Neon database over its direct URL (`DATABASE_URL_UNPOOLED`, the host without `-pooler`). Through the pooler, Prisma's migration advisory lock can outlive the run and block every later deploy on that database.

To build a database that matches `main`, move the branch's new folders out of `prisma/migrations`, deploy, then move them back and deploy again. `prisma.config.ts` pins `migrations.path`, so `--schema` pointed at another tree still applies the branch's migrations. Check the migration count in the deploy log, and `git status --porcelain prisma/migrations` after the restore.

The same server runs a Core `*.postgres.test.ts` locally: from `apps/core`, `RUN_DATABASE_INTEGRATION_TESTS=true pnpm exec vitest run <file>` with the URL exported. A race test needs several connections and proves itself only in CI's real PostgreSQL.

## On production data

`pnpm db:up` forks a Neon branch from production and applies the branch's pending migrations ([agent-database.md](./agent-database.md)); use it to time the migration and check invariants before and after. A green Core Preview deployment also ran `migrate deploy` on a production fork, but it is weak evidence, not a dry run.

SQL invariants are not enough: also read back what the app will parse. Any id a migration mints in SQL must pass Core's zod `uuid()` check (RFC 9562: version 1–8, variant `8`–`b`). `md5(…)::uuid` fails it most of the time; set the version and variant nibbles (for example to version 8) and validate every minted id with Core's own zod before merge.

Do not propose an index or a query rewrite from `schema.prisma` alone. The schema shows which indexes exist, not which the planner uses: PostgreSQL can use a non-leading index column, and a small table makes any plan fast. Read row counts from `pg_stat_user_tables` first, then run `EXPLAIN (ANALYZE, BUFFERS)` for each claim.

## A failed migration stays half-applied

A migration file is not one transaction. When a statement fails, the statements before it stay applied and `_prisma_migrations` records a failed row (`P3018`), so a retry does nothing until someone runs `prisma migrate resolve`. Order statements so that no later one can fail on data an earlier one changed. For example, add a CHECK constraint as `NOT VALID` first, convert the data, then `VALIDATE CONSTRAINT` last.

## CI checks on migration text

`src/types/__tests__/partial-unique-schema-coverage.test.ts` replays migration SQL with a regex, so it misses an index renamed inside a `DO` block or loop. Add a literal `ALTER INDEX "<old>" RENAME TO "<new>"` for each such rename.
