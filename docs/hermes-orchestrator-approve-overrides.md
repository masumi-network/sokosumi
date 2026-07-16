# Hermes Orchestrator approve overrides

## Why

`POST /v1/instances/:userId/confirmations/:id/approve` can approve a queued
Hermes tool call exactly as proposed, or approve it with an organization
override. This lets the Sokosumi UI answer "yes, but file this in this
workspace" without rejecting the confirmation and asking Hermes to propose the
same action again.

The orchestrator contract is final as of commit `ca3a8e9`. Sokosumi Core and
Web use this as the shared approve-time contract for `sokosumi_create_task` and
`sokosumi_create_job`.

## Contract

**Endpoint:** `POST /v1/instances/:userId/confirmations/:id/approve`

**Request body with an organization override:**

```json
{
  "overrides": {
    "organizationId": "11111111-2222-3333-4444-555555555555"
  }
}
```

**Request body with explicit personal scope:**

```json
{
  "overrides": {
    "organizationId": null
  }
}
```

- `overrides` is optional. Omit it, send no JSON body, or send `{}` to keep
  Hermes' original queued args.
- `overrides.organizationId` is optional. When present, it is authoritative for
  the queued tool args before execution.
- A string `organizationId` files the task or job in that organization. The id
  can be a UUID or cuid, up to 64 characters, using alphanumeric characters,
  `_`, and `-`.
- Literal JSON `null` means personal scope. The orchestrator creates the task
  without `X-Context-Organization-Id`, so it lands in the user's private
  board. (Legacy `X-Delegation-Organization-Id` is still accepted at runtime
  when context headers are absent.)
- Unknown fields under `overrides` should be ignored for forward
  compatibility.

**Response:** unchanged. Same `{ status, result?, error? }` envelope.

## Substitution rules

| Tool                   | Field to substitute          | When override absent         |
| ---------------------- | ---------------------------- | ---------------------------- |
| `sokosumi_create_task` | `organization_id` in args    | Use whatever Hermes proposed |
| `sokosumi_create_job`  | `organization_id` in args    | Use whatever Hermes proposed |
| Any other tool         | n/a - ignore the override    | Run unchanged                |

For `sokosumi_create_task` and `sokosumi_create_job`:

- If the queued args already have `organization_id` and an override string is
  provided, replace it.
- If the override is `null`, delete the key or set it to `null` per the
  Sokosumi API contract. Core accepts both.
- Personal scope is verified for `sokosumi_create_task` today.
- `sokosumi_create_job` accepts the same override shape at the route layer.
  The Sokosumi UI exposes Personal for jobs the same way it does for tasks; QA
  should monitor the newer dispatcher path.
- Other tools should never receive this override. If a client sends one, log it
  and ignore it rather than erroring.

## Personal-scope coworker authorization

For personal-scope task creation, the coworker must be whitelisted in personal
scope. If it is not, the orchestrator returns an error with that exact message
so the UI can surface it. Sokosumi Web displays `status === "errored"` response
messages directly in the confirmation toast.

## Authorization

Core performs a defense-in-depth membership check before forwarding a string
organization override to the orchestrator. Reference:
`apps/core/src/routes/v1/hermes/index.ts` -> `approveConfirmationRoute`, which
uses `prisma.member.findFirst`.

The orchestrator also validates the string `organizationId` against the user's
organization memberships. Literal `null` skips membership lookup because it is
personal scope.

## Sokosumi Web behavior

- The confirmation card shows the same organization picker for
  `sokosumi_create_task` and `sokosumi_create_job`.
- The picker defaults to Personal, not the active organization.
- Approving an org-aware confirmation always sends an explicit override:
  `{ "organizationId": null }` for Personal or `{ "organizationId": "<id>" }`
  for a selected organization.
- Overrides are omitted only when the tool is not org-aware and no picker is
  shown.

## Backwards compatibility

This is a strictly additive change. Existing callers that post with no body
must keep working unchanged.

1. If `Content-Type` is missing or not `application/json`, keep current no-body
   behavior.
