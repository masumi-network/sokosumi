-- Step 1: Create the trigger function
CREATE OR REPLACE FUNCTION outbox_notify()
RETURNS trigger AS $$
BEGIN
	PERFORM pg_notify('ably_adbc'::text, ''::text);
	RETURN NULL;
EXCEPTION
	-- ensure this function can never throw an uncaught exception
	WHEN others THEN
		RAISE WARNING 'unexpected error in %s: %%', SQLERRM;
		RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Step 2: Drop the trigger if it exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'outbox_trigger'
    AND tgrelid = '"outbox"'::regclass
  ) THEN
    EXECUTE 'DROP TRIGGER outbox_trigger ON "outbox"';
  END IF;
END;
$$;

-- Step 3: Create the trigger
CREATE TRIGGER outbox_trigger
AFTER INSERT ON outbox
FOR EACH STATEMENT EXECUTE PROCEDURE outbox_notify();
