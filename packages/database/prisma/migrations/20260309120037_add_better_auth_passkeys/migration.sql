-- CreateTable
CREATE TABLE "public"."passkey" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "publicKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialID" TEXT NOT NULL,
    "counter" INTEGER NOT NULL,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL,
    "transports" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "aaguid" TEXT,

    CONSTRAINT "passkey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "passkey_userId_idx" ON "public"."passkey"("userId");

-- CreateIndex
CREATE INDEX "passkey_credentialID_idx" ON "public"."passkey"("credentialID");

-- AddForeignKey
ALTER TABLE "public"."passkey"
ADD CONSTRAINT "passkey_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE CASCADE ON UPDATE CASCADE;
