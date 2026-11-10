---
name: using-ably
description: >
  ALWAYS use when building realtime features with Ably — messaging, chat,
  collaboration, presence, or streaming AI agent output. Covers product and SDK
  selection (Pub/Sub vs Chat vs Spaces vs LiveObjects vs AI Transport), device vs
  server packages (@ably/pubsub-device, @ably/pubsub-server) and MAU clientId
  rules, authentication (JWT, token auth, authUrl), channel design, React
  integration, and critical mistakes like missing Chat attach(), client-side API
  key exposure, and creating Ably clients inside components. Fetches current docs from
  ably.com/llms.txt before generating code. Not for general WebSocket or non-Ably
  realtime libraries.
license: Apache-2.0
metadata:
  tags: ably, realtime, pubsub, websocket, messaging, chat, spaces, ai-transport, liveobjects, livesync
---

# Using Ably

Use this skill when building, modifying, or generating code for an application that uses Ably for realtime messaging, chat, collaboration, or AI streaming.

## What Ably Is

Ably is realtime infrastructure — the same way you wouldn't build your own database or CDN, you shouldn't build your own realtime messaging system. Ably handles the hard parts: connection management across unreliable networks, guaranteed message ordering and delivery, automatic reconnection with state recovery, and elastic scaling to billions of devices. It works across platforms (25+ SDKs) and protocols (WebSocket, MQTT, SSE, HTTP), so you can focus on your application logic rather than transport reliability.

## Documentation

