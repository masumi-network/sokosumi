import CoreAPI
import Foundation
import SokosumiChat

/// What one Ably delivery means for the tracer (SOK-976). Pure data: the
/// transport resolves each delivery with `resolveRealtimeDelivery` and the
/// app applies it through `WorkspaceState.applyRealtime*`.
public enum ResolvedRealtimeDelivery: Sendable {
  case message(roomId: String, eventType: ChatRoomMessageRealtimeEventType, message: Components.Schemas.ChatRoomMessage)
  case envelope(ChatRoomMessageIdEnvelope)
  case patch(RealtimeMessagePatch)
  case pin(roomId: String, messageId: String, isPinned: Bool, count: Int)
  case roomHealth(roomId: String, healthy: Bool, continuityLost: Bool)
  case connectionHealth(healthy: Bool)
  case revoked(roomId: String)
  /// `chat_rooms_changed` on the user's control channel: these sidebar collections went stale (SOK-986).
  case roomsChanged(Set<ChatRoomCollection>)
  /// Full member set of one organization's presence channel (ADR 0003).
  case presenceRoster(organizationId: String, members: [ChatPresenceMember])
  /// A chat-kind row on the user notifications channel.
  case notification(ChatNotificationEvent)
  /// A Typing event on the watched room's typing channel, already bound to its sender (ADR 0033).
  case typing(roomId: String, signal: ChatTypingSignal)
  /// The watched room's typing channel is subscribed, and may or may not be published to. Nil: the
  /// token does not grant it or could not be minted, so the room shows nobody.
  case typingChannel(roomId: String, canPublish: Bool?)
  /// A member's Room last-read moved (row 31b1, web `useChatRoomRealtime`'s `onRoomRead`).
  case roomRead(ChatRoomReadEvent)
  case ignored

  /// Shared Ably payloads do not carry a meaningful viewer reaction flag.
  /// Match web by deriving it from the listed reactors; REST remains authoritative
  /// when the viewer falls outside Core's capped reactor list.
  public func personalized(for userId: String) -> Self {
    switch self {
    case let .message(roomId, eventType, message):
      var message = message
      message.reactions = personalize(message.reactions, userId: userId)
      return .message(roomId: roomId, eventType: eventType, message: message)
    case let .patch(patch):
      guard case let .reactions(reactions) = patch.value else { return self }
      return .patch(.init(roomId: patch.roomId, messageId: patch.messageId,
                          parentMessageId: patch.parentMessageId,
                          value: .reactions(personalize(reactions, userId: userId))))
    default: return self
    }
  }
}

private func personalize(
  _ reactions: [Components.Schemas.ChatRoomMessageReaction], userId: String
) -> [Components.Schemas.ChatRoomMessageReaction] {
  reactions.map { reaction in
    var reaction = reaction
    reaction.reactedByCurrentUser = reaction.reactors.contains { $0.id == userId }
    return reaction
  }
}

/// Sort one Ably message delivery into its meaning. Room payloads decode
/// through the same `ChatRoomMessage` shape history renders; anything
/// unparseable, for another room, or for push (out of scope) is ignored —
/// the transcript only moves on proof, never on hope. Presence arrives
/// through `OrgPresenceChannel` and Typing through `RoomTypingChannel`, not here.
func resolveRealtimeDelivery(channel: String, event eventName: String, data: Any) -> ResolvedRealtimeDelivery {
  if let named = resolveNamedDelivery(channel: channel, event: eventName, data: data) {
    return named
  }
  guard eventName == chatRoomMessageEventName,
        let roomId = parseChatRoomId(fromChannelName: channel),
        let dict = data as? [String: Any],
        let eventTypeRaw = dict["eventType"] as? String
  else {
    return .ignored
  }
  if ["reaction", "unfurl", "mention_status"].contains(eventTypeRaw) {
    return resolvePatch(dict, roomId: roomId, eventType: eventTypeRaw)
  }
  guard let eventType = ChatRoomMessageRealtimeEventType(rawValue: eventTypeRaw) else { return .ignored }
  if let messageDict = dict["message"] as? [String: Any] {
    guard let message = decodeRealtimeMessage(messageDict), message.roomId == roomId else {
      return .ignored
    }
    return .message(roomId: roomId, eventType: eventType, message: message)
  }
  guard let messageId = dict["messageId"] as? String, !messageId.isEmpty else {
    return .ignored
  }
  return .envelope(.init(
    eventType: eventType,
    messageId: messageId,
    roomId: roomId,
    parentMessageId: dict["parentMessageId"] as? String
  ))
}

