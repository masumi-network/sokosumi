-- CreateTable
CREATE TABLE "cmo_upgrade_seen" (
    "userId" TEXT NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "versionId" TEXT NOT NULL,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmo_upgrade_seen_pkey" PRIMARY KEY ("userId","sokoBotId","versionId")
);

-- CreateIndex
CREATE INDEX "cmo_upgrade_seen_sokoBotId_idx" ON "cmo_upgrade_seen"("sokoBotId");

-- AddForeignKey
ALTER TABLE "cmo_upgrade_seen" ADD CONSTRAINT "cmo_upgrade_seen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cmo_upgrade_seen" ADD CONSTRAINT "cmo_upgrade_seen_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

