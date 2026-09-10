import Foundation
@testable import SokosumiChat
import Testing

struct MessageInlineHTMLTests {
  @Test func formatsNestedInlineTagsAndBreaks() throws {
    let markdown = MessageMarkdown("Text <b>bold <i>both</i></b> <u>under</u><br>next")
    let text = try #require(markdown.blocks.first?.text)
    #expect(String(text.characters) == "Text bold both under\nnext")
    #expect(text.runs.contains { run in
      String(text[run.range].characters) == "both" && run.inlinePresentationIntent?.contains([.stronglyEmphasized, .emphasized]) == true
    })
    #expect(text.runs.contains { run in
      String(text[run.range].characters) == "under" && run[MessageUnderlineAttribute.self] == true
    })
    #expect(text.runs.last?[MessageUnderlineAttribute.self] != true)
  }

  @Test func leavesEscapedAndCodeTagsLiteral() throws {
    let markdown = MessageMarkdown("Text `<u>code</u>` and \\<b>escaped\\</b>")
    let text = try #require(markdown.blocks.first?.text)
    #expect(String(text.characters) == "Text <u>code</u> and <b>escaped</b>")
    #expect(!text.runs.contains { $0[MessageUnderlineAttribute.self] == true })
    #expect(!text.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
  }

  @Test func underlinedTaskMarkerRemainsLiteral() throws {
    let markdown = MessageMarkdown("- <u>[x] Literal</u>")
    let item = try #require(markdown.blocks.first?.children.first)
    #expect(item.taskChecked == nil)
    #expect(item.children.first.map { String($0.text.characters) } == "[x] Literal")
  }

  @Test func handlesCaseAttributesAndRepeatedTags() throws {
    let markdown = MessageMarkdown("Text <U class=\"ignored\">one <u>two</u> three</U> plain")
    let text = try #require(markdown.blocks.first?.text)
    #expect(String(text.characters) == "Text one two three plain")
    let underlined = text.runs.filter { $0[MessageUnderlineAttribute.self] == true }
      .map { String(text[$0.range].characters) }.joined()
    #expect(underlined == "one two three")
  }
}
