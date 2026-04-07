---
name: openai-agent-chat
description: >
  Build AI-powered chat interfaces and backends that interact with custom AI agents
  using OpenAI's Responses API and Conversations API. Use this skill whenever the user
  wants to: build a chat UI or API that talks to an OpenAI-compatible agent; implement
  multi-turn conversation state with server-side or client-side persistence; design the
  database schema and data structures for storing chat history; set up streaming SSE
  responses from an OpenAI agent; handle error recovery, retries, or interrupted streams;
  migrate from the Assistants API or Chat Completions to Responses/Conversations API;
  implement tool use / function calling in a chat flow; or manage context window growth
  with compaction. Trigger this skill even for partial tasks like "add streaming to my
  agent chat", "what DB schema should I use for OpenAI conversations", "how do I persist
  chat state with OpenAI", or "help me handle rate limits in my agent loop."
---

# OpenAI Agent Chat Skill

Comprehensive guide for building production-grade AI chat applications using OpenAI's **Responses API** (POST `/v1/responses`) and **Conversations API** (POST `/v1/conversations`). These are the modern successors to both Chat Completions and the legacy Assistants API.

## Reference files

| File | When to read |
|---|---|
| `references/api-reference.md` | Full endpoint signatures, request/response shapes, streaming events |
| `references/db-and-data-structures.md` | DB schemas (PostgreSQL + Redis), TypeScript types, migration SQL |
| `references/patterns-and-recovery.md` | Code patterns: tool loops, streaming proxy, retry, compaction, multi-agent |

Read the relevant reference files based on what the user is building. For greenfield projects, read all three.

---

## Core Concepts

### The Two APIs and how they relate

```
Responses API  ←  the "turn engine"  →  POST /v1/responses
                                         POST /v1/responses/compact
                                         GET  /v1/responses/{id}

Conversations API  ←  the "thread store"  →  POST   /v1/conversations
                                              GET    /v1/conversations/{id}
                                              PATCH  /v1/conversations/{id}
                                              DELETE /v1/conversations/{id}
                                              POST   /v1/conversations/{id}/items
                                              GET    /v1/conversations/{id}/items
                                              DELETE /v1/conversations/{id}/items/{item_id}
```

A **Conversation** is a durable thread (no 30-day TTL). A **Response** is one generation turn. You link them by passing `conversation_id` to `responses.create()`.

### Choosing a state strategy

| Strategy | Persistence | Best for |
|---|---|---|
| **Stateless input-array** | Client owns full history | ZDR/privacy flows, short tasks |
| **`previous_response_id` chaining** | 30-day server-side storage | Simple multi-turn, moderate length |
| **Conversations API** | Indefinite (no TTL) | User-facing products, persistent threads |

**Default recommendation:** Use the **Conversations API** for any product where users expect chat history to survive a page refresh or app restart.

---

## Architecture

```
┌─────────────────────────────┐
│   Browser / Mobile Client   │
│  (SSE stream or WebSocket)  │
└────────────┬────────────────┘
             │ authenticated request
┌────────────▼────────────────┐
│      Your Backend API       │
│  ┌─────────────────────┐    │
│  │  Session layer      │    │  ← maps user → conversation_id (Redis / DB)
│  │  Auth & ownership   │    │  ← verifies user owns conversation before forwarding
│  │  SSE proxy          │    │  ← streams OpenAI events to client
│  │  Retry / backoff    │    │  ← handles 429, 5xx, stream drops
│  │  Tool executor      │    │  ← runs function calls and injects results
│  └─────────────────────┘    │
└────────────┬────────────────┘
             │ server-side API key only
┌────────────▼────────────────┐
│   OpenAI Responses API      │
│   OpenAI Conversations API  │
└─────────────────────────────┘
```

**Security rule:** The OpenAI API key lives server-side only — never in frontend bundles.

---

## Quick-Start: New Conversation

### Step 1 — Create the conversation

```typescript
// POST /v1/conversations
const conv = await openai.conversations.create({
  metadata: { user_id: userId, agent_id: agentId },
});
// Persist conv.id → your DB (see db-and-data-structures.md)
const conversationId = conv.id; // "conv_..."
```

### Step 2 — First message (with streaming)

```typescript
// POST /v1/responses  (server → client via SSE)
const stream = await openai.responses.create({
  model: "gpt-4.1",
  conversation_id: conversationId,
  input: [{ role: "user", content: userMessage }],
  instructions: "You are a helpful assistant.",  // system prompt
  stream: true,
  store: true,   // default; set false for ZDR
  tools: agentTools,
  tool_choice: "auto",
});

for await (const event of stream) {
  // Proxy to client; handle tool calls; see patterns-and-recovery.md
}
```

### Step 3 — Subsequent turns

```typescript
// Just pass conversation_id — OpenAI loads full history automatically
const stream = await openai.responses.create({
  model: "gpt-4.1",
  conversation_id: conversationId,
  input: [{ role: "user", content: nextMessage }],
  stream: true,
});
```

### Step 4 — Reconnect (resume session)

