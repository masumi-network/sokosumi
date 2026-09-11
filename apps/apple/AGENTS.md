# Sokosumi Apple Clients Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the native macOS/iOS clients. For comprehensive monorepo guidelines, see the [root AGENTS.md](../../AGENTS.md). Before Apple work, read [`VISION.md`](./VISION.md) for the ongoing goal and [`PARITY.md`](./PARITY.md) for the authorized scope, iteration rules, current PR, and verification record. Verify the handoff against GitHub before continuing.

## App-Specific Architecture

**Stack**: One Xcode project (`Sokosumi.xcodeproj`, product `Sokosumi`), macOS target first, shared Swift packages under `Packages/` (first: `CoreAPI`, generated via Swift OpenAPI Generator). No iOS target yet; packages must stay free of AppKit/SwiftUI so iOS can link them later. No `package.json`. Xcode is outside turbo and Biome. Swift tooling (SwiftLint, SwiftFormat) installs via Mint with exact pins in `Mintfile`, not Homebrew directly.

**Key directories**: `Sokosumi/` (thin SwiftUI app: auth composition/browser adapter, workspace/chat composition, views), `Packages/CoreAPI/` (generated Core HTTP client), `Packages/SokosumiAuth/` (portable auth state, OAuth session and Keychain persistence), `Packages/SokosumiChat/` (portable WorkspaceSession/ConversationSidebar/RoomTimeline, avatar loading, scoped room/draft persistence, rooms/chat flows), `Packages/SokosumiRealtime/` (portable Ably connection, token source, room subscriptions), `Packages/SokosumiWorkspace/` (portable cross-package coordinator and integration tests), `SokosumiTests/` (app-target tests).

## Source navigation

The Xcode navigator mirrors the real folders under `Sokosumi/` using filesystem-synchronized groups. Add Swift files to the owning folder; do not add parallel virtual groups or manual build-file entries.

- `App/`: app scenes, `ChatRootView` and endpoint configuration.
- `Authentication/`: sign-in presentation, app OAuth configuration and system-browser adapter.
- `Packages/SokosumiWorkspace/`: shared workspace, room and realtime coordination; thread orchestration is in `WorkspaceState+Threads.swift`.
- `Chat/Sidebar/`: conversation sections, workspace/account menus and room labels.
- `Chat/Timeline/`: room scrolling, message rows and timeline status rows.
- `Chat/Threads/`: reply-thread presentation.
- `Chat/Composer/`: draft-owning composer and isolated native text input.
- `Chat/Rendering/`: Markdown, code, expansion and coworker thought presentation.
- `Shared/`: reusable participant avatar view. Avatar networking remains in `SokosumiChat`.
- `Settings/`: Settings scene content.

`SokosumiTests/` mirrors the relevant feature folders. Shared packages keep their existing platform-agnostic ownership. Name files after their main type; use role-specific names rather than generic `ContentView` or helper buckets. Extract independent views without changing their state identity or widening private orchestration state just to shorten a file.

## Ownership rules

