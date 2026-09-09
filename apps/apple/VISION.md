# Apple clients (macOS + iOS)

Native Sokosumi on Apple. One Xcode project, two app targets later, shared Swift packages. The first ship is **macOS chat**. **iOS** is the same codebase, later — not a second repo and not `apps/ios`.

This file preserves product intent and the ongoing goal. [`PARITY.md`](./PARITY.md) is the authoritative capability boundary, dependency order, iteration workflow, and verification/handoff record. Full chat parity supersedes the original tracer scope; the earlier plan remains in Git history.

## Ongoing goal

Build `apps/apple` as an Apple-native SwiftUI client for the chat experience in `apps/web`: conversation lists, room timelines and reply threads, composing/sending, streaming responses, message rendering, attachments, and the sign-in/session/minimal account settings required to use chat. Include the capabilities explicitly listed in `PARITY.md`. Billing, admin, marketing, and unrelated onboarding or product screens remain excluded unless explicitly added there.

Target macOS 26 now and iOS 17+ later. Reuse the existing architecture and conventions. Keep models, networking, view models, and persistence in platform-agnostic, UI-free packages with iOS 17-compatible APIs. Shared packages also target macOS 26; do not lower their Mac baseline. Use newer Mac-only APIs exclusively in guarded Mac views. Prefer SwiftUI; isolate unavoidable AppKit adapters. Follow macOS conventions for NavigationSplitView, Commands and keyboard shortcuts, Settings, and multiple windows.

Deliver one complete vertical slice per PR, with feature tests, a clean Xcode build, passing tests, and behavior verified against web. Update `PARITY.md` with evidence and the PR link. Wait for human merge before starting the next slice; handle review feedback first. The detailed iteration and stop/ask rules live in `PARITY.md`.

Never modify `apps/web` as part of this goal. Shared API contract or dependency changes require a separate PR and explicit approval. Stop and ask when web behavior is ambiguous or a required API is absent.

An agent in any tool can resume by reading `AGENTS.md`, this file, and `PARITY.md`, then verifying the recorded branch and PR against GitHub. Chat history, Codex goal state, and timers are not required sources of truth and do not transfer automatically. Do not start a second worker on the same slice without coordinating ownership.

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

## Exclusions and earlier tracer limits

- Windows or Linux native apps. Those stay `apps/web`.
- Kotlin Multiplatform, Compose Multiplatform, Electron, Tauri, Mac Catalyst.
- Replacing Core or `apps/web`.
- Coworker streaming, Soko Bot chat, attachments, mentions, and in-app notification behavior were deferred from the original tracer. They are now tracked as later slices in `PARITY.md`, not excluded from the ongoing chat goal. Closed-app push still requires separate scope/contract approval under ADR 0022 / 0023.
