-- Run with psql -v ON_ERROR_STOP=1 -f this-file.sql against a disposable database.
BEGIN;
CREATE SCHEMA org_rejoin_directs_test;
SET LOCAL search_path TO org_rejoin_directs_test, public;
CREATE TABLE member (id text PRIMARY KEY, "organizationId" text, "userId" text);
CREATE TABLE chat_room (id uuid PRIMARY KEY, "organizationId" text, kind text, "directKey" text, "archivedAt" timestamp);
CREATE TABLE chat_room_user_member (id uuid PRIMARY KEY, "roomId" uuid, "userId" text, access text DEFAULT 'member', "createdAt" timestamp);
CREATE UNIQUE INDEX ON chat_room_user_member ("roomId", "userId");
CREATE TABLE chat_room_read_state (id uuid PRIMARY KEY, "roomId" uuid, "userId" text, "lastReadAt" timestamp, "createdAt" timestamp, "updatedAt" timestamp);
CREATE UNIQUE INDEX ON chat_room_read_state ("roomId", "userId");
\ir ../migrations/20261002084512_org_rejoin_restores_directs/migration.sql

-- Rooms of org1 that keep Andreas (a) after Sarthi (s) left.
INSERT INTO chat_room VALUES
 ('00000000-0000-4000-8000-000000000001', 'org1', 'direct', 'a:s', NULL),
 ('00000000-0000-4000-8000-000000000002', 'org1', 'direct', 'direct:v2:user:a:user:b:user:s', NULL),
 ('00000000-0000-4000-8000-000000000003', 'org1', 'channel', NULL, NULL),
 ('00000000-0000-4000-8000-000000000004', 'org2', 'direct', 'a:s', NULL),
 ('00000000-0000-4000-8000-000000000005', 'org1', 'direct', 'a:b', NULL),
 ('00000000-0000-4000-8000-000000000006', 'org1', 'direct', 'direct:v2:coworker:s:user:a:user:b', NULL),
 ('00000000-0000-4000-8000-000000000007', 'org1', 'direct', 'coworker:s:c1', NULL);
INSERT INTO chat_room_user_member (id, "roomId", "userId") VALUES
 (gen_random_uuid(), '00000000-0000-4000-8000-000000000001', 'a'),
 (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', 'a'),
 (gen_random_uuid(), '00000000-0000-4000-8000-000000000002', 'b'),
 (gen_random_uuid(), '00000000-0000-4000-8000-000000000003', 'a'),
 (gen_random_uuid(), '00000000-0000-4000-8000-000000000004', 'a'),
 (gen_random_uuid(), '00000000-0000-4000-8000-000000000005', 'a');

DO $$
BEGIN
  IF chat_direct_key_user_ids('a:s') <> ARRAY['a', 's']
    OR chat_direct_key_user_ids('direct:v2:coworker:c1:user:a:user:s') <> ARRAY['a', 's']
    OR chat_direct_key_user_ids('direct:self:a') <> ARRAY[]::text[]
    OR chat_direct_key_user_ids('coworker:a:c1') <> ARRAY[]::text[]
    OR chat_direct_key_user_ids('sokoBot:a:b1') <> ARRAY[]::text[] THEN
    RAISE EXCEPTION 'Participant key parsing must match Core directKeyUserIds';
  END IF;
END;
$$;

INSERT INTO member VALUES ('m-s', 'org1', 's');

DO $$
BEGIN
  IF (SELECT array_agg("roomId"::text ORDER BY "roomId") FROM chat_room_user_member WHERE "userId" = 's')
    IS DISTINCT FROM ARRAY['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002'] THEN
    RAISE EXCEPTION 'Rejoin must restore exactly the org Directs keyed to the member, got %',
      (SELECT array_agg("roomId") FROM chat_room_user_member WHERE "userId" = 's');
  END IF;
  IF (SELECT count(*) FROM chat_room_read_state WHERE "userId" = 's' AND "lastReadAt" IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'Each restored Direct must start caught up';
  END IF;
END;
$$;

-- A second Member row (another path, or a retry) restores nothing twice.
DELETE FROM member WHERE id = 'm-s';
INSERT INTO member VALUES ('m-s2', 'org1', 's');
DO $$
BEGIN
  IF (SELECT count(*) FROM chat_room_user_member WHERE "userId" = 's') <> 2 THEN
    RAISE EXCEPTION 'Restoring twice must not duplicate memberships';
  END IF;
END;
$$;
ROLLBACK;
