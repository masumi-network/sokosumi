#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
  import SwiftUI
  import Testing

  /// Typed markdown shortcuts through the real text view. The matcher's own table
  /// is `ComposerInputRuleTests` in `SokosumiChat`.
  @MainActor
  struct MacComposerInputRuleTests {
    /// Types one character per keystroke, as the input context delivers them.
    private func type(_ text: String, into input: MacComposerTextInput.InputView) {
      for character in text {
        input.insertText(String(character), replacementRange: input.selectedRange())
      }
    }

    @Test(arguments: [
      ("**hi**", ComposerInlineText.Style.bold), ("~~hi~~", .strikethrough), ("_hi_", .italic), ("`hi`", .code)
    ])
    func theTypedClosingDelimiterFormatsAndRemovesTheDelimiters(_ typed: String, _ style: ComposerInlineText.Style) {
      let input = MacComposerTextInput.InputView()
      var refreshes = 0
      input.formattingDidChange = { refreshes += 1 }
      type("so " + typed, into: input)
      #expect(input.string == "so hi")
      #expect(input.selectedRange() == NSRange(location: 5, length: 0))
      let formatted = input.attributedString()
      #expect(formatted.attribute(style.attribute, at: 3, effectiveRange: nil) as? Bool == true)
      #expect(formatted.attribute(style.attribute, at: 4, effectiveRange: nil) as? Bool == true)
      #expect(formatted.attribute(style.attribute, at: 0, effectiveRange: nil) == nil)
      #expect(refreshes == 1)
      // The same bytes as the literal delimiters produced, through the one serializer.
      #expect(input.captureDraft() == "so " + typed + "\n")
      #expect(input.captureDraft() == ComposerBlockText.document(NSAttributedString(string: "so " + typed)).markdown)
    }

    @Test func theFormattedRunLooksFormatted() throws {
      let input = MacComposerTextInput.InputView()
      type("**hi** ~~no~~ `x`", into: input)
      #expect(input.string == "hi no x")
      let text = input.attributedString()
      let bold = try #require(text.attribute(.font, at: 0, effectiveRange: nil) as? NSFont)
      #expect(NSFontManager.shared.traits(of: bold).contains(.boldFontMask))
      #expect(text.attribute(.strikethroughStyle, at: 3, effectiveRange: nil) as? Int == NSUnderlineStyle.single.rawValue)
      let code = try #require(text.attribute(.font, at: 6, effectiveRange: nil) as? NSFont)
      #expect(code.isFixedPitch)
      let plain = try #require(text.attribute(.font, at: 2, effectiveRange: nil) as? NSFont)
      #expect(!NSFontManager.shared.traits(of: plain).contains(.boldFontMask))
    }

    /// Web leaves the caret after the mark, so the next character is not part of it.
    @Test(arguments: ["**hi**", "~~hi~~", "_hi_", "`hi`"])
    func typingContinuesOutsideTheFormattedRun(_ typed: String) {
      let input = MacComposerTextInput.InputView()
      type(typed + " there", into: input)
      #expect(input.string == "hi there")
      #expect(input.captureDraft() == typed + " there\n")
    }

    @Test func typingContinuesInTheSurroundingFormat() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("**so**")
      input.setSelectedRange(NSRange(location: 2, length: 0))
      type(" _x_ on", into: input)
      #expect(input.string == "so x on\n")
      #expect(input.captureDraft() == "**so _x_ on**\n")
    }

    private final class UndoDelegate: NSObject, NSTextViewDelegate {
      let manager = UndoManager()
      func undoManager(for _: NSTextView) -> UndoManager? {
        manager
      }
    }

    /// The formatting is an undo step of its own, and undoing it puts back exactly what
    /// was typed. The literal text is set, not typed, so that step is the only one here:
    /// a view outside a running event loop does not coalesce typing the way the app does.
    @Test func undoingTheFormattingRestoresTheLiteralDelimiters() {
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      input.string = "so **hi**"
      input.setSelectedRange(NSRange(location: 9, length: 0))
      #expect(input.applyInputRule(typed: "*"))
      #expect(input.string == "so hi")
      delegate.manager.undo()
      #expect(input.string == "so **hi**")
      #expect(input.selectedRange() == NSRange(location: 9, length: 0))
      #expect(input.attributedString().attribute(ComposerInlineText.bold, at: 5, effectiveRange: nil) == nil)
      #expect(input.captureDraft() == "so **hi**\n")
      delegate.manager.redo()
      #expect(input.string == "so hi")
      #expect(input.selectedRange() == NSRange(location: 5, length: 0))
      #expect(input.typingAttributes[ComposerInlineText.bold] == nil)
      delegate.manager.undo()
      #expect(input.string == "so **hi**")
      #expect(!delegate.manager.canUndo)
    }

    @Test func pasteDoesNotFormat() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let input = MacComposerTextInput.InputView()
      pasteboard.setString("**hi**", forType: .string)
      input.pasteText(from: pasteboard)
      #expect(input.string == "**hi**")
      // Not even a pasted closing delimiter on its own.
      input.string = ""
      type("_hi", into: input)
      pasteboard.clearContents()
      pasteboard.setString("_", forType: .string)
      input.pasteText(from: pasteboard)
      #expect(input.string == "_hi_")
    }

    @Test func programmaticInsertionDoesNotFormat() {
      let input = MacComposerTextInput.InputView()
      type("_hi", into: input)
      input.insertAtCaret("_")
      #expect(input.string == "_hi_")
    }

    @Test func markedTextDoesNotFormatUntilCommitted() {
      let input = MacComposerTextInput.InputView()
      type("**hi*", into: input)
      input.setMarkedText("*", selectedRange: NSRange(location: 1, length: 0), replacementRange: input.selectedRange())
      #expect(input.hasMarkedText())
      #expect(input.string == "**hi**")
      // Committing the single character is the keystroke.
      input.insertText("*", replacementRange: input.markedRange())
      #expect(!input.hasMarkedText())
      #expect(input.string == "hi")
    }

    @Test func aCommittedCompositionOfSeveralCharactersDoesNotFormat() {
      let input = MacComposerTextInput.InputView()
      input.setMarkedText("_hi_", selectedRange: NSRange(location: 4, length: 0), replacementRange: input.selectedRange())
      #expect(input.string == "_hi_")
      input.insertText("_hi_", replacementRange: input.markedRange())
      #expect(input.string == "_hi_")
    }

    @Test func doesNotFormatInsideInlineCode() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("`code`")
      input.setSelectedRange(NSRange(location: 2, length: 0))
      input.typingAttributes = input.attributedString().attributes(at: 0, effectiveRange: nil)
      type("_x_", into: input)
      #expect(input.string == "co_x_de\n")
      #expect(input.captureDraft() == "`co_x_de`\n")
    }

    @Test func doesNotFormatInsideACodeBlock() {
      let input = MacComposerTextInput.InputView()
      input.restoreDraft("```\nab\n```\n")
      let caret = (input.string as NSString).range(of: "ab")
      input.setSelectedRange(NSRange(location: NSMaxRange(caret), length: 0))
      type(" **x**", into: input)
      #expect(input.string.contains("ab **x**"))
      #expect(input.captureDraft() == "```\nab **x**\n```\n")
    }

    /// A chip splits web's text node, so delimiters on either side never pair.
    @Test func doesNotFormatAcrossAMentionChip() {
      let input = MacComposerTextInput.InputView()
      input.mentions = [.init(id: "user-1", name: "Anna", slug: "anna", kind: .human)]
      input.restoreDraft("a @user-1:anna b")
      input.setSelectedRange(NSRange(location: 0, length: 0))
      type("_", into: input)
      input.setSelectedRange(NSRange(location: (input.string as NSString).range(of: " b").upperBound, length: 0))
      type("_", into: input)
      #expect(input.string == "_a \u{FFFC} b_\n")
      #expect(input.captureDraft() == "_a @user-1:anna b_\n")
    }

    @Test func doesNotFormatIdentifiers() {
      let input = MacComposerTextInput.InputView()
      type("snake_case_name_", into: input)
      #expect(input.string == "snake_case_name_")
    }

    @Test func aRetainedRawDraftStaysLiteral() {
      let source = "![image](https://example.com/image.png)"
      let input = MacComposerTextInput.InputView()
      input.restoreDraft(source)
      input.setSelectedRange(NSRange(location: source.utf16.count, length: 0))
      type(" _x_", into: input)
      #expect(input.captureDraft() == source + " _x_")
    }

    @MainActor struct FixtureTests {
      /// The real composer, focused, with `so **bold** _italic_ ~~strike~~ `code` done`
      /// typed through the window as key events. The editor shows the four runs
      /// formatted and none of their delimiters.
      @Test(arguments: [false, true])
      func rendersRunsFormattedByTyping(dark: Bool) async throws {
        var text = ""
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
        #expect(window.makeFirstResponder(input))
        let typed = "so **bold** _italic_ ~~strike~~ `code` done"
        try await Self.runAsEvents(Self.keystrokes(typed, in: window))
        try await Task.sleep(for: .milliseconds(300))
        host.layoutSubtreeIfNeeded()
        // What the picture claims: no delimiter is on screen, each run carries its format,
        // and the draft the view model holds is the markdown that was typed.
        #expect(input.string == "so bold italic strike code done")
        let shown = input.attributedString()
        for (word, style) in [("bold", ComposerInlineText.Style.bold), ("italic", .italic), ("strike", .strikethrough), ("code", .code)] {
          let range = (input.string as NSString).range(of: word)
          var effective = NSRange()
          #expect(shown.attribute(style.attribute, at: range.location, longestEffectiveRange: &effective, in: NSRange(location: 0, length: shown.length)) as? Bool == true)
          #expect(effective == range)
        }
        #expect(text == typed + "\n")
        let bitmap = try #require(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: bitmap)
        let png = try #require(bitmap.representation(using: .png, properties: [:]))
        // Recorded on the result bundle, which the app sandbox cannot hide: `xcresulttool export attachments`.
        Attachment.record(png, named: "composer-input-rules-\(dark ? "dark" : "light").png")
      }

      /// Key events through a real window and its own undo manager. The test host never
      /// ends the undo manager's event group, so the typing and the formatting undo as one
      /// step here; in a running app each key event is a group and the formatting is the
      /// last one (see PARITY, slice 12d). What holds in both: undo and redo leave the text
      /// consistent, redo formats again, no rule fires during either, and typing goes on
      /// outside the run.
      @Test func undoAndRedoRoundTripTheFormatting() async throws {
        var text = ""
        let content = VStack {
          Spacer()
          ComposerTextInput(text: Binding(get: { text }, set: { text = $0 }), submit: { false })
        }
        .padding(12)
        .frame(width: 480, height: 220)
        let host = NSHostingView(rootView: content)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 220), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        try await Task.sleep(for: .milliseconds(200))
        let input = try #require(Self.textView(in: host) as? MacComposerTextInput.InputView)
        #expect(window.makeFirstResponder(input))
        let undo = try #require(input.undoManager)
        var seen: [String] = []
        var steps = try Self.keystrokes("so **hi**", in: window)
        steps.append { seen.append(input.string) }
        steps.append {
          undo.undo()
          seen.append(input.string)
        }
        steps.append {
          undo.redo()
          seen.append(input.string)
        }
        steps += try Self.keystrokes(" x", in: window)
        await Self.runAsEvents(steps)
        #expect(seen == ["so hi", "", "so hi"])
        #expect(input.string == "so hi x")
        #expect(input.attributedString().attribute(ComposerInlineText.bold, at: 6, effectiveRange: nil) == nil)
        #expect(text == "so **hi** x\n")
      }

      /// One real key-down event per character, each to be delivered on its own.
      private static func keystrokes(_ text: String, in window: NSWindow) throws -> [() -> Void] {
        try text.map { character in
          let key = try #require(NSEvent.keyEvent(
            with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil,
            characters: String(character), charactersIgnoringModifiers: String(character), isARepeat: false, keyCode: 0
          ))
          return { window.sendEvent(key) }
        }
      }

      /// Runs each step from its own timer callout on the main run loop, one after another,
      /// the way key events arrive.
      private static func runAsEvents(_ steps: [() -> Void]) async {
        await EventPump(steps).run()
      }

      private static func textView(in view: NSView) -> NSTextView? {
        if let input = view as? NSTextView {
          return input
        }
        return view.subviews.lazy.compactMap { textView(in: $0) }.first
      }
    }
  }

  /// One step per timer callout on the main run loop.
  @MainActor private final class EventPump {
    private var steps: ArraySlice<() -> Void>
    private var timer: Timer?
    private var done: CheckedContinuation<Void, Never>?

    init(_ steps: [() -> Void]) {
      self.steps = steps[...]
    }

    func run() async {
      await withCheckedContinuation { continuation in
        done = continuation
        timer = Timer.scheduledTimer(withTimeInterval: 0.01, repeats: true) { [weak self] _ in
          MainActor.assumeIsolated { self?.tick() }
        }
      }
    }

    private func tick() {
      if let step = steps.popFirst() {
        step()
      } else {
        timer?.invalidate()
        done?.resume()
        done = nil
      }
    }
  }
#endif
