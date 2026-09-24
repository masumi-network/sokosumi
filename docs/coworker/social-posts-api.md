# Coworker Social post scheduling

Coworkers with the `tasks` capability can draft, read, edit, schedule, reschedule, and cancel Social posts through an account a human has already connected to the Project. Scheduling publishes automatically through the existing publisher; it does not require a separate per-post approval.

Authenticate with a Coworker API key and `X-Context-User-Id` plus `X-Context-Organization-Id` for an organization workspace. The contextual user must belong to that workspace and retain Calendar beta eligibility. Core applies the same delegated-user binding used for scheduled Tasks: a granted vendor workspace grant or a baseline assigned/same-vendor task relationship. Denied/revoked grants reject access. Bare Coworker keys, human API keys, OAuth tokens, Soko Bot, and orchestrator actors do not gain this access.

1. List the Project's connected accounts using `GET /v1/projects/{id}/social-connections`; choose an active connection.
2. Create a draft using `POST /v1/projects/{id}/social-posts` with `text` and `socialConnectionId`. The existing validated Drive `media` field is also supported.
3. Schedule through `POST /v1/projects/{id}/social-posts/{postId}/schedule` with `revision`, `scheduledAt` (more than one minute in the future), and optionally `timezone`. Alternatively provide `scheduledAt` during creation.
4. Read the latest post revision before editing, rescheduling, or canceling. The same workspace/project boundaries and revision conflicts apply as in the human UI.

Core records the Coworker as creator independently of the contextual human. `scheduledByUserId` is the human on whose behalf scheduling occurred; `scheduledByCoworkerId` identifies the delegating Coworker. Editing scheduled content also updates scheduler attribution. Human rescheduling, editing scheduled content, or Publish now takes over scheduling responsibility.

Before a delayed provider call, Core rechecks that the contextual user is active, Coworker capability, delegated-user access, beta eligibility, and current workspace membership. Revoked access fails the post without contacting X. Lease recovery of an already confirmed publication remains idempotent. A human can reschedule or publish a failed post explicitly.

Connecting, reconnecting, replacing, disconnecting accounts, OAuth completion, and Publish now/Retry remain interactive-human actions. Coworker post responses set `canPublishNow` to false. Calendar's Social feed remains interactive-human-only in this layer.

## Deployment

Apply the additive nullable scheduler migration before deploying Core. Existing human schedules remain valid. Before rolling Core back to a version without delegated-publish checks, pause the Social publisher while any Coworker-attributed schedules remain pending.
