/*
  Warnings:

  - A unique constraint on `attachment.url` will be added.
    If duplicate URLs exist across rows, this migration will fail.
*/

-- Drop the now-redundant composite unique index
DROP INDEX IF EXISTS "attachment_jobInputId_url_key";

-- Enforce global URL uniqueness for attachments
CREATE UNIQUE INDEX IF NOT EXISTS "attachment_url_key" ON "attachment"("url");
