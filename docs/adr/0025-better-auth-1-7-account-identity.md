# Harvest Microsoft `oid` on 1.6, then atomic 1.7 identity flip

- Status: Accepted (cutover spent; `issuer` column drop still open)

Better Auth **1.7.5** is live. Account identity is `(providerId, accountId)`
again; Better Auth stopped writing `issuer`. Prisma maps `issuer` as
`String?` with no unique (the documented “Relax the constraint” path:
`ALTER COLUMN issuer DROP NOT NULL` + drop `account_issuer_accountId_key`).
Microsoft `oid` rewrites from this cutover stay.

We never invent `oid`, never merge users by email, and never restore a unique
on `issuer`. Unverified password users cannot implicit-link Google/Microsoft
(Better Auth 1.7 default; `requireLocalEmailVerified` is omitted). Creating a
Google or Microsoft account marks `emailVerified`. A 1.7 magic-link verify on
a still-unverified user deletes every account (password included) and standing
sessions, then sets `emailVerified`. Google/Microsoft-linked users are already
verified, so that wipe does not strip those links.

**Still open:** drop the `issuer` column. That is follow-up cleanup after
1.7.3+, not a gate.

## Spent

The 1.6 harvest (`pnpm data-migration:better-auth-1-7-harvest`) and the 1.7.3
relax migration (`20260907080000_better_auth_1_7_3_relax_account_issuer`)
shipped. Do not re-run the harvest as a deploy gate. The 1.7.0–1.7.2
`(issuer, accountId)` window, the “do not rewrite `accountId` while 1.6 is
the running binary” constraint, and the 1.7.2-still-serving
migrate-then-activate note are spent.

**Rejected:** pausing Microsoft for an Entra export; shipping 1.7 with leftover
`sub` keys; `local:oauth:google` as Google’s issuer (1.7 writes
`https://accounts.google.com` and would duplicate the account).
