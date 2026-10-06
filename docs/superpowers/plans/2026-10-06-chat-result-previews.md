# Custom Chat Result Previews Implementation Plan

> **For agentic workers:** Use the executing-plans skill for native execution or subagent-driven-development if the user selects that approach. Execute the tasks in order and use the checkboxes to record progress.

**Goal:** Add durable previews of posts, tasks and schedules, Content Studio results, decisions and requests, delegated jobs, and files to Sokosumi Web chats, with validated bot tools for producing them.

**Architecture:** Core resolves real resource references and stores bounded snapshots using existing message metadata and tool-call records. Shared room messages carry opaque preview descriptors; authenticated endpoints recheck each reader's resource access before returning card details. Web renders the resulting generated DTOs using existing card, media, and decision primitives.

**Tech Stack:** Node.js 24, the pnpm version in package.json, Hono/OpenAPI/Zod, Prisma in Core, Next.js/React, TanStack Query, next-intl, Tailwind semantic tokens, and Vitest.

**Spec:** ../specs/2026-10-06-chat-result-previews-design.md

## Global Constraints

- Core owns resource access, validation, persistence, and bot execution. Web never accesses the database.
- Previews primarily show recorded results and link to their source. They do not grant permission to generate, schedule, publish, or execute an action.
- Use existing message metadata and tool-call records; add no preview table or package.
- Preserve publication idempotency, communication authority, resource scopes, credits, and bot capability ceilings.
- Released prompt versions and frozen skills stay unchanged.
- Reuse existing durable decision resolution; do not restore request_user_decision as a general bot capability.
- Use protected media routes, translated labels, locale-safe dates, accessible controls, and semantic colors.
- Support owner answers and explicit room posts. Ordinary and older messages remain readable.
- Regenerate @sokosumi/core-client from Core sources; never hand-edit generated files.
- Work in the isolated SOK-1306 branch and open a draft PR with its primary Conventional Commit subject as the title.

## Review Focus

1. A shared room contains members who cannot read a referenced private resource: neither HTTP message DTOs nor realtime events reveal its snapshot, identifiers, name, or media URL.
2. A member loses project or file access after a card is posted: historical hydration becomes unavailable without exposing stored content.
3. A bot turn is cancelled, retried, or stays silent: preparing a card does not create another post, duplicate a card, or publish staged data.
4. Malformed or unknown stored metadata occurs in old messages: the message remains readable and the result section fails safely.
5. A decision is resolved or expires after posting: historical cards cannot offer an effective stale approval action; the existing server authorization remains authoritative.

---

## Workspace and execution

Use /Users/albina/.codex/worktrees/chat-result-cards/sokosumi on branch sok-1306-show-bot-results-with-custom-chat-previews. Leave the primary checkout's uncommitted calendar and task changes untouched. Before implementation, read current scoped AGENTS.md files and the required UI skills from the primary checkout where local skill installations are absent from the worktree.

Install existing dependencies with pnpm install --frozen-lockfile. Use root Turbo verification so dependency builds and Prisma generation occur. Read the installed Turbo docs before changing its command syntax. Do not add dependencies, bypass hooks, provision a database, or alter environment secrets for unit tests.

## Task 1: Define bot references and public result DTOs

**Files:**
- Create packages/soko-bot/src/result-previews.ts and its colocated test.
- Modify packages/soko-bot/src/index.ts, tool-contracts.ts, policy.ts, and their existing contract tests.
- Create apps/core/src/schemas/chat-result-preview.schema.ts and its colocated test.
- Modify apps/core/src/schemas/chat-room.schema.ts and soko-bot.schema.ts with optional opaque descriptors.

