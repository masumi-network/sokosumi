import SokosumiChat
import Testing

struct ComposerDocumentTests {
  @Test func separatesMultilineCodeFromPrecedingText() throws {
    let document = ComposerDocument(blocks: [.paragraph([
      .text("Example:"), .code("first\nsecond"), .text("After")
    ])])
    #expect(document.markdown == "Example:\n```\nfirst\nsecond\n```\nAfter\n")
    let restored = try ComposerDocument(markdown: document.markdown)
    #expect(restored.blocks == [.paragraph([.text("Example:")]), .code("first\nsecond", language: ""), .paragraph([.text("After")])])
  }

  @Test func preservesBlankLinesAtDraftBoundaries() throws {
    for source in ["\n\n**hello**\n\n\n", "\n- item\n\n", "```\ncode\n```\n\n"] {
      let document = try ComposerDocument(markdown: source)
      #expect(document.markdown == source)
      #expect(try ComposerDocument(markdown: document.markdown) == document)
    }
  }

  @Test func preservesNestedListsAndMultilineItems() throws {
    let source = "- parent\n  continuation\n  - child\n- sibling\n"
    let document = try ComposerDocument(markdown: source)
    #expect(document.markdown == source)
    #expect(try ComposerDocument(markdown: document.markdown) == document)
  }

  @Test func preservesBlankLinesBetweenFormattedBlocks() throws {
    let source = "**First**\n\n\nSecond\n\n- item\n\n> quote\n"
    let document = try ComposerDocument(markdown: source)
    #expect(document.markdown == source)
    #expect(try ComposerDocument(markdown: document.markdown) == document)
  }

  @Test func restoresFormattedDraft() throws {
    let source = "**bold** _italic_ <u>underline</u> ~~old~~ `code` [site](https://example.com)\n"
    let document = try ComposerDocument(markdown: source)
    #expect(document.markdown == source)
    #expect(try ComposerDocument(markdown: document.markdown) == document)
  }

  @Test func restoresLinkedInlineCode() throws {
    let source = "[`site`](https://example.com)\n"
    let document = try ComposerDocument(markdown: source)
    #expect(document.blocks == [.paragraph([.link([.code("site")], destination: "https://example.com")])])
    #expect(document.markdown == source)
  }

  @Test func restoresBlockDrafts() throws {
    for source in [
      "1. one\n2. two\n", "- one\n- two\n", "> first\n> second\n",
      "````swift\n```literal```\n````\n", "### Heading\n"
    ] {
      let document = try ComposerDocument(markdown: source)
      #expect(document.markdown == source)
      #expect(try ComposerDocument(markdown: document.markdown) == document)
    }
  }

  @Test func refusesUnsupportedStructuresInsteadOfDroppingDraftContent() {
    #expect(throws: ComposerDocument.DecodingError.self) {
      try ComposerDocument(markdown: "![image](https://example.com/image.png)")
    }
    #expect(throws: ComposerDocument.DecodingError.self) {
      try ComposerDocument(markdown: "- [x] task")
    }
  }

  @Test func serializesInlineStylesWithWhitespaceOutsideMarkers() {
    let document = ComposerDocument(blocks: [.paragraph([
      .bold([.text(" hi ")]), .italic([.text("there")]),
      .underline([.text(" 👋 ")]), .strikethrough([.text("old")]),
      .code("value"), .bold([.text("   ")])
    ])])
    #expect(document.markdown == " **hi** _there_ <u>👋</u> ~~old~~`value`   \n")
  }

  @Test func serializesNestedStylesAndEscapedLinkDestinations() {
    let document = ComposerDocument(blocks: [.paragraph([
      .bold([.italic([.text("hello")])]),
      .link([.text("site")], destination: "https://example.com/a\\b)")
    ])])
    #expect(document.markdown == "**_hello_**[site](https://example.com/a\\\\b\\))\n")
  }

  @Test func serializesListsQuotesAndFencesLikeWeb() {
    let document = ComposerDocument(blocks: [
      .orderedList([[.paragraph([.text("one")])], [.paragraph([.text("two")])]]),
      .unorderedList([[.paragraph([.text("three")])]]),
      .quote([.paragraph([.text("first\nsecond")])]),
      .code("```literal```", language: " swift ")
    ])
    #expect(document.markdown == "1. one\n2. two\n- three\n> first\n> second\n````swift\n```literal```\n````\n")
  }

  @Test func normalizesEmptyEditorAndInvisibleCaretPlaceholders() {
    #expect(ComposerDocument(blocks: [.paragraph([.text(" \u{200B}\n")])]).markdown.isEmpty)
    #expect(ComposerDocument(blocks: [.paragraph([.text("a\r\nb")])]).markdown == "a\nb\n")
  }
}
