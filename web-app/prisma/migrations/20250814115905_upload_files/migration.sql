-- CreateTable
CREATE TABLE "public"."uploadfiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploadfiles_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "public"."uploadfiles" ADD CONSTRAINT "uploadfiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."uploadfiles" ADD CONSTRAINT "uploadfiles_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "public"."Job"("id") ON DELETE CASCADE ON UPDATE CASCADE;
