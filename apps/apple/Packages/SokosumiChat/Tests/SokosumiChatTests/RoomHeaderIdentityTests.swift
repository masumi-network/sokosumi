import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

/// Row 31a: web's room header (`room-header-chrome.tsx`) and its one glyph rule (`channelKindIcon`).
struct RoomHeaderIdentityTests {
  private static let created = Date(timeIntervalSince1970: 1_790_000_000)
  private static let reader = "user_reader"

  private static func person(_ id: String, _ name: String) -> Components.Schemas.ChatRoomUserParticipant {
    .init(id: id, name: name, email: "\(id)@example.com", image: nil, presence: .offline)
  }

  private static func room(
    kind: Components.Schemas.ChatRoom.KindPayload = .channel,
    name: String = "launch",
    topic: String? = nil,
    discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload? = ._public,
    access: Components.Schemas.ChatRoomAccess = .member,
    isSelfDirect: Bool = false,
    groupName: String? = nil,
    members: [Components.Schemas.ChatRoomUserParticipant] = [],
    coworkers: [Components.Schemas.ChatRoomCoworkerParticipant] = [],
    sokoBots: [Components.Schemas.ChatRoomSokoBotParticipant] = []
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: "550e8400-e29b-41d4-a716-446655440031", organizationId: discoverability == .matched ? nil : "org_1",
      name: name, kind: kind, isSelfDirect: isSelfDirect, isGroupDirect: members.count > 2, groupName: groupName,
      topic: topic, discoverability: kind == .channel ? discoverability : nil, createdByUserId: "user_ada",
      createdAt: created, updatedAt: created, unreadCount: 0, unreadMentionCount: 0, markedUnread: false,
      myAccess: access, userMembers: members, coworkerMembers: coworkers, sokoBotMembers: sokoBots
    )
  }

  @Test(arguments: [
    (._public, .hash),
    (._private, .lock),
    (.external, .globe),
    (.matched, .globe),
    (nil, .hash)
  ] as [(Components.Schemas.ChatRoom.DiscoverabilityPayload?, ChannelMark)])
  func aRoomsDiscoverabilityPicksWebsGlyph(example: (Components.Schemas.ChatRoom.DiscoverabilityPayload?, ChannelMark)) {
    #expect(ChannelMark(example.0) == example.1)
  }

  /// Matched reads as External: it draws the globe, so it speaks the globe's name.
  @Test(arguments: [(ChannelMark.hash, "Public channel"), (.lock, "Private channel"), (.globe, "External channel")])
  func eachGlyphHasItsSpokenName(example: (ChannelMark, String)) {
    #expect(example.0.channelDescription == example.1)
  }

  @Test(arguments: [
    (Components.Schemas.DiscoverableChannelDiscoverability._public, ChannelMark.hash),
    (._private, .lock),
    (.external, .globe)
  ])
  func aBrowseRowPicksTheSameGlyph(example: (Components.Schemas.DiscoverableChannelDiscoverability, ChannelMark)) {
    #expect(ChannelMark(example.0) == example.1)
  }

  @Test(arguments: [
    (Components.Schemas.ChatRoom.DiscoverabilityPayload._public, ChannelMark.hash),
    (._private, .lock),
    (.external, .globe),
    (.matched, .globe)
  ])
  func aChannelHeaderDrawsItsGlyphNameAndTopic(example: (Components.Schemas.ChatRoom.DiscoverabilityPayload, ChannelMark)) {
    let header = RoomHeaderIdentity(room: Self.room(topic: "Weekly launch planning", discoverability: example.0), currentUserId: Self.reader)
    #expect(header == .init(mark: .channel(example.1), title: "launch", topic: "Weekly launch planning"))
  }

  @Test func aGuestSeesTheHostChannelsGlyphAndTopic() {
    let room = Self.room(topic: "Shared with Acme", discoverability: .external, access: .guest)
    #expect(RoomHeaderIdentity(room: room, currentUserId: Self.reader) == .init(mark: .channel(.globe), title: "launch", topic: "Shared with Acme"))
  }

  @Test(arguments: [
    (String?.none, String?.none),
    ("", nil),
    ("  \n\t ", nil),
    ("  Weekly launch  ", "Weekly launch"),
    ("Goals:\n- ship\r\n- tell\tpeople", "Goals: - ship - tell people"),
    ("Two  spaces\u{00A0}and a no-break space", "Two spaces\u{00A0}and a no-break space"),
    // ECMAScript `trim()`: U+FEFF is white space, U+0085 is neither white space nor a line terminator.
    ("\u{FEFF}", nil),
    ("\u{FEFF}  Weekly launch\u{3000}", "Weekly launch"),
    ("Weekly launch\u{0085}", "Weekly launch\u{0085}")
  ])
  func theTopicIsTrimmedFoldedToOneLineAndHiddenWhenBlank(example: (String?, String?)) {
    #expect(RoomHeaderIdentity(room: Self.room(topic: example.0), currentUserId: Self.reader).topic == example.1)
  }

  @Test func aDirectDrawsTheMessageGlyphAndNeverATopic() {
    let ada = Self.person("user_ada", "Ada")
    let rooms = [
      Self.room(kind: .direct, name: "dm", topic: "Ignored", members: [Self.person(Self.reader, "Me"), ada]),
      Self.room(kind: .direct, name: "self", isSelfDirect: true, members: [Self.person(Self.reader, "Me")]),
      Self.room(kind: .direct, name: "group", groupName: "Launch crew",
                members: [Self.person(Self.reader, "Me"), ada, Self.person("user_grace", "Grace")]),
      Self.room(kind: .direct, name: "assistant", members: [Self.person(Self.reader, "Me")],
                sokoBots: [.init(id: "bot_1", name: "Soko", caption: nil, image: nil, avatarSeed: nil, presence: .online)]),
      Self.room(kind: .direct, name: "coworker", topic: "Ignored", members: [Self.person(Self.reader, "Me")],
                coworkers: [.init(id: "cow_1", name: "Helper", slug: "helper", caption: nil, image: nil, presence: .online)])
    ]
    #expect(rooms.map { RoomHeaderIdentity(room: $0, currentUserId: Self.reader) } == [
      .init(mark: .direct, title: "Ada", topic: nil),
      .init(mark: .direct, title: "Me", topic: nil),
      .init(mark: .direct, title: "Launch crew", topic: nil),
      .init(mark: .direct, title: "Soko", topic: nil),
      .init(mark: .direct, title: "Helper", topic: nil)
    ])
  }
}
