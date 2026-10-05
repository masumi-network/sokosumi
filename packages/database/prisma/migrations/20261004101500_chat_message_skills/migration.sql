-- CreateTable
CREATE TABLE "skill_catalog_entry" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "installs" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER,
    "markdown" TEXT,
    "markdownFetchedAt" TIMESTAMP(3),
    "refreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_catalog_entry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_room_message_skill" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "skillId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,

    CONSTRAINT "chat_room_message_skill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "skill_catalog_entry_installs_idx" ON "skill_catalog_entry"("installs");

-- CreateIndex
CREATE UNIQUE INDEX "chat_room_message_skill_messageId_skillId_key" ON "chat_room_message_skill"("messageId", "skillId");

-- AddForeignKey
ALTER TABLE "chat_room_message_skill" ADD CONSTRAINT "chat_room_message_skill_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
