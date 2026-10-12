import Foundation
import SokosumiChat
import Testing

/// Row 15c (web #5495, `standaloneLinks` in room-message-segments.ts): a file link becomes a card only on a line of
/// its own, or on a line holding nothing but file links. Anywhere else it stays a link in the text: no tile, no
/// gallery image, no large solo image, and the body does not end in an attachment. Fixed URLs, no clock or ids.
struct MessageInlineFileLinkTests {
  private static func texts(_ blocks: [MessageMarkdownBlock]) -> [AttributedString] {
    blocks.flatMap { [$0.text] + texts($0.children) }
  }

  /// Every link the text segments draw, in order.
  private static func links(_ document: MessageMarkdown) -> [String] {
    texts(document.segments.flatMap(\.blocks)).flatMap { $0.runs.compactMap(\.link?.absoluteString) }
  }

  /// Everything the body draws as a tile or a preview: the runs' cards and what a text block splits out.
  private static func tiles(_ document: MessageMarkdown) -> [String] {
    document.segments.flatMap(\.attachments).map(\.filename)
      + texts(document.segments.flatMap(\.blocks)).flatMap { MessageAttachmentSegment.split($0).compactMap(\.attachment?.filename) }
  }

  private static func kinds(_ document: MessageMarkdown) -> [String] {
    document.segments.map { $0.files.isEmpty ? "text" : "files" }
  }

  /// Web: "keeps a file link inside a sentence as text".
  @Test func keepsAFileLinkInsideASentenceAsText() {
    let document = MessageMarkdown("It's in your Files as [r3-notes.md](https://cdn.example/r3-notes.md).")
    #expect(Self.kinds(document) == ["text"])
    #expect(Self.tiles(document).isEmpty)
    #expect(Self.links(document) == ["https://cdn.example/r3-notes.md"])
  }

  /// Web: "cards a file link on its own line after prose".
  @Test func cardsAFileLinkOnItsOwnLineAfterProse() {
    let document = MessageMarkdown("Uploaded file r3-notes.md.\n[r3-notes.md](https://cdn.example/r3-notes.md)")
    #expect(Self.kinds(document) == ["text", "files"])
    #expect(document.segments.last?.attachments.map(\.filename) == ["r3-notes.md"])
  }

  /// Web: "cards several file links sharing one line".
  @Test func cardsSeveralFileLinksSharingOneLine() {
    let document = MessageMarkdown("[a.png](https://cdn.example/a.png) [b.png](https://cdn.example/b.png)")
    #expect(Self.kinds(document) == ["files"])
    #expect(document.segments.first?.attachments.map(\.filename) == ["a.png", "b.png"])
  }

  /// A list, quote or heading marker, a table cell's pipes or an ordinary link share the line, so the file link
  /// stays a link where the Markdown puts it.
  @Test(arguments: [
    "- [notes.pdf](https://cdn.example/notes.pdf)",
    "1. [notes.pdf](https://cdn.example/notes.pdf)",
    "> [notes.pdf](https://cdn.example/notes.pdf)",
    "## [notes.pdf](https://cdn.example/notes.pdf)",
    "| File |\n| --- |\n| [notes.pdf](https://cdn.example/notes.pdf) |",
    "[notes.pdf](https://cdn.example/notes.pdf) [site](https://example.com/)"
  ])
  func anythingElseOnTheLineKeepsTheFileLinkALink(source: String) {
    let document = MessageMarkdown(source)
    #expect(Self.kinds(document) == ["text"])
    #expect(Self.tiles(document).isEmpty)
    #expect(Self.links(document).contains("https://cdn.example/notes.pdf"))
    #expect(!MessageMarkdown.endsWithAttachmentRun(source))
  }

  /// The line rule decides each line on its own: a lone link on the next line is still a card.
  @Test func eachLineIsDecidedOnItsOwn() {
    let document = MessageMarkdown("- [a.pdf](https://cdn.example/a.pdf)\n\n[b.pdf](https://cdn.example/b.pdf)")
    #expect(Self.kinds(document) == ["text", "files"])
    #expect(Self.tiles(document) == ["b.pdf"])
  }

