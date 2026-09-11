import Foundation
import SokosumiChat
import Testing

struct ComposerInlineTextTests {
  @Test(arguments: ComposerInlineText.Style.allCases)
  func togglesStylesWithoutChangingUnicodeText(_ style: ComposerInlineText.Style) {
    let original = NSAttributedString(string: "👋 hello")
    let formatted = ComposerInlineText.toggling(style, in: original)
    #expect(formatted.string == original.string)
    #expect(ComposerInlineText.isActive(style, in: formatted))
    #expect(!ComposerInlineText.isActive(style, in: ComposerInlineText.toggling(style, in: formatted)))
  }

  @Test func roundTripsNestedFormattingAndUnicode() {
    let content: [ComposerDocument.Inline] = [.bold([.text("👋 "), .italic([.text("hello")])]), .text(" world")]
    let text = ComposerInlineText.attributedText(content)
    #expect(text.string == "👋 hello world")
    #expect(ComposerInlineText.content(text) == content)
  }

  @Test func retainsStylesWhenNativeStorageReplacesSelectedText() {
    let text = NSMutableAttributedString(attributedString: ComposerInlineText.attributedText([.bold([.text("hello")])]))
    text.replaceCharacters(in: NSRange(location: 1, length: 3), with: "i")
    #expect(ComposerInlineText.content(text) == [.bold([.text("hio")])])
  }

  @Test func coalescesAdjacentStyleRunsAndIgnoresPresentationAttributes() {
    let text = NSMutableAttributedString(attributedString: ComposerInlineText.attributedText([.bold([.text("one"), .text("two")])]))
    text.addAttribute(NSAttributedString.Key("presentation-only"), value: 1, range: NSRange(location: 0, length: 3))
    #expect(ComposerInlineText.content(text) == [.bold([.text("onetwo")])])
  }

  @Test func preservesLinksAndCodeLiterals() {
    let content: [ComposerDocument.Inline] = [.link([.text("site")], destination: "https://example.com"), .code("**literal**")]
    #expect(ComposerInlineText.content(ComposerInlineText.attributedText(content)) == content)
  }

  @Test func preservesLinkWhenInlineCodeIsToggledOnTheSameRun() {
    let nested: [ComposerDocument.Inline] = [.link([.code("site")], destination: "https://example.com")]
    #expect(ComposerInlineText.content(ComposerInlineText.attributedText(nested)) == nested)
    let linked = ComposerInlineText.attributedText([.link([.text("site")], destination: "https://example.com")])
    let coded = ComposerInlineText.toggling(.code, in: linked)
    #expect(ComposerInlineText.content(coded) == nested)
    #expect(ComposerDocument(blocks: [.paragraph(ComposerInlineText.content(coded))]).markdown == "[`site`](https://example.com)\n")
  }

  @Test func ignoresListMarkersWhenTogglingInlineStyle() {
    let text = ComposerBlockText.attributedText(
      ComposerDocument(blocks: [.unorderedList([[.paragraph([.bold([.text("item")])])]])])
    )
    #expect(ComposerInlineText.isActive(.bold, in: text))
    let plain = ComposerInlineText.toggling(.bold, in: text)
    #expect(!ComposerInlineText.isActive(.bold, in: plain))
    #expect(ComposerBlockText.document(plain).markdown == "- item\n")
    let restored = ComposerInlineText.toggling(.bold, in: plain)
    #expect(ComposerInlineText.isActive(.bold, in: restored))
    #expect(ComposerBlockText.document(restored).markdown == "- **item**\n")
  }
}
