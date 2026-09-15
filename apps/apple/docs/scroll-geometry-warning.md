# Scroll geometry warning investigation

Xcode 27 / macOS 27, 2026-09-15. Not yet fixed in the application.

A standalone SwiftUI app reproduces `<OnScrollGeometryChange Modifier> tried to update multiple times per frame` without chat models, rendering, networking, or writes from its geometry callback. The available viewport shrinks when a composer inset grows from 0 to 202 points while the list is positioned. Initializing the inset at 202 and removing the task assignment produced no matching warning in the comparison run. This implicates the layout transition; it does not prove every application warning has the same cause.

Observed: process SokoScrollProbe, PID 71099, warning at 12:19:34.724. Stable comparison: SokoScrollStable, no matching system-log warning. Both processes exited normally. The app trace immediately before this probe showed content-height estimates 8780 → 17432 → 18900 and viewport measurement 248 → 46.

## Reproduce outside the product

Save the following as `/tmp/Probe.swift`, compile with `xcrun swiftc -parse-as-library /tmp/Probe.swift -o /tmp/SokoScrollProbe`, then run `/tmp/SokoScrollProbe`. It exits after its four positioning cycles. Inspect `/usr/bin/log show --last 1m --style compact --predicate 'process == "SokoScrollProbe" AND eventMessage CONTAINS "multiple times per frame"'`.

```swift
import SwiftUI
import Darwin

@main
struct SokoScrollProbe: App {
  @State private var position = ScrollPosition(idType: Int.self)
  @State private var composerHeight: CGFloat = 0
  var body: some Scene {
    WindowGroup {
      ScrollViewReader { proxy in
        ScrollView {
          LazyVStack(alignment: .leading) {
            ForEach(0..<100, id: \.self) { index in
              Text(String(repeating: "Message \(index) body. ", count: index % 20 + 1))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(8)
                .id(index)
            }
            Color.clear.frame(height: 9).id("bottom")
          }
          .scrollTargetLayout()
        }
        .scrollPosition($position)
        .defaultScrollAnchor(.bottom, for: .sizeChanges)
        .safeAreaInset(edge: .bottom) { Text("Composer").frame(height: composerHeight) }
        .onScrollGeometryChange(for: ScrollGeometry.self) { $0 } action: { _, _ in }
        .task {
          composerHeight = 202
          for _ in 0..<4 {
            proxy.scrollTo("bottom", anchor: .bottom)
            try? await Task.sleep(for: .milliseconds(300))
            proxy.scrollTo(0, anchor: .top)
            try? await Task.sleep(for: .milliseconds(300))
          }
          exit(0)
        }
      }
      .frame(width: 900, height: 248)
    }
  }
}
```

Next: isolate the application's composer/viewport sizing transition and preserve initial-bottom positioning, resizing, pagination, and reading-position tests. Do not suppress geometry notifications: ignoring offset-only changes already failed the content-growth regression suite.

## Application comparison

Replacing the standalone inset with dynamic bottom padding produced no matching warning. However, replacing the application room’s `safeAreaInset` with a zero-spacing `VStack` still produced two warnings (PID 71493, launch and channel transition). That application probe was reverted. The standalone inset transition is therefore a sufficient trigger, not a complete root-cause explanation for the application. Do not ship the layout substitution as a fix.

A boundary-only geometry equality plus reading-intent update from the ending scroll phase also failed native content-growth tests (`/tmp/pr4577-phase-context.log`). Reverted; phase-end sampling alone does not replace continuous movement detection.

Detailed phase-end result: reading-history cases passed; two 20-line bottomInteraction cases failed (room and thread). Adding a pending-bottom-alignment guard to the phase-end update still failed the native suite (`/tmp/pr4577-phase-guard.log`), so it too was reverted.

Requiring stable layout size for geometry-driven intent changes, alongside the phase-end guard, also failed the native suite (`/tmp/pr4577-stable-phase.log`); reverted.

Ordinary `onGeometryChange` observing the content frame in `.scrollView` coordinates produced no warning in the standalone probe. Adapting room decisions to that frame plus a measured viewport failed native tests (`/tmp/pr4577-frame-observation.log`), so the application adaptation was reverted. Coordinate equivalence is not established.

Using the unadjusted viewport height in the content-frame adaptation still failed native tests (`/tmp/pr4577-frame2.log`), and its live launch and channel switch (PID 75945) logged `onChange(of: Bool) action tried to update multiple times per frame` twice. It changed the warning label rather than removing the update-cycle problem. Reverted.
