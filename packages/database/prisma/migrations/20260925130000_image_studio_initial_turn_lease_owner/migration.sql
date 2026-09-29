-- Tell "nobody has tried yet" apart from "somebody is trying", and fence the
-- attempt that owns the try.
--
-- One in-flight state could not answer the case where the agent commits a
-- registration and then loses its response: the attempt never learns it holds
-- the lease, so it never delivers and never reports, and every retry is told a
-- delivery is in flight until the lease lapses into permanent uncertainty. A
-- claim nobody has acted on is now takeable, and the owner token stops the
-- attempt that lost it from dispatching anyway.
ALTER TYPE "ProjectImageInitialTurn" ADD VALUE 'CLAIMED' BEFORE 'DELIVERING';

ALTER TABLE "project_image_session"
  ADD COLUMN "initialTurnLeaseOwner" TEXT;
