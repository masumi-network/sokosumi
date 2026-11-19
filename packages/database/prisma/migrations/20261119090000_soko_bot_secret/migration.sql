-- A personal Soko Bot's saved keys and sandbox setup commands (ADR 0074).
ALTER TABLE "soko_bot" ADD COLUMN "sandboxSetupCommands" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE "soko_bot_secret" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sokoBotId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "shellAccess" BOOLEAN NOT NULL DEFAULT false,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "soko_bot_secret_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "soko_bot_secret_sokoBotId_name_key" ON "soko_bot_secret"("sokoBotId", "name");

ALTER TABLE "soko_bot_secret" ADD CONSTRAINT "soko_bot_secret_sokoBotId_fkey" FOREIGN KEY ("sokoBotId") REFERENCES "soko_bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
