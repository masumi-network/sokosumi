-- Deleting an account keeps the person's public work (ADR 0057). Account
-- deletion deletes the private work they own itself; their public work stays
-- with its workspace without an Owner.
--
-- - The Owner column becomes nullable on Task, Task Schedule and Job, and its
--   foreign key empties it instead of cascading. Work without an Owner also
--   comes from Soko Bots acting on their own.
-- - Private work always has an Owner. Every existing row has one, so the
--   checks hold already.
-- - The history projection names the Owner, which may now be nobody.
--
-- Rollback: restore NOT NULL and ON DELETE CASCADE only after every null Owner
-- and history user has been filled in; nothing is dropped here.

-- AlterTable
ALTER TABLE "task" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "task" DROP CONSTRAINT "task_ownerId_fkey";
ALTER TABLE "task" ADD CONSTRAINT "task_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task" ADD CONSTRAINT "task_private_has_owner_check" CHECK (
  "visibility" <> 'PRIVATE'::"TaskVisibility" OR "ownerId" IS NOT NULL
);

-- AlterTable
ALTER TABLE "task_schedule" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "task_schedule" DROP CONSTRAINT "task_schedule_ownerId_fkey";
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "task_schedule" ADD CONSTRAINT "task_schedule_private_has_owner_check" CHECK (
  "visibility" <> 'PRIVATE'::"TaskVisibility" OR "ownerId" IS NOT NULL
);

-- AlterTable
ALTER TABLE "Job" ALTER COLUMN "ownerId" DROP NOT NULL;
ALTER TABLE "Job" DROP CONSTRAINT "Job_ownerId_fkey";
ALTER TABLE "Job" ADD CONSTRAINT "Job_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "history" ALTER COLUMN "userId" DROP NOT NULL;
