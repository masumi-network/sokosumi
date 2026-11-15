-- A Direct's retired DM stays on Buzz until its room is deleted.
ALTER TABLE "buzz_channel" ADD COLUMN "retiredFromRoomId" UUID;
