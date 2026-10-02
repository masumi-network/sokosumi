-- Per-project task numbers (SOK-123). The database owns numbering so every
-- create path, and the previous Core release during deploy, agree.
ALTER TABLE "project" ADD COLUMN "taskCounter" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "task" ADD COLUMN "number" INTEGER;

CREATE TABLE "task_identifier_alias" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "taskId" TEXT NOT NULL,

    CONSTRAINT "task_identifier_alias_pkey" PRIMARY KEY ("projectId","number")
);

CREATE INDEX "task_identifier_alias_taskId_idx" ON "task_identifier_alias"("taskId");

ALTER TABLE "task_identifier_alias" ADD CONSTRAINT "task_identifier_alias_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "task_identifier_alias" ADD CONSTRAINT "task_identifier_alias_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill before the triggers exist, so it does not consume counters.
-- Set-based: number tasks per project in creation order.
UPDATE "task" SET "number" = numbered."number"
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "projectId" ORDER BY "createdAt", "id")::INTEGER AS "number"
  FROM "task" WHERE "projectId" IS NOT NULL
) AS numbered
WHERE "task"."id" = numbered."id";

UPDATE "project" SET "taskCounter" = highest."number"
FROM (
  SELECT "projectId", max("number") AS "number"
  FROM "task" WHERE "projectId" IS NOT NULL GROUP BY "projectId"
) AS highest
WHERE "project"."id" = highest."projectId";

CREATE UNIQUE INDEX "task_projectId_number_key" ON "task"("projectId", "number");

-- A Task gets the next number of the project it enters. The counter update
-- takes the project row lock, which serializes concurrent inserts. Listing
-- "number" in the trigger columns keeps direct writes to it from sticking.
CREATE FUNCTION task_assign_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."projectId" IS NULL THEN
    NEW."number" := NULL;
  ELSIF TG_OP = 'INSERT' OR NEW."projectId" IS DISTINCT FROM OLD."projectId" THEN
    UPDATE "project" SET "taskCounter" = "taskCounter" + 1
    WHERE "id" = NEW."projectId"
    RETURNING "taskCounter" INTO NEW."number";
  ELSE
    NEW."number" := OLD."number";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER task_assign_number BEFORE INSERT OR UPDATE OF "projectId", "number" ON "task"
FOR EACH ROW EXECUTE FUNCTION task_assign_number();

-- The number a Task leaves behind keeps resolving to it. Skipped when the old
-- project is gone: deleting a project nulls its tasks' projectId through the
-- foreign key, which fires this trigger mid-cascade.
CREATE FUNCTION task_alias_old_number() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "task_identifier_alias" ("projectId", "number", "taskId")
  SELECT OLD."projectId", OLD."number", NEW."id"
  WHERE EXISTS (SELECT 1 FROM "project" WHERE "id" = OLD."projectId")
  ON CONFLICT DO NOTHING;
  RETURN NULL;
END;
$$;
CREATE TRIGGER task_alias_old_number AFTER UPDATE OF "projectId" ON "task"
FOR EACH ROW
WHEN (OLD."projectId" IS NOT NULL AND OLD."number" IS NOT NULL AND NEW."projectId" IS DISTINCT FROM OLD."projectId")
EXECUTE FUNCTION task_alias_old_number();