**Interfaces:**
- ChatResultReference is a discriminated union over task, task_schedule, bot_schedule, social_post, studio_job, job, file, and decision.
- Task, task schedule, bot schedule, job, file, and decision references use kind and id. Social post and studio job also require projectId.
- sokoBotPreviewResultInputSchema validates { reference: ChatResultReference }.
- post_chat retains roomId/content and gains optional resultReferences, bounded to six entries.
- ChatResultDescriptor contains only id and capturedAt. Public message metadata must not contain snapshot data or original resource references.
- ChatResultPreview is a discriminated union of available card data and unavailable { id, state: "unavailable" }.
- Available cards have id, capturedAt, kind, sourceHref, and bounded resource-specific fields. Preserve each resource's actual status type rather than inventing a unified domain status enum.

Use this public descriptor shape:

```typescript
export const chatResultDescriptorSchema = z.object({
  id: z.string().uuid(),
  capturedAt: dateTimeSchema,
});
```

- [x] Add a failing reference test accepting { kind: "task", id: "task-1" } and rejecting { kind: "studio_job", id: "job-1" } without projectId.
- [x] Add schema tests rejecting model-provided title/status/href fields in reference inputs and more than six references in post_chat.
- [x] Define strict reference schemas. Export preview_result input/description and add it to the existing read capability ceilings; do not add it to posting or paid generation capabilities.
- [x] Define named OpenAPI result schemas. Task data includes title, status, assignee/project labels, optional schedule data, and actual input question when waiting. Post includes text, account/provider, status, optional scheduledAt/timezone/media. Studio and job include summary, native status, failure detail, and bounded output descriptors. File includes name/type/size and protected open/download paths. Decision includes the existing proposal and resolution fields.
- [x] Run package and schema tests; review the diff and commit the contracts with normal hooks.

## Task 2: Resolve authorized resources and create snapshots

**Files:**
- Create apps/core/src/services/chat-result-preview.service.ts and its colocated test.
- Modify apps/core/src/services/soko-bot-runtime.service.ts and its test at the existing tool-dispatch/read seams.
- Reuse task access helpers, task-schedule.service.ts, social-posts.service.ts, lib/image-studio/access.ts, existing Drive/file access, job reads, and bot ownership checks.

**Interfaces:**
- resolveChatResultReference({ reference, actor, previewId, capturedAt }, client) returns a validated ChatResultSnapshot or an existing authorization/not-found error.
- ChatResultSnapshot contains its opaque id, capture time, original validated reference, and available card DTO. It is internal persisted JSON and never a shared wire DTO.
- canReadChatResultReference({ reference, viewerUserId }, client) returns a boolean using the same resource-specific access seam as source reads.
- readChatResultSnapshots(value: unknown) validates the bounded stored collection and skips invalid entries without throwing.

Record native task/job/post states and real resource links. Bot follow-up schedules are labelled separately from task execution schedules. Content Studio links retain project/job context. Use existing protected file and studio paths; never expose a stored object URL.

- [x] Write failing tests covering each of the eight reference kinds. Assert an exact task title and native status from a mocked authorized read, and assert that a studio reference returns only actual available outputs.
- [x] Write failing tests that a different owner's decision, private Drive file, or bot schedule is inaccessible and that a project resource outside the actor's workspace is rejected.
- [x] Implement resource adapters at the existing access seams. Share domain reads that are already needed by bot tools rather than copying access rules into the Web layer.
- [x] Add tests for cancelled/failed studio jobs, absent assignees, no file size, multiple output descriptors, and a task waiting for input. Use source fields for the latest actual question, never a model-authored guessed question.
- [x] Add a historical-read test: produce a snapshot, revoke the viewer's access, then assert that hydration yields only an unavailable entry.
- [x] Run the resolver/Core tests, review, and commit.

## Task 3: Persist prepared results in answer and room delivery

**Files:**
- Modify apps/core/src/services/soko-bot-runtime.service.ts, soko-bot-chat.service.ts, and their colocated tests.
- Modify apps/core/src/routes/v1/chats/rooms/helpers.ts and the canonical publicChatRoomMessageMetadata implementation it imports.
- Extend existing delivery integration tests and chat-room-message-realtime.test.ts.

