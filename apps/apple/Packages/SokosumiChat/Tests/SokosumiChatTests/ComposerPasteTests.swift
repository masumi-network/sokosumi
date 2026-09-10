import SokosumiChat
import Testing

struct ComposerPasteTests {
  @Test func discardsFormattingAndPreservesLineBreaks() {
    #expect(ComposerPaste.plainText(html: "<span style='color:red'>hello <strong>world</strong></span>") == "hello world")
    #expect(ComposerPaste.plainText(html: "a<br>b<br/>c") == "a\nb\nc")
    #expect(ComposerPaste.plainText(html: "<p>first</p><p>second</p>") == "first\nsecond\n")
    #expect(ComposerPaste.plainText(html: "<div><div><p>one&nbsp;two</p></div></div>") == "one two\n\n")
  }
}
