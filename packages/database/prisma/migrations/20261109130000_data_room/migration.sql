-- CreateEnum
CREATE TYPE "DataRoomStorage" AS ENUM ('MOVING_IN', 'PRIVATE', 'MOVING_OUT');

-- CreateEnum
CREATE TYPE "DataRoomEventKind" AS ENUM ('ENTER', 'VIEW', 'DOWNLOAD', 'DOWNLOAD_ALL', 'ASK');

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
    "token" TEXT NOT NULL,
    "title" TEXT,
    "logoFileId" UUID,
    "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "allowDownload" BOOLEAN NOT NULL DEFAULT false,
    "watermark" BOOLEAN NOT NULL DEFAULT true,
    "notifyOnFirstVisit" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "data_room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_room_member" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "roomId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "invitedByUserId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "folderPaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "firstVisitAt" TIMESTAMP(3),
    "lastVisitAt" TIMESTAMP(3),
    "previousVisitAt" TIMESTAMP(3),
    "codeHash" TEXT,
    "codeExpiresAt" TIMESTAMP(3),
    "codeAttempts" INTEGER NOT NULL DEFAULT 0,
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "data_room_member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_room_event" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "roomId" UUID NOT NULL,
    "memberId" UUID,
    "kind" "DataRoomEventKind" NOT NULL,
    "path" TEXT,

    CONSTRAINT "data_room_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_room_entry" (
    "roomId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "position" INTEGER NOT NULL,

    CONSTRAINT "data_room_entry_pkey" PRIMARY KEY ("roomId","path")
);

-- CreateTable
CREATE TABLE "data_room_question" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "roomId" UUID NOT NULL,
    "memberId" UUID NOT NULL,
    "path" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "answer" TEXT,
    "answeredByUserId" TEXT,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "data_room_question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "data_room_token_key" ON "data_room"("token");

-- CreateIndex
CREATE INDEX "data_room_storage_idx" ON "data_room"("storage");

-- CreateIndex
CREATE UNIQUE INDEX "data_room_sourceScope_ownerId_folderPath_key" ON "data_room"("sourceScope", "ownerId", "folderPath");

-- CreateIndex
CREATE UNIQUE INDEX "data_room_member_roomId_email_key" ON "data_room_member"("roomId", "email");

-- CreateIndex
CREATE INDEX "data_room_event_roomId_createdAt_idx" ON "data_room_event"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "data_room_event_memberId_createdAt_idx" ON "data_room_event"("memberId", "createdAt");

-- CreateIndex
CREATE INDEX "data_room_question_roomId_createdAt_idx" ON "data_room_question"("roomId", "createdAt");

-- AddForeignKey
ALTER TABLE "data_room" ADD CONSTRAINT "data_room_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_member" ADD CONSTRAINT "data_room_member_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "data_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_event" ADD CONSTRAINT "data_room_event_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "data_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_event" ADD CONSTRAINT "data_room_event_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "data_room_member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_entry" ADD CONSTRAINT "data_room_entry_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "data_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_question" ADD CONSTRAINT "data_room_question_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "data_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_room_question" ADD CONSTRAINT "data_room_question_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "data_room_member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
