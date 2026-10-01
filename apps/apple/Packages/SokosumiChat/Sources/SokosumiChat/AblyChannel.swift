import Foundation

/// Ably channel + event names for chat realtime (SOK-976).
///
/// Mirrors `@sokosumi/utils` (`ably-channel.ts`, `chat-membership-revoked.ts`,
/// `chat-rooms-changed.ts`) and web `use-chat-room-realtime`: room fan-out on
/// `chat_rooms:room_{id}`, membership revoke and sidebar collection
/// invalidation on `chat_control:user_{id}`.
/// Org presence channel names live in `ChatPresence.swift` (ADR 0003);
/// push is never activated (ADR 0022 / 0023).
public let chatRoomMessageEventName = "chat_room_message"
public let chatRoomPinnedMessageEventName = "chat_room_pinned_message"
public let chatMembershipRevokedEventName = "chat_membership_revoked"
public let chatRoomsChangedEventName = "chat_rooms_changed"

/// Shared room-scoped channel for `chat_room_message` fan-out.
public func chatRoomChannelName(roomId: String) -> String {
  "chat_rooms:room_\(roomId)"
}

/// Per-user chat control channel (membership revoke and rooms changed, always granted).
public func userChatControlChannelName(userId: String) -> String {
  "chat_control:user_\(userId)"
}

/// Inverse of `chatRoomChannelName`. Nil for non-room channels.
public func parseChatRoomId(fromChannelName channelName: String) -> String? {
  let prefix = "chat_rooms:room_"
  guard channelName.hasPrefix(prefix) else { return nil }
  let roomId = String(channelName.dropFirst(prefix.count))
  return roomId.isEmpty ? nil : roomId
}
