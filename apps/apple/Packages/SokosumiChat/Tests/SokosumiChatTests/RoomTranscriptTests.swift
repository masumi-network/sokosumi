import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let roomId = testRoomId

private func roomJSON(unreadCount: Int) -> String {
  """
  {"id":"\(roomId)","organizationId":null,"organizationName":null,"name":"general","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(testTimestamp)","updatedAt":"\(testTimestamp)","unreadCount":\(unreadCount),"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
}

private func readBody(unreadCount: Int) -> String {
  """
  {"data":\(roomJSON(unreadCount: unreadCount)),"meta":{"timestamp":"\(testTimestamp)","requestId":"req-1"}}
  """
}

struct RoomTranscriptTests {
  @Test func historyPaginationWalksCursorOldestFirst() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(
        messages: [testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440101", content: "first", sender: testUserSender(name: "Ada", email: "ada@example.com"))],
        nextCursor: nil
      ))
    ])
    let page = try await ChatService().listMessages(
      client: makeTestClient(transport), roomId: roomId, organizationSlug: nil
    )
    #expect(page.messages.map(\.content) == ["first"])
    #expect(page.nextCursor == nil)
    #expect(transport.requests.map(\.operationID) == ["get/chats/rooms/{id}/messages"])
    #expect(testOrgSlugHeader(transport.requests[0].request) == nil)
    #expect(testRequestQuery(transport.requests[0].request).contains("limit=100"))
  }

  @Test func historySecondPageSendsCursor() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(
        messages: [testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440102", content: "older", sender: testUserSender(name: "Ada", email: "ada@example.com"))],
        nextCursor: nil
      ))
    ])
    let page = try await ChatService().listMessages(
      client: makeTestClient(transport), roomId: roomId, cursor: "cursor-2", organizationSlug: "acme"
    )
    #expect(page.messages.map(\.content) == ["older"])
    #expect(testOrgSlugHeader(transport.requests[0].request) == "acme")
    #expect(testRequestQuery(transport.requests[0].request).contains("cursor=cursor-2"))
  }

  @Test func emptyRoomResolvesEmpty() async throws {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: nil))])
    let page = try await ChatService().listMessages(
      client: makeTestClient(transport), roomId: roomId, organizationSlug: nil
    )
    #expect(page.messages.isEmpty)
    #expect(page.nextCursor == nil)
  }

  /// History-then-read ordering lives in WorkspaceState (generation-checked);
  /// the app tests assert the op order and the no-read-on-failed-history gate.
  @Test func markReadReturnsUpdatedRoomDTO() async throws {
    let transport = TestTransport([(200, readBody(unreadCount: 2))])
    let room = try await ChatService().markRoomRead(
      client: makeTestClient(transport), roomId: roomId, organizationSlug: "acme"
    )
    // Leftover thread unread stays on the DTO (ADR 0013) — the caller must
    // not zero it locally.
    #expect(room.unreadCount == 2)
    #expect(testOrgSlugHeader(transport.requests[0].request) == "acme")
  }

  @Test func senderNameCoversEverySenderKind() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(messages: [
        testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440104", content: "a", sender: testUserSender(name: "Ada", email: "ada@example.com")),
        testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440105", content: "b", sender: testUserSender(name: "", email: "nameless@example.com")),
        testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440106", content: "c", sender: "{\"type\":\"coworker\",\"coworker\":{\"id\":\"cw_1\",\"name\":\"Helper\",\"slug\":\"helper\",\"presence\":\"online\"}}"),
        testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440107", content: "d", sender: "{\"type\":\"sokoBot\",\"sokoBot\":{\"id\":\"bot_1\",\"name\":\"Soko\",\"presence\":\"online\"}}"),
        testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440108", content: "e", sender: "{\"type\":\"unknown\"}")
      ], nextCursor: nil))
    ])
    // Decodes through the real generated oneOf so the name switch is covered.
    let page = try await ChatService().listMessages(
      client: makeTestClient(transport), roomId: roomId, organizationSlug: nil
    )
    #expect(page.messages.map { messageSenderName($0.sender) } == [
      "Ada", "nameless@example.com", "Helper", "Soko", "Unknown"
    ])
  }

  @Test func createMessagePostsContentAndClientTurnId() async throws {
    let messageId = "550e8400-e29b-41d4-a716-446655440401"
    let turnId = "turn-1"
    let transport = TestTransport([
      (201, testCreatedMessageBody(id: messageId, content: "hello", clientMessageId: turnId))
    ])
    let message = try await ChatService().createMessage(
      client: makeTestClient(transport),
      roomId: roomId,
      content: "hello",
      clientMessageId: turnId,
      mentions: [
        .init(id: "user-1", name: "Ada", slug: "ada", kind: .human),
        .init(id: "cow-1", name: "Helper", slug: "helper", kind: .coworker),
        .init(id: messageId, name: "Soko", slug: "soko", kind: .sokoBot),
        .init(id: "all", name: "Everyone", slug: "all", kind: .all)
      ],
      organizationSlug: "acme"
    )
    #expect(message.content == "hello")
    #expect(message.id == messageId)
    #expect(transport.requests.map(\.operationID) == ["post/chats/rooms/{id}/messages"])
    #expect(testOrgSlugHeader(transport.requests[0].request) == "acme")
    let body = testRequestJSON(transport.bodies[0])
    #expect(body["content"] as? String == "hello")
    #expect(body["clientMessageId"] as? String == turnId)
    #expect(body["mentionedUserIds"] as? [String] == ["user-1"])
    #expect(body["mentionedCoworkerIds"] as? [String] == ["cow-1"])
    #expect(body["mentionedSokoBotIds"] as? [String] == [messageId])
  }

  @Test func createMessageFailureIsUnprocessable() async throws {
    let transport = TestTransport([(
      500,
      """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(testTimestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomId)/messages","method":"POST"}}
      """
    )])
    do {
      _ = try await ChatService().createMessage(
        client: makeTestClient(transport),
        roomId: roomId,
        content: "hello",
        clientMessageId: "turn-1",
        organizationSlug: nil
      )
      Issue.record("expected unprocessable error")
    } catch let error as ChatServiceError {
      #expect(error == .unprocessable(statusCode: 500, message: "boom"))
    }
    #expect(testOrgSlugHeader(transport.requests[0].request) == nil)
  }
}
