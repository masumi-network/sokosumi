-- CreateTable
CREATE TABLE "cmo_polar_order" (
    "polarOrderId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMP(3),

    CONSTRAINT "cmo_polar_order_pkey" PRIMARY KEY ("polarOrderId")
);
