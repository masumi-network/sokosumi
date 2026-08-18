# Harvest Microsoft `oid` on 1.6, then atomic 1.7 identity flip

Better Auth 1.7 keys an external account by `(issuer, accountId)`. Microsoft’s `accountId` changes from pairwise `sub` to directory `oid`. There is no runtime fallback.

We do **not** disable Microsoft sign-in. While 1.6 is still live, a harvest script refreshes stored Microsoft tokens and persists `idToken` until every Microsoft row has a verifiable `oid`. Cutover (schema + `accountId` rewrite + 1.7.0 code) deploys only when that report is empty. The Prisma migration fails if any `account.issuer` would be null.

We never invent `oid`, never merge users by email, and never rewrite `accountId` while 1.6 is the running binary.

**Rejected:** pausing Microsoft for an Entra export; shipping 1.7 with leftover `sub` keys; `local:oauth:google` as Google’s issuer (1.7 will write `https://accounts.google.com` and duplicate the account).
