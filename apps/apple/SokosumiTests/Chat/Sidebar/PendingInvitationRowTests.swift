#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct PendingInvitationRowTests {
      @Test(arguments: [false, true])
      func rendersPendingRowsAboveExternalRooms(dark: Bool) async throws {
        func invitation(_ id: String, _ name: String, _ organization: String) -> Components.Schemas.ChatRoomInvitation {
          .init(id: id, roomId: "room-\(id)", roomName: name, organizationId: "org", organizationName: organization, email: "me@example.com",
                status: .pending, inviter: .init(id: "host", name: "Hannah"), expiresAt: .distantFuture, createdAt: .distantPast)
        }
        let invitations = [
          invitation("a", "Partners", "Acme Partners"),
          invitation("b", "Launch planning for the very long quarterly roadmap review", "A very long host organization name that truncates")
        ]
        let content = List {
          Section {
            Text("External").font(.subheadline.weight(.semibold)).foregroundStyle(.secondary)
            ForEach(invitations, id: \.id) { invitation in
              PendingInvitationRow(invitation: invitation, responding: invitation.id == "b" ? .accept : nil, busy: invitation.id == "b") { _ in
                Issue.record("Rendering must not respond to invitations")
              }
            }
            Label {
              Text("Joined guest room")
            } icon: {
              Image(systemName: "globe")
                .foregroundStyle(.secondary)
                .frame(width: DirectRoomAvatarStack.faceSize, height: DirectRoomAvatarStack.faceSize)
            }
            .labelStyle(RoomRowLabelStyle())
            .listRowInsets(EdgeInsets(top: 4, leading: 8, bottom: 4, trailing: 8))
          }
        }
        .listStyle(.sidebar)
        .frame(width: 260, height: 220)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 260, height: 220), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        try png.write(to: FileManager.default.temporaryDirectory.appendingPathComponent("pending-invitations-\(dark ? "dark" : "light").png"))
      }
    }
  }
#endif
