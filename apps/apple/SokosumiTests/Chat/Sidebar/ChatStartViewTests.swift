#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct ChatStartViewTests {
      @Test(arguments: [false, true])
      func coworkerListLoadsInNativeWindow(dark: Bool) async throws {
        var loads = 0
        let content = ChatStartView(load: {
          loads += 1
          return .init(targets: [
            .init(id: .coworker("research"), name: "Research assistant", slug: "research", priority: 2, caption: "Research and analysis"),
            .init(id: .coworker("writing"), name: "Writing assistant", slug: "writing", caption: "Clear writing for your audience"),
            .init(id: .coworker("support"), name: "Customer support specialist", slug: "support", caption: "A longer specialty that wraps without crowding the adjacent rows")
          ])
        }, open: { _ in
          Issue.record("Rendering must not create a conversation")
          return false
        })
        .frame(width: 560, height: 520)
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 560, height: 520), styleMask: [.titled], backing: .buffered, defer: false)
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
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("chat-start-\(dark ? "dark" : "light").png"))
      }
    }
  }
#endif
