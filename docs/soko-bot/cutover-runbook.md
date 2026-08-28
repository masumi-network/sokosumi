# Soko Bot cutover runbook

Hard gate: do not enable first-party Soko Bot production traffic until every
check below has owner, timestamp, evidence link, and pass result.

This is a hard cut, not a dual-write migration. Current Core contains no live
Hermes route, client, inbox worker, or reverse-sync path. Database migration
copies legacy messages once, and repository importer handles schedules only.
Freeze Hermes before final exports and keep it frozen until either Soko Bot
cutover succeeds or a pinned pre-cut release is restored.

## Before deployment

- Set Soko Bot production configuration to `SOKO_BOT_ENABLED=false`.
- Freeze all external Hermes message, inbox, and schedule writers. Record
  freeze timestamp and source deployment version. Do not take final exports
  before freeze.
- Obtain final schedule export from external Hermes owner. Repository has no
  Hermes exporter. Export must match schema accepted by
  `apps/core/scripts/import-soko-bot-cutover.mts`; save immutable file, digest,
  source count, and `generatedAt`. Empty export needs explicit confirmation.
- Dry-run exact importer command from repository root:

  ```sh
  pnpm --filter core soko-bot:import-cutover -- /secure/hermes-schedules.json
  ```

  Resolve every duplicate id, missing active bot, inaccessible workspace,
  target collision, invalid cron, or timezone. Dry-run writes nothing.
- After freeze, record total `hermesMessage` count and verify every distinct
  message owner has an `orchestrator` mapping. Any unmapped owner blocks cutover
  and migration fails explicitly; no source message is an allowed omission.
  Migration preserves every ID, user-visible message content, and step count
  only. Raw legacy `steps` payloads/reasoning are deliberately discarded.
- Inventory Composio connected-account IDs and owners. Pending database claims
  expire in migration; connected accounts require provider-side revocation.
- Snapshot pre-cut Core/Web and Hermes deployment versions, configuration, and
  secrets for rollback. Store secrets in approved secret manager, not evidence
  attachments.

## Deploy and verify

1. Confirm Hermes remains frozen, then run existing migration command:

   ```sh
   pnpm prisma:migrate:deploy
   ```

2. Using read-only SQL, compare total source count with
   `soko_bot_legacy_message`; compare IDs in both directions with `EXCEPT`; and
   verify every target `stepCount` equals source-side `jsonb_array_length`
   projection. Queries must return counts/IDs only, never raw `steps`. Any
   mismatch blocks traffic switch.
3. Apply schedule import atomically:

   ```sh
   pnpm --filter core soko-bot:import-cutover -- /secure/hermes-schedules.json --apply --confirm-source-frozen
   ```

   Importer rejects partial apply: any invalid row means zero schedule writes.
   Archive JSON report; require `applied=true`, `invalid=0`, and total matching
   frozen source count. Rerun is idempotent by `legacyScheduleId` and refuses a
   source id already bound to another user/bot/workspace.
4. Verify imported schedule count and sample next-run timestamps/timezones.
5. Deploy Eve runtime, Core, then Web. Keep production
   `SOKO_BOT_ENABLED=false`. Run signed auth, billing, runtime health, and one
   canary delegation in preview/staging configured with flag enabled.
6. After preview evidence passes, enable `SOKO_BOT_ENABLED=true` in production.
   Current code has no per-user cohort gate: this is global switch unless
   separately provisioned edge traffic controls exist. Monitor failed turns,
   lease age, runtime cost, credit usage, and schedule dead letters.
7. Revoke inventoried Composio connected accounts in provider console/API.
   Export revocation receipts. Remove Hermes/Composio production secrets only
   after rollback window closes.

There is no repository reconciliation or repair command beyond schedule
importer. On mismatch, keep Hermes frozen and Soko Bot disabled. Diagnose with
read-only queries; any repair needs separately reviewed, incident-scoped,
idempotent tooling with dry-run evidence before production execution.

Use following read-only reconciliation SQL. It returns counts or IDs, never
message/step bodies:

```sql
SELECT
  (SELECT count(*) FROM "hermesMessage") AS expected,
  (SELECT count(*) FROM "soko_bot_legacy_message") AS actual;

SELECT count(*) AS unmapped_message_count
FROM "hermesMessage" AS message
LEFT JOIN "orchestrator" AS bot ON bot."userId" = message."userId"
WHERE bot."id" IS NULL;

WITH expected AS (
  SELECT message."id"
  FROM "hermesMessage" AS message
), differences AS (
  (SELECT 'missing' AS direction, "id" FROM expected
   EXCEPT
   SELECT 'missing', "id" FROM "soko_bot_legacy_message")
  UNION ALL
  (SELECT 'unexpected' AS direction, "id" FROM "soko_bot_legacy_message"
   EXCEPT
   SELECT 'unexpected', "id" FROM expected)
)
SELECT direction, "id" FROM differences ORDER BY direction, "id";

SELECT target."id"
FROM "soko_bot_legacy_message" AS target
INNER JOIN "hermesMessage" AS message ON message."id" = target."id"
WHERE target."stepCount" <> CASE
  WHEN jsonb_typeof(message."steps") = 'array'
    THEN jsonb_array_length(message."steps")
  WHEN jsonb_typeof(message."steps") = 'object'
    AND jsonb_typeof(message."steps" -> 'steps') = 'array'
    THEN jsonb_array_length(message."steps" -> 'steps')
  ELSE 0
END
OR target."role" IS DISTINCT FROM message."role"
OR target."content" IS DISTINCT FROM message."content"
OR target."kind" IS DISTINCT FROM message."kind"
OR target."durationMs" IS DISTINCT FROM message."durationMs";
```

## Rollback

- Disable `SOKO_BOT_ENABLED`; stops new first-party turns and schedule claims
  without deleting data.
- Stop first-party Eve runtime ingress. Preserve Soko Bot tables for diagnosis.
- Redeploy pinned pre-cut Core/Web and Hermes builds. Confirm they accept
  additive schema, restore required secrets, and prove exactly one writer
  before unfreezing Hermes. Current release cannot serve Hermes traffic.
- If Composio revocation already ran, restore Hermes only after users
  re-authorize connections; never silently recreate credentials.
- Reconcile first-party Tasks/Jobs created during canary by delegation records.
  No reverse sync exists. Do not delete or recreate them automatically.
- Imported schedules and legacy copies remain in additive tables; pre-cut code
  ignores them. Do not roll migration back or mutate append-only admin audit.
- Legacy physical `orchestrator`, `hermesMessage`, and
  `hermesPendingConnection` tables remain through rollback window. New Core
  treats legacy Hermes tables read-only.

## Decommission

- After rollback window: destroy Hermes deployment, revoke remaining service
  credentials, and file separate retention-approved migrations for legacy
  tables. Never fold destructive cleanup into initial cutover migration.
