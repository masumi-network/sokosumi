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

`TASK_TAG_CLASSIFICATION_ENABLED=false` is the default. The cron-authenticated
`/sync/task-tags` endpoint reuses the existing sync lock/deadline, handles at most
10 tasks serially, and permits at most two attempts per content revision. Leases,
revision/workspace checks, and compare-and-set writes discard obsolete results.
Human corrections are never overwritten by the worker.

Jev uses Gateway `/v1/evaluate`, model `typesafe-ai/jev`, ten boolean questions,
a 300-character title and 8,000-character description ceiling, and a 12-second
request timeout. Answers require known IDs, finite probabilities, and confidence
at least 0.85. At most five tags appear, prioritizing manual choices. Logs contain
model, task/workspace IDs, revision, outcome, usage, Gateway cost and generation ID
when returned; they never include task text or raw provider errors.

Before any content is sent, live capability discovery must advertise EU and ZDR.
Every evaluation also explicitly requires EU inference, zero retention, and no
prompt training. There is no global-region fallback. As of 2026-09-26 Jev's
Gateway catalog has no EU regions and advertises no ZDR. Production enablement is
blocked even if the feature flag is set. Endpoint-specific routing evidence takes
precedence over generic provider retention claims. Gateway control-plane residency
must also satisfy organizational policy before enablement. No live inference was
performed during this implementation.

## Bounded existing-task backfill design (not executed)

Backfill is a separate, explicitly approved operational action, not migration or
read behavior. A future operator command must default to dry-run and require one
workspace ID, a maximum of 100 eligible tasks, an explicit USD budget, and a saved
cursor. It first verifies current endpoint residency/retention and credentials.
Select only unarchived `unclassified` tasks for that workspace in `(createdAt,id)`
order, at most ten at a time. Transactionally compare revision and state before
setting `pending`; never reset completed/failed work, attempts, manual choices,
rejections, or a newer revision. Persist the last processed cursor and counts in
the operation record so rerunning cannot enqueue the same task twice.

Drain each batch through the normal bounded worker before admitting another.
Use the live catalog input rate and a conservative bound for truncated input plus
question overhead to reserve both attempts before enqueue. At the observed
$0.042/million input tokens, 20,000 tokens per attempt reserves $0.00168/task;
this is a budgeting example, not a billing guarantee. Reconcile Gateway costs,
stop on missing costs, rate changes, exhausted budget/count, policy denial, or
provider failure, and require review before resuming. A queued batch can be
stopped by disabling the flag; no bulk provider requests or automatic full-table
scan is part of this feature. No production backfill has been run.

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
