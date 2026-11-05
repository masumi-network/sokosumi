-- CreateEnum
CREATE TYPE "NewsletterIssueStatus" AS ENUM ('DRAFT', 'NEEDS_APPROVAL', 'SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "NewsletterSubscriberStatus" AS ENUM ('PENDING', 'ACTIVE', 'UNSUBSCRIBED', 'BOUNCED');

-- CreateEnum
CREATE TYPE "NewsletterSubscriberSource" AS ENUM ('MANUAL', 'CSV_IMPORT', 'SIGNUP_FORM', 'API');

-- CreateEnum
CREATE TYPE "NewsletterSendStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "NewsletterEventType" AS ENUM ('DELIVERED', 'OPENED', 'CLICKED', 'BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED', 'SUBSCRIBED', 'CONFIRMED');

-- CreateTable
CREATE TABLE "newsletter" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "projectId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "replyTo" TEXT NOT NULL,
    "brand" JSONB NOT NULL DEFAULT '{}',
    "welcomeEmailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "welcomeSubject" TEXT,
    "welcomeBody" TEXT,
    "publicSlug" TEXT NOT NULL,

    CONSTRAINT "newsletter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_issue" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "newsletterId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "previewText" TEXT,
    "template" TEXT NOT NULL DEFAULT 'TEXT',
    "content" JSONB NOT NULL DEFAULT '[]',
    "status" "NewsletterIssueStatus" NOT NULL DEFAULT 'DRAFT',
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT,
    "sentAt" TIMESTAMP(3),
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "creatorUserId" TEXT,
    "creatorCoworkerId" TEXT,
    "creatorSokoBotId" UUID,
    "taskId" TEXT,
    "publicSlug" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "newsletter_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscriber" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "newsletterId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" "NewsletterSubscriberStatus" NOT NULL DEFAULT 'PENDING',
    "source" "NewsletterSubscriberSource" NOT NULL DEFAULT 'MANUAL',
    "consentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "unsubscribedAt" TIMESTAMP(3),
    "bouncedAt" TIMESTAMP(3),

    CONSTRAINT "newsletter_subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_send" (
    "id" UUID NOT NULL,
    "issueId" UUID NOT NULL,
    "subscriberId" UUID NOT NULL,
    "providerMessageId" TEXT,
    "status" "NewsletterSendStatus" NOT NULL DEFAULT 'QUEUED',
    "sentAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "newsletter_send_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_event" (
    "id" UUID NOT NULL,
    "newsletterId" UUID NOT NULL,
    "issueId" UUID,
    "subscriberId" UUID,
    "sendId" UUID,
    "type" "NewsletterEventType" NOT NULL,
    "url" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "providerEventId" TEXT,

    CONSTRAINT "newsletter_event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_projectId_key" ON "newsletter"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_publicSlug_key" ON "newsletter"("publicSlug");

-- CreateIndex
CREATE INDEX "newsletter_workspaceId_idx" ON "newsletter"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_issue_publicSlug_key" ON "newsletter_issue"("publicSlug");

-- CreateIndex
CREATE INDEX "newsletter_issue_newsletterId_status_idx" ON "newsletter_issue"("newsletterId", "status");

-- CreateIndex
CREATE INDEX "newsletter_issue_projectId_status_scheduledAt_idx" ON "newsletter_issue"("projectId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "newsletter_issue_workspaceId_scheduledAt_idx" ON "newsletter_issue"("workspaceId", "scheduledAt");

-- CreateIndex
CREATE INDEX "newsletter_issue_status_scheduledAt_idx" ON "newsletter_issue"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "newsletter_issue_taskId_idx" ON "newsletter_issue"("taskId");

-- CreateIndex
CREATE INDEX "newsletter_subscriber_newsletterId_status_idx" ON "newsletter_subscriber"("newsletterId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_subscriber_newsletterId_email_key" ON "newsletter_subscriber"("newsletterId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_send_providerMessageId_key" ON "newsletter_send"("providerMessageId");

-- CreateIndex
CREATE INDEX "newsletter_send_subscriberId_idx" ON "newsletter_send"("subscriberId");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_send_issueId_subscriberId_key" ON "newsletter_send"("issueId", "subscriberId");

-- CreateIndex
CREATE UNIQUE INDEX "newsletter_event_providerEventId_key" ON "newsletter_event"("providerEventId");

-- CreateIndex
CREATE INDEX "newsletter_event_newsletterId_occurredAt_idx" ON "newsletter_event"("newsletterId", "occurredAt");

-- CreateIndex
CREATE INDEX "newsletter_event_issueId_type_idx" ON "newsletter_event"("issueId", "type");

-- CreateIndex
CREATE INDEX "newsletter_event_subscriberId_idx" ON "newsletter_event"("subscriberId");

-- CreateIndex
CREATE INDEX "newsletter_event_sendId_idx" ON "newsletter_event"("sendId");

-- AddForeignKey
ALTER TABLE "newsletter" ADD CONSTRAINT "newsletter_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter" ADD CONSTRAINT "newsletter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_issue" ADD CONSTRAINT "newsletter_issue_newsletterId_fkey" FOREIGN KEY ("newsletterId") REFERENCES "newsletter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_issue" ADD CONSTRAINT "newsletter_issue_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_issue" ADD CONSTRAINT "newsletter_issue_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_issue" ADD CONSTRAINT "newsletter_issue_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_subscriber" ADD CONSTRAINT "newsletter_subscriber_newsletterId_fkey" FOREIGN KEY ("newsletterId") REFERENCES "newsletter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_send" ADD CONSTRAINT "newsletter_send_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "newsletter_issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_send" ADD CONSTRAINT "newsletter_send_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "newsletter_subscriber"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_event" ADD CONSTRAINT "newsletter_event_newsletterId_fkey" FOREIGN KEY ("newsletterId") REFERENCES "newsletter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_event" ADD CONSTRAINT "newsletter_event_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "newsletter_issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_event" ADD CONSTRAINT "newsletter_event_subscriberId_fkey" FOREIGN KEY ("subscriberId") REFERENCES "newsletter_subscriber"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "newsletter_event" ADD CONSTRAINT "newsletter_event_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "newsletter_send"("id") ON DELETE SET NULL ON UPDATE CASCADE;
