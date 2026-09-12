import CoreAPI
import Foundation
import SokosumiChat
import Testing

@MainActor
struct MessageDeletionTests {
  @Test(arguments: [false, true])
  func deleteUsesExistingEndpointAndWorkspaceScope(organization: Bool) async throws {
    let id = "550e8400-e29b-41d4-a716-446655440123"
    let body = testCreatedMessageBody(id: id, content: "", clientMessageId: "turn")
      .replacingOccurrences(of: "\"deletedAt\":null", with: "\"deletedAt\":\"2026-01-02T00:00:00.000Z\"")
    let transport = TestTransport([(200, body)])
    let result = try await ChatService().deleteMessage(client: makeTestClient(transport), roomId: testRoomId,
                                                       messageId: id, organizationSlug: organization ? "team" : nil)
    #expect(result.id == id)
    #expect(result.deletedAt != nil)
    #expect(transport.requests[0].request.method == .delete)
    #expect(transport.requests[0].request.path?.contains("/\(testRoomId)/messages/\(id)") == true)
    #expect(testOrgSlugHeader(transport.requests[0].request) == (organization ? "team" : nil))
  }

  @Test(arguments: [401, 403, 404, 500])
  func deletionReportsServerFailures(status: Int) async throws {
    let transport = TestTransport([(status, "{\"message\":\"Deletion denied\"}")])
    await #expect(throws: (any Error).self) {
      try await ChatService().deleteMessage(client: makeTestClient(transport), roomId: testRoomId,
                                            messageId: "message", organizationSlug: nil)
    }
  }

  @Test func replyCountIsNotDecrementedTwice() {
    var parent = chatRoomMessage(from: .init(clientTurnId: "parent", roomId: testRoomId, content: "Parent",
                                             sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
    parent.id = "parent"
    parent.threadReplyCount = 2
    parent.threadLastReplyAt = Date()
    let once = applyingReplyDeletion(to: parent, parentId: "parent", previousReplyCount: 2)
    #expect(once.threadReplyCount == 1)
    #expect(once.threadLastReplyAt == parent.threadLastReplyAt)
    #expect(applyingReplyDeletion(to: once, parentId: "parent", previousReplyCount: 2).threadReplyCount == 1)
    #expect(applyingReplyDeletion(to: parent, parentId: "other", previousReplyCount: 2).threadReplyCount == 2)
    let last = applyingReplyDeletion(to: once, parentId: "parent", previousReplyCount: 1)
    #expect(last.threadReplyCount == 0)
    #expect(last.threadLastReplyAt == nil)
  }

  @Test func modificationsRequireOwnPersistedHumanMessage() {
    var message = chatRoomMessage(from: .init(clientTurnId: "pending", roomId: testRoomId, content: "Message",
                                              sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
    #expect(!canModifyOwnMessage(message, userId: "user"))
    message.id = "persisted"
    #expect(canModifyOwnMessage(message, userId: "user"))
    #expect(!canModifyOwnMessage(message, userId: "other"))
    #expect(!canModifyOwnMessage(message, userId: ""))
    message.deletedAt = Date()
    #expect(!canModifyOwnMessage(message, userId: "user"))
  }
}
