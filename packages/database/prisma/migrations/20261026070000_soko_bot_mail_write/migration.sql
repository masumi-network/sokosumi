-- AlterTable
ALTER TABLE "soko_bot" ADD COLUMN     "mailAutoRead" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "soko_bot_mail_draft" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sokoBotId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "to" TEXT[],
    "subject" TEXT NOT NULL,
    "turnId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),
    "sentByTurnId" TEXT,

    CONSTRAINT "soko_bot_mail_draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "soko_bot_mail_draft_sokoBotId_draftId_key" ON "soko_bot_mail_draft"("sokoBotId", "draftId");

-- AddForeignKey
ALTER TABLE "soko_bot_mail_draft" ADD CONSTRAINT "soko_bot_mail_draft_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

