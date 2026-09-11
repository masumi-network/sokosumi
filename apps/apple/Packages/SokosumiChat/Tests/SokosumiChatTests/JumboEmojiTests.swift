@testable import SokosumiChat
import Testing

struct JumboEmojiTests {
  @Test func countsComposedEmojiRatherThanScalars() {
    #expect(jumboEmojiCount("👩🏽‍💻 🇩🇪 1️⃣ 👨‍👩‍👧‍👦") == 4)
    #expect(jumboEmojiCount("\n👋\t🙂\u{FEFF}") == 2)
    #expect(jumboEmojiCount("©") == 1)
  }

  @Test func rejectsTextShortcodesAndIncompleteFlags() {
    for source in ["", "  ", "Hi 👋", ":smile:", "1", "🇩", "🙂\u{85}"] {
      #expect(jumboEmojiCount(source) == nil)
    }
  }

  @Test func twentyFourEmojiReturnToNormalSize() {
    #expect(jumboEmojiCount(String(repeating: "🙂", count: 23)) == 23)
    #expect(jumboEmojiCount(String(repeating: "🙂", count: 24)) == nil)
  }
}
