-- Collapse LOW/MEDIUM/HIGH into SUPERVISED/AUTONOMOUS.
CREATE TYPE "SokoBotAutonomyLevel_new" AS ENUM ('SUPERVISED', 'AUTONOMOUS');
ALTER TABLE "orchestrator" ALTER COLUMN "autonomyLevel" DROP DEFAULT;
ALTER TABLE "orchestrator"
  ALTER COLUMN "autonomyLevel" TYPE "SokoBotAutonomyLevel_new"
  USING (
    CASE "autonomyLevel"::text
      WHEN 'HIGH' THEN 'AUTONOMOUS'
      ELSE 'SUPERVISED'
    END
  )::"SokoBotAutonomyLevel_new";
ALTER TABLE "orchestrator" ALTER COLUMN "autonomyLevel" SET DEFAULT 'SUPERVISED';
DROP TYPE "SokoBotAutonomyLevel";
ALTER TYPE "SokoBotAutonomyLevel_new" RENAME TO "SokoBotAutonomyLevel";
