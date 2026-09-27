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

The normal five-minute worker selects due queued work first, then oldest eligible
nonarchived, unclassified tasks. Queued and historical selection have separate
caps: at most 50 queued and at most 200 historical rows per tick. Every queued row
is evaluated before any history, so a large historical batch cannot delay an
interactive create, edit or retry. Each unchanged revision still has at most two
attempts. Complete results, including empty classifications, and terminal failures
are excluded. Existing state, revision and lease fields provide durable resume and
race protection without a mass enqueue or schema migration.

Historical throughput is at most 2,400 attempts per hour per target, less when
queued work, retries or any of the three stop conditions consume capacity. Raising
the historical rate does not raise total spend: the backlog is a fixed, finite set
of rows, so total cost is bounded by task count, not by how fast it is worked
through. At the measured ~$0.0000373 per task the whole backlog observed on
2026-09-27 costs about $0.71 on mainnet (19,006 rows) and $0.23 on preprod (6,105),
whether it takes days or hours.

Three guards bound one tick, and each is observable as `stopReason` in the batch
log. The existing sync deadline (`LOCK_TIMEOUT - LOCK_TIMEOUT_BUFFER`, 275 seconds
on the defaults production runs on, reserving 15 seconds for one in-flight
evaluation) remains the outer bound for all work. A tick additionally stops
claiming new work 120 seconds in. A tick that ran to the deadline would still
release its lock before the next cron fires 300 seconds after the last, but only by
about 25 seconds, and cron jitter, a slow release, or a function killed at
`vercel.json`'s 300-second `maxDuration` all eat that margin; a tick still holding
the lock makes the next one 409 and skips it. Ten rows could never reach the
deadline, 250 rows with a timing-out provider could, so the tick budget restores a
wide margin. At the measured per-task latency the 200-row cap is reached first, in
roughly 65-85 seconds. A per-tick reported-cost ceiling of $0.05 stops a
pathological run; it covers queued rows too, which spend it first because they are
evaluated first. The selection caps, not cost, are the primary bound, so a provider
that returns no billing metadata cannot make a tick unbounded.

Both selections read only the eight columns the worker uses, so a 250-row batch
does not load whole task rows, whose descriptions have no database length cap.

The `task_tag_classification_batch` log records queued/historical selections,
attempted/completed/failed/stale/deferred counts, any `stopReason`, remaining
eligible history, validated token usage, reported cost and the count with
unreported cost. Per-evaluation logs distinguish historical and queued sources, so
a full tick emits up to 250 evaluation events plus the batch event, against 11
before, and those events reach Sentry through the evlog drain. That is a one-time
cost: the backlog is finite and new tasks enqueue as `pending`, never
`unclassified`, so draining the 2026-09-27 backlog adds on the order of 25,000
events in total across both targets and historical volume returns to zero
afterwards. Per-task provider attribution for a bulk classification of customer
content is worth that. Suggestion logs record validated usage and cost without
authored content. Throughput is an upper bound, not a completion-time promise;
estimate cost from actual reported usage and report missing cost separately.

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
