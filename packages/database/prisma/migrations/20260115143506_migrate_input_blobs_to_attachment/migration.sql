-- CreateTable
CREATE TABLE "attachment" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "mimeType" TEXT,
    "size" BIGINT,
    "userId" TEXT NOT NULL,
    "jobInputId" TEXT NOT NULL,

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- Migrate existing INPUT blobs to attachments
-- Match blobs to JobInput via blob.eventId = jobInput.eventId
INSERT INTO "attachment" ("id", "createdAt", "updatedAt", "url", "name", "mimeType", "size", "userId", "jobInputId")
SELECT 
    gen_random_uuid()::TEXT,
    b."createdAt",
    b."updatedAt",
    b."fileUrl",
    b."fileName",
    b."mime",
    b."size",
    b."userId",
    ji."id"
FROM "blob" b
INNER JOIN "jobInput" ji ON b."eventId" = ji."eventId"
WHERE b."origin" = 'INPUT'
  AND b."fileUrl" IS NOT NULL
  AND b."fileUrl" != '';

-- CreateIndex
CREATE UNIQUE INDEX "attachment_jobInputId_url_key" ON "attachment"("jobInputId", "url");

-- CreateIndex
CREATE INDEX "attachment_jobInputId_idx" ON "attachment"("jobInputId");

-- CreateIndex
CREATE INDEX "attachment_userId_idx" ON "attachment"("userId");

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_jobInputId_fkey" FOREIGN KEY ("jobInputId") REFERENCES "jobInput"("id") ON DELETE CASCADE ON UPDATE CASCADE;
