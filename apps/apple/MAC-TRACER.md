# Mac tracer spec

Native macOS Sokosumi chat in `apps/apple`. Product intent: [`VISION.md`](./VISION.md). Stack: [ADR 0027](../../docs/adr/0027-apple-native-clients.md).

## Problem Statement

A Mac user who wants Sokosumi chat as a real Mac app (dock icon, native windows, menus, system text) only has the browser or a webview. There is no Apple client. iOS will need the same session, rooms, and Ably client later; starting in a macos-only tree would force a second Swift stack.

## Solution

Ship a macOS Sokosumi app that signs the user in, picks a workspace, lists membership-visible rooms, opens one room, paginates history, sends a classic message, and shows live creates/updates from Ably. Shared Swift packages under `apps/apple/Packages/` own that behavior so an iOS target can link them later. First package is `CoreAPI` (generated Core HTTP via Swift OpenAPI Generator). Not a single Kit. The Mac UI is Mac-specific SwiftUI (AppKit text where the composer needs it). Windows and Linux stay on web. Android is not this tree.

## User Stories

1. As a Sokosumi member, I want a Sokosumi icon in the Dock, so that chat is an app rather than a browser tab.
2. As a signed-out Mac user, I want to sign in with my existing Sokosumi account in the system browser, so that I do not type my password into a custom webview.
3. As a signed-in Mac user, I want the app to keep me signed in across launches, so that I do not OAuth every morning.
4. As a signed-in Mac user, I want Sign out in the menu, so that a shared Mac can drop my session.
5. As a user whose access token expired, I want the app to refresh it without a prompt, so that chat does not dump me to login mid-room.
6. As a user whose refresh token is revoked, I want to land on sign-in, so that a dead token is not an infinite spinner.
7. As a user with no first workspace (`identity-onboarding` or `pending-invites`), I want a clear “finish setup on the web” screen and a way to sign out, so that the Mac tracer does not invent native identity onboarding.
8. As a user with a personal workspace and no organization, I want to enter chat in that personal workspace, so that Directs still work without an org header.
9. As a user with organization workspaces, I want to see those organizations and switch among them, so that I am in the same workspace I would be on web.
10. As a user with a personal workspace and organizations, I want to switch back to personal, so that I can reach personal Directs.
11. As a user switching workspace, I want the room list to reload for that workspace, so that I do not see another org’s channels.
12. As an unseated organization member, I want to use chat anyway, so that Seat rules match web (chat is allowed without an assigned Seat).
13. As a member, I want a sidebar of membership-visible active rooms (channels and Directs), so that I can pick where to talk.
14. As a member, I want room rows to show the room name and whether the room is a channel or a Direct, so that I can tell them apart.
15. As a member, I want unread rooms visually distinct using Core’s `unreadCount` (and mention count if present), so that I know where I have not caught up.
16. As a member, I want to open a room and see paginated history, newest at the bottom, so that I can read what already happened.
17. As a member, I want older pages when I scroll up, so that I can go back through the transcript.
18. As a member, I want an empty room to show an empty transcript, not an error, so that a new Direct is usable.
19. As a member, I want a failed history load to leave unread chrome alone, so that we do not mark the room read when nothing rendered (ADR 0026).
20. As a member whose history has resolved on screen, I want the room marked read, so that unread chrome matches web (ADR 0026).
21. As a member, I want leftover thread unread to still bold the room after mark-read if Core says so (ADR 0013), so that we do not fake a fully-read room.
22. As a member, I want to type a plain-text message in a native composer and send it, so that I can talk without the browser.
23. As a sender, I want my message to appear immediately as pending, then confirmed or failed, so that slow Core does not hide my words (ADR 0004).
24. As a sender of a failed message, I want Retry and Remove, so that I can recover without retyping into a ghost row (ADR 0004).
25. As a sender, I want at most one in-flight classic send per composer, so that order matches web’s single-flight queue (ADR 0004).
26. As a teammate on web, I want to see the Mac user’s confirmed message in the same room, so that the tracer is the real product transcript.
27. As a Mac user, I want a message a teammate sends on web to appear in the open room without refresh, so that Ably is actually wired.
28. As a Mac user, I want an Ably full message DTO to merge into the transcript, so that small messages are snappy (ADR 0014).
29. As a Mac user, I want an Ably id envelope on the focused room to refetch history, so that oversize messages are not treated as fake rows (ADR 0014).
30. As a Mac user, I want create/update/delete events for the open room applied, so that edits and deletes are not stuck until relaunch.
31. As a Mac user, I want my own confirmed send and the Ably create to be one row (client turn id), so that I do not see a duplicate bubble (ADR 0004).
32. As a Mac user kicked from a room, I want that room to leave the sidebar when chat-control says so, so that I do not keep posting into a revoked membership.
33. As a Mac user, I want a workspace-scoped Ably token that refreshes after join/leave, so that capabilities match membership.
34. As a Mac user, I want a stable per-install Ably `clientInstanceId`, so that this Mac is one device in `{userId}:{instanceId}` (ADR 0003).
35. As a Mac user, I want to see another person’s message body as text, so that the tracer is readable (markdown rendering polish can wait).
36. As a Mac user, I want the main window to use a sidebar plus transcript plus composer, so that the layout is a Mac chat window, not an iPhone stack.
37. As a future iOS engineer, I want Swift packages free of AppKit/SwiftUI, so that iOS can link the same modules without taking Mac chrome.
38. As a Core owner, I want the Mac app to call existing `/v1` routes only, so that this tracer does not grow a parallel API.
39. As an operator, I want the app pointed at a Core base URL (dev vs production), so that local portless Core works.
40. As a user on a Mac with no network, I want sign-in and room load to fail visibly, so that I am not staring at a blank window.

