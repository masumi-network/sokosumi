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

  @Test func openRoomMarksReadAfterHistory() async throws {
    let transport = TestTransport([
      (200, testMessagesPageBody(
        messages: [testMessageJSON(id: "550e8400-e29b-41d4-a716-446655440103", content: "hi", sender: testUserSender(name: "Ada", email: "ada@example.com"))],
        nextCursor: nil
      )),
      (200, readBody(unreadCount: 0))
    ])
    let opened = try await ChatService().openRoom(
      client: makeTestClient(transport), roomId: roomId, organizationSlug: nil
    )
    #expect(transport.requests.map(\.operationID) == [
      "get/chats/rooms/{id}/messages",
      "post/chats/rooms/{id}/read"
    ])
    #expect(opened.messages.map(\.content) == ["hi"])
    // Unread chrome must match the returned DTO, not a local zero.
    #expect(opened.room.unreadCount == 0)
    #expect(opened.room.id == roomId)
  }

  @Test func failedHistoryDoesNotMarkRead() async throws {
    let transport = TestTransport([
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(testTimestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomId)/messages","method":"GET"}}
      """)
    ])
    do {
      _ = try await ChatService().openRoom(
        client: makeTestClient(transport), roomId: roomId, organizationSlug: nil
      )
      Issue.record("expected history failure")
    } catch let error as ChatServiceError {
      #expect(String(describing: error).contains("500"))
    }
    #expect(transport.requests.map(\.operationID) == ["get/chats/rooms/{id}/messages"])
  }

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
}
