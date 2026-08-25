-- One fixed policy: drafts freely, approval before assigning work, READY, or paid hires.
ALTER TABLE "orchestrator" DROP COLUMN "autonomyLevel";
DROP TYPE "SokoBotAutonomyLevel";
