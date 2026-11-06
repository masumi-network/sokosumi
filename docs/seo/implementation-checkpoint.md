# SEO workspace implementation checkpoint

REPORTED: the owner approved implementation of a page-scoped SEO workspace and changes to the public worker. The accepted views are Overview, Keywords, Competitors, Pages and Actions. The owner separately approved only the isolated localhost test database. Deployment, hosted migrations and another paid audit remain outside this implementation approval.

## Native Audit revision

REPORTED: the owner clarified that SEO must open as Audits, without a required Sokosumi Project or a separate personal assistant profile.

VERIFIED: correction to the earlier naming change: changing the heading left `ProjectScopeRequired` in the empty entry and forwarded SEO chat to the personal assistant. The retained UI regression failed all three entry cases with that earlier page source. The native entry now lists real Workspace Audits and creates the first Page atomically. Evidence: `apps/web/src/app/(app)/seo/page.test.tsx` and `apps/core/src/services/seo-audit.postgres.test.ts`.

VERIFIED: `SeoAudit` owns related pages in a Workspace. The seven existing SEO tables use an explicit Audit or legacy Project owner, enforced by database checks and independent unique keys. Existing Project-owned evidence stays intact. Evidence: `20261105160000_workspace_seo_audits/migration.sql`.

VERIFIED: SEO chat stays inside the Audit UI. Its per-user history, draft identity, selected pages and current dispatch restrictions stay separate from personal assistant chats. It can explain stored results and propose native UI actions. It has no execution tools. Evidence: `seo-chat.postgres.test.ts`, `chat-context.test.ts` and `seo-workspace.test.tsx`.

VERIFIED: native Google consent uses the existing Composio popup lifecycle and owner-bound connection records. It reuses a verified existing Google connection when available. No assistant is created. Consent starts only on an explicit Connect action and returns to the Audit. Evidence: `seo-connections.postgres.test.ts`, `seo-connections.service.test.ts` and `seo-connection-button.test.tsx`.

VERIFIED: the native revision applied successfully only to the isolated localhost database. Prisma reported `502 migrations found` and `All migrations have been successfully applied.` Hosted deployment of this revision remains pending.

VERIFIED: after merging `main` at `26328bac4a`, Core verification reported `626 passed (626)` across 22 files, including the isolated PostgreSQL regressions. The scoped Web run reported `159 passed (159)` across 13 files. Core and Web production builds reported `10 successful, 10 total`. The unchanged Soko Bot tool package reported `448 passed (448)`. `pnpm precommit` reported `20 successful, 20 total` before the merge.

VERIFIED: native chat reserves a daily allowance before inference, per user and Workspace across Audits. `SEO_CHAT_DAILY_TURN_LIMIT` defaults to `100`. Failed and expired attempts count. Replays do not count again. Exhaustion returns `429`. Evidence: `seo-chat-quota.postgres.test.ts` and `apps/core/src/config/env.ts`.

VERIFIED: source reversion checks reproduced the old entry, asynchronous viewer cache, retry-key, missing import-header, hidden connection-control, OAuth cleanup and allowance failures. The corrected sources were restored and their regression suites passed. Evidence: `seo-workspace.test.tsx`, `page.test.tsx`, `seo-connections.postgres.test.ts` and `seo-chat-quota.postgres.test.ts`.

VERIFIED: full CI at `c6ab663928` passed Web, package tests, typechecks and builds, but the PostgreSQL step reported `5 failed | 410 passed | 11 skipped (426)`. All five failures came from `contact-capture.postgres.test.ts`. Its `runIntegrationTool` fixture still mocked the old module after the executor moved. The earlier focused command selected the nonexistent `contact-capture.service.test.ts`, so it did not check this database boundary. Correction: the existing fixture now mocks `composio-integration-tools.service`. The isolated reproduction reported `5 failed | 8 passed (13)` before that change and `13 passed (13)` afterward. Product capture behavior and assertions are unchanged.

