#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  @MainActor
  struct MacComposerTextInputTests {
    @Test func mentionShortcutStartsQueryAtSelection() {
      let input = MacComposerTextInput.InputView()
      input.mentions = [.init(id: "peer", name: "Anna", slug: "anna", kind: .human)]
      input.restoreDraft("Hello")
      input.setSelectedRange(NSRange(location: 5, length: 0))
      let commands = MacComposerCommands()
      commands.input = input
      commands.beginMention()
      #expect(input.string == "Hello @\n")
      #expect(input.selectedRange().location == 7)
    }

    @Test func mentionChipRestoresAndDeletesAsOneCharacter() {
      let input = MacComposerTextInput.InputView()
      input.mentions = [.init(id: "user-1", name: "Anna", slug: "anna", kind: .human)]
      input.restoreDraft("@user-1:anna")
      #expect(input.string == "\u{FFFC}\n")
      let attachment = input.attributedString().attribute(.attachment, at: 0, effectiveRange: nil) as? NSTextAttachment
      #expect(attachment?.image != nil)
      #expect((attachment?.bounds.width ?? 0) > 0)
      #expect(attachment?.image?.accessibilityDescription == "@Anna")
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      input.setSelectedRange(NSRange(location: 0, length: 1))
      #expect(input.writeSelection(to: pasteboard, type: .string))
      #expect(pasteboard.string(forType: .string) == "@user-1:anna")
      input.setSelectedRange(NSRange(location: 1, length: 0))
      input.insertText("!", replacementRange: input.selectedRange())
      #expect(input.captureDraft() == "@user-1:anna!\n")
      input.setSelectedRange(NSRange(location: 1, length: 0))
      input.deleteBackward(nil)
      #expect(input.captureDraft() == "!\n")
    }

    @Test func replacingReferenceWithLinkLabelDoesNotRetainToken() {
      let input = MacComposerTextInput.InputView()
      input.mentions = [.init(id: "peer", name: "Anna", slug: "anna", kind: .human)]
      input.restoreDraft("@peer:anna\n")
      input.insertLink(label: "Profile", destination: "https://example.com", range: NSRange(location: 0, length: 1))
      #expect(input.captureDraft() == "[Profile](https://example.com/)\n")
    }

    @Test func mentionCompletionRequiresExplicitAcceptance() {
      let input = MacComposerTextInput.InputView()
      input.mentions = [.init(id: "user-1", name: "Anna", slug: "anna", kind: .human)]
      input.string = "@an"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      let commands = MacComposerCommands()
      commands.input = input
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.map(\.name) == ["Anna"])
      #expect(!commands.handleSuggestionKey(124))
      #expect(input.string == "@an")
      #expect(commands.handleSuggestionKey(36))
      #expect(input.string == "\u{FFFC} ")
      #expect(input.captureDraft().contains("@user-1"))
      #expect(!input.captureDraft().contains("@user-1:"))
    }

    @Test func mentionAcceptMatchesIdentityAfterRosterRefresh() {
      let input = MacComposerTextInput.InputView()
      let stale = ComposerMention(id: "user-1", name: "Anna", slug: "anna", kind: .human, image: "old")
      input.mentions = [stale]
      input.string = "@an"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      input.mentions = [.init(id: "user-1", name: "Annabelle", slug: "annabelle", kind: .human, image: "new")]
      input.acceptMention(stale)
      #expect(input.string == "\u{FFFC} ")
      #expect(input.captureDraft().contains("@user-1"))
      #expect(!input.captureDraft().contains("@user-1:"))
      input.string = "@an"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      input.acceptMention(.init(id: "other", name: "Annabelle", slug: "annabelle", kind: .human))
      #expect(input.string == "@an")
    }

    @Test func channelAcceptMatchesIdentityAfterRosterRefresh() {
      let input = MacComposerTextInput.InputView()
      let stale = ComposerChannel(id: "room", name: "Launch Room", slug: "launch-room")
      input.channels = [stale]
      input.string = "#la"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      input.channels = [.init(id: "room", name: "Launch", slug: "launch-room", organizationName: "Acme")]
      input.acceptChannel(stale)
      #expect(input.string == "\u{FFFC} ")
      #expect(input.captureDraft().contains("#Launch"))
      input.string = "#la"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      input.acceptChannel(.init(id: "other", name: "Launch", slug: "launch-room"))
      #expect(input.string == "#la")
    }

    @Test func mentionPanelGroupsNavigatesAndDismissesWithoutInsertion() {
      let input = MacComposerTextInput.InputView()
      input.mentions = [.init(id: "agent", name: "Agent", slug: "agent", kind: .coworker),
                        .init(id: "person", name: "Person", slug: "person", kind: .human)]
      input.string = "@"
      input.setSelectedRange(NSRange(location: 1, length: 0))
      let commands = MacComposerCommands()
      commands.input = input
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.map(\.id) == ["person", "agent"])
      #expect(commands.handleSuggestionKey(125))
      #expect(commands.selectedSuggestionID == "agent")
      #expect(commands.handleSuggestionKey(53))
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.isEmpty)
      #expect(input.string == "@")
    }

    @Test func channelCompletionRequiresAcceptanceAndSerializesName() {
      let input = MacComposerTextInput.InputView()
      input.channels = [.init(id: "room", name: "Launch Room", slug: "launch-room")]
      input.string = "#la"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      let commands = MacComposerCommands()
      commands.input = input
      commands.refreshSuggestions()
      #expect(commands.channelOptions.map(\.name) == ["Launch Room"])
      #expect(!commands.handleSuggestionKey(124))
      #expect(input.string == "#la")
      #expect(commands.handleSuggestionKey(48))
      #expect(input.string == "\u{FFFC} ")
      #expect(input.captureDraft().contains("#Launch Room"))
      input.restoreDraft("Hi #Launch Room!\n")
      #expect(input.string == "Hi \u{FFFC}!\n")
      #expect(input.captureDraft() == "Hi #Launch Room!\n")
    }

    @Test func modifiedReturnExitsQuoteAndSupportsUndo() throws {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.restoreDraft("> hello\n")
      input.setSelectedRange(NSRange(location: 5, length: 0))
      try input.keyDown(with: returnEvent(.shift))
      let quoted = input.captureDraft()
      try input.keyDown(with: returnEvent(.shift))
      #expect(input.captureDraft() == "> hello\n\n")
      input.insertText("outside", replacementRange: input.selectedRange())
      #expect(input.captureDraft() == "> hello\noutside\n")
      delegate.manager.undo()
      delegate.manager.undo()
      #expect(input.captureDraft() == quoted)
    }

    @Test func newlineWithinListPreservesSingleItem() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("- firstsecond\n")
      input.setSelectedRange(NSRange(location: 7, length: 0))
      input.insertNewline(nil)
      #expect(input.captureDraft() == "- first\n  second\n")
    }

    @Test func typingFormatNotifiesToolbarBeforeTextInsertion() {
      let input = MacComposerTextInput.InputView()
      var notifications = 0
      input.formattingDidChange = { notifications += 1 }
      input.toggleFormat(.bold)
      #expect(notifications == 1)
      #expect(input.string.isEmpty)
      input.toggleFormat(.bold)
      #expect(notifications == 2)
      #expect(input.string.isEmpty)
    }

    @Test func pastesTextWithoutImportingClipboardFormatting() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      pasteboard.setString("hello", forType: .string)
      pasteboard.setString("{\\rtf1\\b hello}", forType: .rtf)
      let input = MacComposerTextInput.InputView()
      input.isRichText = true
      input.pasteText(from: pasteboard)
      #expect(input.captureDraft() == "hello\n")
    }

    @Test func linkReplacementWithDifferentLengthIsUndoable() {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.restoreDraft("old")
      input.insertLink(label: "new label", destination: "https://example.com", range: NSRange(location: 0, length: 3))
      #expect(input.captureDraft() == "[new label](https://example.com/)\n")
      delegate.manager.undo()
      #expect(input.captureDraft() == "old\n")
    }

    @Test func linkEditorExpandsExistingLinkAtCaret() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("[site](https://example.com/)")
      input.setSelectedRange(NSRange(location: 2, length: 0))
      let commands = MacComposerCommands()
      commands.input = input
      commands.beginLink()
      #expect(commands.linkEditor?.text == "site")
      #expect(commands.linkEditor?.url == "https://example.com/")
      #expect(commands.linkEditor?.range == NSRange(location: 0, length: 4))
      #expect(input.serializedDraft == "[site](https://example.com/)")
    }

    @Test func blockFormatLeavesCaretForContinuedTyping() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("hello")
      input.setSelectedRange(NSRange(location: 5, length: 0))
      input.applyBlockFormat(.unorderedList)
      #expect(input.selectedRange().length == 0)
      input.insertText("!", replacementRange: input.selectedRange())
      #expect(input.captureDraft() == "- hello!\n")
    }

    @Test func linkInsertedAtListMarkerIsSerialized() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("- item\n")
      input.insertLink(label: "site", destination: "https://example.com", range: NSRange(location: 0, length: 0))
      #expect(input.captureDraft().contains("[site](https://example.com/)"))
      #expect(input.captureDraft().contains("item"))
    }

    @Test func toolbarCommandUsesExistingEditorSelection() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("hello world")
      let selection = NSRange(location: 6, length: 5)
      input.setSelectedRange(selection)
      let commands = MacComposerCommands()
      commands.input = input
      commands.toggle(.italic)
      #expect(input.selectedRange() == selection)
      #expect(input.captureDraft() == "hello _world_\n")
    }

    @Test func linkSheetExcludesListPrefixAndKeepsItWhenRenaming() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("- item\n")
      input.setSelectedRange(NSRange(location: 0, length: 6))
      let commands = MacComposerCommands()
      commands.input = input
      commands.beginLink()
      #expect(commands.linkEditor?.text == "item")
      guard let editor = commands.linkEditor else { return }
      commands.saveLink(editor, text: "site", url: "https://example.com")
      #expect(input.string.hasPrefix("•\t"))
      #expect(input.captureDraft() == "- [site](https://example.com/)\n")
    }

    @Test func formattingSelectionPreservesTextSelectionAndUndo() {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.restoreDraft("hello")
      let selection = NSRange(location: 0, length: 5)
      input.setSelectedRange(selection)
      input.toggleFormat(.bold)
      #expect(input.selectedRange() == selection)
      #expect(input.captureDraft() == "**hello**\n")
      input.undoManager?.undo()
      #expect(input.captureDraft() == "hello\n")
    }

    @Test func togglingFormatOffRemovesVisualAndSemanticStyle() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("<u>hello</u>")
      input.setSelectedRange(NSRange(location: 0, length: 5))
      input.toggleFormat(.underline)
      #expect(input.captureDraft() == "hello\n")
      #expect(input.attributedString().attribute(.underlineStyle, at: 0, effectiveRange: nil) == nil)
    }

    @Test func restoresFormattedDraftAndSerializesNativeEdits() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("**hello**")
      #expect(input.string == "hello\n")
      #expect(input.serializedDraft == "**hello**")
      input.textStorage?.replaceCharacters(in: NSRange(location: 1, length: 3), with: "i")
      #expect(input.captureDraft() == "**hio**\n")
    }

    @Test func retainsUnsupportedDraftVerbatim() {
      let source = "![image](https://example.com/image.png)"
      let input = MacComposerTextInput.InputView()
      input.restoreDraft(source)
      #expect(input.string == source)
      #expect(input.captureDraft() == source)
    }

    @Test func doesNotConvertEmojiInsideRestoredCode() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("`:D`")
      input.setSelectedRange(NSRange(location: 2, length: 0))
      input.typingAttributes = input.attributedString().attributes(at: 0, effectiveRange: nil)
      input.insertText(" ", replacementRange: input.selectedRange())
      #expect(input.string == ":D \n")
      #expect(input.emojiCompletionRange == nil)
    }

    @Test func acceptsCompletionWithoutReplacingSurroundingText() {
      let input = MacComposerTextInput.InputView()
      input.string = "😀 :sm tail"
      input.setSelectedRange(NSRange(location: 6, length: 0))
      #expect(input.emojiCompletionRange == NSRange(location: 3, length: 3))
      let commands = MacComposerCommands()
      commands.input = input
      commands.refreshSuggestions()
      #expect(commands.emojiOptions.contains(":smile:"))
      commands.selectedSuggestionID = ":smile:"
      #expect(commands.handleSuggestionKey(48))
      #expect(input.string == "😀 😄 tail")
      #expect(input.selectedRange().location == 5)
    }

    @Test func emojiSuggestionsRequireAcceptanceAndRespectDismissal() {
      let input = MacComposerTextInput.InputView()
      let commands = MacComposerCommands()
      commands.input = input
      input.string = ":sm"
      input.setSelectedRange(NSRange(location: 3, length: 0))
      commands.refreshSuggestions()
      #expect(!commands.emojiOptions.isEmpty)
      #expect(commands.handleSuggestionKey(125))
      #expect(input.string == ":sm")
      #expect(commands.handleSuggestionKey(53))
      commands.refreshSuggestions()
      #expect(commands.emojiOptions.isEmpty)
      input.insertText("i", replacementRange: input.selectedRange())
      commands.refreshSuggestions()
      #expect(input.string == ":smi")
      #expect(commands.emojiOptions.contains(":smile:"))
      #expect(!commands.emojiOptions.contains(":small_airplane:"))
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

    @Test func emojiUndoWithoutExplicitGrouping() {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.string = ":D"
      input.setSelectedRange(NSRange(location: 2, length: 0))
      input.insertText(" ", replacementRange: input.selectedRange())
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
      input.font = .preferredFont(forTextStyle: .body)
      input.string = "first\nsecond\nthird\nfourth"
      let first = scroll.measuredSize(for: ProposedViewSize(width: 400, height: nil))
      input.string = "first\nsecond\nthird\nfourth\n"
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
