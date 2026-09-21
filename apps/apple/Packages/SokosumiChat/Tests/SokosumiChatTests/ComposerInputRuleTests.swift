import Foundation
import SokosumiChat
import Testing

/// Mirrors web's `composer-wysiwyg-input-rules.test.ts` one for one, then the
/// guards web gets from its DOM (one text node, no code, no mention chip).
struct ComposerInputRuleTests {
  private func match(_ text: String) -> ComposerInputRule? {
    ComposerInputRule.match(in: text, caret: text.utf16.count)
  }

  // MARK: web "matchComposerInputRule"

  /// Web: "matches italic closing underscore".
  @Test func matchesItalicClosingUnderscore() {
    #expect(match("_asds_") == ComposerInputRule(style: .italic, range: NSRange(location: 0, length: 6), inner: NSRange(location: 1, length: 4)))
  }

  /// Web: "matches bold, strike, and code".
  @Test func matchesBoldStrikeAndCode() {
    #expect(match("**hi**") == ComposerInputRule(style: .bold, range: NSRange(location: 0, length: 6), inner: NSRange(location: 2, length: 2)))
    #expect(match("~~bye~~") == ComposerInputRule(style: .strikethrough, range: NSRange(location: 0, length: 7), inner: NSRange(location: 2, length: 3)))
    #expect(match("`x`") == ComposerInputRule(style: .code, range: NSRange(location: 0, length: 3), inner: NSRange(location: 1, length: 1)))
  }

  /// Web: "rejects empty or multiline inners".
  @Test(arguments: ["__", "**", "_\n_", "****", "~~~~", "``", "**a\nb**"])
  func rejectsEmptyOrMultilineInners(_ text: String) {
    #expect(match(text) == nil)
  }

  /// Web: "rejects mid-word underscores".
  @Test(arguments: ["a_b_", "snake_case_", "1_2_", "ä_b_", "__b_", "a**b**", "a~~b~~", "a`b`"])
  func rejectsAnOpeningDelimiterGluedToAWord(_ text: String) {
    #expect(match(text) == nil)
  }

  // MARK: web rule set and guards not in its table

  /// Web has no `*…*`, `__…__` or block rule; a single asterisk never closes anything.
  @Test(arguments: ["*hi*", "- ", "> ", "1. ", "```", "# "])
  func hasNoOtherRule(_ text: String) {
    #expect(match(text) == nil)
  }

  /// `__hi__` is web's italic rule seeing `_` twice: the first closing underscore
  /// has an underscore inside, the second has an empty inner.
  @Test func doubleUnderscoreIsNotARule() {
    #expect(match("__hi_") == nil)
    #expect(match("__hi__") == nil)
  }

  @Test func italicRejectsAnAsteriskInside() {
    #expect(match("_a*b_") == nil)
  }

  /// Web has no whitespace or escape guard.
  @Test func keepsWebsMissingWhitespaceAndEscapeGuards() {
    #expect(match("** x**")?.inner == NSRange(location: 2, length: 2))
    #expect(match("**x **")?.inner == NSRange(location: 2, length: 2))
    #expect(match("\\_x_")?.range == NSRange(location: 1, length: 3))
  }

  /// The opening delimiter is the last one before the closing one (`lastIndexOf`).
  @Test func opensAtTheNearestDelimiter() {
    #expect(match("**a** and **b**") == ComposerInputRule(style: .bold, range: NSRange(location: 10, length: 5), inner: NSRange(location: 12, length: 1)))
    #expect(match("***hi**")?.range == NSRange(location: 1, length: 6))
    #expect(match("say `a` then `b`")?.inner == NSRange(location: 14, length: 1))
  }

  @Test func punctuationAndSpaceMayPrecedeTheOpeningDelimiter() {
    #expect(match("so _x_")?.range == NSRange(location: 3, length: 3))
    #expect(match("(_x_")?.range == NSRange(location: 1, length: 3))
    #expect(match("😀_x_")?.range == NSRange(location: 2, length: 3))
  }

  @Test func rangesAreUTF16() {
    #expect(match("**👋 hi**") == ComposerInputRule(style: .bold, range: NSRange(location: 0, length: 9), inner: NSRange(location: 2, length: 5)))
  }

  // MARK: any edit that leaves a closed pair before the caret (web runs on every input event)

  /// Web asks only what the text before the caret ends with, not which edit put it there,
  /// so a paste or a deletion fires the same rule as a keystroke.
  @Test func theEditThatClosedThePairDoesNotMatter() {
    #expect(ComposerInputRule.match(in: "**hi** ", caret: 6)?.style == .bold)
    #expect(ComposerInputRule.match(in: "**hi** ", caret: 7) == nil)
  }

  /// One pair per edit: a pasted `**a** and **b**` formats only the pair that ends at the caret.
  @Test func onlyThePairEndingAtTheCaretMatches() {
    let pasted = "**a** and **b**"
    #expect(ComposerInputRule.match(in: pasted, caret: pasted.utf16.count)?.inner == NSRange(location: 12, length: 1))
  }

  @Test func matchesOnlyTextBeforeTheCaret() {
    #expect(ComposerInputRule.match(in: "_x_ tail_", caret: 3)?.range == NSRange(location: 0, length: 3))
    #expect(ComposerInputRule.match(in: "_x tail_", caret: 2) == nil)
    #expect(ComposerInputRule.match(in: "_x_", caret: 9) == nil)
    #expect(ComposerInputRule.match(in: "_x_", caret: 0) == nil)
  }

