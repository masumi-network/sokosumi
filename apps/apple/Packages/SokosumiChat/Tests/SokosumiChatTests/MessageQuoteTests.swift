import CoreAPI
import Foundation
@testable import SokosumiChat
import Testing

struct MessageQuoteTests {
  private func message(_ content: String) -> Components.Schemas.ChatRoomMessage {
    var message = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: testRoomId, content: content,
                                              createdAt: Date(),
                                              sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online)))
    message.id = "550e8400-e29b-41d4-a716-446655440123"
    return message
  }

  /// Web's `FileChipMiniPreview`: an image and a document open a viewer, and anything else is a link.
  @Test(arguments: [
    ("one.png", Components.Schemas.ChatRoomMessageQuoteAttachment.MediaKindPayload.image, MessageAttachment.Opening.imageViewer),
    ("no-extension", .image, .imageViewer),
    ("notes.pdf", .file, .documentViewer),
    ("notes.md", .file, .documentViewer),
    ("budget.xlsx", .file, .documentViewer),
    ("bundle.zip", .file, .link),
    ("clip.mp4", .file, .link),
    ("memo.mp3", .file, .link)
  ])
  func aQuoteTileOpensWhatWebsDoes(name: String, kind: Components.Schemas.ChatRoomMessageQuoteAttachment.MediaKindPayload, opening: MessageAttachment.Opening) throws {
    let attachment = Components.Schemas.ChatRoomMessageQuoteAttachment(fileName: name, url: "https://example.com/\(name)", mediaKind: kind)
    #expect(try #require(attachment.preview).opening == opening)
  }

  /// A document's name opens its viewer when its URL has no extension.
  @Test func aQuoteTileReadsItsNameWhenItsURLHasNoExtension() throws {
    let attachment = Components.Schemas.ChatRoomMessageQuoteAttachment(fileName: "notes.pdf", url: "https://example.com/deliverables/1", mediaKind: .file)
    #expect(try #require(attachment.preview).opening == .documentViewer)
  }

  @Test(arguments: ["file:///etc/notes.pdf", "javascript:alert(1)", "notes.pdf"])
  func aQuoteTileWithNoWebAddressHasNothingToOpen(url: String) {
    #expect(Components.Schemas.ChatRoomMessageQuoteAttachment(fileName: "notes.pdf", url: url, mediaKind: .file).preview == nil)
  }

  @Test func previewLiftsEveryFileLinkInBodyOrder() throws {
    let quote = try #require(messageQuote(from: message("**Report**\n\n[report.pdf](https://example.com/report.pdf)\n\n[chart.png](https://example.com/chart.png)")))
    #expect(quote.authorName == "Ada")
    #expect(quote.attachments == [
      .init(fileName: "report.pdf", url: "https://example.com/report.pdf", mediaKind: .file),
      .init(fileName: "chart.png", url: "https://example.com/chart.png", mediaKind: .image)
    ])
    #expect(quote.snippet == "Report")
  }

  /// `buildRoomQuoteSnippetParts`: a sentence loses its file links, and a file linked twice is one attachment.
  @Test func previewSnippetHoldsNoFileNameAndAFileLinkedTwiceIsOne() throws {
    let quote = try #require(messageQuote(from: message(
      "see [notes.pdf](https://example.com/notes.pdf) and [shot.png](https://example.com/shot.png), again [notes.pdf](https://example.com/notes.pdf)"
    )))
    #expect(quote.attachments?.map(\.fileName) == ["notes.pdf", "shot.png"])
    #expect(quote.snippet == "see and , again")
  }

  /// `buildRoomQuoteSnippetParts` deletes the link and leaves the lines around it.
  @Test func previewKeepsTheLinesAroundALiftedLink() throws {
    let quote = try #require(messageQuote(from: message(
      "first\n[a.png](https://example.com/a.png)\nsecond\n[b.png](https://example.com/b.png)\nthird"
    )))
    #expect(quote.attachments?.map(\.fileName) == ["a.png", "b.png"])
    #expect(quote.snippet == "first\n\nsecond\n\nthird")
  }

  @Test func previewKeepsEveryImageOfAnImageOnlyMessage() throws {
    let names = ["a.png", "b.png", "c.png", "d.png"]
    let quote = try #require(messageQuote(from: message(names.map { "[\($0)](https://example.com/\($0))" }.joined(separator: "\n\n"))))
    #expect(quote.attachments?.map(\.fileName) == names)
    #expect(quote.attachments?.allSatisfy { $0.mediaKind == .image } == true)
    #expect(quote.snippet.isEmpty)
  }

  @Test func previewOfPlainTextHasNoAttachmentsAndKeepsAWebLink() throws {
    let quote = try #require(messageQuote(from: message("read [the docs](https://example.com/docs)")))
    #expect(quote.attachments?.isEmpty == true)
    #expect(quote.snippet == "read the docs")
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
                              createdAt: Date(),
                              sender: .init(id: "user", name: "Ada", email: "ada@example.com", presence: .online))
    let failed = failOutbound(shells: [shell], clientTurnId: "turn", errorMessage: "offline")
    let retry = try #require(markOutboundPending(shells: failed, clientTurnId: "turn").first)
    #expect(chatRoomMessage(from: retry).quote == quote)
    #expect(retry.parentMessageId == nil)
  }

  @Test func sentToSelfQuoteLinksToItsSourceRoomOnly() throws {
    let base = try #require(URL(string: "https://app.sokosumi.com"))
    let saved = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: "Ada", snippet: "Keep", roomId: "other-room")
    #expect(quoteSourceURL(saved, inRoom: testRoomId, webBaseURL: base)?.absoluteString
      == "https://app.sokosumi.com/chat/rooms/other-room?message=source")
    #expect(quoteSourceURL(saved, inRoom: "other-room", webBaseURL: base) == nil)
    let sameRoom = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: "Ada", snippet: "Keep")
    #expect(quoteSourceURL(sameRoom, inRoom: testRoomId, webBaseURL: base) == nil)
  }

  @Test func sendToSelfPostsTheSourceMessage() async throws {
    let transport = TestTransport([(201, testCreatedMessageBody(id: testRoomId, content: "", clientMessageId: "turn"))])
    let saved = try await ChatService().sendMessageToSelf(client: makeTestClient(transport), roomId: testRoomId,
                                                          messageId: "source", organizationSlug: "team")
    #expect(saved.id == testRoomId)
    #expect(transport.requests[0].request.path?.hasSuffix("/\(testRoomId)/messages/source/send-to-self") == true)
    #expect(testOrgSlugHeader(transport.requests[0].request) == "team")
  }

  @Test(arguments: [false, true])
  func classicRequestSendsOnlyQuoteID(thread: Bool) async throws {
    let transport = TestTransport([(201, testCreatedMessageBody(id: testRoomId, content: "answer", clientMessageId: "turn"))])
    _ = try await ChatService().createMessage(client: makeTestClient(transport), roomId: testRoomId, content: "answer",
                                              clientMessageId: "turn", parentMessageId: thread ? testRoomId : nil,
                                              quote: .init(messageId: "source", authorName: "Ada", snippet: "Keep"),
                                              organizationSlug: "team")
    let body = try testRequestJSON(#require(transport.bodies.first))
    #expect(body["quote"] as? [String: String] == ["messageId": "source"])
    #expect(body["parentMessageId"] as? String == (thread ? testRoomId : nil))
    #expect(testOrgSlugHeader(transport.requests[0].request) == "team")
  }

  @Test func classicRequestSendsTheSourceRoomOfACrossRoomQuote() async throws {
    let transport = TestTransport([(201, testCreatedMessageBody(id: testRoomId, content: "", clientMessageId: "turn"))])
    _ = try await ChatService().createMessage(client: makeTestClient(transport), roomId: testRoomId, content: "",
                                              clientMessageId: "turn",
                                              quote: .init(messageId: "source", authorName: "Ada", snippet: "Keep", roomId: "other-room"),
                                              organizationSlug: nil)
    let body = try testRequestJSON(#require(transport.bodies.first))
    #expect(body["quote"] as? [String: String] == ["messageId": "source", "roomId": "other-room"])
    // A quote can be the whole message.
    #expect((body["content"] as? String)?.isEmpty == true)
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
