import CoreAPI
import Foundation
import SokosumiChat
import Testing

/// Web: `quoteOnly = message.content.trim().length === 0 ? message.quote : null`
/// (pinned-messages-panel.tsx). The quote replaces a blank body and never joins a written one.
struct PinnedMessagePreviewTests {
  private let quote = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: "Ada Lovelace",
                                                              snippet: "Ship it on Friday")

  @Test func aWrittenBodyIsShownAndItsQuoteIsNot() {
    let preview = PinnedMessagePreview(content: "Agreed.", quote: quote)
    #expect(preview == .body("Agreed."))
    #expect(preview.source == "Agreed.")
    #expect(preview.quotedAuthor == nil)
    #expect(preview.accessibilityLabel == nil)
  }

  @Test(arguments: ["", " ", "\n", " \t\r\n ", "\u{00A0}", "\u{2028}\u{2029}", "\u{FEFF}", "\u{3000}"])
  func aBlankBodyFallsBackToTheQuote(content: String) {
    let preview = PinnedMessagePreview(content: content, quote: quote)
    #expect(preview == .quote(author: "Ada Lovelace", snippet: "Ship it on Friday"))
    #expect(preview.source == "Ship it on Friday")
    #expect(preview.quotedAuthor == "Ada Lovelace")
  }

  /// JavaScript's `trim` leaves these alone, so web shows the body.
  @Test(arguments: ["\u{0085}", "\u{200B}", " . "])
  func whatJavaScriptDoesNotTrimIsABody(content: String) {
    #expect(PinnedMessagePreview(content: content, quote: quote) == .body(content))
  }

  @Test func aBlankBodyWithoutAQuoteStaysTheBlankBody() {
    #expect(PinnedMessagePreview(content: "", quote: nil) == .body(""))
    #expect(PinnedMessagePreview(content: " \n", quote: nil) == .body(" \n"))
    #expect(PinnedMessagePreview(content: "", quote: nil).accessibilityLabel == nil)
  }

  /// Core writes "Someone" into the snapshot when the quoted sender is unknown; web prints
  /// `authorName` as stored and has no fallback of its own, so neither does Apple.
  @Test(arguments: ["Someone", ""])
  func theQuotedAuthorIsPrintedAsStored(author: String) {
    let stored = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: author, snippet: "Hello")
    let preview = PinnedMessagePreview(content: "", quote: stored)
    #expect(preview == .quote(author: author, snippet: "Hello"))
    #expect(preview.quotedAuthor == author)
  }

  /// A quoted attachment-only message has an empty snippet; web prints the author over an empty block.
  @Test func anEmptySnippetKeepsTheQuotedAuthor() {
    let stored = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: "Ada Lovelace", snippet: "")
    let preview = PinnedMessagePreview(content: "", quote: stored)
    #expect(preview == .quote(author: "Ada Lovelace", snippet: ""))
    #expect(preview.source.isEmpty)
    #expect(preview.accessibilityLabel == "Quote from Ada Lovelace")
  }

  @Test func theSpokenTextNamesTheQuotedAuthorAndTheSnippet() {
    #expect(PinnedMessagePreview(content: " ", quote: quote).accessibilityLabel
      == "Quote from Ada Lovelace: Ship it on Friday")
    let padded = Components.Schemas.ChatRoomMessageQuote(messageId: "source", authorName: "", snippet: " Hello\n")
    #expect(PinnedMessagePreview(content: "", quote: padded).accessibilityLabel == "Quote: Hello")
  }

  /// The pin list carries the stored snapshot, so a pin still shows its quote after the quoted message is gone.
  @Test func aListedPinDecodesToItsQuote() throws {
    let listed = chatRoomMessage(from: .init(clientTurnId: "turn", roomId: testRoomId, content: "",
                                             quote: .init(messageId: "gone", authorName: "Ada Lovelace", snippet: "Ship it"),
                                             sender: .init(id: "user", name: "Grace", email: "grace@example.com", presence: .online)))
    let message = try JSONDecoder().decode(Components.Schemas.ChatRoomPinnedMessageListItem.MessagePayload.self,
                                           from: JSONEncoder().encode(listed))
    #expect(PinnedMessagePreview(message) == .quote(author: "Ada Lovelace", snippet: "Ship it"))
  }
}
