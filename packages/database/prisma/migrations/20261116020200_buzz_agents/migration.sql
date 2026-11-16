-- AlterTable
ALTER TABLE "buzz_identity" ALTER COLUMN "encryptedSecretKey" DROP NOT NULL,
ADD COLUMN "ownerIdentityId" UUID;

-- CreateIndex
CREATE INDEX "buzz_identity_ownerIdentityId_idx" ON "buzz_identity"("ownerIdentityId");

-- AddForeignKey
ALTER TABLE "buzz_identity" ADD CONSTRAINT "buzz_identity_ownerIdentityId_fkey" FOREIGN KEY ("ownerIdentityId") REFERENCES "buzz_identity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
