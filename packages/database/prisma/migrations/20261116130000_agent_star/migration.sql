-- One user's star on one marketplace Agent. Private shortlist: keyed by
-- (userId, agentId), no workspace column. agentId is the stable Agent row for
-- both Cardano and x402 Agents, so registry revisions keep the star.
-- Additive: a new table only; the previous release never reads it.
--
-- Rollback: DROP TABLE "agent_star";

-- CreateTable
CREATE TABLE "agent_star" (
    "id" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "starredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_star_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_star_userId_agentId_key" ON "agent_star"("userId", "agentId");

-- CreateIndex
-- The unique key leads with userId, so the cascade from agent needs its own.
CREATE INDEX "agent_star_agentId_idx" ON "agent_star"("agentId");

-- AddForeignKey
ALTER TABLE "agent_star" ADD CONSTRAINT "agent_star_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_star" ADD CONSTRAINT "agent_star_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
