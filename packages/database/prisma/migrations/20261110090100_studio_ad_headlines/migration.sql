-- CreateTable
CREATE TABLE "project_image_headline" (
    "assetId" UUID NOT NULL,
    "text" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "project_image_headline_pkey" PRIMARY KEY ("assetId")
);

-- AddForeignKey
ALTER TABLE "project_image_headline" ADD CONSTRAINT "project_image_headline_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "project_image_asset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