Read [README.md](README.md#architecture-and-navigation) for the dependency map and source navigation. Keep it synchronized with ownership and setup changes; keep live feature/PR status only in `PARITY.md`.

- Views own layout, focus, hover and transient editing state. Dispatch chat actions through the coordinator; do not add HTTP requests or token handling to views.
- `WorkspaceState` composes package lifecycles. Reusable room/thread behavior belongs in `SokosumiChat`, auth in `SokosumiAuth`, and socket transport in `SokosumiRealtime`. The coordinator lives in `SokosumiWorkspace`; inject app configuration through its client provider rather than importing the app target or putting orchestration in a transport package.
- Preserve app-owned auth/workspace objects, per-window visibility identities and per-room/thread draft identities during extraction. Do not recreate these objects in child views.
- Keep cancellation and generation guards with the operation they protect. Do not widen private access merely to split an extension into another file.
- Package code must never import the app target or UI frameworks. Parsing produces portable models; SwiftUI rendering consumes them.
- For structural changes, run the same app/affected-package tests before and after. Verify the diff for changed defaults, state lifetime, async ordering, access control and generated/project configuration.

## App-Specific Conventions

- **Talk to Core only.** Bearer OAuth token, `X-Organization-Slug` for org workspaces, omitted for personal. No Prisma, no Postgres, no `@sokosumi/database` from Swift.
- **Packages stay UI-free.** No `import SwiftUI`/`AppKit` under `Packages/`; Mac chrome lives in `Sokosumi/`.
- **Style**: human-review baseline is the Kodeco Swift style guide; machine truth is `.swiftformat` + `.swiftlint.yml` (CI-enforced). See the [Swift style rule](../../.cursor/rules/swift-style.mdc) for the baseline and the deliberate deviations.
- **SwiftUI work**: load the app-scoped `swiftui-expert-skill` (`apps/apple/.agents/skills/`) when writing, reviewing, or refactoring SwiftUI. Never install it at the repo root. Hop `@Published` writes off the current view update (Gotchas).

## App-Specific Commands

Xcode 26+ required (`swift-tools-version: 6.2`). Install pinned lint tooling once from this directory (Mint itself comes from Homebrew; the tool versions come from `Mintfile`):

```bash
brew install mint && mint bootstrap
```

Run from `apps/apple/` (always via `mint run` so the pinned versions execute):

```bash
mint run swiftformat .                  # format the tree
mint run swiftformat --lint .           # check formatting without writing (CI runs this)
mint run swiftlint lint --strict        # lint (CI runs this)
xcodebuild -project Sokosumi.xcodeproj -scheme Sokosumi -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -skipPackagePluginValidation DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- build
swift test --package-path Packages/SokosumiChat   # per-package tests
swift test --package-path Packages/SokosumiAuth
swift test --package-path Packages/CoreAPI
swift test --package-path Packages/SokosumiRealtime
swift test --package-path Packages/SokosumiWorkspace
```

No ad-hoc signing assets live in CI: every `xcodebuild` invocation overrides with `DEVELOPMENT_TEAM=` / `CODE_SIGN_IDENTITY=-` (ad-hoc). Keep those flags when adding CI steps.

## App-Specific Testing

- Swift package tests run via `swift test --package-path Packages/<name>`; app-target tests via `xcodebuild test -only-testing:SokosumiTests`.
- Fake Core HTTP at the OpenAPI `ClientTransport` boundary. Do not test SwiftUI layout, Keychain, or `ASWebAuthenticationSession` as the required suite.
- Apple CI (`.github/workflows/apple.yml`) runs build + tests in parallel on `macos-26` for PRs touching `apps/apple/**` (or manual dispatch), including drafts. Lint/format is a separate job with that same PR/dispatch gate, plus path-filtered pushes to `main` so the Mint binary cache is saved on the default branch.

## App-Specific Gotchas

- **Do not hand-edit generated files.** `CoreAPI` derived sources come from Core's `openapi.json` via the OpenAPIGenerator plugin. Regenerate; never patch the output.
- **Bumping tool versions is deliberate.** `Mintfile` pins `swiftlint`/`swiftformat` exactly. To upgrade: bump the pin, run `mint bootstrap`, run both checks, commit the pin together with any tree/config fallout. Never float the pin to chase a single new rule.
- **Xcode template code ships 4-space indent.** Run `swiftformat .` on new files from templates.
- **Hop `@Published` writes off the current view update.** `List(selection:)` setters, `onScrollGeometryChange` / preference callbacks, `onAppear`, and `onChange` schedule `Task { @MainActor in … }` before calling `WorkspaceState` / `AuthState`. Button and Menu actions publish in place. The models stay synchronous so tests call them directly. Lint and `xcodebuild test` do not catch this; a debug run's Issue navigator (purple SwiftUI) or `/usr/bin/log show --last 5m --info --predicate 'subsystem == "com.apple.runtime-issues" AND process == "Sokosumi"'` does. A burst of the same fault in one millisecond is this pattern.

### Interactive signing

For interactive launches use the configured Apple Development identity and team `Y3ZJFLUYRB`, with a separate derived-data directory such as `/tmp/sokosumi-interactive-signing`. Pass `DEVELOPMENT_TEAM=Y3ZJFLUYRB CODE_SIGN_IDENTITY='Apple Development'` to Xcode. Keep ad-hoc builds for CI/tests separate from interactive launches so rebuilding does not repeatedly change the identity used to access the saved Keychain session.

### OAuth and Core setup

- Use a first-party public OAuth client with PKCE (no embedded client secret), registered through the existing Core OAuth client machinery by an operator. Scopes are `openid`, `sokosumi:api`, and `offline_access`; use the system browser and Keychain-backed token persistence. Do not substitute API keys or browser cookies for the human session.
- Register the exact redirect URI `com.sokosumi.app:/auth` (one slash, no host), with callback scheme `com.sokosumi.app`. The double-slash form is not interchangeable. Configuration lives in `Packages/SokosumiAuth/Sources/SokosumiAuth/OAuthConfiguration.swift`.
- Configure the Core base URL for the intended environment. Local Core uses this checkout's portless HTTPS URL. Personal requests omit `X-Organization-Slug`; organization requests carry their slug. `GET /v1/users/me/workspace-access` must return `ready` before chat is usable; other gates open the corresponding web setup flow.
- Refresh the selected OpenAPI operations from a generated Core specification with `python3 scripts/update-core-api.py /path/to/core-openapi.json` from `apps/apple`. Append an existing Core path such as `/chats/rooms/{id}/unread` to include it. The script retains selected operations, resolves transitive schemas, and writes literal UTF-8 because escaped non-BMP examples can break the generator's YAML parser. Never hand-edit the snapshot or generated Swift output. This workflow does not authorize changing Core contracts or web files.
- Realtime uses the existing workspace-scoped Ably token endpoint and a persisted per-install `clientInstanceId`; follow ADR 0003 and ADR 0014 for identity and event contracts. Behavior and the authorized feature boundary are tracked in `PARITY.md`; architecture decisions remain in `docs/adr/` (including [`0028-apple-native-clients.md`](../../docs/adr/0028-apple-native-clients.md)).