**Interfaces:**
- preview_result resolves one reference and persists its snapshot as the existing completed tool call's result. Its opaque preview id is stable for the same toolCallId.
- collectTurnResultSnapshots(turnId, client) reads successful preview_result calls in creation order, deduplicates kind/id/projectId, and returns at most six snapshots.
- post_chat resolves resultReferences and persists snapshots with its existing staged publication. Existing publication/clientMessageId deduplication stays authoritative.
- Successful owner answers and room reply finalization attach prepared snapshots; failed, cancelled, or intentionally silent turns do not publish them.
- mapChatRoomMessage promotes only descriptor ids/timestamps from valid metadata and strips all internal snapshots/references before exposing metadata.

Use an internal key named result_preview_snapshots. Always sanitize this key in public metadata projection, including realtime and single-message endpoints.

```typescript
const publicMetadata = { ...metadata };
delete publicMetadata.result_preview_snapshots;
```

That deletion belongs in the canonical projection, not individual callers. The added descriptor field is optional so older DTO fixtures and messages need no invented values.

- [ ] Write failing tests for preview_result staging without a post, successful owner answer publication, and a post_chat containing two real result references.
- [ ] Write an idempotency test calling the same publication twice and asserting one message with one stable preview collection.
- [x] Implement the capability dispatch, staging, collection, and existing answer finalization changes.
- [x] Test cancelled/failed/silent turns, invalid stored entries, and human-created messages. Do not allow human message input to forge internal snapshots.
- [ ] Assert that serialized HTTP messages and the shared realtime event contain no private snapshot title, resource id, file URL, proposal, or prompt. Test both room read and reply paths.
- [x] Run delivery/realtime tests, review, and commit.

## Task 4: Add authenticated result hydration endpoints

**Files:**
- Create apps/core/src/routes/v1/chats/rooms/[id]/messages/[messageId]/results/get.ts and its test.
- Create apps/core/src/routes/v1/soko-bots/me/turns/[turnId]/results/get.ts and its test.
- Modify the existing chats/rooms/index.ts and soko-bots/index.ts route mounts.
- Regenerate packages/core-client/src/generated and Core's generated OpenAPI snapshot through the generator.

**Interfaces:**
- GET /v1/chats/rooms/{id}/messages/{messageId}/results returns { data: ChatResultPreview[], meta }.
- GET /v1/soko-bots/me/turns/{turnId}/results returns the same shape for the owner's prepared turn cards.
- No previews is an empty data array. An inaccessible referenced resource yields an unavailable entry with the same opaque id, not a request-wide failure. Inaccessible messages/turns yield 404 or existing authorization responses.

The message route uses requireUserAuthContext, requireChatRoomUserMembership, and the existing shared read budget. The turn route follows the current owner-turn endpoint's ownership checks. Do not accept arbitrary client-supplied resource references at these endpoints.

- [x] Write failing route tests for an authorized reader, a room non-member, a mismatched message/room pair, a deleted message, and another owner's turn.
- [x] Implement validated OpenAPI routes and mounts. Load only persisted snapshots belonging to the authorized message/turn, then recheck access to every reference.
- [x] Test mixed access: return one permitted task and one unavailable file without leaking the private file's name or resource id.
- [x] For decision entries, load current resolution/expiry and permitted response options separately from historical proposal fields. Existing decision action endpoints still enforce authority at execution.
- [x] Run route tests and regenerate using pnpm --filter @sokosumi/core-client generate:snapshot. Run Web typecheck separately after regeneration.
- [x] Review generated changes and commit source plus untouched generator output.

## Task 5: Render all cards on both chat surfaces