  /// Web only reads the caret's text node; `nodeStart` is where that node begins.
  @Test func theOpeningDelimiterMustBeInTheSameNode() {
    #expect(ComposerInputRule.match(in: "_ab_", caret: 4, nodeStart: 2) == nil)
    #expect(ComposerInputRule.match(in: "a_b_", caret: 4, nodeStart: 1)?.range == NSRange(location: 1, length: 3))
  }

  // MARK: attributed text: node boundaries and protected contexts

  private func attributed(_ children: [ComposerDocument.Inline]) -> NSAttributedString {
    ComposerInlineText.attributedText(children)
  }

  private func matchAtEnd(_ text: NSAttributedString) -> ComposerInputRule? {
    ComposerInputRule.match(in: text, caret: text.length)
  }

  @Test func matchesPlainAttributedText() {
    #expect(matchAtEnd(NSAttributedString(string: "say **hi**"))?.range == NSRange(location: 4, length: 6))
  }

  /// Web: "skips conversion inside code".
  @Test func skipsInlineCode() {
    #expect(matchAtEnd(attributed([.code("_x_")])) == nil)
  }

  @Test func skipsCodeBlocks() throws {
    let block = try ComposerBlockText.attributedText(ComposerDocument(markdown: "```\n_x_\n```\n"))
    let caret = (block.string as NSString).range(of: "_x_")
    #expect(ComposerInputRule.match(in: block, caret: NSMaxRange(caret)) == nil)
  }

  /// A chip is one atomic character, so only text that inherited its token can sit "inside" one.
  @Test func skipsMentionChips() {
    let text = NSAttributedString(string: "_x_", attributes: [ComposerReferenceText.token: "@anna"])
    #expect(matchAtEnd(text) == nil)
  }

  /// A formatted run, a link or a chip between the delimiters splits web's text node.
  @Test func aFormattingBoundaryBetweenTheDelimitersBlocksTheRule() {
    #expect(matchAtEnd(attributed([.text("**a "), .italic([.text("b")]), .text(" c**")])) == nil)
    #expect(matchAtEnd(attributed([.text("_a "), .link([.text("b")], destination: "https://example.com"), .text("_")])) == nil)
    let chipped = NSMutableAttributedString(string: "_a ")
    chipped.append(ComposerReferenceText.chip(token: "@[anna]", name: "@Anna"))
    chipped.append(NSAttributedString(string: " b_"))
    #expect(matchAtEnd(chipped) == nil)
  }

  /// The node starts after the formatted run, so a word character there does not guard.
  @Test func theNodeStartsAfterAFormattedRun() {
    let text = attributed([.bold([.text("a")]), .text("_b_")])
    #expect(matchAtEnd(text)?.range == NSRange(location: 1, length: 3))
  }

  @Test func doesNotReachIntoThePreviousLine() {
    #expect(matchAtEnd(NSAttributedString(string: "_a\nb_")) == nil)
    #expect(matchAtEnd(NSAttributedString(string: "_a_\n_b_"))?.range == NSRange(location: 4, length: 3))
  }

  @Test func nestsInsideExistingFormatting() {
    let text = attributed([.bold([.text("so _x_")])])
    let rule = matchAtEnd(text)
    #expect(rule?.range == NSRange(location: 3, length: 3))
    let edited = NSMutableAttributedString(attributedString: text)
    if let rule {
      edited.replaceCharacters(in: rule.range, with: rule.replacement(in: text))
    }
    #expect(ComposerInlineText.content(edited) == [.bold([.text("so "), .italic([.text("x")])])])
  }

  @Test func listMarkersAreNotPartOfTheNode() throws {
    let list = try ComposerBlockText.attributedText(ComposerDocument(markdown: "- **hi**\n"))
    let plain = NSMutableAttributedString(attributedString: list)
    let content = (plain.string as NSString).range(of: "hi")
    plain.removeAttribute(ComposerInlineText.bold, range: content)
    plain.replaceCharacters(in: content, with: "**hi**")
    let caret = NSMaxRange((plain.string as NSString).range(of: "**hi**"))
    let rule = try #require(ComposerInputRule.match(in: plain, caret: caret))
    plain.replaceCharacters(in: rule.range, with: rule.replacement(in: plain))
    #expect(ComposerBlockText.document(plain).markdown == "- **hi**\n")
  }

  // MARK: replacement and serialization

  @Test(arguments: [("**hi**", "*"), ("~~hi~~", "~"), ("_hi_", "_"), ("`hi`", "`"), ("so **hi**", "*"), ("**👋 hi**", "*")])
  func theFormattedDraftSerializesToTheTypedMarkdown(_ typedText: String, _ delimiter: String) throws {
    let literal = NSAttributedString(string: typedText)
    let rule = try #require(matchAtEnd(literal))
    let edited = NSMutableAttributedString(attributedString: literal)
    edited.replaceCharacters(in: rule.range, with: rule.replacement(in: literal))
    #expect(!edited.string.contains(delimiter))
    #expect(ComposerBlockText.document(edited).markdown == ComposerBlockText.document(literal).markdown)
    #expect(ComposerBlockText.document(edited).markdown == typedText + "\n")
  }

  /// Web's serializer hoists padding out of the markers as well (`wrapInlineMarkdownMarker`).
  @Test func paddingMovesOutsideTheMarkers() throws {
    let literal = NSAttributedString(string: "a ** x **")
    let rule = try #require(matchAtEnd(literal))
    let edited = NSMutableAttributedString(attributedString: literal)
    edited.replaceCharacters(in: rule.range, with: rule.replacement(in: literal))
    #expect(ComposerBlockText.document(edited).markdown == "a  **x** \n")
  }
}
