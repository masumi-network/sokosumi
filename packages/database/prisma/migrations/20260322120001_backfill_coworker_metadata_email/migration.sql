DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'coworker'
      AND column_name = 'email'
  ) THEN
    UPDATE "coworker"
    SET "metadata" = jsonb_set(
      COALESCE("metadata", '{}'::jsonb),
      '{channels}',
      jsonb_set(
        COALESCE(
          COALESCE("metadata", '{}'::jsonb) -> 'channels',
          '{}'::jsonb
        ),
        '{email}',
        to_jsonb(BTRIM("email")),
        true
      ),
      true
    )
    WHERE "email" IS NOT NULL
      AND BTRIM("email") <> '';
  END IF;
END $$;
