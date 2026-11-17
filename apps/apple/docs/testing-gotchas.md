# Apple testing, build and profiling gotchas

Traps that passing tests and green builds do not reveal. Read this before writing or debugging a `NativeWindowTests` case, chasing a flake, profiling, or changing build flags. Known-flaky test names live in `PARITY.md` (Resume checkpoint); CI and runner facts live in `apps/apple/AGENTS.md` (App-Specific Testing).

## Window tests

- **The XCTest host window is never key.** `makeKeyAndOrderFront` leaves `isKeyWindow` false and `NSApp.activate` is ignored, so anything that behaves differently in the active key window cannot be proved there:
  - Scroll edge effects under the toolbar: in the key window the automatic and `.soft` top edges draw nothing. Check those with the key-window harness (`TitleApp.swift` in [scrolling-hover-harness.md](scrolling-hover-harness.md)), which prints whether it was active; retake when it was not.
  - Sidebar text with no explicit `foregroundStyle` renders inactive grey in a hosted `NSHostingView`. A render test that checks sidebar emphasis or colour sets `.environment(\.controlActiveState, .key)` on the hosted root and compares against a row with an explicit style.
  - A synthesized click on a SwiftUI `Text` link never calls `openURL`, because the app is not active. Assert link runs UI-free in `SokosumiChatTests` (`MessageMarkdown(...)` blocks, `runs.compactMap(\.link)`). For a real click, gate a temporary probe in `SokosumiApp.init` on an environment variable and run the Debug binary directly.
- **A real pointer hovers rows.** `ignoresMouseEvents` and a clear overlay do not stop SwiftUI hover, and `keepPointerOff` parks the window beside the pointer, so a mouse moved during a local run (or the runner's resting pointer after a wheel scroll) leaves hover chrome on a row and shifts pixel reads. Tests that read pixels use `withoutRowHover()` (`JumpMarkViewTests.swift`).
- **Wait for the condition, not a fixed time.** Window tests drive keystrokes from a timer on the shared main run loop; under the full parallel run other tests starve that loop, so a fixed sleep expires before the work lands. Poll until the asserted state holds. `.serialized` on one suite is a stopgap, since other suites still share the run loop. Fix such a flake; do not disable the test.
- **A scroll gesture of zero-delta wheel events makes SwiftUI report `.idle`.** To keep a hosted scroll in motion, rock it by about ±3 pt.
- **A fake Core honours `limit`.** Paging code asks for its page size; a fake that ignores it hides paging bugs.

## Diagnosing a flake

- Record a failure screenshot with `Attachment.record` and look at it first; read attachments back with `xcrun xcresulttool export attachments`. Test-host `print` output is often not captured.
- Reproduce with `-only-testing:<target>/<suite>/<test>(<labels>:) -test-iterations 25`, with `yes > /dev/null` processes as CPU load. A Swift Testing selector needs the argument-label signature, with a trailing `()` for no arguments; without it zero tests run and `xcodebuild` still succeeds.
- Flake rates drift by hours on the same build, so pass counts mislead in both directions. Prove a fix by logging only the event that decides pass or fail, for both builds, and keep a pass-rate table as supporting evidence. Heavy instrumentation can hide the race.
- For an A/B on one machine, copy `~/Library/Developer/Xcode/DerivedData/Sokosumi-<hash>/Build/Products` per build (the exact hash: several worktrees share the prefix) and run `xcodebuild test-without-building -xctestrun <copy>/*.xctestrun`, interleaving the builds.

## Concurrency

- **Never write a system API's callback closure inline in a `@MainActor` type.** Under Swift 6 default MainActor isolation the closure inherits the isolation, and the app traps (`EXC_BREAKPOINT` in `dispatch_assert_queue`) when the system calls it on its own queue, as `ASWebAuthenticationSession` does with the HTTPS callback. Build the handler in a `nonisolated` function that returns a `@Sendable` closure and hops with `Task { @MainActor in … }` (`MacOAuthBrowser.completionHandler(attempt:)`). Tests and ad-hoc builds never start a real session, so only a signed build shows the crash; a scratch `swiftc -swift-version 6` program reproduces a suspected trap in seconds.
- **A native text view's new pasteboard type needs menu validation too.** AppKit enables Paste only for `readablePasteboardTypes`, so a `paste(_:)` override never runs for other types until `validateUserInterfaceItem` allows them (`MacComposerTextInput`). Test the validation predicate with a uniquely named pasteboard, never `NSPasteboard.general`, which overwrites the user's clipboard.

## Builds and signing

- **CI's compilation cache hits only with the default DerivedData path.** Compile-job keys include the DerivedData path, and `main` saves the cache from `~/Library/Developer/Xcode/DerivedData/Sokosumi-<hash>`, so a CI build with `-derivedDataPath` misses about half the jobs. Find products with `~/Library/Developer/Xcode/DerivedData/Sokosumi-*/Build/Products/*.xctestrun`; when a warm build looks slow, count `Cache miss` in the job log.
- **The iOS package compile check builds unsigned.** The iOS SDK refuses ad-hoc signing of SwiftPM resource bundles, so the macOS test flags (`DEVELOPMENT_TEAM= CODE_SIGN_IDENTITY=-`) fail it on signing. Use `CODE_SIGNING_ALLOWED=NO` for `-scheme SokosumiWorkspace -destination 'generic/platform=iOS'`; it still compiles every package for iOS.
- **A signed Debug build signs in only from `/Applications`.** `swcd` associates the app with `app.sokosumi.com` only for apps in a normal install location, so a build run from derived data does nothing on Sign in. Build with `-allowProvisioningUpdates` (the team profile otherwise lacks Associated Domains), `ditto` it to `/Applications/Sokosumi Dev.app` and launch it there. Diagnose with `log show --predicate 'process == "SafariLaunchAgent"'`, which logs a missing association.

## Profiling

- `xcrun xctrace record --launch` with a harness copy of `Sokosumi.app` starts the installed `/Applications/Sokosumi.app` instead. Start the harness yourself and pass `--attach <pid>`. Attach mode records Time Profiler only (the SwiftUI and hitch tables need a launched process), so pair it with in-process counters.
- Prepending rows to the transcript's `LazyVStack` re-measures every realized row (`LazyStack.measureEstimates`); app-level knobs do not change it. Measurements and the per-row benchmark are in [scrolling-hover-harness.md](scrolling-hover-harness.md).
