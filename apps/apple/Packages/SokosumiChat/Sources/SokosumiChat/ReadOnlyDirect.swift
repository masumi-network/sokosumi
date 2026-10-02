import CoreAPI

/// Web `getFormerMemberNames`: a Direct's Former members by the name each is shown under.
public func formerMemberNames(_ room: Components.Schemas.ChatRoom) -> [String] {
  room.formerUserMembers.map { $0.name.isEmpty ? $0.email : $0.name }
}

/// Web `formatParticipantNameList` (`@sokosumi/utils`): up to three names, then "and N more".
func participantNameList(_ names: [String]) -> String {
  if names.count <= 3 {
    return names.joined(separator: ", ")
  }
  return "\(names.prefix(3).joined(separator: ", ")) and \(names.count - 3) more"
}

/// Web `useReadOnlyDirectNotice`: what a Read-only Direct says in place of its composers. Names who left, never the
/// room's Group name; nil while the room takes messages.
public enum ReadOnlyDirectNotice: Equatable, Sendable {
  /// `members` is the formatted list; `count` agrees the verb in German and Spanish.
  case named(members: String, count: Int)
  /// A deleted account leaves no profile to name.
  case unnamed

  public init?(room: Components.Schemas.ChatRoom?) {
    guard let room, room.isReadOnly else { return nil }
    let names = formerMemberNames(room)
    self = names.isEmpty ? .unnamed : .named(members: participantNameList(names), count: names.count)
  }
}

/// Whether the room takes new messages, uploads, Reactions and Quotes. Core refuses all of them in a Read-only Direct
/// (403); editing and deleting one's own messages still works.
public func roomTakesNewMessages(_ room: Components.Schemas.ChatRoom?) -> Bool {
  room?.isReadOnly != true
}

/// Web `canOpenThread` (#5649): a Read-only Direct takes no replies, so only a Thread that already has some opens.
public func canOpenThread(_ message: Components.Schemas.ChatRoomMessage, in room: Components.Schemas.ChatRoom?) -> Bool {
  roomTakesNewMessages(room) || message.threadReplyCount > 0
}
