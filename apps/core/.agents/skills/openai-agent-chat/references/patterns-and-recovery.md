# Patterns & Recovery

## Contents
1. [Conversation Lifecycle](#conversation-lifecycle)
2. [Streaming SSE Proxy](#streaming-sse-proxy)
3. [Full Streaming Event Handler](#full-streaming-event-handler)
4. [Agentic Tool Loop](#agentic-tool-loop)
5. [Error Recovery & Retry](#error-recovery--retry)
6. [Stream Reconnect (Interrupted Streams)](#stream-reconnect)
7. [Compaction Patterns](#compaction-patterns)
8. [Multi-Agent Handoff](#multi-agent-handoff)
9. [Request Tracing](#request-tracing)
10. [Conversations API — Full Endpoint Usage](#conversations-api--full-endpoint-usage)

---

## Conversation Lifecycle

### Create and persist a conversation

```typescript
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function createConversation(
  params: ConversationCreateParams,
  db: DatabaseClient,
  redis: RedisClient
): Promise<Conversation> {
  // 1. Create on OpenAI
  const oaiConv = await openai.conversations.create({
    ...(params.initialItems?.length
      ? { items: params.initialItems }
      : {}),
    metadata: {
      user_id: params.userId,
      agent_slug: params.agentConfig.slug,
    },
  });

  // 2. Persist locally
  const conv = await db.conversations.insert({
    id: uuidv4(),
    openai_conv_id: oaiConv.id,
    openai_model: params.agentConfig.model,
    user_id: params.userId,
    agent_config_id: params.agentConfig.id,
    session_id: params.sessionId,
    status: "active",
    metadata: params.metadata ?? {},
  });

  // 3. Cache in Redis for fast lookup
  await redis.set(
    `conv:${params.userId}:${params.agentConfig.slug}`,
    oaiConv.id,
    { EX: 60 * 60 * 24 * 30 }  // 30 days
  );

  return conv;
}

async function getOrCreateConversation(
  userId: string,
  agentConfig: AgentConfig,
  db: DatabaseClient,
  redis: RedisClient
): Promise<Conversation> {
  // 1. Fast path: check Redis
  const cached = await redis.get(`conv:${userId}:${agentConfig.slug}`);
  if (cached) {
    // Verify it still exists on OpenAI (avoids 404 later)
    try {
      await openai.conversations.retrieve(cached);
      const conv = await db.conversations.findByOpenaiId(cached);
      if (conv?.status === "active") return conv;
    } catch (err: any) {
      if (err.status !== 404) throw err;
      // Conversation deleted on OpenAI side — fall through to create
      await redis.del(`conv:${userId}:${agentConfig.slug}`);
    }
  }

  // 2. Check DB for existing active conversation
  const existing = await db.conversations.findActive(userId, agentConfig.id);
  if (existing) {
    // Verify with OpenAI
    try {
      await openai.conversations.retrieve(existing.openaiConvId);
      await redis.set(`conv:${userId}:${agentConfig.slug}`, existing.openaiConvId, { EX: 2592000 });
      return existing;
    } catch (err: any) {
      if (err.status !== 404) throw err;
      await db.conversations.markDeleted(existing.id);
    }
  }

  // 3. Create new
  return createConversation({ userId, agentConfig }, db, redis);
}
```

---

## Streaming SSE Proxy

### Express route that proxies OpenAI stream to client

```typescript
import express from "express";
import { randomUUID } from "crypto";

const router = express.Router();

router.get("/conversations/:convId/stream", authenticateUser, async (req, res) => {
  const { convId } = req.params;
  const { message } = req.query as { message: string };
  const userId = req.user.id;

  // 1. Verify ownership
  const conv = await db.conversations.findById(convId);
  if (!conv || conv.userId !== userId) return res.status(403).json({ error: "Forbidden" });

  // 2. Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering

  const clientRequestId = randomUUID();
  const startTime = Date.now();
  let responseId: string | null = null;

  // 3. Open stream to OpenAI
  try {
    const stream = await openai.responses.create({
      model: conv.agentConfig.model,
      conversation_id: conv.openaiConvId,
      input: [{ role: "user", content: message }],
      instructions: conv.agentConfig.instructions,
      tools: conv.agentConfig.tools,
      tool_choice: conv.agentConfig.toolChoice,
      stream: true,
      store: true,
      context_management: [{ type: "compaction", compact_threshold: 0.8 }],
    }, {
      headers: { "X-Client-Request-Id": clientRequestId },
    });

    // 4. Process and forward events
    for await (const event of stream) {
      responseId = responseId ?? (event as any).response?.id;

      // Forward raw event to client
      res.write(`data: ${JSON.stringify(event)}\n\n`);

      if (event.type === "response.completed") {
        // Persist trace
        await persistResponseTrace({
          conversationId: conv.id,
          openaiRespId: event.response.id,
          clientRequestId,
          model: event.response.model,
          status: event.response.status,
          inputTokens: event.response.usage?.input_tokens,
          outputTokens: event.response.usage?.output_tokens,
          latencyMs: Date.now() - startTime,
        }, db);

        // Update conversation
        await db.conversations.update(conv.id, {
          lastResponseId: event.response.id,
          approxTokenCount: event.response.usage?.total_tokens,
          lastMessageAt: new Date(),
        });

        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      if (event.type === "response.failed" || event.type === "response.incomplete") {
        res.write(`data: ${JSON.stringify({ type: "done", error: event.response.error })}\n\n`);
        res.end();
        return;
      }
    }
  } catch (err: any) {
    console.error("Stream error:", err);
    res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
    res.end();
  }
});
```

---

## Full Streaming Event Handler

### Client-side handler for SSE events

```typescript
class AgentChatStream {
  private responseId: string | null = null;
  private textBuffer = "";

  async processStream(
    stream: AsyncIterable<OpenAI.Responses.ResponseStreamEvent>,
    onDelta: (delta: string) => void,
    onToolCall: (call: { name: string; callId: string; args: unknown }) => Promise<void>,
    onComplete: (responseId: string, usage: { input: number; output: number }) => void,
    onError: (error: { code?: string; message: string }) => void
  ) {
    const pendingToolCalls: Record<string, { name: string; argsBuffer: string }> = {};

    for await (const event of stream) {
      switch (event.type) {
        case "response.created":
          this.responseId = event.response.id;
          break;

        case "response.output_text.delta":
          this.textBuffer += event.delta;
          onDelta(event.delta);
          break;

        case "response.output_text.done":
          // Full text for this output item is complete
          break;

        case "response.function_call_arguments.delta":
          if (!pendingToolCalls[event.call_id]) {
            pendingToolCalls[event.call_id] = { name: event.name ?? "", argsBuffer: "" };
          }
          pendingToolCalls[event.call_id].argsBuffer += event.delta;
          break;

        case "response.function_call_arguments.done":
          const toolCall = pendingToolCalls[event.call_id];
          if (toolCall) {
            await onToolCall({
              name: toolCall.name,
              callId: event.call_id,
              args: JSON.parse(toolCall.argsBuffer),
            });
            delete pendingToolCalls[event.call_id];
          }
          break;

        case "response.completed":
          onComplete(event.response.id, {
            input: event.response.usage?.input_tokens ?? 0,
            output: event.response.usage?.output_tokens ?? 0,
          });
          break;

        case "response.failed":
          onError({ code: event.response.error?.code, message: event.response.error?.message ?? "Unknown error" });
          break;

        case "response.incomplete":
          const reason = event.response.incomplete_details?.reason;
          onError({ message: `Response incomplete: ${reason}` });
          break;

        case "error":
          onError({ message: (event as any).message ?? "Stream error" });
          break;
      }
    }
  }
}
```

---

## Agentic Tool Loop

### Multi-step tool execution with streaming

```typescript
const MAX_TOOL_ITERATIONS = 10;

async function runAgentLoop(
  conv: Conversation,
  userMessage: string,
  agentConfig: AgentConfig,
  onDelta: (delta: string) => void,
  onToolStatus: (name: string, status: "running" | "done") => void
): Promise<{ responseId: string; text: string }> {
  let iteration = 0;
  let accumulatedText = "";
  let lastResponseId: string | null = null;

  // First turn: include user message
  let input: OpenAI.Responses.ResponseInputItem[] = [
    { type: "message", role: "user", content: userMessage },
  ];

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++;

    const stream = await openai.responses.create({
      model: agentConfig.model,
      conversation_id: conv.openaiConvId,
      input,
      instructions: agentConfig.instructions,
      tools: agentConfig.tools,
      tool_choice: agentConfig.toolChoice,
      stream: true,
    });

    const toolCalls: Array<{ name: string; callId: string; args: unknown }> = [];
    let streamText = "";
    let isComplete = false;

    for await (const event of stream) {
      if (event.type === "response.created") {
        lastResponseId = event.response.id;
      }
      if (event.type === "response.output_text.delta") {
        streamText += event.delta;
        accumulatedText += event.delta;
        onDelta(event.delta);
      }
      if (event.type === "response.function_call_arguments.done") {
        toolCalls.push({
          name: event.name!,
          callId: event.call_id,
          args: JSON.parse(event.arguments),
        });
      }
      if (event.type === "response.completed") {
        isComplete = true;
      }
    }

    // No tool calls → done
    if (toolCalls.length === 0 || isComplete) {
      break;
    }

    // Execute tool calls in parallel
    const toolResults = await Promise.allSettled(
      toolCalls.map(async (call) => {
        onToolStatus(call.name, "running");
        const result = await executeToolCall(call.name, call.args);
        onToolStatus(call.name, "done");
        return { callId: call.callId, result };
      })
    );

    // Inject results back into conversation
    for (const settled of toolResults) {
      if (settled.status === "fulfilled") {
        await openai.conversations.items.create(conv.openaiConvId, {
          type: "function_call_output",
          call_id: settled.value.callId,
          output: JSON.stringify(settled.value.result),
        });
      }
    }

    // Next iteration: empty input (history is in conversation)
    input = [];
  }

  if (iteration >= MAX_TOOL_ITERATIONS) {
    console.warn(`Agent loop hit max iterations (${MAX_TOOL_ITERATIONS}) for conv ${conv.id}`);
  }

  return { responseId: lastResponseId!, text: accumulatedText };
}
```

---

## Error Recovery & Retry

### Exponential backoff with jitter

```typescript
interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  retryOn?: number[];  // HTTP status codes to retry
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    baseDelayMs = 1000,
    maxDelayMs = 30000,
    retryOn = [429, 500, 502, 503, 504],
  } = opts;

  let lastError: any;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastError = err;
      const status = err?.status ?? err?.response?.status;

      if (!retryOn.includes(status)) throw err; // Non-retriable

      // Respect Retry-After header (rate limit)
      const retryAfter = err?.headers?.["retry-after"];
      const delay = retryAfter
        ? parseInt(retryAfter) * 1000
        : Math.min(baseDelayMs * 2 ** attempt + Math.random() * 500, maxDelayMs);

      console.warn(`Attempt ${attempt + 1}/${maxAttempts} failed (${status}). Retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastError;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

### Conversation 404 recovery

```typescript
async function safeRespond(
  conv: Conversation,
  input: OpenAI.Responses.ResponseInputItem[],
  agentConfig: AgentConfig,
  db: DatabaseClient,
  redis: RedisClient
): Promise<OpenAI.Responses.Response> {
  try {
    return await withRetry(() => openai.responses.create({
      model: agentConfig.model,
      conversation_id: conv.openaiConvId,
      input,
      instructions: agentConfig.instructions,
    }));
  } catch (err: any) {
    if (err?.status === 404) {
      // Conversation deleted on OpenAI — create a new one
      console.warn(`Conversation ${conv.openaiConvId} not found on OpenAI; recreating`);
      await db.conversations.markDeleted(conv.id);
      await redis.del(`conv:${conv.userId}:${agentConfig.slug}`);

      const newConv = await createConversation(
        { userId: conv.userId, agentConfig, sessionId: conv.sessionId },
        db,
        redis
      );

      return openai.responses.create({
        model: agentConfig.model,
        conversation_id: newConv.openaiConvId,
        input,
        instructions: agentConfig.instructions,
      });
    }
    throw err;
  }
}
```

---

## Stream Reconnect

### Recover from a dropped stream using response polling

```typescript
class ResilientStreamSession {
  private inProgressResponseId: string | null = null;

  async send(
    conv: Conversation,
    userMessage: string,
    agentConfig: AgentConfig,
    onEvent: (event: OpenAI.Responses.ResponseStreamEvent) => void
  ): Promise<string> {
    let responseId: string | null = null;

    const stream = await openai.responses.create({
      model: agentConfig.model,
      conversation_id: conv.openaiConvId,
      input: [{ type: "message", role: "user", content: userMessage }],
      instructions: agentConfig.instructions,
      stream: true,
    });

    try {
      for await (const event of stream) {
        if (event.type === "response.created") {
          responseId = event.response.id;
          this.inProgressResponseId = responseId;
        }
        onEvent(event);
        if (event.type === "response.completed") {
          this.inProgressResponseId = null;
          return event.response.id;
        }
        if (event.type === "response.failed") {
          throw new Error(event.response.error?.message ?? "Response failed");
        }
      }
    } catch (err) {
      // Stream disconnected — poll if we have a response ID
      if (responseId) {
        console.warn(`Stream dropped at responseId=${responseId}; polling for completion`);
        return this.pollUntilComplete(responseId, onEvent);
      }
      throw err;
    }

    throw new Error("Stream ended without completion event");
  }

  private async pollUntilComplete(
    responseId: string,
    onEvent: (event: any) => void,
    maxAttempts = 15
  ): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await sleep(Math.min(1000 * (i + 1), 10000));
      const response = await openai.responses.retrieve(responseId);

      if (response.status === "completed") {
        // Emit a synthetic completed event so callers handle it uniformly
        onEvent({ type: "response.completed", response });
        return response.id;
      }
      if (response.status === "failed") {
        throw new Error(response.error?.message ?? "Response failed during poll");
      }
      if (response.status === "cancelled") {
        throw new Error("Response was cancelled");
      }
      // status === "in_progress" → keep polling
    }
    throw new Error(`Response ${responseId} did not complete within ${maxAttempts} poll attempts`);
  }
}
```

### Incomplete response handling

```typescript
function handleIncomplete(
  response: OpenAI.Responses.Response,
  onPartialText: (text: string) => void,
  onWarning: (msg: string) => void
) {
  const text = response.output_text;
  if (text) onPartialText(text);

  const reason = response.incomplete_details?.reason;
  const messages: Record<string, string> = {
    max_output_tokens: "Response was cut off — ask me to continue.",
    content_filter: "Some content was filtered by safety policy.",
    timeout: "Response timed out — please try again.",
  };
  onWarning(messages[reason ?? ""] ?? "Response incomplete — please try again.");
}
```

---

## Compaction Patterns

### Proactive server-side compaction (recommended)

```typescript
const stream = await openai.responses.create({
  model: "gpt-4.1",
  conversation_id: conv.openaiConvId,
  input: [{ role: "user", content: message }],
  stream: true,
  context_management: [{ type: "compaction", compact_threshold: 0.8 }],
  // compact_threshold: 0.8 = trigger when 80% of context window is used
});
// No extra code needed — compaction item appears automatically in stream
// After compaction, update conversation.compacted_at in DB
```

### Client-side compaction (ZDR / stateless flows)

```typescript
async function chatWithCompaction(
  history: OpenAI.Responses.ResponseInputItem[],
  newMessage: string,
  model: string,
  systemPrompt: string
): Promise<{ response: OpenAI.Responses.Response; history: OpenAI.Responses.ResponseInputItem[] }> {
  // 1. Check token count before sending
  const tokenCount = await openai.responses.inputTokens.count({
    model,
    input: history,
  });

  // 2. Compact if > 70% of context (adjust threshold per model)
  const contextLimits: Record<string, number> = {
    "gpt-4.1": 128000,
    "gpt-4o": 128000,
    "gpt-4o-mini": 128000,
  };
  const limit = contextLimits[model] ?? 128000;

  if (tokenCount.input_tokens > limit * 0.7) {
    const compacted = await openai.responses.compact({
      model,
      input: history,
      instructions: systemPrompt,  // use same instructions as responses.create
    });
    // IMPORTANT: pass compacted.output as-is; do not prune standalone compact output
    history = compacted.output;
  }

  // 3. Add new user message and run
  history.push({ type: "message", role: "user", content: newMessage });

  const response = await openai.responses.create({
    model,
    input: history,
    instructions: systemPrompt,
    store: false,  // ZDR
  });

  history.push(...response.output);
  return { response, history };
}
```

---

## Multi-Agent Handoff

### Route to a different agent within the same conversation

```typescript
async function handoffToAgent(
  conv: Conversation,
  targetAgent: AgentConfig,
  handoffMessage: string,
  db: DatabaseClient
): Promise<OpenAI.Responses.Response> {
  // Inject a system message signaling the handoff
  await openai.conversations.items.create(conv.openaiConvId, {
    type: "message",
    role: "system",
    content: `[Handoff] ${handoffMessage}. You are now ${targetAgent.name}.`,
  });

  // Continue conversation with new agent's instructions and tools
  return openai.responses.create({
    model: targetAgent.model,
    conversation_id: conv.openaiConvId,
    input: [],  // history already in conversation
    instructions: targetAgent.instructions,
    tools: targetAgent.tools,
    tool_choice: targetAgent.toolChoice,
  });
}
```

### Parallel research (fan-out to multiple agents)

```typescript
async function parallelAgentResearch(
  topics: string[],
  agentConfig: AgentConfig
): Promise<string[]> {
  // Each topic gets its own ephemeral conversation (no shared state needed)
  const results = await Promise.allSettled(
    topics.map(async (topic) => {
      const response = await openai.responses.create({
        model: agentConfig.model,
        input: [{ role: "user", content: `Research: ${topic}` }],
        instructions: agentConfig.instructions,
        store: false,
      });
      return response.output_text;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<string> => r.status === "fulfilled")
    .map((r) => r.value);
}
```

---

## Request Tracing

### Set and capture request IDs for every call

```typescript
import { randomUUID } from "crypto";

async function tracedResponseCreate(
  params: OpenAI.Responses.ResponseCreateParams,
  db: DatabaseClient
): Promise<OpenAI.Responses.Response> {
  const clientRequestId = randomUUID();
  const startTime = Date.now();

  let response: OpenAI.Responses.Response;
  let openaiRequestId: string | undefined;

  try {
    const rawResponse = await openai.responses.create(params, {
      headers: { "X-Client-Request-Id": clientRequestId },
    }).withResponse();

    openaiRequestId = rawResponse.response.headers.get("x-request-id") ?? undefined;
    response = rawResponse.data;
  } catch (err: any) {
    // Log failed request
    await db.responseTraces.insert({
      openaiRequestId: err?.headers?.["x-request-id"],
      clientRequestId,
      model: params.model,
      status: "failed",
      latencyMs: Date.now() - startTime,
      errorCode: err?.code ?? String(err?.status),
      errorMessage: err?.message,
    });
    throw err;
  }

  // Log successful request
  await db.responseTraces.insert({
    openaiRespId: response.id,
    openaiRequestId,
    clientRequestId,
    model: response.model,
    status: response.status,
    finishReason: response.incomplete_details?.reason,
    inputTokens: response.usage?.input_tokens,
    outputTokens: response.usage?.output_tokens,
    latencyMs: Date.now() - startTime,
  });

  return response;
}
```

---

## Conversations API — Full Endpoint Usage

```typescript
// Create a conversation (optionally seed with up to 20 items)
const conv = await openai.conversations.create({
  metadata: { user_id: userId },
});

// Retrieve conversation metadata
const convMeta = await openai.conversations.retrieve(conv.id);

// Update conversation metadata
await openai.conversations.update(conv.id, {
  metadata: { resolved: "true" },
});

// Delete conversation (and all its items)
await openai.conversations.del(conv.id);

// ── Items ─────────────────────────────────────────────────────────────────

// List all items (paginate for long conversations)
async function listAllItems(conversationId: string) {
  const items: OpenAI.Conversations.ConversationItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await openai.conversations.items.list(conversationId, {
      limit: 100,
      order: "asc",
      after: cursor,
    });
    items.push(...page.data);
    cursor = page.has_more ? page.last_id : undefined;
  } while (cursor);
  return items;
}

// Inject a user message into the conversation (without triggering a response)
await openai.conversations.items.create(conv.id, {
  type: "message",
  role: "user",
  content: "Context from external system: user is a premium subscriber.",
});

// Inject a system message mid-conversation
await openai.conversations.items.create(conv.id, {
  type: "message",
  role: "system",
  content: "The user's timezone is Europe/Zurich.",
});

// Inject a tool call output
await openai.conversations.items.create(conv.id, {
  type: "function_call_output",
  call_id: "call_xyz123",
  output: JSON.stringify({ balance: 142.50, currency: "USD" }),   
});

// Retrieve a specific item
const item = await openai.conversations.items.retrieve(conv.id, "msg_xyz");

// Delete a specific item (e.g., to remove PII or bad response)
await openai.conversations.items.del(conv.id, "msg_xyz");
```