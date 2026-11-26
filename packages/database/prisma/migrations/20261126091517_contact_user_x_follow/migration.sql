-- AlterTable
ALTER TABLE "contact" ADD COLUMN "userId" TEXT;

-- CreateTable
CREATE TABLE "contact_x_follow" (
    "contactId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "followsUser" BOOLEAN NOT NULL DEFAULT false,
    "followedByUser" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_x_follow_pkey" PRIMARY KEY ("contactId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "contact_workspaceId_userId_key" ON "contact"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "contact_x_follow_userId_idx" ON "contact_x_follow"("userId");

-- AddForeignKey
ALTER TABLE "contact" ADD CONSTRAINT "contact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_x_follow" ADD CONSTRAINT "contact_x_follow_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_x_follow" ADD CONSTRAINT "contact_x_follow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Everyone the follower walk added follows the teammate whose X it read.
INSERT INTO "contact_x_follow" ("contactId", "userId", "followsUser", "updatedAt")
SELECT DISTINCT m."contactId", m."addedByUserId", true, CURRENT_TIMESTAMP
FROM "contact_list_member" m
JOIN "contact_list" l ON l."id" = m."listId"
JOIN "user" u ON u."id" = m."addedByUserId"
WHERE l."name" = 'X followers' AND m."addedAutomatically"
ON CONFLICT DO NOTHING;
