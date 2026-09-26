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

Automatic Jev classification remains disabled by default. Creation and changes
to task titles/descriptions schedule classification; existing tasks are not
automatically backfilled. EU routing and zero-data-retention checks remain
fail-closed. This follow-up does not change those controls or run inference.

The draft PR starts with this document because the PR-open workflow deploys both
networks when application paths change. The UI commit follows PR creation and
is deployed only through an explicit `/deploy preprod` comment.
