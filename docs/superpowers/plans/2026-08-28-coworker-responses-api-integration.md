# Coworker Responses API integration plan

## Product goal

[DECISION] Bring an existing Responses API Coworker into Sokosumi as a private Coworker for one organization workspace.

[DECISION] Start with the `/developer/coworkers` flow. Expose the same Core contract through the monorepo CLI and MCP after the Core path is proven.

## Domain rules

[VERIFIED] A Coworker belongs to a Vendor. A Vendor has `admin` and `developer` members.

[DECISION] The first connection links an existing Vendor and organization workspace relationship. The initiating user must already be a Vendor admin. The flow does not create Vendors.

[DECISION] Vendor admins start first-time connections. This preserves `SOK-652`: admins manage all Coworkers; developers manage only Coworkers assigned to them.

[DECISION] Organization membership controls human workspace use. It does not transfer Vendor ownership.

[DECISION] The first connection is private and starts with `isWhitelisted=false`.

[VERIFIED] Human-side workspace use uses `CoworkerWorkspaceAccess`.

[VERIFIED] Vendor actor task access keeps existing `VendorGrant` behavior. The two access systems stay separate.

[DECISION] Public listing requires a separate submission and Sokosumi team approval.

## Credential rules

[DECISION] A human Sokosumi API key, OAuth token, or web session starts onboarding.

[DECISION] Core stores one provider API credential per Coworker in an encrypted record. The record has encryption key version, owner, created, rotated, and revoked timestamps. Rotation replaces ciphertext. Revocation disables outbound calls. Changing `baseURL` revokes the old credential until a new one is supplied. Plaintext is never returned after initial submission.

[DECISION] The provider credential is separate from the human Sokosumi credential and the Coworker runtime key.

[VERIFIED] Sokosumi mints a separate `coworker_*` key for the external runtime. The key is returned once, then can be rotated or revoked.

[PROPOSED] MCP never accepts the provider secret as a normal model argument. MCP starts a short-lived web handoff with the required API OAuth scope, one-time state, expiry, and user/client binding.

## Onboarding recovery

[DECISION] The connection transaction stores an idempotency record before returning its result.

[DECISION] An authenticated retry with the same idempotency key can recover a committed connection after a lost response.

[DECISION] Recovery revokes the original runtime key, mints one replacement, and returns the replacement once. The replacement is bound to the same onboarding result. Further retries do not mint more replacements.

[DECISION] The system never stores runtime-key plaintext for replay.

## Provider boundary

[DECISION] Hosted environments accept public HTTPS provider URLs only.

[DECISION] Core rejects loopback, link-local, private-network, and metadata-service destinations.

[DECISION] Core controls redirects and revalidates DNS and resolved addresses for every outbound request.

[DECISION] The same URL policy applies to connection verification, streamed `/responses`, `/conversations`, and pending response retrieval.

[VERIFIED] Existing runtime calls `/responses` and `/conversations` without provider authorization. The new path must attach the decrypted provider credential only to those outbound calls.

[ADVISOR] Provider authorization must also cover `GET /responses/{responseId}` for pending response recovery.

## Repository facts

[VERIFIED] Web `/developer/coworkers` lists and edits owned Coworkers, but has no onboarding create flow.

[VERIFIED] Core generic `POST /v1/coworkers` is admin-only and requires `vendorId`.

[VERIFIED] Core management helpers already use Vendor admin or Coworker assignment.

[VERIFIED] `apps/cli/VISION.md` requires one shipping CLI in this monorepo at `apps/cli`, prohibits a second CLI, and blocks adding its `package.json` until a spec defines the package.

[ADVISOR] `/Volumes/Sarthi MAC/Soko/sokosumi-cli` is a separate versioned product. It remains read-only reference code. This work does not modify or release it.

[ADVISOR] The sibling registration payload omits `vendorId` and sends fields Core rejects. Its credential path also does not separate developer management keys from Coworker runtime keys.

[VERIFIED] `Sokosumi-MCP` has hosted OAuth, Coworker lookup, and task tools, but no Coworker registration tool.

## Invariants