## Implementation Decisions

- **Home:** `apps/apple`. Xcode project/product name Sokosumi. Shared code is Swift packages under `Packages/` (first: `CoreAPI`). macOS app target Sokosumi stays a thin SwiftUI app. No iOS target in this tracer; packages must stay UI-free so iOS can link later. No `package.json`. Outside turbo and Biome.
- **Seam for SOK-971:** `CoreAPI` — official [swift-openapi-generator](https://github.com/apple/swift-openapi-generator) SPM plugin, generated `Client`, no AppKit/SwiftUI. Later tickets add packages (auth, chat) instead of growing a Kit.
- **Talk to Core only.** Bearer `Authorization` with a Sokosumi OAuth access token (`sokosumi:api`). Organization workspace: `X-Organization-Slug`. Personal workspace: omit that header. No Prisma, no cookies copied from Safari.
- **Auth:** First-party **public** OAuth client (PKCE, no client secret) against Core’s existing Better Auth oauth provider. Scopes: `openid`, `sokosumi:api`, `offline_access`. Redirect URI: `com.sokosumi.app:/auth` (RFC 8252 private-use form: one slash, no host. URL scheme `com.sokosumi.app`; `ASWebAuthenticationSession` callback scheme is `com.sokosumi.app`). Do not register `com.sokosumi.app://auth` — Better Auth rejects the double slash. System browser. Tokens in Keychain. Refresh without UI; revoked refresh → sign-in. Register the client with the existing OAuth client machinery (developer/admin), not a new Core route. Do not use coworker API keys or Better Auth user API keys as the human session.
- **Workspace gate:** `GET /v1/users/me/workspace-access`. Only `ready` continues into chat. Other gates: blocked screen + open web / sign out. No native identity onboarding, invite accept, or create-organization wizard.
- **Workspace switch:** `GET /v1/users/me`, `GET /v1/users/me/organizations`, `PUT /v1/users/me/preferred-organization` (null organization id = personal). Then reload rooms with the matching slug header.
- **Rooms:** `GET /v1/chats/rooms` with `status=active`, paginate until complete (same idea as web’s membership-visible walk). Show channels and Directs. No create-room, archive, star, mute, discoverable browse, or guest-invite flows in this tracer.
- **Transcript:** `GET /v1/chats/rooms/{id}/messages` with cursor pagination. No `q`, no `around` unless needed to land on latest. Render `content` as plain text (or a minimal markdown subset if the generator already yields it). No unfurl cards, reactions, pins, files, mention chips, or coworker/Soko Bot stream UI.
- **Send:** `POST /v1/chats/rooms/{id}/messages` with `content` only (no mention id arrays required for the tracer). Pending shell + client turn id + single-flight per room composer (ADR 0004). No durable outbox.
- **Mark read:** `POST /v1/chats/rooms/{id}/read` when that room’s history has resolved on screen (ADR 0026). Unread chrome from list DTO `unreadCount` / `unreadMentionCount`. Do not Look threads; do not POST thread read.
- **Ably:** `POST /v1/realtime/ably-token?clientInstanceId=` then `ably-cocoa` Realtime. Subscribe to the open room channel (`chat_rooms:room_{id}`) and the user chat-control channel. Apply `chat_room_message` create/update/delete: full DTO merge, or id envelope → refetch focused room (ADR 0014). Remint the token when membership changes. Persist `clientInstanceId` per install. Do not enter org presence (ADR 0003) in this tracer. Do not activate push (ADR 0022 / 0023).
- **HTTP client:** Generate Swift types/operations from Core’s OpenAPI snapshot (the same spec web generates from) with Swift OpenAPI Generator. Do not hand-copy TypeScript DTOs. The Mac app may call `CoreAPI.Client` for this tracer.
- **Tracer slice:** `Packages/CoreAPI/Sources/CoreAPI/openapi.json` carries only the operations the tracer needs, extracted from the generated `apps/web/openapi-core.snapshot.json` (regenerate that first via the Core `write-openapi-snapshot-for-web` script) plus the transitively referenced schemas. Write the slice with literal UTF-8 (`ensure_ascii=False`): the snapshot’s non-BMP escapes (e.g. the 👍 reaction example as `\ud83d\udc4d`) are rejected by the generator’s YAML parser.
- **Core base URL:** build-time or runtime setting for local Core vs production. Local must work against this checkout’s Core (portless named HTTPS URL).
- **Mac UI:** One main window: sidebar (workspace + rooms) | transcript + composer. Native text input. Standard Mac menu with Sign out. Not Catalyst, not `#if os` iPhone layout.
- **Interop:** A message confirmed on Mac must appear on web in that room, and the reverse, using the same Core rows and Ably events.

## Testing Decisions

- **Seam:** Swift packages (start with `CoreAPI`). Fake Core HTTP at the OpenAPI `ClientTransport` boundary. Do not test SwiftUI layout, Keychain, or `ASWebAuthenticationSession` as the required suite.
- **Good tests** assert package behavior: given these Core payloads, the generated client (and later chat packages) look like this.
- **Must cover (971):** no token → GET `/users/me` is unauthorized. Later tickets add org slug, rooms, send, Ably.
- **Do not test in this tracer:** Core route behavior (already covered in Core), web UI, presence roster, push, coworker stream.
- **Prior art:** Core chat-room list/message/read tests and web `chat-room.service` / Ably merge tests. Apple tests live in the Swift packages (`swift test`), not turbo.
- **Manual proof (971):** Mac window against local Core with no token shows 401 on screen.

## Out of Scope

- iOS target, Android, Windows/Linux native, KMP, CMP, Electron, Tauri, Catalyst.
- Identity onboarding, org create, invite accept, email verification.
- Coworker stream, Soko Bot turns, file uploads, unfurls, mention pickers, reactions, pins, threads UI, presence dots, OS banners / APNs, start-at-login, auto-update, Mac App Store, Sparkle.
- Creating or archiving rooms, starring, muting, discoverable channel browse, guest invite links.
- Replacing `apps/web` or changing Core chat/Ably contracts. Closed-app push remains ADR 0023 until a later Apple slice.
- turbo/Biome/pnpm scripts for Xcode.

## Further Notes

- Glossary: room, Direct, Channel, Job vs Task, Coworker vs Agent vs Soko Bot — [`CONTEXT.md`](../../CONTEXT.md). This tracer is rooms (channels and Directs), not Tasks or Jobs.
- First-party OAuth client registration is a human/operator step (redirect URI, PKCE public client, `sokosumi:api` + `offline_access`). Without it, sign-in cannot start.
- Agents in this monorepo are TypeScript-strong; Xcode implementation is expected to be human-led with Kit tests as the agent-checkable seam.
