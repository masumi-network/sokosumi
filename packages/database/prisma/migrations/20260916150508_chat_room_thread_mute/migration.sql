-- SOK-1087: per-user thread mute. Null = unmuted; a set value stops that
-- thread counting toward room unread and writing CHAT notifications for
-- this user, without changing whether they Participate.
ALTER TABLE "chat_room_thread_read_state" ADD COLUMN "mutedAt" TIMESTAMP(3);
