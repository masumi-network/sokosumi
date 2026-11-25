-- CreateTable
CREATE TABLE "project_seo_rank_point" (
    "id" UUID NOT NULL,
    "observationId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "position" DOUBLE PRECISION,
    "positionStatus" TEXT NOT NULL,
    "checkedResults" INTEGER,
    "device" TEXT,

    CONSTRAINT "project_seo_rank_point_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_seo_rank_point_key_observedAt_idx" ON "project_seo_rank_point"("key", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "project_seo_rank_point_observationId_key_key" ON "project_seo_rank_point"("observationId", "key");

-- AddForeignKey
ALTER TABLE "project_seo_rank_point" ADD CONSTRAINT "project_seo_rank_point_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "project_seo_observation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
