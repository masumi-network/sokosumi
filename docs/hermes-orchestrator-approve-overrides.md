# Hermes Orchestrator — accept `overrides` on the approve endpoint

## Why

Today `POST /v1/instances/:userId/confirmations/:id/approve` takes no body —
the queued tool call runs with the exact args Hermes proposed. When Hermes
queues a `sokosumi_create_task` (or `sokosumi_create_job`) the user has no
way to say "yes, but create it in *this* org instead of the one Hermes
picked." Today's UX is reject-with-reason-and-hope-Hermes-re-proposes,
which is slow and brittle.

We want to surface an inline org dropdown in the confirmation card on the
Sokosumi web side. The dropdown is pre-selected to the user's active
organization. On approve we POST the chosen org id; the orchestrator
substitutes it into the queued tool args before executing.

The Sokosumi side is already shipped — Core forwards `overrides` verbatim
to the orchestrator and the UI is live behind preview mode. The
orchestrator just needs to start reading the field.

## Contract

**Endpoint:** `POST /v1/instances/:userId/confirmations/:id/approve`

**Request body (new — currently silently ignored):**

```json
{
  "overrides": {
    "organizationId": "11111111-2222-3333-4444-555555555555"
  }
}
```

- `overrides` — optional object. Absent / empty body means "use Hermes'
  original args" (current behavior — must keep working).
- `overrides.organizationId` — optional. When present, treat as the
  authoritative `organizationId` for the queued tool args before running
  the tool. Two value shapes:
  - **String UUID** — substitute this org into the args.
  - **`null`** — explicitly personal scope (no org). Strip / null out
    `organizationId` in the args. Distinct from "field omitted."
- Forward-compatible: ignore unknown fields under `overrides`. We expect
  to add more keys (e.g. `coworkerId`) later without bumping the route.

**Response:** unchanged. Same `{ status, result?, error? }` envelope.

## Substitution rules

| Tool                       | Field to substitute        | When override absent             |
| -------------------------- | -------------------------- | -------------------------------- |
| `sokosumi_create_task`     | `organization_id` in args  | Use whatever Hermes proposed     |
| `sokosumi_create_job`      | `organization_id` in args  | Use whatever Hermes proposed     |
| Any other tool             | n/a — ignore the override  | Run unchanged                    |

For `sokosumi_create_task` / `sokosumi_create_job`:

- If the queued args already have `organization_id` and an override is
  provided, **replace** it.
- If the override is `null`, **delete** the key (or set to `null` per the
  Sokosumi API contract — both are accepted by Core today).
- Other tools should never receive this override; if a client sends one,
  log it and ignore it (don't error).

## Authorization

**Core has already verified membership** before forwarding to the
orchestrator — the orchestrator should trust the override as-is. If
that assumption ever changes, add a defense-in-depth check, but the
authoritative gate stays in Core because that's where the Prisma session
+ memberships live. Reference: `apps/core/src/routes/v1/hermes/index.ts`
in the Sokosumi monorepo — search for `memberFindFirst` in the
`approveConfirmation` handler.

## Backwards compatibility

This is a **strictly additive** change. All existing callers POST with
no body and must keep working unchanged. The orchestrator should:

1. If `Content-Type` is missing or not `application/json` — keep current
   no-body behavior.
2. If body is `{}` or `{"overrides": {}}` — treat as no override.
3. If body contains an `overrides.organizationId` value — apply per the
   rules above.

## Edge cases worth getting right

- **Confirmation already resolved:** unchanged. Override doesn't change
  the "already_resolved" path.
- **Tool isn't org-aware:** silently drop the override, run the tool
  with its original args. Don't error — the UI may not always know
  which tools are org-aware.
- **Org id is malformed (not a UUID):** return a 400 with a descriptive
  message. Don't let it reach the Sokosumi API.
- **Telemetry:** log the override that was applied (org id, tool name,
  confirmation id) at info level so we can audit if a user complains
  "Hermes created the task in the wrong workspace."

## Quick test recipe once shipped

```bash
# 1. Trigger a confirmation by asking Hermes to create a task in chat.
# 2. From a shell with the test user's bearer token:
curl -X POST https://orchestrator-production-35d4.up.railway.app/v1/instances/<USER_ID>/confirmations/<CONF_ID>/approve \
  -H "Authorization: Bearer $HERMES_ORCH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"overrides":{"organizationId":"<ORG_UUID>"}}'
# 3. Verify the resulting Sokosumi task is filed under <ORG_UUID>, not
#    whatever Hermes originally proposed.
```

## PR / deploy checklist

1. **Migration first:** run
   `20260525120000_add_hermes_pending_connection` in every environment before
   deploying Core/Web changes that use Composio initiate/finalize.
2. **Orchestrator:** deploy the orchestrator change that reads
   `overrides.organizationId` before relying on the UI dropdown for production
   task/job placement. The expected contract is described above in this doc.
3. **Manual QA:** verify Composio OAuth initiate → finalize on a cold Core
   instance, confirmation chips, approval with an organization selected, and
   approval with explicit personal scope.
4. **i18n:** spot-check at least one non-English locale confirmation card after
   message sync.
5. **Finalize:** keep the current 60 second finalize poll budget on the hosted
   Vercel runtime; see the timeout note below before changing Vercel runtime or
   plan settings.

## Finalize timeout budget

Core is a Hono Node service (`apps/core/src/index.ts`) deployed with Vercel
project config in `apps/core/vercel.json`. There is currently no
`functions.maxDuration` override in that config, so hosted duration follows the
project's Vercel defaults.

Vercel's current Fluid Compute default for Node.js functions is 300 seconds
(5 minutes), with a 300 second maximum on Hobby and 800 seconds on Pro /
Enterprise. The Hermes finalize loop is 40 attempts at 1.5 seconds, roughly
60 seconds before returning `composio_finalize_not_active`, which is safely
inside that hosted default.

Recommendation: keep the 60 second finalize poll budget. If this project is
ever moved to a legacy non-Fluid Vercel runtime, add an explicit
`functions.maxDuration` override or reduce the poll count to avoid a platform
504 (`FUNCTION_INVOCATION_TIMEOUT`) before Core can return the retryable
Composio response.

## Sokosumi-side references (for context, no changes needed)

- Schema: `apps/core/src/schemas/hermes.schema.ts` →
  `hermesApproveConfirmationRequestSchema`.
- Client wrapper: `apps/core/src/clients/hermes-orchestrator.client.ts` →
  `approveConfirmation(userId, confirmationId, overrides?)`.
- Membership check + forwarding: `apps/core/src/routes/v1/hermes/index.ts`
  → `app.openapi(approveConfirmationRoute, …)`.
- UI dropdown: `apps/web/src/app/(app)/hermes/components/running-state.tsx`
  → `ConfirmationCard` (gated on `ORG_AWARE_TOOLS`).
