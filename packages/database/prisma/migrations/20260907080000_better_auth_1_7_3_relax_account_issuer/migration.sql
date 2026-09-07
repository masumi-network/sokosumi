-- Better Auth 1.7.3: restore 1.6 identity (providerId, accountId).
-- Official “Relax the constraint” path: DROP NOT NULL + DROP unique index.
-- Column drop is deferred (optional later cleanup).
ALTER TABLE "account" ALTER COLUMN "issuer" DROP NOT NULL;
DROP INDEX "account_issuer_accountId_key";
