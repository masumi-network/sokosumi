ALTER TABLE "user"
  ADD COLUMN "sidebarLayout" JSONB,
  ADD COLUMN "sidebarSeenItems" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
