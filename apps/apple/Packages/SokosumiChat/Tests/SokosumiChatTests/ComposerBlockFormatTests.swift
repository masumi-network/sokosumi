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

  @Test func otherFormatsStillReplaceTheSelectedLines() throws {
    let toggled = try toggle(.unorderedList, in: text("one\ntwo\n"), selection: NSRange(location: 1, length: 4))
    #expect(markdown(toggled.text) == "- one\n- two\n")
    #expect(toggled.caret == (toggled.text.string as NSString).length - 1)
    let quote = try toggle(.quote, in: text("> hello\n"), selection: NSRange(location: 2, length: 0))
    #expect(markdown(quote.text) == "hello\n")
  }
}

/// The Code block control, both ways. The first ten cases are web's own
/// `toggleComposerCodeBlock` tests in their order, under web's names.
struct ComposerCodeBlockToggleTests {
  /// "opens an empty block with the caret inside the code element"
  @Test func opensAnEmptyBlockWithTheCaretInsideIt() {
    let toggled = toggle(.codeBlock, in: NSAttributedString(string: ""), selection: NSRange(location: 0, length: 0))
    #expect(ComposerBlockText.document(toggled.text) == ComposerDocument(blocks: [.code("", language: "")]))
    #expect(isCode(toggled.text, at: toggled.caret))
  }

  /// "gives an empty block a line break so it does not collapse": natively the block is
  /// one line-ending character that carries the code path, so it has a line for the caret.
  @Test func anEmptyBlockIsALineOfItsOwn() {
    let toggled = toggle(.codeBlock, in: NSAttributedString(string: ""), selection: NSRange(location: 0, length: 0))
    #expect(toggled.text.string == "\n")
    #expect(toggled.caret == 0)
  }

  /// "wraps the selected text inside the code element"
  @Test func wrapsTheSelectedTextInsideTheBlock() throws {
    let toggled = try toggle(.codeBlock, in: text("hello world"), selection: NSRange(location: 0, length: 11))
    #expect(ComposerBlockText.document(toggled.text) == ComposerDocument(blocks: [.code("hello world", language: "")]))
    #expect(toggled.caret == 11)
    #expect(isCode(toggled.text, at: toggled.caret))
  }

  /// "unwraps the block when toggled a second time"
  @Test func unwrapsTheBlockWhenToggledASecondTime() throws {
    let toggled = try toggle(.codeBlock, in: text("```\nhello world\n```\n"), selection: NSRange(location: 0, length: 0))
    #expect(toggled.text.string == "hello world\n")
    #expect(ComposerBlockText.document(toggled.text) == ComposerDocument(blocks: [.paragraph([.text("hello world")])]))
    #expect(!ComposerBlockFormat.codeBlock.isActive(in: toggled.text))
    #expect(toggled.caret == 11)
  }

  /// "keeps the newlines of a multi-line block when unwrapping"
  @Test func keepsTheNewlinesOfAMultiLineBlock() throws {
    let toggled = try toggle(.codeBlock, in: text("```\nfirst\nsecond\n```\n"), selection: NSRange(location: 0, length: 0))
    #expect(toggled.text.string == "first\nsecond\n")
    #expect(markdown(toggled.text) == "first\nsecond\n")
    #expect(toggled.caret == 12)
  }

  /// "leaves nothing behind when an untouched empty block is toggled off"
  @Test func leavesNothingBehindWhenAnUntouchedEmptyBlockIsToggledOff() {
    let opened = toggle(.codeBlock, in: NSAttributedString(string: ""), selection: NSRange(location: 0, length: 0))
    let closed = toggle(.codeBlock, in: opened.text, selection: NSRange(location: opened.caret, length: 0))
    #expect(markdown(closed.text).isEmpty)
    #expect(ComposerContent(closed.text.string).text.isEmpty)
    #expect(!isCode(closed.text, at: closed.caret))
  }

  /// "keeps the caret at the unwrap site when an empty block follows text". Web leaves the
  /// block's line break behind with the caret after it; so does the native editor.
  @Test func keepsTheCaretAtTheUnwrapSiteWhenAnEmptyBlockFollowsText() throws {
    let opened = try toggle(.codeBlock, in: text("hello"), selection: NSRange(location: 5, length: 0))
    #expect(markdown(opened.text) == "hello\n```\n\n```\n")
    #expect(isCode(opened.text, at: opened.caret))
    let closed = toggle(.codeBlock, in: opened.text, selection: NSRange(location: opened.caret, length: 0))
    #expect((closed.text.string as NSString).substring(to: closed.caret) == "hello\n")
    #expect(ComposerContent(markdown(closed.text)).text == "hello")
  }

