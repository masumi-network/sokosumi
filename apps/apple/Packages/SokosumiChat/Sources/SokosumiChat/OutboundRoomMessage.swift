import CoreAPI
import Foundation
import OpenAPIRuntime

/// Local-only row id: `pending:{clientTurnId}`. Never a server message id.
public let outboundLocalIdPrefix = "pending:"

/// Sender-local outbound delivery status on a pending shell (ADR 0004).
public enum OutboundDeliveryStatus: String, Equatable, Sendable {
  case pending
  case failed
}

/// In-memory classic send that has not been confirmed by Core. Remount
/// drops these — there is no durable outbox.
public struct OutboundShell: Equatable, Sendable, Identifiable {
  public var id: String {
    outboundLocalMessageId(clientTurnId)
  }

  public var clientTurnId: String
  public var roomId: String
  public var parentMessageId: String?
  public var quote: Components.Schemas.ChatRoomMessageQuote?
  public var content: String
  public var createdAt: Date
  public var status: OutboundDeliveryStatus
  public var errorMessage: String?
  public var sender: Components.Schemas.ChatRoomUserParticipant

  public init(
    clientTurnId: String,
    roomId: String,
    parentMessageId: String? = nil,
    content: String,
    quote: Components.Schemas.ChatRoomMessageQuote? = nil,
    createdAt: Date = Date(),
    status: OutboundDeliveryStatus = .pending,
    errorMessage: String? = nil,
    sender: Components.Schemas.ChatRoomUserParticipant
  ) {
    self.clientTurnId = clientTurnId
    self.roomId = roomId
    self.parentMessageId = parentMessageId
    self.content = content
    self.quote = quote
    self.createdAt = createdAt
    self.status = status
    self.errorMessage = errorMessage
    self.sender = sender
  }
}

public func outboundLocalMessageId(_ clientTurnId: String) -> String {
  outboundLocalIdPrefix + clientTurnId
}

public func isOutboundLocalMessage(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
  message.id.hasPrefix(outboundLocalIdPrefix)
}

/// Stored replies in a thread column. A pending shell or stream overlay is not one: Core 404s a mute
/// read until a reply is stored, and swapping the shell for that row does not change the displayed count.
public func liveThreadReplyCount(_ messages: [Components.Schemas.ChatRoomMessage]) -> Int {
  messages.count(where: { message in
    message.parentMessageId != nil && !isOutboundLocalMessage(message) && !message.id.hasPrefix("stream:")
  })
}

/// Web's `shouldKeepPersistedMessage` (merge-room-messages.ts): a persisted row
/// stays in a transcript only with a visible body, a quote, a membership
/// status, or as a coworker mention shell. Core blanks all of these on delete,
/// so a deleted message leaves the room transcript and thread replies, and so
/// does a bodiless Soko Bot shell. State keeps the row; only display drops it,
/// so realtime patches and reply counts keep addressing it. A thread root is
/// not filtered and keeps its "This message was deleted" tombstone.
public func shouldKeepPersistedMessage(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
  message.membership != nil
    || !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    || message.quote != nil
    || CoworkerMentionShell(message: message) != nil
}

/// Persisted rows the transcript shows (`shouldKeepPersistedMessage`), then the local outbound shells.
public func displayedTranscript(
  messages: [Components.Schemas.ChatRoomMessage],
  shells: [OutboundShell]
) -> [Components.Schemas.ChatRoomMessage] {
  messages.filter(shouldKeepPersistedMessage) + shells.map(chatRoomMessage(from:))
}

public func chatRoomMessage(from shell: OutboundShell) -> Components.Schemas.ChatRoomMessage {
  let turnId = try? OpenAPIValueContainer(unvalidatedValue: shell.clientTurnId)
  return .init(
    id: shell.id,
    roomId: shell.roomId,
    parentMessageId: shell.parentMessageId,
    content: shell.content,
    createdAt: shell.createdAt,
    deletedAt: nil,
    editedAt: nil,
    sender: .case1(.init(_type: .user, user: shell.sender)),
    mentions: [],
    reactions: [],
    threadReplyCount: 0,
    threadLastReplyAt: nil,
    metadata: turnId.map { .init(additionalProperties: ["client_message_id": $0]) },
    quote: shell.quote,
    membership: nil,
    unfurls: nil
  )
}

/// Replace the matching pending shell with the confirmed server row. Unresolved
/// shells stay after the confirmed block (ADR 0004).
public func confirmOutbound(
  messages: [Components.Schemas.ChatRoomMessage],
  shells: [OutboundShell],
  confirmed: Components.Schemas.ChatRoomMessage,
  clientTurnId: String
) -> (messages: [Components.Schemas.ChatRoomMessage], shells: [OutboundShell]) {
  let remaining = shells.filter { $0.clientTurnId != clientTurnId }
  var next = messages
  if let index = next.firstIndex(where: { $0.id == confirmed.id }) {
    next[index] = confirmed
  } else {
    next.append(confirmed)
  }
  next.sort {
    if $0.createdAt != $1.createdAt {
      return $0.createdAt < $1.createdAt
    }
    return $0.id < $1.id
  }
  return (next, remaining)
}

public func failOutbound(
  shells: [OutboundShell],
  clientTurnId: String,
  errorMessage: String?
) -> [OutboundShell] {
  shells.map { shell in
    guard shell.clientTurnId == clientTurnId else { return shell }
    var failed = shell
    failed.status = .failed
    failed.errorMessage = errorMessage
    return failed
  }
}

public func markOutboundPending(
  shells: [OutboundShell],
  clientTurnId: String
) -> [OutboundShell] {
  shells.map { shell in
    guard shell.clientTurnId == clientTurnId else { return shell }
    var pending = shell
    pending.status = .pending
    pending.errorMessage = nil
    return pending
  }
}

public func removeOutbound(
  shells: [OutboundShell],
  clientTurnId: String
) -> [OutboundShell] {
  shells.filter { $0.clientTurnId != clientTurnId }
}
