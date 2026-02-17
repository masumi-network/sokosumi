/*
  Warnings:

  - This migration will fail if `attachment.name`, `attachment.mimeType`,
    or `attachment.size` still contain NULL values.
*/

ALTER TABLE "attachment" ALTER COLUMN "name" SET NOT NULL;
ALTER TABLE "attachment" ALTER COLUMN "mimeType" SET NOT NULL;
ALTER TABLE "attachment" ALTER COLUMN "size" SET NOT NULL;
