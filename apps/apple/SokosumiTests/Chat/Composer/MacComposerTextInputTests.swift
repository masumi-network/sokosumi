#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing

  @MainActor
  struct MacComposerTextInputTests {
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
