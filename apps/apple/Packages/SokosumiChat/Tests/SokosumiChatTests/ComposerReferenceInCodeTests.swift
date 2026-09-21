import Foundation
import SokosumiChat
import Testing

/// A reference chip is one U+FFFC in the editor. Web's serializer reads a `pre` as the text
/// it shows, so a chip in a fence is sent as its label. Neither client may send the
/// replacement character.
struct ComposerReferenceInCodeTests {
  private var mention: NSAttributedString {
    ComposerReferenceText.chip(token: "@user-1:alice", name: "@Alice Example")
  }

  private var channel: NSAttributedString {
    ComposerReferenceText.chip(token: "#general", name: "#general")
  }

  private func text(_ parts: [NSAttributedString], adding attributes: [NSAttributedString.Key: Any]) -> NSAttributedString {
    let output = NSMutableAttributedString(string: "")
    parts.forEach(output.append)
    output.addAttributes(attributes, range: NSRange(location: 0, length: output.length))
    return output
  }

  private var parts: [NSAttributedString] {
    [NSAttributedString(string: "hi "), mention, NSAttributedString(string: " in "), channel]
  }

  @Test func aChipOutsideCodeIsStillSentAsItsToken() {
    let source = text(parts + [NSAttributedString(string: "\n")], adding: [ComposerBlockText.path: ["0:p"]])
    #expect(ComposerBlockText.document(source).markdown == "hi @user-1:alice in #general\n")
  }

  @Test func aChipInAFenceIsSentAsTheLabelItShows() throws {
    let source = text(parts + [NSAttributedString(string: "\n")], adding: [ComposerBlockText.path: ["0:c:"]])
    let markdown = ComposerBlockText.document(source).markdown
    #expect(markdown == "```\nhi @Alice Example in #general\n```\n")
    #expect(!markdown.contains("\u{FFFC}"))
    let restored = try ComposerBlockText.attributedText(ComposerDocument(markdown: markdown))
    #expect(ComposerBlockText.document(restored).markdown == markdown)
  }

  @Test func aChipInAFenceInsideAQuoteIsSentAsItsLabel() {
    let source = text([mention, NSAttributedString(string: "\n")], adding: [ComposerBlockText.path: ["0:q", "0:c:swift"]])
    #expect(ComposerBlockText.document(source).markdown == "> ```swift\n> @Alice Example\n> ```\n")
  }

  @Test func twoIdenticalChipsSideBySideAreBothSent() {
    let source = text([mention, mention, NSAttributedString(string: "\n")], adding: [ComposerBlockText.path: ["0:c:"]])
    #expect(ComposerBlockText.document(source).markdown == "```\n@Alice Example@Alice Example\n```\n")
  }

  /// Inline code never wrote the replacement character: a chip ends the code run and is sent
  /// as its token, so it stays a live mention. Web keeps the token inside the backticks
  /// (`so `hi @user-1:alice in #general` end`); that difference is recorded, not changed here.
  @Test func aChipInInlineCodeIsSentAsItsTokenAndNeverAsTheReplacementCharacter() throws {
    let code = text(parts, adding: [ComposerInlineText.code: true])
    let source = text([NSAttributedString(string: "so "), code, NSAttributedString(string: " end\n")], adding: [ComposerBlockText.path: ["0:p"]])
    let markdown = ComposerBlockText.document(source).markdown
    #expect(markdown == "so `hi` @user-1:alice `in` #general end\n")
    #expect(!markdown.contains("\u{FFFC}"))
    let restored = try ComposerBlockText.attributedText(ComposerDocument(markdown: markdown))
    #expect(ComposerBlockText.document(restored).markdown == markdown)
  }

  @Test func inlineCodeWithoutAChipIsUnchanged() {
    let code = NSAttributedString(string: "let x", attributes: [ComposerInlineText.code: true, ComposerInlineText.link: "https://example.com/"])
    let source = text([NSAttributedString(string: "so "), code, NSAttributedString(string: "\n")], adding: [ComposerBlockText.path: ["0:p"]])
    #expect(ComposerBlockText.document(source).markdown == "so [`let x`](https://example.com/)\n")
  }
}
