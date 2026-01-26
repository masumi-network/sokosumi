-- Rename fileName to name
ALTER TABLE "blob" RENAME COLUMN "fileName" TO "name";

-- Rename mime to mimeType
ALTER TABLE "blob" RENAME COLUMN "mime" TO "mimeType";
