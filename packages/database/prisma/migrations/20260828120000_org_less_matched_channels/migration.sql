-- Matched channels are org-less: kind=channel, organizationId NULL,
-- discoverability='matched', slug required. Guests-only-on-external triggers
-- are unchanged; matched rooms use access=member only.

ALTER TABLE "chat_room" DROP CONSTRAINT "chat_room_channel_org_check";

-- Org channels keep an organization and must not be matched. Matched channels
-- are org-less only (discoverability='matched', slug required).
ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_channel_org_check"
  CHECK (
    ("kind" = 'direct')
    OR (
      "kind" = 'channel'
      AND "organizationId" IS NOT NULL
      AND "discoverability" IS DISTINCT FROM 'matched'
    )
    OR (
      "kind" = 'channel'
      AND "organizationId" IS NULL
      AND "discoverability" = 'matched'
      AND "slug" IS NOT NULL
    )
  );

ALTER TABLE "chat_room" DROP CONSTRAINT "chat_room_direct_key_check";

ALTER TABLE "chat_room" ADD CONSTRAINT "chat_room_direct_key_check"
  CHECK (
    ("kind" = 'direct' AND "directKey" IS NOT NULL)
    OR ("kind" = 'channel' AND "directKey" IS NULL)
  );

-- Org-scoped channel slugs stay unique via chat_room_organizationId_channel_slug_key.
-- Org-less (matched) channel slugs need their own partial unique: Postgres UNIQUE
-- treats NULL organizationId as distinct, so (NULL, slug) pairs would otherwise collide.
CREATE UNIQUE INDEX "chat_room_org_less_channel_slug_key"
  ON "chat_room"("slug")
  WHERE "kind" = 'channel' AND "organizationId" IS NULL AND "slug" IS NOT NULL;