Always check the official docs at [ably.com/docs](https://ably.com/docs?source=using-ably) for current API references. For LLM-optimized documentation, use [ably.com/llms.txt](https://ably.com/llms.txt?source=using-ably). The guidance below covers architectural decisions and common mistakes that documentation alone doesn't prevent.

---

## Before Writing Code

**Always verify against current documentation before generating Ably code.** Training data goes stale — methods get renamed, parameters change, new products launch. These three checks prevent the most common LLM code generation failures.

### 1. Fetch Current Docs First

Before generating code for any Ably feature:

1. Fetch `https://ably.com/llms.txt?source=using-ably` to get the documentation URL index
2. Fetch the relevant product and platform documentation pages
3. Verify method names, parameters, return types, and package versions against the fetched docs
4. If a feature or method doesn't appear in the docs, it probably doesn't exist — don't fabricate it

Never guess or construct doc URLs. Only use URLs from llms.txt or web search results. If a URL 404s, go back to llms.txt. Web search is also allowed as a complementary approach. If llms.txt is unreachable, fall back to web search or browse `https://ably.com/docs?source=using-ably` directly.

### 2. Confirm SDK Availability

Not all products are available on all platforms. Before generating code, confirm from the fetched docs that the product has an SDK for the user's platform.

If no SDK exists:
- State clearly: "[Product] does not currently have an SDK for [platform]"
- Don't fabricate an API
- Offer alternatives: REST API directly, a different product that IS available, or MQTT/SSE protocol adapters for constrained devices

### 3. Post-Generation Check

After generating code, verify these common-mistake patterns:

- [ ] **Right package for the side?** Device code uses `@ably/pubsub-device`, backend code uses `@ably/pubsub-server` — never the legacy `ably` package or bare `new Ably.Realtime()` / `new Ably.Rest()` (see Section 2). Never `AblyProvider` or `useAbly`: they don't exist in v3, use `PubSubClientProvider` and `usePubSubClient` (see Section 9)
- [ ] **Device client without a `clientId`?** Rejected at connect on MAU-billed accounts — the token must carry one (see Section 2)
- [ ] **REST API, MQTT or other non-SDK server traffic?** Declare it with `clientType=server` (API key) or the `x-ably-clientType: server` claim (token), or it counts as a user (see Section 2)
- [ ] **API key in client code?** Must use `authUrl`/`authCallback` with JWT or token auth (see Section 4)
- [ ] **Chat SDK: `attach()` before subscribing?** Subscribe first to avoid messages being silently lost (see Section 8)
- [ ] **React: Ably client created inside a component without cleanup?** Create once outside and pass via provider, or use useEffect with proper cleanup (see Section 9)
- [ ] **Server-side: realtime client used when HTTP would suffice?** Default to `createHttpClient()` for publishing, token generation, history (see Section 2)
- [ ] **Connection cleanup on unmount/exit?** Call `realtime.close()` (see Section 6)
- [ ] **Reimplementing built-in behavior?** Don't add custom debounce for typing indicators, custom throttling for cursors, or custom conflict resolution for LiveObjects (see Section 10)
- [ ] **AI Transport: channel rule enabled?** The namespace needs `mutableMessages`, or streaming fails with error `93002` (see Section 3)

---

## 1. Understand the Product and SDK Landscape

Ably is a multi-product platform, not a single SDK. Choosing the wrong product or SDK is the most common integration mistake.

### Product Layer: What Are You Building?

| Product | Use Case | SDK |
|---------|----------|-----|
| **Pub/Sub** | Core messaging: live dashboards, notifications, IoT, event streaming | `@ably/pubsub-device` or `@ably/pubsub-server` |
| **AI Transport** | Streaming LLM tokens, multi-device fan-out, resumable AI conversations | `@ably/ai-transport` |
| **LiveObjects** | Shared mutable state: counters, key-value maps, collaborative data | Pub/Sub package + LiveObjects plugin (`/liveobjects`) |
| **LiveSync** | Database-to-frontend sync (PostgreSQL change streams) | `@ably-labs/models` + ADBC connector |
| **Chat** | Chat rooms, typing indicators, reactions, message history, moderation | `@ably/chat` |
| **Spaces** | Collaborative cursors, avatar stacks, member locations, component locking | `@ably/spaces` |

### SDK Architecture: Two Layers

**Layer 1 — Pub/Sub SDKs** (used directly for Pub/Sub, LiveObjects, LiveSync), one package per side of the connection:

| Package | Runs On | Factories |
|---------|---------|-----------|
| **`@ably/pubsub-device`** | An end user's device: browser, React Native, Electron, mobile or desktop app | `createClient()` — realtime client |
| **`@ably/pubsub-server`** | Infrastructure you operate: Node.js server, container, serverless function | `createHttpClient()` — stateless HTTP<br>`createRealtimeClient()` — persistent connection |

These are the foundation. Pick the package by side first, then the client kind — see Section 2. LiveObjects and LiveSync build on the realtime client — LiveObjects as a plugin you pass in client options, LiveSync via the Models SDK.

**Layer 2 — Product SDKs** (higher-level abstractions for specific use cases):

| SDK | Purpose |
|-----|---------|
| **`@ably/chat`** | Rooms, typing indicators, reactions, message history, moderation |
| **`@ably/spaces`** | Cursors, avatar stacks, member locations, component locking |
| **`@ably/ai-transport`** | A transport over one channel: the agent pipes its model stream in, clients subscribe and catch up from history. Codecs for the Vercel AI SDK, OpenAI and AG-UI |

These product SDKs depend on the Pub/Sub SDK. You pass them a realtime client created by the package for your side — `createClient()` on a device, `createRealtimeClient()` on a server. The underlying Pub/Sub knowledge (auth, channels, presence) still applies.

### Decision Rules

```
Q: Does this code run on an end user's device, or on infrastructure you operate?
├── Server (@ably/pubsub-server):
│   ├── Publishing, token generation, history → createHttpClient() (stateless HTTP)
│   ├── Streaming AI agent output → @ably/ai-transport createTransport() over createRealtimeClient()
│   └── Need persistent connection (subscribing) → createRealtimeClient()
└── Device (@ably/pubsub-device) → createClient(), then:
    ├── Building chat? → Use @ably/chat (pass the client)
    ├── Building collaboration? → Use @ably/spaces (pass the client)
    ├── Consuming AI agent output? → Use @ably/ai-transport createTransport() (pass the client)
    ├── Need shared state? → Use LiveObjects plugin with the client
    ├── Syncing database? → Use @ably-labs/models with ADBC connector
    └── Otherwise → Use the client directly (Pub/Sub)
```

**Server-side rule of thumb:** Default to `createHttpClient()` for server operations. Only use `createRealtimeClient()` when you genuinely need a persistent connection — for example, an AI agent streaming tokens to clients, or a backend service that subscribes to events.

### Common Mistakes

```javascript
// WRONG: Using an HTTP client then polling for messages
const http = createHttpClient({ key: '...' });
setInterval(async () => {
  const history = await http.channels.get('updates').history();
}, 1000);

// RIGHT: Using a realtime client to subscribe
const realtime = createRealtimeClient({ key: '...' });
realtime.channels.get('updates').subscribe((msg) => {
  console.log('Received:', msg.data);
});

// WRONG: Using raw Pub/Sub for chat when Chat SDK exists
const client = createClient({ authUrl: '/api/ably-auth' }); // @ably/pubsub-device
client.channels.get('chat-room').subscribe((msg) => { /* manually handling typing, reactions, history... */ });

// RIGHT: Using Chat SDK which handles all chat patterns
import { ChatClient } from '@ably/chat';
const chat = new ChatClient(client);
const room = await chat.rooms.get('my-room');
room.messages.subscribe((msg) => console.log(msg.text));
await room.typing.keystroke(); // built-in typing indicators
```

---

## 2. Device and Server Packages

On MAU pricing, Ably bills by monthly active users: each distinct `clientId` that connects from an end user's device counts once per month, and your own servers and AI Transport agents don't count at all. For Ably to tell them apart, every client declares which side of the connection it is on, so Pub/Sub ships as one package per side. Accounts still on resource-based pricing are billed on messages, channel minutes and connection minutes instead, but new code should use the side-declaring packages either way: it's what lets an account switch to MAU pricing. See [MAU pricing](https://ably.com/docs/pub-sub/pricing?source=using-ably) and [product guidance](https://ably.com/docs/platform/products?source=using-ably). Other platforms follow the same device/server split from these major versions: Pub/Sub JavaScript 3.0+, Python 4.0+, and Java, Go, .NET, Swift, Objective-C, Ruby, Flutter and PHP 2.0+; Chat 2.0+, AI Transport 0.11+, Spaces 0.6+, Models 0.1+. Package names vary by platform, so confirm them from the fetched docs.

**Device vs server is the first decision; HTTP vs realtime is the second.** Pick the package by **who owns the runtime** — not by which features you need (both expose the same API), and not by which side is cheaper to declare. Then pick the client kind. A repository with a frontend and a backend installs both — one package in each.

| Side | Package | Client Kind |
|------|---------|-------------|
| **Device** — code runs on an end user's device | `@ably/pubsub-device` | `createClient()` — always realtime; devices subscribe |
| **Server** — code runs on infrastructure you operate | `@ably/pubsub-server` | `createHttpClient()` for publish, token generation, history<br>`createRealtimeClient()` only when you need a persistent connection |

```javascript
// Device: browser, React Native, mobile or desktop app
import { createClient } from '@ably/pubsub-device';
const client = createClient({ authUrl: '/api/ably-auth' }); // token carries the clientId

// Server: backend services you operate
import { createHttpClient, createRealtimeClient } from '@ably/pubsub-server';
const http = createHttpClient({ key: process.env.ABLY_API_KEY });
const realtime = createRealtimeClient({ key: process.env.ABLY_API_KEY }); // only if you need a connection
```

Each factory returns the same client the old `Realtime`/`Rest` constructor did, so everything else about the client is unchanged. Type them as `PubSubClient` (device), `PubSubHttpClient` or `PubSubRealtimeClient` (server), not `Ably.RestClient`/`Ably.RealtimeClient`. Both packages re-export the full Pub/Sub API — import everything (types, plugins, React hooks) from the package for your side, never from `@ably/pubsub-core` directly.

**What each side means on an MAU-billed account:**

| | Device | Server |
|---|---|---|
| Counts toward MAU | Yes, once per `clientId` per month | No |
| `clientId` required | Yes — rejected at connect without one | No |
| Per-`clientId` concurrency limit | Yes | No |
| How the side is declared | The package alone | API key: the package alone<br>Token auth: the package **plus** a signed `x-ably-clientType: server` token claim |

**Legacy SDKs are rejected.** The old `ably` package (v2 and earlier), the bare `Realtime`/`Rest` constructors, and SDK versions older than those listed above declare no side, and on an MAU account Ably rejects their traffic outright — with or without a `clientId`, on devices and servers alike. Never generate `import Ably from 'ably'`, `new Ably.Realtime()` or `new Ably.Rest()` for new code. See the [migration guide](https://ably.com/docs/platform/pricing/resource-based/migrate?source=using-ably).

**Traffic without an SDK must declare servers itself.** Calls to the REST API directly, custom realtime clients and protocol adapters (MQTT, SSE and others) are counted as users unless they declare themselves as servers: with an API key, add `clientType=server` as a request or connection parameter; with token auth, add the `x-ably-clientType: server` claim to the token.

**A server on token auth needs the claim.** If a backend authenticates with `authUrl`/`authCallback` instead of an API key, its tokens must carry the signed `x-ably-clientType: server` claim. Without it the connection is **rejected** with error `40167` — not quietly treated as a device. Add the claim to the auth service before deploying `@ably/pubsub-server`.

**Common mistakes:**
- `@ably/pubsub-server` in browser or mobile code — claims an exemption devices aren't entitled to
- `@ably/pubsub-device` in a backend — inflates MAU and holds the service to the per-`clientId` concurrency limit
- A random `clientId` per session (a new MAU on every page load) or one shared `clientId` for all users (everyone under one concurrency limit) — issue one stable `clientId` per end user in the token

---

## 3. Use Modern SDK Patterns

Ably's JavaScript SDK uses async/await. **Never generate callback-style 1.x patterns.**

```javascript
// WRONG: Old 1.x callback pattern (removed)
channel.publish('event', { text: 'hello' }, function(err) { /* ... */ });

// RIGHT: Modern async/await pattern
channel.subscribe('event', (message) => console.log(message.data));
await channel.publish('event', { text: 'hello' });
```

**Imports and initialization — keep it simple:** create clients with the factory from the package for your side (Section 2), and import product SDKs by name (`import { ChatClient } from '@ably/chat'`). Don't invent type-based initialization. If you hit ESM/CommonJS import errors, check that your `tsconfig.json` has `"moduleResolution": "bundler"` or `"node16"`. The device package's `/modular` subpath is ESM-only (`import`, not `require`). Don't try multiple import strategies — check the [SDK README](https://github.com/ably/ably-js) for your environment.

**Server-side: Default to the HTTP client** (`createHttpClient()`). Only use `createRealtimeClient()` on the server when you need a persistent connection, such as streaming AI agent output:

```javascript
const realtime = createRealtimeClient({ key: process.env.ABLY_API_KEY }); // @ably/pubsub-server

// WRONG: Hand-rolling token streaming onto a raw channel
const channel = realtime.channels.get('conversations:123');
const { serials: [msgSerial] } = await channel.publish({ name: 'response', data: '' });
for await (const event of llmStream) {
  channel.appendMessage({ serial: msgSerial, data: event.text }); // reinvents AI Transport
}

// RIGHT: Use AI Transport — it owns the appends, cancellation, and message encoding
import { createTransport } from '@ably/ai-transport';
import { vercel } from '@ably/ai-transport/vercel'; // or /openai, /ag-ui
import { streamText, toUIMessageStream } from 'ai';
const result = streamText({ model, messages, abortSignal: req.signal });
const transport = createTransport({ client: realtime, channelName: 'conversations:123', codec: vercel });
try {
  await transport.pipe(toUIMessageStream({ stream: result.fullStream }), { signal: req.signal });
} finally {
  await transport.close(); // never closes the client you passed in
}
```

The transport doesn't keep the conversation for you: the agent hydrates it from your own store, and clients render what they receive through `transport.subscribe()`. Verify the API against the [transport reference](https://ably.com/docs/ai-transport/api/javascript/transport/transport?source=using-ably).

**AI Transport requires a channel rule.** Every namespace used with AI Transport needs the *Message annotations, updates, deletes, and appends* rule (`mutableMessages: true`) — streaming appends tokens to one message, and appends are rejected with error `93002` without it. This is the single most common AI Transport failure, and it surfaces only on the first append, so the symptom is an assistant message that is empty or holds just the first token. Enable it in the dashboard, or run `ably apps rules create "conversations" --mutable-messages`. See [channel rules](https://ably.com/docs/ai-transport/setup/channel-rules?source=using-ably).

---

## 4. Authentication

**API keys are for server-side only. Never expose them to clients.**

API keys don't expire. If leaked, attackers have indefinite access until you regenerate the key.

### Recommended: JWT Authentication

JWT is the recommended authentication method for client-side applications.

**Why JWT over Ably tokens:**
- No round-trip to Ably servers — your backend creates and signs the JWT directly
- Integrates with existing auth systems — uses standard JWT libraries you already have
- Capabilities defined per-token — not limited to what's configured on the API key
- Works everywhere — including environments without an Ably SDK (MQTT, embedded devices)

**JWT Claims:**
- `kid` (header): Your Ably API key name (e.g., `xVLyHw.abcdef`)
- `iat`: Issued-at timestamp (seconds)
- `exp`: Expiration timestamp (seconds)
- `x-ably-capability`: JSON string of channel permissions
- `x-ably-clientId`: Client identity — required for device clients on MAU-billed accounts, and for presence. Use one stable ID per end user (e.g. your user ID)
- `x-ably-clientType` (optional): Set to `"server"` only on tokens issued to your own backend services that use `@ably/pubsub-server` (see Section 2). Never on tokens issued to devices

```javascript
// Server-side: Create JWT for client
import jwt from 'jsonwebtoken';

app.post('/api/ably-auth', (req, res) => {
  const apiKey = process.env.ABLY_API_KEY; // 'appId.keyId:keySecret'
  const [keyName, keySecret] = apiKey.split(':');

  const token = jwt.sign(
    {
      'x-ably-capability': JSON.stringify({
        'room:*': ['subscribe', 'publish', 'presence'],
        [`notifications:${req.user.id}`]: ['subscribe'],
      }),
      'x-ably-clientId': req.user.id,
    },
    keySecret,
    { expiresIn: '1h', keyid: keyName }
  );

  res.json(token);
});

// Device: Use JWT with Ably
import { createClient } from '@ably/pubsub-device';
const client = createClient({ authUrl: '/api/ably-auth', authMethod: 'POST' });
```

### Alternative: Ably Token Requests

JWT is recommended for most use cases, but Ably tokens may be preferred when your capability list is too large for JWT size limits (JWTs must fit within HTTP headers, ~8KB), or when you need to keep capabilities confidential since JWTs can be decoded by clients. The trade-off is that Ably token integration is more involved and doesn't support all JWT functionality like channel-scoped claims and per-connection rate limits.

```javascript
// Ably's native token system (requires round-trip to Ably servers from backend)
app.post('/api/ably-token', (req, res) => {
  const http = createHttpClient({ key: process.env.ABLY_API_KEY }); // @ably/pubsub-server
  http.auth.createTokenRequest({
    clientId: req.user.id,
    capability: { 'room:*': ['subscribe', 'publish'] },
  }).then(tokenRequest => res.json(tokenRequest));
});
```

### Rules
- Server-side: API key is fine (`{ key: 'appId.keyId:keySecret' }`) — with a key, `@ably/pubsub-server` declares the server side on its own
- Server-side on token auth: the token must carry `x-ably-clientType: server`, or the connection is rejected with `40167`
- Client-side: Always use `authUrl` or `authCallback` — never embed the API key or pass a static `token` directly (it won't auto-refresh on expiry)
- Always issue device tokens with a `clientId` — on MAU-billed accounts a device connection without one is rejected, and presence requires one anyway
- Use capabilities to restrict what channels and operations each client can access

---

## 5. Channel Design

Channels separate messages into topics. Get the naming right early — it's hard to change later.

**Rules:**
- Use `:` as a hierarchy separator: `chat:room-123`, `orders:user-456`
- Channel names are case-sensitive
- Don't create one channel per message — channels are long-lived topics
- Use [rules](https://ably.com/docs/channels#rules?source=using-ably) in the dashboard to apply settings (e.g., persistence, push notifications) to groups of channels

**Common patterns:**
```
chat:room-{roomId}           # Chat rooms
notifications:user-{userId}  # Per-user notifications
cursors:doc-{docId}          # Collaborative editing
events:{eventType}           # Event streaming
conversations:{conversationId}  # AI Transport conversations
```

Rules and capabilities match the namespace literally up to the first colon, so `conversation` (singular) does not match `conversations:*`. Pick one spelling and use it in the channel name, the channel rule, and the token capability.

---

## 6. Connection Management

The Realtime SDK manages reconnection automatically. Don't fight it.

**Rules:**
- Don't manually reconnect — the SDK handles transient failures with exponential backoff
- Listen to connection state changes to update UI:

```javascript
realtime.connection.on('connected', () => { /* online */ });
realtime.connection.on('disconnected', () => { /* temporarily offline */ });
realtime.connection.on('suspended', () => { /* offline for extended period */ });
```

- Call `realtime.close()` when done (component unmount, page unload, etc.)
- Messages published while disconnected are received on reconnection (within the 2-minute recovery window)
- For raw Pub/Sub, use channel `rewind` to give returning clients recent messages on attach:

```javascript
const channel = realtime.channels.get('updates:123', {
  params: { rewind: '2m' }  // Replay last 2 minutes on attach
});
```

- For AI Transport, don't reach for `rewind` — pass `history: { replay: fromSerial(storedSerial) }` (or `untilEvent(...)`) to `transport.subscribe()`. It buffers live messages while it pages back, then delivers history and the live stream in channel order with no gap and no duplicates. See [history](https://ably.com/docs/ai-transport/streaming/history?source=using-ably)

---

## 7. Presence

Presence tracks which clients are on a channel. Use it for "who's online" features.

**Rules:**
- Set `clientId` during auth — it's required for presence (and for every device client on MAU-billed accounts)
- Call `channel.presence.enter()` to join, `channel.presence.update()` to update data, `channel.presence.leave()` to depart
- Use `channel.presence.get()` for current members, `channel.presence.subscribe()` for changes
- If a client disconnects ungracefully, Ably removes them after ~15 seconds (not instantly)
- Don't use presence for high-frequency data (cursor positions, typing coordinates) — use channels instead. Presence is for low-frequency state (online/offline, user status)
- For Chat: use `room.presence` instead of raw channel presence
- For Spaces: use `space.enter()` / `useMembers()` hook. Spaces has dedicated `cursors` API for cursor positions

---

## 8. Chat SDK: Critical Lifecycle

If using `@ably/chat`, these are the most common mistakes:

**Always subscribe before calling `attach()`.** Attaching without subscribing first causes silent message loss — the worst kind of bug.

```javascript
const room = await chat.rooms.get('my-room');

// WRONG: Attach without subscribing first — messages silently lost
await room.attach();
room.messages.subscribe((msg) => console.log(msg.text)); // may miss messages during attach

// RIGHT: Subscribe first, then attach
room.messages.subscribe((msg) => console.log(msg.text));
await room.attach();
```

**Use the actual API.** The Chat SDK does NOT have: threading, read receipts, file attachments, or `room.messages.broadcast()`. Use `room.messages.send()` to send messages.

**Don't mix Chat and Pub/Sub patterns.** If you're using `@ably/chat`, use `room.messages`, `room.typing`, `room.reactions` — not raw `channel.subscribe()` / `channel.publish()`.

**Built-in behavior you don't need to reimplement:**
- Typing indicator frequency control is handled by the SDK automatically
- Room reactions delivery is handled by the SDK
- Message ordering and history pagination are built-in

---

## 9. React Integration

Ably provides React hooks for each product. React runs on devices, so the Pub/Sub hooks come from the device package:

| Product | Package | Key Hooks |
|---------|---------|-----------|
| Pub/Sub | `@ably/pubsub-device/react` | `PubSubClientProvider`, `usePubSubClient`, `useChannel`, `usePresence`, `useConnectionStateListener` |
| AI Transport | `@ably/ai-transport/react` | `useTransport`, `useDeliveries`, `useHistory`, `useTransportStatus` |
| Chat | `@ably/chat/react` | `useMessages`, `useTyping`, `usePresence`, `useRoomReactions` |
| Spaces | `@ably/spaces/react` | `useMembers`, `useCursors`, `useLocations`, `useLocks` |

**Critical rule: Don't create a new Ably client on every render.** This creates a new WebSocket connection each time — a memory leak.

```javascript
// WRONG: Creates new connection every render — memory leak
function Chat() {
  const ably = createClient({ authUrl: '/api/ably-auth' });
  // ...
}

// RIGHT: Create client once, pass via provider
const ably = createClient({ authUrl: '/api/ably-auth' });

function App() {
  return (
    <PubSubClientProvider client={ably}>
      <ChannelProvider channelName="chat:room-1">
        <Chat />
      </ChannelProvider>
    </PubSubClientProvider>
  );
}
```

Also fine: create the client in a `useEffect` with an empty dependency array, hold it in state, and return `() => ably.close()` as the cleanup.

---

## 10. Spaces and LiveObjects: Built-in Behavior

When using **Spaces** (`@ably/spaces`):
- Cursor position batching is built-in — don't implement custom throttling
- Member location tracking is built-in via `space.locations`
- Component locking handles contention automatically via `space.locks`

When using **LiveObjects**:
- Available data structures are Maps and Counters only (no custom object types)
- Conflict resolution is built-in — don't implement your own
- State recovery after reconnection is automatic
- Prefer the path-based API over the instance API for simplicity

---

## 11. LiveSync: Database-to-Frontend

LiveSync connects your database to frontends: Database → ADBC Connector → Ably Channels → Models SDK → Frontend.

**Key constraints:** PostgreSQL requires logical replication (14+, WAL level change needs restart). MongoDB requires a replica set (no standalone). The Database Connector handles channel mapping automatically once you configure an ingress rule.

**Always fetch current LiveSync docs** from [ably.com/docs/livesync](https://ably.com/docs/livesync?source=using-ably) — database permissions and connector configuration change across versions.

---

## 12. Production Checklist

Before going to production, verify:

- [ ] **Side-declaring packages** — device code uses `@ably/pubsub-device`, backend code uses `@ably/pubsub-server`. No legacy `ably` package or bare constructors — on MAU-billed accounts their traffic is rejected outright
- [ ] **Every device client has a `clientId`** — issued in the token by your auth server, one stable ID per end user. Random IDs inflate your MAU count; a shared ID puts every user under one per-`clientId` concurrency limit
- [ ] **Server tokens carry `x-ably-clientType: server`** — only if your backend uses token auth instead of an API key; add the claim before deploying `@ably/pubsub-server` or its connections are rejected (`40167`)
- [ ] **No API keys in client code** — use JWT or token auth via `authUrl`/`authCallback`
- [ ] **Capabilities are scoped** — don't grant `{"*":["*"]}` to clients; restrict to specific channels and operations
- [ ] **Connection cleanup** — call `realtime.close()` on unmount/unload to avoid connection leaks
- [ ] **Error handling** — listen to `connection.on('failed')` and handle auth failures gracefully
- [ ] **Channel detach** — detach from channels you no longer need (`channel.detach()`)
- [ ] **Message size** — messages are limited to 64KB by default; if you're hitting this, split payloads or reconsider message design
- [ ] **Idempotent publishing** — set unique message IDs when exactly-once delivery matters
- [ ] **`echoMessages: false`** — set this if publishers don't need to receive their own messages (saves bandwidth and cost)
- [ ] **Rate limits** — Ably enforces rate limits (e.g., 50 messages/second per channel, 200 channels per connection). If you're hitting them, check your publish frequency and channel fan-out. Read the [limits documentation](https://ably.com/docs/general/limits?source=using-ably)

### Error Handling

Ably error codes can be broad (e.g., 40000, 50000) — always read the error **message text**, not just the code. Every error code has a help page at `https://help.ably.io/error/{code}`. For MAU rejections, check the client's side first: a device connection refused for a missing `clientId`, or `40167` for a server on token auth without the `x-ably-clientType: server` claim.

---

## 13. Quick Reference

**Product docs:** [Pub/Sub](https://ably.com/docs/pubsub?source=using-ably) | [Chat](https://ably.com/docs/chat?source=using-ably) | [Spaces](https://ably.com/docs/spaces?source=using-ably) | [LiveObjects](https://ably.com/docs/liveobjects?source=using-ably) | [LiveSync](https://ably.com/docs/livesync?source=using-ably) | [AI Transport](https://ably.com/docs/ai-transport?source=using-ably)

**Platform SDKs:** JavaScript, React, Python, Ruby, Java, Kotlin, Swift, .NET, Go, PHP, Flutter — [ably.com/docs/sdks](https://ably.com/docs/sdks?source=using-ably)

**Ably CLI:** Install with `npm install -g @ably/cli` to publish test messages, subscribe to channels, and verify setup. Run `ably --help` to discover commands.

For API references, start at [ably.com/docs](https://ably.com/docs?source=using-ably).
