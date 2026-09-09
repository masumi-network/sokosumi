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
  public var content: String
  public var createdAt: Date
  public var status: OutboundDeliveryStatus
  public var errorMessage: String?
  public var sender: Components.Schemas.ChatRoomUserParticipant

  public init(
    clientTurnId: String,
    roomId: String,
    content: String,
    createdAt: Date = Date(),
    status: OutboundDeliveryStatus = .pending,
    errorMessage: String? = nil,
    sender: Components.Schemas.ChatRoomUserParticipant
  ) {
    self.clientTurnId = clientTurnId
    self.roomId = roomId
    self.content = content
    self.createdAt = createdAt
    self.status = status
    self.errorMessage = errorMessage
    self.sender = sender
  }
}

/// Single-flight slot for one room composer. Failed (and confirmed) frees
/// it; a second begin while occupied is a no-op.
public struct ClassicOutboundFlight: Equatable, Sendable {
  public private(set) var clientMessageId: String?

  public init() {}

  public var isInFlight: Bool {
    clientMessageId != nil
  }

  /// Occupies the slot. Returns false when a send is already in flight.
  public mutating func begin(_ clientMessageId: String) -> Bool {
    guard self.clientMessageId == nil else { return false }
    self.clientMessageId = clientMessageId
    return true
  }

  public mutating func end(_ clientMessageId: String) {
    if self.clientMessageId == clientMessageId {
      self.clientMessageId = nil
    }
  }

  public mutating func clear() {
    clientMessageId = nil
  }
}

public func outboundLocalMessageId(_ clientTurnId: String) -> String {
  outboundLocalIdPrefix + clientTurnId
}

public func isOutboundLocalMessage(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
  message.id.hasPrefix(outboundLocalIdPrefix)
}

public func displayedTranscript(
  messages: [Components.Schemas.ChatRoomMessage],
  shells: [OutboundShell]
) -> [Components.Schemas.ChatRoomMessage] {
  messages + shells.map(chatRoomMessage(from:))
}

public func chatRoomMessage(from shell: OutboundShell) -> Components.Schemas.ChatRoomMessage {
  let turnId = try? OpenAPIValueContainer(unvalidatedValue: shell.clientTurnId)
  return .init(
    id: shell.id,
    roomId: shell.roomId,
    parentMessageId: nil,
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
    quote: nil,
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
  if let index = messages.firstIndex(where: { $0.id == confirmed.id }) {
    var next = messages
    next[index] = confirmed
    return (next, remaining)
  }
  return (messages + [confirmed], remaining)
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
