import SokosumiChat
import Testing

@MainActor struct ChatReadRateLimitTests {
  @Test func documentedReadLimitsPreserveServiceErrors() async throws {
    let transport = TestTransport(Array(repeating: (429, #"{"error":"Too Many Requests","message":"Slow down","retryAfterSeconds":7,"meta":{"timestamp":"2026-01-01T00:00:00.000Z","requestId":"req","path":"/v1/chats/rooms/room/messages","method":"GET"}}"#), count: 4))
    let client = try makeTestClient(transport)
    let error = ChatServiceError.unprocessable(statusCode: 429, message: "Slow down")
    await #expect(throws: error) {
      try await ChatService().listMessages(client: client, roomId: testRoomId, organizationSlug: nil)
    }
    await #expect(throws: error) {
      try await ChatService().listThreadMessages(client: client, roomId: testRoomId, parentMessageId: "parent", organizationSlug: nil)
    }
    await #expect(throws: error) {
      try await ChatService().getMessage(client: client, roomId: testRoomId, messageId: "message", organizationSlug: nil)
    }
    await #expect(throws: error) {
      try await ChatService().listPinnedMessages(client: client, roomId: testRoomId, organizationSlug: nil)
    }
  }
}
