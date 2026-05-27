-- CreateTable
CREATE TABLE "hermesPendingConnection" (
    "connectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hermesPendingConnection_pkey" PRIMARY KEY ("connectionId")
);

-- CreateIndex
CREATE INDEX "hermesPendingConnection_expiresAt_idx" ON "hermesPendingConnection"("expiresAt");

-- AddForeignKey
ALTER TABLE "hermesPendingConnection" ADD CONSTRAINT "hermesPendingConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
