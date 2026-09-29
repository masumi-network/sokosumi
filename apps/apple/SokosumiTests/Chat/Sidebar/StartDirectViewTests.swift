#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct StartDirectViewTests {
      @Test(arguments: [false, true])
      func recipientListLoadsInNativeWindow(dark: Bool) async throws {
        var loads = 0
        let content = StartDirectView(hasOrganization: true, load: {
          loads += 1
          return .init(targets: [
            .init(id: .human("one"), name: "Alexandra Long Recipient Name", detail: "alexandra@example.com"),
            .init(id: .human("two"), name: "Sam Rivera", detail: "sam@example.com"),
            .init(id: .coworker("helper"), name: "Research assistant", detail: "Research and analysis"),
            .init(id: .sokoBot("bot"), name: "Personal assistant")
          ])
        }, open: { _ in
          Issue.record("Rendering must not create a conversation")
          return false
        })
        .frame(width: 420, height: 500)
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 500), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 100 where loads == 0 {
          try await Task.sleep(for: .milliseconds(10))
        }
        #expect(loads == 1)
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
      }
    }
  }
#endif
