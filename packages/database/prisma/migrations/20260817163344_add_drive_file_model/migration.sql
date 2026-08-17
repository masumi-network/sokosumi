-- CreateTable
CREATE TABLE "drive_file" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "organizationId" TEXT,
    "uploadedByUserId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "mimeType" TEXT,
    "size" BIGINT,

    CONSTRAINT "drive_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drive_file_userId_createdAt_idx" ON "drive_file"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "drive_file_organizationId_createdAt_idx" ON "drive_file"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "drive_file_uploadedByUserId_idx" ON "drive_file"("uploadedByUserId");

-- CreateIndex
CREATE UNIQUE INDEX "drive_file_user_url_key" ON "drive_file"("userId", "fileUrl");

-- CreateIndex
CREATE UNIQUE INDEX "drive_file_org_url_key" ON "drive_file"("organizationId", "fileUrl");

-- AddForeignKey
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Add check constraint: exactly one of userId or organizationId must be set
ALTER TABLE "drive_file" ADD CONSTRAINT "drive_file_owner_check" CHECK (
  ("userId" IS NOT NULL AND "organizationId" IS NULL)
  OR
  ("organizationId" IS NOT NULL AND "userId" IS NULL)
);
