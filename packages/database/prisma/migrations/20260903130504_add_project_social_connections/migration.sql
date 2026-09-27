-- CreateTable
CREATE TABLE "project_social_connection" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalHandle" TEXT,
    "composioConnectedAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "activeExternalAccountKey" TEXT,
    "connectorUserId" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3),
    "disconnectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_social_connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_social_connection_intent" (
    "connectionId" TEXT NOT NULL,
    "projectId" UUID NOT NULL,
    "initiatingUserId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "socialConnectionId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_social_connection_intent_pkey" PRIMARY KEY ("connectionId")
);

-- CreateTable
CREATE TABLE "project_social_connection_audit" (
    "id" UUID NOT NULL,
    "projectSocialConnectionId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "externalAccountId" TEXT NOT NULL,
    "externalHandle" TEXT,
    "providerOutcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_social_connection_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_social_connection_projectId_activeExternalAccountKe_key" ON "project_social_connection"("projectId", "activeExternalAccountKey");

-- CreateIndex
CREATE INDEX "project_social_connection_intent_expiresAt_idx" ON "project_social_connection_intent"("expiresAt");

-- CreateIndex
CREATE INDEX "project_social_connection_audit_projectSocialConnectionId_c_idx" ON "project_social_connection_audit"("projectSocialConnectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "project_social_connection" ADD CONSTRAINT "project_social_connection_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_social_connection_intent" ADD CONSTRAINT "project_social_connection_intent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_social_connection_audit" ADD CONSTRAINT "project_social_connection_audit_projectSocialConnectionId_fkey" FOREIGN KEY ("projectSocialConnectionId") REFERENCES "project_social_connection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
