#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  @MainActor
  struct MacComposerTextInputTests {
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

    @Test func pasteSwapRemovesTheInsertedTextAndLeavesABlankDraft() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let url = "https://app.sokosumi.com/chat/rooms/source?message=m1"
      pasteboard.setString(url, forType: .string)
      let input = MacComposerTextInput.InputView()
      input.isRichText = true
      var paste: ComposerTextPaste?
      input.onPaste = { paste = $0 }
      input.pasteText(from: pasteboard)
      #expect(paste?.text == url)
      #expect(input.captureDraft() == "\(url)\n")
      #expect(paste?.remove() == true)
      let leftover = input.captureDraft()
      #expect(!leftover.contains(url))
      #expect(leftover.isEmpty)
      #expect(paste?.remove() == false)
    }

    @Test func insertAtCaretPutsTextAtTheSelection() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("ab")
      input.setSelectedRange(NSRange(location: 1, length: 0))
      input.insertAtCaret("X")
      #expect(input.captureDraft() == "aXb\n")
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

    // MARK: Code block control, both ways (12c)

    @Test func codeBlockControlWrapsTheSelectionAndLeavesTheCaretAtTheEndOfTheCode() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("hello world")
      input.setSelectedRange(NSRange(location: 0, length: 11))
      input.applyBlockFormat(.codeBlock)
      #expect(input.captureDraft() == "```\nhello world\n```\n")
      #expect(input.selectedRange() == NSRange(location: 11, length: 0))
      #expect((input.attributedString().attribute(.font, at: 0, effectiveRange: nil) as? NSFont)?.isFixedPitch == true)
      input.insertText("!", replacementRange: input.selectedRange())
      #expect(input.captureDraft() == "```\nhello world!\n```\n")
    }

    @Test(arguments: [NSRange(location: 0, length: 0), NSRange(location: 8, length: 0), NSRange(location: 12, length: 0), NSRange(location: 2, length: 6)])
    func codeBlockControlUnwrapsTheWholeBlockAndLeavesTheCaretAtItsEnd(_ selection: NSRange) {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("```swift\nfirst\nsecond\n```\n")
      input.setSelectedRange(selection)
      input.applyBlockFormat(.codeBlock)
      #expect(input.string == "first\nsecond\n")
      #expect(input.captureDraft() == "first\nsecond\n")
      #expect(input.selectedRange() == NSRange(location: 12, length: 0))
      let shown = input.attributedString()
      #expect((shown.attribute(.font, at: 0, effectiveRange: nil) as? NSFont)?.isFixedPitch == false)
      #expect(shown.attribute(.backgroundColor, at: 0, effectiveRange: nil) == nil)
      input.insertText("!", replacementRange: input.selectedRange())
      #expect(input.captureDraft() == "first\nsecond!\n")
    }

    @Test func codeBlockControlLeavesOtherBlocksAlone() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("before\n\n```\none\n```\n\n```\ntwo\n```\n\n> ```\n> quoted\n> ```\n")
      input.setSelectedRange(NSRange(location: (input.string as NSString).range(of: "two").location, length: 0))
      input.applyBlockFormat(.codeBlock)
      #expect(input.captureDraft() == "before\n\n```\none\n```\n\ntwo\n\n> ```\n> quoted\n> ```\n")
      input.setSelectedRange(NSRange(location: (input.string as NSString).range(of: "quoted").location + 2, length: 0))
      input.applyBlockFormat(.codeBlock)
      #expect(input.captureDraft() == "before\n\n```\none\n```\n\ntwo\n\n> quoted\n")
    }

    @Test(arguments: [("", "```\nlet x\n```\n"), ("hello", "hello\n```\nlet x\n```\n")])
    func textTypedIntoAFreshBlockIsSentInsideTheFence(_ draft: String, _ sent: String) {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft(draft)
      input.setSelectedRange(NSRange(location: draft.utf16.count, length: 0))
      input.applyBlockFormat(.codeBlock)
      #expect(input.selectedRange().length == 0)
      for character in "let x" {
        input.insertText(String(character), replacementRange: input.selectedRange())
      }
      #expect(input.captureDraft() == sent)
    }

    @Test(arguments: ["hello\n", "first\nsecond\n", "a\n\nb\n", "so **x** and _y_\n"])
    func wrappingThenUnwrappingSendsTheSameDraft(_ plain: String) {
      let input = MacComposerTextInput.InputView()
      input.string = String(plain.dropLast())
      let original = input.captureDraft()
      #expect(original == plain)
      input.setSelectedRange(NSRange(location: 0, length: input.string.utf16.count))
      input.applyBlockFormat(.codeBlock)
      #expect(input.captureDraft() == "```\n" + plain + "```\n")
      input.applyBlockFormat(.codeBlock)
      #expect(input.captureDraft() == original)
    }

    @Test(arguments: ["```\nhello\n```\n", "```\nfirst\n\nsecond\n```\n", "before\n```\nmid **x** dle\n```\nafter\n"])
    func unwrappingThenWrappingSendsTheSameDraft(_ fenced: String) {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft(fenced)
      let original = input.captureDraft()
      #expect(original == fenced)
      let shown = input.string
      let start = (shown as NSString).range(of: shown.hasPrefix("before") ? "mid" : String(shown.prefix(3))).location
      input.setSelectedRange(NSRange(location: start, length: 0))
      input.applyBlockFormat(.codeBlock)
      let end = input.selectedRange().location
      input.setSelectedRange(NSRange(location: start, length: end - start))
      input.applyBlockFormat(.codeBlock)
      #expect(input.captureDraft() == original)
      #expect(input.string == shown)
    }

    /// The toolbar highlight is `activeBlocks`, and the control runs `apply`.
    @Test func codeBlockHighlightFollowsTheCaretThroughEachToggle() async throws {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("plain\n\n```\ncode\n```\n")
      let commands = MacComposerCommands()
      commands.input = input
      func highlighted(at location: Int? = nil) async throws -> Bool {
        if let location {
          input.setSelectedRange(NSRange(location: location, length: 0))
        }
        commands.refresh()
        try await Task.sleep(for: .milliseconds(50))
        return commands.activeBlocks.contains(.codeBlock)
      }
      let code = (input.string as NSString).range(of: "code")
      #expect(try await !highlighted(at: 2))
      #expect(try await highlighted(at: code.location))
      #expect(try await highlighted(at: NSMaxRange(code)))
      commands.apply(.codeBlock)
      #expect(try await !highlighted())
      #expect(input.captureDraft() == "plain\n\ncode\n")
      input.setSelectedRange(code)
      commands.apply(.codeBlock)
      #expect(try await highlighted())
      #expect(input.captureDraft() == "plain\n\n```\ncode\n```\n")
      commands.apply(.codeBlock)
      #expect(try await !highlighted())
      input.setSelectedRange(NSRange(location: 0, length: 0))
      input.restoreDraft("")
      commands.apply(.codeBlock)
      #expect(try await highlighted())
    }

    /// One registered undo per toggle, asserted in isolation: the draft is restored, not
    /// typed, so the toggle is the only step on the manager. The XCTest host never closes
    /// the undo manager's event group, so this says nothing about ⌘Z grouping in the app.
    @Test func eachCodeBlockToggleIsOneUndoStep() {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.restoreDraft("```\nfirst\nsecond\n```\n")
      input.setSelectedRange(NSRange(location: 3, length: 0))
      input.applyBlockFormat(.codeBlock)
      #expect(input.captureDraft() == "first\nsecond\n")
      delegate.manager.undo()
      #expect(input.captureDraft() == "```\nfirst\nsecond\n```\n")
      #expect((input.attributedString().attribute(.font, at: 0, effectiveRange: nil) as? NSFont)?.isFixedPitch == true)
      #expect(!delegate.manager.canUndo)
      delegate.manager.redo()
      #expect(input.captureDraft() == "first\nsecond\n")
      delegate.manager.undo()
      input.restoreDraft("first\nsecond")
      input.setSelectedRange(NSRange(location: 0, length: 12))
      input.applyBlockFormat(.codeBlock)
      #expect(input.captureDraft() == "```\nfirst\nsecond\n```\n")
      delegate.manager.undo()
      #expect(input.captureDraft() == "first\nsecond\n")
      #expect(!delegate.manager.canUndo)
    }

    /// Web runs `handleInput` after the toggle, and with it the input rule at the caret:
    /// a closed pair that ends the unwrapped text formats, and the draft stays
    /// byte-identical. Pairs anywhere else stay literal. The unwrap and the formatting are
    /// registered in the same event, so one undo takes both back and one redo repeats both.
    @Test func unwrappingRunsTheInputRuleOnlyAtTheCaret() {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.restoreDraft("```\n_a_ so **x**\n```\n")
      input.setSelectedRange(NSRange(location: 1, length: 0))
      input.applyBlockFormat(.codeBlock)
      #expect(input.string == "_a_ so x\n")
      #expect(input.attributedString().attribute(ComposerInlineText.bold, at: 7, effectiveRange: nil) as? Bool == true)
      #expect(input.attributedString().attribute(ComposerInlineText.italic, at: 1, effectiveRange: nil) == nil)
      #expect(input.captureDraft() == "_a_ so **x**\n")
      delegate.manager.undo()
      #expect(input.string == "_a_ so **x**\n")
      #expect(input.captureDraft() == "```\n_a_ so **x**\n```\n")
      #expect(input.attributedString().attribute(ComposerInlineText.bold, at: 9, effectiveRange: nil) == nil)
      #expect(!delegate.manager.canUndo)
      delegate.manager.redo()
      #expect(input.string == "_a_ so x\n")
      #expect(input.captureDraft() == "_a_ so **x**\n")
      delegate.manager.undo()
      #expect(input.captureDraft() == "```\n_a_ so **x**\n```\n")
    }

    @Test func unwrappingLeavesDelimitersThatDoNotEndAtTheCaretLiteral() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("```\n**x** and `y`\ntail\n```\n")
      input.setSelectedRange(NSRange(location: 1, length: 0))
      input.applyBlockFormat(.codeBlock)
      #expect(input.string == "**x** and `y`\ntail\n")
      #expect(input.attributedString().attribute(ComposerInlineText.bold, at: 2, effectiveRange: nil) == nil)
      #expect(input.captureDraft() == "**x** and `y`\ntail\n")
    }

    @Test func wrappingNeverRunsTheInputRule() {
      let input = MacComposerTextInput.InputView()
      input.string = "so **x**"
      input.setSelectedRange(NSRange(location: 0, length: 8))
      input.applyBlockFormat(.codeBlock)
      #expect(input.string == "so **x**\n")
      #expect(input.captureDraft() == "```\nso **x**\n```\n")
      let opened = MacComposerTextInput.InputView()
      opened.string = "so **x**"
      opened.setSelectedRange(NSRange(location: 8, length: 0))
      opened.applyBlockFormat(.codeBlock)
      #expect(opened.string == "so **x**\n\n")
      #expect(opened.captureDraft() == "so **x**\n```\n\n```\n")
    }

    @MainActor struct CodeBlockFixtureTests {
      /// The real composer with its toolbar, focused, the caret inside a code block: the
      /// block is monospaced on its tint and the Code block control is highlighted. Then
      /// the control's own action runs: plain lines, no tint, the control idle.
      @Test(.serialized, arguments: [false, true])
      func rendersTheBlockWithItsControlOnThenThePlainLinesWithItOff(dark: Bool) async throws {
        var text = "Run this:\n\n```\nlet x = 1\nprint(x)\n```\n"
        // The composer reads the toolbar preference once, when it is created.
        let toolbarWasVisible = ComposerPreferences().toolbarVisible
        ComposerPreferences().toolbarVisible = true
        defer { ComposerPreferences().toolbarVisible = toolbarWasVisible }
        let content = VStack {
          Spacer()
          ComposerTextInput(text: Binding(get: { text }, set: { text = $0 }), submit: { false })
        }
        .padding(12)
        .frame(width: 480, height: 220)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 220), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        let input = try #require(Self.textView(in: host) as? MacComposerTextInput.InputView)
        let commands = try #require((input.delegate as? MacComposerTextInput.Coordinator)?.parent.commands)
        #expect(ComposerPreferences().toolbarVisible)
        #expect(window.makeFirstResponder(input))
        let block = (input.string as NSString).range(of: "let x = 1\nprint(x)\n")
        input.setSelectedRange(NSRange(location: (input.string as NSString).range(of: "print").location, length: 0))
        try await Task.sleep(for: .milliseconds(300))
        #expect(commands.activeBlocks == [.codeBlock])
        var tinted = NSRange()
        #expect(input.attributedString().attribute(.backgroundColor, at: block.location, longestEffectiveRange: &tinted, in: NSRange(location: 0, length: input.string.utf16.count)) != nil)
        #expect(tinted == block)
        #expect((input.attributedString().attribute(.font, at: block.location, effectiveRange: nil) as? NSFont)?.isFixedPitch == true)
        try Self.record(host, named: "composer-code-block-on-\(dark ? "dark" : "light").png")

        commands.apply(.codeBlock)
        try await Task.sleep(for: .milliseconds(300))
        #expect(commands.activeBlocks.isEmpty)
        #expect(text == "Run this:\n\nlet x = 1\nprint(x)\n")
        #expect(input.string == "Run this:\n\nlet x = 1\nprint(x)\n")
        #expect(input.selectedRange() == NSRange(location: NSMaxRange(block) - 1, length: 0))
        input.attributedString().enumerateAttributes(in: NSRange(location: 0, length: input.string.utf16.count)) { values, _, _ in
          #expect(values[.backgroundColor] == nil)
          #expect((values[.font] as? NSFont)?.isFixedPitch == false)
        }
        try Self.record(host, named: "composer-code-block-off-\(dark ? "dark" : "light").png")
      }

      /// Recorded on the result bundle, which the app sandbox cannot hide: `xcresulttool export attachments`.
      private static func record(_ host: NSView, named name: String) throws {
        host.layoutSubtreeIfNeeded()
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        try Attachment.record(#require(bitmap.representation(using: .png, properties: [:])), named: name)
      }

      private static func textView(in view: NSView) -> NSTextView? {
        if let input = view as? NSTextView {
          return input
        }
        return view.subviews.lazy.compactMap { textView(in: $0) }.first
      }
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

    @Test func editingReturnInsertsLineAndCommandReturnSavesWithoutClearing() throws {
      let input = MacComposerTextInput.InputView()
      input.submitOnModifier = true
      input.string = "Original"
      input.setSelectedRange(NSRange(location: 8, length: 0))
      var submissions = 0
      input.submit = { submissions += 1
        return false
      }
      try input.keyDown(with: returnEvent())
      #expect(submissions == 0)
      #expect(input.string == "Original\n")
      try input.keyDown(with: returnEvent(.command))
      #expect(submissions == 1)
      #expect(input.string == "Original\n")
      var cancelled = false
      input.cancel = { cancelled = true }
      let escape = try #require(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: 0,
                                                 windowNumber: 0, context: nil, characters: "\u{1B}",
                                                 charactersIgnoringModifiers: "\u{1B}", isARepeat: false, keyCode: 53))
      input.keyDown(with: escape)
      #expect(cancelled)
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
