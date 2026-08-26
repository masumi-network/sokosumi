# Ably Presence for chat Online/AFK/Offline

Chat roster dots mean **reachable** (live client connection), not auth-session freshness. We drive human Presence via **Ably Presence** on per-org channels, not `Session.updatedAt` idle windows.

**Why not session-idle:** Better Auth session rows rarely update while the user is active (cookie cache, no activity heartbeats). Classifying `now - session.updatedAt` made teammates look **offline** despite being in the app. Idle grace alone cannot fix a dead signal.

**Why not Core HTTP heartbeat as source of truth:** Extra store, fan-out, and auth surface. We already use Ably for chat realtime; client enter/update/leave matches industry connection-presence. Active clients refresh `lastActiveAt` on a ~4 min throttle (inside the 5 min Online window); unchanged idle presence does not publish. Teammates reclassify Online → AFK locally every 30s from the last `lastActiveAt`; they do not wait for another Ably message.

**Shape (product + wire):**
- **Online** = connected + recent activity; **AFK** = connected but idle (~5m) or tab hidden; **Offline** = no live connection (disconnect grace later, ~30–60s).
- Visibility: **same organization only**. Enter presence only on the **active organization**; other orgs see Offline. Leave the previous org on workspace switch. No human presence dots in personal workspace. Coworkers stay always-online for v1.
- Channel: `presence:org_{orgId}`. Token still grants **`presence` + `subscribe`** on every membership org so workspace switch does not wait on re-auth; the client enters only the active org. Enter/update/leave needs `presence`; `presence.get` + presence events need `subscribe`. Multi-device: `clientId = userId:instanceId`, aggregate any member with that userId.
- App shell owns the Ably connection for always-on presence; room message channel subs stay chat-scoped.
- UI: `presence.get()` for first paint + live presence events; **do not** use `Session.updatedAt` for green dots. Last seen (members table) stays a separate concept.

**Rejected:** session-touch hacks; room-scoped “in channel” as Online; chat-page-only connection (breaks app-shell presence — you would look Offline off the chat page); pure offline/online without AFK for v1 product labels (hybrid kept).
