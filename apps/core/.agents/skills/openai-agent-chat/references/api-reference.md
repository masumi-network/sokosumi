# API Reference

## Contents
1. [Responses API](#responses-api)
2. [Conversations API](#conversations-api)
3. [Streaming Events](#streaming-events)
4. [State Strategy Comparison](#state-strategy-comparison)
5. [Key Data Shapes](#key-data-shapes)

---

## Responses API

### POST /v1/responses — Create a response

The core "turn engine." All parameters are optional unless noted.

```typescript
const response = await openai.responses.create({
  // Required
  model: "gpt-4.1",           // model to use for this turn

  // Input (one of these approaches)
  input: "Hello",             // string shorthand
  input: [                    // OR array of items
    { type: "message", role: "user", content: "Hello" }
  ],

  // Conversation linking (pick one state strategy)
  conversation: "conv_...",           // Conversations API strategy
  previous_response_id: "resp_...",   // chaining strategy
  // (omit both for stateless input-array strategy)

  // Agent behavior
  instructions: "You are a helpful assistant.",  // system prompt (overrides conv instructions)
  tools: [...],             // tool/function definitions
  tool_choice: "auto",      // "auto" | "none" | "required" | { type: "function", name: "..." }

  // Output control
  max_output_tokens: 1000,
  temperature: 0.7,
  top_p: 1.0,
  stream: true,             // always true for chat UIs

  // Storage
  store: true,              // default true; set false for ZDR

  // Context management (server-side compaction)
  context_management: [{ type: "compaction", compact_threshold: 0.8 }],

  // Structured output
  text: { format: { type: "json_schema", schema: { ... } } },

  // Tracing
  metadata: { trace_id: "req_001", user_id: "usr_123" },
});
```

**Response shape:**
```typescript
{
  id: "resp_...",
  object: "response",
  created_at: 1234567890,
  model: "gpt-4.1",
  status: "completed" | "in_progress" | "incomplete" | "failed" | "cancelled",
  output: ResponseOutputItem[],
  output_text: string,        // convenience: first text output
  usage: {
    input_tokens: number,
    output_tokens: number,
    total_tokens: number,
  },
  conversation_id: "conv_..." | null,
  previous_response_id: "resp_..." | null,
  incomplete_details: { reason: string } | null,
  error: { code: string; message: string } | null,
}
```

---

### GET /v1/responses/{id} — Retrieve a response

```typescript
const response = await openai.responses.retrieve("resp_abc123");
```

---

### DELETE /v1/responses/{id} — Delete a response

```typescript
await openai.responses.del("resp_abc123");
```

---

### GET /v1/responses/{id}/input_items — List input items

```typescript
const items = await openai.responses.inputItems.list("resp_abc123");
```

---

### POST /v1/responses/{id}/input_tokens/count — Count tokens

```typescript
const count = await openai.responses.inputTokens.count({
  model: "gpt-4.1",
  input: historyArray,
});
// count.input_tokens
```

---

### POST /v1/responses/{id}/cancel — Cancel (background mode)

```typescript
await openai.responses.cancel("resp_abc123");
```

---

### POST /v1/responses/compact — Compact a context window

```typescript
const compacted = await openai.responses.compact({
  model: "gpt-4.1",
  input: fullHistoryArray,
  instructions: systemPrompt,  // must match the instructions used in responses.create
});
// Pass compacted.output as-is into the next responses.create call
// Do NOT prune the compact output
```

---

## Conversations API

### POST /v1/conversations — Create a conversation

```typescript
const conv = await openai.conversations.create({
  items: [...],                    // optional: up to 20 seed items
  metadata: { key: "value" },      // max 16 k/v pairs; string values only
});
// Returns: { id: "conv_...", object: "conversation", created_at, metadata }
```

**Note:** The Conversations API does not accept `model` or `instructions` at creation time. These are passed per-response via `responses.create`. Only items and metadata are accepted at conversation creation.

---

### GET /v1/conversations/{id} — Retrieve a conversation

```typescript
const conv = await openai.conversations.retrieve("conv_abc123");
```

---

### PATCH /v1/conversations/{id} — Update metadata

```typescript
await openai.conversations.update("conv_abc123", {
  metadata: { resolved: "true", ticket_id: "T-123" },
});
```

---

### DELETE /v1/conversations/{id} — Delete conversation and all items

```typescript
await openai.conversations.del("conv_abc123");
// Returns: { id: "conv_...", deleted: true }
```

---

### POST /v1/conversations/{id}/messages — Create a message

Inject items without triggering a model response. Use for:
- Injecting tool outputs after a function call
- Inserting system context mid-conversation
- Seeding a conversation with prior history

```typescript
// Inject user message (no model response triggered)
await openai.conversations.items.create("conv_abc123", {
  type: "message",
  role: "user",
  content: "Context: user is on premium plan.",
});

// Inject system message
await openai.conversations.items.create("conv_abc123", {
  type: "message",
  role: "system",
  content: "User's local time is 14:30 UTC+1.",
});

// Inject tool result
await openai.conversations.items.create("conv_abc123", {
  type: "function_call_output",
  call_id: "call_xyz",
  output: JSON.stringify({ success: true }),
});
```

Accepts: `EasyInputMessage`, `ResponseInputItem`, `Item` (any valid input item type)

---

### GET /v1/conversations/{id}/messages — List messages

```typescript
const page = await openai.conversations.items.list("conv_abc123", {
  limit: 50,                        // max 100
  order: "asc",                     // "asc" (oldest first) | "desc"
  after: "msg_cursor_id",           // cursor-based pagination
  before: "msg_cursor_id",
});
// page.data: ConversationMessage[] (Core API shape)
// page.has_more: boolean
// page.first_id, page.last_id: cursor values
```

---

### GET /v1/conversations/{id}/messages/{message_id} — Retrieve a message

```typescript
const item = await openai.conversations.items.retrieve("conv_abc123", "msg_xyz");
```

---

### DELETE /v1/conversations/{id}/messages/{message_id} — Delete a message

```typescript
await openai.conversations.items.del("conv_abc123", "msg_xyz");
// Use for: removing PII, pruning bad responses, deleting tool artifacts
```

---

## Streaming Events

Complete list of streaming event types from `responses.create({ stream: true })`:

| Event type | Key fields | When emitted |
|---|---|---|
| `response.created` | `response.id`, `response.status` | Stream opened |
| `response.in_progress` | — | Model actively generating |
| `response.output_item.added` | `item.type`, `item.id` | New output item started |
| `response.output_text.delta` | `delta: string`, `item_id` | Text chunk ready |
| `response.output_text.done` | `text: string`, `item_id` | Output item text complete |
| `response.function_call_arguments.delta` | `delta`, `call_id`, `name` | Tool arg chunk |
| `response.function_call_arguments.done` | `arguments`, `call_id`, `name` | Tool call fully formed |
| `response.output_item.done` | `item` | Output item complete |
| `response.completed` | `response` (full object) | All output done |
| `response.failed` | `response.error` | Model or system error |
| `response.incomplete` | `response.incomplete_details` | Context/token limit hit |
| `response.cancelled` | — | Cancel was requested |
| `error` | `message`, `code` | Transport-level stream error |

---

## State Strategy Comparison

| | Stateless input-array | previous_response_id | Conversations API |
|---|---|---|---|
| **History ownership** | Client | OpenAI (30-day TTL) | OpenAI (no TTL) |
| **Storage cost** | Your infra | None extra | None extra |
| **History on reconnect** | Client must send full history | Pass only latest message | Just pass conversation |
| **Item management** | Manual array | None | Full CRUD |
| **ZDR compatible** | Yes (store=false) | No | No (items persist) |
| **Compaction** | Manual (standalone endpoint) | Auto or server-side | Auto or server-side |
| **Best for** | Agent loops, ZDR, short tasks | Simple multi-turn | User-facing chat products |

---

## Key Data Shapes

### ResponseOutputItem union

```typescript
type ResponseOutputItem =
  | { type: "message"; id: string; role: "assistant"; content: ContentPart[]; status: string }
  | { type: "function_call"; id: string; call_id: string; name: string; arguments: string }
  | { type: "reasoning"; id: string; summary: string[] }
  | { type: "compaction" }  // encrypted; do not inspect
```

### ContentPart union

```typescript
type ContentPart =
  | { type: "output_text"; text: string; annotations: Annotation[] }
  | { type: "refusal"; refusal: string }
  | { type: "image_url"; image_url: { url: string } }
```

### Tool definition

```typescript
interface FunctionTool {
  type: "function";
  name: string;
  description: string;
  parameters: JSONSchema;   // standard JSON Schema object
  strict?: boolean;         // enforce strict mode (default false)
}
```

### EasyInputMessage (most common input format)

```typescript
interface EasyInputMessage {
  role: "user" | "assistant" | "system" | "developer";
  content: string | ContentPart[];
  type?: "message";  // optional; inferred
}
```