  /// "keeps the newlines of a div-split block when unwrapping" is a contentEditable shape
  /// with no native counterpart: a native block's lines are newline characters, blank or not.
  @Test func keepsBlankLinesWhenUnwrapping() throws {
    let toggled = try toggle(.codeBlock, in: text("```\nline 1\n\nline 2\n```\n"), selection: NSRange(location: 3, length: 0))
    #expect(markdown(toggled.text) == "line 1\n\nline 2\n")
  }

  /// "serializes a wrapped selection as a fence with that text"
  @Test func serializesAWrappedSelectionAsAFenceWithThatText() throws {
    let toggled = try toggle(.codeBlock, in: text("hello world"), selection: NSRange(location: 0, length: 11))
    #expect(markdown(toggled.text) == "```\nhello world\n```\n")
  }

  /// "serializes a freshly opened empty block as an empty fence"
  @Test func serializesAFreshlyOpenedEmptyBlockAsAnEmptyFence() {
    let toggled = toggle(.codeBlock, in: NSAttributedString(string: ""), selection: NSRange(location: 0, length: 0))
    #expect(markdown(toggled.text) == "```\n\n```\n")
  }

  // MARK: Which block, and what a selection does

  @Test(arguments: [0, 3, 5])
  func aCaretAnywhereInTheBlockUnwrapsAllOfIt(_ caret: Int) throws {
    let toggled = try toggle(.codeBlock, in: text("before\n```\nab\ncd\n```\nafter\n"), selection: NSRange(location: 7 + caret, length: 0))
    #expect(markdown(toggled.text) == "before\nab\ncd\nafter\n")
    #expect(toggled.caret == 12)
  }

  @Test func aCaretOnTheLineBeforeABlockDoesNotUnwrapIt() throws {
    let toggled = try toggle(.codeBlock, in: text("before\n```\nab\n```\n"), selection: NSRange(location: 6, length: 0))
    #expect(markdown(toggled.text) == "before\n```\n\n```\n```\nab\n```\n")
  }

  @Test func aCaretAfterTheLastLineBelongsToTheLastBlock() throws {
    let toggled = try toggle(.codeBlock, in: text("```\nab\n```\n"), selection: NSRange(location: 3, length: 0))
    #expect(markdown(toggled.text) == "ab\n")
  }

  @Test func aSelectionInsideABlockUnwrapsTheWholeBlock() throws {
    let toggled = try toggle(.codeBlock, in: text("```\nab\ncd\n```\n"), selection: NSRange(location: 1, length: 3))
    #expect(markdown(toggled.text) == "ab\ncd\n")
    #expect(toggled.caret == 5)
  }

  /// Web unwraps the block that holds the selection's anchor and nothing else. AppKit
  /// does not say which end was the anchor, so the start stands for it.
  @Test func aSelectionThatStartsInABlockUnwrapsOnlyThatBlock() throws {
    let source = try text("```\none\n```\n```\ntwo\n```\nplain\n")
    let across = toggle(.codeBlock, in: source, selection: NSRange(location: 1, length: 5))
    #expect(markdown(across.text) == "one\n```\ntwo\n```\nplain\n")
    #expect(across.caret == 3)
    let intoPlain = toggle(.codeBlock, in: source, selection: NSRange(location: 5, length: 6))
    #expect(markdown(intoPlain.text) == "```\none\n```\ntwo\nplain\n")
  }

  @Test func aSelectionThatStartsInPlainTextWraps() throws {
    let toggled = try toggle(.codeBlock, in: text("plain\n```\ncode\n```\n"), selection: NSRange(location: 2, length: 6))
    #expect(markdown(toggled.text) == "pl\n```\nain\nco\n```\n```\nde\n```\n")
  }

  @Test func onlyTheSecondOfTwoBlocksIsUnwrapped() throws {
    let toggled = try toggle(.codeBlock, in: text("```\none\n```\n```\ntwo\n```\n"), selection: NSRange(location: 5, length: 0))
    #expect(markdown(toggled.text) == "```\none\n```\ntwo\n")
  }

