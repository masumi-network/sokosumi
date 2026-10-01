import CoreAPI
import Foundation
import SokosumiChat
@testable import SokosumiRealtime
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

  @Test func chatNotificationResolvesOnlyOnTheNotificationsChannel() throws {
    let json = #"{"id":"n1","userId":"u1","kind":"CHAT","referenceId":"room_1","eventId":"m1","messageKey":"Notifications.Chat.directMessage","messageParams":{"authorName":"Ada"},"metadata":{"messageId":"m1","workspaceId":null},"isRead":false,"readAt":null,"createdAt":"2026-09-18T10:00:00.000Z","inApp":true,"osBanner":true,"created":true,"groupCount":2}"#
    let data = try JSONSerialization.jsonObject(with: Data(json.utf8))
    guard case let .notification(event) = resolveRealtimeDelivery(channel: "notifications:all:user_u1", event: "notification_created", data: data) else {
      Issue.record("expected a notification")
      return
    }
    #expect(event.id == "n1" && event.roomId == "room_1" && event.messageId == "m1" && event.groupCount == 2 && event.osBanner && !event.isRead)
    // Another channel, another kind and a malformed row are ignored.
    if case .ignored = resolveRealtimeDelivery(channel: "chat_control:user_u1", event: "notification_created", data: data) {} else {
      Issue.record("expected ignored for a foreign channel")
    }
    let job = try JSONSerialization.jsonObject(with: Data(json.replacingOccurrences(of: #""kind":"CHAT""#, with: #""kind":"JOB""#).utf8))
    if case .ignored = resolveRealtimeDelivery(channel: "notifications:all:user_u1", event: "notification_created", data: job) {} else {
      Issue.record("expected ignored for a job row")
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

  /// Web `chat-rooms-changed-event.test.ts`: Core's payload names its collections; a null room is a user-wide change.
  @Test func roomsChangedNamesTheStaleCollections() {
    let control = "chat_control:user_user_1"
    let named = resolveRealtimeDelivery(channel: control, event: "chat_rooms_changed", data: [
      "collections": ["active", "archived"], "roomId": "room-1", "at": "2026-09-09T12:00:00.000Z"
    ])
    guard case let .roomsChanged(collections) = named else {
      Issue.record("expected roomsChanged, got \(named)")
      return
    }
    #expect(collections == [.active, .archived])
    let userWide = resolveRealtimeDelivery(channel: control, event: "chat_rooms_changed", data: [
      "collections": ["invitations"], "roomId": NSNull(), "at": "2026-09-09T12:00:00.000Z"
    ])
    guard case let .roomsChanged(invitations) = userWide else {
      Issue.record("expected roomsChanged, got \(userWide)")
      return
    }
    #expect(invitations == [.invitations])
  }

  /// Web rejects the whole event on an unknown collection or an empty list, and so does every malformed field here.
  @Test func malformedRoomsChangedIsIgnored() {
    let control = "chat_control:user_user_1"
    let sentAt = "2026-09-09T12:00:00.000Z"
    let payloads: [Any] = [
      ["collections": ["starred"], "roomId": NSNull(), "at": sentAt],
      ["collections": ["active", "starred"], "roomId": NSNull(), "at": sentAt],
      ["collections": [String](), "roomId": NSNull(), "at": sentAt],
      ["collections": "active", "roomId": NSNull(), "at": sentAt],
      ["collections": ["active"], "roomId": "", "at": sentAt],
      ["collections": ["active"], "at": sentAt],
      ["collections": ["active"], "roomId": NSNull(), "at": "yesterday"],
      ["collections": ["active"], "roomId": NSNull()],
      NSNull()
    ]
    for payload in payloads {
      #expect(resolveRealtimeDelivery(channel: control, event: "chat_rooms_changed", data: payload).isIgnored, "\(payload)")
    }
    // Only the control channel carries it.
    #expect(resolveRealtimeDelivery(channel: "chat_rooms:room_\(roomId)", event: "chat_rooms_changed",
                                    data: ["collections": ["active"], "roomId": NSNull(), "at": sentAt]).isIgnored)
  }

  /// Web's `z.iso.datetime()` (zod 4.6.5 defaults): a real calendar date, `T`, hours, minutes and seconds, any number
  /// of fractional digits, and `Z` only — no offset, nothing after it.
  @Test(arguments: [
    ("2026-09-09T12:00:00Z", true),
    ("2026-09-09T12:00:00.123Z", true),
    ("2026-09-09T23:59:59.1Z", true),
    ("2026-09-09T00:00:00.123456789Z", true),
    ("2024-02-29T00:00:00Z", true),
    ("2000-02-29T00:00:00Z", true),
    ("2026-02-30T12:00:00Z", false),
    ("2025-02-29T00:00:00Z", false),
    ("1900-02-29T00:00:00Z", false),
    ("2026-04-31T00:00:00Z", false),
    ("2026-13-01T00:00:00Z", false),
    ("2026-09-09T12:00:00Zjunk", false),
    ("2026-09-09T12:00:00+02:00", false),
    ("2026-09-09T12:00:00", false),
    ("2026-09-09T12:00Z", false),
    ("2026-09-09T12:00:00.Z", false),
    ("2026-09-09T24:00:00Z", false),
    ("2026-09-09T12:00:60Z", false),
    ("2026-09-09 12:00:00Z", false),
    ("2026-09-09t12:00:00z", false),
    (" 2026-09-09T12:00:00Z", false),
    ("٢٠٢٦-09-09T12:00:00Z", false)
  ])
  func roomsChangedTimeFollowsWebsISODateTime(sentAt: String, accepted: Bool) {
    let event = resolveRealtimeDelivery(channel: "chat_control:user_user_1", event: "chat_rooms_changed",
                                        data: ["collections": ["active"], "roomId": NSNull(), "at": sentAt])
    #expect(event.isIgnored == !accepted, "\(sentAt)")
  }

  @Test func tokenFieldsSerializeForAbly() {
    let token = Components.Schemas.AblyTokenRequest(
      keyName: "app.key",
      capability: "{\"chat_rooms:room_x\":[\"subscribe\"]}",
      clientId: "user_1:inst_1",
      timestamp: 1_704_067_200_000,
      nonce: "n",
      mac: "m"
    )
    guard let json = token.artTokenRequestJSON else {
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
