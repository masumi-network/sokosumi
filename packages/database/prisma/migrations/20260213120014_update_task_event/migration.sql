ALTER TYPE "TaskStatus" ADD VALUE 'OUT_OF_CREDITS';
ALTER TYPE "TaskStatus" ADD VALUE 'CREDITS_TOPPED_UP';
ALTER TYPE "TaskStatus" ADD VALUE 'CANCEL_REQUESTED';

ALTER TABLE "taskEvent" ADD COLUMN "cents" BIGINT;

UPDATE "taskEvent" AS "te"
SET "cents" = "t"."amount"
FROM "Transaction" AS "t"
WHERE "te"."transactionId" = "t"."id";
