import CoreAPI
import Foundation

/// A link to one room message.
public struct ChatMessageLink: Equatable, Sendable {
  public let roomId: String
  public let messageId: String
}

/// The Message link a paste may become a quote of: exactly one link to a room
/// message on the configured web origin. A link inside longer text stays plain.
public func pastedMessageLink(_ pasted: String, webBaseURL: URL) -> ChatMessageLink? {
  let text = pasted.trimmingCharacters(in: .whitespacesAndNewlines)
  guard !text.isEmpty, !text.contains(where: \.isWhitespace), let url = URL(string: text),
        case let .room(roomId, messageId) = ChatLink(url: url, webBaseURL: webBaseURL), let messageId else { return nil }
  return ChatMessageLink(roomId: roomId, messageId: messageId)
}

/// A room message may be quoted into another room only when every human reader
/// of the target room can also read the source room, so the snippet never
/// reaches someone who cannot follow the Message link. The sender's Self Direct
/// passes because its only reader is the sender, who reads the source room.
public func canQuoteIntoRoom(targetMemberUserIds: [String], sourceMemberUserIds: [String]) -> Bool {
  let readers = Set(sourceMemberUserIds)
  return targetMemberUserIds.allSatisfy(readers.contains)
}

/// The quote a pasted Message link may be sent as in `targetRoom`, or nil when
/// it must stay a plain link. Core applies the same rule at send time; this only
/// decides whether the composer converts the paste.
///
/// `allowCrossRoom` is false where the send path only takes same-room quotes:
/// the coworker 1:1 stream.
public func messageLinkQuote(
  _ link: ChatMessageLink,
  targetRoom: Components.Schemas.ChatRoom,
  rooms: [Components.Schemas.ChatRoom],
  allowCrossRoom: Bool,
  loadMessage: @Sendable (String, String) async -> Components.Schemas.ChatRoomMessage?
) async -> Components.Schemas.ChatRoomMessageQuote? {
  let sourceRoomId = link.roomId
  let isCrossRoom = sourceRoomId != targetRoom.id
  if isCrossRoom {
    guard allowCrossRoom, let source = rooms.first(where: { $0.id == sourceRoomId }),
          canQuoteIntoRoom(targetMemberUserIds: targetRoom.userMembers.map(\.id),
                           sourceMemberUserIds: source.userMembers.map(\.id)) else { return nil }
  }
  guard let message = await loadMessage(sourceRoomId, link.messageId), var quote = messageQuote(from: message) else { return nil }
  if isCrossRoom {
    quote.roomId = sourceRoomId
  }
  return quote
}
