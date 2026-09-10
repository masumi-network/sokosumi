import Foundation
import SokosumiChat
import Testing

struct ThreadTranscriptTests {
  private let parentId = "550e8400-e29b-41d4-a716-446655440801"

  @Test func replyPageCarriesParentCursorAndWorkspace() async throws {
    let transport = TestTransport([(200, testMessagesPageBody(messages: [], nextCursor: "next"))])
    let result = try await ChatService().listThreadMessages(
      client: makeTestClient(transport), roomId: testRoomId, parentMessageId: parentId,
      cursor: "older", organizationSlug: "acme"
    )
    #expect(result.messages.isEmpty)
    #expect(result.nextCursor == "next")
    let request = try #require(transport.requests.first)
    #expect(request.request.path?.contains("/threads/\(parentId)/messages") == true)
    #expect(request.request.path?.contains("cursor=older") == true)
    #expect(request.request.path?.contains("limit=100") == true)
    #expect(testOrgSlugHeader(request.request) == "acme")
  }

  @Test func threadReadReturnsLookStateWithoutRoomRead() async throws {
    let transport = TestTransport([(200, """
    {"data":{"parentMessageId":"\(parentId)","lastReadAt":"\(testTimestamp)"},"meta":{"timestamp":"\(testTimestamp)","requestId":"test"}}
    """)])
    let state = try await ChatService().markThreadRead(
      client: makeTestClient(transport), roomId: testRoomId, parentMessageId: parentId, organizationSlug: nil
    )
    #expect(state.parentMessageId == parentId)
    #expect(transport.requests.count == 1)
    #expect(transport.requests.first?.request.path?.hasSuffix("/threads/\(parentId)/read") == true)
    #expect(try testOrgSlugHeader(#require(transport.requests.first).request) == nil)
  }

  @Test func replySendIncludesParentAndStableClientId() async throws {
    let transport = TestTransport([(201, testCreatedMessageBody(id: "reply", content: "hello", clientMessageId: "turn"))])
    _ = try await ChatService().createMessage(
      client: makeTestClient(transport), roomId: testRoomId, content: "hello", clientMessageId: "turn",
      parentMessageId: parentId, organizationSlug: nil
    )
    let body = try testRequestJSON(#require(transport.bodies.first))
    #expect(body["parentMessageId"] as? String == parentId)
    #expect(body["clientMessageId"] as? String == "turn")
  }

  @Test(arguments: [401, 403, 404, 422, 500])
  func replyPagePreservesCoreErrors(_ status: Int) async throws {
    let transport = TestTransport([(status, """
    {"error":"Failure","message":"thread unavailable","meta":{"timestamp":"\(testTimestamp)","requestId":"test","path":"/threads","method":"GET"}}
    """)])
    do {
      _ = try await ChatService().listThreadMessages(
        client: makeTestClient(transport), roomId: testRoomId, parentMessageId: parentId, organizationSlug: nil
      )
      Issue.record("Expected Core error")
    } catch let error as ChatServiceError {
      if status == 401 {
        #expect(error == .unauthorized("thread unavailable"))
      } else {
        #expect(error == .unprocessable(statusCode: status, message: "thread unavailable"))
      }
    }
  }

  @Test(arguments: [401, 403, 404, 500])
  func threadReadPreservesCoreErrors(_ status: Int) async throws {
    let transport = TestTransport([(status, """
    {"error":"Failure","message":"thread unavailable","meta":{"timestamp":"\(testTimestamp)","requestId":"test","path":"/threads","method":"GET"}}
    """)])
    let client = try makeTestClient(transport)
    do {
      _ = try await ChatService().markThreadRead(client: client, roomId: testRoomId, parentMessageId: parentId, organizationSlug: nil)
      Issue.record("Expected Core error")
    } catch let error as ChatServiceError {
      #expect(error == (status == 401 ? .unauthorized("thread unavailable") : .unprocessable(statusCode: status, message: "thread unavailable")))
    }
  }
}