1. Only existing Vendor admins can start a first-time Coworker connection.
2. Vendor developers can manage only assigned Coworkers, as defined by `SOK-652`.
3. Organization membership is required for human use of the selected organization workspace.
4. Vendor actor authorization continues to use `VendorGrant`.
5. Provider secrets never enter Coworker metadata, model arguments, logs, responses, or API payloads returned to the user.
6. Hosted outbound calls use public HTTPS URLs and the same SSRF policy at validation and runtime.
7. `POST /responses`, `POST /conversations`, and `GET /responses/{responseId}` use the active provider credential.
8. A repeated onboarding request cannot create duplicate Coworker, access, credential, or runtime-key records.
9. An authenticated retry after a lost onboarding response revokes the original runtime key and mints at most one replacement.
10. The system never stores runtime-key plaintext for recovery.
11. The runtime `coworker_*` credential cannot authorize developer management operations.
12. Public listing remains private until Sokosumi team approval.

## Proposed stacked PR sequence

### Planning checkpoint

Branch: `sok-909-connect-existing-responses-api-coworkers-to-organization`

PR title: `docs: plan Coworker Responses integration`

Deliverable: this plan with decisions, invariants, stack order, non-goals, and verification gates. No product code.

### Core connection contract

Branch: `sok-909-core-connection-contract`

Deliverables:

- Core request and response schemas for connection onboarding.
- Existing Vendor lookup and Vendor-admin authorization.
- Coworker creation or link behavior under the existing Vendor.
- Organization workspace access creation.
- Encrypted provider credential persistence and lifecycle.
- One-time runtime key issuance.
- Transaction boundary, idempotency key, duplicate handling, and retry lookup.
- Authenticated lost-response recovery with one replacement runtime key.
- Vendor-admin authorization and response redaction.
- Core contract tests for success, permission, replay, replacement, and failure paths.

### Responses runtime

Branch: `sok-909-responses-runtime`

Deliverables:

- Public HTTPS and SSRF-safe provider URL validation.
- Provider credential injection for `/responses`, `/conversations`, and pending response retrieval.
- Connection verification.
- Credential rotation, revoke, and base URL invalidation.
- Runtime tests for redirects, private addresses, missing credentials, provider failures, and response recovery.

### Web onboarding

Branch: `sok-909-web-onboarding`

Deliverables:

- `/developer/coworkers` connection entry point.
- Existing Vendor selection limited to the user’s Vendor-admin memberships.
- Organization workspace selection limited to the user’s memberships.
- Provider URL and provider-key submission.
- One-time runtime key display with copy and warning state.
- Private status and credential rotation or revoke controls.
- Retry state for a committed connection whose first response was lost.
- Generated Core client update and Web service integration.

### Monorepo CLI

Branch: `sok-909-apps-cli-coworker-loop`

Deliverables:

- A package spec before `apps/cli/package.json`.
- Better Auth API key or OAuth authentication for developer management.
- Coworker connection for an existing Vendor-admin context, status, rotation, revoke, and review commands against Core.
- Secure provider-key input that never treats the provider key as a normal model argument.
- JSON output and lost-response recovery behavior.
- No Agent, Hire, or Job work from the deferred vision section.

### MCP handoff

Branch: `sok-909-mcp-handoff`

Deliverables:

- Required API OAuth scope and consent behavior.
- One-time web handoff state bound to OAuth client and user.
- Expiration, single use, replay rejection, and cancellation.
- Vendor-admin and organization-workspace authorization.
- Status and failure reporting without provider-secret exposure.

### Public listing review

Branch: `sok-909-public-listing-review`

Deliverables:

- Developer submission form and review state.
- Sokosumi team approval transition.
- Whitelist transition only after approval.
- Audit and rejection behavior.

## Non-goals

- Creating Vendors during Coworker connection onboarding.
- Modifying or shipping changes in `/Volumes/Sarthi MAC/Soko/sokosumi-cli`.
- Building a second CLI product.
- Copying the sibling Agent, Hire, or Job command surface.
- Broadening Vendor developer permissions beyond `SOK-652`.
- Allowing hosted private or HTTP provider endpoints.
- Public listing during initial connection.
- Replacing `CoworkerWorkspaceAccess` with `VendorGrant`.
- Storing provider credentials in metadata or returning them after submission.
- Storing runtime-key plaintext for replay.

## Verification gates

[PROPOSED] Each implementation PR runs its focused tests and a route-level smoke test for its changed path.

[PROPOSED] The complete flow is verified in this order: existing Vendor-admin authentication, connection transaction, organization workspace access, provider request authorization, streamed response, pending response retrieval, runtime key boundary, lost-response replacement, rotation or revoke, and public-review isolation.

[PROPOSED] The branch is reviewed with an adversarial pass before any push or PR promotion.

## Least confident decisions

1. The exact Core persistence shape for encrypted provider credentials and key rotation.
2. The MCP OAuth handoff endpoint and scope naming.
3. Whether public listing review belongs in this integration or a later issue after private use is proven.
