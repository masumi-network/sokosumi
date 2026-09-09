import CoreAPI
import Foundation
import SokosumiChat

/// What one Ably delivery means for the tracer (SOK-976). Pure data: the
/// transport resolves each delivery with `resolveRealtimeDelivery` and the
/// app applies it through `WorkspaceState.applyRealtime*`.
public enum ResolvedRealtimeDelivery: Sendable {
  case message(roomId: String, eventType: ChatRoomMessageRealtimeEventType, message: Components.Schemas.ChatRoomMessage)
  case envelope(ChatRoomMessageIdEnvelope)
  case revoked(roomId: String)
  case ignored
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
        let eventTypeRaw = dict["eventType"] as? String,
        let eventType = ChatRoomMessageRealtimeEventType(rawValue: eventTypeRaw)
  else {
    return .ignored
  }
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

func decodeRealtimeMessage(_ dict: [String: Any]) -> Components.Schemas.ChatRoomMessage? {
  guard let data = try? JSONSerialization.data(withJSONObject: dict) else {
    return nil
  }
  return try? realtimeMessageDecoder.decode(Components.Schemas.ChatRoomMessage.self, from: data)
}

/// Core dates are ISO-8601 with or without fractional seconds — the same
/// range the OpenAPI client accepts on history. Formatters are built per
/// decode: `ISO8601DateFormatter` is not `Sendable`-safe to share.
private let realtimeMessageDecoder: JSONDecoder = {
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
  return decoder
}()

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
