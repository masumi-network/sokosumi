import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

private let timestamp = "2026-01-01T00:00:00.000Z"
private let roomId = "550e8400-e29b-41d4-a716-446655440100"

private func userSender(name: String, email: String) -> String {
  """
  {"type":"user","user":{"id":"user_2","name":"\(name)","email":"\(email)","presence":"offline"}}
  """
}

private func messageJSON(id: String, content: String, sender: String) -> String {
  """
  {"id":"\(id)","roomId":"\(roomId)","parentMessageId":null,"content":"\(content)","createdAt":"\(timestamp)","deletedAt":null,"editedAt":null,"sender":\(sender),"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":null,"quote":null,"membership":null,"unfurls":null}
  """
}

private func messagesPageBody(messages: [String], nextCursor: String?) -> String {
  let cursorJSON = nextCursor.map { "\"\($0)\"" } ?? "null"
  return """
  {"data":[\(messages.joined(separator: ","))],"meta":{"timestamp":"\(timestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(messages.count),"nextCursor":\(cursorJSON)}}}
  """
}

private func roomJSON(unreadCount: Int) -> String {
  """
  {"id":"\(roomId)","organizationId":null,"organizationName":null,"name":"general","slug":null,"kind":"channel","directKey":null,"topic":null,"discoverability":null,"createdByUserId":"user_1","createdAt":"\(timestamp)","updatedAt":"\(timestamp)","unreadCount":\(unreadCount),"unreadMentionCount":0,"starredAt":null,"pinnedMessageCount":0,"mutedAt":null,"markedUnread":false,"myAccess":"member","peerInActiveOrganization":false,"userMembers":[],"coworkerMembers":[],"sokoBotMembers":[]}
  """
}

private func readBody(unreadCount: Int) -> String {
  """
  {"data":\(roomJSON(unreadCount: unreadCount)),"meta":{"timestamp":"\(timestamp)","requestId":"req-1"}}
  """
}

private final class TranscriptTransport: ClientTransport, @unchecked Sendable {
  struct Recorded {
    var operationID: String
    var request: HTTPRequest
  }

  private(set) var requests: [Recorded] = []
  private var responses: [(Int, String)]

  init(_ responses: [(Int, String)]) {
    self.responses = responses
  }

  func send(
    _ request: HTTPRequest,
    body _: HTTPBody?,
    baseURL _: URL,
    operationID: String
  ) async throws -> (HTTPResponse, HTTPBody?) {
    requests.append(.init(operationID: operationID, request: request))
    guard !responses.isEmpty else {
      Issue.record("unexpected request \(operationID): no stubbed response left")
      return (HTTPResponse(status: .internalServerError), HTTPBody("{}"))
    }
    let next = responses.removeFirst()
    return (HTTPResponse(status: HTTPResponse.Status(code: next.0)), HTTPBody(next.1))
  }
}

private func orgSlugHeader(_ request: HTTPRequest) -> String? {
  guard let name = HTTPField.Name("X-Organization-Slug") else { return nil }
  return request.headerFields[name]
}

private func requestQuery(_ request: HTTPRequest) -> String {
  guard let path = request.path, let qIndex = path.firstIndex(of: "?") else { return "" }
  return String(path[path.index(after: qIndex)...])
}

private func makeClient(_ transport: TranscriptTransport) throws -> Client {
  try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
}

struct RoomTranscriptTests {
  @Test func historyPaginationWalksCursorOldestFirst() async throws {
    let transport = TranscriptTransport([
      (200, messagesPageBody(
        messages: [messageJSON(id: "550e8400-e29b-41d4-a716-446655440101", content: "first", sender: userSender(name: "Ada", email: "ada@example.com"))],
        nextCursor: nil
      ))
    ])
    let page = try await ChatService().listMessages(
      client: makeClient(transport), roomId: roomId, organizationSlug: nil
    )
    #expect(page.messages.map(\.content) == ["first"])
    #expect(page.nextCursor == nil)
    #expect(transport.requests.map(\.operationID) == ["get/chats/rooms/{id}/messages"])
    #expect(orgSlugHeader(transport.requests[0].request) == nil)
    #expect(requestQuery(transport.requests[0].request).contains("limit=100"))
  }