**Files:**
- Create apps/web/src/components/chat/result-previews.tsx and its colocated test.
- Create apps/web/src/components/chat/use-result-previews.ts and its test.
- Add Web service reads to apps/web/src/lib/services/chat-result-preview.service.ts.
- Add session-authenticated Web Route Handlers under app/api for room-message results and personal-assistant turn results; colocate their tests.
- Modify app/(app)/chat/components/room-message-row.tsx and its tests.
- Modify app/(app)/personal-assistant/components/chat/message-row.tsx, lib/soko-bot/chat-state.ts, and relevant tests.
- Modify messages/en.json, de.json, es.json and the owning client message bag if its existing namespace does not include the new keys.

**Interfaces:**
- ResultPreviews({ previews, onDecisionResolved? }) renders generated ChatResultPreview DTOs.
- RoomResultPreviews({ roomId, messageId, descriptors }) loads protected results when descriptors exist.
- TurnResultPreviews({ turnId, descriptors, onDecisionResolved }) uses the owner endpoint.
- TanStack Query keys include room/message or turn and current workspace/session context. Use normal data reads rather than server actions on mount. Do not poll every historical card.

Use one compact shared frame and resource-specific body branches. Reuse FileChipMiniPreviewFrame and existing media/open/download controls for outputs. Reuse DecisionCard and its existing action for authorized decision responses. Do not copy full taskboard cards or build another decision form.

- [ ] Write component tests with literal user-facing outcomes for each card kind, a scheduled task, a distinct bot follow-up schedule, a waiting-input task, a studio job with multiple outputs, and an unavailable entry.
- [x] Implement cards with translated labels and useFormatter dates. Show capture time as recorded state. Decision resolution is explicitly current; resolved/expired decisions show no active approval controls.
- [x] Wire message rows after explanatory content, excluding deleted messages, thought placeholders, and duplicate legacy decision rendering.
- [ ] Test unknown/malformed hydrated entries, inaccessible media, long names, missing optional fields, and messages without descriptors. Existing message behavior must remain unchanged.
- [x] Add the same key paths to every supported locale and verify the namespace reaches the client provider.
- [x] Run component/handler tests, messages:parity, formatting, and Web typecheck; review and commit.

## Task 6: Teach bots, verify the complete change, and open the draft PR

**Files:**
- Modify packages/soko-bot/src/versions/skills.ts and versions/index.ts.
- Create versions/v21.ts based on v19's non-EU prompt/model with the new result-preview skill. Preserve v20's EU configuration and all released versions.
- Extend versions/policy/tool-contract tests and a bot delivery integration scenario.
- Update this plan's checkboxes as work completes.

The new skill names preview_result and resultReferences exactly. It instructs the bot to fetch real identifiers, prepare cards for its current reply, include explanatory text, and use post_chat only within existing communication permissions. Preparing a result is not approval to execute any proposed or paid operation. Add v21 to the registry using the established convention; do not silently migrate existing owners' pinned versions or change the default model/region.

- [x] Write a prompt composition test that v21 contains the new skill, while v19 and v20 compose unchanged prompts and model/region settings.
- [x] Add the instruction module and version. Tool descriptions make the mechanism usable on other versions without rewriting their frozen prompts.
- [ ] Add an end-to-end service scenario preparing a task card, completing the answer, reading descriptors, and hydrating the authorized snapshot.
- [x] Run relevant package/Core/Web tests, root pnpm check, and pnpm typecheck. Fix failures and rerun affected checks.
- [x] Use verify-sokosumi doctor/launch/sign-in for authenticated browser proof when configured. Capture representative desktop/mobile screenshots and decision/unavailable states. If credentials are unavailable, record that exact limitation; do not invent accounts.
- [x] Review the full branch against the approved spec with an independent reviewer, fix actionable findings, and verify the amended code. Keep current resource access, neutral realtime data, retries, and decision controls as the main review focus.
- [x] Commit with hooks, push only the isolated feature branch, and create a draft PR titled exactly like the primary Conventional Commit subject. Link SOK-1306 and state checks, schema/codegen changes, UI evidence, and any verification limits.
- [x] Attach the PR to this chat with the native artifact tool and return its URL. Do not merge.

