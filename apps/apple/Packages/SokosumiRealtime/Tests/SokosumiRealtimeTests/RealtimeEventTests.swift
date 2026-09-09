import CoreAPI
import Foundation
import SokosumiChat
import SokosumiRealtime
import Testing

private let roomId = "550e8400-e29b-41d4-a716-446655440800"
private let messageId = "550e8400-e29b-41d4-a716-446655440801"

private func messageDict(
  id: String = messageId,
  roomId: String = roomId,
  content: String = "hello",
  createdAt: String = "2026-01-01T00:00:00.000Z"
) -> [String: Any] {
  [
    "id": id,
    "roomId": roomId,
    "parentMessageId": NSNull(),
    "content": content,
    "createdAt": createdAt,
    "deletedAt": NSNull(),
    "editedAt": NSNull(),
    "sender": [
      "type": "user",
      "user": ["id": "user_2", "name": "Ada", "email": "ada@example.com", "presence": "offline"]
    ],
    "mentions": [],
    "reactions": [],
    "threadReplyCount": 0,
    "threadLastReplyAt": NSNull(),
    "metadata": NSNull(),
    "quote": NSNull(),
    "membership": NSNull(),
    "unfurls": NSNull()
  ]
}

struct RealtimeEventTests {
  @Test func fullCreateResolvesWithDecodedMessage() {
    let event = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)",
      event: "chat_room_message",
      data: ["eventType": "create", "message": messageDict()]
    )
    guard case let .message(resolvedRoomId, resolvedType, message) = event else {
      Issue.record("expected message, got \(event)")
      return
    }
    #expect(resolvedRoomId == roomId)
    #expect(resolvedType == .create)
    #expect(message.id == messageId)
    #expect(message.content == "hello")
    #expect(messageSenderName(message.sender) == "Ada")
  }

  @Test func fullCreateFromAblyNSDictionaryResolves() throws {
    let data = try JSONSerialization.jsonObject(
      with: JSONSerialization.data(withJSONObject: [
        "eventType": "create",
        "message": messageDict()
      ])
    )
    #expect(data is NSDictionary)
    let event = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)",
      event: "chat_room_message",
      data: data
    )
    guard case let .message(resolvedRoomId, resolvedType, message) = event else {
      Issue.record("expected message, got \(event)")
      return
    }
    #expect(resolvedRoomId == roomId)
    #expect(resolvedType == .create)
    #expect(message.id == messageId)
    #expect(message.content == "hello")
  }

  @Test func fullDeleteResolves() {
    let event = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)",
      event: "chat_room_message",
      data: ["eventType": "delete", "message": messageDict()]
    )
    guard case let .message(_, resolvedType, message) = event else {
      Issue.record("expected message, got \(event)")
      return
    }
    #expect(resolvedType == .delete)
    #expect(message.id == messageId)
  }

  @Test func plainDatesWithoutFractionalSecondsDecode() {
    let event = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)",
      event: "chat_room_message",
      data: ["eventType": "create", "message": messageDict(createdAt: "2026-01-01T00:00:00Z")]
    )
    guard case let .message(_, _, message) = event else {
      Issue.record("expected message, got \(event)")
      return
    }
    #expect(message.content == "hello")
  }

  @Test func idEnvelopeResolves() {
    let event = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)",
      event: "chat_room_message",
      data: ["eventType": "create", "messageId": "m-oversize", "roomId": roomId, "parentMessageId": NSNull()]
    )
    guard case let .envelope(envelope) = event else {
      Issue.record("expected envelope, got \(event)")
      return
    }
    #expect(envelope.eventType == .create)
    #expect(envelope.messageId == "m-oversize")
    #expect(envelope.roomId == roomId)
    #expect(envelope.parentMessageId == nil)
  }

  @Test func revokeResolves() {
    let event = resolveRealtimeDelivery(
      channel: "chat_control:user_user_1",
      event: "chat_membership_revoked",
      data: ["roomId": roomId, "reason": "removed", "at": "2026-01-01T00:00:00.000Z"]
    )
    guard case let .revoked(revokedRoomId) = event else {
      Issue.record("expected revoked, got \(event)")
      return
    }
    #expect(revokedRoomId == roomId)
  }

  @Test func garbageIsIgnored() {
    #expect(resolveRealtimeDelivery(channel: "chat_rooms:room_\(roomId)", event: "chat_room_message", data: NSNull())
      .isIgnored)
    #expect(resolveRealtimeDelivery(channel: "chat_rooms:room_\(roomId)", event: "other_event", data: ["a": 1])
      .isIgnored)
    #expect(resolveRealtimeDelivery(channel: "presence:org_x", event: "chat_room_message", data: ["a": 1])
      .isIgnored)
    // Full DTO for another room than the channel: never cross-merge.
    #expect(resolveRealtimeDelivery(
      channel: "chat_rooms:room_other",
      event: "chat_room_message",
      data: ["eventType": "create", "message": messageDict()]
    ).isIgnored)
    // Revoke without a room id carries nothing to drop.
    #expect(resolveRealtimeDelivery(
      channel: "chat_control:user_user_1",
      event: "chat_membership_revoked",
      data: ["reason": "removed"]
    ).isIgnored)
  }

  @Test func tokenFieldsSerializeForAbly() {
    let fields = AblyTokenFields(
      keyName: "app.key",
      capability: "{\"chat_rooms:room_x\":[\"subscribe\"]}",
      clientId: "user_1:inst_1",
      timestampMillis: 1_704_067_200_000,
      nonce: "n",
      mac: "m"
    )
    guard let json = fields.jsonString else {
      Issue.record("expected token JSON")
      return
    }
    #expect(json.contains("\"keyName\":\"app.key\""))
    #expect(json.contains("\"clientId\":\"user_1:inst_1\""))
    #expect(json.contains("\"timestamp\":1704067200000"))
  }
}

private extension ResolvedRealtimeDelivery {
  var isIgnored: Bool {
    if case .ignored = self {
      return true
    }
    return false
  }
}
