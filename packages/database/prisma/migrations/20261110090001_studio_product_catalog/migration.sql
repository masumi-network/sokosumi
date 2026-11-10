-- CreateTable
CREATE TABLE "project_studio_product_catalog" (
    "projectId" UUID NOT NULL,
    "products" JSONB NOT NULL,
    "revision" INTEGER NOT NULL,

    CONSTRAINT "project_studio_product_catalog_pkey" PRIMARY KEY ("projectId")
);

-- AddForeignKey
ALTER TABLE "project_studio_product_catalog" ADD CONSTRAINT "project_studio_product_catalog_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
