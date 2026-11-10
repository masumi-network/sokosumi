-- CreateTable
CREATE TABLE "project_studio_connection" (
    "projectId" UUID NOT NULL,
    "userId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_studio_connection_pkey" PRIMARY KEY ("projectId", "userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_studio_connection_keyHash_key" ON "project_studio_connection"("keyHash");
CREATE INDEX "project_studio_connection_userId_idx" ON "project_studio_connection"("userId");

-- AddForeignKey
ALTER TABLE "project_studio_connection" ADD CONSTRAINT "project_studio_connection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "project_studio_connection" ADD CONSTRAINT "project_studio_connection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
