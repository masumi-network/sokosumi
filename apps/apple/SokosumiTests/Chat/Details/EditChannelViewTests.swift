#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct EditChannelViewTests {
      /// The admin-only settings sheet (SOK-1258): name, topic, visibility and Archive at sheet width, with no roster to
      /// load and Save available straight away. Recorded light and dark.
      @Test(arguments: [false, true])
      func rendersSettingsWithoutRoster(dark: Bool) async throws {
        let room = Components.Schemas.ChatRoom(
          id: "fixture", organizationId: "org", name: "Design", slug: "design", kind: .channel, isSelfDirect: false, isGroupDirect: false,
          topic: "Discuss designs and share feedback with the team.", discoverability: ._private, createdByUserId: "me",
          createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
          markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
          userMembers: [.init(id: "me", name: "Alex Morgan", email: "alex@example.com", presence: .online, access: .member)],
          coworkerMembers: [], sokoBotMembers: []
        )
        let model = ChannelEditing(room: room)
        let view = EditChannelView(room: room, model: model, save: { _ in
          Issue.record("Rendering must not save")
          return false
        }, requestArchive: {
          Issue.record("Rendering must not request archive")
        })
        let content = view
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: host.fittingSize), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        #expect(model.canSave)
        #expect(model.draft.name == "Design" && model.draft.visibility == .private)
        #expect(host.fittingSize.width == 480, "\(host.fittingSize)")
      }
    }
  }
#endif
