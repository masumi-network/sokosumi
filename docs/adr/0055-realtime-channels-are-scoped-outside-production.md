# ADR 0055: Realtime channels are scoped outside production

- Status: Accepted
- Date: 2026-10-14

**Every Ably channel name carries the deployment's environment unless the deployment is production.** Production keeps today's names byte for byte. Previews and local development insert a scope part after the first segment:

| Deployment                           | Room channel                                                     |
| ------------------------------------ | ---------------------------------------------------------------- |
| Production (`VERCEL_ENV=production`) | `chat_rooms:room_{roomId}`                                       |
| Preview                              | `chat_rooms:preview:{network}:branch_{encodedRef}:room_{roomId}` |
| Anything else (local, unknown)       | `chat_rooms:development:{network}:room_{roomId}`                 |

`{network}` is `mainnet` or `preprod`. `{encodedRef}` is the exact Git ref, URL-encoded, as the user notification channel already does it.

## Why

On 2026-10-14 a reaction on the Mac failed with "Core rejected the request (404): Message not found". The message had been posted on a mainnet preview Core (`fix/soko-bot-inbox-paging`), not on production. Preview databases are Neon forks of mainnet, so room ids are identical. Preview Core publishes with the same Ably keys as production, and `makeChatRoomChannelName` builds the name from the room id alone. Production clients received the preview message live on `chat_rooms:room_{id}`, showed it in #Everyone, and every action on it went to production Core, which had never stored it.

Room messages are only the visible case. Typing, chat control (membership revoke, rooms changed), tasks, calendar, org presence and agent jobs channels are named the same way, so a preview can reach production clients on all of them. Only user notification channels are scoped today.

## Decision

1. **One scope rule in `packages/utils`.** `RealtimeChannelEnvironment` (renamed from `NotificationChannelEnvironment`, same fields: network, Vercel env, Git ref) decides the scope. Every channel builder takes it: rooms, typing, chat control, tasks, calendar (workspace and control), org presence, agent jobs and notifications, plus the token's agent-jobs wildcard grant (`agent_jobs:*:user_{id}` in production). Both parsers (room id and organization id from a channel name) accept the scoped form.
2. **Fail closed.** Only `vercelEnv === "production"` yields the unscoped name. A missing or unknown environment is scoped as development. A preview without a Git ref throws instead of falling back to the production name.
3. **The first segment stays first.** Ably applies channel rules by namespace (the part before the first colon), so scoped names get the same rules without dashboard changes. Key permissions only cover scoped names when they are granted per namespace (`presence:*`, `chat_typing:*`). A narrower grant such as `presence:org_*` does not match `presence:preview:…:org_{id}`, and Ably silently drops a token capability the signing key lacks (ADR 0033). **Deployment prerequisite:** in every Ably app, the keys behind `ABLY_PUBLISH_ONLY_KEY` and `ABLY_SUBSCRIBE_ONLY_KEY` grant whole namespaces. Verify on a preview with the issued token's capability, not the TokenRequest Core signs.
4. **Notifications follow the same rule.** The preview format they ship today stays. Local development moves from `notifications:all:user_{id}` to the development scope.
5. **One source per runtime.** Core reads the environment once, in `getRealtimeChannelEnvironment()` (renamed from `getNotificationChannelEnvironment()`), for publishing, token capabilities and channel occupancy. Web reads it from `NEXT_PUBLIC_NETWORK`, `NEXT_PUBLIC_VERCEL_ENV` and `NEXT_PUBLIC_VERCEL_GIT_COMMIT_REF` in one helper that the realtime hooks use.
6. **Apple reads channel names from the token.** Room and chat control channels come from the granted capability, the way `userNotificationsChannelName(grantedSubscribeIn:)` already works; the presence and typing parsers accept scoped names. Production builds behave exactly as before, and a debug build pointed at a preview or local Core keeps realtime.

## Alternatives rejected

- **A separate Ably app for previews**, set through Vercel environment variables. No code, but rejected on 2026-10-14.
- **Previews never publish.** One guard in Core's Ably client, but realtime stops working on previews, so realtime changes cannot be tested before production.
- **Clients filter events by an environment field.** Preview content would still travel to production devices, and every client, including shipped native binaries, would need the filter.

## Consequences

- Production names do not change, so installed Mac and iOS apps need no update and nothing ships in lockstep.
- utils, Core and Web land in one PR: a preview's Core and Web are built from the same branch and must agree on names. Apple lands separately.
- Production Core must have `VERCEL_ENV=production` and production Web `NEXT_PUBLIC_VERCEL_ENV=production`. Before this change a missing value meant production names; after it, it means scoped names and silent realtime. Check both before merging.
- Scoped names are longer, so preview tokens carry a larger capability. Production tokens are unchanged, and TokenRequest auth has no documented size limit (ADR 0033).

## Proof

- utils tests: a table of every builder's production name, unchanged; preview and development names scoped; unknown environment scoped; preview without a ref throws; parsers round-trip both forms.
- Core tests with mocked Prisma: a preview token grants only scoped channels, a production token is unchanged, a preview publish goes to the scoped room channel.
- Web test: the helper builds the environment from the public env.
- Apple tests: room, control, presence and typing names parse from production and scoped capabilities.
- On the PR preview: post in #Everyone and confirm the production Mac does not show it; the preview's `/api/ably/auth` grants only scoped names, production's grants the same names as today.
