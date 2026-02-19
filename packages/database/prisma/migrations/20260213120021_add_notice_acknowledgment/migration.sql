-- CreateEnum
CREATE TYPE "NoticeKind" AS ENUM ('LEGAL_TERMS', 'ANNOUNCEMENT');

-- CreateTable
CREATE TABLE "notice" (
    "id" TEXT NOT NULL,
    "kind" "NoticeKind" NOT NULL DEFAULT 'ANNOUNCEMENT',
    "bodyMarkdown" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "noticeAcknowledgment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "noticeAcknowledgment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notice_isActive_effectiveAt_idx" ON "notice"("isActive", "effectiveAt");

-- CreateIndex
CREATE UNIQUE INDEX "noticeAcknowledgment_userId_noticeId_key" ON "noticeAcknowledgment"("userId", "noticeId");

-- CreateIndex
CREATE INDEX "noticeAcknowledgment_userId_acknowledgedAt_idx" ON "noticeAcknowledgment"("userId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "noticeAcknowledgment_noticeId_acknowledgedAt_idx" ON "noticeAcknowledgment"("noticeId", "acknowledgedAt");

-- AddForeignKey
ALTER TABLE "noticeAcknowledgment" ADD CONSTRAINT "noticeAcknowledgment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "noticeAcknowledgment" ADD CONSTRAINT "noticeAcknowledgment_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
