# OAuth clients: Sign in with Sokosumi

For a third-party app that signs people in with Sokosumi and, optionally, calls the Core API as them. Core is the authorization server ([ADR 0045](./adr/0045-cmo-signs-in-through-core-oauth-provider.md)).

## Endpoints

The issuer is Core's `/auth`, for example `https://api.sokosumi.com/auth`. Read the endpoints from its metadata rather than hardcoding them:

- `GET https://api.sokosumi.com/.well-known/oauth-authorization-server/auth` (RFC 8414)
- Authorize: `{issuer}/oauth2/authorize`. Token: `{issuer}/oauth2/token`.
- Core API: `https://api.sokosumi.com/v1/…` with `Authorization: Bearer <access token>`.

Register the client at `https://app.sokosumi.com/developer/oauth-clients`. Redirect URIs match exactly. A public client (no secret) uses PKCE.

## Scopes

| Scope            | Grants                                                                   |
| ---------------- | ------------------------------------------------------------------------ |
| `openid`         | Identity only: the ID token and userinfo carry `sub`. Cannot call `/v1`. |
| `sokosumi:api`   | Calling Core `/v1` as the consenting user.                               |
| `offline_access` | Refresh tokens.                                                          |
| `sokosumi:mcp`   | Calling Sokosumi's MCP server. Cannot call `/v1`. See below.             |

A new client is **identity-only**. Core API access needs `sokosumi:api` in all three places:

1. The client's allow-list: tick **Allow Sokosumi API access** on the client.
2. The authorize request: `scope=openid sokosumi:api` (add `offline_access` for refresh tokens).
3. The user's consent, given on Sokosumi's consent page.

## Tokens

- Send the **access token** (`soko_access_token_…`) as the bearer, not the ID token.
- Access tokens last 2 hours. Refresh tokens last 90 days and rotate on every use. A rotated token still works for 30 seconds, so parallel refreshes do not sign the user out.
- Core answers a bearer it cannot use with:

| Status                                                                                                        | Meaning                                                                            | Fix                                                       |
| ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------- |
| **401**                                                                                                       | Unknown, expired or revoked token; disabled client; banned user; consent withdrawn | Refresh, or sign the user in again                        |
| **403** `insufficient_scope` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="sokosumi:api"` | A valid token without `sokosumi:api` on the token, the client, or the consent      | Fix the scope in the three places above, then reauthorize |

## MCP server

Sokosumi's MCP server is a protected resource of the same issuer, at `{Core origin}/mcp`, for example `https://api.sokosumi.com/mcp` ([ADR 0076](./adr/0076-mcp-tokens-are-audience-bound-jwts-for-a-core-hosted-resource.md)). Not open yet: the `/mcp` endpoint itself is still being built. Client registration is open.

- Discover it from `GET https://api.sokosumi.com/.well-known/oauth-protected-resource/mcp` (RFC 9728): `resource`, `authorization_servers` and `scopes_supported`.
- Register without signing in: `POST {issuer}/oauth2/register` (RFC 7591), the `registration_endpoint` in the issuer's metadata. Core makes a public client with no secret, whatever `token_endpoint_auth_method` you send, and links it to the MCP resource. It may ask for `openid`, `sokosumi:mcp` and `offline_access` only; a registration that asks for `sokosumi:api` gets `400 invalid_scope`. A loopback or custom-scheme redirect URI registers a native client. Each IP may register 10 clients a minute.
- Every authorization uses PKCE with `S256`.
- Authorize and exchange the code with `resource=https://api.sokosumi.com/mcp` (RFC 8707) and `scope=openid sokosumi:mcp offline_access`. A registered client is linked to the resource already, and the user consents to it on Sokosumi's consent page.
- The access token is a JWT with `aud` set to the resource. It lasts 15 minutes and carries only `openid`, `sokosumi:mcp` and `offline_access`, even when the request asks for `sokosumi:api`.
- The MCP server accepts only that JWT. Core `/v1` rejects it with 401, and the MCP server rejects `/v1` tokens and API keys the same way.
- Banning the user, disabling the client or withdrawing consent ends the token on its next use. Revoking the app's tokens stops its refresh token; an access token it holds works until it expires.

## Which workspace

`GET /v1/users/me/workspaces` lists the user's personal and organization workspaces, marks the `preferred` one, and counts pending invitations. An empty list means the user has no workspace yet. With `pendingInvitationCount` above 0, send them to Sokosumi to resolve those invitations ([ADR 0051](./adr/0051-cmo-runs-identity-onboarding-over-a-workspaces-resource.md)). With none, send them to Sokosumi's onboarding, or create one with `POST /v1/users/me/workspaces`. `GET /v1/users/me/workspaces/preferred` returns only the preferred workspace, and 404 `no_preferred_workspace` when the user has none.

A coworker integration can also list the workspaces its vendor may act in with its coworker key and `X-Context-User-Id`, then sends `X-Context-Organization-Id` on later calls: [`coworker/vendor-workspace-grants-api.md`](./coworker/vendor-workspace-grants-api.md).
