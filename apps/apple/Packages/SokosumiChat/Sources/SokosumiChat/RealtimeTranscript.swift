import CoreAPI
import Foundation

// Live `chat_room_message` application for the open room (SOK-976).
//
// Mirrors web `merge-room-messages` + `apply-chat-room-message-id-envelope`
// (ADR 0014), scoped to the tracer: top-level messages only (no threads UI),
// no reaction/unfurl/mention field patches. Full DTOs merge; an id envelope
// on the focused room refetches history instead of inventing a fake row.
// Own confirmed send and the Ably create dedupe to one bubble by client
// turn id (ADR 0004).

public enum ChatRoomMessageRealtimeEventType: String, Equatable, Sendable {
  case create
  case update
  case delete
}

/// Over-limit create/update/delete: identity only (ADR 0014). Never a row.
public struct ChatRoomMessageIdEnvelope: Equatable, Sendable {
  public var eventType: ChatRoomMessageRealtimeEventType
  public var messageId: String
  public var roomId: String
  public var parentMessageId: String?

  public init(
    eventType: ChatRoomMessageRealtimeEventType,
    messageId: String,
    roomId: String,
    parentMessageId: String? = nil
  ) {
    self.eventType = eventType
    self.messageId = messageId
    self.roomId = roomId
    self.parentMessageId = parentMessageId
  }
}

public enum ChatRoomMessageEnvelopeResolution: Equatable, Sendable {
  case ignore
  case needsRefetch
  case tombstone(messageId: String)
}

/// Decide how the focused room applies an id envelope (ADR 0014): other rooms
/// and thread replies are ignored (no threads UI, so parent `threadReplyCount`
/// stays until the next history load); delete tombstones by id because list
/// GET omits deleted rows; create/update refetch history.
public func resolveRealtimeEnvelope(
  _ envelope: ChatRoomMessageIdEnvelope,
  focusedRoomId: String?
) -> ChatRoomMessageEnvelopeResolution {
  guard envelope.roomId == focusedRoomId else { return .ignore }
  guard envelope.parentMessageId == nil else { return .ignore }
  if envelope.eventType == .delete {
    return .tombstone(messageId: envelope.messageId)
  }
  return .needsRefetch
}

/// In-place tombstone matching Core's mapped delete DTO and web
/// `tombstoneChatRoomMessage`: body cleared, `deletedAt` set, chrome
/// emptied. Identity, timestamps, sender, and thread counts stay.
public func tombstoneTranscriptMessage(
  _ message: Components.Schemas.ChatRoomMessage,
  now: Date = Date()
) -> Components.Schemas.ChatRoomMessage {
  .init(
    id: message.id,
    roomId: message.roomId,
    parentMessageId: message.parentMessageId,
    content: "",
    createdAt: message.createdAt,
    deletedAt: message.deletedAt ?? now,
    editedAt: nil,
    sender: message.sender,
    mentions: [],
    reactions: [],
    threadReplyCount: message.threadReplyCount,
    threadLastReplyAt: message.threadLastReplyAt,
    metadata: nil,
    quote: nil,
    membership: nil,
    unfurls: nil
  )
}

/// Client turn id on any transcript row: the `pending:` suffix for local
/// shells, else Core's `client_message_id` metadata. Nil when absent.
public func realtimeClientTurnId(_ message: Components.Schemas.ChatRoomMessage) -> String? {
  if isOutboundLocalMessage(message) {
    let raw = message.id.dropFirst(outboundLocalIdPrefix.count).trimmingCharacters(in: .whitespacesAndNewlines)
    return raw.isEmpty ? nil : String(raw)
  }
  guard let raw = message.metadata?.additionalProperties["client_message_id"]?.value as? String else {
    return nil
  }
  let turnId = raw.trimmingCharacters(in: .whitespacesAndNewlines)
  return turnId.isEmpty ? nil : turnId
}

