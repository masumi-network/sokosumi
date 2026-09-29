# CMO signs in through Core's OAuth provider

CMO lives on its own registrable domain (cmo.xyz), so it cannot share Sokosumi's session cookie, which Core only widens to `*.sokosumi.com`. Sign in with Sokosumi therefore runs through the OAuth provider Core already hosts for the CLI and Apple clients: CMO is a confidential client that exchanges the code server side, keeps the tokens in an encrypted cookie on cmo.xyz because it has no database, and calls Core `/v1` only from its server with the `sokosumi:api` token and the `x-organization-slug` header. Core's CORS and trusted origins stay limited to Sokosumi hosts.

## Considered Options

- **Serve CMO from a Sokosumi subdomain and share the cookie.** No auth work, but the product would not live on cmo.xyz.
- **A CMO login form backed by Core's email sign-in.** Production Core sets cookies for `sokosumi.com`, which browsers drop on cmo.xyz, so it needed a bearer plugin or per-origin cookie domains. It also lost passkeys, whose relying party is sokosumi.com, and added a second credential surface to protect. It cost more than the OAuth provider that already existed.
- **Previews against the PR's Core preview.** After each `/deploy mainnet`, CI would add the preview's callback to CMO's client row in the PR's Neon preview branch. Previews could then test Core auth changes through CMO, but CI would rewrite that database on every deploy and reset. Rejected in favour of `oAuthProxy` (SOK-1225).

## Consequences

- OAuth redirect URIs must match exactly. CMO has one hand-registered client per environment, like the CLI, and production clients never accept wildcard redirects.
- PR previews sign in through Better Auth's `oAuthProxy`, the way Core's previews use Google and Microsoft. Core only ever sees production CMO's callback (`https://cmo.xyz/api/auth/callback/sokosumi`). Production CMO exchanges the code and hands the encrypted tokens back to the preview, which shares the proxy secret. Previews therefore use mainnet Core and real mainnet tokens: no database is written, but a PR cannot test Core auth changes through CMO, and a preview needs production CMO to run the proxy.
- Every user sees the consent screen once, because Core's `/v1` bearer check requires a stored consent that grants `sokosumi:api`.
- Sign-in, sign-up, and consent pages carry Sokosumi's branding. Signing out of CMO does not sign out of Sokosumi.
- CMO runs Better Auth statelessly with the generic OAuth plugin; its callback is `/api/auth/callback/sokosumi`. Stateless mode stores and renews Core's rotating refresh token in the encrypted account cookie, so no separate OIDC client library is needed.
- Core grants no `profile` or `email` scope, so its ID token and userinfo carry only `sub`. CMO reads the name and email from `GET /v1/users/me` at sign in, which also refuses users Core bans or deletes.
