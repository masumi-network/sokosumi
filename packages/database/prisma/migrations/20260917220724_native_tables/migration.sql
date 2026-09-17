-- CreateTable
CREATE TABLE "data_table" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "projectId" UUID,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdBy" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_table_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_column" (
    "id" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "type" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "position" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "table_column_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_row" (
    "id" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "values" JSONB NOT NULL DEFAULT '{}',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "table_row_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_view" (
    "id" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "definition" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "table_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_change" (
    "id" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorKind" TEXT NOT NULL,
    "taskId" TEXT,
    "rowId" UUID,
    "columnId" UUID,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_change_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_operation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "tableId" UUID NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "table_task_scope" (
    "id" UUID NOT NULL,
    "tableId" UUID NOT NULL,
    "taskId" TEXT NOT NULL,
    "rowIds" TEXT[],
    "columnIds" TEXT[],
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "table_task_scope_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "data_table_workspaceId_archivedAt_createdAt_id_idx" ON "data_table"("workspaceId", "archivedAt", "createdAt", "id");

-- CreateIndex
CREATE INDEX "data_table_projectId_idx" ON "data_table"("projectId");

-- CreateIndex
CREATE INDEX "table_column_tableId_position_idx" ON "table_column"("tableId", "position");

-- CreateIndex
CREATE INDEX "table_row_tableId_archivedAt_id_idx" ON "table_row"("tableId", "archivedAt", "id");

-- CreateIndex
CREATE INDEX "table_view_tableId_idx" ON "table_view"("tableId");

-- CreateIndex
CREATE INDEX "table_change_tableId_createdAt_id_idx" ON "table_change"("tableId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "table_change_tableId_batchId_idx" ON "table_change"("tableId", "batchId");

-- CreateIndex
CREATE INDEX "table_change_tableId_rowId_columnId_idx" ON "table_change"("tableId", "rowId", "columnId");

-- CreateIndex
CREATE INDEX "table_operation_tableId_idx" ON "table_operation"("tableId");

-- CreateIndex
CREATE UNIQUE INDEX "table_operation_workspaceId_actorId_key_key" ON "table_operation"("workspaceId", "actorId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "table_task_scope_taskId_key" ON "table_task_scope"("taskId");

-- CreateIndex
CREATE INDEX "table_task_scope_tableId_idx" ON "table_task_scope"("tableId");

-- AddForeignKey
ALTER TABLE "data_table" ADD CONSTRAINT "data_table_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_table" ADD CONSTRAINT "data_table_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_column" ADD CONSTRAINT "table_column_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_row" ADD CONSTRAINT "table_row_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_view" ADD CONSTRAINT "table_view_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_change" ADD CONSTRAINT "table_change_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_operation" ADD CONSTRAINT "table_operation_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "table_task_scope" ADD CONSTRAINT "table_task_scope_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "data_table"("id") ON DELETE CASCADE ON UPDATE CASCADE;
