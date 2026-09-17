#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct PresenceDotTests {
      @Test func labelsMatchWeb() {
        #expect(presenceLabel(.online) == "Online")
        #expect(presenceLabel(.afk) == "Away")
        #expect(presenceLabel(.offline) == "Offline")
      }

      /// Every state at every avatar size the app uses (sidebar 20, roster 32,
      /// details 48), on avatars with and without an image, in both appearances.
      @Test(arguments: [false, true])
      func rendersEveryStateAndSize(dark: Bool) async throws {
        let content = VStack(alignment: .leading, spacing: 16) {
          ForEach([CGFloat(20), 32, 48], id: \.self) { face in
            HStack(spacing: 24) {
              ForEach([Components.Schemas.ChatRoomPresence.online, .afk, .offline], id: \.rawValue) { presence in
                HStack(spacing: 12) {
                  ParticipantAvatar(imageURL: nil, name: "Alexandra Long", size: face)
                    .presenceBadge(presence, size: face == 20 ? 8 : face == 32 ? 10 : 12)
                  Text(presenceLabel(presence)).font(.caption)
                }
              }
            }
          }
        }
        .padding(24)
        .frame(width: 420, height: 220, alignment: .topLeading)
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 220), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("presence-dots-\(dark ? "dark" : "light").png"))
      }
    }
  }
#endif