/// Room-timeline scope: top-level only. Thread replies never enter the
/// transcript (mirrors web `mergeIntoRoomTimeline` — the tracer has no
/// thread panel).
public func isTopLevelRealtimeMessage(_ message: Components.Schemas.ChatRoomMessage) -> Bool {
  message.parentMessageId == nil
}

/// Apply one full-DTO create/update/delete to confirmed history.
/// Own send + Ably create confirm in place by turn id (one bubble, ADR 0004);
/// hard deletes (`deletedAt == nil`) remove the row; tombstoned deletes and
/// upserts merge with incoming winning, oldest first. Unresolved shells keep
/// trailing the confirmed block. Thread replies and local-only rows arriving
/// over the wire are ignored — never invented, never duplicated.
public func applyRealtimeFullEvent(
  messages: [Components.Schemas.ChatRoomMessage],
  shells: [OutboundShell],
  eventType: ChatRoomMessageRealtimeEventType,
  message: Components.Schemas.ChatRoomMessage
) -> (messages: [Components.Schemas.ChatRoomMessage], shells: [OutboundShell]) {
  guard isTopLevelRealtimeMessage(message), !isOutboundLocalMessage(message) else {
    return (messages, shells)
  }
  if let turnId = realtimeClientTurnId(message),
     shells.contains(where: { $0.clientTurnId == turnId }) {
    return confirmOutbound(messages: messages, shells: shells, confirmed: message, clientTurnId: turnId)
  }
  if eventType == .delete, message.deletedAt == nil {
    return (messages.filter { $0.id != message.id }, shells)
  }
  var next = messages
  if let index = next.firstIndex(where: { $0.id == message.id }) {
    next[index] = message
  } else {
    next.append(message)
  }
  next.sort {
    if $0.createdAt != $1.createdAt {
      return $0.createdAt < $1.createdAt
    }
    return $0.id < $1.id
  }
  return (next, shells)
}

/// Tombstone the on-screen row for a delete id envelope (ADR 0014).
/// Missing id leaves history unchanged — envelopes never invent rows and
/// list GET omits deleted rows, so there is nothing to drop.
public func applyRealtimeTombstone(
  messages: [Components.Schemas.ChatRoomMessage],
  messageId: String,
  now: Date = Date()
) -> [Components.Schemas.ChatRoomMessage] {
  guard messages.contains(where: { $0.id == messageId }) else { return messages }
  return messages.map { $0.id == messageId ? tombstoneTranscriptMessage($0, now: now) : $0 }
}

/// Merge a refetched history page (envelope refetch, ADR 0014): incoming
/// rows win by id, oldest first. Rows missing from the page stay — merge
/// never drops ids the list GET omits. Local-only rows never come over the
/// wire, so they cannot leak in here.
public func mergeRealtimePage(
  messages: [Components.Schemas.ChatRoomMessage],
  page: [Components.Schemas.ChatRoomMessage]
) -> [Components.Schemas.ChatRoomMessage] {
  var byId = Dictionary(uniqueKeysWithValues: messages.map { ($0.id, $0) })
  for row in page where !isOutboundLocalMessage(row) {
    byId[row.id] = row
  }
  return byId.values.sorted {
    if $0.createdAt != $1.createdAt {
      return $0.createdAt < $1.createdAt
    }
    return $0.id < $1.id
  }
}

/// Drop a revoked room from the sidebar list (SOK-742). Returns the rooms
/// without it and the selection with it cleared when it was selected.
public func applyMembershipRevoked(
  rooms: [Components.Schemas.ChatRoom],
  selectedRoomId: String?,
  revokedRoomId: String
) -> (rooms: [Components.Schemas.ChatRoom], selectedRoomId: String?) {
  let next = rooms.filter { $0.id != revokedRoomId }
  let selection = selectedRoomId == revokedRoomId ? nil : selectedRoomId
  return (next, selection)
}
