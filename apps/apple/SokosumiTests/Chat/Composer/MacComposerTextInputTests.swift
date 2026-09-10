#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing

  @MainActor
  struct MacComposerTextInputTests {
    @Test func acceptsCompletionWithoutReplacingSurroundingText() {
      let input = MacComposerTextInput.InputView()
      input.string = "😀 :sm tail"
      input.setSelectedRange(NSRange(location: 6, length: 0))
      #expect(input.rangeForUserCompletion == NSRange(location: 3, length: 3))
      var selectedIndex = 0
      let completions = input.completions(forPartialWordRange: input.rangeForUserCompletion, indexOfSelectedItem: &selectedIndex)
      #expect(completions?.contains("😄  :smile:") == true)
      input.insertCompletion("😄  :smile:", forPartialWordRange: input.rangeForUserCompletion, movement: NSReturnTextMovement, isFinal: true)
      #expect(input.string == "😀 😄 tail")
      #expect(input.selectedRange().location == 5)
    }

    @Test(arguments: [NSOtherTextMovement, NSRightTextMovement, NSLeftTextMovement, NSCancelTextMovement])
    func finalizingCompletionWithoutAcceptancePreservesTyping(_ movement: Int) {
      let input = MacComposerTextInput.InputView()
      input.string = ":sm"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      input.insertCompletion("🛩️  :small_airplane:", forPartialWordRange: input.rangeForUserCompletion, movement: movement, isFinal: true)
      input.insertText("i", replacementRange: input.selectedRange())
      #expect(input.string == ":smi")
      #expect(input.selectedRange().location == 4)
    }

    @Test func completionPreviewAndCancelPreserveDraft() {
      let input = MacComposerTextInput.InputView()
      input.string = ":sm"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      let range = input.rangeForUserCompletion
      input.insertCompletion(":smile:", forPartialWordRange: range, movement: NSDownTextMovement, isFinal: false)
      #expect(input.string == ":sm")
      input.insertCompletion(":sm", forPartialWordRange: range, movement: NSCancelTextMovement, isFinal: true)
      #expect(input.string == ":sm")
    }

    @Test func emojiConversionSupportsUndoAndRedo() {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.string = ":D"
      input.setSelectedRange(NSRange(location: 2, length: 0))
      delegate.manager.beginUndoGrouping()
      input.insertText(" ", replacementRange: input.selectedRange())
      delegate.manager.endUndoGrouping()
      #expect(input.string == "😄 ")
      delegate.manager.undo()
      #expect(input.string == ":D")
      delegate.manager.redo()
      #expect(input.string == "😄 ")
    }

    @Test func markedTextIsNotConvertedUntilCommitted() {
      let input = MacComposerTextInput.InputView()
      input.setMarkedText(":D ", selectedRange: NSRange(location: 3, length: 0), replacementRange: NSRange(location: 0, length: 0))
      #expect(input.hasMarkedText())
      #expect(input.string == ":D ")
      input.insertText(":D ", replacementRange: input.markedRange())
      #expect(!input.hasMarkedText())
      #expect(input.string == "😄 ")
    }

    private final class UndoDelegate: NSObject, NSTextViewDelegate {
      let manager = UndoManager()
      func undoManager(for _: NSTextView) -> UndoManager? {
        manager
      }
    }

    @Test func emojiConversionPreservesCaretAndSurroundingText() {
      let input = MacComposerTextInput.InputView()
      input.string = "😀 :D tail"
      input.setSelectedRange(NSRange(location: 5, length: 0))
      input.insertText(" ", replacementRange: input.selectedRange())
      #expect(input.string == "😀 😄  tail")
      #expect(input.selectedRange() == NSRange(location: 6, length: 0))
    }

    @Test func nativeEmojiInsertionReplacesSelection() {
      let input = MacComposerTextInput.InputView()
      input.string = "before selected after"
      input.setSelectedRange(NSRange(location: 7, length: 8))
      input.insertText("👩🏽‍💻", replacementRange: input.selectedRange())
      #expect(input.string == "before 👩🏽‍💻 after")
      #expect(input.selectedRange().location == 7 + "👩🏽‍💻".utf16.count)
    }

    @Test(arguments: [CGFloat.zero, 400, .infinity])
    func measurementDoesNotMutateEditor(_ width: CGFloat) {
      let scroll = MacComposerTextInput.InputScrollView(frame: NSRect(x: 0, y: 0, width: 400, height: 30))
      let input = MacComposerTextInput.InputView(frame: NSRect(x: 0, y: 0, width: 400, height: 30))
      scroll.documentView = input
      let original = input.frame
      let size = scroll.measuredSize(for: ProposedViewSize(width: width, height: nil))
      #expect(size.width.isFinite && size.height.isFinite)
      #expect(size.width > 0 && size.height > 0)
      #expect(input.frame == original)
    }

    @Test func actualLayoutKeepsEmptyEditorClickable() {
      let scroll = MacComposerTextInput.InputScrollView(frame: NSRect(x: 0, y: 0, width: 400, height: 30))
      let input = MacComposerTextInput.InputView()
      scroll.documentView = input
      scroll.layout()
      #expect(input.frame.width == scroll.contentView.bounds.width)
      #expect(input.frame.height >= scroll.contentView.bounds.height)
      #expect(input.frame.contains(NSPoint(x: 200, y: 15)))
    }

    @Test func trailingNewlineGrowsMeasuredHeight() {
      let scroll = MacComposerTextInput.InputScrollView()
      let input = MacComposerTextInput.InputView()
      scroll.documentView = input
      input.string = "first"
      let first = scroll.measuredSize(for: ProposedViewSize(width: 400, height: nil))
      input.string = "first\n"
      let second = scroll.measuredSize(for: ProposedViewSize(width: 400, height: nil))
      #expect(second.height > first.height)
    }

    @Test func layoutPreservesLongDraftScrollPosition() {
      let scroll = MacComposerTextInput.InputScrollView(frame: NSRect(x: 0, y: 0, width: 400, height: 60))
      let input = MacComposerTextInput.InputView()
      input.string = String(repeating: "line\n", count: 40)
      scroll.documentView = input
      scroll.layout()
      scroll.contentView.scroll(to: NSPoint(x: 0, y: 200))
      let previous = scroll.contentView.bounds.origin
      scroll.layout()
      #expect(scroll.contentView.bounds.origin == previous)
    }

    @Test func successfulReturnClearsImmediately() throws {
      let input = MacComposerTextInput.InputView()
      input.string = "message"
      var submissions = 0
      input.submit = { submissions += 1
        return true
      }
      try input.keyDown(with: returnEvent())
      #expect(submissions == 1)
      #expect(input.string.isEmpty)
    }

    @Test func rejectedReturnPreservesDraft() throws {
      let input = MacComposerTextInput.InputView()
      input.string = "unsent draft"
      input.submit = { false }
      try input.keyDown(with: returnEvent())
      #expect(input.string == "unsent draft")
    }

    @Test func acceptedSendClearsUndoHistory() throws {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.insertText(":D ", replacementRange: input.selectedRange())
      #expect(input.string == "😄 ")
      #expect(delegate.manager.canUndo)
      input.submit = { true }
      try input.keyDown(with: returnEvent())
      #expect(input.string.isEmpty)
      #expect(!delegate.manager.canUndo)
      delegate.manager.undo()
      #expect(input.string.isEmpty)
    }

    @Test func externalClearAfterSendDiscardsUndoHistory() {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.insertText("hello", replacementRange: input.selectedRange())
      #expect(delegate.manager.canUndo)
      input.clearAfterSend()
      #expect(input.string.isEmpty)
      #expect(!delegate.manager.canUndo)
      delegate.manager.undo()
      #expect(input.string.isEmpty)
    }

    @Test(arguments: [NSEvent.ModifierFlags.shift, .command, .control])
    func modifiedReturnReplacesSelectionWithNewline(_ modifiers: NSEvent.ModifierFlags) throws {
      let input = MacComposerTextInput.InputView()
      input.string = "first second"
      input.setSelectedRange(NSRange(location: 5, length: 1))
      var submissions = 0
      input.submit = { submissions += 1
        return true
      }
      try input.keyDown(with: returnEvent(modifiers))
      #expect(submissions == 0)
      #expect(input.string == "first\nsecond")
    }

    private func returnEvent(_ modifiers: NSEvent.ModifierFlags = []) throws -> NSEvent {
      try #require(NSEvent.keyEvent(
        with: .keyDown, location: .zero, modifierFlags: modifiers,
        timestamp: 0, windowNumber: 0, context: nil,
        characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36
      ))
    }
  }
#endif
