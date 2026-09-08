# Apple clients (macOS + iOS)

Native Sokosumi on Apple. One Xcode project, two app targets later, shared Swift packages. The first ship is **macOS chat**. **iOS** is the same codebase, later — not a second repo and not `apps/ios`.

This file is product intent. It is not a spec and not an Xcode layout. The Mac tracer spec is [`MAC-TRACER.md`](./MAC-TRACER.md).

## Name

| Thing | Name | Why |
| --- | --- | --- |
| Directory | `apps/apple` | Fits macOS and iOS. Not `macos`, not `ios`. |
| Xcode project | `Sokosumi` | Same product on the dock and the home screen. |
| Shared Swift packages | `apps/apple/Packages/` | One package per job. First: `CoreAPI` (generated Core HTTP). Not a single Kit. Not `Network` (clashes with Apple’s Network.framework). |
| macOS target | `Sokosumi` | Ships first. |
| iOS target | `Sokosumi` | Same product name; added when the Mac tracer is real. |

Do not put this app under `apps/macos`. iOS would then look like a guest.

## Who

End users of Sokosumi chat on a Mac, later iPhone/iPad. Not Coworker developers (that is `apps/cli`). Terms match [`CONTEXT.md`](../../CONTEXT.md).

## Why it exists

`apps/web` is the product on every OS that has a browser, including Windows and Linux. A Mac user who wants a native window, menus, and text system does not get that from a webview or from Compose/Skia.

iOS will want the same session, rooms, and Ably client. Those live in Swift packages the Mac app already uses. Each OS still gets its own UI (Mac windows/menus; iOS navigation/keyboard). One SwiftUI tree with `#if os` is not the plan.

## Mac loop (first)

Make these cheap:

**Sign in.** System-browser OAuth / Better Auth tokens in Keychain. Not web session cookies copied out of Safari.

**Workspace.** Active personal or organization workspace, same rules as web.

**Chat tracer.** Room list, open one room, paginated history, composer, live Ably creates/updates (full DTO or id envelope per ADR 0014), unread on rooms the user opened.

Exact screens are not decided here.

## iOS loop (same workspace, later)

The iOS target links the same packages and ships its own SwiftUI. It does not fork the Mac UI. Composer, keyboard, and APNs are iOS work. They wait until Mac chat round-trips against Core.

## Constraints

- Lives in this repo at `apps/apple`. Not a separate product git remote unless release/signing later forces one.
- Talks to Core only. No Prisma, no `@sokosumi/database`, no Postgres from the app.
- Ably via `ably-cocoa`. Presence and channel names follow the existing ADRs; do not invent a second realtime protocol.
- Generate the HTTP client from Core `openapi.json` (same spec web uses). Do not hand-copy DTOs from TypeScript.
- No `package.json` until a spec says the Apple tree needs Node. `pnpm-workspace.yaml` matches `apps/*`.
- Xcode is outside turbo and Biome.
- Android is not this directory. A later native Android app is Kotlin + Jetpack Compose in its own tree (`apps/android` or elsewhere).

## Out of this vision

- Windows or Linux native apps. Those stay `apps/web`.
- Kotlin Multiplatform, Compose Multiplatform, Electron, Tauri, Mac Catalyst.
- Replacing Core or `apps/web`.
- Coworker stream, Soko Bot, file-heavy chat, mention polish, and OS banners in the Mac tracer. Web keeps them until a later Apple slice. Closed-app push reopens ADR 0022 / 0023; it is not implied by putting a window on the dock.
