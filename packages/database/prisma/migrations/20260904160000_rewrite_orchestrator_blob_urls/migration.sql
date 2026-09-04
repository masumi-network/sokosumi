-- SOK-946: rewrite chat-attachment URLs after the Vercel Blob prefix moves
-- from orchestrators/ to soko-bots/. Idempotent. Copy objects in Blob first;
-- this only updates markdown that already stored the public URL.

UPDATE "chat_room_message"
SET "content" = replace("content", '/orchestrators/', '/soko-bots/')
WHERE "content" LIKE '%/orchestrators/%';
