# Sokosumi Apple Clients Agent Guidelines

> **Purpose**: This document provides app-specific guidelines for AI agents working on the native macOS/iOS clients. For comprehensive monorepo guidelines, see the [root AGENTS.md](../../AGENTS.md). Before Apple work, read [`VISION.md`](./VISION.md) for the ongoing goal and [`PARITY.md`](./PARITY.md) for the authorized scope, iteration rules, current PR, and verification record. Verify the handoff against GitHub before continuing.

## App-Specific Architecture

**Stack**: One Xcode workspace (`Sokosumi.xcworkspace`) holding `Sokosumi.xcodeproj` (product `Sokosumi`) and the five local packages as root packages, so the `Sokosumi` scheme runs the app tests and every package suite in one command. Build and test through the workspace, not the project — `-project` cannot reach the package test targets. macOS target first, shared Swift packages under `Packages/` (first: `CoreAPI`, generated via Swift OpenAPI Generator). No iOS target yet; packages must stay free of AppKit/SwiftUI so iOS can link them later. No `package.json`. Xcode is outside turbo and Biome. Swift tooling (SwiftLint, SwiftFormat) installs via Mint with exact pins in `Mintfile`, not Homebrew directly.

**Key directories**: `Sokosumi/` (thin SwiftUI app: auth composition/browser adapter, workspace/chat composition, views), `Packages/CoreAPI/` (generated Core HTTP client), `Packages/SokosumiAuth/` (portable auth state, OAuth session and Keychain persistence), `Packages/SokosumiChat/` (portable WorkspaceSession/ConversationSidebar/RoomTimeline, avatar loading, scoped room/draft persistence, rooms/chat flows), `Packages/SokosumiRealtime/` (portable Ably connection, token source, room subscriptions, org presence), `Packages/SokosumiWorkspace/` (portable cross-package coordinator and integration tests), `SokosumiTests/` (app-target tests).

## Source navigation

The Xcode navigator mirrors the real folders under `Sokosumi/` using filesystem-synchronized groups. Add Swift files to the owning folder; do not add parallel virtual groups or manual build-file entries.

- `App/`: app scenes, `ChatRootView`, endpoint configuration and the Mac presence activity monitor.
- `Authentication/`: sign-in presentation, app OAuth configuration and system-browser adapter.
- `Packages/SokosumiWorkspace/`: shared workspace, room and realtime coordination; thread orchestration is in `WorkspaceState+Threads.swift`.
- `Chat/Sidebar/`: conversation sections, workspace/account menus and room labels.
- `Chat/Timeline/`: room scrolling, message rows and timeline status rows.
- `Chat/Threads/`: reply-thread presentation.
- `Chat/Pins/`: pinned-message inspector and preview cards; pin state and networking stay in the shared packages.
- `Chat/Search/`: Room Find toolbar, shared inspector presentation and search result rows.
- `Chat/Details/`: room details/roster inspector, channel settings sheet, lifecycle confirmations and the host-side guest access section; guest state and networking stay in the shared packages.
- `Chat/Invitations/`: channel invitation and guest join-link sheets; invitation state and networking stay in the shared packages.
- `Chat/Composer/`: draft-owning rich composer, Drive picker (`DriveFilePickerView`) and isolated native text input.
- `Chat/Rendering/`: Markdown, code, expansion, coworker thought, and attachment chips/previews (`MessageAttachmentView`, `DocumentAttachmentPreview`, `NativeOfficePreview`).
- `Shared/`: reusable participant avatar, `PresenceDot`, `ParticipantProfileButton` and `ParticipantDetailsView`. Avatar networking and presence state remain in `SokosumiChat`.
- `Settings/`: Settings scene content and the `timeFormat` environment value; preference state and networking stay in the shared packages.
- `Notifications/`: `UNUserNotificationCenter` adapter (`ChatNotificationCenter`) and its lifecycle modifier for local chat banners while the app runs. The banner rules, preferences and navigation stay in the shared packages; no push registration.

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
- **UI/UX parity**: current web behavior takes precedence over stale requirements; update `PARITY.md` to match and proceed without a scope question for that discrepancy. Preserve explicit native-control preferences and the authorized chat boundary. Before changing chat UI, inspect the corresponding web source and running interaction or supplied recording. Preserve action availability, loading/error states, spacing hierarchy, focus and hover behavior while using native controls. Inspect edge clipping, rounded-corner transitions, text truncation, icon alignment, and padding while scrolling and resizing, including avatars and reactions near the composer. Verify the rendered Apple result; passing builds alone do not prove visual correctness. Record any unverified interaction explicitly.
- **SwiftUI work**: load the app-scoped `swiftui-expert-skill` (`apps/apple/.agents/skills/`) when writing, reviewing, or refactoring SwiftUI. Never install it at the repo root. Hop `@Published` writes off the current view update (Gotchas).

