# Task board Compact regression

Follow-up to #5262 for task 01a0df97. Display → Compact is the affected control.

Compact board cards must omit tags and project metadata entirely, including
empty-tag placeholders, tag overflow controls, and the no-project placeholder.
Normal cards and task detail retain tags and projects. Keep the existing compact
spacing, status, privacy, scheduling, actor metadata, task opening, keyboard,
menus, and drag behavior. Audit board rendering, drag overlays, pre-hydration
fallback, and list density for consistency.

Add focused regression tests and verify the actual Display toggle and reload
persistence on a preprod preview with the designated fixture account. Capture
separate desktop/mobile and light/dark screenshots for Normal and Compact,
including tagged/untagged cards and missing/long projects.

Investigate absent production tags read-only: deployed Core revision, enabled
state, cron activity, throughput, and failures. Distinguish deployment mismatch
and queued work from the intentionally absent historical backfill. Recommend a
bounded backfill if needed; do not execute production queue work, backfill, or
environment changes.

The original implementation disabled automatic Jev classification by default
because its catalog did not advertise EU routing or zero-data-retention support.
Patrick subsequently authorized non-EU classification in input
`01a0e003-b9e2-738a-a7be-9a5a25acd65d`. A synthetic live evaluation succeeded
through TypeSafe AI with both zero-data-retention and no-training controls
intact. Gateway skipped the ineligible DigitalOcean endpoint automatically.
PR #5262 enabled create/title-description-edit classification by default,
removed the EU pin, and retained those request-level privacy controls. Existing
untouched tasks are not automatically backfilled. Previously queued creates or
edits can be processed when classification is enabled.

The draft PR starts with this document because the PR-open workflow deploys both
networks when application paths change. The UI commit follows PR creation and
is deployed only through an explicit `/deploy preprod` comment.
