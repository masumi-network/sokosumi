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
  @Test(arguments: ["viewer", "other"])
  func fullMessagesAndReactionPatchesPersonalizeForViewer(_ viewer: String) throws {
    let reactions: [[String: Any]] = [["emoji": "👍", "count": 1,
                                       "reactedByCurrentUser": false,
                                       "reactors": [["id": "viewer", "name": "Viewer"]]]]
    var original = messageDict()
    original["reactions"] = reactions
    let full = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)", event: "chat_room_message",
      data: ["eventType": "create", "message": original]
    ).personalized(for: viewer)
    let patched = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)", event: "chat_room_message",
      data: ["eventType": "reaction", "roomId": roomId, "messageId": messageId,
             "parentMessageId": NSNull(), "patch": ["reactions": reactions]]
    ).personalized(for: viewer)
    guard case let .message(_, _, message) = full,
          case let .patch(patch) = patched,
          case let .reactions(values) = patch.value else {
      Issue.record("Expected full message and reaction patch")
      return
    }
    #expect(try #require(message.reactions.first).reactedByCurrentUser == (viewer == "viewer"))
    #expect(values == message.reactions)
    #expect(message.content == "hello")
    #expect(values.first?.count == 1)
  }

  @Test(arguments: ["pin", "unpin"])
  func pinEventsValidateChannelAndCount(action: String) {
    let payload: [String: Any] = ["action": action, "roomId": roomId, "messageId": messageId, "pinnedMessageCount": 2]
    guard case let .pin(actualRoom, actualMessage, isPinned, count) = resolveRealtimeDelivery(
      channel: chatRoomChannelName(roomId: roomId), event: chatRoomPinnedMessageEventName, data: payload
    ) else { Issue.record("Expected pin event")
      return
    }
    #expect(actualRoom == roomId)
    #expect(actualMessage == messageId)
    #expect(isPinned == (action == "pin"))
    #expect(count == 2)
    for invalid in [
      payload.merging(["roomId": "foreign"], uniquingKeysWith: { _, new in new }),
      payload.merging(["messageId": ""], uniquingKeysWith: { _, new in new }),
      payload.merging(["action": "other"], uniquingKeysWith: { _, new in new }),
      payload.merging(["pinnedMessageCount": -1], uniquingKeysWith: { _, new in new }),
      payload.merging(["pinnedMessageCount": 1.5], uniquingKeysWith: { _, new in new }),
      payload.merging(["pinnedMessageCount": true], uniquingKeysWith: { _, new in new })
    ] {
      guard case .ignored = resolveRealtimeDelivery(channel: chatRoomChannelName(roomId: roomId),
                                                    event: chatRoomPinnedMessageEventName, data: invalid)
      else { Issue.record("Accepted invalid pin event")
        continue
      }
    }
  }

  @MainActor @Test func pinOverridesAreRoomScopedAndResetWithHistory() {
    let timeline = RoomTimeline()
    timeline.reset(roomId: roomId)
    timeline.applyPin(roomId: roomId, messageId: messageId, isPinned: true)
    timeline.applyPin(roomId: "foreign", messageId: messageId, isPinned: false)
    #expect(timeline.pinOverrides[messageId] == true)
    timeline.applyPin(roomId: roomId, messageId: messageId, isPinned: false)
    #expect(timeline.pinOverrides[messageId] == false)
    timeline.reset(roomId: roomId)
    #expect(timeline.pinOverrides.isEmpty)
  }

  @Test(arguments: ["reaction", "mention_status", "unfurl"])
  func fieldPatchesPreserveMessageBodyAndIdentity(_ type: String) {
    let field = type == "reaction" ? "reactions" : type == "mention_status" ? "mentions" : "unfurls"
    var original = messageDict()
    original["reactions"] = [["emoji": "👍", "count": 1, "reactedByCurrentUser": false, "reactors": []]]
    original["mentions"] = [["id": messageId, "coworkerId": "coworker", "sokoBotId": NSNull(),
                             "status": "pending", "responseMessageId": NSNull()]]
    original["unfurls"] = [["url": "https://example.com", "title": "Example", "description": NSNull(),
                            "imageUrl": NSNull(), "siteName": NSNull()]]
    let event = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)", event: "chat_room_message",
      data: ["eventType": type, "roomId": roomId, "messageId": messageId,
             "parentMessageId": NSNull(), "patch": [field: []]]
    )
    guard case let .patch(patch) = event,
          case let .message(_, _, message) = resolveRealtimeDelivery(
            channel: "chat_rooms:room_\(roomId)", event: "chat_room_message",
            data: ["eventType": "create", "message": original]
          ) else { Issue.record("Expected typed patch and message")
      return
    }
    let result = applyRealtimePatch(patch, messages: [message])
    #expect(result.count == 1)
    #expect(result[0].id == message.id)
    #expect(result[0].content == message.content)
    #expect(result[0].createdAt == message.createdAt)
    #expect(result[0].sender == message.sender)
    #expect(result[0].reactions == (type == "reaction" ? [] : message.reactions))
    #expect(result[0].mentions == (type == "mention_status" ? [] : message.mentions))
    #expect(result[0].unfurls == (type == "unfurl" ? [] : message.unfurls))
    #expect(applyRealtimePatch(patch, messages: []).isEmpty)
    var foreign = message
    foreign.roomId = "another-room"
    #expect(applyRealtimePatch(patch, messages: [foreign]) == [foreign])
    let reply = RealtimeMessagePatch(roomId: roomId, messageId: messageId,
                                     parentMessageId: "parent", value: patch.value)
    #expect(applyRealtimePatch(reply, messages: [message]) == [message])
  }

  @Test func nullableUnfurlsAreAnExplicitPatch() {
    let event = resolveRealtimeDelivery(
      channel: "chat_rooms:room_\(roomId)", event: "chat_room_message",
      data: ["eventType": "unfurl", "roomId": roomId, "messageId": messageId,
             "parentMessageId": NSNull(), "patch": ["unfurls": NSNull()]]
    )
    guard case let .patch(patch) = event, case .unfurls(nil) = patch.value else {
      Issue.record("Expected explicit null unfurls")
      return
    }
  }

  @Test func malformedAndForeignPatchesAreIgnored() {
    let payloads: [[String: Any]] = [
      ["eventType": "reaction", "roomId": "foreign", "messageId": messageId,
       "parentMessageId": NSNull(), "patch": ["reactions": []]],
      ["eventType": "reaction", "roomId": roomId, "messageId": messageId,
       "parentMessageId": NSNull(), "patch": ["reactions": "invalid"]],
      ["eventType": "unfurl", "roomId": roomId, "messageId": messageId,
       "parentMessageId": NSNull(), "patch": [:]],
      ["eventType": "mention_status", "roomId": roomId, "messageId": messageId,
       "parentMessageId": 12, "patch": ["mentions": []]]
    ]
    for payload in payloads {
      guard case .ignored = resolveRealtimeDelivery(
        channel: "chat_rooms:room_\(roomId)", event: "chat_room_message", data: payload
      ) else { Issue.record("Accepted malformed patch")
        continue
      }
    }
  }

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
