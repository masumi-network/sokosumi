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
state, cron activity, throughput, and failures. Production investigation verified
the deployed revision and successful scheduled Jev evaluations; the previous
worker intentionally excluded untouched historical tasks. The user subsequently
authorized automatic bounded backfill and composer suggestions in this same PR.
Implement and test those behaviors on preprod before coordinator review; do not
manually run production queue work or deploy production.

The original implementation disabled automatic Jev classification by default
because its catalog did not advertise EU routing or zero-data-retention support.
Patrick subsequently authorized non-EU classification in input
`01a0e003-b9e2-738a-a7be-9a5a25acd65d`. A synthetic live evaluation succeeded
through TypeSafe AI with both zero-data-retention and no-training controls
intact. Gateway skipped the ineligible DigitalOcean endpoint automatically.
PR #5262 enabled create/title-description-edit classification by default,
removed the EU pin, and retained those request-level privacy controls. Existing
untouched tasks were not automatically backfilled. This PR fills unused worker
capacity with those tasks, while prioritizing queued creates and edits. See
[task tag rollout](task-tag-rollout.md) for limits and rollout verification.

The draft PR starts with this document because the PR-open workflow deploys both
networks when application paths change. The UI commit follows PR creation and
is deployed only through an explicit `/deploy preprod` comment.

## Task detail Files

Long file lists initially show three whole cards. The centered, localized
Expand/Show less button matches the description control, exposes every supplied
file when expanded, and uses native keyboard behavior with `aria-expanded` and
`aria-controls`. Short and empty lists have no toggle. Hidden cards are unmounted
so their links cannot receive focus. Expansion survives same-task data refresh
and resets when task identity changes.

Authenticated detail and shared detail both use this component. Their current
Core includes return the complete files relation, newest first, without a cursor
or page limit. Existing readiness, preview/download components and permissions
remain unchanged. The application has a task edit modal over full detail, but
no separate task detail modal; verify that overlay preserves underlying state.
