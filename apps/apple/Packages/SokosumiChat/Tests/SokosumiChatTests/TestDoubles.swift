import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import Testing

let testTimestamp = "2026-01-01T00:00:00.000Z"
let testRoomId = "550e8400-e29b-41d4-a716-446655440100"

func testUserSender(name: String, email: String) -> String {
  """
  {"type":"user","user":{"id":"user_2","name":"\(name)","email":"\(email)","presence":"offline"}}
  """
}

func testMessageJSON(
  id: String,
  content: String,
  sender: String,
  createdAt: String = testTimestamp,
  membership: String? = nil
) -> String {
  let membershipJSON = membership ?? "null"
  return """
  {"id":"\(id)","roomId":"\(testRoomId)","parentMessageId":null,"content":"\(content)","createdAt":"\(createdAt)","deletedAt":null,"editedAt":null,"sender":\(sender),"mentions":[],"reactions":[],"threadReplyCount":0,"threadLastReplyAt":null,"metadata":null,"quote":null,"membership":\(membershipJSON),"unfurls":null}
  """
}

func testMessagesPageBody(messages: [String], nextCursor: String?) -> String {
  let cursorJSON = nextCursor.map { "\"\($0)\"" } ?? "null"
  return """
  {"data":[\(messages.joined(separator: ","))],"meta":{"timestamp":"\(testTimestamp)","requestId":"req-1","pagination":{"cursor":null,"limit":100,"total":\(messages.count),"nextCursor":\(cursorJSON)}}}
  """
}

final class TestTransport: ClientTransport, @unchecked Sendable {
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

func testOrgSlugHeader(_ request: HTTPRequest) -> String? {
  guard let name = HTTPField.Name("X-Organization-Slug") else { return nil }
  return request.headerFields[name]
}

func testRequestQuery(_ request: HTTPRequest) -> String {
  guard let path = request.path, let qIndex = path.firstIndex(of: "?") else { return "" }
  return String(path[path.index(after: qIndex)...])
}

func makeTestClient(_ transport: TestTransport) throws -> Client {
  try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
}

/// Decodes messages through the real generated client so presentation tests
/// exercise the same shapes the transcript renders.
func fetchTestMessages(_ messages: [String]) async throws -> [Components.Schemas.ChatRoomMessage] {
  let transport = TestTransport([(200, testMessagesPageBody(messages: messages, nextCursor: nil))])
  let client = try makeTestClient(transport)
  let response = try await client.getChatsRoomsIdMessages(
    .init(path: .init(id: testRoomId), query: .init(), headers: .init())
  )
  guard case let .ok(okResponse) = response else {
    Issue.record("fixture failed to decode")
    return []
  }
  return try okResponse.body.json.data
}
