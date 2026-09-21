-- Run with psql -v ON_ERROR_STOP=1 -f this-file.sql against a disposable database.
-- Include the real composite FK: without it AFTER DELETE incorrectly looks safe.
BEGIN;
CREATE SCHEMA calendar_email_cleanup_test;
SET LOCAL search_path TO calendar_email_cleanup_test;
CREATE TABLE workspace (id uuid PRIMARY KEY, "organizationId" text);
CREATE TABLE member (id text PRIMARY KEY, "organizationId" text, "userId" text);
CREATE TABLE notification (id text PRIMARY KEY, "userId" text, "workspaceId" uuid, "emailId" text, "emailScheduledAt" timestamptz);
ALTER TABLE member ADD UNIQUE ("userId", "organizationId");
ALTER TABLE notification ADD COLUMN "organizationId" text DEFAULT 'org1';
ALTER TABLE notification ADD CONSTRAINT notification_organization_member_fkey FOREIGN KEY ("userId", "organizationId") REFERENCES member("userId", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE captured_outbox (payload jsonb);
CREATE FUNCTION enqueue_calendar_invalidation(uuid, uuid, uuid, jsonb) RETURNS void LANGUAGE sql AS $$ INSERT INTO captured_outbox VALUES ($4) $$;
\ir ../migrations/20260921180000_calendar_notification_email_cleanup/migration.sql
CREATE TRIGGER calendar_access_cleanup_member_delete AFTER DELETE ON member FOR EACH ROW EXECUTE FUNCTION calendar_access_cleanup_on_member_delete();
\ir ../migrations/20260921190000_calendar_email_cleanup_before_cascade/migration.sql
INSERT INTO workspace VALUES ('11111111-1111-4111-8111-111111111111', 'org1');
INSERT INTO member VALUES ('m1','org1','u1'), ('m2','org1','u2');
INSERT INTO notification (id,"userId","workspaceId","emailId","emailScheduledAt") VALUES
 ('pending','u1','11111111-1111-4111-8111-111111111111','email-pending', now()+interval '30 minutes'),
 ('sent','u1','11111111-1111-4111-8111-111111111111','email-sent', now()-interval '1 minute'),
 ('other','u2','11111111-1111-4111-8111-111111111111','email-other', now()+interval '30 minutes');
DELETE FROM member WHERE id='m1';
DO $$
BEGIN
  IF (SELECT payload->'pendingNotificationEmails'->0->>'emailId' FROM captured_outbox) IS DISTINCT FROM 'email-pending'
    OR (SELECT jsonb_array_length(payload->'pendingNotificationEmails') FROM captured_outbox) <> 1 THEN
    RAISE EXCEPTION 'Pending email ID was lost during membership cascade';
  END IF;
  IF EXISTS (SELECT FROM notification WHERE "userId" = 'u1')
    OR NOT EXISTS (SELECT FROM notification WHERE id = 'other') THEN
    RAISE EXCEPTION 'Cleanup must remove only the departed member notifications';
  END IF;
END;
$$;
ROLLBACK;
