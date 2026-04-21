# DB Schemas & Data Structures

## Contents
1. [PostgreSQL Schema](#postgresql-schema)
2. [Redis Key Structures](#redis-key-structures)
3. [TypeScript Types](#typescript-types)
4. [Migration SQL](#migration-sql)
5. [Data Lifecycle & TTLs](#data-lifecycle--ttls)

---

## PostgreSQL Schema

### `agent_configs` — Agent definitions

```sql
CREATE TABLE agent_configs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT NOT NULL UNIQUE,          -- human-readable identifier, e.g. "support-bot"
  name          TEXT NOT NULL,
  description   TEXT,
  model         TEXT NOT NULL DEFAULT 'gpt-4.1',
  instructions  TEXT NOT NULL,                 -- system prompt
  tools         JSONB NOT NULL DEFAULT '[]',   -- array of OpenAI tool definitions
  tool_choice   TEXT NOT NULL DEFAULT 'auto',
  temperature   NUMERIC(3,2),
  max_tokens    INTEGER,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at   TIMESTAMPTZ                    -- soft delete
);

CREATE INDEX agent_configs_slug_idx ON agent_configs(slug) WHERE archived_at IS NULL;
```

### `conversations` — Durable thread registry

```sql
CREATE TABLE conversations (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- OpenAI identifiers
  openai_conv_id      TEXT NOT NULL UNIQUE,    -- "conv_..."  — the Conversations API ID
  openai_model        TEXT NOT NULL,

  -- Ownership
  user_id             TEXT NOT NULL,           -- your app's user identifier
  agent_config_id     UUID REFERENCES agent_configs(id),
  session_id          TEXT,                    -- optional: link to a login session

  -- Status
  status              TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active', 'archived', 'deleted')),

  -- Context window management
  last_response_id    TEXT,                    -- latest "resp_..." for chaining if needed
  approx_token_count  INTEGER DEFAULT 0,       -- tracked locally; update after each response
  compacted_at        TIMESTAMPTZ,             -- last time compaction ran

  -- Metadata
  title               TEXT,                    -- auto-generated or user-set
  metadata            JSONB NOT NULL DEFAULT '{}',

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_message_at     TIMESTAMPTZ              -- for sorting in UI
);

CREATE INDEX conversations_user_agent_idx  ON conversations(user_id, agent_config_id, status);
CREATE INDEX conversations_user_status_idx ON conversations(user_id, status, last_message_at DESC);
CREATE INDEX conversations_openai_id_idx   ON conversations(openai_conv_id);
```

### `messages` — Optional local mirror of conversation items

Store this if you need: full-text search, PII scrubbing before storage, analytics, or message-level metadata (reactions, read receipts, annotations).

```sql
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,

  -- OpenAI item identifiers
  openai_item_id  TEXT UNIQUE,             -- item id from Conversations API (may be null for injected items)
  openai_resp_id  TEXT,                    -- "resp_..." from which this item came

  -- Content
  role            TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  item_type       TEXT NOT NULL            -- 'message' | 'function_call' | 'function_call_output' | 'reasoning'
                  CHECK (item_type IN ('message', 'function_call', 'function_call_output', 'reasoning', 'compaction')),
  content         JSONB NOT NULL,          -- full content array or text, stored as-is from API
  content_text    TEXT,                    -- extracted plain text for search indexing

  -- Tool call fields (populated when item_type = 'function_call')
  tool_call_id    TEXT,
  tool_name       TEXT,
  tool_arguments  JSONB,
  tool_output     JSONB,                   -- set when item_type = 'function_call_output'

  -- Status
  status          TEXT CHECK (status IN ('completed', 'incomplete', 'failed', 'in_progress')),
  finish_reason   TEXT,                    -- 'stop' | 'max_tokens' | 'content_filter' | etc.

  -- Token usage (from response.usage)
  input_tokens    INTEGER,
  output_tokens   INTEGER,

  -- Flags
  is_hidden       BOOLEAN NOT NULL DEFAULT FALSE,  -- for soft-deleting without removing from OpenAI
  metadata        JSONB NOT NULL DEFAULT '{}',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX messages_conversation_idx ON messages(conversation_id, created_at ASC);
CREATE INDEX messages_openai_resp_idx  ON messages(openai_resp_id);
CREATE INDEX messages_tool_call_idx    ON messages(tool_call_id) WHERE tool_call_id IS NOT NULL;
-- Full-text search (optional)
CREATE INDEX messages_content_search   ON messages USING GIN(to_tsvector('english', COALESCE(content_text, '')));
```

### `response_traces` — Request-level audit log

```sql
CREATE TABLE response_traces (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id     UUID REFERENCES conversations(id),
  openai_resp_id      TEXT,
  openai_request_id   TEXT,               -- x-request-id header from OpenAI
  client_request_id   TEXT,               -- X-Client-Request-Id you sent

  model               TEXT,
  status              TEXT,               -- 'completed' | 'failed' | 'incomplete' | 'cancelled'
  finish_reason       TEXT,
  input_tokens        INTEGER,
  output_tokens       INTEGER,
  latency_ms          INTEGER,

  error_code          TEXT,
  error_message       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX response_traces_conv_idx  ON response_traces(conversation_id, created_at DESC);
CREATE INDEX response_traces_resp_idx  ON response_traces(openai_resp_id);
```

---

## Redis Key Structures

Use Redis for fast session lookups and transient stream state.

```
# Active conversation lookup (short-circuit DB)
# Key: conv:{userId}:{agentSlug}
# Value: openai_conv_id string
# TTL: match your session TTL (e.g. 30 days)
SET conv:{userId}:{agentSlug} "conv_abc123..."  EX 2592000

# In-progress stream guard (prevent duplicate streams)
# Key: stream_lock:{openai_conv_id}
# Value: response_id or "pending"
# TTL: 120s (clean up if stream dies)
SET stream_lock:{openai_conv_id} "resp_xyz..."  EX 120  NX

# Recent response ID (for chaining without DB hit)
# Key: last_resp:{openai_conv_id}
# Value: openai_resp_id
SET last_resp:{openai_conv_id} "resp_abc..."  EX 3600

# Token count cache (avoid DB write on every turn)
# Key: tokens:{openai_conv_id}
# Value: integer string
SET tokens:{openai_conv_id} "45230"  EX 86400
```

---

## TypeScript Types

### Core domain types

```typescript
// ─── Agent Config ──────────────────────────────────────────────────────────

export interface AgentConfig {
  id: string;
  slug: string;
  name: string;
  model: string;
  instructions: string;
  tools: OpenAI.Responses.Tool[];
  toolChoice: "auto" | "none" | "required" | { type: "function"; name: string };
  temperature?: number;
  maxTokens?: number;
  metadata: Record<string, string>;
}

// ─── Conversation ───────────────────────────────────────────────────────────

export type ConversationStatus = "active" | "archived" | "deleted";

export interface Conversation {
  id: string;                    // your UUID
  openaiConvId: string;          // "conv_..."
  openaiModel: string;
  userId: string;
  agentConfigId: string;
  sessionId?: string;
  status: ConversationStatus;
  lastResponseId?: string;
  approxTokenCount: number;
  compactedAt?: Date;
  title?: string;
  metadata: Record<string, string>;
  createdAt: Date;
  updatedAt: Date;
  lastMessageAt?: Date;
}

export interface ConversationCreateParams {
  userId: string;
  agentConfig: AgentConfig;
  sessionId?: string;
  title?: string;
  metadata?: Record<string, string>;
  initialItems?: OpenAI.Responses.ResponseInputItem[];  // up to 20
}

// ─── Messages ───────────────────────────────────────────────────────────────

export type MessageRole = "user" | "assistant" | "system" | "tool";
export type ItemType = "message" | "function_call" | "function_call_output" | "reasoning" | "compaction";
export type MessageStatus = "completed" | "incomplete" | "failed" | "in_progress";

export interface Message {
  id: string;
  conversationId: string;
  openaiItemId?: string;
  openaiRespId?: string;
  role: MessageRole;
  itemType: ItemType;
  content: OpenAI.Responses.ResponseOutputItem["content"] | string;
  contentText?: string;         // extracted plain text
  toolCallId?: string;
  toolName?: string;
  toolArguments?: unknown;
  toolOutput?: unknown;
  status?: MessageStatus;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  isHidden: boolean;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ─── API Payloads ───────────────────────────────────────────────────────────

export interface SendMessageParams {
  conversationId: string;       // your internal ID
  openaiConvId: string;
  userMessage: string;
  agentConfig: AgentConfig;
  stream: boolean;
  clientRequestId?: string;     // for X-Client-Request-Id header
}

export interface StreamEvent {
  type: "text_delta" | "text_done" | "tool_call" | "completed" | "failed" | "incomplete";
  delta?: string;
  text?: string;
  toolCall?: { name: string; callId: string; arguments: unknown };
  error?: { code: string; message: string };
  responseId?: string;
  usage?: { inputTokens: number; outputTokens: number };
}

// ─── Response Trace ─────────────────────────────────────────────────────────

export interface ResponseTrace {
  conversationId: string;
  openaiRespId?: string;
  openaiRequestId?: string;
  clientRequestId?: string;
  model: string;
  status: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
  errorCode?: string;
  errorMessage?: string;
}
```

---

## Migration SQL

Run in order for a fresh installation:

```sql
-- 001_create_agent_configs.sql
CREATE TABLE agent_configs ( ... );  -- see above

-- 002_create_conversations.sql
CREATE TABLE conversations ( ... );
CREATE TABLE response_traces ( ... );

-- 003_create_messages.sql
CREATE TABLE messages ( ... );

-- 004_indexes.sql
-- (all CREATE INDEX statements from above)

-- 005_updated_at_trigger.sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER agent_configs_updated_at
  BEFORE UPDATE ON agent_configs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## Data Lifecycle & TTLs

| Object | Where stored | TTL / Lifetime |
|---|---|---|
| `AgentConfig` | Your PostgreSQL | Permanent (soft delete via `archived_at`) |
| `Conversation` | Your PostgreSQL + OpenAI | Your DB: permanent; OpenAI: **indefinite** (no 30-day expiry) |
| `Message` (mirror) | Your PostgreSQL | Permanent (soft delete via `is_hidden`) |
| `ResponseTrace` | Your PostgreSQL | Permanent; prune after 90 days via cron if desired |
| `Response` (`store=true`) | OpenAI only | **30 days** — after that, not retrievable via API |
| `Response` (`store=false`) | Not stored | Never persisted by OpenAI (ZDR) |
| `Conversation Items` | OpenAI Conversations API | **Indefinite** — persists until you delete |
| Redis `conv:` key | Redis | Match your session TTL (e.g. 30 days) |
| Redis `stream_lock:` | Redis | 120 seconds auto-expire |

### Key insight on TTLs
Conversations API items have **no 30-day TTL** — this is the main advantage over `previous_response_id` chaining (where the stored responses expire after 30 days). If your product needs conversations that survive beyond 30 days without mirroring to your own DB, use the Conversations API.

---

## Seed Data: Example Agent Config

```sql
INSERT INTO agent_configs (slug, name, instructions, model, tools) VALUES (
  'support-agent',
  'Customer Support Agent',
  'You are a helpful customer support assistant for Acme Corp. Be concise and friendly.
Always ask clarifying questions before attempting to solve a problem.
If you cannot solve an issue, escalate by calling the escalate_ticket tool.',
  'gpt-4.1',
  '[
    {
      "type": "function",
      "name": "lookup_order",
      "description": "Look up an order by order ID",
      "parameters": {
        "type": "object",
        "properties": {
          "order_id": { "type": "string", "description": "The order ID to look up" }
        },
        "required": ["order_id"]
      }
    },
    {
      "type": "function",
      "name": "escalate_ticket",
      "description": "Escalate the issue to a human agent",
      "parameters": {
        "type": "object",
        "properties": {
          "reason": { "type": "string" },
          "priority": { "type": "string", "enum": ["low", "medium", "high"] }
        },
        "required": ["reason", "priority"]
      }
    }
  ]'::jsonb
);
```