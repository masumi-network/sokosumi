import Foundation
@testable import SokosumiChat
import Testing

struct MessageMarkdownTests {
  @Test func imageLabelsKeepSafeDestinationsUntilPreviewRendering() throws {
    let baseURL = try #require(URL(string: "https://example.com"))
    let result = MessageMarkdown("![Chart](/chart.png) ![Unsafe](javascript:alert) ![](/empty.png)", baseURL: baseURL)
    let text = try #require(result.blocks.first?.text)
    #expect(String(text.characters) == "Chart Unsafe /empty.png")
    #expect(text.runs.compactMap(\.link).map(\.absoluteString) == [
      "https://example.com/chart.png", "https://example.com/empty.png"
    ])
  }

  @Test func recognizesTasksWithoutChangingEscapedOrCodeMarkers() throws {
    let result = MessageMarkdown("- [x] Done\n- [ ] **Open**\n- \\[x] Literal\n- `[x]` Code\n- [X]\tUppercase\n- **[x] Bold literal**")
    let items = try #require(result.blocks.first?.children)
    #expect(items.map(\.taskChecked) == [true, false, nil, nil, true, nil])
    #expect(items.compactMap(\.children.first).map { String($0.text.characters) }
      == ["Done", "Open", "[😆 Literal", "[x] Code", "Uppercase", "[😆 Bold literal"])
  }

  @Test func relativeLinksResolveAgainstConfiguredWebOrigin() throws {
    let baseURL = try #require(URL(string: "https://worktree.web.sokosumi.localhost"))
    let result = MessageMarkdown("[chat](/chat?room=123) [external](https://example.com) [unsafe](file:///tmp/test)", baseURL: baseURL)
    let text = try #require(result.blocks.first?.text)
    #expect(text.runs.compactMap(\.link).map(\.absoluteString) == [
      "https://worktree.web.sokosumi.localhost/chat?room=123", "https://example.com"
    ])
  }

  @Test func reportHeadingsAndEmphasis() throws {
    let result = MessageMarkdown("### Report\n\nFinished **analysis** with _results_ and ~~old data~~.")
    #expect(result.blocks.map(\.kind) == [.header(level: 3), .paragraph])
    let paragraph = try #require(result.blocks.last)
    #expect(String(paragraph.text.characters) == "Finished analysis with results and old data.")
    #expect(paragraph.text.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
    #expect(paragraph.text.runs.contains { $0.inlinePresentationIntent?.contains(.emphasized) == true })
    #expect(paragraph.text.runs.contains { $0.inlinePresentationIntent?.contains(.strikethrough) == true })
    #expect(paragraph.text.runs.allSatisfy { $0.presentationIntent == nil })
  }

  @Test func nestedListsKeepOrdinalsAndParagraphs() throws {
    let result = MessageMarkdown("3. First\n   - Nested\n\n     Another paragraph\n4. Second")
    let list = try #require(result.blocks.first)
    #expect(list.kind == .orderedList)
    #expect(list.children.map(\.kind) == [.listItem(ordinal: 3), .listItem(ordinal: 4)])
    let first = try #require(list.children.first)
    #expect(first.children.map(\.kind) == [.paragraph, .unorderedList])
    let nested = try #require(first.children.last?.children.first)
    #expect(nested.children.map { String($0.text.characters) } == ["Nested", "Another paragraph"])
  }

  @Test func softAndHardBreaksRemainVisible() {
    let result = MessageMarkdown("One\nTwo  \nThree")
    #expect(result.blocks.map { String($0.text.characters) } == ["One\nTwo\nThree"])
  }

  @Test func fencedCodePreservesLiteralMarkdownAndUnicode() throws {
    let result = MessageMarkdown("```swift\nlet greeting = \"👋 **hello** :smile:\"\n```")
    let code = try #require(result.blocks.first)
    #expect(code.kind == .codeBlock(languageHint: "swift"))
    #expect(String(code.text.characters) == "let greeting = \"👋 **hello** :smile:\"\n")
    #expect(code.text.runs.allSatisfy { $0.inlinePresentationIntent == nil })
  }

  @Test func tableRetainsAlignmentAndEmptyCellPositions() throws {
    let result = MessageMarkdown("| Left | Right |\n| :--- | ---: |\n| | Value |")
    let table = try #require(result.blocks.first)
    #expect(table.kind == .table(columns: [.init(alignment: .left), .init(alignment: .right)]))
    #expect(table.children.map(\.kind) == [.tableHeaderRow, .tableRow(rowIndex: 1)])
    let row = try #require(table.children.last)
    // Empty cells remain explicit nodes; their column indexes must not shift.
    #expect(row.children.map(\.kind) == [.tableCell(columnIndex: 0), .tableCell(columnIndex: 1)])
  }

  @Test func preservesEmptyBlocksInRenderedModel() throws {
    let result = MessageMarkdown("before\n\n```swift\n```\n\nafter")
    #expect(result.blocks.map(\.kind) == [.paragraph, .codeBlock(languageHint: "swift"), .paragraph])
    #expect(result.blocks[1].text.characters.isEmpty)
    let table = try #require(MessageMarkdown("| | |\n|---|---|\n| | |\n| x | y |\n| | |").blocks.first)
    #expect(table.children.count == 4)
    #expect(table.children.allSatisfy { $0.children.count == 2 })
    for index in [0, 1, 3] {
      let allCellsEmpty = table.children[index].children.allSatisfy(\.text.characters.isEmpty)
      #expect(allCellsEmpty)
    }
  }

  @Test func linksKeepLabelsButRejectExecutableSchemes() throws {
    let result = MessageMarkdown("[site](https://example.com) [bad](javascript:alert) [file](file:///tmp/test) [room](/chat)")
    let text = try #require(result.blocks.first?.text)
    #expect(String(text.characters) == "site bad file room")
    #expect(text.runs.compactMap(\.link).map(\.absoluteString) == ["https://example.com", "/chat"])
  }

  @Test func quoteAndRuleRemainSeparateBlocks() {
    let result = MessageMarkdown("> Quoted **text**\n\n---\n\nFollowing")
    #expect(result.blocks.map(\.kind) == [.blockQuote, .thematicBreak, .paragraph])
    #expect(result.blocks.first?.children.map { String($0.text.characters) } == ["Quoted text"])
  }

  @Test func incompleteStreamingMarkdownRemainsReadable() {
    for source in ["Hello **wor", "```swift\nlet value =", "[name](https://", "👩🏽‍💻"] {
      let result = MessageMarkdown(source)
      #expect(!result.blocks.isEmpty)
      #expect(result.blocks.contains { !$0.text.characters.isEmpty })
    }
    #expect(MessageMarkdown("").blocks.isEmpty)
  }
}