## Native flow correction

VERIFIED: the earlier native revision deployed to Preprod Preview at `6518c7c0ff4a163e2149a2ba550ec3c4e8511cb0`. Workflow `42042590371` returned `success`, and Core logged `All migrations have been successfully applied.` The earlier pending-deployment statement above records the state before that rollout.

VERIFIED: that rollout's public route checks did not cover native OAuth recovery or the worker write contract. The shared callback could still forward a lost-popup return to the personal assistant. The corrected source uses dedicated SEO callback and return documents, explicit recovery, owner/account proof and exact viewer/Workspace fences. Retained tests reproduced three connection recovery failures, two proxy callback failures and stale-organization failures before their fixes.

VERIFIED: the current native UX slice reported `636 passed (636)` across 22 Core files and `187 passed (187)` across 20 Web files. Typechecks reported `20 successful, 20 total`; Core/Web builds reported `10 successful, 10 total`. Independent source review found no remaining actionable issue. Reverting the inline entry and saved statistics selection reproduced three failures. The percentage trend regression failed before shared unit formatting was added.

VERIFIED: this local revision adds inline Audit creation, one selected traffic trend, saved source/property setup, explicit keyword targets, visible failed checks and native connection retries. Live signed-in UI, Google consent and model responses remain unverified. The user-flow acceptance guide records those remaining checks.

VERIFIED: the worker requests guarded Task event/file routes that this Core Preview does not declare. The source only mounts `/tasks/{id}/events` and `/tasks/{id}/files`. A Task move changes its Workspace without changing billing organization. A correct worker write precondition must therefore include Workspace, owner, organization and the authenticated assignee. Guarded delivery remains a required follow-up in this same PR. Paid dispatch stays disabled.

## Guarded worker delivery

VERIFIED: native UX revision `2a57c6c08f9e1af4d6f52e1e72346f7fc0073cbd` deployed through Preview workflow `42059193746`, which returned `success`. Both Vercel deployments report `READY` with that exact SHA and the feature branch aliases. The public SEO callback returns `200`, `Cache-Control: no-store` and `Referrer-Policy: no-referrer`. These probes do not prove Google consent completion.

VERIFIED: the guarded delivery source now mounts `/tasks/{id}/events/context-v1` and `/tasks/{id}/files/context-v1`. It reuses existing status and billing rules. Exact owner, billing organization, Workspace and authenticated assignee checks run under the Task row lock. Task DTOs expose the current Workspace ID. No migration is required for this slice.

VERIFIED: the signed upload callback repeats the original context checks in the TaskFile write transaction. Malformed signed bindings cannot fall back to legacy cleanup. A stale callback retains the Blob because another valid callback can link it after the Task moves back. Existing linked history remains readable and retries can complete a failed report import.

VERIFIED: the root rerun reported `238 passed (238)` across seven Task, event, file and Blob files. The isolated PostgreSQL suite reported `20 passed (20)`. The actual worker-to-Core local contract reported `1 passed`, with zero provider calls, zero debits, one TaskFile and one imported observation. Replay kept those counts unchanged. Evidence: `/private/tmp/seo-worker-core-root-tests.log`, `/private/tmp/seo-worker-core-root-pg.log` and `/private/tmp/seo-worker-actual-core-root.log`.

REPORTED: independent source review found no remaining guarded-delivery issue. Retained regressions failed after removing Workspace checks, allowing malformed-binding downgrade, restoring immediate stale-Blob deletion or omitting the Task Workspace DTO. This is local authorization evidence, not hosted worker acceptance.

VERIFIED: a generic Task-capable Coworker is not proof of SEO protocol support. The check form must keep unverified choices explicit. Page-only checks request zero provider calls and do not show a paid-data limit. A Workspace without an executor stays inside SEO and offers report import or return to the Audit.

