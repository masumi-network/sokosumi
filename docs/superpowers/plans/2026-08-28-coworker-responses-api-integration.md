# Coworker Responses API integration plan

## Product goal

[DECISION] Bring an existing Responses API Coworker into Sokosumi as a private Coworker for one organization workspace.

[DECISION] CLI-first in `apps/cli`. Slice 1 is Developer CLI login/signup against the existing Better Auth OAuth server. Coworker connect commands come after that. Web `/developer` onboarding follows a working CLI loop. The sibling `sokosumi-cli` repo stays read-only.

## Domain rules

[VERIFIED] A Coworker belongs to a Vendor. A Vendor has `admin` and `developer` members. (Evidence: `packages/database/prisma/schema.prisma:278-313`.)

[DECISION] The first connection links an existing Vendor and organization workspace relationship. The initiating user must already be a Vendor admin. The flow does not create Vendors.

[DECISION] Vendor admins start first-time connections. This preserves `SOK-652`: admins manage all Coworkers; developers manage only Coworkers assigned to them.

[DECISION] Organization membership controls human workspace use. It does not transfer Vendor ownership.

[DECISION] The first connection is private and starts with `isWhitelisted=false`.

[VERIFIED] Human-side workspace use uses `CoworkerWorkspaceAccess`. (Evidence: `docs/coworker/coworker-workspace-access-api.md:24-37`.)

[VERIFIED] Vendor actor task access keeps existing `VendorGrant` behavior. The two access systems stay separate. (Evidence: `packages/database/prisma/schema.prisma:315-341`; `docs/coworker/coworker-workspace-access-api.md:24-37`.)

[DECISION] Public listing requires a separate submission and Sokosumi team approval.

## Credential rules

[DECISION] A human Sokosumi API key, OAuth token, or web session starts onboarding.

[DECISION] Core stores one provider API credential per Coworker in an encrypted record. The record has encryption key version, owner, created, rotated, and revoked timestamps. Rotation replaces ciphertext. Revocation disables outbound calls. Changing `baseURL` revokes the old credential until a new one is supplied. Plaintext is never returned after initial submission.

[DECISION] The provider credential is separate from the human Sokosumi credential and the Coworker runtime key.

[VERIFIED] Sokosumi mints a separate `coworker_*` key for the external runtime. The key is returned once, then can be rotated or revoked. (Evidence: `apps/core/src/routes/v1/coworkers/[id]/api-keys/post.ts:65-112`; `packages/database/prisma/schema.prisma:1620-1637`.)
[DECISION] Credential lifecycle history is append-only. The current encrypted credential record stores current state only. Audit events preserve actor and outcome history across credential replacement.

[DECISION] Core emits `coworker.provider_credential.created`, `coworker.provider_credential.rotated`, `coworker.provider_credential.revoked`, and `coworker.provider_credential.base_url_invalidated`. Each event includes the actor, Coworker target, outcome, and non-secret identifiers or reason. Events never include provider secrets, runtime-key plaintext, authorization headers, or session tokens.

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

[VERIFIED] Existing runtime calls `/responses` and `/conversations` without provider authorization. The new path must attach the decrypted provider credential only to those outbound calls. (Evidence: `packages/ai-provider/src/sokosumi-language-model.ts:316-387`; `apps/core/src/routes/v1/chats/stream/coworker-conversation.ts:138-165`.)

[VERIFIED] `@sokosumi/net` exports `ssrfSafeFetch`, whose filtering agent checks the resolved address at connection time. (Evidence: `packages/net/src/index.ts:1-11`; `packages/net/src/ssrf-fetch.ts:87-92`.)

[REPORTED] Current `ssrfSafeFetch` buffers complete response bodies, follows GET redirects, and reuses request headers across redirect hops. Credential-bearing provider calls must reject redirects. Streaming Responses calls need a streamed variant or injected transport in `@sokosumi/net`.

[REPORTED] `ssrfSafeFetch` accepts both HTTP and HTTPS schemes. The connection policy must enforce HTTPS before every hosted provider call.

[REPORTED] Provider authorization must also cover `GET /responses/{responseId}` for pending response recovery.


## Repository facts

[VERIFIED] Web `/developer/coworkers` currently renders a list of owned Coworkers and an edit page. (Evidence: `apps/web/src/app/(app)/developer/components/coworkers/developer-coworkers-section.tsx:7-20`; `apps/web/src/app/(app)/developer/components/coworkers/developer-coworkers-list.tsx:20-67`; `apps/web/src/app/(app)/developer/coworkers/[id]/page.tsx:24-73`.)

[INFERRED] These current Web surfaces do not expose the requested onboarding entry point.

[VERIFIED] Core generic `POST /v1/coworkers` is admin-only and requires `vendorId`. (Evidence: `apps/core/src/routes/v1/coworkers/post.ts:15-24,75-80`; `apps/core/src/routes/v1/coworkers/schema.ts:36-44`.)

[VERIFIED] Core management helpers already use Vendor admin or Coworker assignment. (Evidence: `apps/core/src/routes/v1/coworkers/coworker-management-access.ts:22-44`.)
[VERIFIED] `packages/net` is the canonical network package. Its public entry point is `@sokosumi/net`, which exports `ssrfSafeFetch` and related URL guards. (Evidence: `packages/net/src/index.ts:1-11`.)

[VERIFIED] `apps/cli/VISION.md` requires one shipping CLI in this monorepo at `apps/cli`, prohibits a second CLI, and blocks adding its `package.json` until a spec defines the package. (Evidence: `apps/cli/VISION.md:1-5,9-17,41-48`.)

