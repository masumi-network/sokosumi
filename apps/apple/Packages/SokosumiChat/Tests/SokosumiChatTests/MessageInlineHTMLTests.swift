import Foundation
@testable import SokosumiChat
import Testing

struct MessageInlineHTMLTests {
  @Test func preservesImageLabelsAndSafeSourceLinks() throws {
    let baseURL = try #require(URL(string: "https://example.com"))
    for source in [
      "Before <img src='/chart.png' alt='Chart &amp; data'> after <img src='/empty.png'>",
      "<p>Before <img src='/chart.png' alt='Chart &amp; data'> after <img src='/empty.png'></p>"
    ] {
      let result = MessageMarkdown(source, baseURL: baseURL)
      let text = try #require(result.blocks.first?.text)
      #expect(String(text.characters) == "Before Chart & data after /empty.png")
      #expect(text.runs.compactMap(\.link).map(\.absoluteString) == [
        "https://example.com/chart.png", "https://example.com/empty.png"
      ])
    }
    let unsafe = MessageMarkdown("Before <img src='javascript:alert(1)' alt='Unsafe'>")
    let text = try #require(unsafe.blocks.first?.text)
    #expect(String(text.characters) == "Before Unsafe")
    #expect(text.runs.allSatisfy { $0.link == nil })
  }

  @Test func preservesMediaSourcesAsSafeLinks() throws {
    let baseURL = try #require(URL(string: "https://example.com"))
    let result = MessageMarkdown(
      "Watch <video src='/clip.mp4'></video> and <audio><source src='/sound.mp3'></audio> plus <video>fallback only</video>",
      baseURL: baseURL
    )
    let text = try #require(result.blocks.first?.text)
    #expect(String(text.characters) == "Watch /clip.mp4 and /sound.mp3 plus fallback only")
    #expect(text.runs.compactMap(\.link).map(\.absoluteString) == [
      "https://example.com/clip.mp4", "https://example.com/sound.mp3"
    ])
    let unsafe = MessageMarkdown("Before <video src='javascript:alert(1)'>Unsafe</video>")
    let unsafeText = try #require(unsafe.blocks.first?.text)
    #expect(String(unsafeText.characters) == "Before Unsafe")
    #expect(unsafeText.runs.allSatisfy { $0.link == nil })
  }

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
    #expect(item.children.first.map { String($0.text.characters) } == "[😆 Literal")
  }

  @Test func handlesCaseAttributesAndRepeatedTags() throws {
    let markdown = MessageMarkdown("Text <U class=\"ignored\">one <u>two</u> three</U> plain")
    let text = try #require(markdown.blocks.first?.text)
    #expect(String(text.characters) == "Text one two three plain")
    let underlined = text.runs.filter { $0[MessageUnderlineAttribute.self] == true }
      .map { String(text[$0.range].characters) }.joined()
    #expect(underlined == "one two three")
  }

  @Test func preservesMarkdownInsideHTMLAndRejectsUnsafeLinks() throws {
    let base = try #require(URL(string: "https://example.com"))
    let message = MessageMarkdown("Text <u>**bold**</u> <a href='/chat'>room</a> <a href='javascript:bad'>bad</a> <script>hidden</script>", baseURL: base)
    let text = try #require(message.blocks.first?.text)
    #expect(String(text.characters) == "Text bold room bad ")
    #expect(text.runs.contains { $0[MessageUnderlineAttribute.self] == true && $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
    #expect(text.runs.compactMap(\.link).map(\.absoluteString) == ["https://example.com/chat"])
  }

  @Test func rendersHTMLBlockStructureAndLiteralCode() {
    let message = MessageMarkdown("<h2>Report &amp; results</h2><p>First<br>Second</p><ol><li>One<ul><li>Nested</li></ul></li><li>Two</li></ol><p><code>  :smile: **literal**</code></p>")
    #expect(message.blocks.map(\.kind) == [.header(level: 2), .paragraph, .orderedList, .paragraph])
    #expect(String(message.blocks[0].text.characters) == "Report & results")
    #expect(String(message.blocks[1].text.characters) == "First\nSecond")
    #expect(message.blocks[2].children.map(\.kind) == [.listItem(ordinal: 1), .listItem(ordinal: 2)])
    #expect(message.blocks[2].children[0].children.map(\.kind) == [.paragraph, .unorderedList])
    #expect(String(message.blocks[3].text.characters) == "  :smile: **literal**")
    #expect(message.blocks[3].text.runs.first?.inlinePresentationIntent?.contains(.code) == true)
  }
}