## Self review

The six tasks cover each preview kind, bot production, both chat surfaces, access revocation, durable history, fallback behavior, translations, version preservation, code generation, idempotency, and draft PR delivery. The viewer-neutral realtime constraint is resolved by opaque descriptors and protected hydration, with explicit projection and route tests. No new resource execution authority, preview table, approval capability, or dependency is required.

## Execution record

Implementation is committed as one coherent API, generated-client, UI, and bot feature. The finer unchecked test steps above were consolidated into resolver, route, staging/finalizer, metadata-projection, renderer, version, and existing publication/realtime regression suites; they do not represent missing product behavior. No single live end-to-end browser scenario was verified.

Verified before review:

- Full Core, Web, and bot suites: 9,215 Core tests passed (155 conditional tests skipped), 9,597 Web tests passed, and 246 bot tests passed. The final unknown-kind renderer regression then passed with all four renderer tests.
- Root `pnpm check`: 5,434 files passed. Root `pnpm typecheck`: 20 Turbo tasks passed. Locale parity passed for German and Spanish.
- Core snapshots and the Core client were regenerated from source. No dependencies or database migrations were added.
- Desktop light and mobile dark screenshots under `docs/superpowers/screenshots/` use the actual renderer with sample data; mobile overflow was checked. They are offline fixtures, not authenticated product proof.
- `verify-sokosumi` doctor/launch was attempted. Authenticated browser proof is blocked because the required HTTPS port 443 needs unavailable noninteractive sudo. The fallback proxy was stopped; no application servers or test accounts were left running.

Implementation rulings:

- Commit the interdependent tasks together after normal hooks: the initial isolated contract commit hit unfinished dependent files. Cost: coarser commit review.
- Reuse the authorized resolver for hydration rather than add a separate permission boolean. Cost: current display fields are also read during access checks.
- Keep the small protected query in the shared renderer rather than introduce separate hooks and surface wrappers. Cost: the renderer owns the background read.
- Preserve the existing bot-to-bot ceiling: only owner-authorized requests can prepare private previews. Consulted bots continue returning text answers.
- Reuse existing publication/realtime regressions rather than duplicate the complete delivery harness. Cost: there is no new single end-to-end scenario covering every seam; the focused tests establish each boundary independently.

### Independent review and final fix pass

The fresh reviewer found two Important gaps: supported private files had no in-chat viewers, and marketplace outputs all linked to their parent job. Both were reproduced by failing tests and fixed. The renderer now reuses existing PDF/text/image viewers and audio/video players. Individual ready job outputs have a protected content route that rechecks canonical job access and exact output ownership on each read. The storage reader and Web streaming proxy are shared with Drive; storage coordinates never enter snapshots or response headers.

Review rulings (behaviors the reviewer declined to judge):

- Live authenticated browser, keyboard, and responsive behavior remain unverified; offline desktop/mobile fixtures establish layout only. Cost: runtime browser issues could remain.
- Full test-suite results are executor evidence, not independently rerun by the reviewer. Cost: review does not independently corroborate the execution logs.
- Private Office uses source/download fallback because the external viewer cannot access authenticated bytes. Cost: Office inspection requires opening its source.
- One Studio job currently owns one asset; multiple result entries support multiple generations. Cost: a future multi-asset job will need an adapter update.
- Remote revocation is checked on hydration and byte reads, without a live historical-card subscription. Cost: already displayed content remains until a refresh.
- Decision controls can age while open; execution still checks current state and authority. Cost: a stale click can be rejected rather than immediately hidden.
- Owner-turn silence is not a demonstrated supported preview-publication path; consulted bots cannot prepare these private previews. Cost: future silence paths must retain that restriction.
- The single commit, embedded query, resolver reuse, and owner-only preview ceiling stand for the reasons above. Costs: coarser review, small renderer-owned query, extra reads, and text-only consulted bot results.
- Invalid stored snapshots are skipped, preserving readable message text. Cost: an invalid entry is omitted instead of receiving a separate placeholder.