## App-Specific Commands

Xcode 27+ required (`swift-tools-version: 6.4`). Install pinned lint tooling once from this directory (Mint itself comes from Homebrew; the tool versions come from `Mintfile`):

```bash
brew install mint && mint bootstrap
```

Run from `apps/apple/` (always via `mint run` so the pinned versions execute):

```bash
mint run swiftformat .                  # format the tree
mint run swiftformat --lint .           # check formatting without writing (CI runs this)
mint run swiftlint lint --strict        # lint (CI runs this)
xcodebuild -workspace Sokosumi.xcworkspace -scheme Sokosumi -configuration Debug \
  -destination 'platform=macOS,arch=arm64' \
  -skipPackagePluginValidation DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- build
xcodebuild test -workspace Sokosumi.xcworkspace -scheme Sokosumi \
  -configuration Debug -destination 'platform=macOS,arch=arm64' \
  -skipPackagePluginValidation DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- \
  -enableCodeCoverage NO                # app tests + all five package suites
swift test --package-path Packages/SokosumiChat   # fast single-package rerun
```

No ad-hoc signing assets live in CI: every `xcodebuild` invocation overrides with `DEVELOPMENT_TEAM=` / `CODE_SIGN_IDENTITY=-` (ad-hoc). Keep those flags when adding CI steps.

## App-Specific Testing

- The `Sokosumi` workspace scheme runs all six suites: `SokosumiTests` plus `CoreAPITests`, `SokosumiAuthTests`, `SokosumiChatTests`, `SokosumiRealtimeTests` and `SokosumiWorkspaceTests`. Narrow a run with `-only-testing:<target>`, or use `swift test --package-path Packages/<name>` for a fast single-package rerun. A new package must be added to both `Sokosumi.xcworkspace/contents.xcworkspacedata` and the scheme's `Testables`, or its tests run nowhere.
- **Ask Xcode before building.** `XcodeListTargets` / `XcodeListSchemes` (Xcode MCP) or `xcodebuild -workspace Sokosumi.xcworkspace -list` say which targets and schemes exist in seconds; `GetTestList` returns every test with file paths and costs roughly 15k tokens, so reach for it only to pick a specific test to run. A `TestableReference` Xcode does not recognise is dropped **silently** — `xcodebuild` exits 0 having run fewer suites — so confirm a new test target in `XcodeListTargets` rather than trusting a green run.
- **Reuse the shared derived data.** A fresh `-derivedDataPath` costs about 3 GB. Use one only where a clean graph is the point (counting `dynamic-product` targets, see Gotchas) and delete it afterwards; several left behind fill the disk and later runs die with `No space left on device`.
- Coverage stays off (`-enableCodeCoverage NO`): ably-cocoa's `AblyDeltaCodec` C target cannot link the profile runtime (SOK-976).
- Fake Core HTTP at the OpenAPI `ClientTransport` boundary. Do not test SwiftUI layout, Keychain, or `ASWebAuthenticationSession` as the required suite.
- Tests run in **GitHub Actions**, in one `xcodebuild test` on the `Sokosumi` **workspace** scheme, which covers the app tests and all five package suites. Do not add per-package jobs — the workspace scheme already runs them, and a package scheme on its own does not build the app host.
- `.github/workflows/apple.yml` runs both Apple gates on `xcode-27`: `Xcode test` (the workspace scheme) and `Swift lint and format` (SwiftLint + SwiftFormat via Mint). Both are **required status checks** on `main`, so do not delete or rename either job without updating the `Default Branch` ruleset in the same change. They run for PRs touching `apps/apple/**` (or manual dispatch), including drafts, and on path-filtered pushes to `main`, which save the Mint binary cache; PRs only restore it.
- **Xcode Cloud builds releases only.** It does not run on pull requests, and it cannot be a required status check: a start condition filtered to `apps/apple/**` reports nothing at all on a change it excludes, so a required context would hang every non-Apple PR forever. See [docs/xcode-cloud-required-check.md](docs/xcode-cloud-required-check.md). `ci_scripts/ci_post_clone.sh` exists for those release builds.

## App-Specific Gotchas

