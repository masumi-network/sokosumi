CREATE INDEX "soko_bot_nudge_pendingTurnId_idx" ON "soko_bot_nudge"("pendingTurnId");
CREATE INDEX "soko_bot_nudge_sokoBotId_state_expiresAt_idx" ON "soko_bot_nudge"("sokoBotId", "state", "expiresAt");
CREATE INDEX "soko_bot_nudge_sokoBotId_state_snoozedUntil_idx" ON "soko_bot_nudge"("sokoBotId", "state", "snoozedUntil");
