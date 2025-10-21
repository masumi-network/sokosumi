-- DropForeignKey
ALTER TABLE "Agent" DROP CONSTRAINT "Agent_ratingId_fkey";

-- DropIndex
DROP INDEX "Agent_ratingId_key";

-- AlterTable
ALTER TABLE "Agent" DROP COLUMN "ratingId";

-- AlterTable
ALTER TABLE "UserAgentRating" DROP COLUMN "title",
DROP COLUMN "description",
ADD COLUMN "comment" TEXT,
ALTER COLUMN "stars" DROP NOT NULL;

-- RenameColumn
ALTER TABLE "UserAgentRating" RENAME COLUMN "stars" TO "rating";

-- AlterColumn
ALTER TABLE "UserAgentRating" ALTER COLUMN "rating" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "UserAgentRating_userId_agentId_key" ON "UserAgentRating"("userId", "agentId");

-- DropTable
DROP TABLE "AgentRating";

-- Add CHECK constraint for rating (1-5)
ALTER TABLE "UserAgentRating" 
ADD CONSTRAINT "UserAgentRating_rating_check" 
CHECK (rating >= 1 AND rating <= 5);
