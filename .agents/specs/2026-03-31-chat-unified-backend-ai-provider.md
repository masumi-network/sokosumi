# Feature Specification: Unified chat backend (AI SDK custom provider readiness)

**Repository location**: `.agents/specs/` (long-lived spec; not tied to a git branch folder)  
**Spec file**: `2026-03-31-chat-unified-backend-ai-provider.md`  
**Created**: 2026-03-31  
**Last updated**: 2026-04-07  
**Status**: Draft (canonical chat: Vercel AI SDK BFF + Core `/v1/chat`)  
**Input**: Specification for the Sokosumi chat feature as implemented on the AI SDK stack (custom provider readiness, OpenRouter + coworkers).

**Related direction**: [Custom providers — ai.sdk.dev](https://ai-sdk.dev/providers/community-providers/custom-providers), OpenAI [Responses](https://developers.openai.com/api/reference/resources/responses) / [Conversations](https://developers.openai.com/api/reference/resources/conversations), OpenRouter (stateless LLM).

---

## Summary

Define the **chat feature** as **user stories with acceptance scenarios** on the **canonical stack** (web BFF → Core `/v1/chat`), so evolution (unified custom provider over OpenRouter, OpenAI-style Responses/Conversations, and coworkers) can be validated without regressions.

### Goals (refactor)

- One **maintainable** provider surface (e.g. Vercel AI SDK **custom provider**) for new LLMs and coworkers.
- **OpenAI Responses + Conversations** compatibility path for integrations that expose those APIs.
- **OpenRouter**: explicit **conversation history ownership** in Sokosumi (send full transcript or stored turns; no provider-side thread).
- **Coworkers**: must support **conversation continuity** via `previous_response_id`, pending response metadata, and recovery; future integrations should meet the same contract or document differences.

### Non-goals (this spec)

- Exact naming of internal modules or package layout.
- Changing product UX copy or design.
- New attachment/image modalities **beyond** what the API already accepts as text-shaped `parts` / `content` (non-text parts are effectively dropped for LLM input in the current core handler).

---

## User scenarios and testing *(mandatory)*

Each story keeps a stable **US-CHAT-xx** id for traceability. **Priority**: P1 = core correctness and security; P2 = continuity, recovery, and UX depth.

### US-CHAT-01 — Sign-in required (Priority: P1)

**As a** visitor, **I want** chat API calls to be rejected without a session **so that** conversations stay private.

**Why this priority**: Security and data isolation are non-negotiable for chat.

**Independent test**: Call web chat proxy and Core chat endpoints without credentials; observe HTTP status and absence of conversation data.

**Acceptance scenarios**:

1. **Given** no authenticated session, **when** the client calls the web chat proxy, **then** the response is **401**.
2. **Given** no authenticated user context, **when** Core handles the chat route protected by `requireUserAuthContext`, **then** the response is **401**.

---

### US-CHAT-02 — Send messages and stream the assistant reply (Priority: P1)

**As a** signed-in user, **I want** my message to trigger a **streaming** assistant reply **so that** I see output as it is generated.

**Why this priority**: Streaming is the primary chat UX contract.

**Independent test**: Send a valid `messages` payload; confirm SSE (or event-stream) response and incremental consumption by the client.

**Acceptance scenarios**:

1. **Given** an authenticated user and a valid body with `messages` in AI SDK-friendly shape (`parts` and/or `content`), **when** the user sends a chat request, **then** the assistant reply streams incrementally.
2. **Given** a successful stream, **when** the client consumes the response, **then** the content type is suitable for event-stream / `useChat` integration.
3. **Given** the streaming UI, **when** tokens arrive, **then** assistant text is shown in a streaming-friendly way (e.g. typed reveal and tab visibility catch-up as implemented in `useStreamingContent`).

---

### US-CHAT-03 — Backend completes even if the client disconnects (Priority: P1)

**As a** user who closes the tab mid-stream, **I want** the server to **finish** processing and persist **so that** my conversation is not lost.

**Why this priority**: Avoids silent data loss on abandoned streams.

**Independent test**: Start a stream, abort the client, verify server-side completion and persistence behaviors aligned with route handler drain logic.

**Acceptance scenarios**:

1. **Given** an in-flight stream from Core to the web BFF, **when** the browser disconnects or backpressure fails, **then** the BFF continues consuming the Core response body per drain behavior in `apps/web/src/app/api/chat/route.ts`.

---

### US-CHAT-04 — Talk to an OpenRouter model (stateless LLM path) (Priority: P1)

**As a** user, **I want** to chat with a **generic model** **so that** I get answers without a coworker integration.

**Why this priority**: Default model path must remain correct under refactor.

**Independent test**: Conversation without coworker metadata; verify OpenRouter streaming with normalized text and model resolution.

**Acceptance scenarios**:

1. **Given** a conversation not using the coworker Responses path, **when** the user sends messages, **then** Core calls OpenRouter streaming with **normalized text messages** and the selected model id.
2. **Given** an existing conversation and no model in the request body, **when** `metadata.model_id` is present, **then** that model id is used.

---

### US-CHAT-05 — Talk to a coworker (Responses API path) (Priority: P1)

**As a** user, **I want** to chat with a **coworker** that exposes the Responses-style API **so that** I get agent-specific behavior and continuity.

**Why this priority**: Coworker path is distinct from OpenRouter and must not regress.

**Independent test**: Bind a coworker with chat capability; verify Responses streaming to coworker `baseURL` and validation errors for bad input.

**Acceptance scenarios**:

1. **Given** conversation metadata resolving a coworker via `coworker_slug` / `coworker_id`, **when** the coworker is loaded, **then** `requireCoworkerChatCapability` passes for chat.
2. **Given** coworker chat is selected but `baseURL` is missing or empty, **when** the user sends a message, **then** the API returns **503** with an explanatory message.
3. **Given** the last turn is not user/system or has empty text, **when** the request is processed, **then** the API returns **400**.

---

### US-CHAT-06 — Conversation metadata drives model and agent selection (Priority: P1)

**As a** returning user, **I want** my chosen **model or coworker** to stick with the thread **so that** I do not reconfigure every visit.

**Why this priority**: Thread identity drives routing and billing/capability checks.

**Independent test**: Create model and coworker threads; reload and send again; metadata matches creation paths.

**Acceptance scenarios**:

1. **Given** a new **model** chat is created, **when** creation completes, **then** metadata stores `model_id`, `model_name`, and `type: "model"` (per `use-chat-creation`).
2. **Given** a **coworker** thread, **when** inspected, **then** metadata contains identifiers consumed by Core (`coworker_slug`, `coworker_id`, etc. as implemented).

---

### US-CHAT-07 — Persist user and assistant turns (Priority: P1)

**As a** user, **I want** both sides of the dialog stored **so that** reload and sidebar reflect history.

**Why this priority**: Persistence ordering defines truth for history UI.

**Independent test**: Send user message; observe conversation item; complete stream; observe assistant item.

**Acceptance scenarios**:

1. **Given** `conversationId` is set and the last message is user/system, **when** the request is handled, **then** the user/system message is persisted via `conversationItem.create` with formatted content.
2. **Given** `internalConversationId` is set, **when** either coworker or OpenRouter stream completes, **then** assistant output is persisted via `streamWithAssistantPersistence`.

---

### US-CHAT-08 — Auto-title first model thread message (Priority: P2)

**As a** user starting a **new model** chat, **I want** the thread title to be generated from my first message **so that** the sidebar stays readable.

**Why this priority**: Product polish; not required for correctness of a single reply.

**Independent test**: First message in empty model thread; title updates after best-effort title generation.

**Acceptance scenarios**:

1. **Given** a model thread with item count 0, **when** the first user message is persisted, **then** Core triggers `openrouterClient.generateChatTitle` and updates `conversation.title` on success (errors logged; best-effort).

---

### US-CHAT-09 — Multi-turn chaining for coworkers (`previous_response_id`) (Priority: P1)

**As a** user in a coworker thread, **I want** the backend to pass the **previous response id** **so that** the agent maintains context **without** sending full history when the API supports it.

**Why this priority**: Core continuity contract for coworkers.

**Independent test**: Send successive messages with valid/invalid previous id; observe metadata cleanup and retry behavior.

**Acceptance scenarios**:

1. **Given** both body `previousResponseId` and metadata chain id, **when** a request is made, **then** the body takes precedence.
2. **Given** `invalid_previous_response_id` or not found from the provider, **when** Core handles the error, **then** it strips `previous_response_id` from metadata, retries with `previousResponseId: null`, and supplies the **filtered message list** as input.

---

### US-CHAT-10 — Pending response metadata and client coordination (Priority: P1)

**As a** user who refreshed during generation, **I want** the UI to detect **in-flight** responses **so that** I do not see a stuck half-thread or duplicate loads.

**Why this priority**: Prevents broken UI states during async completion.

**Independent test**: Set pending metadata; verify skip reload, polling, and final refresh.

**Acceptance scenarios**:

1. **Given** `pending_responses_api_response_id` in metadata, **when** `useChatMessages` loads, **then** it may skip DB reload per `skipLoadWhenPendingId` / metadata checks.
2. **Given** pending metadata, **when** the client runs `usePendingResponsePolling`, **then** it polls `getConversationItems` until an assistant message appears or timeout, then refreshes the sidebar.
3. **Given** a coworker stream starts, **when** the response begins, **then** Core persists the pending id and on completion clears/commits `previous_response_id` (`persistPendingResponseId`, `clearPendingAndSetPrevious`).

---

### US-CHAT-11 — Recover a stuck or interrupted coworker response (Priority: P2)

**As a** user, **I want** **recovery** when the stream broke but the job continued **so that** I see the final assistant message without sending again.

**Why this priority**: Degrades gracefully after network/client failures.

**Independent test**: Trigger recovery path; observe polling/timeouts and final assistant visibility.

**Acceptance scenarios**:

1. **Given** a broken stream but ongoing server work, **when** the client calls `recoverConversationResponse`, **then** polling and timeouts follow `RECOVERY_POLL_*` in `apps/web/src/app/(app)/chat-ui/components/chat-interface.tsx`.
2. **Given** terminal recovery failure, **when** the UI handles it, **then** the user can see recovery-not-found and **resend**.

---

### US-CHAT-12 — Resend after failure with optional previous-response override (Priority: P2)

**As a** user after a failed pending/recovery, **I want** to **resend** the last user message **so that** I can retry without retyping.

**Why this priority**: Operational recovery UX.

**Independent test**: After failure, resend; verify override map affects `prepareSendMessagesRequest` for `previous_response_id`.

**Acceptance scenarios**:

1. **Given** `handleResendLastMessage` is invoked, **when** the client sends again, **then** the override map for `previous_response_id` is applied in `prepareSendMessagesRequest` so continuity can branch intentionally.

---

### US-CHAT-13 — Reasoning steps in the UI (stream extras) (Priority: P2)

**As a** user of a reasoning-capable stream, **I want** to see **reasoning steps** separate from the final answer **so that** I understand what the agent did.

**Why this priority**: Optional modality; depends on stream capabilities.

**Independent test**: Stream with `data-reasoning` parts; UI shows reasoning loaders and composed states.

**Acceptance scenarios**:

1. **Given** stream parts include `data-reasoning`, **when** the client processes the stream, **then** ReasoningLoaders / thought summary timing reflect reasoning separately from final text.
2. **Given** loading, reasoning, and recovery states, **when** rendered in `message-list`, **then** they compose without losing the primary message content.

---

### US-CHAT-14 — OAuth links in messages (Priority: P2)

**As a** user, **I want** trusted **OAuth** URLs in messages to become an **authenticate** action **so that** I can connect external accounts safely.

**Why this priority**: Integration affordance; not part of core streaming.

**Independent test**: Message containing vetted OAuth URL; CTA renders.

**Acceptance scenarios**:

1. **Given** a user message containing a URL matching vetted patterns from `extractOAuthAuthorizationUrl`, **when** the message renders, **then** `ChatOAuthAuthenticateCta` is shown when applicable.

---

### US-CHAT-15 — Load message history for a thread (Priority: P1)

**As a** user opening an old chat, **I want** messages loaded from the server **so that** I see full history.

**Why this priority**: History load is core to navigation.

**Independent test**: Open thread with many items; verify fetch limit, conversion, deduplication.

**Acceptance scenarios**:

1. **Given** a conversation id, **when** the client loads history, **then** it uses `getConversationItems` with a configured limit of 100 messages.
2. **Given** raw items from the API, **when** converted, **then** `convertItemsToMessages` maps them to client message shape.
3. **Given** duplicate ids in edge cases, **when** the client normalizes, **then** `deduplicateMessagesById` applies as implemented.

---

### US-CHAT-16 — Create and switch conversations (model vs coworker) (Priority: P1)

**As a** user, **I want** **new chats** and **sidebar** selection **so that** I can manage multiple threads.

**Why this priority**: Foundation for multi-thread UX.

**Independent test**: Create model vs coworker chat; navigate via sidebar; deep link.

**Acceptance scenarios**:

1. **Given** `useChatCreation`, **when** creating a chat, **then** model vs coworker paths set metadata and navigate to `/chat/.../conversation/:id` as implemented.
2. **Given** welcome flow with `?coworker=`, **when** the coworker exists in the list, **then** deep link behavior applies; default **elena** applies when present in list. If not present, select the next available coworker or LLM.

---

### US-CHAT-17 — Stop generation (Priority: P2)

**As a** user, **I want** to **stop** an in-flight generation **so that** I am not stuck waiting.

**Why this priority**: UX control; behavior must remain wired after transport changes.

**Independent test**: Start generation; invoke stop; stream aborts per client contract.

**Acceptance scenarios**:

1. **Given** multimodal input is mounted, **when** the user stops generation, **then** `stop` from `useChat` / transport is invoked (per `multimodal-input` props).

---

### US-CHAT-18 — Validated errors from Core (Priority: P1)

**As a** client, **I want** predictable **4xx/5xx** for bad input, missing conversation, and forbidden access **so that** the UI can fail gracefully.

**Why this priority**: Contract stability for clients and generated SDKs.

**Independent test**: Exercise bad payloads and auth/ownership edges; compare to OpenAPI and handlers.

**Acceptance scenarios**:

1. **Given** the OpenAPI description for **`POST /v1/chat`** (and related chat operations on that surface), **when** clients inspect status codes, **then** **400, 401, 403, 404, 503, 500** paths are documented for applicable cases.
2. **Given** invalid input or missing resources, **when** Core handles the request, **then** handlers use `badRequest`, `notFound`, `serviceUnavailable`, etc., consistent with `apps/core/src/routes/v1/chat/post.ts`.

---

## Requirements *(mandatory)*

### Functional requirements

- **FR-001**: The system MUST require an authenticated user for chat HTTP endpoints; unauthenticated calls MUST result in **401** (BFF `/api/chat` and Core **`/v1/chat`** as defined by `requireUserAuthContext`).
- **FR-002**: The system MUST prevent cross-user access to conversations with not-found/forbidden semantics consistent with **R1** (appendix A).
- **FR-003**: Successful chat runs that return model output MUST use **SSE** (or equivalent event stream) so the client can read incrementally (**R2**).
- **FR-004**: For a bound `conversationId`, the system MUST persist the last **user/system** turn as a conversation item **before** the model runs, and MUST persist the **assistant** turn from the stream completion path (**R3**).
- **FR-005**: If the conversation is tied to a **coworker with chat capability**, Core MUST use Responses API streaming to the coworker `baseURL`; otherwise Core MUST use the OpenRouter path with `model` from the request or `metadata.model_id` (**R4**).
- **FR-006**: On the coworker path, `previous_response_id` MUST prefer the **request body** when present, else **conversation metadata**; invalid ids MUST trigger metadata cleanup and a retry without previous id while sending the **filtered message list** (**R5**).
- **FR-007**: While a coworker response is in flight, metadata MAY hold a pending Responses API id; clients MUST coordinate via skip-reload, poll, or recovery until cleared (**R6**).
- **FR-008**: The web BFF MUST drain or otherwise consume Core streams on client disconnect so server-side completion and persistence intents in route handlers are honored (**US-CHAT-03**).
- **FR-009**: Coworker chat selected without `baseURL` MUST return **503** with an explanatory message.
- **FR-010**: Coworker chat requests MUST reject with **400** when the last turn is not user/system or text is empty.
- **FR-011**: Model chat creation MUST persist `model_id`, `model_name`, and `type: "model"`; coworker threads MUST persist coworker identifiers required by Core.
- **FR-012**: On the first user message in an empty model thread, the system SHOULD best-effort generate and set `conversation.title` via `openrouterClient.generateChatTitle` (errors logged).
- **FR-013**: The transport contract seen by the web app MUST preserve fields **`messages`**, **`conversationId`**, **`previousResponseId`**, **`model`** and SSE shape expected by `useChat`, including **`data-reasoning`** parts, or the web layer MUST provide a compatibility adapter.
- **FR-014**: OpenRouter mode MUST own transcript/history in Sokosumi (request and DB mirror); coworker mode MUST maintain the Responses id chain and pending/completed metadata; a unified provider MUST NOT merge these without an explicit mode flag.
- **FR-015**: OpenAPI for **`/v1/chat`** MUST remain consistent with implementation for status codes **400, 401, 403, 404, 503, 500** where applicable.
- **FR-016**: The default thread history load MUST use `getConversationItems` with a limit of **100** items until pagination is specified.
- **FR-017**: Welcome flow with `?coworker=` MUST deep-link when that coworker exists in the list; when **elena** is absent from the list, the app MUST select the next available coworker or LLM per `useChatCreation`.

---

## Key entities *(data and domain)*

- **Conversation**: User-owned thread; has `title`, metadata (`model_id`, `model_name`, `type`, `coworker_slug`, `coworker_id`, `previous_response_id`, `pending_responses_api_response_id`, and related fields as implemented).
- **Conversation item**: Stored turn (user, system, assistant) with formatted content; ordering defines transcript history.
- **Chat request (client → BFF → Core)**: Carries `messages` (AI SDK-shaped), optional `conversationId`, optional `previousResponseId`, optional `model`.
- **Stream envelope**: Server-sent events compatible with `useChat` and extension parts (e.g. `data-reasoning`).
- **Coworker (chat-capable)**: Agent integration exposing Responses-style API at `baseURL`; subject to capability checks.

---

## Success criteria *(mandatory)*

### Measurable outcomes

- **SC-001**: All automated regression tests listed under “Regression gates” (appendix) pass on main for the chat routes and hooks before and after the provider refactor (no new failures).
- **SC-002**: For each **US-CHAT-xx** story marked P1, at least one automated test or explicit manual test protocol exists that proves the **Acceptance scenarios** remain true.
- **SC-003**: Documented OpenAPI status codes for chat **match** observed behavior for **401, 403, 404, 400, 503, 500** on representative requests (golden or contract tests).
- **SC-004**: Refactor MAY NOT change the externally visible BFF JSON fields **messages**, **conversationId**, **previousResponseId**, **model** without a documented adapter and consumer update.
- **SC-005**: Before release, stream start (first token) latency is compared against a baseline on the prior stable chat build; material regressions are documented or resolved in release notes.

---

## Edge cases

- **Invalid `previous_response_id`**: Metadata cleared; retry without chain id; full filtered message list supplied.
- **Missing coworker `baseURL`**: **503** with explanation (not silent fallback to OpenRouter unless explicitly specified elsewhere).
- **Empty or non-user/system last turn**: **400** on coworker path.
- **Client disconnect mid-stream**: Web layer continues consuming Core per drain behavior; conversation state should not rely solely on client persistence.
- **Pending id stuck**: Polling and recovery paths cap out; user can resend with optional `previous_response_id` override.
- **Duplicate message ids** after reload or retries: Client deduplicates per `deduplicateMessagesById`.
- **Non-text message parts**: Accepted at API shape but normalized/dropped for LLM input per the core handler; no new multimodal requirements in this spec.

---

## Assumptions

- **A-001**: Behavior in this spec is that of the **canonical** chat stack (web **`/chat`** surface, BFF **`/api/chat`**, Core **`/v1/chat`**); drift is detected via tests and OpenAPI.
- **A-002**: Users have a stable session mechanism compatible with BFF auth forwarding to Core.
- **A-003**: Coworkers expose Responses-compatible streaming on `baseURL` when chat capability is declared.

---

## Requirement completeness *(Spec Kit-style checklist)*

- [ ] Each P1 user story has traceability to tests or signed manual protocol (**SC-002**).
- [ ] Success criteria include measurable or binary verifiable outcomes for security, contracts, and regressions.
- [ ] Edge cases cover auth, continuity, pending state, disconnect, and invalid input.

---

## Appendix A — Domain rules (invariants, quick reference)

| Id | Rule |
|----|------|
| **R1** | Chat HTTP endpoints require an authenticated user; cross-user conversation access returns not found or forbidden (consistent behavior across BFF and Core). |
| **R2** | Successful runs return **SSE**; client can read incrementally. |
| **R3** | For a bound `conversationId`, last user/system turn is written before the model runs; assistant turn persisted from stream completion (wrapped stream). |
| **R4** | Coworker with chat → Responses API stream to `baseURL`; else OpenRouter with `model` from request or `metadata.model_id`. |
| **R5** | `previous_response_id`: body overrides metadata; invalid → strip metadata, retry without id, message list input. |
| **R6** | Pending Responses id in metadata; client defers reload, polls/recovers; Core sets/clears pending and commits `previous_response_id` on completion. |

---

## Appendix B — Architecture (canonical stack)

- **Web**: Next.js App Router; chat UI under **`/chat/...`** (bucket + `conversation/:id`); BFF **`apps/web/src/app/api/chat/route.ts`** exposes **`POST`** and **`GET`** and forwards to Core **`POST /v1/chat`** and **`GET /v1/chat`** (Vercel AI SDK + `@sokosumi/ai-provider`). Client disconnect **drain** behavior lives in the BFF route handler.
- **Core**: **`apps/core/src/routes/v1/chat/post.ts`** (streaming chat) and **`get.ts`** (as implemented) validate input, resolve the conversation and **metadata** (`model_id`, `coworker_slug` / `coworker_id`, `previous_response_id`, pending fields); normalize messages to **plain text** per turn; branch **coworker Responses API** stream vs **OpenRouter**; wrap streams with **assistant persistence** as implemented.

---

## Appendix C — Migration notes (AI SDK custom provider)

- **Transport contract**: Preserve **`messages`**, **`conversationId`**, **`previousResponseId`**, **`model`** JSON fields and SSE **shape** expected by `useChat` / data parts (`data-reasoning`), or supply a **compatibility adapter** on the web layer.
- **Two persistence strategies**: (1) OpenRouter — **history in request** + DB items mirror; (2) Coworker — **Responses id chain** + pending/completed metadata; custom provider should not collapse these into one code path without explicit mode flag.
- **Title generation** is coupled to the **OpenRouter client** on the first model message; decide whether that stays a **side effect** or moves behind the provider.

---

## Appendix D — Regression gates (tests and tooling)

- `apps/web/src/app/api/chat/__tests__/route.test.ts`
- `apps/core/src/routes/v1/chat/post.test.ts`
- `apps/core/src/routes/v1/chat/get.test.ts`
- Shared chat hooks under `apps/web/src/app/(app)/chat/hooks/` (exercised via `chat-ui` and other consumers) as covered by existing web tests.

---

## Appendix E — Traceability (selected code anchors)

| Area | Location |
|------|----------|
| Web BFF + disconnect drain | `apps/web/src/app/api/chat/route.ts` → Core **`POST /v1/chat`**, **`GET /v1/chat`** |
| Core chat (OpenRouter / coworker, AI SDK) | `apps/core/src/routes/v1/chat/post.ts`, `apps/core/src/routes/v1/chat/get.ts` |
| Route prefix + API path helpers | `apps/web/src/app/(app)/chat-ui/utils/chat-route-base.ts` (`CHAT_APP_ROUTE_PREFIX`, `CHAT_API_PATH`) |
| Web chat shell (canonical UI) | `apps/web/src/app/(app)/chat-ui/` |
| OpenAPI → web client regen | `pnpm generate:core` (Core must serve `/v1/openapi.json`; see `apps/core/AGENTS.md`) |
| Conversation items / create | `apps/web/src/lib/actions/conversation/core-api-actions.ts` |
| `useChat` + transport + reasoning + recovery | `apps/web/src/app/(app)/chat-ui/components/chat-interface.tsx` |
| Shared hooks (messages, pending) | `apps/web/src/app/(app)/chat/hooks/use-chat-messages.ts`, `use-pending-response-polling.ts` |
