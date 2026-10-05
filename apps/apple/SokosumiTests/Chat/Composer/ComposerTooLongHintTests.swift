#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing

  @MainActor private final class HintFixture: ObservableObject {
    @Published var tooLong = false
    @Published var count = 0
    var announced: [String] = []
  }

  /// The hint as both composers place it: inside an `if` on the draft being over the limit, beside a count that
  /// changes with every keystroke.
  private struct HintHost: View {
    @ObservedObject var fixture: HintFixture

    var body: some View {
      HStack {
        if fixture.tooLong {
          ComposerTooLongHint(announce: { fixture.announced.append($0) })
        }
        Text(verbatim: "\(fixture.count)/10000")
      }
    }
  }

  extension NativeWindowTests {
    /// Row 41 review: web's hint is `role="alert"` in both composers, so it is spoken as it appears. VoiceOver is
    /// not available in the test host, so the test records what the hint posts instead.
    @MainActor struct ComposerTooLongHintTests {
      @Test func theHintIsAnnouncedOnceEachTimeTheDraftGoesOverTheLimit() async {
        let fixture = HintFixture()
        let host = NSHostingView(rootView: HintHost(fixture: fixture))
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 360, height: 60), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let message = String(localized: ComposerTooLongHint.message)
        #expect(message == "Too long to send as text")

        await Self.settle(host)
        #expect(fixture.announced.isEmpty, "Nothing is spoken under the limit")

        fixture.tooLong = true
        await Self.settle(host)
        #expect(fixture.announced == [message], "Spoken as it appears")

        for _ in 0 ..< 3 {
          fixture.count += 1
          await Self.settle(host)
        }
        #expect(fixture.announced == [message], "Not again on each keystroke while it stays")

        fixture.tooLong = false
        await Self.settle(host)
        fixture.tooLong = true
        await Self.settle(host)
        #expect(fixture.announced == [message, message], "Spoken again after the draft came back under the limit")
      }

      private static func settle(_ host: NSView) async {
        for _ in 0 ..< 3 {
          host.layoutSubtreeIfNeeded()
          try? await Task.sleep(for: .milliseconds(20))
        }
      }
    }
  }
#endif
