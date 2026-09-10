import Foundation
import OpenAPIRuntime
@testable import SokosumiChat
import Testing

struct DirectStreamTests {
  @Test func fragmentedEventsPreserveUnicodeReasoningAndAnswerOrder() async throws {
    let events = [
      #"{"type":"start","messageId":"answer"}"#,
      #"{"type":"reasoning-start","id":"r"}"#,
      #"{"type":"reasoning-delta","id":"r","delta":"Thinking 🤔"}"#,
      #"{"type":"reasoning-end","id":"r"}"#,
      #"{"type":"text-start","id":"a"}"#,
      #"{"type":"text-delta","id":"a","delta":"Hello "}"#,
      #"{"type":"text-delta","id":"a","delta":"世界"}"#,
      #"{"type":"text-end","id":"a"}"#,
      #"{"type":"finish-step"}"#,
      #"{"type":"text-start","id":"b"}"#,
      #"{"type":"text-delta","id":"b","delta":"!"}"#,
      #"{"type":"text-end","id":"b"}"#,
      #"{"type":"finish"}"#,
      "[DONE]"
    ]
    let bytes = (": heartbeat\r\n\r\n" + events.map { "data: \($0)\r\n\r\n" }.joined()).utf8
    let body = HTTPBody(AsyncStream<ArraySlice<UInt8>> { continuation in
      for byte in bytes {
        continuation.yield([byte])
      }
      continuation.finish()
    }, length: .unknown)
    var message = DirectStreamMessage()
    var updates = 0
    for try await event in body.asDecodedServerSentEvents(while: { !$0.elementsEqual("[DONE]".utf8) }) {
      guard let data = event.data else { continue }
      try message.receive(data)
      updates += 1
    }
    #expect(updates == events.count - 1)
    #expect(message.id == "answer")
    #expect(message.text == "Hello 世界!")
    #expect(message.reasoning == "Thinking 🤔")
    #expect(message.latestThought == "Thinking 🤔")
    #expect(message.finished)
  }

  @Test(arguments: ["text-delta", "text-end", "reasoning-delta", "reasoning-end"])
  func rejectsPartUpdatesWithoutStart(type: String) {
    var message = DirectStreamMessage()
    #expect(throws: ChatServiceError.self) {
      try message.receive("{\"type\":\"\(type)\",\"id\":\"missing\",\"delta\":\"lost\"}")
    }
  }

  @Test func streamErrorPreservesPartialAnswer() throws {
    var message = DirectStreamMessage()
    try message.receive(#"{"type":"text-start","id":"a"}"#)
    try message.receive(#"{"type":"text-delta","id":"a","delta":"Partial"}"#)
    #expect(throws: ChatServiceError.unexpectedResponse("Provider failed")) {
      try message.receive(#"{"type":"error","errorText":"Provider failed"}"#)
    }
    #expect(message.text == "Partial")
    #expect(!message.finished)
  }

  @Test func sendUsesOneUserUIMessageAndWorkspaceHeader() async throws {
    let stream = "data: {\"type\":\"start\",\"messageId\":\"answer\"}\n\ndata: [DONE]\n\n"
    let transport = TestTransport([(200, stream)])
    let body = try await ChatService().startDirectStream(
      client: makeTestClient(transport), roomId: testRoomId, organizationSlug: "team",
      messageId: "turn", text: "Hello"
    )
    #expect(try await String(collecting: body, upTo: 1024) == stream)
    let request = try #require(transport.requests.first)
    #expect(request.operationID == "post/chats/rooms/{id}/stream")
    #expect(testOrgSlugHeader(request.request) == "team")
    let json = try testRequestJSON(#require(transport.bodies.first))
    #expect(json["roomId"] as? String == testRoomId)
    #expect(json["id"] as? String == testRoomId)
    #expect(json["parentMessageId"] == nil)
    let messages = try #require(json["messages"] as? [[String: Any]])
    #expect(messages.count == 1)
    #expect(messages.first?["id"] as? String == "turn")
    #expect(messages.first?["role"] as? String == "user")
    #expect(messages.first?["parts"] as? [[String: String]] == [["type": "text", "text": "Hello"]])
  }

  @Test func idleResumeHasNoStreamAndPersonalOmitsWorkspace() async throws {
    let transport = TestTransport([(204, "")])
    let body = try await ChatService().resumeDirectStream(
      client: makeTestClient(transport), roomId: testRoomId, organizationSlug: nil
    )
    #expect(body == nil)
    let request = try #require(transport.requests.first)
    #expect(request.operationID == "get/chats/rooms/{id}/stream/active")
    #expect(testOrgSlugHeader(request.request) == nil)
  }

  @Test func heldLockReturnsCoreErrorWithoutRetrying() async throws {
    let message = "A coworker response is already in progress for this room."
    let transport = TestTransport([(409, """
    {"error":"Conflict","message":"\(message)","meta":{"timestamp":"\(testTimestamp)","requestId":"req","path":"/v1/chats/rooms/room/stream","method":"POST"}}
    """)])
    let client = try makeTestClient(transport)
    await #expect(throws: ChatServiceError.unprocessable(statusCode: 409, message: message)) {
      _ = try await ChatService().startDirectStream(
        client: client, roomId: testRoomId, organizationSlug: nil, messageId: "turn", text: "Hello"
      )
    }
    #expect(transport.requests.count == 1)
  }
}
