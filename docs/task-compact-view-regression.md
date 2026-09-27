# Task board Compact regression

Follow-up to #5258 for task 01a0df97. Display → Compact is the affected control.

Replacing description previews with tags removed the board card's only density
distinction for untagged tasks. The previous card hid its description in Compact;
the replacement only reduces visible tags from two to one. List rows still hide
their descriptions. Board cards, drag overlays, and server-rendered fallback all
receive the same persisted density preference.

Restore a visibly denser card while keeping tags, project navigation, status,
privacy, scheduling, metadata, and existing drag and keyboard interactions.
Verify the actual Display toggle and reload persistence in a preprod preview,
including tagged/untagged cards, missing/long projects, and desktop/mobile themes.

The original implementation disabled automatic Jev classification by default
because its catalog did not advertise EU routing or zero-data-retention support.
Patrick subsequently authorized non-EU classification in input
`01a0e003-b9e2-738a-a7be-9a5a25acd65d`. A synthetic live evaluation succeeded
through TypeSafe AI with both zero-data-retention and no-training controls
intact. Gateway skipped the ineligible DigitalOcean endpoint automatically.
This follow-up enables create/title-description-edit classification by default,
removes the EU pin, and retains those request-level privacy controls. Existing
untouched tasks are not automatically backfilled. Previously queued creates or
edits can be processed when classification is enabled.

The draft PR starts with this document because the PR-open workflow deploys both
networks when application paths change. The UI commit follows PR creation and
is deployed only through an explicit `/deploy preprod` comment.
