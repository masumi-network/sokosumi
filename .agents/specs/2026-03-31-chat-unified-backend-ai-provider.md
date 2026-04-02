# Spec: Unified chat backend (Vercel AI SDK custom provider readiness)

| Field | Value |
|--------|--------|
| **Feature** | Chat — unified backend via AI SDK custom provider |
| **Document date** | 2026-03-31 |
| **Status** | Draft (baseline: current production behavior) |
| **Related direction** | [Custom providers — ai.sdk.dev](https://ai-sdk.dev/providers/community-providers/custom-providers), OpenAI [Responses](https://developers.openai.com/api/reference/resources/responses) / [Conversations](https://developers.openai.com/api/reference/resources/conversations), OpenRouter (stateless LLM) |

## 1. Purpose

Capture **behavior the chat feature already guarantees today**, as **user stories with acceptance criteria**, so a backend refactor (single abstraction over OpenRouter, OpenAI-style Responses/Conversations, and coworkers) can be validated without regressions.

## 2. Goals (refactor)

- One **maintainable** provider surface (e.g. Vercel AI SDK **custom provider**) for new LLMs and coworkers.
- **OpenAI Responses + Conversations** compatibility path for integrations that expose those APIs.
- **OpenRouter**: explicit **conversation history ownership** in Sokosumi (send full transcript or stored turns; no provider-side thread).
- **Coworkers**: must support **conversation continuity** (today: `previous_response_id`, pending response metadata, recovery); future integrations should meet the same contract or document differences.

## 3. Non-goals (this doc)

- Exact naming of internal modules or package layout.
- Changing product UX copy or design.
- New attachment/image modalities **beyond** what the API already accepts as text-shaped `parts` / `content` (see core handler — non-text parts are effectively dropped for LLM input).

## 4. Current architecture (baseline)

- **Web (production `/chat`)**: Next.js App Router; UI under **`/chat/...`**; BFF **`POST /api/chat`** forwards to Core **`POST /v1/conversations/chat`** (legacy streaming path). Client disconnect drain behavior lives in the route handler.
- **Web (experimental `/new-chat`)**: UI under **`/new-chat/...`**; BFF **`/api/new-chat`** (`route.ts`) forwards to Core **`POST /v1/chat`** / **`GET /v1/chat`** (Vercel AI SDK + `@sokosumi/ai-provider`), with an experimental allowlist gate.
- **Core `conversations/chat/post.ts`**: validates body; resolves conversation and **metadata** (`model_id`, `coworker_slug` / `coworker_id`, `previous_response_id`); normalizes messages to **plain text** per turn; either **coworker Responses API** stream or **OpenRouter** stream; wraps stream with **assistant persistence**.

## 5. Domain rules (invariants)

- **R1 — Auth**: Chat HTTP endpoints require an authenticated user; cross-user conversation access returns not found/forbidden as today.
- **R2 — Streaming**: Successful runs return **SSE**; client can read incrementally.
- **R3 — Persistence ordering**: For a bound `conversationId`, the **last user/system** turn is written as a **conversation item** before the model runs; the **assistant** turn is persisted from the stream completion path (wrapped stream).
- **R4 — OpenRouter vs coworker**: If conversation is tied to a **coworker with chat capability**, Core uses **Responses API** streaming to coworker `baseURL`; otherwise OpenRouter (`model` from request or `metadata.model_id`).
- **R5 — `previous_response_id`**: For coworker path, chain id comes from **request body** if present, else **conversation metadata**; invalid id triggers **metadata cleanup** and **retry without** previous id, sending **filtered message list** as input.
- **R6 — Pending response**: While a response is in flight, metadata may hold a **pending** Responses API id; client logic **defers** reloading messages and may **poll** or **recover** until cleared.

## 6. User stories (current behavior)

### US-CHAT-01 — Sign-in required

**As a** visitor  
**I want** chat API calls to be rejected without a session  
**So that** conversations stay private.

**Acceptance criteria**

- Unauthenticated calls to the web chat proxy return **401**.
- Core `/chat` without user auth returns **401** (as defined by `requireUserAuthContext`).

### US-CHAT-02 — Send messages and stream the assistant reply

**As a** signed-in user  
**I want** my message to trigger a **streaming** assistant reply  
**So that** I see output as it is generated.

**Acceptance criteria**

- Request body includes `messages` in AI-SDK-friendly shape (`parts` and/or `content`).
- Response content-type is **event stream** suitable for `useChat`.
- Assistant text is shown with **streaming-friendly** UI behavior (e.g. typed reveal + tab visibility catch-up in `useStreamingContent`).

### US-CHAT-03 — Backend completes even if the client disconnects

**As a** user who closes the tab mid-stream  
**I want** the server to **finish** processing and persist  
**So that** my conversation is not lost.

**Acceptance criteria**

- Web proxy continues consuming the Core response body when the browser stream backpressure fails (drain behavior in `/api/chat`), matching the intent described in the route implementation.

### US-CHAT-04 — Talk to an OpenRouter model (stateless LLM path)

**As a** user  
**I want** to chat with a **generic model**  
**So that** I get answers without a coworker integration.

**Acceptance criteria**

- When not using coworker Responses path, Core calls **OpenRouter** `streamChatResponse` with **normalized text messages** and selected model id.
- For an existing conversation without a body model, **`metadata.model_id`** is used when present.

### US-CHAT-05 — Talk to a coworker (Responses API path)

**As a** user  
**I want** to chat with a **coworker** that exposes the Responses-style API  
**So that** I get agent-specific behavior and continuity.

**Acceptance criteria**

- Coworker resolved via **`coworker_slug` / `coworker_id`** in conversation metadata; must pass **`requireCoworkerChatCapability`**.
- If coworker chat is selected but **`baseURL`** is missing/empty, API returns **503** with an explanatory message.
- Last turn must be **user or system** with **non-empty** text; otherwise **400**.

### US-CHAT-06 — Conversation metadata drives model and agent selection

**As a** returning user  
**I want** my chosen **model or coworker** to stick with the thread  
**So that** I do not reconfigure every visit.

**Acceptance criteria**

- Creating a **model** chat stores `model_id`, `model_name`, `type: "model"` (see `use-chat-creation`).
- Coworker threads store identifiers in metadata used by Core (`coworker_slug`, `coworker_id`, etc. as implemented).

### US-CHAT-07 — Persist user and assistant turns

**As a** user  
**I want** both sides of the dialog stored  
**So that** reload and sidebar reflect history.

**Acceptance criteria**

- User/system message persisted via **`conversationItem.create`** with formatted content when `conversationId` is set and last message is user/system.
- Assistant output persisted via **`streamWithAssistantPersistence`** wrapper for both coworker and OpenRouter streams when `internalConversationId` is set.

### US-CHAT-08 — Auto-title first model thread message

**As a** user starting a **new model** chat  
**I want** the thread title to be generated from my first message  
**So that** the sidebar stays readable.

**Acceptance criteria**

- On **first user message** in an empty thread (item count was 0), after persisting the user item, Core triggers **`openrouterClient.generateChatTitle`** and updates `conversation.title` on success (best-effort; errors logged).

### US-CHAT-09 — Multi-turn chaining for coworkers (`previous_response_id`)

**As a** user in a coworker thread  
**I want** the backend to pass the **previous response id**  
**So that** the agent maintains context **without** sending full history if the API supports it.

**Acceptance criteria**

- `previousResponseId` in JSON body takes precedence over metadata.
- On **`invalid_previous_response_id`** / not found, Core **strips** `previous_response_id` from metadata and **retries** streaming with **`previousResponseId: null`** and **message array** input.

### US-CHAT-10 — Pending response metadata and client coordination

**As a** user who refreshed during generation  
**I want** the UI to detect **in-flight** responses  
**So that** I do not see a stuck half-thread or duplicate loads.

**Acceptance criteria**

- When `pending_responses_api_response_id` is in metadata, **`useChatMessages`** can **skip** DB reload (`skipLoadWhenPendingId` / metadata checks).
- **`usePendingResponsePolling`** polls **`getConversationItems`** until an assistant message appears or gives up, then refreshes sidebar.
- Core persists pending id on response start and clears/commits **`previous_response_id`** on completion (`persistPendingResponseId`, `clearPendingAndSetPrevious`).

### US-CHAT-11 — Recover a stuck or interrupted coworker response

**As a** user  
**I want** **recovery** when the stream broke but the job continued  
**So that** I see the final assistant message without sending again.

**Acceptance criteria**

- Client calls **`recoverConversationResponse`** with polling / timeout (`RECOVERY_POLL_*` in `chat-interface`).
- On terminal failure, UI can surface **recovery not found** and offer **resend**.

### US-CHAT-12 — Resend after failure with optional previous-response override

**As a** user after a failed pending/recovery  
**I want** to **resend** the last user message  
**So that** I can retry without retyping.

**Acceptance criteria**

- **`handleResendLastMessage`** sets an override map for `previous_response_id` used in **`prepareSendMessagesRequest`** so the next request can branch continuity intentionally.

### US-CHAT-13 — Reasoning steps in the UI (stream extras)

**As a** user of a reasoning-capable stream  
**I want** to see **reasoning steps** separate from the final answer  
**So that** I understand what the agent did.

**Acceptance criteria**

- Client handles **`data-reasoning`** stream parts and feeds **ReasoningLoaders** / thought summary bar timing.
- Loading vs reasoning vs recovery states composed in **`message-list`**.

### US-CHAT-14 — OAuth links in messages

**As a** user  
**I want** trusted **OAuth** URLs in messages to become an **authenticate** action  
**So that** I can connect external accounts safely.

**Acceptance criteria**

- **`extractOAuthAuthorizationUrl`** finds vetted patterns; **`ChatOAuthAuthenticateCta`** renders for user messages when applicable.

### US-CHAT-15 — Load message history for a thread

**As a** user opening an old chat  
**I want** messages loaded from the server  
**So that** I see full history.

**Acceptance criteria**

- **`getConversationItems`** used with a **limit** (e.g. 100); items converted via **`convertItemsToMessages`**.
- Duplicates handled where needed (**`deduplicateMessagesById`**).

### US-CHAT-16 — Create and switch conversations (model vs coworker)

**As a** user  
**I want** **new chats** and **sidebar** selection  
**So that** I can manage multiple threads.

**Acceptance criteria**

- **`useChatCreation`**: model vs coworker creation paths, metadata, navigation to `/chat/.../conversation/:id` as implemented.
- Welcome flow supports **`?coworker=`** deep link and default **elena** when present in list.

### US-CHAT-17 — Stop generation

**As a** user  
**I want** to **stop** an in-flight generation  
**So that** I am not stuck waiting.

**Acceptance criteria**

- Multimodal input wires **`stop`** from `useChat` / transport (per `multimodal-input` props).

### US-CHAT-18 — Validated errors from Core

**As a** client  
**I want** predictable **4xx/5xx** for bad input, missing conversation, forbidden  
**So that** the UI can fail gracefully.

**Acceptance criteria**

- OpenAPI on `/chat` documents **400, 401, 403, 404, 503, 500** paths; implementation throws **`badRequest`**, **`notFound`**, **`serviceUnavailable`**, etc., for the cases sketched in `post.ts`.

## 7. Migration notes (for the AI SDK custom provider)

- **Transport contract**: Preserve **`messages`**, **`conversationId`**, **`previousResponseId`**, **`model`** JSON fields and SSE **shape** expected by `useChat` / data parts (`data-reasoning`), or supply a **compatibility adapter** on the web layer.
- **Two persistence strategies**: (1) OpenRouter — **history in request** + DB items mirror; (2) Coworker — **Responses id chain** + pending/completed metadata; custom provider should not collapse these into one code path without explicit mode flag.
- **Title generation** today is coupled to **OpenRouter client** on first message; decide whether that stays a **side effect** or moves behind the provider.
- **Tests**: `apps/web/src/app/api/chat/__tests__/route.test.ts`, `apps/core/src/routes/v1/conversations/chat/post.test.ts`, `apps/core/src/routes/v1/chat/post.test.ts`, and chat hooks normalize **regression gates** for the refactor.

## 8. Traceability (selected code anchors)

| Area | Location |
|------|----------|
| Web legacy chat BFF + disconnect drain | `apps/web/src/app/api/chat/route.ts` → Core **`POST /v1/conversations/chat`** |
| Web new-chat BFF + disconnect drain | `apps/web/src/app/api/new-chat/route.ts` → Core **`POST /v1/chat`**, **`GET /v1/chat`** |
| Core chat + OpenRouter / coworker branch | `apps/core/src/routes/v1/conversations/chat/post.ts` |
| Core AI SDK chat (`streamText` + Sokosumi provider) | `apps/core/src/routes/v1/chat/post.ts` |
| Web chat shells | Production: `apps/web/src/app/(app)/chat/`. Experimental: `apps/web/src/app/(app)/new-chat/`, `apps/web/src/app/(app)/new-chat-ui/` (`chat-route-base.ts` in new-chat-ui) |
| OpenAPI → web client regen | `pnpm generate:core` (Core must serve `/v1/openapi.json`; see `apps/core/AGENTS.md`) |
| Conversation items / create | `apps/web/src/lib/actions/conversation/core-api-actions.ts` |
| `useChat` + transport + reasoning + recovery | Production: `apps/web/src/app/(app)/chat/components/chat-interface.tsx`. Experimental: `apps/web/src/app/(app)/new-chat-ui/components/chat-interface.tsx` |
| Pending poll | `apps/web/src/app/(app)/chat/hooks/use-pending-response-polling.ts` |
| Message load / pending skip | `apps/web/src/app/(app)/chat/hooks/use-chat-messages.ts` |
