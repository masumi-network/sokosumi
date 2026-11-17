CREATE EXTENSION IF NOT EXISTS vector;

-- AlterTable
ALTER TABLE "project_image_job" ADD COLUMN "referenceLibraryIds" UUID[] DEFAULT ARRAY[]::UUID[];

-- CreateTable
CREATE TABLE "reference_image" (
    "id" UUID NOT NULL,
    "libraryPath" TEXT NOT NULL,
    "pathname" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "maker" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "credit" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "era" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "subjects" TEXT[],
    "technique" TEXT NOT NULL,
    "layout" TEXT NOT NULL,
    "lettering" TEXT NOT NULL,
    "palette" TEXT[],
    "mood" TEXT[],
    "suits" TEXT[],
    "textAmount" TEXT NOT NULL,
    "usable" INTEGER NOT NULL,
    "embedding" vector(768),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reference_image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reference_image_libraryPath_key" ON "reference_image"("libraryPath");

-- CreateIndex
CREATE INDEX "reference_image_kind_idx" ON "reference_image"("kind");

-- CreateIndex
CREATE INDEX "reference_image_usable_idx" ON "reference_image"("usable");
