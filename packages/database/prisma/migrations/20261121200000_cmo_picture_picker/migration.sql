-- AlterTable
ALTER TABLE "project" ADD COLUMN "cmoPictureStyle" TEXT,
ADD COLUMN "cmoPictureStyleSource" TEXT;

-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN "styleLayoutOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "reference_image" ADD COLUMN "composition" TEXT;

-- CreateTable
CREATE TABLE "cmo_picture_pick" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "marketingStrategyId" UUID NOT NULL,
    "pieceId" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "visualKey" TEXT NOT NULL,
    "candidateJobIds" UUID[],
    "chosenJobId" UUID,
    "reason" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "pickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cmo_picture_pick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "cmo_picture_pick_projectId_pickedAt_idx" ON "cmo_picture_pick"("projectId", "pickedAt");

-- CreateIndex
CREATE UNIQUE INDEX "cmo_picture_pick_marketingStrategyId_pieceId_slot_visualKey_key" ON "cmo_picture_pick"("marketingStrategyId", "pieceId", "slot", "visualKey");

-- AddForeignKey
ALTER TABLE "cmo_picture_pick" ADD CONSTRAINT "cmo_picture_pick_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
