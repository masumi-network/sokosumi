import Foundation
import SokosumiChat
import Testing

struct ComposerBlockTextTests {
  @Test func exitsOnlyEmptyLastQuoteLine() throws {
    let text = ComposerBlockText.attributedText(ComposerDocument(blocks: [.quote([.paragraph([.text("hello\n")])])]))
    let edit = try #require(ComposerBlockText.exitingQuote(text, selection: NSRange(location: 6, length: 0)))
    #expect(ComposerBlockText.document(edit.replacement).markdown == "> hello\n\n")
    #expect(edit.caret == 6)
    #expect(!ComposerBlockFormat.quote.isActive(in: edit.replacement.attributedSubstring(from: NSRange(location: edit.caret, length: 1))))
    #expect(ComposerBlockText.exitingQuote(text, selection: NSRange(location: 5, length: 0)) == nil)
    #expect(ComposerBlockText.exitingQuote(text, selection: NSRange(location: 0, length: 1)) == nil)
    let empty = ComposerBlockText.attributedText(ComposerDocument(blocks: [.quote([.paragraph([])])]))
    let emptyEdit = try #require(ComposerBlockText.exitingQuote(empty, selection: NSRange(location: 0, length: 0)))
    #expect(ComposerBlockText.document(emptyEdit.replacement).blocks == [.paragraph([])])
  }

  @Test func preservesNestedBlockStructureAndCodeLanguage() {
    let document = ComposerDocument(blocks: [
      .quote([.paragraph([.bold([.text("quote")])])]), .blankLine,
      .orderedList([[.paragraph([.text("one")]), .unorderedList([[.paragraph([.text("nested")])]])]]),
      .heading([.text("title")], level: 3), .code("a\n\nb", language: "swift")
    ])
    #expect(ComposerBlockText.document(ComposerBlockText.attributedText(document)) == document)
  }

  @Test func preservesBlockIdentityThroughTextReplacement() {
    let document = ComposerDocument(blocks: [.quote([.paragraph([.text("hello")])])])
    let storage = NSMutableAttributedString(attributedString: ComposerBlockText.attributedText(document))
    storage.replaceCharacters(in: NSRange(location: 0, length: 5), with: "goodbye")
    #expect(ComposerBlockText.document(storage).markdown == "> goodbye\n")
  }

  @Test func excludesListMarkersFromSavedContent() {
    let document = ComposerDocument(blocks: [.unorderedList([[.paragraph([.text("item")])]])])
    let storage = ComposerBlockText.attributedText(document)
    #expect(storage.string == "•\titem\n")
    #expect(ComposerBlockText.document(storage).markdown == "- item\n")
  }
}
