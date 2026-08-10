# Ably Presence for chat Online/AFK/Offline

Chat roster dots mean **reachable** (live client connection), not auth-session freshness. We drive human Presence via **Ably Presence** on per-org channels, not `Session.updatedAt` idle windows.

**Why not session-idle:** Better Auth session rows rarely update while the user is active (cookie cache, no activity heartbeats). Classifying `now - session.updatedAt` made teammates look **offline** despite being in the app. Idle grace alone cannot fix a dead signal.

**Why not Core HTTP heartbeat as source of truth:** Extra store, fan-out, and auth surface. We already use Ably for chat realtime; client enter/update/leave matches industry connection-presence and ~30s freshness.

**Shape (product + wire):**
- **Online** = connected + recent activity; **AFK** = connected but idle (~5m) or tab hidden; **Offline** = no live connection (disconnect grace later, ~30–60s).
- Visibility: **same organization only**. Enter presence on **every org** the user belongs to. No human presence dots in personal workspace. Coworkers stay always-online for v1.
- Channel: `presence:org_{orgId}`. Token grants **`presence`** on those channels only (least privilege). Multi-device: `clientId = userId:instanceId`, aggregate any member with that userId.
- App shell owns the Ably connection for always-on presence; room message channel subs stay chat-scoped.
- UI: `presence.get()` for first paint + live presence events; **do not** use `Session.updatedAt` for green dots. Last seen (members table) stays a separate concept.

**Rejected:** session-touch hacks; room-scoped “in channel” as Online; chat-page-only connection (breaks app-global reachable); pure offline/online without AFK for v1 product labels (hybrid kept).
