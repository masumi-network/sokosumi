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
    organizationId: String? = "org_1",
    isSelfDirect: Bool = false,
    isReadOnly: Bool = false,
    groupName: String? = nil,
    members: [Components.Schemas.ChatRoomUserParticipant] = [],
    coworkers: [Components.Schemas.ChatRoomCoworkerParticipant] = [],
    sokoBots: [Components.Schemas.ChatRoomSokoBotParticipant] = []
  ) -> Components.Schemas.ChatRoom {
    .init(
      id: "550e8400-e29b-41d4-a716-446655440031", organizationId: organizationId,
      name: name, kind: kind, isSelfDirect: isSelfDirect, isGroupDirect: members.count > 2, isReadOnly: isReadOnly, groupName: groupName,
      topic: topic, discoverability: kind == .channel ? discoverability : nil, createdByUserId: "user_ada",
      createdAt: created, updatedAt: created, unreadCount: 0, unreadMentionCount: 0, markedUnread: false,
      myAccess: .init(value1: access, value2: .init(stringLiteral: access.rawValue)), userMembers: members, formerUserMembers: [], coworkerMembers: coworkers, sokoBotMembers: sokoBots
    )
  }

  private static func header(_ room: Components.Schemas.ChatRoom, isOwnerOrAdmin: Bool = false) -> RoomHeaderIdentity {
    RoomHeaderIdentity(room: room, currentUserId: reader, isOwnerOrAdmin: isOwnerOrAdmin)
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
    let header = Self.header(Self.room(topic: "Weekly launch planning", discoverability: example.0))
    #expect(header == .init(mark: .channel(example.1), title: "launch", topic: "Weekly launch planning", titleAction: .members))
  }

  @Test func aGuestSeesTheHostChannelsGlyphAndTopic() {
    let room = Self.room(topic: "Shared with Acme", discoverability: .external, access: .guest)
    #expect(Self.header(room) == .init(mark: .channel(.globe), title: "launch", topic: "Shared with Acme", titleAction: .members))
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
    #expect(Self.header(Self.room(topic: example.0)).topic == example.1)
  }

  /// Web `RoomHeaderChrome` (`room-header-chrome.tsx`:183-216) draws a Self Direct's `DirectRoomAvatarStack`, the
  /// reader's own face, and names it "You" (row 27c).
  @Test func aSelfDirectDrawsTheReadersFaceAndIsYou() {
    let room = Self.room(kind: .direct, name: "self", topic: "Ignored", isSelfDirect: true, members: [Self.person(Self.reader, "Me")])
    let face = DirectRoomAvatarParticipant(id: Self.reader, name: "Me", imageURL: nil, presence: .offline)
    #expect(Self.header(room) == .init(mark: .selfDirect(face), title: "You", topic: nil, titleAction: nil))
  }

  @Test func aDirectDrawsTheMessageGlyphAndNeverATopic() {
    let ada = Self.person("user_ada", "Ada")
    let rooms = [
      Self.room(kind: .direct, name: "dm", topic: "Ignored", members: [Self.person(Self.reader, "Me"), ada]),
      Self.room(kind: .direct, name: "group", groupName: "Launch crew",
                members: [Self.person(Self.reader, "Me"), ada, Self.person("user_grace", "Grace")]),
      Self.room(kind: .direct, name: "assistant", members: [Self.person(Self.reader, "Me")],
                sokoBots: [.init(id: "bot_1", name: "Soko", caption: nil, image: nil, avatarSeed: nil, ownerUserId: "user_1", presence: .online)]),
      Self.room(kind: .direct, name: "coworker", topic: "Ignored", members: [Self.person(Self.reader, "Me")],
                coworkers: [.init(id: "cow_1", name: "Helper", slug: "helper", caption: nil, image: nil, presence: .online)])
    ]
    #expect(rooms.map { Self.header($0) } == [
      .init(mark: .direct, title: "Ada", topic: nil, titleAction: nil),
      .init(mark: .direct, title: "Launch crew", topic: nil, titleAction: .nameGroup),
      .init(mark: .direct, title: "Soko", topic: nil, titleAction: nil),
      .init(mark: .direct, title: "Helper", topic: nil, titleAction: nil)
    ])
  }

  /// Row 31c: a Channel's name opens its settings for an organization owner or admin who is a host member of a
  /// non-matched organization Channel (`canManageChannelSettings`, `channel-member-permissions.ts`:19-34) and the
  /// members panel for everyone else (`room-header-chrome.tsx`:220-253, `rooms-client.tsx`:1062-1064).
  struct Viewer: Sendable {
    let discoverability: Components.Schemas.ChatRoom.DiscoverabilityPayload
    let access: Components.Schemas.ChatRoomAccess
    let isOwnerOrAdmin: Bool
    let opens: RoomHeaderIdentity.TitleAction
  }

  @Test(arguments: [
    Viewer(discoverability: ._public, access: .member, isOwnerOrAdmin: true, opens: .channelSettings),
    Viewer(discoverability: ._private, access: .member, isOwnerOrAdmin: true, opens: .channelSettings),
    Viewer(discoverability: .external, access: .member, isOwnerOrAdmin: true, opens: .channelSettings),
    Viewer(discoverability: ._public, access: .member, isOwnerOrAdmin: false, opens: .members),
    Viewer(discoverability: .external, access: .member, isOwnerOrAdmin: false, opens: .members),
    Viewer(discoverability: .external, access: .guest, isOwnerOrAdmin: true, opens: .members),
    Viewer(discoverability: .external, access: .guest, isOwnerOrAdmin: false, opens: .members),
    Viewer(discoverability: .matched, access: .member, isOwnerOrAdmin: true, opens: .members),
    Viewer(discoverability: .matched, access: .member, isOwnerOrAdmin: false, opens: .members)
  ])
  func aChannelsNameOpensSettingsForAnOwnerOrAdminAndMembersForEveryoneElse(viewer: Viewer) {
    let room = Self.room(discoverability: viewer.discoverability, access: viewer.access)
    #expect(Self.header(room, isOwnerOrAdmin: viewer.isOwnerOrAdmin).titleAction == viewer.opens)
  }

  /// A Channel outside an organization manages nothing, so even an owner's name opens the members panel.
  @Test func aChannelWithoutAnOrganizationOpensMembers() {
    #expect(Self.header(Self.room(organizationId: nil), isOwnerOrAdmin: true).titleAction == .members)
  }

  /// Web wraps only a group Direct's name, in the rename button any member may use (`room-header-chrome.tsx`:193-208;
  /// Core's PATCH takes a Group name from any member and does not refuse a Read-only Direct); every other Direct's
  /// name is plain text (:209-215). The reader's role changes nothing for a Direct.
  @Test(arguments: [false, true])
  func onlyAGroupDirectsNameOpensTheRename(isOwnerOrAdmin: Bool) {
    let myself = Self.person(Self.reader, "Me")
    let ada = Self.person("user_ada", "Ada")
    let grace = Self.person("user_grace", "Grace")
    let rooms = [
      Self.room(kind: .direct, name: "dm", members: [myself, ada]),
      Self.room(kind: .direct, name: "dm", isReadOnly: true, members: [myself, ada]),
      Self.room(kind: .direct, name: "self", isSelfDirect: true, members: [myself]),
      Self.room(kind: .direct, name: "group", members: [myself, ada, grace]),
      Self.room(kind: .direct, name: "group", isReadOnly: true, members: [myself, ada, grace]),
      Self.room(kind: .direct, name: "assistant", members: [myself],
                sokoBots: [.init(id: "bot_1", name: "Soko", caption: nil, image: nil, avatarSeed: nil, ownerUserId: Self.reader, presence: .online)]),
      Self.room(kind: .direct, name: "coworker", members: [myself],
                coworkers: [.init(id: "cow_1", name: "Helper", slug: "helper", caption: nil, image: nil, presence: .online)])
    ]
    #expect(rooms.map { Self.header($0, isOwnerOrAdmin: isOwnerOrAdmin).titleAction } == [
      nil, nil, nil, .nameGroup, .nameGroup, nil, nil
    ])
  }
}
