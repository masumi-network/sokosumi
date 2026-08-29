-- Console-authored Soko Bot versions. The built-in versions stay in code as
-- the immutable baseline; these coexist in the same slug namespace.
CREATE TABLE "soko_bot_authored_version" (
    "id" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL,
    "inferenceRegion" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "skills" TEXT[],
    "capabilities" TEXT[],
    "archivedAt" TIMESTAMP(3),
    "createdById" TEXT,

    CONSTRAINT "soko_bot_authored_version_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "soko_bot_authored_version_slug_key"
    ON "soko_bot_authored_version"("slug");

CREATE INDEX "soko_bot_authored_version_archivedAt_updatedAt_idx"
    ON "soko_bot_authored_version"("archivedAt", "updatedAt");

ALTER TABLE "soko_bot_authored_version"
    ADD CONSTRAINT "soko_bot_authored_version_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
