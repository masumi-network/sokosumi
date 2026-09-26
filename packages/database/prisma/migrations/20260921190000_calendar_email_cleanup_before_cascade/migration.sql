-- Capture pending provider IDs before the membership FK cascades notifications.
-- PostgreSQL locks the member row before this BEFORE DELETE trigger runs, so
-- publishers retain the same member-row -> advisory-lock order as deletion.
DROP TRIGGER calendar_access_cleanup_member_delete ON "member";
CREATE TRIGGER calendar_access_cleanup_member_delete
BEFORE DELETE ON "member"
FOR EACH ROW EXECUTE FUNCTION calendar_access_cleanup_on_member_delete();
