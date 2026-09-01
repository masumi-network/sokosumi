-- SOK-942: Native orchestrator (Soko Bot / PA) chat membership, sender, and mention.
-- Parallel to coworker rails; shadow Coworker creation remains until SOK-944.

-- Room membership for orchestrators (PA).
CREATE TABLE "chat_room_orchestrator_member" (
  "id" UUID NOT NULL,
  "roomId" UUID NOT NULL,
  "orchestratorId" UUID NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_room_orchestrator_member_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "chat_room_orchestrator_member_roomId_orchestratorId_key"
  ON "chat_room_orchestrator_member"("roomId", "orchestratorId");

CREATE INDEX "chat_room_orchestrator_member_orchestratorId_idx"
  ON "chat_room_orchestrator_member"("orchestratorId");

ALTER TABLE "chat_room_orchestrator_member"
  ADD CONSTRAINT "chat_room_orchestrator_member_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "chat_room"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_room_orchestrator_member"
  ADD CONSTRAINT "chat_room_orchestrator_member_orchestratorId_fkey"
  FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Message sender: orchestrator parallel FK.
ALTER TABLE "chat_room_message"
  ADD COLUMN "senderOrchestratorId" UUID;

CREATE INDEX "chat_room_message_senderOrchestratorId_idx"
  ON "chat_room_message"("senderOrchestratorId");

ALTER TABLE "chat_room_message"
  ADD CONSTRAINT "chat_room_message_senderOrchestratorId_fkey"
  FOREIGN KEY ("senderOrchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- At most one of user / coworker / orchestrator sender when any is set.
ALTER TABLE "chat_room_message"
  ADD CONSTRAINT "chat_room_message_sender_exactly_one_check" CHECK (
    (
      ("senderUserId" IS NOT NULL)::int
      + ("senderCoworkerId" IS NOT NULL)::int
      + ("senderOrchestratorId" IS NOT NULL)::int
    ) <= 1
  );

-- Mentions: allow orchestrator target XOR coworker target.
ALTER TABLE "chat_room_mention"
  ALTER COLUMN "coworkerId" DROP NOT NULL;

ALTER TABLE "chat_room_mention"
  ADD COLUMN "orchestratorId" UUID;

-- Drop old unique so we can re-add partial-friendly uniques + XOR.
-- Original chat rooms migration created this as a UNIQUE INDEX (not a table CONSTRAINT).
DROP INDEX IF EXISTS "chat_room_mention_messageId_coworkerId_key";
ALTER TABLE "chat_room_mention"
  DROP CONSTRAINT IF EXISTS "chat_room_mention_messageId_coworkerId_key";

CREATE UNIQUE INDEX "chat_room_mention_messageId_coworkerId_key"
  ON "chat_room_mention"("messageId", "coworkerId")
  WHERE "coworkerId" IS NOT NULL;

CREATE UNIQUE INDEX "chat_room_mention_messageId_orchestratorId_key"
  ON "chat_room_mention"("messageId", "orchestratorId")
  WHERE "orchestratorId" IS NOT NULL;

CREATE INDEX "chat_room_mention_orchestratorId_status_idx"
  ON "chat_room_mention"("orchestratorId", "status");

ALTER TABLE "chat_room_mention"
  ADD CONSTRAINT "chat_room_mention_orchestratorId_fkey"
  FOREIGN KEY ("orchestratorId") REFERENCES "orchestrator"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_room_mention"
  ADD CONSTRAINT "chat_room_mention_target_xor_check" CHECK (
    (
      ("coworkerId" IS NOT NULL AND "orchestratorId" IS NULL)
      OR ("coworkerId" IS NULL AND "orchestratorId" IS NOT NULL)
    )
  );