  @Test func historySecondPageSendsCursor() async throws {
    let transport = TranscriptTransport([
      (200, messagesPageBody(
        messages: [messageJSON(id: "550e8400-e29b-41d4-a716-446655440102", content: "older", sender: userSender(name: "Ada", email: "ada@example.com"))],
        nextCursor: nil
      ))
    ])
    let page = try await ChatService().listMessages(
      client: makeClient(transport), roomId: roomId, cursor: "cursor-2", organizationSlug: "acme"
    )
    #expect(page.messages.map(\.content) == ["older"])
    #expect(orgSlugHeader(transport.requests[0].request) == "acme")
    #expect(requestQuery(transport.requests[0].request).contains("cursor=cursor-2"))
  }

  @Test func emptyRoomResolvesEmpty() async throws {
    let transport = TranscriptTransport([(200, messagesPageBody(messages: [], nextCursor: nil))])
    let page = try await ChatService().listMessages(
      client: makeClient(transport), roomId: roomId, organizationSlug: nil
    )
    #expect(page.messages.isEmpty)
    #expect(page.nextCursor == nil)
  }

  @Test func openRoomMarksReadAfterHistory() async throws {
    let transport = TranscriptTransport([
      (200, messagesPageBody(
        messages: [messageJSON(id: "550e8400-e29b-41d4-a716-446655440103", content: "hi", sender: userSender(name: "Ada", email: "ada@example.com"))],
        nextCursor: nil
      )),
      (200, readBody(unreadCount: 0))
    ])
    let opened = try await ChatService().openRoom(
      client: makeClient(transport), roomId: roomId, organizationSlug: nil
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
    let transport = TranscriptTransport([
      (500, """
      {"error":"Internal Server Error","message":"boom","meta":{"timestamp":"\(timestamp)","requestId":"req-1","path":"/v1/chats/rooms/\(roomId)/messages","method":"GET"}}
      """)
    ])
    do {
      _ = try await ChatService().openRoom(
        client: makeClient(transport), roomId: roomId, organizationSlug: nil
      )
      Issue.record("expected history failure")
    } catch let error as ChatServiceError {
      #expect(String(describing: error).contains("500"))
    }
    #expect(transport.requests.map(\.operationID) == ["get/chats/rooms/{id}/messages"])
  }

  @Test func markReadReturnsUpdatedRoomDTO() async throws {
    let transport = TranscriptTransport([(200, readBody(unreadCount: 2))])
    let room = try await ChatService().markRoomRead(
      client: makeClient(transport), roomId: roomId, organizationSlug: "acme"
    )
    // Leftover thread unread stays on the DTO (ADR 0013) — the caller must
    // not zero it locally.
    #expect(room.unreadCount == 2)
    #expect(orgSlugHeader(transport.requests[0].request) == "acme")
  }

  @Test func senderNameCoversEverySenderKind() async throws {
    let transport = TranscriptTransport([
      (200, messagesPageBody(messages: [
        messageJSON(id: "550e8400-e29b-41d4-a716-446655440104", content: "a", sender: userSender(name: "Ada", email: "ada@example.com")),
        messageJSON(id: "550e8400-e29b-41d4-a716-446655440105", content: "b", sender: userSender(name: "", email: "nameless@example.com")),
        messageJSON(id: "550e8400-e29b-41d4-a716-446655440106", content: "c", sender: "{\"type\":\"coworker\",\"coworker\":{\"id\":\"cw_1\",\"name\":\"Helper\",\"slug\":\"helper\",\"presence\":\"online\"}}"),
        messageJSON(id: "550e8400-e29b-41d4-a716-446655440107", content: "d", sender: "{\"type\":\"sokoBot\",\"sokoBot\":{\"id\":\"bot_1\",\"name\":\"Soko\",\"presence\":\"online\"}}"),
        messageJSON(id: "550e8400-e29b-41d4-a716-446655440108", content: "e", sender: "{\"type\":\"unknown\"}")
      ], nextCursor: nil))
    ])
    // Decodes through the real generated oneOf so the name switch is covered.
    let page = try await ChatService().listMessages(
      client: makeClient(transport), roomId: roomId, organizationSlug: nil
    )
    #expect(page.messages.map { messageSenderName($0.sender) } == [
      "Ada", "nameless@example.com", "Helper", "Soko", "Unknown"
    ])
  }
}
