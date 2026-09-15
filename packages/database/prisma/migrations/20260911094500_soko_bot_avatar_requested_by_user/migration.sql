-- AlterTable
-- `requestedByUserId` is TEXT, not UUID: user.id is TEXT, and rows created
-- before Better Auth started emitting UUID ids do not parse as one.
-- `reservedAt` marks a row claimed as a generation slot but not yet filled.
ALTER TABLE "soko_bot_avatar" ADD COLUMN     "requestedByUserId" TEXT,
ADD COLUMN     "reservedAt" TIMESTAMP(3);

-- CreateIndex
-- Plain, not CONCURRENTLY: soko_bot_avatar holds a small mascot pool (the cron
-- refills it to a floor of 24), so the build finishes before it is noticed.
-- Reserve CONCURRENTLY for the large tables, as notification and task_file do.
CREATE INDEX "soko_bot_avatar_requestedByUserId_createdAt_idx" ON "soko_bot_avatar"("requestedByUserId", "createdAt");

-- AddForeignKey
-- Matches soko_bot_turn.requestedByUserId.
-- Added NOT VALID, then validated separately. Both forms take SHARE ROW
-- EXCLUSIVE on `user`, which does block ordinary writes there. The difference
-- is how long: a plain ADD CONSTRAINT holds it across the validation scan,
-- while NOT VALID skips the scan and releases it immediately. VALIDATE
-- CONSTRAINT then scans under SHARE UPDATE EXCLUSIVE here and only ROW SHARE
-- on `user`, so the scan itself never blocks a user write.
ALTER TABLE "soko_bot_avatar" ADD CONSTRAINT "soko_bot_avatar_requestedByUserId_fkey" FOREIGN KEY ("requestedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

ALTER TABLE "soko_bot_avatar" VALIDATE CONSTRAINT "soko_bot_avatar_requestedByUserId_fkey";
