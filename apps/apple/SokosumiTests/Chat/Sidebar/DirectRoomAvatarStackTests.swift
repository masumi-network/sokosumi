#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct DirectRoomAvatarStackTests {
      /// Sidebar Direct faces at row size: a group stack where the live map
      /// overrides one human, a snapshot fallback for the other, a coworker
      /// pinned online, a 1:1 offline peer and a self Direct without a mark.
      @Test(arguments: [false, true])
      func rendersLiveAndFallbackMarks(dark: Bool) async throws {
        let group = [
          DirectRoomAvatarParticipant(id: "live", name: "Ada Lovelace", imageURL: nil, presence: .offline),
          DirectRoomAvatarParticipant(id: "snapshot", name: "Grace Hopper", imageURL: nil, presence: .afk),
          DirectRoomAvatarParticipant(id: "agent", name: "Research assistant", imageURL: nil, isAI: true, presence: .offline)
        ]
        let peer = [DirectRoomAvatarParticipant(id: "peer", name: "Sam Rivera", imageURL: nil, presence: .offline)]
        let content = List {
          row("Ada, Grace, Research assistant") {
            DirectRoomAvatarStack(participants: group, livePresence: ["live": .online])
          }
          row("Sam Rivera") {
            DirectRoomAvatarStack(participants: peer)
          }
          row("Me") {
            DirectRoomAvatarStack(participants: peer, showsPresence: false)
          }
        }
        .listStyle(.sidebar)
        .frame(width: 240, height: 140)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 240, height: 140), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("sidebar-presence-\(dark ? "dark" : "light").png"))
      }

      private func row(_ title: String, @ViewBuilder icon: () -> some View) -> some View {
        Label { Text(title).lineLimit(1) } icon: { icon() }
          .labelStyle(RoomRowLabelStyle())
          .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
      }
    }
  }
#endif
