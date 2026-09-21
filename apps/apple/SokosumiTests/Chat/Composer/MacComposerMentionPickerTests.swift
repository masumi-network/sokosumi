#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// The toolbar mention button, against web's `openMentions` / `insertMention`.
  @MainActor
  struct MacComposerMentionPickerTests {
    private static let catalog: [ComposerMention] = [
      .init(id: "agent", name: "Agent", slug: "agent", kind: .coworker),
      .init(id: "anna", name: "Anna", slug: "anna", kind: .human),
      .init(id: "bob", name: "Bob", slug: "bob", kind: .human)
    ]

    private func composer(_ draft: String, selection: NSRange) -> (MacComposerTextInput.InputView, MacComposerCommands) {
      let input = MacComposerTextInput.InputView()
      input.mentions = Self.catalog
      input.channels = [.init(id: "room", name: "General", slug: "general")]
      if !draft.isEmpty {
        input.restoreDraft(draft)
      }
      input.setSelectedRange(selection)
      let commands = MacComposerCommands()
      commands.input = input
      return (input, commands)
    }

    /// An NSTextView paragraph serializes with its closing newline.
    private func draft(_ input: MacComposerTextInput.InputView) -> String {
      let draft = input.captureDraft()
      return draft.hasSuffix("\n") ? String(draft.dropLast()) : draft
    }

    private func type(_ text: String, into input: MacComposerTextInput.InputView) {
      input.insertText(text, replacementRange: input.selectedRange())
    }

    /// Empty draft, end of text, mid-word, and a non-empty selection.
    @Test(arguments: [
      ("", NSRange(location: 0, length: 0)),
      ("Hello", NSRange(location: 5, length: 0)),
      ("Hello", NSRange(location: 2, length: 0)),
      ("Hello world", NSRange(location: 0, length: 5))
    ])
    func buttonOpensTheListAndLeavesDraftAndSelectionAlone(draft: String, selection: NSRange) {
      let (input, commands) = composer(draft, selection: selection)
      let text = input.string
      let serialized = input.captureDraft()
      commands.openMentionPicker()
      #expect(commands.mentionOptions.map(\.id) == ["anna", "bob", "agent"])
      #expect(commands.selectedSuggestionID == "anna")
      #expect(input.string == text)
      #expect(input.captureDraft() == serialized)
      #expect(input.selectedRange() == selection)
      // Web does not toggle: a second press keeps the list and still types nothing.
      commands.openMentionPicker()
      #expect(!commands.mentionOptions.isEmpty)
      #expect(input.string == text)
      #expect(input.selectedRange() == selection)
    }

    @Test func escapeDismissesAndLeavesTheDraftUntouched() {
      let (input, commands) = composer("Hello", selection: NSRange(location: 5, length: 0))
      let text = input.string
      let serialized = input.captureDraft()
      commands.openMentionPicker()
      #expect(commands.handleSuggestionKey(53))
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.isEmpty)
      #expect(input.string == text)
      #expect(input.captureDraft() == serialized)
      #expect(input.selectedRange() == NSRange(location: 5, length: 0))
      // The next Escape is the composer's own again (cancel edit).
      #expect(!commands.handleSuggestionKey(53))
    }

    /// `textDidEndEditing` and an external draft replacement end here.
    @Test func focusLossAndDraftReplacementCloseTheButtonOpenedList() {
      let (input, commands) = composer("Hello", selection: NSRange(location: 5, length: 0))
      commands.openMentionPicker()
      commands.dismissSuggestions()
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.isEmpty)
      commands.openMentionPicker()
      commands.closeMentionPicker()
      #expect(commands.mentionOptions.isEmpty)
      #expect(input.string == "Hello\n" || input.string == "Hello")
      #expect(draft(input) == "Hello")
    }

    @Test func closingTheButtonListLeavesATypedTriggerOpen() {
      let (input, commands) = composer("", selection: NSRange(location: 0, length: 0))
      type("@an", into: input)
      commands.refreshSuggestions()
      commands.closeMentionPicker()
      #expect(commands.mentionOptions.map(\.id) == ["anna"])
    }

    /// The list survives caret moves, which close nothing on web either.
    @Test func caretMovesKeepTheButtonOpenedList() {
      let (input, commands) = composer("Hello", selection: NSRange(location: 5, length: 0))
      commands.openMentionPicker()
      input.setSelectedRange(NSRange(location: 1, length: 0))
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.count == 3)
    }

    @Test(arguments: [
      ("", NSRange(location: 0, length: 0)),
      ("Hello", NSRange(location: 5, length: 0)),
      ("Hello ", NSRange(location: 6, length: 0)),
      ("Hello", NSRange(location: 2, length: 0)),
      ("Hello world", NSRange(location: 5, length: 0))
    ])
    func selectingInsertsExactlyWhatTheTypedPathInserts(draft: String, selection: NSRange) {
      let (input, commands) = composer(draft, selection: selection)
      commands.openMentionPicker()
      #expect(commands.handleSuggestionKey(36))

      // The typed path: the separator and "@" by hand, then the same accept.
      let (typedInput, typedCommands) = composer(draft, selection: selection)
      let prefix = (typedInput.string as NSString).substring(to: selection.location)
      type((prefix.last.map { $0.isWhitespace ? "" : " " } ?? "") + "@", into: typedInput)
      typedCommands.refreshSuggestions()
      #expect(typedCommands.handleSuggestionKey(36))

      #expect(input.string == typedInput.string)
      #expect(input.captureDraft() == typedInput.captureDraft())
      #expect(input.selectedRange() == typedInput.selectedRange())
      #expect(input.captureDraft().contains("@anna"))
      #expect(!input.string.contains("@"))
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.isEmpty)
    }

    @Test func selectingAtTheEndSeparatesAndTrails() {
      let (input, commands) = composer("", selection: NSRange(location: 0, length: 0))
      type("Hello", into: input)
      commands.openMentionPicker()
      commands.acceptMention(Self.catalog[2])
      #expect(input.string == "Hello \u{FFFC} ")
      #expect(draft(input) == "Hello @bob ")
      #expect(input.selectedRange() == NSRange(location: 8, length: 0))
    }

    /// Web collapses to the selection's end; the selected words stay.
    @Test func selectingWithANonEmptySelectionKeepsTheSelectedText() {
      let (input, commands) = composer("", selection: NSRange(location: 0, length: 0))
      type("Hello world", into: input)
      input.setSelectedRange(NSRange(location: 0, length: 5))
      commands.openMentionPicker()
      #expect(commands.handleSuggestionKey(36))
      #expect(input.string == "Hello \u{FFFC} world")
      #expect(input.selectedRange() == NSRange(location: 7, length: 0))
    }

    @Test func separatorAfterAChipDoesNotJoinThatChip() {
      let (input, commands) = composer("", selection: NSRange(location: 0, length: 0))
      commands.openMentionPicker()
      commands.acceptMention(Self.catalog[1])
      input.setSelectedRange(NSRange(location: 1, length: 0))
      commands.openMentionPicker()
      commands.acceptMention(Self.catalog[2])
      #expect(input.string == "\u{FFFC} \u{FFFC} ")
      #expect(draft(input) == "@anna @bob ")
    }

    /// Web keeps a button-opened list unfiltered; typed text is plain draft text
    /// that survives both dismiss and select.
    @Test func typingUnderTheButtonOpenedListGoesToTheDraftAndDoesNotFilter() {
      let (input, commands) = composer("", selection: NSRange(location: 0, length: 0))
      commands.openMentionPicker()
      type("bo", into: input)
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.map(\.id) == ["anna", "bob", "agent"])
      #expect(commands.selectedSuggestionID == "anna")
      #expect(input.string == "bo")

      #expect(commands.handleSuggestionKey(53))
      #expect(input.string == "bo")
      #expect(draft(input) == "bo")

      commands.openMentionPicker()
      #expect(commands.handleSuggestionKey(36))
      #expect(input.string == "bo \u{FFFC} ")
      #expect(draft(input) == "bo @anna ")
    }

    /// Web's `insertMention` looks for a typed "@query" first, also under the button's list.
    @Test func typedTriggerUnderTheButtonOpenedListIsReplacedOnSelect() {
      let (input, commands) = composer("", selection: NSRange(location: 0, length: 0))
      type("Hi", into: input)
      commands.openMentionPicker()
      type(" @bo", into: input)
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.count == 3)
      commands.acceptMention(Self.catalog[2])
      #expect(input.string == "Hi \u{FFFC} ")
      #expect(draft(input) == "Hi @bob ")
    }

    @Test func buttonOpenedListHidesChannelAndEmojiRows() {
      let (input, commands) = composer("", selection: NSRange(location: 0, length: 0))
      type("#gen", into: input)
      commands.refreshSuggestions()
      #expect(commands.channelOptions.map(\.id) == ["room"])
      commands.openMentionPicker()
      #expect(commands.channelOptions.isEmpty)
      #expect(commands.mentionOptions.count == 3)
      #expect(commands.handleSuggestionKey(53))
      input.string = ":smi"
      input.setSelectedRange(NSRange(location: 4, length: 0))
      commands.refreshSuggestions()
      #expect(!commands.emojiOptions.isEmpty)
      commands.openMentionPicker()
      #expect(commands.emojiOptions.isEmpty)
      #expect(commands.mentionOptions.count == 3)
    }

    @Test func buttonDoesNothingWithoutACatalog() {
      let (input, commands) = composer("Hello", selection: NSRange(location: 5, length: 0))
      input.mentions = []
      let text = input.string
      commands.openMentionPicker()
      #expect(commands.mentionOptions.isEmpty)
      #expect(input.string == text)
      #expect(!commands.handleSuggestionKey(36))
    }

    /// Row 13's typed path: trigger detection, query tracking and dismissal are unchanged.
    @Test func typedTriggerStillFiltersTracksAndDismisses() {
      let (input, commands) = composer("", selection: NSRange(location: 0, length: 0))
      type("@", into: input)
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.count == 3)
      type("b", into: input)
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.map(\.id) == ["bob"])
      #expect(commands.handleSuggestionKey(53))
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.isEmpty)
      #expect(input.string == "@b")
      type("o", into: input)
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.map(\.id) == ["bob"])
      type(" ", into: input)
      commands.refreshSuggestions()
      #expect(commands.mentionOptions.isEmpty)
      #expect(input.string == "@bo ")
    }
  }

  extension NativeWindowTests {
    @MainActor struct MentionButtonPickerFixtureTests {
      /// The real composer with "Hello" typed and the mention button pressed: the
      /// list is open and the editor still reads "Hello", with no "@".
      @Test(arguments: [false, true])
      func rendersTheButtonOpenedList(dark: Bool) async throws {
        var text = "Hello"
        let mentions: [ComposerMention] = [
          .init(id: "anna", name: "Anna Schmidt", slug: "anna", kind: .human, email: "anna@example.com"),
          .init(id: "all", name: "Everyone", slug: "all", kind: .all),
          .init(id: "agent", name: "Research Agent", slug: "research-agent", kind: .coworker)
        ]
        let content = VStack {
          Spacer()
          ComposerTextInput(text: Binding(get: { text }, set: { text = $0 }), submit: { false }, mentions: mentions)
        }
        .padding(12)
        .frame(width: 480, height: 360)
        .environment(\.colorScheme, dark ? .dark : .light)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 360), styleMask: [.titled], backing: .buffered, defer: false)
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        #expect(window.firstResponder !== Self.textView(in: host))
        // Third action button: 12 outer + 12 inner padding, two 28-point buttons and 12-point gaps.
        let point = NSPoint(x: 12 + 12 + 28 + 12 + 28 + 12 + 14, y: 12 + 10 + 14)
        for type in [NSEvent.EventType.leftMouseDown, .leftMouseUp] {
          let event = try #require(NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                      windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1))
          window.sendEvent(event)
        }
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        let input = try #require(Self.textView(in: host))
        #expect(input.string.trimmingCharacters(in: .newlines) == "Hello")
        #expect(text == "Hello")
        // The press focuses the editor; nothing else in this window does.
        #expect(window.firstResponder === input)
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        // Recorded on the result bundle, which the app sandbox cannot hide: `xcresulttool export attachments`.
        Attachment.record(png, named: "composer-mention-button-picker-\(dark ? "dark" : "light").png")
      }

      private static func textView(in view: NSView) -> NSTextView? {
        if let input = view as? NSTextView {
          return input
        }
        return view.subviews.lazy.compactMap { textView(in: $0) }.first
      }
    }
  }
#endif
