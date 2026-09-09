import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let ada = "Ada"
private let adaEmail = "ada@example.com"

private func history(_ messages: [String]) async throws -> [Components.Schemas.ChatRoomMessage] {
  try await fetchTestMessages(messages)
}

private func testShell(
  turn: String,
  content: String = "hello",
  status: OutboundDeliveryStatus = .pending
) -> OutboundShell {
  .init(
    clientTurnId: turn,
    roomId: testRoomId,
    content: content,
    createdAt: Date(timeIntervalSince1970: 1_788_868_800),
    status: status,
    sender: .init(id: "user_1", name: "Me", email: "me@example.com", presence: .offline)
  )
}

private func makeRoom(id: String) -> Components.Schemas.ChatRoom {
  .init(
    id: id,
    name: id,
    kind: .channel,
    createdByUserId: "user_1",
    createdAt: Date(timeIntervalSince1970: 1_700_000_000),
    updatedAt: Date(timeIntervalSince1970: 1_700_000_000),
    unreadCount: 0,
    unreadMentionCount: 0,
    markedUnread: false,
    myAccess: .member,
    userMembers: [],
    coworkerMembers: [],
    sokoBotMembers: []
  )
}

private func ablyTokenBody(keyName: String = "test.app") -> String {
  """
  {"data":{"keyName":"\(keyName)","capability":"{\\"chat_rooms:room_abc\\":[\\"subscribe\\"]}","timestamp":1704067200000,"nonce":"nonce-1","mac":"mac-1"},"meta":{"timestamp":"\(testTimestamp)","requestId":"req-1"}}
  """
}

