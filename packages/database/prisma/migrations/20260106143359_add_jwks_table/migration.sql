-- CreateTable
CREATE TABLE "jwks" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jwks_pkey" PRIMARY KEY ("id")
);