[REPORTED] The sibling `sokosumi-cli` repository is a separate versioned product. It remains read-only reference code. This work does not modify or release it. (Evidence: https://github.com/masumi-network/sokosumi-cli/tree/1bf675492592ac16e369ef31d11ccab80d098761.)

[REPORTED] The sibling registration payload omits `vendorId` and sends fields Core rejects. Its credential path also does not separate developer management keys from Coworker runtime keys. (Evidence: https://github.com/masumi-network/sokosumi-cli/blob/1bf675492592ac16e369ef31d11ccab80d098761/src/api/services/coworker-service.mjs#L84-L105.)

[VERIFIED] `Sokosumi-MCP` currently uses hosted OAuth and exposes Coworker lookup and task tools. (Evidence: `Sokosumi-MCP/oauth.py:71-82,284-315`; `Sokosumi-MCP/server.py:891-999`.)
[INFERRED] The inspected MCP server does not expose a Coworker registration tool.

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
13. Provider credential create, rotate, revoke, and base-URL invalidation each emit an unsampled audit event with actor, target, and outcome. Audit events contain no secret material.
14. Developer CLI slice 1 authenticates with OAuth access/refresh tokens in the OS keychain. It does not use web session cookies and does not mint an API key in that slice.
15. Core keeps a platform-owned native public client `sokosumi_cli` so the CLI can authorize without each developer creating an OAuth client.

## Proposed stacked PR sequence

### Planning checkpoint

Branch: `sok-909-connect-existing-responses-api-coworkers-to-organization`

PR title: `docs: CLI-first plan for Coworker Responses integration (SOK-909)`

Deliverable: this plan plus the slice-1 OAuth spec. No product implementation in this checkpoint.

### Developer CLI OAuth (slice 1)

Branch: `sok-909-apps-cli-oauth` (or this branch if the planning PR is allowed to grow)

Deliverables:

- Package spec for `apps/cli` (`sokosumi-cli` / bin `sokosumi`).
- `sokosumi auth login` (PKCE, loopback, `--json`).
- Thin Ink login/status/sign-out screen when invoked with no args.
- OS keychain storage for access and refresh tokens. No API key mint.
- Core first-party native public client `sokosumi_cli` (upsert, deploy hook, cron).
- Signup/login on existing web `/signin` during the authorize hop.

Spec: `docs/superpowers/specs/2026-09-07-developer-cli-oauth-slice-design.md`.

### Core connection contract

Branch: `sok-909-core-connection-contract`

Deliverables:

- Core request and response schemas for connection onboarding.
- Existing Vendor lookup and Vendor-admin authorization.
- Coworker creation or link behavior under the existing Vendor.
- Organization workspace access creation.
- Encrypted provider credential persistence and lifecycle.
- Unsampled credential lifecycle audit events for create, rotate, revoke, and base-URL invalidation, with secret-free actor, target, outcome, and reason fields.
- One-time runtime key issuance.
- Transaction boundary, idempotency key, duplicate handling, and retry lookup.
- Authenticated lost-response recovery with one replacement runtime key.
- Vendor-admin authorization and response redaction.
- Core contract tests for success, permission, replay, replacement, and failure paths.

### Responses runtime

Branch: `sok-909-responses-runtime`

Deliverables:

- Use the canonical `@sokosumi/net` transport. Do not use global `fetch` for provider calls.
- Extend or inject the helper so SSE responses stream without buffering the full body.
- Enforce HTTPS and reject redirects on every credential-bearing provider call, including pending response retrieval.
- Keep connect-time address filtering for each outbound connection to close DNS-rebinding gaps.
- Provider credential injection for `/responses`, `/conversations`, and pending response retrieval.
- Connection verification.
- Credential rotation, revoke, and base URL invalidation.
- Add redirect, auth-leak, streaming, private-address, missing-credential, provider-failure, and response-recovery tests.

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

### Monorepo CLI coworker loop

Branch: `sok-909-apps-cli-coworker-loop`

Blocked by: Developer CLI OAuth (slice 1) and Core connection contract.

Deliverables:

- Coworker connection for an existing Vendor-admin context, status, rotation, revoke, and review commands against Core.
- Secure provider-key input that never treats the provider key as a normal argument or log line.
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
- Modifying or shipping changes in the sibling `sokosumi-cli` repository.
- Building a second CLI product.
- Copying the sibling Agent, Hire, or Job command surface.
- CLI-native email/password forms (signup and login stay on web `/signin`).
- Minting a Better Auth API key in slice 1.
- Broadening Vendor developer permissions beyond `SOK-652`.
- Allowing hosted private or HTTP provider endpoints.
- Public listing during initial connection.
- Replacing `CoworkerWorkspaceAccess` with `VendorGrant`.
- Storing provider credentials in metadata or returning them after submission.
- Storing runtime-key plaintext for replay.

## Verification gates

[PROPOSED] Each implementation PR runs its focused tests and a route-level smoke test for its changed path.
[PROPOSED] The Responses runtime checkpoint runs focused `@sokosumi/net` tests for redirect rejection, authorization-header leakage, connect-time address filtering, and SSE streaming.

[PROPOSED] The complete flow is verified in this order: Developer CLI OAuth login against `sokosumi_cli`, existing Vendor-admin authentication, connection transaction, organization workspace access, provider request authorization, streamed response, pending response retrieval, runtime key boundary, lost-response replacement, rotation or revoke, and public-review isolation.

[PROPOSED] The branch is reviewed with an adversarial pass before any push or PR promotion.

## Least confident decisions

1. The exact Core persistence shape for encrypted provider credentials and key rotation.
2. The MCP OAuth handoff endpoint and scope naming.
3. Whether public listing review belongs in this integration or a later issue after private use is proven.
