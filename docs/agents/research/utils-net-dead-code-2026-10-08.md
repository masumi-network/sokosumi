# Research: `@sokosumi/utils` + `@sokosumi/net` cleanup candidates

Date: 2026-10-08  
Scope: `packages/utils/src`, `packages/net/src` (skip `dist`, `node_modules`).  
Method: parse every export in each package `src/index.ts`, then `rg -wn` across `apps/`, `packages/`, `scripts/`. Classify hits as package-internal / prod / test / doc. Also walk non-barrel `export` symbols and unexported modules.  
Permanent skip: do **not** propose changing `namefully` / `getFirstName`. Do **not** propose changing `ssrfSafeFetch` default User-Agent (shipped #5841).

## Public export grep summary

| Package | Barrel exports | Zero prod-code importers (outside package) |
| --- | --- | --- |
| `@sokosumi/utils` | 317 | 4 (`SessionRecord`, `CHAT_MESSAGE_PREVIEW_MAX_LENGTH`, `CURATED_FILE_VOCABULARY`, `JOB_FOLLOW_UP_MESSAGE_KEY`) |
| `@sokosumi/net` | 7 | 0 |

No fully dead source files in either package. `markdown-prose-scan.ts` is intentional internal shared prose scanner (imported by `linkify-bare-domains.ts` + `linkify-channel-links.ts`).

## #5829 protocol enum mirrors

**Already gone.** PR #5829 deleted `packages/utils/src/masumi-protocol.ts` and its barrel exports (`NextJobAction`, `NextJobActionErrorType`, `OnChainTransactionStatus`). File absent on tree. Prisma enums live in `@sokosumi/database`; Core `helpers/purchase.ts` imports from there.  
`SokosumiJobStatus` remains on purpose (no Prisma enum; used by database helpers + Core OpenAPI seeding + web drift test allowlist). **No leftover utils protocol-enum mirrors to kill.**

## Next.js 16.4 dual-path

**None in `packages/utils` or `packages/net`.** No version gates, `unstable_*` dual paths, or Next-specific branches.  
Related but out of package scope: `apps/web/src/lib/utils/notification-service-worker.ts` dual-paths **iOS 16.4** Home Screen / third-party browser push (`isPushInstallable` / `isAppleBrowserUserAgent`) — not Next.js 16.4.

## Numbered findings

### 1. `JOB_FOLLOW_UP_MESSAGE_KEY` — barrel export, prod never imports

- **Paths:** `packages/utils/src/notification-follow-up-message-keys.ts`, barrel in `index.ts`
- **Why:** Comment admits nothing writes it after SOK-930; kept so legacy stored rows still classify via `isFollowUpMessageKey`. Constant itself is only imported by Core/Web **tests**.
- **Suggested action:** Drop from barrel. Keep const (or string literal) inside `NOTIFICATION_FOLLOW_UP_MESSAGE_KEYS`. Tests import string `"Notifications.Job.followUp"` or a test-only helper.
- **Size:** S
- **Grep verified:** 11 hits; prod outside package = **0**; test files = 4 (`notification-href.test.ts`, `notification-delivery.test.ts`, `notification-follow-up.test.ts`, `notification-follow-up-email.test.ts`); package = 2

### 2. `CURATED_FILE_VOCABULARY` — barrel export unused by prod

- **Paths:** `packages/utils/src/file-curated-vocabulary.ts`, barrel
- **Why:** Prod path is `curatedFileVocabularyRows()` (+ `CURATED_VOCABULARY_VERSION`) in `workspace.repository.ts`. Array only needed to build rows / assert length in postgres test. Migration SQL mentions the name in a comment only.
- **Suggested action:** Un-export from barrel. Keep module-local (or test via `curatedFileVocabularyRows().length`).
- **Size:** S
- **Grep verified:** 12 hits; prod outside = **0**; test = 1 (`file-curated-vocabulary.postgres.test.ts`); doc/sql = 1; package = 3

### 3. `SessionRecord` — documented, never imported by name

- **Paths:** `packages/utils/src/better-auth-types.ts`, barrel; listed in `apps/web/AGENTS.md`
- **Why:** Nested as `Session.session`. Call sites import `Session` / `SessionUser` / `Account`, never `SessionRecord`. Not dead type (shapes `Session`), dead **named import**.
- **Suggested action:** Keep type definition. Optionally drop from barrel + AGENTS allowlist row if you want a thinner public surface; low urgency (docs advertise it on purpose).
- **Size:** S
- **Grep verified:** 7 hits; prod = **0**; doc = 1 (`AGENTS.md`); package = 2

### 4. `CHAT_MESSAGE_PREVIEW_MAX_LENGTH` — test-shared constant, not dead

- **Paths:** `packages/utils/src/chat-message-preview.ts`, barrel
- **Why:** No prod importer, but Core `publish.test.ts` asserts push payload length parity (`=== MAX_PUSH_PARAM_LENGTH`) and Web unread-preview tests lock truncation. Shared contract, not orphan.
- **Suggested action:** Keep exported. Do not kill.
- **Size:** —
- **Grep verified:** 17 hits; prod = **0**; test = 2; package = 3

### 5. Triple 100 MB upload size aliases

- **Paths:** `FILE_UPLOAD_MAX_SIZE_BYTES` / `TASK_FILE_MAX_SIZE_BYTES` in `task-file-upload.ts`; `CHAT_ROOM_FILE_MAX_SIZE_BYTES` in `chat-room-file-upload.ts`; all three on barrel
- **Why:** Same expression (`100 * 1024 * 1024`) under three names. Call sites already split by domain (drive/import vs task vs chat), so aliases document intent — but they are pure indirection with drift risk if one ever diverges silently.
- **Suggested action:** Keep one canonical (`FILE_UPLOAD_MAX_SIZE_BYTES`) and make the other two typed aliases with a one-line comment that they must stay equal; or collapse call sites to the canonical name in a follow-up. Not a delete without call-site churn.
- **Size:** M (many Core/Web callers)
- **Grep verified:** all three used in Core prod routes/services; aliases are intentional surface, not unused

### 6. Near-duplicate org/user metadata façades

- **Paths:** `organization-metadata.ts` (53 lines), `user-metadata.ts` (51 lines), both thin wrappers over `metadata-record.ts` (157 lines)
- **Why:** Identical field shape (`designMdExtractionId`, `designMdUrl`, `url`) and identical parse/get/build* helpers with different type names.
- **Suggested action:** Collapse to one `brand-metadata.ts` (or export the generic helpers) and type-alias `OrganizationMetadata` / `UserMetadata`. Touch Core + Web call sites.
- **Size:** M
- **Grep verified:** both façades have prod callers (not unused); complexity/duplication finding

### 7. `chat-message-preview.ts` narrating comments

- **Paths:** `packages/utils/src/chat-message-preview.ts` (665 lines; ~0.61 commentish), plus matching prose in `.test.ts` (1515 lines)
- **Why:** Long `//` blocks restate control flow in essay form (“A name is a person's to spell…”, “The finished line is read once more…”). Real invariants (UUID case, slug-vs-id, address seams) drown in narration.
- **Suggested action:** Keep non-obvious invariants as short JSDoc; delete restatement-of-code comments. Do not rewrite the mention/URL logic in the same PR as comment trim.
- **Size:** M (comment-only) / L if coupled with logic refactor
- **Evidence:** `rg -c '^\s*//'` → 36; block-comment lines dominate; contrast `linkify-bare-domains.ts` (528 lines, ~19 commentish)

### 8. Module-level `export` that nothing outside the file needs

Not on the package barrel, but `export` keyword widens accidental API:

| Symbol | File | Outside consumers | Suggested |
| --- | --- | --- | --- |
| `githubBlobDownloadUrl` | `github-file-url.ts` | 0 (only `resolveDownloadableFileUrl` + unit tests) | un-export |
| `parseChatPresenceMemberData` | `chat-presence.ts` | 0 outside module (used by `aggregateChatPresenceByUserId` + unit tests) | un-export |
| `imageOutputMegapixels` | `image-credits.ts` | 0 outside package (tests only) | un-export or delete if unused by `creditsPerImageCents` path |
| `displayFileLabelName` | `file-vocabulary.ts` | 0 (only `checkFileLabelName`) | un-export |
| `extractLinks` | `markdown-links-extract.ts` | 0 outside package (wrappers + tests) | un-export |
| `isUserUploadAllowedContentType` | `user-upload-content-type.ts` | 0 outside package (tests only; prod uses `resolveUserUploadContentType`) | un-export |
| `curatedFileVocabularyProblems` | `file-curated-vocabulary.ts` | tests only | keep as test helper or move assert into test |
| `findJsonObjectEnd` | `openrouter-react-image-envelope.ts` | 0 outside file | un-export |
| `sanitizeTaskFileFilename` | `task-file-upload.ts` | package tests only | un-export |

- **Size:** S each
- **Grep verified:** per-symbol `rg -wn` totals above; prod outside package = **0** for each

### 9. Coworker image constants re-alias entity image constants

- **Paths:** `coworker-image-upload.ts` re-exports `COWORKER_IMAGE_*` = `ENTITY_IMAGE_*`
- **Why:** Same pattern as upload-size aliases. Barrel only exposes coworker names; entity helpers stay internal. Low cost, but another rename layer.
- **Suggested action:** Leave unless consolidating all entity-image façades; not a kill.
- **Size:** S
- **Grep verified:** coworker exports used by Core blob/routes

### 10. `@sokosumi/net` — clean

- **Paths:** `ssrf-fetch.ts`, `webhook.ts`, barrel
- **Why:** All seven barrel exports have prod consumers (`ssrfSafeFetch`, `ssrfSafeStreamFetch`, `SsrfError`, `SsrfSafeFetchInit`, `postWebhook`, `buildWebhookFailureContext`, `DEFAULT_WEBHOOK_TIMEOUT_MS`). Non-barrel `assertPublicHttpUrl` / `MAX_SSRF_FETCH_REDIRECTS` are package-internal + tests. Almost no narrating comments (two short `//` lines in `ssrf-fetch.ts`).
- **Suggested action:** None for dead code. Do not touch default User-Agent.
- **Size:** —
- **Grep verified:** each net barrel symbol has ≥1 prod file outside `packages/net/`

## Explicit non-findings

- **No dead files** under either `src/` (every non-test module is imported).
- **No leftover Masumi protocol enum maps** after #5829.
- **No Next.js 16.4 dual-path** in these packages.
- **Apple / CLI / CMO / Web / Core** consumers keep many single-call-site exports alive — single prod hit ≠ unused.
- **`SokosumiJobStatus`** stays (database + Core + drift allowlist).
- Do not propose `getFirstName` / namefully changes.
- Do not propose SSRF default User-Agent changes.

## Highest-ROI kill order

1. Un-export barrel: `JOB_FOLLOW_UP_MESSAGE_KEY`, `CURATED_FILE_VOCABULARY` (S)
2. Un-export module internals in finding 8 (S, mechanical)
3. Trim narrating comments in `chat-message-preview.ts` (M)
4. Collapse org/user metadata façades (M)
5. Optional: `SessionRecord` barrel drop + AGENTS sync (S, docs-coupled)
