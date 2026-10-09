# Sokosumi for Apple

Native SwiftUI chat for macOS 26. iOS 17+ is planned; there is no iOS app target yet. Feature coverage and remaining work live in [PARITY.md](PARITY.md), and product intent in [VISION.md](VISION.md).


## Install the app

The newest **Stable release** is always at one permanent link:

**<https://github.com/masumi-network/sokosumi/releases/download/macos-latest/Sokosumi.dmg>**

Open it and drag Sokosumi to Applications. From then on the app checks for
new Stable releases itself (Sparkle) and offers them with the standard update
prompt; **Check for Updates…** in the app menu checks right away.

Testers who want to try `main` before it ships install the newest **Beta
build** by hand:

**<https://github.com/masumi-network/sokosumi/releases/download/macos-beta/Sokosumi.dmg>**

Every change to `apps/apple/**` (or `apple.yml`) that reaches `main` replaces
that disk image in place, signed and notarized. A Beta build is never offered
as an update, but it is offered the next Stable release.

## Releasing

1. Release Please keeps a **Release PR** open
   ([`macos-release.yml`](../../.github/workflows/macos-release.yml),
   [`release-please-config.json`](release-please-config.json)). It collects
   every Conventional Commit touching `apps/apple/**` since the last release,
   picks the next version from them (`feat` raises the minor, `fix` the
   patch), bumps [`Version.xcconfig`](Version.xcconfig) and writes the
   section in `CHANGELOG.md` beside it.
2. A human reviews and merges the Release PR. That tags `macos-v<version>`
   and creates its GitHub release.
3. The tag push runs `Publish macOS DMG` in `apple.yml`, which builds,
   notarizes and signs that commit, attaches the disk image to the
   `macos-v<version>` release, and replaces `Sokosumi.dmg` and `appcast.xml`
   on `macos-latest`. Installed apps see the update on their next check.

Before the first release (1.0.0) merges, `bootstrap-sha` in
`release-please-config.json` moves to the then-current `main` so earlier
commits stay out of the changelog.

Maintainers: the signing credentials behind the publish job are set up once by
[`scripts/setup-release-signing.sh`](scripts/setup-release-signing.sh), and
the release App and Sparkle keys by
[`scripts/setup-release-updates.sh`](scripts/setup-release-updates.sh).

## Build and run

