# Core services/schemas quality audit (research)

Scope (read-only): `apps/core/src/{services,schemas,clients,types,soko-bot-runner,middleware,config}`.

Hard skips honored: task-schedule legacy vendor layer (#5239), image-studio bind/resume (#5359), oauth2 shim (#4390), namefully, onInvalidPreviousResponseId, vendor skills, held D/E/I.

Method: export inventory across the seven trees; inverted-index usage over `apps/core` + `packages` (`.ts`); route import graph for schemas; repository method call sites from Core production code.

## Findings

1. **Nested schema over-export (strongest schemas cleanup)** — `apps/core/src/schemas/**` — lens: orphaned export / needless public surface. ~194 schema symbols referenced only inside their defining file (composition builders). Heaviest: `soko-bot.schema.ts` (23), `chat-room.schema.ts` (18), `admin.schema.ts` (10), `agent.schema.ts` / `project.schema.ts` (9 each), `transaction-history.schema.ts` (8). Routes import parent schemas; nested `export const` is optional. Suggested kill: drop `export` on same-file-only builders (keep `.openapi("…")` names). Size **M**. Confidence **high**.

2. **Service internals over-exported** — `apps/core/src/services/**` — lens: unused export. Same-file-only value exports include `summarizeContextPacket`, `mapSocialPost`, `buildProjectMemoryPrompt`, `sokoBotCapabilityLabel`, `loadWindowExtractionStates`, `seedCandidateTerms`, `RELATED_*_LIMIT`, `RETRY_WINDOW_MS` / `MISSED_AFTER_MS`, `FILE_PREVIEW_MAX_BYTES`, `MAX_ACTIVE_SOKO_BOT_SCHEDULES`, `TASK_TAG_SUGGESTION_ADMISSION`, avatar helpers (`AVATAR_MODEL`, `buildAvatarPrompt`, `nextAvatarDraws`, `AvatarGenerationCappedError`), `SokoBotIngestSyncService` class (singleton stays). Suggested kill: unexport (not delete). Size **S**. Confidence **high**.

3. **Image Studio `refunded` always-false wire field** — `services/image-studio-assets.service.ts`, `schemas/project-image-studio.schema.ts`, routes that echo `refunded: false` — lens: leftover after merge / deprecated dual-path. Documented “kept for one release”; Web image-studio UI no longer branches on it. Suggested kill: remove field from `JobView`, Zod schema, and route fixtures; regenerate core-client. Size **S**. Confidence **medium-high** (confirm no external client still reads it). Not bind/resume (#5359).

4. **`SokoBotDisabledError` dual-path** — `services/soko-bot-control-plane.service.ts` + `routes/v1/soko-bots/helpers.ts` — lens: dual-path / incomplete error mapping. `startTurn` throws `SokoBotDisabledError`; HTTP gate uses `getSokoBotAvailability` → 503; `mapControlPlaneError` does not map the class; schedule/ingest/event sync catchers treat it like a hard failure, not a soft disable. Suggested kill: map to a stable kind in sync + `mapControlPlaneError`, or stop throwing a distinct class and share one disable path. Size **S**. Confidence **high** (complexity; not a dead module).

5. **Job `userId` / `user` dual-emit** — `types/job.ts`, `schemas/job.schema.ts` — lens: deprecated dual-path. Still emitted “until clients migrate”. Suggested kill: after client audit (Web/Apple/generated), remove aliases from flatten + OpenAPI. Size **M**. Confidence **medium** (migration gate).

6. **Legacy Content Studio folder rename dual-path** — `services/image-studio-files.service.ts` (`LEGACY_IMAGE_GENERATION_FOLDER_NAME`) — lens: leftover dual-path. Lookup accepts old `"Image generation"` and renames. Suggested kill: one-shot rename SQL/backfill, then drop legacy name constant. Size **S**. Confidence **medium** (data-dependent).

7. **`notificationsOptIn` deprecated preference field** — `schemas/user.schema.ts` — lens: leftover flag/field. Marked deprecated; Apple/Web fixtures still carry it. Suggested kill: only after clients stop sending/expecting it. Size **S**. Confidence **low** for immediate remove.

8. **Client test-only exports** — `clients/social-post-providers/{tiktok,youtube}.ts` (`pickTikTokPrivacyLevel`, `deriveYouTubeTitle`) — lens: unused export. Suggested kill: unexport; keep tests via same-module or dedicated test helpers. Size **S**. Confidence **high**.

9. **Config/middleware unexport noise** — `config/cors-allow-origin.ts` (`isLocalDevHostname`); types/interfaces exported only for local annotation — lens: unused export. Suggested kill: unexport helpers/types not imported elsewhere. Size **S**. Confidence **medium** (interfaces used as return types are fine public).

10. **Comment density in x402 / agent-sync** — e.g. `task-x402-payment.purge.ts` (~55% comment lines), `agent-sync.readiness.ts`, `notification-follow-up-sync.service.ts` — lens: noisy comments. Suggested kill: trim narrative that restates code; keep invariants. Size **S–M**. Confidence **medium** (style; no behavior win).

## Non-findings

- **No orphan service modules.** Every production service file under `services/` has a non-test importer (including relative imports).
- **No dead `@sokosumi/database` repository modules or async methods** called from Core. All listed repositories still have live Core callers. Legacy repository use in services is OK; nothing to delete as unused wrappers.
- **No whole schema file unused by routes.** `domain-enums.schema` / `blob-upload-grant.schema` are schema-only building blocks by design (consumed by other schemas). Apparent “orphan” hits from `.js` import suffixes were false positives.
- **Vendor skills service is live** (`routes/v1/soko-bots/skills/*`); not proposed for removal.
- **Task-schedule services** left untouched per #5239.
- **OAuth2 shim / namefully / onInvalidPreviousResponseId** outside kill proposals.
- **Clients entrypoints** (`stripeClient`, `paymentClient`, `registryClient`, social publishers, etc.) all have production callers.
- **soko-bot-runner** tools are runner-bundled; test-only exports of `workspacePath` / `htmlToText` are fine seams.
- **Lab judge** `loadLabJudgePayload` / `judgeTurnWithModel` used from `apps/core/scripts/*.mts` (`.mts` outside `.ts` index) — keep exported.

## Strongest cleanup slice

1. Unexport nested schemas in `soko-bot.schema.ts` + `chat-room.schema.ts` (largest safe surface cut).
2. Unexport same-file service internals listed in finding 2.
3. Remove Image Studio `refunded` after a quick client grep confirmation.
4. Close `SokoBotDisabledError` mapping gap (behavior clarity, not just cosmetics).