  /// A Markdown image's `!` shares its line, so web renders it as the Markdown image it is, never as a card.
  /// Apple draws that embedded image from the text, as it draws an HTML `<img>`.
  @Test func aMarkdownImageIsNoCard() {
    let source = "![photo](https://cdn.example/photo.png)"
    let document = MessageMarkdown(source)
    #expect(Self.kinds(document) == ["text"])
    #expect(Self.tiles(document) == ["photo"])
    #expect(!MessageMarkdown.endsWithAttachmentRun(source))
  }

  /// Web's gallery and large-solo-image rule read the cards only: an image linked inside a sentence is neither.
  @Test func anInlineImageLinkIsNoTileGalleryImageOrSoloImage() {
    let inline = MessageMarkdown("Here is [a.png](https://cdn.example/a.png) for you.")
    #expect(Self.tiles(inline).isEmpty)
    #expect(inline.imageGallery.images.isEmpty)
    #expect(inline.clampsLongBody, "No solo image exempts the body from the clamp")

    let mixed = MessageMarkdown("Here is [a.png](https://cdn.example/a.png) for you.\n\n[b.png](https://cdn.example/b.png)")
    #expect(Self.tiles(mixed) == ["b.png"])
    #expect(mixed.imageGallery.images.map(\.filename) == ["b.png"])
    #expect(mixed.segments.last?.usesLargeImage == true)
    #expect(!mixed.clampsLongBody)
  }

  /// Row 31b3's rule follows the body: one ending in an inline file link ends in text, as on web.
  @Test(arguments: [
    "It's in your Files as [notes.pdf](https://cdn.example/notes.pdf)",
    "[a.png](https://cdn.example/a.png)\nSaved as [notes.pdf](https://cdn.example/notes.pdf)"
  ])
  func aBodyEndingInAnInlineFileLinkEndsInText(source: String) {
    #expect(!MessageMarkdown.endsWithAttachmentRun(source))
    #expect(MessageMarkdown(source).segments.last?.files.isEmpty == true, "Agrees with what the row draws")
  }

  /// Web judges a line and a gap with JavaScript's `\s`: U+FEFF counts as whitespace, U+0085 does not (Swift's
  /// `isWhitespace` says the opposite for both).
  @Test func whitespaceIsJavaScriptWhitespace() {
    let link = "[notes.pdf](https://cdn.example/notes.pdf)"
    #expect(Self.kinds(MessageMarkdown("\u{FEFF}" + link)) == ["files"], "A line otherwise U+FEFF is a card")
    #expect(Self.kinds(MessageMarkdown("\u{85}" + link)) == ["text"], "A line otherwise U+0085 keeps a link")
    let joined = MessageMarkdown("[a.png](https://cdn.example/a.png)\n\u{FEFF}\n[b.png](https://cdn.example/b.png)")
    #expect(joined.segments.map { $0.attachments.map(\.filename) } == [["a.png", "b.png"]], "A U+FEFF gap joins one run")
    #expect(MessageMarkdown.endsWithAttachmentRun(link + "\n\u{FEFF}"))
    #expect(!MessageMarkdown.endsWithAttachmentRun(link + "\n\u{85}"))
  }

  /// Web cards Markdown links only: a bare domain, a bare URL or an autolink to a file is a link on any line.
  @Test(arguments: [
    "cdn.example.com/notes.pdf",
    "https://cdn.example/notes.pdf",
    "<https://cdn.example/notes.pdf>"
  ])
  func aBareFileAddressIsNeverACard(source: String) {
    let document = MessageMarkdown(source)
    #expect(Self.kinds(document) == ["text"])
    #expect(Self.tiles(document).isEmpty)
    #expect(!MessageMarkdown.endsWithAttachmentRun(source))
  }
}
