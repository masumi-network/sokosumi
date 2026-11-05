# SEO analysis dispatch rollout

VERIFIED: `SEO_ANALYSIS_DISPATCH_ENABLED` defaults to `false` in Core. The default hides analysis and monitor creation controls. Core also refuses direct analysis dispatch and monitor creation before any Task or schedule is written. Stored reports, Audits, saved page selections, imports, native statistics, recommendation Tasks and page-change notes remain available.

VERIFIED: the Task parser from worker commit `6f7a34de` returned only the first URL from a `seo_job:` packet. The tested packet requested two pages, Germany, mobile and zero provider calls. Its parsed Case retained none of those bounds. A zero-call page check must not be sent to that worker.

INFERRED: a maintainer should enable `SEO_ANALYSIS_DISPATCH_ENABLED=true` only in the matching Core deployment after reviewing its public SEO worker. The worker must support versioned `seo_job:` and `seo_audit:` requests and Core's guarded Task event/file delivery routes. Enablement requires a Core redeployment because Core caches validated environment settings.

VERIFIED: the Sokosumi implementation contains Core and Web changes. The worker implementation lives in the separate `seo-bot` repository. Opening or deploying a Sokosumi PR does not deploy that worker.

INFERRED: deploy the PR with dispatch disabled to inspect `/seo`, create an Audit with a first page, save pages, import completed public reports, record changes and read native statistics. Do not infer worker compatibility from a successful health request alone.

VERIFIED: `apps/core/src/config/env.ts:17` validates optional `SEO_ANALYSIS_EXECUTOR` JSON with required `coworkerId`, `workspaceId`, `ownerId` and nullable `organizationId`. `canUsePaidSearchData` and `canSchedule` default to `false`. Malformed JSON, missing fields and extra fields fail environment validation. An absent assertion leaves native analysis unavailable. The existing global dispatch flag remains required.

VERIFIED: `apps/core/src/lib/seo/analysis-dispatch.ts` matches the authenticated Task owner's user ID, Workspace and billing organization exactly. It checks current Coworker Task usability. The normal Task and schedule assignment gates still run. Imported report uploaders are provenance, not proof of current request protocol support. An explicit API executor must equal the configured one. The Workspace response exposes readiness and paid-data availability without exposing configuration IDs.

VERIFIED: the same resolver rejects paid search modules and full audits when `canUsePaidSearchData` is false. HTML page checks and HTML-only Audit lite requests always freeze `maxProviderCalls: 0`. `project-seo-operations.service.ts` returns an authorized committed request replay before resolving a new executor. `project-seo-monitor.service.ts` freezes the configured executor in each finite monitor plan. Configuration rotation cannot redirect a future Run to another Coworker.

VERIFIED: `project-seo-monitor.service.ts:53` refuses monitor creation when `canSchedule` is false. The same policy gates new planned Run release before any analysis Task is written. `availableActions.canCreateMonitor` is false until the trusted usable executor has this scheduler assertion. Existing monitor pause/end controls remain available through Task Schedules. Configured true retains the existing finite daily/weekly monitor path.

VERIFIED: `seo-analysis-executor.postgres.test.ts` passed six real-database regressions, including exact context, paid capability, committed replay, frozen executor rotation and scheduler withdrawal. The first five failed on the old source. Removing each scheduler guard separately caused one retained regression failure. `seo-chat.postgres.test.ts` also rejected the old global-only history filter after executor removal. These local results do not prove hosted owner acceptance.

INFERRED: the configuration is an operator assertion, not remote proof. Verify the deployed worker's exact Core origin, Workspace, Task owner, billing organization, public mode and paid-data policy before enabling it. Keep isolated storage namespaces. Do not leave another worker polling that same Core context with the same Coworker identity.

VERIFIED: `agent/lib/sokosumi-worker-scope.ts` in the worker repository treats `taskIds: []` as deny-all. `releaseSeoMonitorRun` creates a fresh Task for every approved scheduled Run. INFERRED: a fixed one-Task allowlist cannot support future finite monitor Runs. Use an approved exact-context worker policy that permits those future IDs. Zero-provider deployments must keep Core paid-data availability false.

INFERRED: online automatic monitoring also needs an approved scheduler for both the exact Core and worker deployments. A Ready Preview or a manually invoked tick does not prove that scheduler. Vercel's [cron quickstart](https://vercel.com/docs/cron-jobs/quickstart) states: "Vercel invokes cron jobs only for production deployments and not for preview deployments". The existing Core schedule sync can release other due work, so inspect its scope before manually invoking it.