Open `Sokosumi.xcworkspace` (not the bare project — the workspace is what makes the package tests reachable from the `Sokosumi` scheme), select the `Sokosumi` scheme and My Mac, then run with the configured Apple Development signing identity. Xcode 27+ is required. Use a stable signing identity for interactive builds so the saved Keychain session remains accessible. See [AGENTS.md](AGENTS.md#interactive-signing) for signing and OAuth setup.

Configuration resolves environment variables before the corresponding Info.plist keys:

| Environment | Info.plist | Purpose |
| --- | --- | --- |
| `SOKOSUMI_CORE_BASE_URL` | `SokosumiCoreBaseURL` | Core API URL, including `/v1` |
| `SOKOSUMI_WEB_BASE_URL` | `SokosumiWebBaseURL` | Web origin for setup links |
| `SOKOSUMI_OAUTH_CLIENT_ID` | `SokosumiOAuthClientID` | Registered public OAuth client ID |

The URL defaults point to production. Sign-in uses system-browser OAuth with PKCE and Keychain token storage. It does not reuse the web app's cookies.

The browser returns to the app at `https://app.sokosumi.com/auth/apple/callback`, a link only this app can claim, so nobody is asked to authorize it. That needs a build signed for the team: an ad-hoc build (`DEVELOPMENT_TEAM=`) runs the tests but cannot sign in. See [AGENTS.md](AGENTS.md#oauth-and-core-setup).

## Architecture and navigation

The Xcode navigator follows the physical source folders. Start with `Sokosumi/App/SokosumiApp.swift` for scene composition and `ChatRootView.swift` for navigation and sign-in/workspace gates.

| Location | Responsibility |
| --- | --- |
| `Sokosumi/App` | Scenes, root navigation, environment configuration and the Sparkle updater (`AppUpdater`, Developer ID builds only) |
| `Sokosumi/Authentication` | Sign-in UI, system-browser integration and Keychain adapter for `TokenStore` |
| `Sokosumi/Chat/Sidebar` | Conversation list and account/workspace menus |
| `Sokosumi/Chat/Timeline` | Scrolling, message rows, status rows, the mark a jump leaves and the spotlight it casts (`JumpSpotlightClock`), Seen by on the newest message (`SeenByButton`) and the room header, whose name is a title bar button (`RoomHeaderModifier`) |
| `Sokosumi/Chat/Threads` | Reply-thread presentation |
| `Sokosumi/Chat/Details` | Room information and members inspector (add, remove, leave), its Add picker with the guest access tab, the admin-only channel settings sheet and the group Direct Name Group sheet, one of each per window (`RoomEditSheets`) |
| `Sokosumi/Chat/Invitations` | Channel invitation and guest join-link sheets opened from in-app links |
| `Sokosumi/Chat/Pins` | Pinned-message inspector and preview cards |
| `Sokosumi/Chat/Search` | Room Find toolbar, shared inspector presentation and search result rows |
| `Sokosumi/Chat/Composer` | Rich composer, the Typing line under it, Drive picker and native text input |
| `Sokosumi/Chat/Rendering` | Markdown, code, Mermaid flowcharts, thought presentation, Soko Bot footer/hop badge and attachment chips/previews |
| `Sokosumi/Shared` | Participant avatar, `PresenceDot`, `ParticipantProfileButton`, `ParticipantDetailsView`, the shared `WrappingRow` layout and the Channel mark's symbol (`ChannelMark.systemImage`) |
| `Sokosumi/Settings` | Settings scene content (account, chat display, time format and chat notification delivery) and the time-format environment value |
| `Sokosumi/Notifications` | `UNUserNotificationCenter` adapter for local chat banners while the app runs; what to show or dismiss is decided in the shared packages |
| `SokosumiTests` | App integration tests, grouped by feature |

The app composes these UI-free packages:

| Package | Owns | Internal dependencies |
| --- | --- | --- |
| `SokosumiWorkspace` | Coordination of auth, workspace, timelines, threads and realtime | All four packages below |
| `CoreAPI` | Generated DTOs, HTTP client and client factory | None |
| `SokosumiAuth` | OAuth lifecycle and the `TokenStore` persistence port | None |
| `SokosumiChat` | Workspace/room/thread state, sends, streaming, parsing, avatar loading and chat persistence | `CoreAPI` |
| `SokosumiRealtime` | Ably transport adapter, domain event delivery, org presence and the open room's typing channel | `CoreAPI`, `SokosumiChat` |

Views render package state and dispatch user actions through `WorkspaceState`. HTTP operations belong to `ChatService`/`CoreAPI`; token lifecycle belongs to `SokosumiAuth`. Chat read backoff lives in `SokosumiChat` (`ChatReadCooldown` and its client middleware), shared across clients by app composition and scoped to the OAuth login generation. The composer owns transient typing state so each keystroke does not invalidate the timeline. Rendering parses into portable models in `SokosumiChat`, then presents those models in SwiftUI.

`SokosumiApp` currently shares one auth and workspace coordinator across windows. Each root view reports its own visibility identity. Preserve this ownership during refactors: creating a coordinator per child view would change selection, task lifetime and realtime behavior.

`WorkspaceState` lives in `Packages/SokosumiWorkspace`, with integration tests in that package. The app injects an authenticated Core client provider and the realtime connection factory. Endpoint configuration and browser presentation stay in the app; the coordinator has no dependency on the app target, SwiftUI or AppKit. Its cancellation and generation guards remain alongside the operations they protect.

## Making changes

Name files after their primary type and feature role. Keep layout and interaction state in views, reusable behavior in the owning package, and AppKit in isolated Mac adapters. Do not introduce a second networking path or a generic helpers folder. See [AGENTS.md](AGENTS.md) for enforceable conventions and [ADR 0028](../../docs/adr/0028-apple-native-clients.md) for the platform decision.

Update this README when ownership or build setup changes, `AGENTS.md` when contributor rules change, and `PARITY.md` when capability status or verification changes. Keep current PR status in `PARITY.md`, not in this architectural overview.

## Verify

Run from `apps/apple`:

```sh
mint bootstrap
mint run swiftformat --lint .
mint run swiftlint lint --strict
xcodebuild -workspace Sokosumi.xcworkspace -scheme Sokosumi -configuration Debug \
  -destination 'platform=macOS,arch=arm64' -skipPackagePluginValidation \
  DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=- test -enableCodeCoverage NO
```

That one command runs the app tests and all five package suites. Narrow it with `-only-testing:<target>`, or rerun a single package quickly with `swift test --package-path Packages/<package>`. Keep ad-hoc test builds separate from signed interactive builds. For structural changes, run the same tests before and after; also check navigation, composer focus, scrolling and hover actions in an interactive build when those views change.