struct ChatRealtimeTests {
  @Test func fullCreateMergesOldestFirst() async throws {
    let existing = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440601",
        content: "first",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    let incoming = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440602",
        content: "second",
        sender: testUserSender(name: ada, email: adaEmail),
        createdAt: "2026-01-01T00:00:01.000Z"
      )
    ])
    let result = applyRealtimeFullEvent(
      messages: existing,
      shells: [],
      eventType: .create,
      message: incoming[0]
    )
    #expect(result.messages.map(\.content) == ["first", "second"])
    #expect(result.shells.isEmpty)
  }

  @Test func fullUpdateMergesIncomingWins() async throws {
    let existing = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440603",
        content: "hello",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    let incoming = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440603",
        content: "hello edited",
        sender: testUserSender(name: ada, email: adaEmail),
        editedAt: testTimestamp
      )
    ])
    let result = applyRealtimeFullEvent(
      messages: existing,
      shells: [],
      eventType: .update,
      message: incoming[0]
    )
    #expect(result.messages.count == 1)
    #expect(result.messages[0].content == "hello edited")
    #expect(result.messages[0].editedAt != nil)
  }

  @Test func mappedDeleteMergesTombstoneChrome() async throws {
    let existing = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440604",
        content: "bye",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    // Core's mapped delete DTO: empty body with deletedAt set.
    let incoming = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440604",
        content: "",
        sender: testUserSender(name: ada, email: adaEmail),
        deletedAt: testTimestamp
      )
    ])
    let result = applyRealtimeFullEvent(
      messages: existing,
      shells: [],
      eventType: .delete,
      message: incoming[0]
    )
    #expect(result.messages.count == 1)
    #expect(result.messages[0].content.isEmpty)
    #expect(result.messages[0].deletedAt != nil)
  }

  @Test func hardDeleteRemovesTheRow() async throws {
    let existing = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440605",
        content: "vanish",
        sender: testUserSender(name: ada, email: adaEmail)
      ),
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440606",
        content: "stays",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    let incoming = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440605",
        content: "vanish",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    let result = applyRealtimeFullEvent(
      messages: existing,
      shells: [],
      eventType: .delete,
      message: incoming[0]
    )
    #expect(result.messages.map(\.content) == ["stays"])
  }

  @Test func threadReplyNeverEntersTheTranscript() async throws {
    let existing = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440607",
        content: "top",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    let replyJSON = """
    {"id":"550e8400-e29b-41d4-a716-446655440608","roomId":"\(testRoomId)","parentMessageId":"550e8400-e29b-41d4-a716-446655440607","content":"reply","createdAt":"\(testTimestamp)","deletedAt":null,"editedAt":null,"sender":\(testUserSender(name: ada, email: adaEmail)),"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":null,"quote":null,"membership":null,"unfurls":null}
    """
    let reply = try await history([replyJSON])
    let result = applyRealtimeFullEvent(
      messages: existing,
      shells: [],
      eventType: .create,
      message: reply[0]
    )
    #expect(result.messages.map(\.content) == ["top"])
  }

  @Test func ownSendAndAblyCreateDedupeToOneBubble() async throws {
    let pending = testShell(turn: "turn-live-1")
    let historyMessages = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440609",
        content: "earlier",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    // The Ably create carries the same client turn id as the pending shell.
    let incoming = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440610",
        content: "hello",
        sender: testUserSender(name: "Me", email: "me@example.com"),
        metadata: "{\"client_message_id\":\"turn-live-1\"}"
      )
    ])
    let result = applyRealtimeFullEvent(
      messages: historyMessages,
      shells: [pending],
      eventType: .create,
      message: incoming[0]
    )
    #expect(result.shells.isEmpty)
    #expect(result.messages.map(\.content) == ["earlier", "hello"])
    #expect(result.messages.map(\.id) == [
      "550e8400-e29b-41d4-a716-446655440609",
      "550e8400-e29b-41d4-a716-446655440610"
    ])
  }

  @Test func ownAblyConfirmSortsAmongPeerRows() async throws {
    let pending = testShell(turn: "turn-live-sort")
    let peer = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440630",
        content: "peer",
        sender: testUserSender(name: ada, email: adaEmail),
        createdAt: "2026-01-01T00:00:02.000Z"
      )
    ])
    let own = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440631",
        content: "mine",
        sender: testUserSender(name: "Me", email: "me@example.com"),
        createdAt: "2026-01-01T00:00:01.000Z",
        metadata: "{\"client_message_id\":\"turn-live-sort\"}"
      )
    ])
    let result = applyRealtimeFullEvent(
      messages: peer,
      shells: [pending],
      eventType: .create,
      message: own[0]
    )
    #expect(result.shells.isEmpty)
    #expect(result.messages.map(\.content) == ["mine", "peer"])
  }

  @Test func peerCreateKeepsUnresolvedShellTrailing() async throws {
    let pending = testShell(turn: "turn-live-2", content: "mine")
    let incoming = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440611",
        content: "peer",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    let result = applyRealtimeFullEvent(
      messages: [],
      shells: [pending],
      eventType: .create,
      message: incoming[0]
    )
    #expect(result.shells.map(\.clientTurnId) == ["turn-live-2"])
    let displayed = displayedTranscript(messages: result.messages, shells: result.shells)
    #expect(displayed.map(\.content) == ["peer", "mine"])
    #expect(!isOutboundLocalMessage(displayed[0]))
    #expect(isOutboundLocalMessage(displayed[1]))
  }

  @Test func refetchPageMergesWithoutDroppingMissing() async throws {
    let existing = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440614",
        content: "stale",
        sender: testUserSender(name: ada, email: adaEmail)
      ),
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440615",
        content: "absent-from-page",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    let page = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440614",
        content: "fresh",
        sender: testUserSender(name: ada, email: adaEmail),
        editedAt: testTimestamp
      )
    ])
    let merged = mergeRealtimePage(messages: existing, page: page)
    #expect(merged.map(\.id) == [
      "550e8400-e29b-41d4-a716-446655440614",
      "550e8400-e29b-41d4-a716-446655440615"
    ])
    #expect(merged[0].content == "fresh")
    #expect(merged[1].content == "absent-from-page")
  }

  @Test func refetchPageLastWinsDuplicateExistingIds() async throws {
    let dupId = "550e8400-e29b-41d4-a716-446655440616"
    let otherId = "550e8400-e29b-41d4-a716-446655440617"
    let first = try await history([
      testMessageJSON(id: dupId, content: "first", sender: testUserSender(name: ada, email: adaEmail))
    ])
    let second = try await history([
      testMessageJSON(id: dupId, content: "second", sender: testUserSender(name: ada, email: adaEmail))
    ])
    let other = try await history([
      testMessageJSON(id: otherId, content: "other", sender: testUserSender(name: ada, email: adaEmail))
    ])
    let page = try await history([
      testMessageJSON(id: dupId, content: "from-page", sender: testUserSender(name: ada, email: adaEmail))
    ])
    let merged = mergeRealtimePage(messages: first + second + other, page: page)
    #expect(merged.map(\.id) == [dupId, otherId])
    #expect(merged[0].content == "from-page")
    #expect(merged[1].content == "other")
  }

  @Test func envelopeIgnoresOtherRooms() {
    let envelope = ChatRoomMessageIdEnvelope(eventType: .create, messageId: "m1", roomId: "room-other")
    #expect(resolveRealtimeEnvelope(envelope, focusedRoomId: testRoomId) == .ignore)
    #expect(resolveRealtimeEnvelope(envelope, focusedRoomId: nil) == .ignore)
  }

  @Test func envelopeRefetchesFocusedCreateAndUpdate() {
    for eventType in [ChatRoomMessageRealtimeEventType.create, .update] {
      let envelope = ChatRoomMessageIdEnvelope(eventType: eventType, messageId: "m1", roomId: testRoomId)
      #expect(resolveRealtimeEnvelope(envelope, focusedRoomId: testRoomId) == .needsRefetch)
    }
  }

  @Test func envelopeTombstonesFocusedDelete() {
    let envelope = ChatRoomMessageIdEnvelope(eventType: .delete, messageId: "m1", roomId: testRoomId)
    #expect(resolveRealtimeEnvelope(envelope, focusedRoomId: testRoomId) == .tombstone(messageId: "m1"))
  }

  @Test func envelopeIgnoresThreadReplies() {
    let envelope = ChatRoomMessageIdEnvelope(
      eventType: .create,
      messageId: "m1",
      roomId: testRoomId,
      parentMessageId: "parent-1"
    )
    #expect(resolveRealtimeEnvelope(envelope, focusedRoomId: testRoomId) == .ignore)
  }

  @Test func envelopeNeverInventsARow() async throws {
    // Delete envelope for a row that is not on screen: history unchanged.
    let existing = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440612",
        content: "visible",
        sender: testUserSender(name: ada, email: adaEmail)
      )
    ])
    let untouched = applyRealtimeTombstone(messages: existing, messageId: "missing-id")
    #expect(untouched.map(\.id) == existing.map(\.id))
    #expect(untouched.map(\.content) == ["visible"])
  }

  @Test func tombstoneClearsBodyButKeepsIdentity() async throws {
    let existing = try await history([
      testMessageJSON(
        id: "550e8400-e29b-41d4-a716-446655440613",
        content: "bye",
        sender: testUserSender(name: ada, email: adaEmail),
        metadata: "{\"client_message_id\":\"turn-x\"}"
      )
    ])
    let tombstoned = applyRealtimeTombstone(messages: existing, messageId: "550e8400-e29b-41d4-a716-446655440613")
    #expect(tombstoned.count == 1)
    #expect(tombstoned[0].id == "550e8400-e29b-41d4-a716-446655440613")
    #expect(tombstoned[0].content.isEmpty)
    #expect(tombstoned[0].deletedAt != nil)
    #expect(tombstoned[0].metadata == nil)
    #expect(messageSenderName(tombstoned[0].sender) == ada)
  }

  @Test func revokeDropsRoomAndClearsSelection() {
    let rooms = [makeRoom(id: "room-a"), makeRoom(id: "room-b")]
    let result = applyMembershipRevoked(rooms: rooms, selectedRoomId: "room-a", revokedRoomId: "room-a")
    #expect(result.rooms.map(\.id) == ["room-b"])
    #expect(result.selectedRoomId == nil)
  }

  @Test func revokeKeepsUnrelatedSelection() {
    let rooms = [makeRoom(id: "room-a"), makeRoom(id: "room-b")]
    let result = applyMembershipRevoked(rooms: rooms, selectedRoomId: "room-b", revokedRoomId: "room-a")
    #expect(result.rooms.map(\.id) == ["room-b"])
    #expect(result.selectedRoomId == "room-b")
  }

  @Test func revokeUnknownIdIsANoop() {
    let rooms = [makeRoom(id: "room-a")]
    let result = applyMembershipRevoked(rooms: rooms, selectedRoomId: "room-a", revokedRoomId: "room-gone")
    #expect(result.rooms.map(\.id) == ["room-a"])
    #expect(result.selectedRoomId == "room-a")
  }

  @Test func channelNamesMatchWeb() {
    #expect(chatRoomChannelName(roomId: "abc") == "chat_rooms:room_abc")
    #expect(userChatControlChannelName(userId: "user_1") == "chat_control:user_user_1")
    #expect(chatRoomMessageEventName == "chat_room_message")
    #expect(chatMembershipRevokedEventName == "chat_membership_revoked")
    #expect(parseChatRoomId(fromChannelName: "chat_rooms:room_abc") == "abc")
    #expect(parseChatRoomId(fromChannelName: "chat_control:user_user_1") == nil)
    #expect(parseChatRoomId(fromChannelName: "chat_rooms:room_") == nil)
  }

  @Test func instanceIdIsStablePerInstall() {
    let store = MemoryAblyClientInstanceIdStore()
    let first = getOrCreateAblyClientInstanceId(store: store) { "inst_test00000001" }
    #expect(first == "inst_test00000001")
    // Second launch reuses the persisted value even with another generator.
    let second = getOrCreateAblyClientInstanceId(store: store) { "inst_changed0000002" }
    #expect(second == "inst_test00000001")
    #expect(store.load() == "inst_test00000001")
  }

  @Test func instanceIdReplacesInvalidPersistedValue() {
    let store = MemoryAblyClientInstanceIdStore(stored: "bad id!")
    let id = getOrCreateAblyClientInstanceId(store: store) { "inst_test00000002" }
    #expect(id == "inst_test00000002")
    #expect(store.load().map(isValidAblyClientInstanceId) == true)
  }

  @Test func instanceIdValidationMatchesCore() {
    #expect(isValidAblyClientInstanceId("inst_12345"))
    #expect(isValidAblyClientInstanceId("aBcDeF09_-"))
    #expect(!isValidAblyClientInstanceId("short"))
    #expect(!isValidAblyClientInstanceId("has space!"))
    #expect(!isValidAblyClientInstanceId(String(repeating: "a", count: 65)))
    #expect(ablyPresenceClientId(userId: "user_1", instanceId: "inst_1") == "user_1:inst_1")
  }

  @Test func fetchAblyTokenPostsInstanceId() async throws {
    let transport = TestTransport([(200, ablyTokenBody())])
    let token = try await ChatService().fetchAblyToken(
      client: makeTestClient(transport),
      clientInstanceId: "inst_abc123",
      organizationSlug: "acme"
    )
    #expect(token.keyName == "test.app")
    #expect(transport.requests.map(\.operationID) == ["post/realtime/ably-token"])
    #expect(testOrgSlugHeader(transport.requests[0].request) == "acme")
    #expect(testRequestQuery(transport.requests[0].request).contains("clientInstanceId=inst_abc123"))
  }

  @Test func fetchAblyTokenOmitsOrgHeaderForPersonal() async throws {
    let transport = TestTransport([(200, ablyTokenBody())])
    _ = try await ChatService().fetchAblyToken(
      client: makeTestClient(transport),
      clientInstanceId: "inst_abc123",
      organizationSlug: nil
    )
    #expect(testOrgSlugHeader(transport.requests[0].request) == nil)
    #expect(testRequestQuery(transport.requests[0].request).contains("clientInstanceId=inst_abc123"))
  }

  @Test func fetchAblyTokenFailureIsUnprocessable() async throws {
    let transport = TestTransport([(
      400,
      """
      {"error":"Bad Request","message":"Invalid clientInstanceId","meta":{"timestamp":"\(testTimestamp)","requestId":"req-1","path":"/v1/realtime/ably-token","method":"POST"}}
      """
    )])
    do {
      _ = try await ChatService().fetchAblyToken(
        client: makeTestClient(transport),
        clientInstanceId: "bad id!",
        organizationSlug: nil
      )
      Issue.record("expected unprocessable error")
    } catch let error as ChatServiceError {
      #expect(error == .unprocessable(statusCode: 400, message: "Invalid clientInstanceId"))
    }
  }
}
