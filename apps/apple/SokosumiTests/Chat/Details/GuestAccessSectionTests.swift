#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct GuestAccessSectionTests {
      private func externalRoom(guestName: String, topic: String? = nil) throws -> Components.Schemas.ChatRoom {
        try Components.Schemas.ChatRoom(
          id: "fixture", organizationId: "org", name: "Partners", slug: "partners", kind: .channel, isSelfDirect: false,
          topic: topic, discoverability: .external, createdByUserId: "me",
          createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
          markedUnread: false, myAccess: .member,
          userMembers: [.init(id: "me", name: "Alex Morgan", email: "alex@example.com", presence: .online, access: .init(value1: .member, value2: .init(unvalidatedValue: "member"))),
                        .init(id: "guest", name: guestName, email: "priya@agency-partners-worldwide.example", presence: .offline, access: .init(value1: .guest, value2: .init(unvalidatedValue: "guest")))],
          coworkerMembers: [], sokoBotMembers: []
        )
      }

      private func snapshot() throws -> GuestAccessSnapshot {
        let expires = try #require(Calendar.current.date(from: DateComponents(year: 2026, month: 9, day: 24)))
        return GuestAccessSnapshot(
          invitations: [.init(id: "inv", roomId: "fixture", roomName: "Partners", organizationId: "org", organizationName: "Acme",
                              email: "very.long.guest.address@agency-partners-worldwide.example", status: .pending,
                              inviter: .init(id: "me", name: "Alex Morgan"), expiresAt: .distantFuture, createdAt: .distantPast)],
          links: [.init(token: "Zx9kQ2mN4pR7sT1vW3yA5bC8dE0fG6hJ", url: "https://app.sokosumi.com/chat/join/Zx9kQ2mN4pR7sT1vW3yA5bC8dE0fG6hJ",
                        roomId: "fixture", createdAt: .distantPast, expiresAt: expires, revokedAt: nil, maxUses: 10, useCount: 3),
                  .init(token: "short", url: "https://app.sokosumi.com/chat/join/short", roomId: "fixture", createdAt: .distantPast,
                        expiresAt: nil, revokedAt: nil, maxUses: nil, useCount: 1)]
        )
      }

      /// The external-channel settings sheet: settings, roster, guest access and Manage channel scroll inside the
      /// clamped sheet while Cancel/Save stay put; the guest section shows a pending invitation, live links with
      /// their meta line and one guest.
      @Test(arguments: [false, true])
      func rendersGuestAccessInsideChannelSettings(dark: Bool) async throws {
        let room = try externalRoom(guestName: "Priya Natarajan", topic: "Shared channel with our agency partners.")
        let roster = ChannelRoster(recipients: .init(targets: [
          .init(id: .human("me"), name: "Alex Morgan", detail: "alex@example.com"),
          .init(id: .human("peer"), name: "Sam Rivera", detail: "sam@example.com")
        ]), isOwnerOrAdmin: true)
        let snapshot = try snapshot()
        let editing = ChannelEditing(room: room)
        var loads = 0
        let actions = GuestAccessActions(load: {
          loads += 1
          return snapshot
        }, invite: { _ in
          Issue.record("Rendering must not invite")
          throw CancellationError()
        }, revokeInvitation: { _ in Issue.record("Rendering must not revoke") }, createLink: { _ in
          Issue.record("Rendering must not create links")
          throw CancellationError()
        }, revokeLink: { _ in Issue.record("Rendering must not revoke links") }, removeGuest: { _ in
          Issue.record("Rendering must not remove guests")
          return false
        })
        let content = EditChannelView(room: room, currentUserId: "me", model: editing, load: { roster }, save: { _, _ in
          Issue.record("Rendering must not save")
          return false
        }, requestLifecycle: { _ in
          Issue.record("Rendering must not request leave or archive")
        }, guestAccess: actions)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: host.fittingSize), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        host.layoutSubtreeIfNeeded()
        for _ in 0 ..< 100 where !(loads > 0 && !editing.loading) {
          try await Task.sleep(for: .milliseconds(20))
        }
        #expect(loads == 1 && !editing.loading)
        #expect(ChannelEditPermissions.canInviteGuests(room))
        try await Task.sleep(for: .milliseconds(100))
        // Loaded, the sheet sizes to the content's ideal height, clamped like a scrolling web dialog.
        let fitting = host.fittingSize
        #expect(fitting.width == 480 && fitting.height == 760, "\(fitting)")
        window.setContentSize(fitting)
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
      }

      /// The section alone, loaded, at sheet width: long addresses and URLs truncate in the middle, the link meta line
      /// follows web's copy and a named guest shows name plus email.
      @Test(arguments: [false, true])
      func rendersLoadedSection(dark: Bool) async throws {
        let room = try externalRoom(guestName: "Priya Natarajan")
        let model = GuestAccess(room: room)
        let content = try GuestAccessSection(room: room, model: model, actions: .loading(snapshot()))
          .padding(20)
          .frame(width: 480)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: host.fittingSize), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        for _ in 0 ..< 100 where model.links.isEmpty || model.loading {
          try await Task.sleep(for: .milliseconds(20))
        }
        try await Task.sleep(for: .milliseconds(100))
        window.setContentSize(host.fittingSize)
        host.layoutSubtreeIfNeeded()
        #expect(model.invitations.count == 1 && model.links.count == 2 && model.guests.count == 1 && !model.loading)
      }
    }
  }
#endif
