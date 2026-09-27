# Task tag suggestions and historical backfill implementation plan

> Implement with the existing parallel-agent workflow. User explicitly authorized this extension on PR #5266 after Compact verification. Coordinator reviews and merges; agents do not deploy production.

## Goal and acceptance

Preserve Compact's hidden tags/projects. Give older unclassified tasks bounded automatic classification, and show inexpensive Jev suggestions while composing before creation. Suggestions and provider failures never block creation. Preserve manual/rejected choices, workspace boundaries, current revision/lease guards, zero-data-retention and no-training. No new dependency or schema migration unless a demonstrated invariant requires one.

## Existing seams and design

Reuse `task-tag-classification.service.ts` and its state/attempt/revision/lease fields for backfill. Reuse `task-tag-classifier.ts` for provider/privacy validation. Reuse Redis for a distributed suggestion budget and content cache, Core's typed route/auth/workspace conventions, and TaskForm for both ordinary and related creation. Existing persisted TaskTagEditor mutates a task and is not suitable before creation; reuse its vocabulary and primitive controls without calling its mutation.

Classification suggestions concern the user's authored name/description. Server receipt binds their normalized complete input, vocabulary version, user, workspace and expiry. Generated fallback task titles and server-prepended context links are derived metadata; creation verifies the original authored input and applies a validated receipt to the just-created current revision inside the existing transaction. No client-supplied automatic tag IDs are trusted. Explicit manual additions/removals remain separate corrections. Later content edits invalidate through the existing trigger.

## Tasks

- [x] Backfill: query due pending/running first (existing cap10), fill spare slots with oldest nonarchived unclassified tasks. Existing compare-and-set claim includes selected state, revision, workspace, attempts and lease. Complete including empty and terminal failed states never re-enter historical selection. Keep exact preview fixture scope bounded; permit an exact unclassified synthetic fixture to exercise the same historical path. Log source, selected/completed/failed/stale counts, usage/cost and aggregate remaining historical count without content. Add cap, priority, resume, empty-result, failures, archive/tenant/revision and fixture-scope regressions.
- [x] Core suggestions: owner-session-only POST `/v1/tasks/tag-suggestions`; assigned-seat/workspace authorization before provider work. Request `{name?: string, description?: string|null}` bounded300/8000 chars, minimum40 meaningful content characters. Response `{tags: TaskTagId[], receipt: string}`; unavailable/throttled responses expose retry timing without provider internals. Reuse Jev client and privacy guards; timeout12s. Redis cache15min keyed by owner/workspace/normalized input/version; fail closed on Redis failure. Distributed budgets: cooldown5s, at most6 uncached evaluations/minute/user,60/hour/user,300/hour/workspace. Cache/in-flight dedup prevents repeated spend. Signed receipt15min, domain-separated HMAC using existing server secret, validates schema/signature/version/expiry/owner/workspace/input. Creation accepts `tagSuggestionReceipt` plus `tagCorrections: {add,remove}` and atomically applies trusted tags plus corrections after insert, before commit, so the worker cannot pay again. Invalid/missing/expired receipt falls back to normal pending classification; corrections still apply. Add authorization, budget/race, receipt tamper/expiry/cross-tenant/input, valid-empty reuse, creation-provider-failure and corrections tests.
- [x] Web composer: hook with1200ms debounce, minimum content, normalized word-content dedup,5s minimum interval, bounded input, one in-flight request, generation invalidation on every input/workspace change and unmount; ignore stale results. Backoff after429/provider error; do not repeatedly auto-retry the same failed content. Show suggestions beneath editor with editable/removable tags and translated accessible states. Keep manual/rejected choices independent from refreshed automatic suggestions; no surprise overwrite. Never include suggestion loading/failure in save-disabled state. Forward receipt/corrections through ordinary and related create paths using an authenticated background HTTP route, creation actions, services and generated Core DTO. Add fake-timer stale/edit/pause/dedup/backoff and create-pending/failure/correction tests.
- [ ] Integration: regenerate Core snapshot/client (never hand edit), run focused suites and root check/typecheck, independent review. Keep no local app builds/services. Commit with normal hooks; push same draft PR and `/deploy preprod` after each push.
- [ ] Real preprod verification: designated fixture account, synthetic-only typing/pause edits and saves; capture requests, timings, server usage/cost, stale suppression, correction persistence, no second worker evaluation after safe reuse. Exercise bounded historical fixtures and rerun idempotency under the same worker; never run a global production queue. Preserve separate Compact screenshots and rerun relevant Compact check on final deployment.

## Review focus

1. A draft response completing after an edit/workspace switch must never apply or be submitted.
2. An empty successful result must remain complete and not incur duplicate inference on save/backfill.
3. A forged or cross-tenant receipt must never write automatic tags; manual corrections are validated independently.
4. Redis/provider outage must stop suggestion spend while task creation continues normally.
5. Background historical processing must not starve new/edited tasks or repeatedly revisit terminal failures.

## Throughput and rollout

Backfill ceiling120 attempts/hour at10 tasks per five-minute tick, less when foreground queue consumes capacity or retries occur. Existing two-attempt limit remains. New behavior begins only after coordinator-approved production merge/deployment; this task does not claim production historical processing. Document observed preview costs and progress, not assumed production counts.
