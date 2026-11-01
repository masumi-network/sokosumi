-- CreateTable
CREATE TABLE "marketing_strategy_file" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "marketingStrategyId" UUID NOT NULL,
    "entryId" TEXT NOT NULL,
    "fileResourceId" UUID NOT NULL,
    "mediaFileIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "marketing_strategy_file_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_strategy_file_fileResourceId_idx" ON "marketing_strategy_file"("fileResourceId");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_strategy_file_marketingStrategyId_entryId_key" ON "marketing_strategy_file"("marketingStrategyId", "entryId");

-- AddForeignKey
ALTER TABLE "marketing_strategy_file" ADD CONSTRAINT "marketing_strategy_file_marketingStrategyId_fkey" FOREIGN KEY ("marketingStrategyId") REFERENCES "marketing_strategy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_strategy_file" ADD CONSTRAINT "marketing_strategy_file_fileResourceId_fkey" FOREIGN KEY ("fileResourceId") REFERENCES "file_resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

