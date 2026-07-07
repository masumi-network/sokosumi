-- Deleting a coworker cascades away its grant rows; with SET NULL that
-- silently RELEASED every comment held under them (null heldByGrantId is
-- the public state). Cascade instead: never-approved comments are discarded
-- with the grant, matching the deny semantics.
ALTER TABLE "taskEvent" DROP CONSTRAINT "taskEvent_heldByGrantId_fkey";
ALTER TABLE "taskEvent"
  ADD CONSTRAINT "taskEvent_heldByGrantId_fkey"
  FOREIGN KEY ("heldByGrantId") REFERENCES "coworker_grant"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
