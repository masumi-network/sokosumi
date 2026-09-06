-- SOK-961: rewrite mascot-pool URLs after the Vercel Blob prefix moves
-- from soko-bot-avatars/ to soko-bots/avatars/. Idempotent. Copy objects in Blob first;
-- this only updates stored public URLs. sourceUrl stays the fal origin.

UPDATE "soko_bot_avatar"
SET "imageUrl" = replace("imageUrl", '/soko-bot-avatars/', '/soko-bots/avatars/')
WHERE "imageUrl" LIKE '%/soko-bot-avatars/%';

UPDATE "soko_bot"
SET "avatarImageUrl" = replace("avatarImageUrl", '/soko-bot-avatars/', '/soko-bots/avatars/')
WHERE "avatarImageUrl" LIKE '%/soko-bot-avatars/%';
