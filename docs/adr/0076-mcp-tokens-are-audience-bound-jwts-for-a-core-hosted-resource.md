# MCP tokens are audience-bound JWTs for a Core-hosted resource

- Status: Accepted
- Date: 2026-11-23

Agents will manage Sokosumi through an MCP server that signs people in with Sokosumi's own OAuth provider (SOKD-360). MCP clients register themselves, so the server must never hand one a credential that works anywhere else, and Core's `/v1` must never accept an MCP token. Core already runs the authorization server (issuer `{origin}/auth`, [ADR 0045](0045-cmo-signs-in-through-core-oauth-provider.md)); this record makes the MCP server a protected resource of it.

## Decisions

- **The MCP server is a route inside Core at `{origin}/mcp`**, for example `https://api.sokosumi.com/mcp`, and that URL is permanent: it is the resource identifier (RFC 8707) every client stores. Core verifies MCP tokens in process and reuses its actor guards and error envelope. No new deploy.
- **A new scope, `sokosumi:mcp`.** It grants the MCP server only. A self-registered client gets at most `openid sokosumi:mcp offline_access`, never `sokosumi:api`, so it never holds a `/v1` token. The resource's scope allow-list removes `sokosumi:api` from any MCP token, whatever the client asks for. The scope stays out of `OAUTH_PROVIDER_SCOPES` because CMO requests that whole list, and Core rejects an authorize request that asks for a scope the client is not allowed.
- **An MCP token is a JWT with `aud = {origin}/mcp`**, issued when the client sends `resource={origin}/mcp`, signed with Core's JWKS, typed `at+jwt`. Core checks it locally: signature, `iss`, `typ`, expiry and `aud` (`lib/sokosumi-mcp/auth.ts`). `/v1` only accepts opaque tokens that it finds stored, so a JWT fails there, and the MCP server rejects opaque tokens, API keys, ID tokens and JWTs for any other audience. Neither surface accepts the other's tokens, and the MCP server never passes a token on (MCP authorization, "token passthrough").
- **Access tokens last 15 minutes**, refresh tokens rotate as they do for every client.
- **Every request runs the grant checks opaque tokens run** (`middleware/auth-oauth-grant.ts`, one helper for both): the user is not banned, the client is not disabled, the scope is on the token, on the client's allow-list and on the user's consent. A first-party client (`skipConsent`, [ADR 0046](0046-first-party-clients-skip-consent.md)) needs no consent row.
- **RFC 9728 metadata** at `/.well-known/oauth-protected-resource/mcp`, where the 401 points, and at the root `/.well-known/oauth-protected-resource`, the fallback MCP clients try. It names the resource, the issuer and `scopes_supported: ["sokosumi:mcp", "offline_access"]`. The root copy is for clients that only look there: its `resource` is `{origin}/mcp`, not the origin RFC 9728 §3.3 expects at that URL, so a strict client ignores it and follows the 401's `resource_metadata` instead.
- **Per-client resource links stay enforced** (the provider's default). A client gets MCP tokens only once linked to the resource; how a client gets linked is decided with self-registration (SOKD-364).

## Considered Options

- **Reuse `sokosumi:api` with an audience check only.** One scope fewer, but a self-registered client could ask for an opaque `/v1` token instead, and the consent screen could not tell the two apart.
- **Opaque MCP tokens.** Revocable on the spot, but the provider issues a JWT whenever a client names a resource, and an opaque token would need a second rule at `/v1` to keep it out.
- **A separate MCP service.** Its own deploy, CORS and token introspection, for no gain while Core holds every operation.

## Consequences

- **Revocation gap.** A JWT cannot be revoked. Revoking an app's tokens, or a password reset that revokes them, stops its refresh token at once, but an access token it already holds works until it expires, at most 15 minutes. Banning the user, disabling the client or withdrawing consent ends it on the next request through the grant checks.
- The MCP server costs two database reads per request (user and client, in parallel) plus the consent read for a client that has one. `/v1` costs the same.
- Every cold start writes the fields `lib/sokosumi-mcp/resource.ts` sets (name, access-token TTL, allowed scopes) onto the `oauthResource` row (`resourceSeedMode: "merge"`), so changing them in code is enough. Columns it leaves out, such as `disabled` or `refreshTokenTtl`, keep any edit made in the database. A test that boots Core's real `auth` without a database waits on that read and write, so it mocks Prisma.
- On a preview the identifier is the preview's origin; its row is seeded beside the copied mainnet row.
- The Prisma model `OauthClientResource.resourceId` references `OauthResource.id`, but Better Auth stores the resource's `identifier` there. Linking a client to a resource therefore needs a migration first (SOKD-364).
