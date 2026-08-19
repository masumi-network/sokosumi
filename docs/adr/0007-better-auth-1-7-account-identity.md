# Harvest Microsoft `oid` on 1.6, then atomic 1.7 identity flip

Better Auth 1.7 keys an external account by `(issuer, accountId)`. Microsoft’s `accountId` changes from pairwise `sub` to directory `oid`. There is no runtime fallback.

We do **not** disable Microsoft sign-in. While 1.6 is still live, a harvest script refreshes stored Microsoft tokens and persists `idToken` until every Microsoft row has a verifiable `oid`. Cutover (schema + `accountId` rewrite + 1.7.1 code) deploys only when that report is empty. The Prisma migration fails if any `account.issuer` would be null, if a `providerId` other than credential/google/microsoft remains, or if `(issuer, accountId)` collides. It does not invent a synthetic `local:oauth:…` issuer. Do not merge those users by email. `jwks.alg` / `jwks.crv` are added nullable so 1.7 `createJwk` can persist the signing algorithm.

We never invent `oid`, never merge users by email, and never rewrite `accountId` while 1.6 is the running binary. Unverified password users may still implicit-link Google/Microsoft (`requireLocalEmailVerified: false`). Creating a Google or Microsoft account marks `emailVerified`. A 1.7 magic-link verify on a still-unverified user deletes every account (password included) and standing sessions, then sets `emailVerified`. Google/Microsoft-linked users are already verified, so that wipe does not strip those links.

**Rejected:** pausing Microsoft for an Entra export; shipping 1.7 with leftover `sub` keys; `local:oauth:google` as Google’s issuer (1.7 will write `https://accounts.google.com` and duplicate the account).
