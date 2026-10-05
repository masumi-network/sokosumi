-- The event written when a Task is created. It is only ever a taskEvent
-- status, never a task status. Its own migration: Postgres cannot use a new
-- enum value in the transaction that added it (the backfill follows).
ALTER TYPE "TaskStatus" ADD VALUE 'CREATED';
