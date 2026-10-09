# OAuth clients: Sign in with Sokosumi

For a third-party app that signs people in with Sokosumi and, optionally, calls the Core API as them. Core is the authorization server ([ADR 0045](./adr/0045-cmo-signs-in-through-core-oauth-provider.md)).

## Endpoints

The issuer is Core's `/auth`, for example `https://api.sokosumi.com/auth`. Read the endpoints from its metadata rather than hardcoding them:

- `GET https://api.sokosumi.com/.well-known/oauth-authorization-server/auth` (RFC 8414)
- Authorize: `{issuer}/oauth2/authorize`. Token: `{issuer}/oauth2/token`.
- Core API: `https://api.sokosumi.com/v1/…` with `Authorization: Bearer <access token>`.

Register the client at `https://app.sokosumi.com/developer/oauth-clients`. Redirect URIs match exactly. A public client (no secret) uses PKCE.

## Scopes

| Scope | Grants |
| --- | --- |
| `openid` | Identity only: the ID token and userinfo carry `sub`. Cannot call `/v1`. |
| `sokosumi:api` | Calling Core `/v1` as the consenting user. |
| `offline_access` | Refresh tokens. |

A new client is **identity-only**. Core API access needs `sokosumi:api` in all three places:

1. The client's allow-list: tick **Allow Sokosumi API access** on the client.
2. The authorize request: `scope=openid sokosumi:api` (add `offline_access` for refresh tokens).
3. The user's consent, given on Sokosumi's consent page.

## Tokens

- Send the **access token** (`soko_access_token_…`) as the bearer, not the ID token.
- Access tokens last 2 hours. Refresh tokens last 90 days and rotate on every use. A rotated token still works for 30 seconds, so parallel refreshes do not sign the user out.
- Core answers a bearer it cannot use with:

| Status | Meaning | Fix |
| --- | --- | --- |
| **401** | Unknown, expired or revoked token; disabled client; banned user; consent withdrawn | Refresh, or sign the user in again |
| **403** `insufficient_scope` with `WWW-Authenticate: Bearer error="insufficient_scope", scope="sokosumi:api"` | A valid token without `sokosumi:api` on the token, the client, or the consent | Fix the scope in the three places above, then reauthorize |

## Which workspace

`GET /v1/users/me/workspaces` lists the user's personal and organization workspaces, marks the `preferred` one, and counts pending invitations. An empty list means the user has no workspace yet. With `pendingInvitationCount` above 0, send them to Sokosumi to resolve those invitations ([ADR 0051](./adr/0051-cmo-runs-identity-onboarding-over-a-workspaces-resource.md)). With none, send them to Sokosumi's onboarding, or create one with `POST /v1/users/me/workspaces`. `GET /v1/users/me/workspaces/preferred` returns only the preferred workspace, and 404 `no_preferred_workspace` when the user has none.

A coworker integration can also list the workspaces its vendor may act in with its coworker key and `X-Context-User-Id`, then sends `X-Context-Organization-Id` on later calls: [`coworker/vendor-workspace-grants-api.md`](./coworker/vendor-workspace-grants-api.md).
