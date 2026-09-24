import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

@MainActor
struct GuestAccessTests {
  private func room(access: Components.Schemas.ChatRoomAccess = .member, discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = .external,
                    kind: Components.Schemas.ChatRoom.KindPayload = .channel) throws -> Components.Schemas.ChatRoom {
    try .init(
      id: "room", organizationId: "org", name: "Partners", slug: "partners", kind: kind, isSelfDirect: false, isGroupDirect: false, topic: nil,
      discoverability: discoverability, createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast,
      unreadCount: 0, unreadMentionCount: 0, markedUnread: false, myAccess: access,
      userMembers: [
        .init(id: "me", name: "Me", email: "me@example.com", presence: .online, access: .init(value1: .member, value2: .init(unvalidatedValue: "member"))),
        .init(id: "guest", name: "Guest", email: "guest@example.com", presence: .offline, access: .init(value1: .guest, value2: .init(unvalidatedValue: "guest"))),
        .init(id: "peer", name: "Peer", email: "peer@example.com", presence: .afk)
      ],
      coworkerMembers: [], sokoBotMembers: []
    )
  }

  private func invitation(id: String, status: Components.Schemas.ChatRoomInvitationStatus = .pending) -> Components.Schemas.ChatRoomInvitation {
    .init(id: id, roomId: "room", roomName: "Partners", organizationId: "org", organizationName: "Acme", email: "\(id)@example.com", status: status,
          inviter: .init(id: "me", name: "Me"), expiresAt: .distantFuture, createdAt: .distantPast)
  }

  private func link(token: String, revokedAt: Date? = nil, maxUses: Int? = nil, useCount: Int = 0) -> Components.Schemas.ChatRoomGuestInviteLink {
    .init(token: token, url: "https://app.sokosumi.com/chat/join/\(token)", roomId: "room", createdAt: .distantPast, expiresAt: nil,
          revokedAt: revokedAt, maxUses: maxUses, useCount: useCount)
  }

  @Test func inviteGateMatchesWebRoomsClient() throws {
    #expect(try ChannelEditPermissions.canInviteGuests(room()))
    #expect(try !ChannelEditPermissions.canInviteGuests(room(access: .guest)))
    #expect(try !ChannelEditPermissions.canInviteGuests(room(discoverability: ._private)))
    #expect(try !ChannelEditPermissions.canInviteGuests(room(discoverability: ._public)))
    #expect(try !ChannelEditPermissions.canInviteGuests(room(discoverability: .matched)))
    #expect(try !ChannelEditPermissions.canInviteGuests(room(discoverability: .external, kind: .direct)))
  }

  @Test func emailValidationFollowsZod() {
    #expect(isValidGuestEmail("guest@example.com"))
    #expect(isValidGuestEmail("first.last+tag@sub.example.co"))
    for invalid in ["", "guest", "guest@", "@example.com", "guest@example", ".guest@example.com", "gu..est@example.com", "guest@-example.com", "guest @example.com"] {
      #expect(!isValidGuestEmail(invalid), "\(invalid)")
    }
  }

  @Test func usageSummaryMatchesWebMeta() {
    #expect(link(token: "a", maxUses: 10, useCount: 3).usageSummary == "3 / 10 uses")
    #expect(link(token: "b", useCount: 1).usageSummary == "1 use · unlimited")
    #expect(link(token: "c", useCount: 4).usageSummary == "4 uses · unlimited")
  }

  @Test func loadKeepsPendingInvitationsAndLiveLinksAndFailsSoftly() async throws {
    let model = try GuestAccess(room: room())
    #expect(model.guests.map(\.id) == ["guest"])
    #expect(model.linkOptions == GuestInviteLinkOptions(expiresInDays: 7, maxUses: nil))
    await model.load {
      GuestAccessSnapshot(invitations: [invitation(id: "a"), invitation(id: "b", status: .accepted)], links: [link(token: "live"), link(token: "gone", revokedAt: .distantPast)])
    }
    #expect(model.invitations.map(\.id) == ["a"] && model.links.map(\.token) == ["live"])
    #expect(!model.loading && !model.loadFailed)

    await model.load { throw URLError(.timedOut) }
    #expect(model.loadFailed && model.invitations.isEmpty && model.links.isEmpty && !model.loading)

    // A local revoke during a load wins over the older response.
    await model.load {
      await model.revokeInvitation("a") { _ in }
      return GuestAccessSnapshot(invitations: [invitation(id: "a")], links: [])
    }
    #expect(model.invitations.isEmpty && !model.loadFailed)
  }

