-- Retire Org Directs (ADR-0059): every Direct whose members are all human is a
-- Personal Direct, owned by no Organization.
--
-- Human Directs with the same participant key (an Org Direct beside a Personal
-- Direct, or Org Directs in several Organizations) merge into one: the oldest
-- room survives; messages (with their Threads, Reactions, attachments and
-- mentions), pins, message signals and members move to it; each reader keeps
-- the latest read state of their copies; the other rooms are deleted. Then no
-- human Direct keeps an Organization. Members an earlier Organization exit
-- removed are not put back, and links into merged-away rooms are not
-- redirected. Directs with a coworker or Soko Bot are left untouched.
--
-- Organization exit (`chat_room_hard_leave_on_organization_member_delete`)
-- acts only on rooms the Organization owns, so from here it keeps Personal
-- Directs. The rejoin trigger that put a returning member back into Org
-- Directs, and the participant-key parser it needed, go away.

DROP TRIGGER IF EXISTS chat_room_restore_directs_on_organization_member_insert ON "member";
DROP FUNCTION IF EXISTS chat_room_restore_directs_on_organization_member_insert();
DROP FUNCTION IF EXISTS chat_direct_key_user_ids(text);

-- Human Directs by participant key. Keys: `a:b` (1:1), `direct:self:<id>`,
-- `direct:v2:user:..` (group); AI keys name a `coworker:` or `sokoBot:`.
CREATE TEMP TABLE retire_org_directs_room AS
SELECT
  r."id",
  first_value(r."id") OVER (
    PARTITION BY r."directKey" ORDER BY r."createdAt", r."id"
  ) AS "survivorId",
  r."groupName",
  r."updatedAt",
  r."archivedAt"
FROM "chat_room" r
WHERE r."kind" = 'direct'
  AND r."directKey" IS NOT NULL
  AND (
    r."directKey" LIKE 'direct:self:%'
    OR (
      r."directKey" LIKE 'direct:v2:%'
      AND r."directKey" NOT LIKE '%:coworker:%'
      AND r."directKey" NOT LIKE '%:sokoBot:%'
    )
    OR cardinality(string_to_array(r."directKey", ':')) = 2
  )
  AND NOT EXISTS (SELECT 1 FROM "chat_room_coworker_member" c WHERE c."roomId" = r."id")
  AND NOT EXISTS (SELECT 1 FROM "chat_room_soko_bot_member" s WHERE s."roomId" = r."id");

-- A lone Personal Direct has nothing to merge or clear.
DELETE FROM retire_org_directs_room d
WHERE NOT EXISTS (
  SELECT 1 FROM retire_org_directs_room o
  WHERE o."survivorId" = d."survivorId" AND o."id" <> d."id"
)
AND d."id" IN (SELECT "id" FROM "chat_room" WHERE "organizationId" IS NULL);

-- Survivors that take another room in.
CREATE TEMP TABLE retire_org_directs_merge AS
SELECT DISTINCT "survivorId" FROM retire_org_directs_room WHERE "id" <> "survivorId";

-- Stream-turn idempotency ids are unique per room; keep the first of a clash.
UPDATE "chat_room_message" m
SET "clientMessageId" = NULL
FROM (
  SELECT
    m2."id",
    row_number() OVER (
      PARTITION BY d."survivorId", m2."clientMessageId"
      ORDER BY (m2."roomId" = d."survivorId") DESC, m2."createdAt", m2."id"
    ) AS rn
  FROM "chat_room_message" m2
  JOIN retire_org_directs_room d ON d."id" = m2."roomId"
  WHERE m2."clientMessageId" IS NOT NULL
) clash
WHERE m."id" = clash."id" AND clash.rn > 1;

