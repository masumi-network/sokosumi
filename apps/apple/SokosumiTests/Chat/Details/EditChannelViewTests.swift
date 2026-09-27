#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct EditChannelViewTests {
      @Test(arguments: [false, true], [false, true])
      func rendersSettingsForManagersAndRosterForMembers(dark: Bool, manages: Bool) async throws {
        let room = try Components.Schemas.ChatRoom(
          id: "fixture", organizationId: "org", name: "Design", slug: "design", kind: .channel, isSelfDirect: false, isGroupDirect: false,
          topic: "Discuss designs and share feedback with the team.", discoverability: ._private, createdByUserId: "me",
          createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
          markedUnread: false, myAccess: .member,
          userMembers: [.init(id: "me", name: "Alex Morgan", email: "alex@example.com", presence: .online, access: .init(value1: .member, value2: .init(unvalidatedValue: "member"))),
                        .init(id: "peer", name: "Sam Rivera", email: "sam@example.com", presence: .afk, access: .init(value1: .member, value2: .init(unvalidatedValue: "member")))],
          coworkerMembers: [.init(id: "agent", name: "Research assistant", slug: "research", caption: "Research and analysis", image: nil, presence: .online)],
          sokoBotMembers: []
        )
        let roster = ChannelRoster(recipients: .init(targets: [
          .init(id: .human("me"), name: "Alex Morgan", detail: "alex@example.com"),
          .init(id: .human("peer"), name: "Sam Rivera", detail: "sam@example.com"),
          .init(id: .human("other"), name: "Jordan Lee", detail: "jordan@example.com"),
          .init(id: .coworker("agent"), name: "Research assistant", detail: "Research and analysis"),
          .init(id: .sokoBot("bot"), name: "Personal assistant")
        ]), isOwnerOrAdmin: manages)
        let model = ChannelEditing(room: room)
        var didLoad = false
        let content = EditChannelView(room: room, currentUserId: "me", model: model, load: {
          didLoad = true
          return roster
        }, save: { _, _ in
          Issue.record("Rendering must not save")
          return false
        }, requestLifecycle: { _ in
          Issue.record("Rendering must not request leave or archive")
        }, guestAccess: .unused)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: manages ? 780 : 540), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        for _ in 0 ..< 100 where !(didLoad && !model.loading) {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(didLoad && !model.loading)
        #expect(model.permissions?.canManageSettings == manages)
        #expect(model.canSave)
        #expect(ChannelEditPermissions.canLeave(room) && model.permissions?.canArchive == manages)
        try await Task.sleep(for: .milliseconds(100))
        host.layoutSubtreeIfNeeded()
      }
    }
  }

  extension GuestAccessActions {
    /// Private channels never render the guest section, so none of these may run.
    static let unused = loading {
      Issue.record("Guest access must not load")
      return GuestAccessSnapshot(invitations: [], links: [])
    }

    static func loading(_ snapshot: GuestAccessSnapshot) -> GuestAccessActions {
      loading { snapshot }
    }

    /// Rendering fixtures load once and never mutate.
    static func loading(_ load: @escaping () async throws -> GuestAccessSnapshot) -> GuestAccessActions {
      GuestAccessActions(load: load, invite: { _ in
        Issue.record("Rendering must not invite")
        throw CancellationError()
      }, revokeInvitation: { _ in
        Issue.record("Rendering must not revoke")
      }, createLink: { _ in
        Issue.record("Rendering must not create links")
        throw CancellationError()
      }, revokeLink: { _ in
        Issue.record("Rendering must not revoke links")
      }, removeGuest: { _ in
        Issue.record("Rendering must not remove guests")
        return false
      })
    }
  }
#endif
