import SokosumiChat
import Testing

struct ComposerContentTests {
  @Test func trimsLikeWebAndPreservesInternalLines() {
    #expect(ComposerContent(" \n hello\nworld \u{FEFF}").text == "hello\nworld")
    #expect(!ComposerContent(" \t\n").canSend)
    #expect(ComposerContent("\u{0085}").text == "\u{0085}")
  }

  @Test func countsUTF16AtCoreBoundary() {
    #expect(ComposerContent(String(repeating: "😀", count: 5000)).canSend)
    let over = ComposerContent(String(repeating: "😀", count: 5001))
    #expect(over.count == 10002)
    #expect(over.isTooLong)
    #expect(!over.canSend)
    #expect(!ComposerContent(String(repeating: "a", count: 9499)).showsCounter)
    #expect(ComposerContent(String(repeating: "a", count: 9500)).showsCounter)
  }
}
