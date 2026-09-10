import Foundation
import SokosumiChat
import Testing

struct ComposerBlockFormatTests {
  @Test func activeBlocksFollowNestedAndMixedSelections() {
    let quote = ComposerBlockText.attributedText(ComposerDocument(blocks: [
      .quote([.unorderedList([[.paragraph([.text("one")])], [.paragraph([.text("two")])]])])
    ]))
    #expect(ComposerBlockFormat.quote.isActive(in: quote))
    #expect(ComposerBlockFormat.unorderedList.isActive(in: quote))
    #expect(!ComposerBlockFormat.orderedList.isActive(in: quote))
    #expect(!ComposerBlockFormat.codeBlock.isActive(in: quote))
    let mixed = NSMutableAttributedString(attributedString: quote)
    mixed.append(NSAttributedString(string: "plain"))
    #expect(!ComposerBlockFormat.quote.isActive(in: mixed))
    #expect(!ComposerBlockFormat.quote.isActive(in: NSAttributedString(string: "")))
    let code = ComposerBlockText.attributedText(ComposerDocument(blocks: [.code("let x = 1", language: "swift")]))
    #expect(ComposerBlockFormat.codeBlock.isActive(in: code))
  }

  @Test func formatsEachSelectedParagraphAsListItem() {
    let text = NSAttributedString(string: "one\ntwo\n")
    let result = ComposerBlockFormat.orderedList.applying(to: text)
    #expect(ComposerBlockText.document(result).markdown == "1. one\n2. two\n")
  }

  @Test func removesExistingQuote() {
    let document = ComposerDocument(blocks: [.quote([.paragraph([.text("hello")])])])
    let result = ComposerBlockFormat.quote.applying(to: ComposerBlockText.attributedText(document))
    #expect(ComposerBlockText.document(result).markdown == "hello\n")
  }

  @Test func codeBlockRetainsLiteralCharacters() {
    let result = ComposerBlockFormat.codeBlock.applying(to: NSAttributedString(string: "**literal**"))
    #expect(ComposerBlockText.document(result).markdown == "```\n**literal**\n```\n")
  }
}
