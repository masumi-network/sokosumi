import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct ChannelLifecycleTests {
  private func member(_ id: String, _ access: Components.Schemas.ChatRoomAccess?) throws -> Components.Schemas.ChatRoomUserParticipant {
    try .init(id: id, name: id, email: "\(id)@example.com", presence: .online, access: access.map { try .init(value1: $0, value2: .init(unvalidatedValue: $0.rawValue)) })
  }

  private func room(
    id: String = "room",
    name: String = "Team",
    kind: Components.Schemas.ChatRoom.KindPayload = .channel,
    access: Components.Schemas.ChatRoomAccess = .member,
    discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public,
    members: [Components.Schemas.ChatRoomUserParticipant] = []
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: id, organizationId: "org", name: name, slug: id, kind: kind, isSelfDirect: false, isGroupDirect: false, topic: nil, discoverability: discoverability,
      createdByUserId: "me", createdAt: .distantPast, updatedAt: .distantPast, unreadCount: 0, unreadMentionCount: 0,
      markedUnread: false, myAccess: access, userMembers: members, coworkerMembers: [], sokoBotMembers: []
    )
  }

  @Test func leaveAndArchiveMatchWebRoomsClient() throws {
    let hosts = try [member("me", .member), member("peer", .member)]
    #expect(ChannelEditPermissions.canLeave(room(members: hosts)))
    // The last host member keeps the channel; a guest does not count as a host.
    #expect(try !ChannelEditPermissions.canLeave(room(members: [member("me", .member), member("guest", .guest)])))
    #expect(try !ChannelEditPermissions.canLeave(room(members: [member("me", nil), member("peer", nil)])))
    #expect(try ChannelEditPermissions.canLeave(room(access: .guest, members: [member("me", .guest)])))
    #expect(try ChannelEditPermissions.canLeave(room(discoverability: .matched, members: [member("me", .member)])))
    #expect(!ChannelEditPermissions.canLeave(room(kind: .direct, members: hosts)))
    #expect(ChannelEditPermissions(canEditMembers: true, canManageSettings: true).canArchive)
    #expect(!ChannelEditPermissions(canEditMembers: true, canManageSettings: false).canArchive)
  }

  @Test func archivedListSortsFailsSoftAndIgnoresStaleLoads() async {
    let model = ArchivedChannels()
    await model.load { .init(rooms: [room(id: "z", name: "zeta"), room(id: "a", name: "Älpha"), room(id: "b", name: "beta")], canDelete: true) }
    #expect(model.rooms.map(\.id) == ["a", "b", "z"])
    #expect(model.canDelete)
    await model.load { throw URLError(.notConnectedToInternet) }
    #expect(model.rooms.map(\.id) == ["a", "b", "z"])

    // A local restore/archive during a load wins over the older response.
    await model.load {
      model.remove(roomId: "a")
      model.insert(room(id: "c", name: "Gamma"))
      return .init(rooms: [room(id: "a", name: "Älpha")], canDelete: false)
    }
    #expect(model.rooms.map(\.id) == ["b", "c", "z"])
    #expect(model.canDelete)
    model.reset()
    #expect(model.rooms.isEmpty && !model.canDelete)
  }

  /// Row 32b2: a failed role read still lists the rows. Web's first render turns it into no Delete, and its later
  /// archived reads never touch the gate, so a later failed read keeps whatever the gate was.
  @Test func aFailedRoleReadListsTheRowsAndLeavesTheDeleteGate() async {
    let model = ArchivedChannels()
    await model.load { .init(rooms: [room(id: "b", name: "beta"), room(id: "a", name: "alpha")], canDelete: false, roleLoadFailed: true) }
    #expect(model.rooms.map(\.id) == ["a", "b"])
    #expect(!model.canDelete)

    // A later read that knows the role brings Delete back; a failed one after it leaves Delete in place.
    await model.load { .init(rooms: [room(id: "a", name: "alpha")], canDelete: true) }
    #expect(model.canDelete)
    await model.load { .init(rooms: [room(id: "c", name: "gamma")], canDelete: false, roleLoadFailed: true) }
    #expect(model.rooms.map(\.id) == ["c"])
    #expect(model.canDelete)

    // A workspace switch starts the gate over.
    model.reset()
    await model.load { .init(rooms: [room(id: "c", name: "gamma")], canDelete: false, roleLoadFailed: true) }
    #expect(model.rooms.map(\.id) == ["c"] && !model.canDelete)
  }
}
