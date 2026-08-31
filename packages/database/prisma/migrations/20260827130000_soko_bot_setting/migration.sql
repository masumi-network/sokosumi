-- Single-row platform settings for Soko Bot. The promoted default may be a
-- built-in version id or an authored slug, so it cannot live as a flag on the
-- authored table.
CREATE TABLE "soko_bot_setting" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "defaultVersionId" TEXT,

    CONSTRAINT "soko_bot_setting_pkey" PRIMARY KEY ("id")
);
