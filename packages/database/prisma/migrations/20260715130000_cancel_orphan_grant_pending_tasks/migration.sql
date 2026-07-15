-- Repair tasks stuck in GRANT_PENDING with no linked grant (e.g. grant deleted before trigger).
UPDATE "task"
SET
  "status" = 'CANCELED'::"TaskStatus",
  "grantResumeStatus" = NULL,
  "updatedAt" = CURRENT_TIMESTAMP
WHERE "status" = 'GRANT_PENDING'::"TaskStatus"
  AND "pendingVendorGrantId" IS NULL;

-- Cancel parked tasks before vendor_grant delete clears pendingVendorGrantId via FK.
CREATE OR REPLACE FUNCTION cancel_grant_pending_tasks_on_grant_delete()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "task"
  SET
    "status" = 'CANCELED'::"TaskStatus",
    "grantResumeStatus" = NULL,
    "updatedAt" = CURRENT_TIMESTAMP
  WHERE "pendingVendorGrantId" = OLD."id"
    AND "status" = 'GRANT_PENDING'::"TaskStatus"
    AND "archivedAt" IS NULL;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vendor_grant_delete_cancel_parked_tasks
BEFORE DELETE ON "vendor_grant"
FOR EACH ROW
EXECUTE FUNCTION cancel_grant_pending_tasks_on_grant_delete();
