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

/// Sendable copy of Core's Ably TokenRequest fields. The auth callback maps
/// these into `ARTTokenRequest.fromJson`, so this package never touches
/// transport errors or the OpenAPI client.
public struct AblyTokenFields: Equatable, Sendable {
  public var keyName: String
  public var capability: String
  public var clientId: String?
  public var timestampMillis: Int
  public var nonce: String
  public var mac: String
  public var ttlMillis: Int?

  public init(
    keyName: String,
    capability: String,
    clientId: String? = nil,
    timestampMillis: Int,
    nonce: String,
    mac: String,
    ttlMillis: Int? = nil
  ) {
    self.keyName = keyName
    self.capability = capability
    self.clientId = clientId
    self.timestampMillis = timestampMillis
    self.nonce = nonce
    self.mac = mac
    self.ttlMillis = ttlMillis
  }

  public init(_ token: Components.Schemas.AblyTokenRequest) {
    keyName = token.keyName
    capability = token.capability
    clientId = token.clientId
    timestampMillis = token.timestamp
    nonce = token.nonce
    mac = token.mac
    ttlMillis = token.ttl
  }

  /// Ably-standard JSON (timestamps and ttl in milliseconds) for
  /// `ARTTokenRequest.fromJson`.
  public var jsonString: String? {
    var dict: [String: Any] = [
      "keyName": keyName,
      "capability": capability,
      "timestamp": timestampMillis,
      "nonce": nonce,
      "mac": mac
    ]
    if let clientId {
      dict["clientId"] = clientId
    }
    if let ttlMillis {
      dict["ttl"] = ttlMillis
    }
    guard let data = try? JSONSerialization.data(withJSONObject: dict),
          let string = String(data: data, encoding: .utf8)
    else {
      return nil
    }
    return string
  }
}

/// Sort one Ably delivery into its meaning. Room payloads decode through the
/// same `ChatRoomMessage` shape history renders; anything unparseable, for
/// another room, or for presence/push (out of tracer scope) is ignored —
/// the transcript only moves on proof, never on hope.
public func resolveRealtimeDelivery(channel: String, event eventName: String, data: Any) -> ResolvedRealtimeDelivery {
  if eventName == chatRoomPinnedMessageEventName {
    guard let roomId = parseChatRoomId(fromChannelName: channel),
          let pin = decodeRealtimeValue(data, as: PinEvent.self),
          pin.roomId == roomId, !pin.messageId.isEmpty, pin.pinnedMessageCount >= 0 else { return .ignored }
    return .pin(roomId: roomId, messageId: pin.messageId, isPinned: pin.action == .pin, count: pin.pinnedMessageCount)
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
