# Task tags

Core owns a versioned vocabulary of topic/work-type IDs in `helpers/task-tags.ts`.
Task status and project membership stay separate. Task descriptions remain complete
in the database, API, and detail view; only the card preview changes.

The additive migration defaults existing tasks to `unclassified`. A database
trigger enqueues new tasks and invalidates automatic results when title,
description, or workspace changes, including schedule/delegated writers. Human
choices and rejected IDs survive. Reads never enqueue inference. Owner-only tag
corrections serialize in a transaction and require the active workspace; archived
and grant-pending tasks use existing mutation restrictions.

## Classification and enablement

`TASK_TAG_CLASSIFICATION_ENABLED=true` is the default; set it to `false` to stop
automatic inference. A configured `AI_GATEWAY_API_KEY` is required. The cron-authenticated
`/sync/task-tags` endpoint reuses the existing sync lock/deadline, handles at most
50 queued and 200 historical tasks serially per tick, and permits at most two
attempts per content revision. Leases, revision/workspace checks, and
compare-and-set writes discard obsolete results.
Human corrections are never overwritten by the worker.

Jev uses Gateway `/v1/evaluate`, model `typesafe-ai/jev`, ten boolean questions,
a 300-character title and 8,000-character description ceiling, and a 12-second
request timeout. Answers require known IDs, finite probabilities, and confidence
at least 0.85. At most five tags appear, prioritizing manual choices. Logs contain
model, task/workspace IDs, revision, outcome, usage, Gateway cost and generation ID
when returned; they never include task text or raw provider errors.

Non-EU routing is authorized for this classifier. Other features' residency
settings are unchanged. Every evaluation still sets `zeroDataRetention: true`
and `disallowPromptTraining: true`; policy rejection never retries with weaker
options. Discovery verifies that Jev is listed, while Gateway enforces privacy
per request. The public catalog's aggregate flags are not a reliable route gate:
on 2026-09-26 it reported `zdr: "none"`, but an authenticated synthetic evaluation
with both privacy options returned HTTP 200. Gateway skipped DigitalOcean as
`zdr_ineligible_model` and used `typesafe-ai`. The synthetic software task returned
`development` at probability 0.94; the reported cost was $0.000034608 (824 input,
164 output tokens). This proves live provider operation, not production rollout.
See [evaluation options](https://vercel.com/docs/ai-gateway/modalities/evaluation)
and [ZDR enforcement](https://vercel.com/docs/ai-gateway/security-and-compliance/zdr).

Deployment needs the task-tag migration, Core Gateway credentials with account
access to the compliant route, and the existing authenticated `/sync/task-tags`
cron (every five minutes). Creation and title/description edits enqueue work via
the database trigger. Enabling also drains tasks already `pending` from earlier
creates/edits while disabled. Spare tick capacity classifies existing
`unclassified` history; see below.

Vercel preview deployments do not run production crons, so preview verification
must invoke the authenticated sync route explicitly. For fixture-only verification,
`/sync/task-tags?fixtureTaskId=<uuid>&fixtureOwnerId=<owner>` requires the same
cron authentication and is accepted only with `VERCEL_ENV=preview`. Both IDs are
required; malformed or unknown parameters never fall through to the global
queue. Selection and persistence are constrained to that owner’s one unarchived
Draft task whose name starts with `SYNTHETIC `. This does not enqueue old tasks,
change retries, or bypass revision/lease guards. Use only synthetic test-owned
fixtures and a branch-specific preview credential. Missing configuration,
unavailable discovery, or privacy-compatible routing failure leaves creation and
manual corrections independent of classification.

## Historical classification

The same `/sync/task-tags` worker classifies existing unclassified tasks. It
selects due queued work first (at most 50), then oldest eligible nonarchived
unclassified tasks (at most 200). Every queued row is evaluated before any
history, so a large historical batch cannot delay an interactive create, edit, or
retry. There is no mass enqueue, operator dry-run, or separate backfill command.
Existing state, revision, and lease fields provide durable resume and race
protection. Complete results, including empty classifications, and terminal
failures are excluded. Each unchanged revision still has at most two attempts.

Historical throughput is at most 2,400 attempts per hour per target, less when
queued work, retries, or stop conditions consume capacity. Raising the historical
rate does not raise total spend: the backlog is a fixed, finite set of rows. At
the measured ~$0.0000373 per task the whole backlog observed on 2026-09-27 costs
about $0.71 on mainnet (19,006 rows) and $0.23 on preprod (6,105), whether it
takes days or hours. The rate of spend does rise with the rate of work.

Three guards bound one tick, each observable as `stopReason` in the batch log:
the existing sync deadline (`LOCK_TIMEOUT - LOCK_TIMEOUT_BUFFER`, 275 seconds on
the defaults production runs on), a 120-second claim budget, and a $0.05
reported-cost ceiling. Disabling `TASK_TAG_CLASSIFICATION_ENABLED` stops provider
work; restoring it resumes from durable state.

Do not claim older production tasks were processed until production cron logs
show historical completions and declining remaining history. Check failures and
unreported costs before estimating total cost or completion.

## Compatibility and rollback

The optional API tags object is additive for existing consumers. Keep stable IDs
when extending the vocabulary and increment its version deliberately. Files
planning can later reuse topic IDs without coupling file lifecycle or routing to
this queue. This work adds no Files or Soko Bot behavior.

Operational rollback first disables the flag and cron. Old applications tolerate
the additive columns/trigger; retain them to preserve human corrections. A later
explicit destructive rollback may drop the trigger/function/index and columns
only after exporting corrections and confirming no deployed consumer uses them.
Do not reverse migration data silently.
