-- Step 1: Drop the trigger if it exists
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

-- Step 2: Drop the function if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc
    WHERE proname = 'notify_job_status_update'
  ) THEN
    EXECUTE 'DROP FUNCTION notify_job_status_update()';
  END IF;
END;
$$;