VERIFIED: correction to the earlier imported-executor fallback: the source Task's current assignee can change after report import. The fallback now reads the exact source TaskFile uploader, requires matching Task/file provenance in the current Workspace, and retains the existing assignment gate. The root rerun reported `14 passed (14)` across the Project SEO and native Audit PostgreSQL suites. REPORTED: restoring the old service reproduced one wrong-assignee failure. Evidence: `/private/tmp/seo-imported-executor-root-pg.log` and `/private/tmp/seo-imported-executor-old-source.log`.

VERIFIED: CI `42061624221` for `ea8e87166e8d2576366f098396e34cf9fc09fb31` failed in Core, while Web passed. Its Core unit log reported `5 failed`, `985 passed`, `13 skipped` files and `108 failed`, `14057 passed`, `164 skipped` tests. Five existing test doubles omitted the newly required `workspaceId`, causing `Invalid input: expected string, received undefined`. The production mapper supplied the field. REPORTED: updating only those five DTO fixtures changed the focused reproduction from `108 failed / 95 passed` to `203 passed`. The required schema and existing assertions remain unchanged. Evidence: `/private/tmp/seo-guarded-ci-failed.log`.

REPORTED: the complete local Core rerun with socket access reported `14164 passed`, `164 skipped` and one failure. The unchanged sandbox CA test received the desktop's injected certificate path instead of its fixture path. That file passed all eleven tests in hosted CI. The original 108 DTO failures are gone. Unrelated CA behavior was not changed. Evidence: `/private/tmp/seo-native-ci42061624221-core-ci-fixed-unsandboxed.log`.

## Native service and activity correction

VERIFIED: the generic Task Coworker selector did not prove SEO request compatibility. Imported file provenance did not prove it either. Core now selects the configured existing service for the exact authenticated user, Workspace and billing organization. Normal assignment checks remain authoritative. Native forms send no executor ID and no longer fetch the generic catalog. No bot profile or permission grant is created.

VERIFIED: paid search and scheduler capabilities default to false. The normal paid and finite-monitor implementations remain available when explicitly configured. Missing readiness disables the relevant controls. A configuration change cannot redirect an existing finite monitor to another executor. Committed analysis replay still returns its original result. Stored chat actions recheck current actor-specific service availability.

VERIFIED: the reporting period previously overwrote global Audit dates after statistics sync. That could hide a newly imported result. Reporting periods now remain separate, reopen from saved statistics metadata, and do not change activity dates. Timeline imports and Action links use their own creation timestamps even when the evidence was measured earlier. Foreign-page and private metric sources cannot supply those public Action events.

VERIFIED: the SEO sidebar still appended the selected Sokosumi Project through the shared navigation map. Its entry now opens Workspace Audits consistently. Existing bookmarked Project report parsing remains unchanged. Root navigation and page checks reported `26 passed (26)`. Restoring only the original navigation source reproduced one failure. Evidence: `/private/tmp/seo-native-navigation-old-source.log`.

VERIFIED: root combined checks reported `108 passed (108)` across nine Core files, including the isolated database cases, and `105 passed (105)` across eleven Web files. Normal checks reported `20 successful, 20 total`; Core/Web builds reported `10 successful, 10 total`. The full local Core unit run reported `14175 passed`, `164 skipped` and the same single desktop CA-path failure recorded above. New hosted CI remains required for this revision. Evidence: `/private/tmp/seo-native-service-core-root.log`, `seo-native-service-web-root.log`, `seo-native-service-precommit.log`, `seo-native-service-build-root.log` and `seo-native-service-core-full.log`.

REPORTED: retained old-source checks reproduced five initial executor failures, a stale chat-action failure, missing scheduler-guard failures, three statistics form failures and activity timeline failures. Independent reviews found no remaining actionable issue after the corrections. Selected-report failures now expose a real Retry control; unavailable and filtered-empty states give accurate recovery actions.