No Minor findings were deferred. The main branch advanced during implementation; a read-only merge-tree check found no conflicts.

### Delivery

Draft PR: https://github.com/masumi-network/sokosumi/pull/5806 — attached to the Codex chat and automatically linked to SOK-1306 by the GitHub integration (the explicit Linear link command confirmed that it was already linked).

Final local evidence after review fixes: Core 9,222 passed / 155 conditional tests skipped; Web 9,604 passed; bot package 246 passed. Root check and typecheck passed, and the final renderer tests used real document buttons and native audio/video controls (9 passed). Commits ran normal hooks. The feature branch merges cleanly with the updated main according to a read-only merge-tree check. CI results are separate from these local checks; the PR remains a draft for human review and merge.

### App component alignment

User review requested the existing app components instead of generic result cards. Task results now render the actual board `TaskCard`, with its native status, priority, privacy, tags, project identity, assignee and participant avatars. Social posts render the actual `SocialPostPreview` and `SocialPostStatusBadge`, preserving LinkedIn, X and Instagram layouts, connected account photos and protected media. Schedules reuse `AssigneeAvatar` and `ProjectAvatar`; marketplace results reuse `AgentIcon` and `JobStatusBadge`. Studio images use the existing large media preview.

Core snapshots carry only the bounded display fields needed by these components. Older snapshots default the new fields to null and keep their readable fallback. Authorization, opaque public descriptors and protected media routes remain unchanged. The generated Core client was regenerated from source.

Focused proof: 186 Core tests and 37 Web tests passed, including the real task card and all three social platform layouts. Root check and typecheck passed. Updated desktop/light and mobile/dark fixtures show loaded profile and project images; browser exceptions: zero, horizontal overflow: false. These are offline fixtures, not authenticated product verification.

Final follow-up suites passed: Core 9,222 / 155 conditional skipped; Web 9,608. The initial concurrent Turbo run hit a worker startup timeout; rerunning the complete suites with two workers each passed. The narrowed Soko Bot translation bag passed all six namespace checks. Normal commit hooks passed.

### Live task preview and card cleanup

Inspected the user's existing authenticated PR-preview chat. Its actual bot reply recorded “Preparing a result preview” and eventually rendered the native ALB-15 task card with bot avatar and source links. This verifies that task tool publication and protected hydration work in that deployed preview; social creation and later scheduled execution were not tested. No new bot message or task was submitted.

The task card was followed by duplicated raw Markdown description and raw cron metadata. A failing regression reproduced those lines. The renderer now uses normal task-card width and leaves that extra metadata to the task source; native status, project, assignee/participant avatars, comments, and links remain. Focused renderer/task-card tests passed (31). Updated offline fixtures include a Markdown description and cron expression to exercise the cleanup.

### Required bot preview completion

User testing showed successful task creation/assignment falling back to the legacy Task link button. Tightened the `chat-result-previews` skill to require preview preparation after named task, schedule, post, Studio, file, job and approval operations, and explicit requests to show existing items. Creation plus assignment prepares one card after the final change; queued generations still get their actual-state card. Four schema-valid call sequences and a pre-answer completion check make the expected step explicit. Failure keeps useful verified text and a source link without claiming a card exists. The shared preview tool description reinforces this sequence.

Owner routes and narrowed write scopes already expose the read-only preview tool; no capability or authorization changes were needed. The new tests validate the examples against the real input schema and ensure preview availability does not grant create/schedule/generation authority. Full bot package suite: 248 passed. Core classifier/runtime regressions: 208 passed. This is an instruction improvement, not deterministic automatic attachment; no live bot message was submitted for this follow-up.

### Clickable project clarification

