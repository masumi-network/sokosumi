#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct ChatJoinViewTests {
      @Test(arguments: [false, true], [true, false])
      func rendersJoinPreviewAndUnavailableLink(dark: Bool, valid: Bool) async throws {
        let model = GuestJoin(token: "tok")
        let content = ChatJoinView(token: "tok", model: model, resolve: { _ in
          valid
            ? .init(status: .valid, room: .init(id: "room", name: "Partners", organizationId: "org", organizationName: "Acme Partners"))
            : .init(status: .expired, room: nil)
        }, join: { _ in
          Issue.record("Rendering must not join")
          return false
        })
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 300), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        for _ in 0 ..< 100 where model.link == nil {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(model.link?.status == (valid ? .valid : .expired))
        #expect((model.room != nil) == valid && !model.loading)
        try await Task.sleep(for: .milliseconds(100))
        host.layoutSubtreeIfNeeded()
      }
    }
  }
#endif
