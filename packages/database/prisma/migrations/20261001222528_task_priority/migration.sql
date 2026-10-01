-- Task priority. Enum declaration order is sort order (urgent first, none last).
CREATE TYPE "TaskPriority" AS ENUM ('URGENT', 'HIGH', 'MEDIUM', 'LOW', 'NONE');

ALTER TABLE "task" ADD COLUMN "priority" "TaskPriority" NOT NULL DEFAULT 'NONE';
