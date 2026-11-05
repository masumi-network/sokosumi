# SEO workspace implementation checkpoint

REPORTED: the owner approved implementation of a page-scoped SEO workspace and changes to the public worker. The accepted views are Overview, Keywords, Competitors, Pages and Actions. The owner separately approved only the isolated localhost test database. Deployment, hosted migrations and another paid audit remain outside this implementation approval.

## Native Audit revision

REPORTED: the owner clarified that SEO must open as Audits, without a required Sokosumi Project or a separate personal assistant profile.

VERIFIED: correction to the earlier naming change: changing the heading left `ProjectScopeRequired` in the empty entry and forwarded SEO chat to the personal assistant. The retained UI regression failed all three entry cases with that earlier page source. The native entry now lists real Workspace Audits and creates the first Page atomically. Evidence: `apps/web/src/app/(app)/seo/page.test.tsx` and `apps/core/src/services/seo-audit.postgres.test.ts`.

VERIFIED: `SeoAudit` owns related pages in a Workspace. The seven existing SEO tables use an explicit Audit or legacy Project owner, enforced by database checks and independent unique keys. Existing Project-owned evidence stays intact. Evidence: `20261105160000_workspace_seo_audits/migration.sql`.

VERIFIED: SEO chat stays inside the Audit UI. Its per-user history, draft identity, selected pages and current dispatch restrictions stay separate from personal assistant chats. It can explain stored results and propose native UI actions. It has no execution tools. Evidence: `seo-chat.postgres.test.ts`, `chat-context.test.ts` and `seo-workspace.test.tsx`.

VERIFIED: native Google consent uses the existing Composio popup lifecycle and owner-bound connection records. It reuses a verified existing Google connection when available. No assistant is created. Consent starts only on an explicit Connect action and returns to the Audit. Evidence: `seo-connections.postgres.test.ts`, `seo-connections.service.test.ts` and `seo-connection-button.test.tsx`.

VERIFIED: the native revision applied successfully only to the isolated localhost database. Prisma reported `502 migrations found` and `All migrations have been successfully applied.` Hosted deployment of this revision remains pending.

VERIFIED: final native Core verification reported `626 passed (626)` across 22 files, including the isolated PostgreSQL regressions. The Soko Bot tool package reported `448 passed (448)`. The latest native Web flow run reported `78 passed (78)`. `pnpm precommit` reported `20 successful, 20 total`.

VERIFIED: native chat reserves a daily allowance before inference, per user and Workspace across Audits. `SEO_CHAT_DAILY_TURN_LIMIT` defaults to `100`. Failed and expired attempts count. Replays do not count again. Exhaustion returns `429`. Evidence: `seo-chat-quota.postgres.test.ts` and `apps/core/src/config/env.ts`.

VERIFIED: source reversion checks reproduced the old entry, asynchronous viewer cache, retry-key, missing import-header, hidden connection-control, OAuth cleanup and allowance failures. The corrected sources were restored and their regression suites passed. Evidence: `seo-workspace.test.tsx`, `page.test.tsx`, `seo-connections.postgres.test.ts` and `seo-chat-quota.postgres.test.ts`.

The following evidence records the earlier Project-scoped implementation before this native revision.

## Earlier delivered behavior

VERIFIED: `apps/core/src/routes/v1/projects/[id]/seo/index.ts` mounts versioned Project operations. Stored evidence, page groups, saved keyword priorities and competitor choices remain separate. Each analysis freezes its pages, scope version, Market, devices and provider allowance before creating its Task. `project-seo.postgres.test.ts` checks dispatch retries, stale scope rejection and exact source authority.

VERIFIED: `project-seo-monitor.service.ts` uses the existing Task Schedule Run ledger. A monitor has a finite daily or weekly rule. Each planned Run creates a fresh analysis through the same transaction service. Manual extra Runs are refused. Existing pause and end controls remain the schedule management path.

VERIFIED: `project-seo-page-changes.postgres.test.ts` reports `Tests 2 passed (2)`. A manual change adds one immutable, scoped timeline annotation across retries. A conflicting retry returns 409. Foreign pages, future dates and a cancelled write create no event. An annotation does not verify a release or its traffic effect.

VERIFIED: `project-seo-projection.test.ts` checks that Task completion means implemented. Verification requires later explicit passing checks for every referenced finding, with the same page, Market, device and rulebook. A check of another row, a failed check or an incompatible observation leaves the action unverified.

VERIFIED: native Google queries use the personal Soko Bot's existing Composio connection. `native-statistics.ts` requests provider period totals separately from daily points. Missing values stay null. Distinct users and weighted Search Console positions are not summed. Statistics retain page scope, channel, period, time zone, coverage and source dates. Public Coworker requests contain no native analytics payload or connection credentials.

