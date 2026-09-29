ALTER TABLE "chat_room_mention" DROP CONSTRAINT "chat_room_mention_status_check";
ALTER TABLE "chat_room_mention" ADD CONSTRAINT "chat_room_mention_status_check"
  CHECK ("status" IN ('staged', 'pending', 'sent', 'responded', 'failed'));
