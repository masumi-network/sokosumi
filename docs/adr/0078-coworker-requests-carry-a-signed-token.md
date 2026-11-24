# Coworker requests carry a signed token

- Status: Accepted
- Date: 2026-11-24

A coworker's Responses API trusts the `X-Sokosumi-User-Id` header Core sends, so anyone who knows its URL can call it as any user. On 16.11 an outsider called a Serviceplan coworker directly with made-up ids. Serviceplan asked Sokosumi to prove which calls it made and for whom; this record fixes the token Core sends. The contract shared with coworker developers is the doc "Sokosumi coworker request authentication".

## Decisions

- **Every call Core makes to a coworker carries `Authorization: Bearer <JWT>`**: `POST /responses` and each of its retries, `GET /responses/{id}` (the poll), and `POST /conversations`. Every coworker gets it; there is no allowlist. The `X-Sokosumi-*` headers and conversation metadata stay unchanged until the coworkers enforce the token.
- **Signed with Core's existing Better Auth `jwt()` key** (`EdDSA`, Ed25519), the key that signs ID tokens and MCP tokens ([ADR 0076](0076-mcp-tokens-are-audience-bound-jwts-for-a-core-hosted-resource.md)). Coworkers verify against the issuer's JWKS, `{origin}/auth/jwks`, locally; they never call Core per request.
- **Header `typ` = `coworker+jwt`.** It keeps the token apart from ID tokens and MCP `at+jwt` tokens signed by the same key (RFC 8725 §3.11).
- **Claims:**
  - `iss` = `{origin}/auth`, taken from the OIDC discovery issuer (`{origin}/auth/.well-known/openid-configuration`). A coworker system accepts exactly one issuer: production `https://api.sokosumi.com/auth`, staging `https://api.preprod.sokosumi.com/auth`.
  - `aud` = the coworker's `baseURL` without a trailing slash, the string the request URL is built from. Coworkers sharing a base URL share an `aud`.
  - `sub` = user id; `org` = the organisation whose room the request runs in (admitted at message post for members and invited guests, not rechecked at signing), absent in a personal chat; `coworker` = coworker slug.
  - `iat`, `exp` = `iat` + 300 s, and `jti` = a random UUID. `signJWT` sets `iat` and `jti` only when given, so Core passes both.
  - Nothing else: no name, email or message content.
- **A fresh token per attempt.** Coworkers reject a `jti` they have seen, so `@sokosumi/ai-provider` takes a `getAuthorization()` callback in its call options and calls it before each attempt; the package never holds a key. Core's own fetches sign per call.
- **Transport:** signed requests require `https` in every environment except loopback hosts (`localhost`, `127.0.0.1`, `::1`), where `http` is allowed by the signer's scheme check; the SSRF connection filter in `packages/net` still blocks loopback connections, so a local coworker on `127.0.0.1` needs the usual local-dev path. Signed requests never follow redirects (`redirect: "manual"`), so a `3xx` fails the request instead of replaying a `jti` or forwarding the bearer token to another origin.
- **Core signs through the exported `signJWT(ctx, { options, header, payload })`** from `better-auth/plugins`, with `ctx` = `{ context: await auth.$context }` and `options` = the same `jwt()` options `auth.ts` registers (`jwtKeyStoreOptions`), so previews sign with their own key. The `auth.api.signJWT` endpoint takes no `header`. No key cache: `signJWT` reads the `jwks` table once per call.
- **A failed signing fails the coworker request.** Nothing is sent unsigned.

## Considered Options

- **A separate signing key and JWKS for coworker tokens.** Serviceplan proposed it, because they also receive Sokosumi ID tokens when users link their accounts. Rejected: `typ` and `aud` already separate the token kinds, and a second key adds a secret per environment and a manual rotation.
- **A static shared secret.** It names no user, and whoever holds it can act as anyone; the coworker's earlier service key was stolen.
- **Forwarding the user's own OAuth access token.** The coworker would hold powerful user tokens and need a per-request check against Core.
- **Egress IP allowlisting.** Core runs on Vercel with rotating egress IPs, and an IP names no user.
- **An allowlist of coworkers that receive the token.** Rejected: the token holds nothing secret, and an env switch we delete after enforcement is not worth its code.
- **A preprod endpoint that mints test tokens.** It would be a forging service on staging. Coworkers test with a key of their own and end to end through the preprod UI.

## Consequences

- A coworker learns nothing new: `sub` and `org` are the ids the headers already carry, now unforgeable.
- Because `org` is admitted when the message is posted and not rechecked at signing, guests in External channels keep working and a member removed from an organisation while their mention is queued still receives that queued reply.
- Rotating the Better Auth key rotates coworker tokens too. Coworkers cache the JWKS and refetch on an unknown `kid`.
- A coworker that ignores `typ` or `aud` would accept an ID token of a user who linked their account. The contract makes both checks mandatory.
- Each coworker call costs one extra `jwks` read.
- Once every coworker enforces the token, the `X-Sokosumi-*` headers and the `sokosumi_user_id` / `sokosumi_organization_id` metadata can go.