2. If body is `{}` or `{"overrides": {}}`, treat it as no override.
3. If body contains `overrides.organizationId`, apply the rules above.

## Edge cases worth getting right

- **Confirmation already resolved:** unchanged. Override does not change the
  `already_resolved` path.
- **Tool is not org-aware:** silently drop the override and run the tool with
  its original args.
- **Malformed org id:** return a descriptive 400 from the orchestrator. The id
  must be UUID or cuid shaped, up to 64 characters, with alphanumeric
  characters, `_`, and `-`.
- **Telemetry:** log the applied override with org id, tool name, and
  confirmation id so workspace-placement reports are auditable.

## Quick test recipe

```bash
# Organization override for a task or job confirmation.
curl -X POST https://orchestrator-production-35d4.up.railway.app/v1/instances/<USER_ID>/confirmations/<CONF_ID>/approve \
  -H "Authorization: Bearer $HERMES_ORCH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"overrides":{"organizationId":"<ORG_ID>"}}'

# Personal scope for a task or job confirmation.
curl -X POST https://orchestrator-production-35d4.up.railway.app/v1/instances/<USER_ID>/confirmations/<CONF_ID>/approve \
  -H "Authorization: Bearer $HERMES_ORCH_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"overrides":{"organizationId":null}}'

# Keep Hermes' original queued args.
curl -X POST https://orchestrator-production-35d4.up.railway.app/v1/instances/<USER_ID>/confirmations/<CONF_ID>/approve \
  -H "Authorization: Bearer $HERMES_ORCH_TOKEN"
```

For local Web QA, use `?state=running&mock=confirmation` for the default task
card or `?state=running&mock=confirmation&toolName=sokosumi_create_job` for the
job confirmation card. Both should show the same Personal default and
organization override picker.

## PR / deploy checklist

1. **Migration first:** run
   `20260525120000_add_hermes_pending_connection` in every environment before
   deploying Core/Web changes that use Composio initiate/finalize.
2. **Orchestrator:** verify the deployed orchestrator includes commit
   `ca3a8e9` or newer before relying on approve-time placement.
3. **Manual QA:** verify task and job confirmations with an organization
   selected, with explicit personal scope, and with omitted overrides.
4. **Personal coworker error:** verify a personal-scope task for a coworker not
   whitelisted in personal scope surfaces the orchestrator error text in the UI.
5. **Finalize:** keep the current 60 second finalize poll budget on the hosted
   Vercel runtime; see the timeout note below before changing Vercel runtime or
   plan settings.

## Finalize timeout budget

Core is a Hono Node service (`apps/core/src/index.ts`) deployed with Vercel
project config in `apps/core/vercel.json`. The bundled entry `dist/index.js`
sets `functions.maxDuration` to **120 seconds** so a single finalize request
can run the full Composio poll loop (40 * 1.5s = about 60s of sleep budget,
plus status checks and orchestrator registration) without the platform
terminating the invocation early.

If finalize polling constants change, keep `maxDuration` above the poll sleep
budget plus about 30s headroom for Composio and orchestrator calls. Sync cron
routes that use `waitUntil()` also rely on this ceiling (default
`LOCK_TIMEOUT` is 120s in `apps/core/.env.example`).

## Sokosumi-side references

- Schema: `apps/core/src/schemas/hermes.schema.ts` ->
  `hermesApproveConfirmationRequestSchema`.
- Client wrapper: `apps/core/src/clients/hermes-orchestrator.client.ts` ->
  `approveConfirmation(userId, confirmationId, overrides?)`.
- Membership check and forwarding:
  `apps/core/src/routes/v1/hermes/index.ts` -> `approveConfirmationRoute`.
- UI dropdown:
  `apps/web/src/app/(app)/hermes/components/running-state.tsx` ->
  `ConfirmationCard`, using `isConfirmationOrgAwareTool`.
- Picker helpers:
  `apps/web/src/app/(app)/hermes/components/confirmation-org-picker.ts`.