/// Pins, read receipts, notifications, membership revokes and rooms changed: events identified by name alone. Nil for every
/// other event.
private func resolveNamedDelivery(channel: String, event eventName: String, data: Any) -> ResolvedRealtimeDelivery? {
  if eventName == chatRoomReadEventName {
    // Web's `chatRoomReadEventDataSchema` (its `lastReadAt` is `z.iso.datetime()`), and the room must be the channel's own.
    guard let roomId = parseChatRoomId(fromChannelName: channel),
          let dict = data as? [String: Any], dict["roomId"] as? String == roomId,
          let userId = dict["userId"] as? String, !userId.isEmpty,
          let sentAt = dict["lastReadAt"] as? String, isZodISODateTime(sentAt),
          let lastReadAt = realtimeDate(from: sentAt) else { return .ignored }
    return .roomRead(ChatRoomReadEvent(roomId: roomId, userId: userId, lastReadAt: lastReadAt))
  }
  if eventName == chatRoomPinnedMessageEventName {
    guard let roomId = parseChatRoomId(fromChannelName: channel),
          let pin = decodeRealtimeValue(data, as: PinEvent.self),
          pin.roomId == roomId, !pin.messageId.isEmpty, pin.pinnedMessageCount >= 0 else { return .ignored }
    return .pin(roomId: roomId, messageId: pin.messageId, isPinned: pin.action == .pin, count: pin.pinnedMessageCount)
  }
  if eventName == notificationCreatedEventName {
    guard channel.hasPrefix("notifications:"), let notification = ChatNotificationEvent(payload: data) else { return .ignored }
    return .notification(notification)
  }
  if eventName == chatMembershipRevokedEventName {
    guard channel.hasPrefix("chat_control:user_"),
          let dict = data as? [String: Any],
          let roomId = dict["roomId"] as? String,
          !roomId.isEmpty
    else {
      return .ignored
    }
    return .revoked(roomId: roomId)
  }
  if eventName == chatRoomsChangedEventName {
    guard channel.hasPrefix("chat_control:user_"), let collections = parseRoomsChanged(data) else { return .ignored }
    return .roomsChanged(collections)
  }
  return nil
}

/// Web `chatRoomsChangedEventSchema`: one or more known collections, a non-empty room id or null, and an ISO time.
/// One unknown collection rejects the whole event, as on web.
private func parseRoomsChanged(_ data: Any) -> Set<ChatRoomCollection>? {
  guard let dict = data as? [String: Any],
        let names = dict["collections"] as? [String], !names.isEmpty,
        dict["roomId"] is NSNull || (dict["roomId"] as? String)?.isEmpty == false,
        let sentAt = dict["at"] as? String, isZodISODateTime(sentAt)
  else { return nil }
  let collections = names.compactMap(ChatRoomCollection.init(rawValue:))
  return collections.count == names.count ? Set(collections) : nil
}

/// zod 4.6.5 `z.iso.datetime()` with its defaults (`regexes.datetime`, no offset, no local time, any precision): a real
/// Gregorian date, `T`, `hh:mm:ss`, optional fraction, then `Z` and nothing else. ASCII digits only, as in JavaScript.
private func isZodISODateTime(_ value: String) -> Bool {
  let leapDay = "(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29"
  let otherDay = "[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|02-(?:0[1-9]|1[0-9]|2[0-8]))"
  let time = "(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\\.[0-9]+)?Z"
  guard let pattern = try? Regex("(?:\(leapDay)|\(otherDay))T\(time)") else { return false }
  return value.wholeMatch(of: pattern) != nil
}

private struct PinEvent: Decodable {
  enum Action: String, Decodable { case pin, unpin }
  let action: Action
  let roomId: String
  let messageId: String
  let pinnedMessageCount: Int
}

func decodeRealtimeMessage(_ dict: [String: Any]) -> Components.Schemas.ChatRoomMessage? {
  decodeRealtimeValue(dict, as: Components.Schemas.ChatRoomMessage.self)
}

private func decodeRealtimeValue<Value: Decodable>(_ object: Any, as _: Value.Type) -> Value? {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.fragmentsAllowed]) else {
    return nil
  }
  // Per-call decoder: Ably subscribe callbacks can run concurrently, and
  // `JSONDecoder` is not thread-safe. Date formatters are already per-call.
  let decoder = JSONDecoder()
  decoder.dateDecodingStrategy = .custom { inner in
    let string = try inner.singleValueContainer().decode(String.self)
    if let date = realtimeDate(from: string) {
      return date
    }
    throw DecodingError.dataCorrupted(
      .init(codingPath: inner.codingPath, debugDescription: "Not an ISO-8601 date: \(string)")
    )
  }
  return try? decoder.decode(Value.self, from: data)
}

private func resolvePatch(_ dict: [String: Any], roomId: String, eventType: String) -> ResolvedRealtimeDelivery {
  guard dict["roomId"] as? String == roomId,
        let messageId = dict["messageId"] as? String, !messageId.isEmpty,
        let patch = dict["patch"] as? [String: Any],
        dict["parentMessageId"] is NSNull || dict["parentMessageId"] is String else { return .ignored }
  let value: RealtimeMessagePatch.Value
  switch eventType {
  case "reaction":
    guard let raw = patch["reactions"],
          let values = decodeRealtimeValue(raw, as: [Components.Schemas.ChatRoomMessageReaction].self) else { return .ignored }
    value = .reactions(values)
  case "mention_status":
    guard let raw = patch["mentions"],
          let values = decodeRealtimeValue(raw, as: [Components.Schemas.ChatRoomMessageMention].self) else { return .ignored }
    value = .mentions(values)
  case "unfurl":
    guard let raw = patch["unfurls"] else { return .ignored }
    if raw is NSNull {
      value = .unfurls(nil)
    } else {
      guard let values = decodeRealtimeValue(raw, as: [Components.Schemas.ChatRoomMessageUnfurl].self),
            values.count <= 3 else { return .ignored }
      value = .unfurls(values)
    }
  default: return .ignored
  }
  return .patch(.init(roomId: roomId, messageId: messageId,
                      parentMessageId: dict["parentMessageId"] as? String, value: value))
}

private func realtimeDate(from string: String) -> Date? {
  let fractional = ISO8601DateFormatter()
  fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = fractional.date(from: string) {
    return date
  }
  let plain = ISO8601DateFormatter()
  plain.formatOptions = [.withInternetDateTime]
  return plain.date(from: string)
}
