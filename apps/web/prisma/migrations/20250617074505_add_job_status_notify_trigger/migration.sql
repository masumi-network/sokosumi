-- Step 1: Create the trigger function
CREATE OR REPLACE FUNCTION notify_job_status_update() RETURNS trigger AS $$
DECLARE
  payload TEXT;
BEGIN
  IF NEW."onChainStatus" IS DISTINCT FROM OLD."onChainStatus" 
      OR NEW."agentJobStatus" IS DISTINCT FROM OLD."agentJobStatus" THEN

    payload := json_build_object(
      'jobId', NEW."id",
      'userId', NEW."userId",
      'agentId', NEW."agentId",
      'agentJobStatus', NEW."agentJobStatus",
      'onChainStatus', NEW."onChainStatus"
    )::text;

    PERFORM pg_notify('job_status_updated', payload);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Drop the trigger if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trigger_notify_job_status_update'
      AND tgrelid = '"Job"'::regclass
  ) THEN
    EXECUTE 'DROP TRIGGER trigger_notify_job_status_update ON "Job"';
  END IF;
END;
$$;

-- Step 3: Create the trigger on the "Job" table
CREATE TRIGGER trigger_notify_job_status_update
AFTER UPDATE ON "Job"
FOR EACH ROW
WHEN (
  OLD."onChainStatus" IS DISTINCT FROM NEW."onChainStatus"
  OR OLD."agentJobStatus" IS DISTINCT FROM NEW."agentJobStatus"
)
EXECUTE FUNCTION notify_job_status_update();
