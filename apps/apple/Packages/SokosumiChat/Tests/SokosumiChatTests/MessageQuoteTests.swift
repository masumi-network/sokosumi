import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

struct MessageQuoteTests {
  private func message(_ content: String) -> Components.Schemas.ChatRoomMessage {
    var message = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: testRoomId, content: content,
                                              sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
    message.id = "550e8400-e29b-41d4-a716-446655440123"
    return message
  }

  @Test func previewPrefersImageAndRetainsOtherContent() throws {
    let quote = try #require(messageQuote(from: message("**Report**\n\n[report.pdf](https://example.com/report.pdf)\n\n[chart.png](https://example.com/chart.png)")))
    #expect(quote.authorName == "Ada")
    #expect(quote.attachment?.fileName == "chart.png")
    #expect(quote.attachment?.mediaKind == .image)
    #expect(quote.snippet.contains("Report"))
    #expect(quote.snippet.contains("report.pdf"))
    #expect(!quote.snippet.contains("chart.png"))
    #expect(!quote.snippet.contains("**"))
  }

  @Test func rejectsDeletedAndLocalRowsButAllowsThreadReplies() {
    var row = message("hello")
    row.parentMessageId = "parent"
    #expect(canQuoteMessage(row))
    row.deletedAt = Date()
    #expect(messageQuote(from: row) == nil)
    row.deletedAt = nil
    row.id = "stream:turn"
    #expect(messageQuote(from: row) == nil)
    row.id = "pending:turn"
    #expect(messageQuote(from: row) == nil)
  }

  @Test func pendingShellRetainsQuoteAcrossFailureAndRetry() throws {
    let quote = try #require(messageQuote(from: message("original")))
    let shell = OutboundShell(clientTurnId: "turn", roomId: testRoomId, content: "answer", quote: quote,
                              sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online))
    let failed = failOutbound(shells: [shell], clientTurnId: "turn", errorMessage: "offline")
    let retry = try #require(markOutboundPending(shells: failed, clientTurnId: "turn").first)
    #expect(chatRoomMessage(from: retry).quote == quote)
    #expect(retry.parentMessageId == nil)
  }

  @Test(arguments: [false, true])
  func classicRequestSendsOnlyQuoteID(thread: Bool) async throws {
    let transport = TestTransport([(201, testCreatedMessageBody(id: testRoomId, content: "answer", clientMessageId: "turn"))])
    _ = try await ChatService().createMessage(client: makeTestClient(transport), roomId: testRoomId, content: "answer",
                                              clientMessageId: "turn", parentMessageId: thread ? testRoomId : nil,
                                              quoteMessageId: "source", organizationSlug: "team")
    let body = try testRequestJSON(#require(transport.bodies.first))
    #expect(body["quote"] as? [String: String] == ["messageId": "source"])
    #expect(body["parentMessageId"] as? String == (thread ? testRoomId : nil))
    #expect(testOrgSlugHeader(transport.requests[0].request) == "team")
  }

  @Test(arguments: [false, true])
  func streamRequestSendsQuoteWithoutChangingThreadScope(thread: Bool) async throws {
    let transport = TestTransport([(200, "data: [DONE]\n\n")])
    _ = try await ChatService().startDirectStream(client: makeTestClient(transport), roomId: testRoomId,
                                                  organizationSlug: nil, messageId: "turn", text: "answer",
                                                  parentMessageId: thread ? testRoomId : nil, quoteMessageId: "source")
    let body = try testRequestJSON(#require(transport.bodies.first))
    #expect(body["quote"] as? [String: String] == ["messageId": "source"])
    #expect(body["parentMessageId"] as? String == (thread ? testRoomId : nil))
  }
}
