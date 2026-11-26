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

## Lock timeouts

Set a 5-second lock timeout before statements that take `ACCESS EXCLUSIVE`. A waiting exclusive lock queues later reads and writes on the table.

```sql
SET lock_timeout = '5s';
-- Statements that take ACCESS EXCLUSIVE go here.
RESET lock_timeout;
```

Reset the timeout before backfills and `VALIDATE CONSTRAINT`. Use plain `SET lock_timeout` because `SET LOCAL` has no effect outside an explicit transaction block.

After `prisma migrate dev`, add both lines by hand, even if `ALTER TABLE` only adds a foreign key to a table created in the same migration, because the foreign key also locks the referenced table. For pull requests, Test Packages runs this check only when the PR is ready for review, so add the lines before marking it ready.

Test Packages checks new migrations for `SET lock_timeout` whenever the file contains `ALTER TABLE`. For a migration that can safely omit the timeout, add a line in the SQL file in the form `-- lock-timeout: not needed, <reason>`.

A lock timeout fails the statement with PostgreSQL error `55P03`. Check which statements took effect and make sure the migration can safely run again. Run `pnpm exec prisma migrate resolve --rolled-back <name>` using the direct URL (`DATABASE_URL_UNPOOLED`), then deploy again. A plain redeploy stops at `P3009`.

### Concurrent index builds

Prisma 7.10.1 fails with `25001` when a migration file contains `DROP INDEX CONCURRENTLY` alongside another statement. A concurrent build therefore cannot carry its own leading drop. Give the build its own migration file so it can be retried independently. [Prisma engines pull request #5847](https://github.com/prisma/prisma-engines/pull/5847)

For a concurrent build, omit `lock_timeout` because it can cancel the build and leave an invalid index, and omit `IF NOT EXISTS` because it hides an invalid index. A failed build blocks every later production deploy with `P3009` until a human recovers it. Check `pg_stat_activity` first for a still-running `CREATE INDEX` targeting the index. Once the build has stopped and the cause is fixed, run `DROP INDEX CONCURRENTLY IF EXISTS "<index>"` and `pnpm exec prisma migrate resolve --rolled-back <migration>` on the direct URL (`DATABASE_URL_UNPOOLED`), then deploy again.

## CI checks on migration text

`src/types/__tests__/partial-unique-schema-coverage.test.ts` replays migration SQL with a regex, so it misses an index renamed inside a `DO` block or loop. Add a literal `ALTER INDEX "<old>" RENAME TO "<new>"` for each such rename.
