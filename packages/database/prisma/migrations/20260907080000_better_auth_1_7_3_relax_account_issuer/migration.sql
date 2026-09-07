-- Better Auth 1.7.3 restores 1.6 account identity: (providerId, accountId).
-- 1.7.0–1.7.2 required issuer and unique (issuer, accountId). New rows no
-- longer write issuer, so a NOT NULL column rejects every sign-up until it
-- is relaxed. Keep the column so the still-serving 1.7.2 Core can write
-- issuer during the Vercel migrate-then-activate window. Drop the column
-- in a later migration after 1.7.3 is live.

ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;

DROP INDEX "account_issuer_accountId_key";
