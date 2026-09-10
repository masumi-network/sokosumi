# ADR 0028: Native Apple clients in `apps/apple`

- Status: Accepted
- Date: 2026-09-07

Sokosumi’s first native client is an Apple Xcode workspace at `apps/apple`: shared Swift modules plus a **macOS** app now and an **iOS** app later in the same codebase. Both product targets are named Sokosumi. They talk to Core over HTTP and to Ably via `ably-cocoa`. They do not use Kotlin Multiplatform, Compose Multiplatform, Electron, Tauri, or Mac Catalyst. Windows and Linux stay `apps/web`. Android, if it happens, is a separate Kotlin app, not this tree.

**Why:** Chat on a real Mac (windows, menus, SwiftUI/AppKit text) is the tracer. iOS must join without a second Swift stack, so the directory and modules are Apple-wide, not `apps/macos`. Sharing UI with Compose or a webview would not be native; sharing logic with Kotlin would add a language Apple does not need. Web already owns Win/Linux and push rendering (ADR 0023); native APNs is a later reopen of that ADR, not part of the Mac chat tracer.

## Considered options

- **Kotlin Multiplatform + Compose Multiplatform** (one UI everywhere, SwiftUI as an escape hatch) — rejected. Compose Desktop is JVM/Skia, not AppKit; mixing Compose and SwiftUI on the composer is the worst chat surface; Ably has no KMP SDK (`ably-java` vs `ably-cocoa`).
- **KMP logic-only under SwiftUI + Android Compose** — rejected for Apple. Android is not in this codebase; a Swift package is the native share layer for iOS and Mac.
- **Electron or Tauri shell around `apps/web`** — right for a three-desktop window; not “as native as possible” on Mac. Win/Linux keep this path by staying on web.
- **`apps/macos` now, iOS later in another tree** — rejected. The user wants one Apple codebase; a macos-only name would lie the day the iOS target appears.

## Consequences

- No `package.json` under `apps/apple` until a spec needs one. `pnpm-workspace.yaml` is `apps/*`; an empty npm package would join turbo by accident (same rule as `apps/cli`).
- Xcode is outside turbo/Biome. Generate Swift clients from Core `openapi.json`; do not import `@sokosumi/database` or Prisma.
- Mac v1 is sign-in, workspace, room list, one room transcript, composer, history pagination, live Ably, unread on opened rooms. Coworker stream, Soko Bot, files, mentions polish, and OS push wait.
- ADR 0023 still holds for web. A Mac/iOS `UserNotifications` / APNs renderer is a new decision when that slice starts.
- Product intent: [`apps/apple/VISION.md`](../../apps/apple/VISION.md).
