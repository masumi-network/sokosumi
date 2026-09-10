@testable import SokosumiChat
import Testing

struct MessageMarkdownNormalizationTests {
  @Test func movesWhitespaceOutsideFormattingMarkers() {
    #expect(MessageMarkdownNormalization.applying(to: "A ** bold ** and ~~ old ~~ with _ italic _.") ==
      "A  **bold**  and  ~~old~~  with  _italic_ .")
    #expect(MessageMarkdownNormalization.applying(to: "**\u{FEFF}bold\u{FEFF}**") == "\u{FEFF}**bold**\u{FEFF}")
  }

  @Test func preservesEscapedUnderscoreAndIncompleteDelimiters() {
    #expect(MessageMarkdownNormalization.applying(to: #"A \_ literal _ and **unfinished"#) ==
      #"A \_ literal _ and **unfinished"#)
  }

  @Test func matchesWebNormalizationInsideFences() {
    let source = "~~~text\n** padded **\n~~~"
    #expect(MessageMarkdownNormalization.applying(to: source) == "~~~text\n **padded** \n~~~")
  }

  @Test func looseFormattingRendersWithEmphasis() throws {
    let message = MessageMarkdown("A ** bold ** result.")
    let text = try #require(message.blocks.first?.text)
    #expect(String(text.characters) == "A  bold  result.")
    #expect(text.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
  }
}
