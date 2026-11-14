# SEO workspace implementation

REPORTED: the owner approved the page-centered SEO workspace on 2026-11-05 and allowed agent changes.

## Outcome

INFERRED implementation contract: Marketing -> SEO uses the existing Project selector. Overview, Keywords, Competitors, Pages and Actions share an explicit page or related-page scope. Measurements retain source, period, device, Market, coverage and freshness. The same Core operations serve Web and authorized native Soko Bot tools.

## Work graph

1. Typed Core persistence, public Report import and permissions.
2. Shared operations, focused public Analyses and native statistics.
3. Human views, mixed timeline and evidence-linked work.
4. Focused monitoring, regression checks, integration review and local browser proof.

## Reuse and boundaries

VERIFIED local baseline: Sokosumi main d61aeb4842929faadb35225a6792e517465e0794. The checkout excludes the earlier undeployed Google-consent proposal. Worker baseline fcb9b9de contains the reviewed public worker source and release receipts.

INFERRED: reuse existing Project authorization, Tasks, Files, table/chart primitives, Core client generation, native connections and result references. New persistence records only SEO page scopes, immutable observations, curated choices and bounded requests. Do not add an event bus or an editable copy of historical audit facts.

INFERRED: public audit imports bind source Task, Workspace, assigned Coworker, ready JSON file and artifact hash. No arbitrary report URL or Markdown-derived facts. Reject private Google/outcome references before indexing public observations. Repeat imports remain idempotent.

INFERRED: Google page views/users require native statistics queries. Keep those observations owner-scoped. The public Coworker receives public URLs, selected Analyses, Market, keywords, devices and limits only. No Google credentials or private statistics enter its Task or Report.

INFERRED: explicit scope revisions freeze selected pages for a request and its timeline. Competitor pages remain separate from owned-page analytics. Group totals do not sum distinct users or referring domains blindly.

## Focused worker contract

INFERRED: retain legacy full Requests by default. Add explicit public Analyses `page.inspect`, `keyword.refresh`, and `links.refresh`. Audit Lite selects a bounded subset before execution. A focused Analysis Report has an explicit schema discriminator and checked/skipped/failed coverage. Core and worker implementers coordinate the exact Task envelope and JSON result contract before dispatch code is wired.

INFERRED: raw page inspection makes no model, browser, or paid search call unless its selected Analysis needs it. Paid read identities include Market, device and provider options. Core owns cross-request freshness and request deduplication. Reanalysis of stored evidence is distinct from a fresh read.

## Verification

INFERRED required checks: parser/private-input rejection; tenant, Project and analytics-owner isolation; duplicate imports and concurrent request claims; compatible observations and non-additive metrics; actual module selection and omitted AI Overview charges; UI loading/errors/empty states and actions; native tool contract parity; generated client; typecheck, lint and relevant integration suites.

INFERRED: use the completed public acceptance Report as an ingestion fixture. Run no additional paid audit or live Google query without a separate authorized allowance. Local disposable database migrations are verification only; no hosted migration or deployment belongs to implementation.

## Least confident decisions

1. INFERRED: native Composio tool schemas may differ by connected toolkit version. Validate actual tool metadata and fail closed when unsupported.
2. INFERRED: focused read prices and monitoring cadence need measurements. Enforce selected pages, keywords and call limits before dispatch.
3. INFERRED: local browser proof depends on the repo verification harness and an isolated reachable database.