- **Do not hand-edit generated files.** `CoreAPI` derived sources come from Core's `openapi.json` via the OpenAPIGenerator plugin. Regenerate; never patch the output.
- **Bumping tool versions is deliberate.** `Mintfile` pins `swiftlint`/`swiftformat` exactly. To upgrade: bump the pin, run `mint bootstrap`, run both checks, commit the pin together with any tree/config fallout. Never float the pin to chase a single new rule.
- **Xcode template code ships 4-space indent.** Run `swiftformat .` on new files from templates.
- **`SokosumiTests` declares no package products.** It is hosted in the app (`TEST_HOST` / `BUNDLE_LOADER`), and the app already links every package, so tests `import` those modules and bind to the app's copy. Adding a package product to the test target (Frameworks phase or `packageProductDependencies`) makes Xcode rebuild all ~75 package products as dynamic frameworks, and with code coverage on their C sources fail to link (`Undefined symbol: ___llvm_profile_runtime`). CI passes `-enableCodeCoverage NO` and would not notice; an Xcode Cloud release build or a local run with coverage on would. Check with `xcodebuild … -enableCodeCoverage YES build-for-testing` in a fresh derived-data path. A package only the tests need goes on the app target too, or into a package test target.
- **`Bundle.module` is per target.** Giving a package's test target `resources:` generates a `Bundle.module` for that target which shadows the library's through `@testable import`, so tests reading library resources look in the test bundle and fail. `SokosumiChat` names its own bundle explicitly as `ChatResources.bundle` at every call site; do the same in any package whose tests gain resources. Reading a fixture from the source tree instead is caught by the `source_relative_fixture` lint rule.
- **Hop `@Published` writes off the current view update.** `List(selection:)` setters, `onScrollGeometryChange` / preference callbacks, `onAppear`, and `onChange` schedule `Task { @MainActor in … }` before calling `WorkspaceState` / `AuthState`. Button and Menu actions publish in place. The models stay synchronous so tests call them directly. Lint and `xcodebuild test` do not catch this; a debug run's Issue navigator (purple SwiftUI) or `/usr/bin/log show --last 5m --info --predicate 'subsystem == "com.apple.runtime-issues" AND process == "Sokosumi"'` does. A burst of the same fault in one millisecond is this pattern.

### Interactive signing

Stop each agent-launched app after its interactive check and before launching another variant. After tests, verify no test-host app remains running; close only instances launched by this task. Do not leave multiple test builds open.

For interactive launches use the configured Apple Development identity and team `GVWN7HXYJB`, with a separate derived-data directory such as `/tmp/sokosumi-interactive-signing`. Pass `DEVELOPMENT_TEAM=GVWN7HXYJB CODE_SIGN_IDENTITY='Apple Development'` to Xcode. Keep ad-hoc builds for CI/tests separate from interactive launches so rebuilding does not repeatedly change the identity used to access the saved Keychain session.

### OAuth and Core setup

- Use a first-party public OAuth client with PKCE (no embedded client secret), registered through the existing Core OAuth client machinery by an operator. Scopes are `openid`, `sokosumi:api`, and `offline_access`; use the system browser and Keychain-backed token persistence. Do not substitute API keys or browser cookies for the human session.
- Register the exact redirect URI `com.sokosumi.app:/auth` (one slash, no host), with callback scheme `com.sokosumi.app`. The double-slash form is not interchangeable. Configuration lives in `Packages/SokosumiAuth/Sources/SokosumiAuth/OAuthConfiguration.swift`.
- Configure the Core base URL for the intended environment. Local Core uses this checkout's portless HTTPS URL. Personal requests omit `X-Organization-Slug`; organization requests carry their slug. `GET /v1/users/me/workspace-access` must return `ready` before chat is usable; other gates open the corresponding web setup flow.
- Refresh the selected OpenAPI operations from a generated Core specification with `python3 scripts/update-core-api.py /path/to/core-openapi.json` from `apps/apple`. Append an existing Core path such as `/chats/rooms/{id}/unread` to include it. The script retains selected operations, resolves transitive schemas, and writes literal UTF-8 because escaped non-BMP examples can break the generator's YAML parser. Never hand-edit the snapshot or generated Swift output. This workflow does not authorize changing Core contracts or web files.
- Realtime uses the existing workspace-scoped Ably token endpoint and a persisted per-install `clientInstanceId`; follow ADR 0003 and ADR 0014 for identity and event contracts. Behavior and the authorized feature boundary are tracked in `PARITY.md`; architecture decisions remain in `docs/adr/` (including [`0028-apple-native-clients.md`](../../docs/adr/0028-apple-native-clients.md)).
