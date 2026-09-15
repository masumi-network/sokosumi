# Swift 6 language mode and SDK audit

## Scope

Xcode 27.0 (27A266a) provides Swift 6.4. The five packages already declare tools version 6.4 and use the default Swift 6 language mode. The app and app-test targets still explicitly selected Swift 5. This change sets their Debug and Release configurations to Swift 6, making concurrency violations compile errors. Existing MainActor default isolation and approachable concurrency settings remain unchanged.

No generated files, package versions, deployment targets, or UI behavior change. Do not pass a global `SWIFT_VERSION=6` override: that also overrides third-party packages that intentionally compile in an earlier mode. An initial probe failed in swift-markdown under that override; the project-target settings build successfully.

## Test fixture isolation

The app-test target defaults to MainActor. Its two URLProtocol subclasses now explicitly opt out because URLSession invokes their overrides outside that actor. Shared mutable fixture state remains mutex-protected. The delayed media fixture uses a cancellable Task instead of sharing a non-Sendable DispatchWorkItem across queues. Existing native media and pagination tests exercise these fixtures.

## SDK decisions

Reviewed Apple's [Swift 6 adoption guidance](https://developer.apple.com/documentation/Swift/AdoptingSwift6) and [SwiftUI updates](https://developer.apple.com/swiftui/whats-new/), together with the installed SDK and current call sites.

- Keep the existing attachment FileDocument implementation. The new asynchronous Document APIs are not needed for this export flow, and replacing it would introduce a newer-OS path without a demonstrated problem.
- Keep the shared image loader. The new AsyncImage caching controls do not replace its existing off-main thumbnail decoding and size limits; the app has no AsyncImage call sites to migrate.
- Keep current toolbar and presentation APIs. New overflow, reorder, and swipe APIs do not address this migration's requirements and would change established interactions.
- Keep macOS 26 and planned iOS 17 package compatibility. New SDK availability does not justify raising deployment targets.

The existing runtime scroll-geometry warning remains a separate documented issue. Swift 6 compilation does not prove that SwiftUI view-update cycles are resolved.

## Verification

App build and the complete app test suite pass in Swift 6 mode. All 489 package tests pass (CoreAPI 1, Auth 34, Chat 357, Realtime 27, Workspace 70). Pinned SwiftFormat and strict SwiftLint pass. No test-host apps remain running. Generated OpenAPI unused-public-import diagnostics remain generator output and are not edited here.
