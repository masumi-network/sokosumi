#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import Testing

  @MainActor
  struct MacComposerTextInputTests {
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