  @Test func unwrappingDropsTheLanguageWithTheFence() throws {
    let toggled = try toggle(.codeBlock, in: text("```swift\nlet x = 1\n\nlet y = 2\n```\n"), selection: NSRange(location: 0, length: 0))
    #expect(markdown(toggled.text) == "let x = 1\n\nlet y = 2\n")
  }

  // MARK: Wrapping

  @Test func wrappingFlattensInlineFormatting() throws {
    let source = try text("**bold** and `mono` and [site](https://example.com/)")
    let toggled = toggle(.codeBlock, in: source, selection: NSRange(location: 0, length: source.length - 1))
    #expect(markdown(toggled.text) == "```\nbold and mono and site\n```\n")
  }

  @Test func wrappingWritesAReferenceChipAsTheTextItShows() {
    let source = NSMutableAttributedString(string: "hi ")
    source.append(ComposerReferenceText.chip(token: "@alice", name: "@Alice"))
    source.append(NSAttributedString(string: " there\n"))
    let toggled = toggle(.codeBlock, in: source, selection: NSRange(location: 0, length: source.length - 1))
    #expect(markdown(toggled.text) == "```\nhi @Alice there\n```\n")
    #expect(toggled.text.attribute(ComposerReferenceText.token, at: 3, effectiveRange: nil) == nil)
  }

  @Test func wrappingAWordKeepsTheRestOfItsLine() throws {
    let toggled = try toggle(.codeBlock, in: text("hello world"), selection: NSRange(location: 6, length: 5))
    #expect(markdown(toggled.text) == "hello \n```\nworld\n```\n")
  }

  /// As on web, where the unwrapped text rejoins the text before it.
  @Test func unwrappingAWrappedWordRestoresItsLine() throws {
    let source = try text("a\nhello world")
    let wrapped = toggle(.codeBlock, in: source, selection: NSRange(location: 8, length: 5))
    #expect(markdown(wrapped.text) == "a\nhello \n```\nworld\n```\n")
    let unwrapped = toggle(.codeBlock, in: wrapped.text, selection: NSRange(location: wrapped.caret, length: 0))
    #expect(unwrapped.text.string == source.string)
    #expect(markdown(unwrapped.text) == "a\nhello world\n")
    #expect(unwrapped.caret == 13)
  }

  @Test func anEmptyBlockOpenedMidLineGetsItsOwnLine() throws {
    let toggled = try toggle(.codeBlock, in: text("hello"), selection: NSRange(location: 3, length: 0))
    #expect(toggled.text.string == "hel\n\nlo\n")
    #expect(markdown(toggled.text) == "hel\n```\n\n```\nlo\n")
    #expect(toggled.caret == 4)
    #expect(isCode(toggled.text, at: toggled.caret))
  }

  @Test func aNewBlockDoesNotMergeIntoTheBlockBesideIt() throws {
    let toggled = try toggle(.codeBlock, in: text("```\none\n```\ntwo\n"), selection: NSRange(location: 4, length: 3))
    #expect(markdown(toggled.text) == "```\none\n```\n```\ntwo\n```\n")
  }

  // MARK: Quotes and lists

  @Test func aBlockStaysInsideItsQuoteBothWays() throws {
    let wrapped = try toggle(.codeBlock, in: text("> quoted\n"), selection: NSRange(location: 0, length: 6))
    #expect(markdown(wrapped.text) == "> ```\n> quoted\n> ```\n")
    #expect(ComposerBlockFormat.quote.isActive(in: wrapped.text))
    let unwrapped = toggle(.codeBlock, in: wrapped.text, selection: NSRange(location: wrapped.caret, length: 0))
    #expect(markdown(unwrapped.text) == "> quoted\n")
  }

  @Test func unwrappingInsideAListItemKeepsTheItemAndItsMarker() throws {
    let source = try text("- ```\n  code\n  ```\n- two\n")
    let toggled = toggle(.codeBlock, in: source, selection: NSRange(location: 3, length: 0))
    #expect(toggled.text.string == source.string)
    #expect(markdown(toggled.text) == "- code\n- two\n")
  }

  // MARK: Literal text, round trips and the highlight

