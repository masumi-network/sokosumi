-- CreateTable
CREATE TABLE "drive_google_sheet" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resourceId" UUID NOT NULL,
    "spreadsheetId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,

    CONSTRAINT "drive_google_sheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "drive_google_sheet_resourceId_key" ON "drive_google_sheet"("resourceId");

-- CreateIndex
CREATE INDEX "drive_google_sheet_syncedAt_idx" ON "drive_google_sheet"("syncedAt");

-- AddForeignKey
ALTER TABLE "drive_google_sheet" ADD CONSTRAINT "drive_google_sheet_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
