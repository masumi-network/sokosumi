import Foundation
import SokosumiChat
import Testing

struct ComposerEmojiTests {
  @Test func matchesWebBoundariesAndLongestEmoticon() throws {
    for (text, expected) in [("hi :D ", "hi 😄 "), ("wink ;).", "wink 😉."), (":-) ", "😃 "), ("😀 :D ", "😀 😄 ")] {
      let edit = try #require(ComposerEmoji.match(in: text, caret: text.utf16.count))
      #expect((text as NSString).replacingCharacters(in: edit.range, with: edit.replacement) == expected)
    }
    for text in [":D", ":Dfoo", "http:// ", "word:) ", ":D\u{0085}"] {
      #expect(ComposerEmoji.match(in: text, caret: text.utf16.count) == nil)
    }
  }

  @Test func shortcodesRespectBoundariesAndExistingWhitespace() throws {
    for (text, caret, expected) in [(":smile:", 7, "😄 "), (":SMILE: x", 7, "😄 x"), ("😀 :smile:!", 10, "😀 😄 !")] {
      let edit = try #require(ComposerEmoji.match(in: text, caret: caret))
      #expect((text as NSString).replacingCharacters(in: edit.range, with: edit.replacement) == expected)
    }
    for text in ["x:smile:", ":not_a_real_emoji:", ":smile"] {
      #expect(ComposerEmoji.match(in: text, caret: text.utf16.count) == nil)
    }
  }

  @Test func preservesCodeLiterals() {
    for text in ["```swift\n:D ", "    :D ", "`x :D `"] {
      let caret = text.hasSuffix("`") ? text.utf16.count - 1 : text.utf16.count
      #expect(ComposerEmoji.match(in: text, caret: caret) == nil)
    }
    #expect(ComposerEmoji.preparingToSend("```\n:)") == "```\n:)")
  }

  @Test func sendConvertsOnlyTrailingEmoticon() {
    #expect(ComposerEmoji.preparingToSend("ok :)") == "ok 😃")
    #expect(ComposerEmoji.preparingToSend(":D middle :)") == ":D middle 😃")
    #expect(ComposerEmoji.preparingToSend("http://") == "http://")
    #expect(ComposerEmoji.match(in: "", caret: -1) == nil)
  }
}
