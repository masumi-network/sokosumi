-- Align conversation primary key and conversationMessage FK with Prisma @db.Uuid (PostgreSQL UUID).

-- DropForeignKey
ALTER TABLE "conversationMessage" DROP CONSTRAINT "conversationMessage_conversationId_fkey";

-- AlterTable
ALTER TABLE "conversation" ALTER COLUMN "id" SET DATA TYPE UUID USING ("id"::uuid);

-- AlterTable
ALTER TABLE "conversationMessage" ALTER COLUMN "conversationId" SET DATA TYPE UUID USING ("conversationId"::uuid);

-- AddForeignKey
ALTER TABLE "conversationMessage" ADD CONSTRAINT "conversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
