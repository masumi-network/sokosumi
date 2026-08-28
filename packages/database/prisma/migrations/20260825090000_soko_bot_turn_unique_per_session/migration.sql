-- Eve turn ids are only unique within a session (Eve 0.38 emits `turn_0` per
-- session), and Core opens one Eve session per turn. Scope the uniqueness to
-- the session so a bot's second turn no longer collides with its first.
DROP INDEX "soko_bot_turn_sokoBotId_eveTurnId_key";
CREATE UNIQUE INDEX "soko_bot_turn_sokoBotId_eveSessionId_eveTurnId_key" ON "soko_bot_turn"("sokoBotId", "eveSessionId", "eveTurnId");
