-- SOK-946: rewrite stored room keys and mention tokens from orchestrator: to
-- sokoBot:. Idempotent: rows already on the new prefix do not match WHERE.
-- Issued API keys stay orchestrator_ / sokoBot_; only the token prefix is
-- stored hashed, so those secrets cannot be rewritten.

UPDATE "chat_room"
SET "directKey" = replace("directKey", 'orchestrator:', 'sokoBot:')
WHERE "directKey" LIKE '%orchestrator:%';

UPDATE "chat_room_message"
SET "content" = replace("content", '@orchestrator:', '@sokoBot:')
WHERE "content" LIKE '%@orchestrator:%';
