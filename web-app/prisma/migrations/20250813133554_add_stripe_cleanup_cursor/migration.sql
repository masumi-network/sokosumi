-- CreateTable
CREATE TABLE "public"."stripe_cleanup_cursor" (
    "id" TEXT NOT NULL DEFAULT 'stripe-cleanup-cursor',
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stripe_cleanup_cursor_pkey" PRIMARY KEY ("id")
);
