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
attempts per content revision. Leases,
revision/workspace checks, and compare-and-set writes discard obsolete results.
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
creates/edits while disabled; untouched `unclassified` tasks remain untouched.
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
manual corrections independent of classification. No production deployment or
backfill is part of this change.

## Bounded existing-task backfill design (not executed)

Backfill is a separate, explicitly approved operational action, not migration or
read behavior. A future operator command must default to dry-run and require one
workspace ID, a maximum of 100 eligible tasks, an explicit USD budget, and a saved
cursor. It first verifies current routing/retention requirements and credentials.
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
