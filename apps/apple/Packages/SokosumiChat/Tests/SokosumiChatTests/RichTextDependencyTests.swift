import CryptoKit
import Foundation
import Markdown
@testable import SokosumiChat
import SwiftSoup
import Testing

struct RichTextDependencyTests {
  @Test func preservesEmptyCodeBetweenParagraphs() throws {
    let document = Markdown.Document(parsing: "before\n\n```swift\n```\n\nafter")
    let blocks = Array(document.children)
    #expect(blocks.count == 3)
    let code = try #require(blocks[1] as? CodeBlock)
    #expect(code.language == "swift")
    #expect(code.code.isEmpty)
  }

  @Test func preservesEmptyTableRowsAndCells() throws {
    for source in [
      "| A | B |\n|---|---|\n| | |\n| x | y |\n| | |",
      "| | |\n|---|---|\n| | |"
    ] {
      let table = try #require(Array(Markdown.Document(parsing: source).children).first as? Markdown.Table)
      #expect(table.head.childCount == 2)
      let rows = Array(table.body.children)
      #expect(rows.count == (source.contains("x") ? 3 : 1))
      #expect(rows.allSatisfy { $0.childCount == 2 })
      #expect(rows.first?.children.allSatisfy { $0.childCount == 0 } == true)
      if !source.contains("A") {
        #expect(table.head.children.allSatisfy { $0.childCount == 0 })
      }
      #expect(rows.last?.children.allSatisfy { $0.childCount == 0 } == true)
    }
  }

  @Test func preservesNestedAndUnfinishedBlocks() throws {
    let quote = try #require(Array(Markdown.Document(parsing: "> - first\n>   - nested").children).first as? BlockQuote)
    #expect(Array(quote.children).first is UnorderedList)
    let code = try #require(Array(Markdown.Document(parsing: "```swift\nlet wave = \"👋").children).first as? CodeBlock)
    #expect(code.language == "swift")
    #expect(code.code.contains("👋"))
  }

  @Test func parsesHTMLLinksEntitiesAndRepairsNesting() throws {
    let document = try SwiftSoup.parseBodyFragment("<p>One <b>two</p><p>Three &amp; &#x1F44B; <a href=/chat>room</a>")
    let paragraphs = try document.select("p")
    #expect(paragraphs.count == 2)
    #expect(try paragraphs.first()?.text() == "One two")
    #expect(try paragraphs.last()?.text() == "Three & 👋 room")
    #expect(try document.select("a").first()?.attr("href") == "/chat")
    let quoted = try SwiftSoup.parseBodyFragment("<a href='https://example.com/?a=1&amp;b=2'>link</a>")
    #expect(try quoted.select("a").first()?.attr("href") == "https://example.com/?a=1&b=2")
  }

  @Test func parserRetainsUnsafeHTMLForExplicitPolicyHandling() throws {
    let document = try SwiftSoup.parseBodyFragment("<script>alert(1)</script><style>p{color:red}</style><a href='javascript:alert(1)'>label</a>")
    #expect(try document.select("script").count == 1)
    #expect(try document.select("style").count == 1)
    #expect(try document.select("a").first()?.attr("href") == "javascript:alert(1)")
  }

  @Test func loadsApprovedEmojiResources() throws {
    let shortcodesURL = try #require(Bundle.module.url(forResource: "shortcodes", withExtension: "json", subdirectory: "Emoji"))
    let shortcodesData = try Data(contentsOf: shortcodesURL)
    #expect(SHA256.hash(data: shortcodesData).map { String(format: "%02x", $0) }.joined() ==
      "3afcba7d834ea2cafe4d4e26082faa769e51b81c61914724f2868c875f25025e")
    let shortcodes = try JSONDecoder().decode([String: String].self, from: shortcodesData)
    #expect(shortcodes.count == 1570)
    #expect(shortcodes["smile"] == "😄")
    #expect(shortcodes["+1"] == "👍")
    #expect(shortcodes["nonexistent"] == nil)
    struct Emoticon: Decodable {
      let emoji: String
      let emoticons: [String]
    }
    let emoticonsURL = try #require(Bundle.module.url(forResource: "emoticons", withExtension: "json", subdirectory: "Emoji"))
    let emoticonsData = try Data(contentsOf: emoticonsURL)
    #expect(SHA256.hash(data: emoticonsData).map { String(format: "%02x", $0) }.joined() ==
      "e6ef43a6d7ae89ec74dbcdd2c6122250ae2bac0055ac4e1453bbe8fd8718b25c")
    let emoticons = try JSONDecoder().decode([Emoticon].self, from: emoticonsData)
    #expect(emoticons.count == 29)
    #expect(emoticons.reduce(0) { $0 + $1.emoticons.count } == 322)
    #expect(emoticons.first { $0.emoticons.contains(":-)") }?.emoji == "😃")
  }
}
