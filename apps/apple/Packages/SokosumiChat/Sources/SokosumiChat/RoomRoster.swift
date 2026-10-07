import CoreAPI
import Foundation

/// Presentation of the members already supplied by the room endpoint.
public struct RoomRosterMember: Identifiable, Sendable {
  public let profile: ChatParticipantProfile
  public let subtitle: String?
  /// When this member last read the room, for their row to state (row 31b2); nil keeps the row silent.
  public let lastReadAt: Date?
  public var id: DirectRecipient {
    profile.id
  }
}

/// The Members inspector's sections in the order a reader scans them (row 31b2; web `groupRosterMembers` and
/// `RoomRosterPanel`): people who have read, people who have not, guests, then Coworkers and Soko Bots.
public struct RoomRosterGroups: Sendable {
  /// Host members: the viewer first, then everyone with a Room last-read, most recent first, equal marks in name
  /// order. A guest viewer is told nothing about reading, so for them every host member lands here by name.
  public let people: [RoomRosterMember]
  /// Host members who have never opened the room, by name; one "Not read yet" subheading says it for them all.
  public let neverRead: [RoomRosterMember]
  /// External guests by name, the viewer first when they are one.
  public let guests: [RoomRosterMember]
  /// Coworkers, then Soko Bots, each by name. They carry no read state and none is invented for them.
  public let agents: [RoomRosterMember]

  /// Every host member on the roster, read or not: the People heading answers how big the room is.
  public var peopleCount: Int {
    people.count + neverRead.count
  }

  /// The headings name the kinds only once two kinds are on the roster; a room of people alone needs none.
  public var showsHeadings: Bool {
    [peopleCount, guests.count, agents.count].count { $0 > 0 } > 1
  }

  /// Web's `RoomRoster.empty` shows only when the room lists nobody at all.
  public var isEmpty: Bool {
    peopleCount + guests.count + agents.count == 0
  }
}

public enum RoomRoster {
  public static func isAvailable(in room: Components.Schemas.ChatRoom) -> Bool {
    room.kind != .direct || room.userMembers.count + room.coworkerMembers.count > 2
  }

  /// The roster grouped for the Members inspector, its read state from `receipts` (the room's payload marks with
  /// the live `chat_room_read` marks on top, as Seen by reads them).
  public static func groups(
    in room: Components.Schemas.ChatRoom, currentUserId: String, receipts: RoomReadReceipts
  ) -> RoomRosterGroups {
    var viewer: RoomRosterMember?
    var marked: [RoomRosterMember] = []
    var neverRead: [RoomRosterMember] = []
    var guests: [RoomRosterMember] = []
    let humans = room.userMembers.compactMap { user -> (user: Components.Schemas.ChatRoomUserParticipant, member: RoomRosterMember)? in
      member(user, lastReadAt: receipts.readState(for: user.id)?.lastReadAt).map { (user, $0) }
    }
    for (user, member) in humans.sorted(by: { ordered($0.member, $1.member) }) {
      if user.access == .guest {
        if user.id == currentUserId {
          guests.insert(member, at: 0)
        } else {
          guests.append(member)
        }
      } else if user.id == currentUserId {
        // The viewer stays first whatever their own mark says: theirs is the one row a reader can always place.
        viewer = member
      } else if receipts.readState(for: user.id) == .unread {
        neverRead.append(member)
      } else {
        marked.append(member)
      }
    }
    return RoomRosterGroups(people: (viewer.map { [$0] } ?? []) + byReadRecency(marked), neverRead: neverRead,
                            guests: guests, agents: agents(in: room))
  }

  /// Web's stable `orderRosterByReadRecency`: most recent first, equal marks and silent rows (a guest viewer's whole
  /// list) keep name order, silent rows after every mark.
  private static func byReadRecency(_ members: [RoomRosterMember]) -> [RoomRosterMember] {
    members.enumerated().sorted { left, right in
      switch (left.element.lastReadAt, right.element.lastReadAt) {
      case let (left?, right?) where left != right: left > right
      case (nil, _?): false
      case (_?, nil): true
      default: left.offset < right.offset
      }
    }.map(\.element)
  }

  /// Coworkers, then Soko Bots, each by name.
  private static func agents(in room: Components.Schemas.ChatRoom) -> [RoomRosterMember] {
    let coworkers = room.coworkerMembers.compactMap { coworker -> RoomRosterMember? in
      guard let profile = ChatParticipantProfile(sender: .case2(.init(_type: .coworker, coworker: coworker))) else { return nil }
      return RoomRosterMember(profile: profile, subtitle: coworker.slug.isEmpty ? nil : "@" + coworker.slug, lastReadAt: nil)
    }
    let assistants = room.sokoBotMembers.compactMap { bot -> RoomRosterMember? in
      guard let profile = ChatParticipantProfile(sender: .case3(.init(_type: .sokoBot, sokoBot: bot))) else { return nil }
      return RoomRosterMember(profile: profile, subtitle: bot.caption, lastReadAt: nil)
    }
    return coworkers.sorted(by: ordered) + assistants.sorted(by: ordered)
  }

  private static func member(_ user: Components.Schemas.ChatRoomUserParticipant, lastReadAt: Date?) -> RoomRosterMember? {
    guard let profile = ChatParticipantProfile(sender: .case1(.init(_type: .user, user: user))) else { return nil }
    return RoomRosterMember(profile: profile, subtitle: user.email, lastReadAt: lastReadAt)
  }

  private static func ordered(_ left: RoomRosterMember, _ right: RoomRosterMember) -> Bool {
    let comparison = left.profile.name.localizedCompare(right.profile.name)
    if comparison != .orderedSame {
      return comparison == .orderedAscending
    }
    return identifier(left.id) < identifier(right.id)
  }

  private static func identifier(_ recipient: DirectRecipient) -> String {
    switch recipient {
    case let .human(id), let .coworker(id), let .sokoBot(id): id
    }
  }
}
