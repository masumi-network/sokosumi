-- The concurrent build has finished. Swap the live name in one transaction:
-- writers always see a valid key. A repeated cutover has no staging index.
-- Bound the ACCESS EXCLUSIVE lock wait at 5s. On 55P03 the swap rolls back;
-- use prisma migrate resolve --rolled-back 20261128084017_event_inbox_network_cutover
-- on DATABASE_URL_UNPOOLED, then deploy again. A plain retry stops at P3009.
SET lock_timeout = '5s';
DO $$
BEGIN
  IF to_regclass('soko_bot_event_inbox_network_build') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT FROM pg_index
      WHERE indexrelid = 'soko_bot_event_inbox_network_build'::regclass
        AND indisvalid AND indisready AND indisunique
        AND pg_get_indexdef(indexrelid, 0, true) =
          'CREATE UNIQUE INDEX soko_bot_event_inbox_network_build ON soko_bot_event_inbox USING btree '
          '("botId", "eventId", purpose, COALESCE(network, ''mainnet''::text))'
    ) THEN
      RAISE EXCEPTION 'Unsafe staging index. Follow the recovery documented in 20261128084016_event_inbox_network_index before retrying cutover.';
    END IF;
    DROP INDEX "soko_bot_event_inbox_botId_eventId_purpose_key";
    ALTER INDEX "soko_bot_event_inbox_network_build" RENAME TO "soko_bot_event_inbox_botId_eventId_purpose_key";
  END IF;
END $$;
RESET lock_timeout;
