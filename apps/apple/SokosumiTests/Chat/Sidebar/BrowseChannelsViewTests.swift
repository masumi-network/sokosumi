#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct BrowseChannelsViewTests {
      @Test(arguments: [false, true])
      func rendersChannels(dark: Bool) async throws {
        let rooms: [Components.Schemas.DiscoverableChatRoom] = [
          .init(id: "public", name: "Design", slug: "design", topic: "Share designs, discuss feedback, and improve the product together.", discoverability: ._public, memberCount: 12, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast),
          .init(id: "private", name: "Leadership", slug: "leadership", topic: "Planning and coordination", discoverability: ._private, memberCount: 4, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast),
          .init(id: "external", name: "Partner collaboration", slug: "partner", discoverability: .external, memberCount: 1, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast)
        ]
        let model = ChannelBrowser()
        var didLoad = false
        let content = BrowseChannelsView(model: model, load: { _ in
          didLoad = true
          return rooms
        }, join: { _ in
          Issue.record("Rendering must not join a channel")
          return false
        })
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 510), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 100 {
          if didLoad, !model.loading {
            break
          }
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(didLoad && !model.loading)
        #expect(model.rooms.count == 3)
        try await Task.sleep(for: .milliseconds(100))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("browse-channels-\(dark ? "dark" : "light").png"))
      }
    }
  }
#endif
