ALTER TABLE "buzz_channel" DROP CONSTRAINT "buzz_channel_roomId_fkey";
ALTER TABLE "buzz_channel" ALTER COLUMN "roomId" DROP NOT NULL;
ALTER TABLE "buzz_channel" ADD CONSTRAINT "buzz_channel_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
