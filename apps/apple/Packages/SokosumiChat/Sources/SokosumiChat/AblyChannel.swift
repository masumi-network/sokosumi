import Foundation

/// Ably channel + event names for chat realtime (SOK-976).
///
/// Mirrors `@sokosumi/utils` (`ably-channel.ts`, `chat-membership-revoked.ts`,
/// `chat-rooms-changed.ts`) and web `use-chat-room-realtime`: room fan-out on
/// `chat_rooms:room_{id}`, membership revoke and sidebar collection
/// invalidation on `chat_control:user_{id}`.
/// Org presence channel names live in `ChatPresence.swift` (ADR 0003);
/// push is never activated (ADR 0022 / 0023).
///
/// Core scopes every channel outside production
/// (`chat_rooms:preview:mainnet:branch_{ref}:room_{id}`,
/// `chat_rooms:development:mainnet:room_{id}`; ADR 0055), so channel names are
/// read from the token's capability rather than built.
public let chatRoomMessageEventName = "chat_room_message"
public let chatRoomPinnedMessageEventName = "chat_room_pinned_message"
public let chatMembershipRevokedEventName = "chat_membership_revoked"
public let chatRoomsChangedEventName = "chat_rooms_changed"
/// Room read receipt on the room channel (`@sokosumi/utils` `chat-room-read-event.ts`): one member's Room last-read moved.
public let chatRoomReadEventName = "chat_room_read"

private let chatRoomsNamespace = "chat_rooms"
private let chatControlNamespace = "chat_control"

/// Production room channel, for a token whose capability is missing or malformed.
public func chatRoomChannelName(roomId: String) -> String {
  "\(chatRoomsNamespace):room_\(roomId)"
}

/// Room id → channel name for every room channel the token may subscribe. Nil
/// when the capability is missing or malformed; empty for a valid token granting none.
public func chatRoomChannelNames(grantedSubscribeIn capability: String?) -> [String: String]? {
  grantedChannelIds(in: capability, namespace: chatRoomsNamespace, kind: "room", operation: "subscribe")
}

/// The per-user chat control channel (membership revoke and rooms changed) this
/// token may subscribe. Nil when the grant is missing: never attach on a guess.
public func userChatControlChannelName(grantedSubscribeIn capability: String?, userId: String) -> String? {
  guard !userId.isEmpty else { return nil }
  return grantedChannelIds(in: capability, namespace: chatControlNamespace, kind: "user", operation: "subscribe")?
    .first { $0.key == userId }?.value
}

/// True for a chat control channel of any deployment.
public func isUserChatControlChannel(_ channelName: String) -> Bool {
  realtimeChannelId(in: channelName, namespace: chatControlNamespace, kind: "user") != nil
}

/// Inverse of the room channel name, production or scoped. Nil for non-room channels.
public func parseChatRoomId(fromChannelName channelName: String) -> String? {
  realtimeChannelId(in: channelName, namespace: chatRoomsNamespace, kind: "room")
}

/// The id in a channel's last segment: `{namespace}:{kind}_{id}` in production,
/// `{namespace}:{scope…}:{kind}_{id}` elsewhere (ADR 0055). The scope never holds
/// a colon of its own (the Git ref is URL-encoded). Nil for another namespace or kind, or an empty id.
func realtimeChannelId(in channelName: String, namespace: String, kind: String) -> String? {
  guard channelName.hasPrefix(namespace + ":"),
        let last = channelName.split(separator: ":", omittingEmptySubsequences: false).last,
        last.hasPrefix(kind + "_") else { return nil }
  let id = last.dropFirst(kind.count + 1)
  return id.isEmpty ? nil : String(id)
}

/// The token's capability as channel → operations. Nil when missing or malformed.
/// Ably's `*` operation grants every operation.
func grantedChannelOperations(in capability: String?) -> [String: [String]]? {
  guard let capability, let data = capability.data(using: .utf8),
        let map = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
  return map.compactMapValues { ($0 as? [Any])?.compactMap { $0 as? String } }
}

/// Id → channel name for every `namespace` channel the token grants `operation` on.
/// Two names for one id (never issued) resolve to the smaller, so the answer is stable.
func grantedChannelIds(in capability: String?, namespace: String, kind: String, operation: String) -> [String: String]? {
  grantedChannelOperations(in: capability).map { map in
    var names: [String: String] = [:]
    for (channel, operations) in map where operations.contains(operation) || operations.contains("*") {
      guard let id = realtimeChannelId(in: channel, namespace: namespace, kind: kind) else { continue }
      names[id] = names[id].map { min($0, channel) } ?? channel
    }
    return names
  }
}