VERIFIED: only this PR's Core Preview branch received the noncredential `SEO_ANALYSIS_EXECUTOR` configuration. A Vercel environment-run check, with local SEO variables unset, matched the exact scope and both false capabilities. Dispatch remains unset with source default false. Metadata alone did not decrypt the configuration; its earlier unreadable value was not evidence of a mismatch. Production settings, credentials, grants and provider accounts remain unchanged. Evidence: `/private/tmp/seo-native-executor-resolved.json`.

The following evidence records the earlier Project-scoped implementation before this native revision.

## Organization context and consent return correction

REPORTED: The owner clarified that organization Audit chat and statistics must be shared in the organization's work context. They also requested removal of the global Project selector from SEO, and chose Battery Sensei for Google Search Console testing.

VERIFIED: Correction to the earlier reader-only design: its tests proved personal isolation but did not prove the requested organization collaboration. `lib/seo/data-visibility.ts` now distinguishes organization and personal context. `seo-chat.service.ts:120` reads the shared conversation, identifies each author and excludes legacy private turns. Shared inference also excludes the original author's private metrics. Account consent and Google account operations remain bound to the initiating user and Workspace.

VERIFIED: Migration `20261106090654_seo_shared_organization_context` adds two visibility columns with `DEFAULT 'PRIVATE'` and two value checks. Its approved localhost run applied only that pending migration. Existing records are not published by the migration. `project-seo-store.ts:78` also applies linked Project scope and lifecycle checks to an Audit; public report and saved-data ownership remain separate.

VERIFIED: Root checks reported `97 passed (97)` across fourteen Core/database files, `43 passed (43)` across the workspace/header Web files, `20 successful, 20 total` for normal checks and `10 successful, 10 total` for Core/Web builds. Evidence: `/private/tmp/seo-organization-context-core-root.log`, `seo-shared-context-web-root.log`, `seo-organization-context-precommit.log` and `seo-organization-context-build.log`.

REPORTED: Prior services in a newly created temporary tree failed seven of eight retained cases, including six sharing, privacy or linked-Project behavior checks. Prior Web source failed two of three retained cases; the personal privacy control passed. Source files in the working tree were never overwritten during those comparisons. Independent Core, Web-sharing and OAuth reviews found no actionable issue.

VERIFIED: The signed-in Preprod UI created native Audits and saved related pages and a two-page selection. Battery Sensei's keyword target and edited High priority survived reload. No paid provider request was added. The top-bar selector, empty parent name and saved-selection label corrections remain source changes pending deployment.

REPORTED: Runtime request metadata showed main Preprod's `/personal-assistant/integrations/verify` returning `307` to `/signin` during the consent attempts. Public probes also found the generic `/composio/callback` and `/composio/handoff` documents behind sign-in. Native initiation now reuses the canonical-origin handoff, and the proxy permits exactly those two existing documents. Finalization remains authenticated. Old-source comparisons reproduce two Web, three helper and one lifecycle failure; fixed checks pass.

VERIFIED: Correction to the initial canonical patch record: `26328bac4a` was an earlier repository base, not the current callback host's source. Full deployment metadata identified `5ab3223c1d70fe5004bcfdc840bc8e973afc566c` behind canonical deployment `dpl_6tiYckHE1i2Xm8tCtffb6Ja2CQYb`. A refreshed Web-only relay subset uses that actual base. No canonical deployment or Composio setting change has occurred.

## Deployed organization context and managed-return correction

VERIFIED: Approved commit `2cc506ba429e0c09353a7b28a8ca557492335537` was pushed to PR #6876. Preview workflow `42197656370` reported `success`; Web deployment `dpl_BzKBb8rhARrK1hdQsMVSDcSmond6` and Core deployment `dpl_5yE4LHim9cEMLyhcLn7GndEPbu2r` reported `READY`. Evidence: `/private/tmp/seo-2cc-preview-deploy.log:179`.

VERIFIED: CI `42197528651` passed. Its Core unit run reported `14178 passed`, and its PostgreSQL run reported `457 passed`. Its Web run reported `13457 passed`. These results prove those tests pass. They do not prove the remaining hosted Google or worker journeys. Evidence: `/private/tmp/seo-2cc-ci-green.log`.