VERIFIED: `packages/soko-bot/src/seo.ts` defines native SEO tool contracts. `lib/soko-bot/seo-tools.ts` calls the same Core services as Web. Writes keep turn authorization and action receipts in the write transaction. Replays read current authorized data. Analysis and recommendation Tasks use existing hydrated chat cards.

## Validation evidence

VERIFIED: final `pnpm precommit` passed formatting and all 20 workspace typecheck tasks. Separate local production builds for Core and Web passed. The worker's local bundle build with `--skip-sandbox-prewarm` passed. That worker build does not prove deployment, sandbox startup or automatic cron delivery.

VERIFIED: the initial focused Core run reported `494 passed | 9 skipped`. The separately enabled localhost database run executed those nine tests and reported `9 passed (9)`. The complete Soko Bot package suite reported `448 passed (448)`.

VERIFIED: the standalone PR branch passed a new combined Core run with `Tests 470 passed (470)`, including the dispatch gate, native runtime and ten localhost database tests. The scoped Web rerun reported `Tests 43 passed (43)`. `pnpm precommit` passed all 20 workspace tasks, and the combined Core/Web production build passed all ten tasks.

VERIFIED: `parsePublicSeoArtifact` accepted the existing completed public audit fixture. Its normalized result reported one page, two actions and 39 keyword observations. This check read only the local JSON artifact.

VERIFIED: final Web run reported `Test Files 12 passed (12)` and `Tests 136 passed (136)`. German and Spanish message-key parity passed. The checks include viewer cache isolation, frozen scope editing, source filters, page-change input, monitor controls and full-audit default limits.

VERIFIED: `prisma migrate diff --from-config-datasource --to-schema prisma --script --exit-code` returned `This is an empty migration.` The localhost migration ledger query returned `501` completed, non-reverted migrations.

VERIFIED: the new localhost database at `127.0.0.1:57439/seo_workspace_test` applied 501 migrations. Prisma reported `All migrations have been successfully applied.` No hosted database was used. Standard repository auth fixtures were seeded only there.

VERIFIED: the complete worker command `node --test "test/**/*.test.ts"` reported `tests 2134`, `pass 2132`, `fail 0`, `skipped 2`. The log is in the parent workspace's ignored `.release-work/evidence/focused-worker-full-tests.log`.

VERIFIED: the prior Market-key projection, with new tests retained, reported `2 failed | 4 passed (6)`. The failures showed one Market suppressing another and an incompatible passing check clearing a finding. The current source was restored. Evidence: ignored `.release-work/evidence/seo-projection-market-red.log`.

REPORTED: the properties router with its prior workspace-context setting returned `403` and `Workspace is missing` in the real route integration test. Restoring `includeWorkspaceContext: true` made the route pass.

REPORTED: native metadata-only review used the official Composio toolkit Markdown. The Analytics report limit is an integer. The old string limit failed its regression. Toolkit metadata and execution use the existing SDK's latest toolkit version. No live provider execution was part of that check.

VERIFIED: local browser launch stopped at `Port 443 requires elevated privileges, but sudo elevation failed`. The required HTTPS proxy could not start without the machine owner's sudo step. No browser verification claim follows from component or API tests.

## Earlier release boundary

VERIFIED: implementation uses separate local worktrees. This change preserves existing deployment configuration and credentials. No hosted deployment or additional paid audit was run.

VERIFIED: the implementation commits are storage `c2869f627e`, operations `bd25c91501`, UI `3a941ed7a8` and separate worker `90ded488`.

REPORTED: the owner requested one Sokosumi PR, without a stack, for preview testing. VERIFIED: standalone branch `feat/seo-workspace` includes all three Sokosumi commits and targets `main`. The earlier local layer branches are not separate PRs.

VERIFIED: the deployed worker's earlier Task parser does not understand the new structured request packets. A focused request can lose its page, Market, device and budget constraints there. New analysis and monitoring dispatch therefore default to disabled. Report import, native statistics and local page editing remain available. Maintainers must verify the updated worker protocol before enabling dispatch.

INFERRED: release should apply the additive SEO migration and deploy Core, Web and the updated public worker together after review. This tab is a Sokosumi feature; its Core and Web changes require a separate release decision. Existing native Google connections remain the connection path.

## Least confident decisions

1. INFERRED: supported Composio tools may still vary by connected account. Runtime metadata checks refuse unsupported or non-read-only tools.
2. INFERRED: real provider latency and billed usage need a separately approved live test. Offline call budgets are not a price guarantee.
3. VERIFIED: interactive browser acceptance remains pending the local HTTPS proxy's sudo requirement.
