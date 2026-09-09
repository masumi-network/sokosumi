# Sokosumi Apple Clients Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the native macOS/iOS clients. For comprehensive monorepo guidelines, see the [root AGENTS.md](../../AGENTS.md). Product intent is [`VISION.md`](./VISION.md); the Mac tracer spec is [`MAC-TRACER.md`](./MAC-TRACER.md).

## App-Specific Architecture

**Stack**: One Xcode project (`Sokosumi.xcodeproj`, product `Sokosumi`), macOS target first, shared Swift packages under `Packages/` (first: `CoreAPI`, generated via Swift OpenAPI Generator). No iOS target yet; packages must stay free of AppKit/SwiftUI so iOS can link them later. No `package.json`. Xcode is outside turbo and Biome. Swift tooling (SwiftLint, SwiftFormat) installs via Mint with exact pins in `Mintfile`, not Homebrew directly.

**Key directories**: `Sokosumi/` (thin SwiftUI app: auth composition/browser adapter, workspace/chat composition, views), `Packages/CoreAPI/` (generated Core HTTP client), `Packages/SokosumiAuth/` (portable auth state, OAuth session and Keychain persistence), `Packages/SokosumiChat/` (portable WorkspaceSession/ConversationSidebar, avatar loading, scoped room/draft persistence, rooms/chat flows), `SokosumiTests/` (app-target tests).

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
