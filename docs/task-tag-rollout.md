# Task tags: suggestions and historical backfill

PR #5266 combines minimal Compact cards, suggestions before task creation, and
automatic historical classification. Normal cards and task detail retain tags
and projects; Compact omits both, including placeholders and overflow.

## Spend and latency limits

The composer waits 1.2 seconds after editing and requires 40 meaningful content
characters. It deduplicates content changes and allows one request in flight.
Core requires a signed-in owner session and workspace access, with a distributed
five-second cooldown and rolling limits of six uncached requests per minute per
user, 60 per hour per user, and 300 per hour per workspace. Input is bounded to
300 title and 8,000 description characters; results contain at most five tags.
Cached results last 15 minutes and do not incur another evaluation. Redis failure
disables suggestions rather than bypassing the spending limits. Provider work
has a 12-second deadline; errors back off without blocking task creation.
Suggestions use a separate authenticated HTTP route, so an outstanding request
does not occupy Next.js's mutation queue. Punctuation/case-only edits retain
the displayed suggestions without another request; a receipt is reusable only
while its exact whitespace-normalized content still matches.

A signed receipt binds the verified result to the author, workspace, normalized
content, vocabulary and expiry. Creation validates it and applies automatic tags
and explicit corrections in the creation transaction. This includes successful
empty results. Invalid or expired receipts fall back to the normal worker;
client-supplied automatic classifications are never accepted. Manual additions
and rejections survive future automatic results. Retention and no-training
controls remain enforced; the existing non-EU authorization remains applicable.
When a receipt has not reached the browser, creation also attempts a short
server-side lookup of the same signed cache entry. This lookup does not invoke
the provider and falls back to the worker on cache failure or timeout.

## Historical work

The normal five-minute worker selects due queued work first, then uses remaining
capacity for oldest eligible nonarchived, unclassified tasks. The total remains
ten tasks per tick: at most 120 attempts per hour, less when queued work, retries
or the execution deadline consume capacity. Each unchanged revision has at most
two attempts. Complete results, including empty classifications, and terminal
failures are excluded. Existing state, revision and lease fields provide durable
resume and race protection without a mass enqueue or schema migration.

The `task_tag_classification_batch` log records queued/historical selections,
attempted/completed/failed/stale/deferred counts, remaining eligible history,
validated token usage, reported cost and the count with unreported cost.
Per-evaluation logs distinguish historical and queued sources. Suggestion logs
record validated usage and cost without authored content. Throughput is an upper
bound, not a completion-time promise; estimate cost from actual reported usage
and report missing cost separately.

## Coordinator rollout

This change is delivered as a draft PR with synthetic preprod verification.
No production backfill script or manual production deployment is part of it.
After review and merge, verify the production Core commit and enabled scheduled
worker, then inspect natural cron logs for historical completions and declining
remaining history. Check failures and unreported costs before estimating total
cost or completion. Do not claim older production tasks were processed until
those production observations exist. Disabling the existing classification flag
stops provider work; restoring it resumes from durable state.

For isolated preview verification, the existing cron-authenticated fixture route
accepts an exact synthetic Draft owner/task scope. `fixtureBackfill=true` can
prepare only an untouched initial pending revision with zero attempts and no
automatic tags. It cannot reset completed, edited or attempted tasks. The
fixture override is preview-only; production rejects it. Never invoke an
unscoped queue for browser verification.
