import Foundation
@testable import SokosumiChat
import Testing

/// Web's `openMentions` / `insertMention` (composer-wysiwyg-editor.tsx): the toolbar
/// button opens the picker with an empty query and types nothing.
struct ComposerMentionPickerTests {
  private func typed(_ text: String) -> ComposerReferenceTrigger? {
    ComposerReferenceTrigger.match(in: text, caret: text.utf16.count)
  }

  private func opened() -> ComposerMentionPicker {
    var picker = ComposerMentionPicker()
    picker.openFromButton(hasMentions: true)
    return picker
  }

  @Test func closedPickerFollowsTheTypedTrigger() {
    let picker = ComposerMentionPicker()
    #expect(!picker.isOpenedByButton)
    #expect(picker.query(typed: nil) == nil)
    #expect(picker.query(typed: typed("hi @an")) == "an")
    #expect(picker.query(typed: typed("@"))?.isEmpty == true)
    #expect(picker.query(typed: typed("#general")) == nil)
  }

  @Test func buttonOpensWithAnEmptyQueryAndNeedsACatalog() {
    #expect(opened().isOpenedByButton)
    #expect(opened().query(typed: nil)?.isEmpty == true)
    var empty = ComposerMentionPicker()
    empty.openFromButton(hasMentions: false)
    #expect(!empty.isOpenedByButton)
    #expect(empty.query(typed: nil) == nil)
  }

  /// Web re-opens a button-opened picker with `query: ""` on every input, so
  /// typed text lands in the draft and never filters the list.
  @Test func buttonOpenedPickerStaysUnfilteredWhileTyping() {
    #expect(opened().query(typed: typed("hello"))?.isEmpty == true)
    #expect(opened().query(typed: typed("@an"))?.isEmpty == true)
    #expect(opened().query(typed: typed("#gen"))?.isEmpty == true)
  }

  @Test func closingReturnsToTheTypedPath() {
    var picker = opened()
    picker.close()
    #expect(!picker.isOpenedByButton)
    #expect(picker.query(typed: nil) == nil)
    #expect(picker.query(typed: typed("@an")) == "an")
    #expect(picker.insertion(in: "Hello", selection: NSRange(location: 5, length: 0), typed: nil) == nil)
  }

  @Test func typedTriggerIsReplacedWithoutASeparator() {
    let text = "hi @an"
    let expected = ComposerMentionPicker.Insertion(range: NSRange(location: 3, length: 3), leadingSeparator: "")
    let selection = NSRange(location: 6, length: 0)
    #expect(ComposerMentionPicker().insertion(in: text, selection: selection, typed: typed(text)) == expected)
    // Web checks the typed trigger first even when the button opened the picker.
    #expect(opened().insertion(in: text, selection: selection, typed: typed(text)) == expected)
  }

  @Test func channelTriggerIsNeverReplacedByAMention() {
    let text = "#gen"
    let selection = NSRange(location: 4, length: 0)
    #expect(ComposerMentionPicker().insertion(in: text, selection: selection, typed: typed(text)) == nil)
    #expect(opened().insertion(in: text, selection: selection, typed: typed(text))
      == .init(range: selection, leadingSeparator: " "))
  }

  @Test(arguments: [
    ("", 0, ""),
    ("Hello", 5, " "),
    ("Hello ", 6, ""),
    ("Hello\n", 6, ""),
    ("Hello", 2, " "),
    ("Hello", 0, ""),
    ("😀", 2, " "),
    ("\u{FFFC}", 1, " ")
  ])
  func buttonInsertionSeparatesFromAPrecedingNonSpace(text: String, caret: Int, separator: String) {
    let insertion = opened().insertion(in: text, selection: NSRange(location: caret, length: 0), typed: nil)
    #expect(insertion == .init(range: NSRange(location: caret, length: 0), leadingSeparator: separator))
  }

  /// Web reads the caret as the selection's end and collapses there: the selected text stays.
  @Test func buttonInsertionLandsAfterANonEmptySelection() {
    let insertion = opened().insertion(in: "Hello world", selection: NSRange(location: 0, length: 5), typed: nil)
    #expect(insertion == .init(range: NSRange(location: 5, length: 0), leadingSeparator: " "))
  }

  @Test func outOfBoundsSelectionIsClamped() {
    let insertion = opened().insertion(in: "Hi", selection: NSRange(location: 9, length: 0), typed: nil)
    #expect(insertion == .init(range: NSRange(location: 2, length: 0), leadingSeparator: " "))
  }
}
