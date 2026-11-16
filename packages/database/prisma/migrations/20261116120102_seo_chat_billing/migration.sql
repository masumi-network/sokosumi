-- Nullable additions preserve historical free turns and the previous Core release.
ALTER TABLE "seo_audit_chat_turn"
  ADD COLUMN "usage" JSONB,
  ADD COLUMN "transactionId" TEXT;

CREATE UNIQUE INDEX "seo_audit_chat_turn_transactionId_key"
  ON "seo_audit_chat_turn"("transactionId");

ALTER TABLE "seo_audit_chat_turn"
  ADD CONSTRAINT "seo_audit_chat_turn_transactionId_fkey"
  FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