```typescript
// Retrieve conversation_id from your DB by user session
const conversationId = await db.getConversationId(userId, sessionId);

// Load history for UI render
const items = await openai.conversations.items.list(conversationId, {
  order: "asc",
  limit: 100,
});
```

---

## Streaming Event Reference

Always stream for chat UIs. Key events to handle:

| Event | Action |
|---|---|
| `response.created` | Get `response.id`; log for tracing |
| `response.output_text.delta` | Append `event.delta` to UI |
| `response.output_text.done` | Full text for this item complete |
| `response.function_call_arguments.done` | Execute tool, inject result via `conversations.items.create` |
| `response.completed` | Finalize UI; persist `response.id` |
| `response.failed` | Show error; log `event.response.error` |
| `response.incomplete` | Show partial + `incomplete_details.reason` |

Full streaming event handling code → `references/patterns-and-recovery.md`

---

## Compaction (Managing Long Contexts)

When a conversation grows past ~70% of the model context window, enable compaction.

**Server-side (automatic) — recommended:**
```typescript
const stream = await openai.responses.create({
  model: "gpt-4.1",
  conversation_id: conversationId,
  input: [{ role: "user", content: msg }],
  stream: true,
  context_management: [{ type: "compaction", compact_threshold: 0.8 }],
});
// OpenAI handles it automatically; emits compaction item in stream
```

**Client-side (standalone, ZDR-friendly):**
```typescript
// Call before the next turn when history is large
const compacted = await openai.responses.compact({
  model: "gpt-4.1",
  input: fullHistoryArray,
  instructions: SYSTEM_PROMPT,  // same as used in responses.create
});
// Pass compacted.output as the input to the next responses.create call
// Do NOT prune standalone compact output — pass as-is
```

Full compaction patterns with token counting → `references/patterns-and-recovery.md`

---

## Tool Use Pattern (Function Calling)

```typescript
// 1. Create response with tools
const stream = await openai.responses.create({
  model: "gpt-4.1",
  conversation_id: conversationId,
  input: [{ role: "user", content: msg }],
  tools: AGENT_TOOLS,
  tool_choice: "auto",
  stream: true,
});

// 2. Collect tool calls from stream
const toolCalls: FunctionCall[] = [];
for await (const event of stream) {
  if (event.type === "response.function_call_arguments.done") {
    toolCalls.push({ name: event.name, call_id: event.call_id, args: JSON.parse(event.arguments) });
  }
}

// 3. Execute and inject results back into conversation
for (const call of toolCalls) {
  const result = await executeToolCall(call.name, call.args);
  await openai.conversations.items.create(conversationId, {
    type: "function_call_output",
    call_id: call.call_id,
    output: JSON.stringify(result),
  });
}

// 4. Continue turn (model sees injected results)
const continuation = await openai.responses.create({
  model: "gpt-4.1",
  conversation_id: conversationId,
  input: [],  // history already in conversation
  stream: true,
});
```

Full agentic tool loop with multi-step iteration → `references/patterns-and-recovery.md`

---

## DB Schema Overview

See `references/db-and-data-structures.md` for full SQL and TypeScript types.

**Core tables:**
- `conversations` — maps your users/sessions to OpenAI `conversation_id`
- `messages` (optional mirror) — local copy of items for search, PII scrubbing, analytics
- `agent_configs` — per-agent instructions, tools, model, temperature settings
- `sessions` — auth sessions linking users to active conversations

**Redis keys:**
- `conv:{userId}:{agentId}` → active `conversation_id` (TTL = session lifetime)
- `stream:{conversationId}` → in-progress response metadata (for reconnect)

---

## Backend Endpoint Structure

```
POST   /api/agents/:agentId/conversations          → create conversation, return { conversation_id }
GET    /api/agents/:agentId/conversations/:convId  → get conversation + metadata
DELETE /api/agents/:agentId/conversations/:convId  → delete conversation

GET    /api/conversations/:convId/messages         → paginated item list (wraps OpenAI items API)
DELETE /api/conversations/:convId/messages/:itemId → delete a specific item

GET    /api/conversations/:convId/stream           → SSE endpoint: sends msg, streams response
POST   /api/conversations/:convId/tools/result     → inject tool call output mid-turn
```

All routes: authenticate user, verify they own `conversation_id`, then forward to OpenAI.

---

## Production Checklist

- [ ] API key is server-side only; never in frontend bundles
- [ ] User auth required before any conversation create/read/stream
- [ ] Verify `user_id` → `conversation_id` ownership in DB before every API call
- [ ] Set `store: false` for zero-data-retention (ZDR) requirements
- [ ] Log OpenAI `x-request-id` header per request; set `X-Client-Request-Id` trace header
- [ ] Enable server-side compaction for conversations likely to exceed 100k tokens
- [ ] Rate-limit your own endpoints per user before forwarding to OpenAI
- [ ] Handle `response.incomplete` — render partial content with clear UX messaging
- [ ] Implement exponential backoff on 429 and 5xx
- [ ] Handle stream reconnect via `response.id` polling (see recovery patterns)
- [ ] Persist `conversation_id` in your DB immediately after creation
- [ ] Re-validate conversation exists on OpenAI on reconnect (catch 404 → recreate)