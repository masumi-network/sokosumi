-- Sign-up origin and sign-up context (ADR 0052). No backfill: accounts
-- created before this have no row.

-- AlterTable
ALTER TABLE "oauthClient" ADD COLUMN     "signUpOrigin" TEXT;

-- CreateTable
CREATE TABLE "sign_up_context" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "entries" JSONB NOT NULL DEFAULT '{}',
    "clientId" TEXT,

    CONSTRAINT "sign_up_context_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sign_up_context_userId_key" ON "sign_up_context"("userId");

-- AddForeignKey
ALTER TABLE "sign_up_context" ADD CONSTRAINT "sign_up_context_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
