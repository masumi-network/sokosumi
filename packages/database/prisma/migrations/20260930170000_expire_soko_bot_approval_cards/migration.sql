-- Soko Bots no longer wait on owner approval cards: they act, or ask in chat.
-- Cards still pending would keep showing as "approval waiting", and a later
-- "yes" could confirm one, so they expire together with the offers they held.
UPDATE "soko_bot_intent"
SET "state" = 'CANCELLED', "updatedAt" = CURRENT_TIMESTAMP
WHERE "state" = 'AWAITING_CONFIRMATION';

UPDATE "soko_bot_pending_decision"
SET "status" = 'EXPIRED', "resolvedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'PENDING';
