import Foundation
@testable import SokosumiChat
import Testing

struct MessageEmojiTests {
  @Test func convertsCaseSensitiveShortcodesAndRetainsUnknowns() {
    #expect(MessageEmoji.replacing(in: ":smile: :+1: :-1: :SMILE: :unknown: :thumbsup:")
      == "😄 👍 👎 😒MILE: :unknown: :thumbsup:")
  }

  @Test func preservesEmoticonBoundariesAndPunctuation() {
    #expect(MessageEmoji.replacing(in: "Hi :-), next :-) end") == "Hi 😃, next 😃 end")
    #expect(MessageEmoji.replacing(in: ":-) x:-)\n:-)") == "😃 x:-)\n😃")
    #expect(MessageEmoji.replacing(in: ":smile: :-)") == "😄 😃")
  }

  @Test func matchesJavaScriptWhitespaceBoundaries() {
    #expect(MessageEmoji.replacing(in: "\u{FEFF}:-)") == "\u{FEFF}😃")
    #expect(MessageEmoji.replacing(in: "\u{0085}:-)") == "\u{0085}:-)")
  }

  @Test func conversionOnlyTouchesMarkdownTextNodes() throws {
    let tick = "`"
    let message = MessageMarkdown("**:smile:** [:+1:](https://example.com/:smile:) \(tick):smile: :-)\(tick)\n\n\(tick)\(tick)\(tick)text\n:smile: :-)\n\(tick)\(tick)\(tick)")
    let paragraph = try #require(message.blocks.first)
    #expect(String(paragraph.text.characters) == "😄 👍 :smile: :-)")
    #expect(paragraph.text.runs.compactMap(\.link).first?.absoluteString == "https://example.com/:smile:")
    #expect(paragraph.text.runs.contains { $0.inlinePresentationIntent?.contains(.stronglyEmphasized) == true })
    #expect(String(message.blocks[1].text.characters) == ":smile: :-)\n")
  }
}
