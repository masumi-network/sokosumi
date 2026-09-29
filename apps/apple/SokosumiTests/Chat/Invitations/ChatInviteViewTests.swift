#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct ChatInviteViewTests {
      @Test(arguments: [false, true], [true, false])
      func rendersPendingAndNotFoundCards(dark: Bool, pending: Bool) async throws {
        let invitation = Components.Schemas.ChatRoomInvitation(
          id: "inv", roomId: "room", roomName: "Partners", organizationId: "org", organizationName: "Acme Partners", email: "me@example.com",
          status: .pending, inviter: .init(id: "host", name: "Hannah Host"), expiresAt: .distantFuture, createdAt: .distantPast
        )
        let model = InvitationDetail(id: "inv")
        let content = ChatInviteView(invitationId: "inv", model: model, load: { _ in
          guard pending else { throw ChatServiceError.unprocessable(statusCode: 404, message: "Invitation not found") }
          return invitation
        }, respond: { _, _ in
          Issue.record("Rendering must not respond")
          return false
        }, openRoom: { _ in
          Issue.record("Rendering must not open a room")
        })
        .background(.background)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 260), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        for _ in 0 ..< 100 where model.presentation == nil {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(model.presentation == (pending ? .pending(invitation) : .notFound))
        #expect(!model.loading && model.loadError == nil)
        try await Task.sleep(for: .milliseconds(100))
        host.layoutSubtreeIfNeeded()
      }
    }
  }
#endif
