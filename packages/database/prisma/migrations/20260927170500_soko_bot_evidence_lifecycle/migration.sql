-- Remove only operational rows whose required owner was already deleted before
-- foreign keys existed. Retain every linked inbox, claim, and committed receipt.
DELETE FROM "soko_bot_event_inbox" i WHERE
  NOT EXISTS (SELECT 1 FROM "soko_bot" b WHERE b.id = i."botId") OR
  NOT EXISTS (SELECT 1 FROM "soko_bot_turn" t WHERE t.id = i."turnId");
UPDATE "soko_bot_event_inbox" i SET "designatedHandlerBotId" = NULL
  WHERE "designatedHandlerBotId" IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM "soko_bot" b WHERE b.id = i."designatedHandlerBotId");
DELETE FROM "soko_bot_task_action_claim" c WHERE
  NOT EXISTS (SELECT 1 FROM "task" t WHERE t.id = c."taskId") OR
  NOT EXISTS (SELECT 1 FROM "soko_bot" b WHERE b.id = c."handlerBotId") OR
  NOT EXISTS (SELECT 1 FROM "soko_bot_turn" t WHERE t.id = c."turnId");
-- Invalid receipt pointers are not reset: migration must fail rather than make
-- an existing action claim replayable without its committed evidence.
ALTER TABLE "soko_bot_event_inbox" ADD CONSTRAINT "soko_bot_event_inbox_botId_fkey" FOREIGN KEY ("botId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_event_inbox" ADD CONSTRAINT "soko_bot_event_inbox_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_event_inbox" ADD CONSTRAINT "soko_bot_event_inbox_designatedHandlerBotId_fkey" FOREIGN KEY ("designatedHandlerBotId") REFERENCES "soko_bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "soko_bot_task_action_claim" ADD CONSTRAINT "soko_bot_task_action_claim_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_task_action_claim" ADD CONSTRAINT "soko_bot_task_action_claim_handlerBotId_fkey" FOREIGN KEY ("handlerBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_task_action_claim" ADD CONSTRAINT "soko_bot_task_action_claim_turnId_fkey" FOREIGN KEY ("turnId") REFERENCES "soko_bot_turn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "soko_bot_task_action_claim" ADD CONSTRAINT "soko_bot_task_action_claim_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "soko_bot_tool_call"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
CREATE INDEX "soko_bot_intent_targetIds_idx" ON "soko_bot_intent" USING GIN ("targetIds" jsonb_path_ops);
