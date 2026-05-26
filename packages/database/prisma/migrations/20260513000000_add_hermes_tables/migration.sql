-- CreateTable
CREATE TABLE "hermesMessage" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "kind" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hermesMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hermesInstance" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "lastPolledAt" TIMESTAMP(3),
    "lastInboxMessageAt" TIMESTAMP(3),
    "lastSeenInboxAt" TIMESTAMP(3),
    "consecutivePollErrors" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hermesInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hermesMessage_userId_createdAt_idx" ON "hermesMessage"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "hermesInstance_userId_key" ON "hermesInstance"("userId");

-- CreateIndex
CREATE INDEX "hermesInstance_lastPolledAt_idx" ON "hermesInstance"("lastPolledAt");

-- AddForeignKey
ALTER TABLE "hermesMessage" ADD CONSTRAINT "hermesMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hermesInstance" ADD CONSTRAINT "hermesInstance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

