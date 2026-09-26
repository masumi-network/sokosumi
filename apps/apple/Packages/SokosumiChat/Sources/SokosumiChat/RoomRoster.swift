import CoreAPI
import Foundation

/// Presentation of the members already supplied by the room endpoint.
public struct RoomRosterMember: Identifiable, Sendable {
  public let profile: ChatParticipantProfile
  public let subtitle: String?
  public var id: DirectRecipient {
    profile.id
  }
}

public enum RoomRoster {
  public static func isAvailable(in room: Components.Schemas.ChatRoom) -> Bool {
    room.kind != .direct || room.userMembers.count + room.coworkerMembers.count > 2
  }

  public static func members(in room: Components.Schemas.ChatRoom) -> [RoomRosterMember] {
    let humans = room.userMembers.compactMap { user -> RoomRosterMember? in
      guard let profile = ChatParticipantProfile(sender: .case1(.init(_type: .user, user: user))) else { return nil }
      return RoomRosterMember(profile: profile, subtitle: user.email)
    }
    let coworkers = room.coworkerMembers.compactMap { coworker -> RoomRosterMember? in
      guard let profile = ChatParticipantProfile(sender: .case2(.init(_type: .coworker, coworker: coworker))) else { return nil }
      return RoomRosterMember(profile: profile, subtitle: coworker.slug.isEmpty ? nil : "@" + coworker.slug)
    }
    let assistants = room.sokoBotMembers.compactMap { bot -> RoomRosterMember? in
      guard let profile = ChatParticipantProfile(sender: .case3(.init(_type: .sokoBot, sokoBot: bot))) else { return nil }
      return RoomRosterMember(profile: profile, subtitle: bot.caption)
    }
    return humans.sorted(by: ordered) + coworkers.sorted(by: ordered) + assistants.sorted(by: ordered)
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
