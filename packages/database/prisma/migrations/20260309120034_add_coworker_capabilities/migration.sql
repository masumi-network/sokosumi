ALTER TABLE "coworker"
ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY['chat', 'tasks']::TEXT[];

ALTER TABLE "coworker"
ALTER COLUMN "capabilities" SET DEFAULT ARRAY[]::TEXT[];