VERIFIED: On that deployed Preview, the signed-in Battery Sensei Audit showed no global Project selector. Its embedded chat displayed `This conversation and saved statistics are shared within this audit in your organization.` A real reply named the saved keyword and competitor and identified unavailable measurements. Evidence: `/private/tmp/seo-battery-shared-chat-live.png` and the live Audit `01a1b014-b853-71da-b7b8-5fe2d643456c`.

VERIFIED: The approved single read-only server check ended with `config_read_failed` on diagnostic deployment `dpl_FYVMUKKNWBHUkQHyxepcynygLpiB`. No verifier configuration or HTTP status was returned. The script stopped before normal build, migrations or publication. No retry or settings change occurred. Evidence: `/private/tmp/seo-composio-preflight-build.log`.

INFERRED: Reading or changing the managed Composio project is unnecessary for the prepared source-only correction. The fixed verifier return can reuse the existing generic consent document, then preserve the initiating native handoff.

VERIFIED: The source correction rewrites only an exact GET verifier request with one nonblank `session_uri`, no bot selector and no owner-reentry marker. Existing bot fallback sets an explicit reentry marker and remains authenticated. The callback gives a current same-origin nonce precedence, then validates stored first-party handoff time, popup attempt and connection identity before the legacy popup-name fallback. It preserves native identity fields and withholds the session URI on an account mismatch.

REPORTED: Independent checks passed `84` proxy/protocol/managed-relay tests and `9` connection-control tests. Before source edits, the retained regressions reproduced two proxy failures and eleven managed-relay failures. No missing import or fixture error caused those failures. Independent source review found no actionable issue.

VERIFIED: Root connection-control checks reported `9 passed (9)`. The new paired-provider recovery test failed on the original labels, then passed with provider-specific retry and restart names. Evidence: `/private/tmp/seo-provider-recovery-labels-before.log` and `/private/tmp/seo-provider-recovery-labels-after.log`.

VERIFIED: The combined root Web rerun reported `145 passed (145)` across seven files. The full Web build reported `6 successful, 6 total`. The first build hit a sandbox socket error; its cached graph replayed that failure after escalation. A successful independent loopback-listener check and a fresh generated Next cache produced the passing build. Source remained unchanged. Evidence: `/private/tmp/seo-managed-return-web-root.log` and `/private/tmp/seo-managed-return-web-clean-build.log`.

VERIFIED: The actual built callback document passed four VM cases. A preserved-name native handoff returned to its saved SEO origin and context. Foreign, future-dated and production insecure-local returns kept the protected fallback. Evidence: `/private/tmp/seo-managed-return-actual-next-bundle-proof.json`, callback script SHA256 `3c70738c4ef94a85973a104a01eef71a0a34b4a48e3f1c45394600286fc8158e`.

VERIFIED: Correction after hosted CI `42204345640`: its Web run reported one failed and `13490 passed` tests. The shared retry message gained a required provider value, but the ordinary-tab callback caller still omitted it. The earlier focused suite did not include that return-page test. The caller now supplies its existing provider name. The updated regression failed on the prior caller and passes with the fix. The combined eight-file rerun reports `149 passed (149)`. Evidence: `/private/tmp/seo-callback-provider-label-before.log` and `/private/tmp/seo-callback-provider-label-after.log`.

VERIFIED: The complete local Web command `pnpm exec turbo run test:ci --filter=web` reported `1316 passed` files and `13451 passed` tests, with `6 successful, 6 total` tasks. This proves that local run, not a new hosted merge result. Hosted CI must still validate the follow-up commit. Evidence: `/private/tmp/seo-callback-provider-web-full.log`.

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
3. VERIFIED: The owner signed in and a real embedded chat reply completed. Google popup closure, statistics sync and hosted worker completion remain pending.
