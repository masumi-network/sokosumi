-- Better Auth 1.7.3 restores 1.6 account identity: (providerId, accountId).
-- 1.7.0–1.7.2 required issuer and unique (issuer, accountId). New rows no
-- longer write issuer, so the NOT NULL column rejects every sign-up until
-- it is dropped. No backfill.

DROP INDEX "account_issuer_accountId_key";

ALTER TABLE "account" DROP COLUMN "issuer";