Added `project_selection` to the existing `preview_result` contract. The bot supplies up to 12 relevant real project IDs; Core supplies current workspace-scoped names and logos. Private snapshots and opaque descriptors use the existing publication flow. Hydration reloads live choices, so deleted projects and revoked workspace membership cannot remain selectable. The v21 skill requires this selector before asking which project to use, including Content Studio generation. Larger candidate sets are narrowed with a search question.

Web reuses `TaskProjectSelect` search and `ProjectAvatar`, with its optional no-project choice omitted. A selection rehydrates through Core before sending a normal user reply with the actual project ID. Room replies mention the original bot, retain thread scope and quote its question. Personal replies include the originating request/question and reject an active-workspace mismatch. Server-derived submission IDs make the same choice idempotent across retries and card remounts; no generation/publication action runs directly from the component.

Focused checks: Core preview/metadata/turn endpoint tests 22 passed; Web renderer, actual picker click/retry and selection action tests 22 passed; bot contracts 249 passed; root check/typecheck and locale parity passed. Review findings about remount retries and personal continuation context were fixed and re-reviewed without remaining findings. Desktop/light and mobile/dark fixture screenshots show the actual picker; zero browser exceptions and no horizontal overflow. These are fixture interactions, not a newly submitted live bot conversation.

### Project choice reply polish

The picker’s technical reply remains intact for the bot, while room and personal chat render its exact known format as a compact selected-project chip with the existing project avatar and project link. Personal continuation context is also kept out of the visible reply. Existing persisted replies receive the same display without a migration; ordinary or malformed messages retain their normal rendering. The picker’s completed state reuses this presentation with the authorized project logo.

Proof: 172 focused Web tests passed, including actual room-row integration, picker clicks/retry, legacy and personal reply parsing, escaped names, and ordinary-message fallbacks. Root check/typecheck and locale parity passed. Updated desktop/light and mobile/dark fixtures show the selected reply; zero browser exceptions and no horizontal overflow. No new live bot messages were sent.


### Live delivery and omitted preview fallback

A failing realtime regression reproduced the reload issue: Core published opaque `resultPreviews`, but Web's manual Ably message hydrator discarded them. The full event schema and hydrator now retain IDs and convert capture times, and a parsed completion event replaces its placeholder with the cards intact. Descriptor parsing strips extra fields; no private resource snapshot crosses this boundary.

Preview-enabled owner turns now prepare missing cards at successful settlement from committed, verified action receipts. Core resolves current authorized resources after all actions, deduplicates create/assignment, refreshes an existing explicit card, and stores snapshots through the existing private preview ledger before delivery. Room delivery collects that ledger even without a model-emitted preview event. Task actions, bot schedules, social posts, Studio generations, files and marketplace jobs are covered; JobInput receipts resolve through their owning event to the job. Old versions, colleague requests and bot consultations retain their previous behavior. Failed or uncertain actions cannot produce success cards. Unavailable resources can omit a preview; unexpected/database errors propagate so serializable settlement can retry.

Verification: 221 focused Core tests and 68 focused Web tests passed, including settlement ordering, cancellation/failure exclusion, final-state deduplication, owner/version gates, provider receipt IDs, preview bounds, access fallback, database conflict propagation and full-event parse/hydrate/merge. Root check/typecheck passed. Independent review found the JobInput ID and swallowed transaction errors; both were fixed and re-reviewed with no remaining findings. No new live bot messages or Ably messages were sent. End-to-end transport behavior awaits deployment of Core and Web.


### Remove duplicate task footer links

Room messages suppress the small task link only when an authorized, available task card for that same task is rendered. The existing result hydration query supplies the footer's displayed task IDs; no extra request or private DTO field is added. Approvals and other task links remain, and loading/errors/unavailable results retain their fallback link. Messages without previews keep the existing footer.

Verification: 168 focused Web tests passed, covering matching-task suppression, other tasks and approvals, hydration descriptor filtering, loading/error fallback and room rows. Root typecheck and normal commit checks passed. Independent review returned no actionable findings. No new live messages were submitted.
