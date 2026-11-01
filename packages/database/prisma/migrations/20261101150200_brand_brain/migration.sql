-- The Brand Brain is the Project's (ADR 0062): one per Project, read by every
-- bot in it, edited and confirmed by any member of its Workspace.
CREATE TABLE "brand_brain" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" UUID NOT NULL,
    "body" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedByUserId" TEXT,

    CONSTRAINT "brand_brain_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "brand_brain_projectId_key" ON "brand_brain"("projectId");

ALTER TABLE "brand_brain" ADD CONSTRAINT "brand_brain_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "brand_brain" ADD CONSTRAINT "brand_brain_confirmedByUserId_fkey" FOREIGN KEY ("confirmedByUserId") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