  @Test func inviteValidatesNormalizesPrependsAndSurfacesCoreMessage() async throws {
    let model = try GuestAccess(room: room())
    #expect(!model.canSendInvite)
    model.email = "not-an-email"
    let invalid = await model.invite { _ in
      Issue.record("Invalid addresses never reach Core")
      return invitation(id: "x")
    }
    #expect(!invalid && model.errorMessage == "Enter a valid email address.")

    model.email = "  New.Guest@Example.com "
    var sent: [String] = []
    var sendingWhileCalled = false
    let first = await model.invite { address in
      sent.append(address)
      sendingWhileCalled = model.sendingInvite
      return invitation(id: "new")
    }
    #expect(first && sendingWhileCalled && sent == ["new.guest@example.com"])
    #expect(model.email.isEmpty && model.errorMessage == nil && !model.sendingInvite)
    #expect(model.invitations.map(\.id) == ["new"])

    model.email = "new.guest@example.com"
    let repeated = await model.invite { _ in invitation(id: "new") }
    #expect(repeated && model.invitations.map(\.id) == ["new"])

    model.email = "dup@example.com"
    let refused = await model.invite { _ in throw ChatServiceError.unprocessable(statusCode: 409, message: "A pending invitation already exists for this email in this room.") }
    #expect(!refused && model.errorMessage == "A pending invitation already exists for this email in this room.")
    #expect(model.email == "dup@example.com")
  }

  @Test func rowActionsAreSingleFlightAndDropRowsOnSuccess() async throws {
    let model = try GuestAccess(room: room())
    await model.load { GuestAccessSnapshot(invitations: [invitation(id: "a"), invitation(id: "b")], links: [link(token: "one"), link(token: "two")]) }

    var revoked: [String] = []
    var busy: [String?] = []
    await model.revokeInvitation("a") { id in
      revoked.append(id)
      busy.append(model.revokingInvitationId)
      await model.revokeInvitation("b") { _ in Issue.record("Second revoke while one runs") }
    }
    #expect(revoked == ["a"] && busy == ["a"] && model.invitations.map(\.id) == ["b"] && model.revokingInvitationId == nil)
    await model.revokeInvitation("b") { _ in throw ChatServiceError.unprocessable(statusCode: 404, message: "Invitation not found") }
    #expect(model.invitations.map(\.id) == ["b"] && model.errorMessage == "Invitation not found")

    var revokedTokens: [String] = []
    await model.revokeLink("one") { token in
      revokedTokens.append(token)
      busy.append(model.revokingLinkToken)
      await model.revokeLink("two") { _ in Issue.record("Second link revoke while one runs") }
    }
    #expect(revokedTokens == ["one"] && busy == ["a", "one"] && model.links.map(\.token) == ["two"] && model.revokingLinkToken == nil)

    var removed: [String] = []
    await model.removeGuest("guest") { userId in
      removed.append(userId)
      busy.append(model.removingGuestId)
      return false
    }
    #expect(removed == ["guest"] && busy == ["a", "one", "guest"])
    #expect(model.guests.map(\.id) == ["guest"] && model.errorMessage == "Couldn’t remove the guest. Try again.", "A refused mutation keeps the guest")
    await model.removeGuest("guest") { _ in true }
    #expect(model.guests.isEmpty && model.removingGuestId == nil && model.errorMessage == nil)
  }

  @Test func createLinkSendsOptionsAndPrependsTheNewLink() async throws {
    let model = try GuestAccess(room: room())
    await model.load { GuestAccessSnapshot(invitations: [], links: [link(token: "old")]) }
    model.linkOptions = .init(expiresInDays: nil, maxUses: 25)
    var requested: [GuestInviteLinkOptions] = []
    var creatingWhileCalled = false
    let created = await model.createLink { options in
      requested.append(options)
      creatingWhileCalled = model.creatingLink
      return link(token: "new", maxUses: 25)
    }
    #expect(created?.token == "new" && creatingWhileCalled && requested == [.init(expiresInDays: nil, maxUses: 25)])
    #expect(model.links.map(\.token) == ["new", "old"] && !model.creatingLink)

    let failed = await model.createLink { _ in
      throw ChatServiceError.unprocessable(statusCode: 429, message: "This channel already has 20 active invite links. Revoke some before creating more.")
    }
    #expect(failed == nil && model.errorMessage?.hasPrefix("This channel already has") == true)
    #expect(model.links.map(\.token) == ["new", "old"])
  }
}
