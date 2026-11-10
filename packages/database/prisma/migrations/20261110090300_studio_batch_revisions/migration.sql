-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN "batchSlotId" UUID;

-- Carry the original slot through earlier single-source refinements. Explicit
-- batches start new slots even when their jobs share an image lineage.
WITH RECURSIVE batch_versions AS (
    SELECT job.id AS "slotId", asset.id AS "assetId", job."projectId", job."workspaceId"
    FROM "project_image_job" AS job
    JOIN "project_image_asset" AS asset
      ON asset."jobId" = job.id
      AND asset."projectId" = job."projectId"
      AND asset."workspaceId" = job."workspaceId"
    WHERE job."batchId" IS NOT NULL AND asset."mediaType" = 'IMAGE'
    UNION ALL
    SELECT parent."slotId", child.id, parent."projectId", parent."workspaceId"
    FROM batch_versions AS parent
    JOIN "project_image_asset" AS child
      ON child."parentId" = parent."assetId"
      AND child."projectId" = parent."projectId"
      AND child."workspaceId" = parent."workspaceId"
    JOIN "project_image_job" AS job
      ON job.id = child."jobId"
      AND job."projectId" = parent."projectId"
      AND job."workspaceId" = parent."workspaceId"
    WHERE job."batchId" IS NULL
      AND job.kind = 'EDIT'
      AND job."referenceAssetIds" = ARRAY[parent."assetId"]
      AND child."mediaType" = 'IMAGE'
)
UPDATE "project_image_job" AS job
SET "batchSlotId" = parent."slotId"
FROM batch_versions AS parent
WHERE job."parentAssetId" = parent."assetId"
  AND job."projectId" = parent."projectId"
  AND job."workspaceId" = parent."workspaceId"
  AND job."batchId" IS NULL
  AND job.kind = 'EDIT'
  AND job."referenceAssetIds" = ARRAY[parent."assetId"];

-- CreateIndex
CREATE INDEX "project_image_job_batchSlotId_idx" ON "project_image_job"("batchSlotId");

-- AddForeignKey
ALTER TABLE "project_image_job" ADD CONSTRAINT "project_image_job_batchSlotId_fkey" FOREIGN KEY ("batchSlotId") REFERENCES "project_image_job"("id") ON DELETE SET NULL ON UPDATE CASCADE;