UPDATE "chat_room_message" m
SET "responsesApiResponseId" = NULL
FROM (
  SELECT
    m2."id",
    row_number() OVER (
      PARTITION BY d."survivorId", m2."responsesApiResponseId"
      ORDER BY (m2."roomId" = d."survivorId") DESC, m2."createdAt", m2."id"
    ) AS rn
  FROM "chat_room_message" m2
  JOIN retire_org_directs_room d ON d."id" = m2."roomId"
  WHERE m2."responsesApiResponseId" IS NOT NULL
) clash
WHERE m."id" = clash."id" AND clash.rn > 1;

UPDATE "chat_room_message" m
SET "roomId" = d."survivorId"
FROM retire_org_directs_room d
WHERE m."roomId" = d."id" AND d."id" <> d."survivorId";

UPDATE "chat_room_pinned_message" p
SET "roomId" = d."survivorId"
FROM retire_org_directs_room d
WHERE p."roomId" = d."id" AND d."id" <> d."survivorId";

UPDATE "chat_message_signal" s
SET "roomId" = d."survivorId"
FROM retire_org_directs_room d
WHERE s."roomId" = d."id" AND d."id" <> d."survivorId";

-- Members combined; a Pin on any copy wins, else the survivor's row.
INSERT INTO "chat_room_user_member" ("id", "roomId", "userId", "access", "starredAt", "mutedAt", "createdAt")
SELECT DISTINCT ON (d."survivorId", m."userId")
  gen_random_uuid(), d."survivorId", m."userId", m."access", m."starredAt", m."mutedAt", m."createdAt"
FROM "chat_room_user_member" m
JOIN retire_org_directs_room d ON d."id" = m."roomId"
JOIN retire_org_directs_merge g ON g."survivorId" = d."survivorId"
ORDER BY
  d."survivorId",
  m."userId",
  (m."starredAt" IS NOT NULL) DESC,
  (d."id" = d."survivorId") DESC,
  m."createdAt"
ON CONFLICT ("roomId", "userId") DO UPDATE
SET "starredAt" = EXCLUDED."starredAt", "mutedAt" = EXCLUDED."mutedAt";

-- Each reader's read state is the latest of their copies.
INSERT INTO "chat_room_read_state" ("id", "roomId", "userId", "lastReadAt", "markedUnreadAt", "createdAt", "updatedAt")
SELECT DISTINCT ON (d."survivorId", rs."userId")
  gen_random_uuid(), d."survivorId", rs."userId", rs."lastReadAt", rs."markedUnreadAt", rs."createdAt", CURRENT_TIMESTAMP
FROM "chat_room_read_state" rs
JOIN retire_org_directs_room d ON d."id" = rs."roomId"
JOIN retire_org_directs_merge g ON g."survivorId" = d."survivorId"
ORDER BY d."survivorId", rs."userId", rs."lastReadAt" DESC
ON CONFLICT ("roomId", "userId") DO UPDATE
SET
  "lastReadAt" = EXCLUDED."lastReadAt",
  "markedUnreadAt" = EXCLUDED."markedUnreadAt",
  "updatedAt" = CURRENT_TIMESTAMP;

DELETE FROM "chat_room" r
USING retire_org_directs_room d
WHERE r."id" = d."id" AND d."id" <> d."survivorId";

-- Survivors: no Organization, the newest activity, a Group name from any copy,
-- and archived only when every copy was.
UPDATE "chat_room" r
SET
  "organizationId" = NULL,
  "groupName" = COALESCE(r."groupName", copies."groupName"),
  "updatedAt" = GREATEST(r."updatedAt", copies."updatedAt"),
  "archivedAt" = CASE WHEN copies."live" THEN NULL ELSE r."archivedAt" END
FROM (
  SELECT
    "survivorId",
    max("groupName") AS "groupName",
    max("updatedAt") AS "updatedAt",
    bool_or("archivedAt" IS NULL) AS "live"
  FROM retire_org_directs_room
  GROUP BY "survivorId"
) copies
WHERE r."id" = copies."survivorId";

DROP TABLE retire_org_directs_merge;
DROP TABLE retire_org_directs_room;
