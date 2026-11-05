-- AlterTable
ALTER TABLE "user" ADD COLUMN     "tagDirectMessages" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "chat_message_signal" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lease" TEXT,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "probabilities" JSONB,
    "addressedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "commitmentDueAt" TIMESTAMP(3),
    "loopClosedAt" TIMESTAMP(3),
    "loopTaskId" UUID,
    "model" TEXT,
    "version" TEXT,
    "taggedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_message_signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message_signal_correction" (
    "id" UUID NOT NULL,
    "signalId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "applies" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chat_message_signal_correction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_catch_up_summary" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "messageIds" TEXT[],
    "content" JSONB NOT NULL,
    "model" TEXT NOT NULL,
    "costUsd" DOUBLE PRECISION,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_catch_up_summary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_signal_messageId_key" ON "chat_message_signal"("messageId");

-- CreateIndex
CREATE INDEX "chat_message_signal_state_availableAt_idx" ON "chat_message_signal"("state", "availableAt");

-- CreateIndex
CREATE INDEX "chat_message_signal_roomId_taggedAt_idx" ON "chat_message_signal"("roomId", "taggedAt");

-- CreateIndex
CREATE INDEX "chat_message_signal_correction_userId_idx" ON "chat_message_signal_correction"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "chat_message_signal_correction_signalId_userId_tag_key" ON "chat_message_signal_correction"("signalId", "userId", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "chat_catch_up_summary_userId_scope_key" ON "chat_catch_up_summary"("userId", "scope");

-- AddForeignKey
ALTER TABLE "chat_message_signal" ADD CONSTRAINT "chat_message_signal_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "chat_room_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_signal" ADD CONSTRAINT "chat_message_signal_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_signal_correction" ADD CONSTRAINT "chat_message_signal_correction_signalId_fkey" FOREIGN KEY ("signalId") REFERENCES "chat_message_signal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message_signal_correction" ADD CONSTRAINT "chat_message_signal_correction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_catch_up_summary" ADD CONSTRAINT "chat_catch_up_summary_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
