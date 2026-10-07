#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  extension NativeWindowTests {
    @MainActor struct GuestAccessSectionTests {
      private func externalRoom() -> Components.Schemas.ChatRoom {
        Components.Schemas.ChatRoom(
          id: "fixture", organizationId: "org", name: "Partners", slug: "partners", kind: .channel, isSelfDirect: false, isGroupDirect: false, isReadOnly: false,
          discoverability: .external, createdByUserId: "me",
          createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
          markedUnread: false, myAccess: .init(value1: .member, value2: "member"),
          userMembers: [.init(id: "me", name: "Alex Morgan", email: "alex@example.com", presence: .online, access: .member),
                        .init(id: "guest", name: "Priya Natarajan", email: "priya@agency-partners-worldwide.example", presence: .offline, access: .guest)],
          formerUserMembers: [], coworkerMembers: [.init(id: "agent", name: "Research assistant", slug: "research", caption: nil, image: nil, presence: .online)],
          sokoBotMembers: []
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

      /// The members panel's Add picker on an External channel (SOK-1258): it opens on the organization tab, loads the
      /// roster once and lists only people and agents outside the Channel; the guest tab stays unloaded until chosen.
      @Test(arguments: [false, true])
      func rendersAddPickerWithNonMembersOnly(dark: Bool) async throws {
        let room = externalRoom()
        let model = ChannelMemberAddition(room: room)
        var loads = 0
        let content = AddChannelMembersView(room: room, currentUserId: "me", model: model, load: {
          loads += 1
          return ChatRecipientRoster(targets: [
            .init(id: .human("me"), name: "Alex Morgan", detail: "alex@example.com"),
            .init(id: .human("peer"), name: "Sam Rivera", detail: "sam@example.com"),
            .init(id: .coworker("agent"), name: "Research assistant"),
            .init(id: .coworker("writer"), name: "Copywriter"),
            .init(id: .sokoBot("bot"), name: "Personal assistant")
          ])
        }, add: { _ in
          Issue.record("Rendering must not add")
          return false
        }, guestAccess: .unused)
          .background(.background)
          .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: host.fittingSize), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        _ = try await waitForView(in: host, timeoutMessage: "The roster load never settled") {
          loads > 0 && !model.loading ? host : nil
        }
        #expect(loads == 1)
        #expect(model.sections.flatMap(\.targets).map(\.id) == [.human("peer"), .coworker("writer"), .sokoBot("bot")])
        #expect(!model.canAdd)
        window.setContentSize(host.fittingSize)
        host.layoutSubtreeIfNeeded()
        #expect(host.fittingSize.width == 480, "\(host.fittingSize)")
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        if let lines = try CreateChannelGuidanceTests.recognizedLines(in: bitmap) {
          let text = lines.joined(separator: " ")
          #expect(["Add members", "your personal assistants to Partners.", "From your organization"].allSatisfy(text.contains), "Vision read \(lines)")
        }
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: "add-members-\(dark ? "dark" : "light").png")
      }

      /// The section alone, loaded, at sheet width: long addresses and URLs truncate in the middle and the link meta
      /// line follows web's copy. Current Guests live in the members panel, not here.
      @Test(arguments: [false, true])
      func rendersLoadedSection(dark: Bool) async throws {
        let room = externalRoom()
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
        #expect(model.invitations.count == 1 && model.links.count == 2 && !model.loading)
      }
    }
  }

  extension GuestAccessActions {
    /// The organization tab never mounts the guest section, so none of these may run.
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
      })
    }
  }
#endif