  /// The model never formats: text that was literal inside the fence is the same
  /// characters outside it. (What the editor's input rule then does is an app test.)
  @Test func unwrappingLeavesDelimitersLiteral() throws {
    let toggled = try toggle(.codeBlock, in: text("```\n**x** and _y_\n```\n"), selection: NSRange(location: 2, length: 0))
    #expect(toggled.text.string == "**x** and _y_\n")
    #expect(toggled.text.attribute(ComposerInlineText.bold, at: 2, effectiveRange: nil) == nil)
    #expect(markdown(toggled.text) == "**x** and _y_\n")
  }

  @Test func unwrappingDropsInlineAttributesTheFenceNeverSent() throws {
    let source = try NSMutableAttributedString(attributedString: text("```\nplain\n```\n"))
    source.addAttribute(ComposerInlineText.bold, value: true, range: NSRange(location: 0, length: 5))
    let toggled = toggle(.codeBlock, in: source, selection: NSRange(location: 0, length: 0))
    #expect(markdown(toggled.text) == "plain\n")
  }

  @Test(arguments: ["hello\n", "first\nsecond\n", "a\n\nb\n", "**x** `y`\n"])
  func wrapThenUnwrapIsByteIdentical(_ plain: String) {
    let source = NSAttributedString(string: plain, attributes: [ComposerBlockText.path: ["0:p"]])
    let original = markdown(source)
    let wrapped = toggle(.codeBlock, in: source, selection: NSRange(location: 0, length: source.length - 1))
    #expect(markdown(wrapped.text) == "```\n" + plain + "```\n")
    let unwrapped = toggle(.codeBlock, in: wrapped.text, selection: NSRange(location: wrapped.caret, length: 0))
    #expect(markdown(unwrapped.text) == original)
    #expect(unwrapped.text.string == plain)
  }

  @Test(arguments: ["```\nhello\n```\n", "```\nfirst\n\nsecond\n```\n", "before\n```\n**x**\n```\nafter\n"])
  func unwrapThenWrapIsByteIdentical(_ fenced: String) throws {
    let source = try text(fenced)
    let block = (source.string as NSString).range(of: fenced.contains("before") ? "**x**" : String(source.string.dropLast()))
    let unwrapped = toggle(.codeBlock, in: source, selection: NSRange(location: block.location, length: 0))
    let wrapped = toggle(.codeBlock, in: unwrapped.text, selection: block)
    #expect(markdown(wrapped.text) == fenced)
    #expect(wrapped.text.string == source.string)
  }

  @Test func theHighlightFollowsTheCaretsBlock() throws {
    let source = try text("```\ncode\n```\n")
    #expect(ComposerBlockFormat.codeBlock.isActive(in: source.attributedSubstring(from: NSRange(location: 2, length: 1))))
    let unwrapped = toggle(.codeBlock, in: source, selection: NSRange(location: 2, length: 0))
    #expect(!ComposerBlockFormat.codeBlock.isActive(in: unwrapped.text.attributedSubstring(from: NSRange(location: unwrapped.caret, length: 1))))
    let wrapped = toggle(.codeBlock, in: unwrapped.text, selection: NSRange(location: 0, length: 4))
    #expect(ComposerBlockFormat.codeBlock.isActive(in: wrapped.text.attributedSubstring(from: NSRange(location: wrapped.caret, length: 1))))
  }
}

private struct Toggled {
  let text: NSAttributedString
  let caret: Int
}

private func text(_ markdown: String) throws -> NSAttributedString {
  try ComposerBlockText.attributedText(ComposerDocument(markdown: markdown))
}

private func markdown(_ text: NSAttributedString) -> String {
  ComposerBlockText.document(text).markdown
}

private func isCode(_ text: NSAttributedString, at caret: Int) -> Bool {
  guard text.length > 0 else { return false }
  let path = text.attribute(ComposerBlockText.path, at: min(caret, text.length - 1), effectiveRange: nil) as? [String] ?? []
  return path.last?.split(separator: ":").dropFirst().first == "c"
}

/// Applies the edit the way the editor does: replace the range, collapse the caret.
private func toggle(_ format: ComposerBlockFormat, in text: NSAttributedString, selection: NSRange) -> Toggled {
  let edit = format.edit(in: text, selection: selection)
  let result = NSMutableAttributedString(attributedString: text)
  result.replaceCharacters(in: edit.range, with: edit.replacement)
  return Toggled(text: result, caret: edit.caret)
}
