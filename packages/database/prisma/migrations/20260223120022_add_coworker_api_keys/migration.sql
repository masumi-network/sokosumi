-- Create coworker API keys table
CREATE TABLE "coworker_api_key" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "keyHash" TEXT NOT NULL,
    "keyStart" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "coworkerId" TEXT NOT NULL,

    CONSTRAINT "coworker_api_key_pkey" PRIMARY KEY ("id")
);

-- Unique index for key hash lookup
CREATE UNIQUE INDEX "coworker_api_key_keyHash_key" ON "coworker_api_key"("keyHash");

-- Supporting indexes for management and validation queries
CREATE INDEX "coworker_api_key_coworkerId_idx" ON "coworker_api_key"("coworkerId");
CREATE INDEX "coworker_api_key_revokedAt_expiresAt_idx" ON "coworker_api_key"("revokedAt", "expiresAt");

-- Foreign key to coworker
ALTER TABLE "coworker_api_key"
ADD CONSTRAINT "coworker_api_key_coworkerId_fkey"
FOREIGN KEY ("coworkerId") REFERENCES "coworker"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;
