-- CreateEnum
CREATE TYPE "DataRoomStorage" AS ENUM ('MOVING_IN', 'PRIVATE', 'MOVING_OUT');

-- CreateTable
CREATE TABLE "data_room" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceScope" "FileSourceScope" NOT NULL,
    "ownerId" TEXT NOT NULL,
    "folderPath" TEXT NOT NULL,
    "storage" "DataRoomStorage" NOT NULL DEFAULT 'MOVING_IN',
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "data_room_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_room_sourceScope_ownerId_folderPath_key" ON "data_room"("sourceScope", "ownerId", "folderPath");

-- CreateIndex
CREATE INDEX "data_room_storage_idx" ON "data_room"("storage");

-- AddForeignKey
ALTER TABLE "data_room" ADD CONSTRAINT "data_room_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
