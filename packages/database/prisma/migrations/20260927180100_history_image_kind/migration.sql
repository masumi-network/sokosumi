-- One history row per generated image version.
--
-- Extends the trigger coverage matrix first declared in
-- 20260602162500_add_history_feed:
-- - project_image_asset INSERT/UPDATE/DELETE: upsert or remove the IMAGE
--   history row. entityId is the *asset* id, not the job id, so the feed row
--   deep-links straight to the image a person is looking for.
-- - project_image_job UPDATE of "chargedCents" / "refundTransactionId":
--   recompute the owning asset's IMAGE row, because the amount a history row
--   reports is the charge net of any refund and both of those live on the job.
--
-- Why a trigger and not an application write: every other kind in this feed is
-- trigger-maintained, and a second mechanism would mean two places that can
-- disagree about whether a row exists. Settlement already runs from a webhook, a
-- cron and a page load; a trigger on the asset insert is the one path all three
-- share.
--
-- The enum is replaced rather than extended with ALTER TYPE ... ADD VALUE, which
-- cannot be used in the same transaction that added it — and this migration
-- backfills existing assets, so it needs the value immediately.

-- AlterEnum
CREATE TYPE "HistoryKind_new" AS ENUM ('TASK', 'JOB', 'IMAGE');
ALTER TABLE "history"
  ALTER COLUMN "kind" TYPE "HistoryKind_new"
  USING ("kind"::text::"HistoryKind_new");
ALTER TYPE "HistoryKind" RENAME TO "HistoryKind_old";
ALTER TYPE "HistoryKind_new" RENAME TO "HistoryKind";
DROP TYPE "HistoryKind_old";

-- What the person actually paid for this image, in "Transaction"."amount" units.
--
-- The charge minus any compensating refund, so a generation that failed and was
-- paid back reads as zero rather than as a cost the person never bore. GREATEST
-- clamps it at zero: a refund is written for the full debit, and a refund larger
-- than its debit would otherwise show as a negative spend in the feed.
CREATE OR REPLACE FUNCTION history_image_amount(job_id UUID)
RETURNS BIGINT
LANGUAGE sql
STABLE
AS $$
  SELECT GREATEST(
    COALESCE(j."chargedCents", 0)
      - COALESCE(
          (
            SELECT t."amount"
            FROM "Transaction" AS t
            WHERE t."id" = j."refundTransactionId"
          ),
          0
        ),
    0
  )::BIGINT
  FROM "project_image_job" AS j
  WHERE j."id" = job_id;
$$;

CREATE OR REPLACE FUNCTION upsert_history_image_asset(asset_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  source RECORD;
  spend BIGINT;
BEGIN
  SELECT
    a."id",
    a."jobId",
    a."projectId",
    a."workspaceId",
    a."prompt",
    a."model",
    a."createdAt",
    j."requestedByUserId",
    w."organizationId"
  INTO source
  FROM "project_image_asset" AS a
  JOIN "project_image_job" AS j ON j."id" = a."jobId"
  LEFT JOIN "workspace" AS w ON w."id" = a."workspaceId"
  WHERE a."id" = asset_id;

  IF NOT FOUND THEN
    DELETE FROM "history"
    WHERE "kind" = 'IMAGE'::"HistoryKind"
      AND "entityId" = asset_id::TEXT;
    RETURN;
  END IF;

  spend := history_image_amount(source."jobId");

  INSERT INTO "history" (
    "id",
    "kind",
    "entityId",
    "userId",
    "workspaceId",
    "organizationId",
    "title",
    "description",
    "status",
    "sortAt",
    "amount",
    "projectId",
    "agentId",
    "coworkerId",
    "sokoBotId",
    "bucketSlug",
    "archivedAt"
  )
  VALUES (
    gen_random_uuid()::TEXT,
    'IMAGE'::"HistoryKind",
    source."id"::TEXT,
    source."requestedByUserId",
    source."workspaceId",
    source."organizationId",
    -- The prompt is the only thing that tells these rows apart, so it is the
    -- title. Bounded because a prompt may be four thousand characters and a feed
    -- row is one line.
    left(source."prompt", 200),
    -- `<provider endpoint> · <credits> credits`, in that order and with that
    -- separator, because the Core history route parses the endpoint back out of
    -- it to resolve the model's display label from the live studio catalog. SQL
    -- cannot see those labels — they come from a provider API read in
    -- TypeScript — and freezing one into the row would leave it wrong the moment
    -- fal renamed the model. The endpoint is also what the feed's text search
    -- matches on, and it stays true for a model fal has since withdrawn.
    --
    -- Integer division is exact: the credits contract rounds every charge up to
    -- a whole credit, and the API returns the authoritative decimal.
    source."model" || ' · ' || (spend / 10000000000)::TEXT || ' credits',
    'active',
    source."createdAt",
    spend,
    source."projectId",
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  )
  ON CONFLICT ("kind", "entityId") DO UPDATE
  SET
    "userId" = EXCLUDED."userId",
    "workspaceId" = EXCLUDED."workspaceId",
    "organizationId" = EXCLUDED."organizationId",
    "title" = EXCLUDED."title",
    "description" = EXCLUDED."description",
    "status" = EXCLUDED."status",
    "sortAt" = EXCLUDED."sortAt",
    "amount" = EXCLUDED."amount",
    "projectId" = EXCLUDED."projectId",
    "agentId" = EXCLUDED."agentId",
    "coworkerId" = EXCLUDED."coworkerId",
    "sokoBotId" = EXCLUDED."sokoBotId",
    "bucketSlug" = EXCLUDED."bucketSlug",
    "archivedAt" = EXCLUDED."archivedAt";
END;
$$;

CREATE OR REPLACE FUNCTION sync_history_from_project_image_asset()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM "history"
    WHERE "kind" = 'IMAGE'::"HistoryKind"
      AND "entityId" = OLD."id"::TEXT;
    RETURN OLD;
  END IF;

  PERFORM upsert_history_image_asset(NEW."id");
  RETURN NEW;
END;
$$;

CREATE TRIGGER history_project_image_asset_sync
  AFTER INSERT OR UPDATE OR DELETE ON "project_image_asset"
  FOR EACH ROW
  EXECUTE FUNCTION sync_history_from_project_image_asset();

-- The charge and the refund live on the job, so the amount an image reports can
-- change without the asset row being touched at all.
CREATE OR REPLACE FUNCTION sync_history_from_project_image_job_charge()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  owned_asset_id UUID;
BEGIN
  SELECT "id" INTO owned_asset_id
  FROM "project_image_asset"
  WHERE "jobId" = NEW."id";

  IF owned_asset_id IS NOT NULL THEN
    PERFORM upsert_history_image_asset(owned_asset_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER history_project_image_job_charge_sync
  AFTER UPDATE ON "project_image_job"
  FOR EACH ROW
  WHEN (
    OLD."chargedCents" IS DISTINCT FROM NEW."chargedCents"
    OR OLD."refundTransactionId" IS DISTINCT FROM NEW."refundTransactionId"
  )
  EXECUTE FUNCTION sync_history_from_project_image_job_charge();

-- Existing versions were generated before the studio charged for anything, so
-- they backfill with an amount of zero. That is the truth about them, not a
-- placeholder.
SELECT upsert_history_image_asset("id")
FROM "project_image_asset";
