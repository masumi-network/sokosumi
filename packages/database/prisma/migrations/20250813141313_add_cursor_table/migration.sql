-- CreateTable
CREATE TABLE "public"."cursor" (
    "id" TEXT NOT NULL,
    "cursor" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cursor_pkey" PRIMARY KEY ("id")
);
