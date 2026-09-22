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
      #expect(input.applyInputRule())
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

    /// Web runs the rule on every input event and its paste handler says so ("markdown
    /// input rules still apply after paste"), so a paste that leaves a closed pair before
    /// the caret formats it. This test used to assert the opposite, from a wrong brief.
    @Test(arguments: [("", "**hi**"), ("_hi", "_"), ("so ", "~~hi~~"), ("", "`hi`")])
    func pasteFormatsThePairItCloses(_ typed: String, _ pasted: String) {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let input = MacComposerTextInput.InputView()
      type(typed, into: input)
      pasteboard.setString(pasted, forType: .string)
      input.pasteText(from: pasteboard)
      #expect(input.string == (typed.hasPrefix("so ") ? "so hi" : "hi"))
      #expect(input.selectedRange() == NSRange(location: input.string.utf16.count, length: 0))
      // The same bytes the literal paste serialized to before.
      #expect(input.captureDraft() == typed + pasted + "\n")
      #expect(input.captureDraft() == ComposerBlockText.document(NSAttributedString(string: typed + pasted)).markdown)
    }

    /// One pair per edit, as on web: only the pair that ends at the caret.
    @Test func pasteOfSeveralPairsFormatsOnlyTheLast() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let input = MacComposerTextInput.InputView()
      pasteboard.setString("**a** and **b**", forType: .string)
      input.pasteText(from: pasteboard)
      #expect(input.string == "**a** and b")
      #expect(input.attributedString().attribute(ComposerInlineText.bold, at: 10, effectiveRange: nil) as? Bool == true)
      #expect(input.attributedString().attribute(ComposerInlineText.bold, at: 2, effectiveRange: nil) == nil)
      #expect(input.captureDraft() == "**a** and **b**\n")
    }

    @Test func pasteThatClosesNoPairStaysLiteral() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let input = MacComposerTextInput.InputView()
      pasteboard.setString("**hi** there", forType: .string)
      input.pasteText(from: pasteboard)
      #expect(input.string == "**hi** there")
    }

    /// Undo after a formatting paste never stops half way: in the test host, where the
    /// event group stays open, one undo removes the formatting and the paste together.
    @Test func undoAfterAFormattingPasteLeavesNoHalfState() {
      let pasteboard = NSPasteboard.withUniqueName()
      defer { pasteboard.releaseGlobally() }
      let input = MacComposerTextInput.InputView()
      let delegate = UndoDelegate()
      input.delegate = delegate
      input.allowsUndo = true
      pasteboard.setString("**hi**", forType: .string)
      input.pasteText(from: pasteboard)
      #expect(input.string == "hi")
      delegate.manager.undo()
      #expect(input.string.isEmpty)
      delegate.manager.redo()
      #expect(input.string == "hi")
      #expect(input.captureDraft() == "**hi**\n")
      delegate.manager.undo()
    }

    /// Web's input event covers deletions: removing what stood between a closed pair and
    /// the caret formats the pair.
    @Test func aDeletionThatLeavesAClosedPairBeforeTheCaretFormatsIt() {
      let input = MacComposerTextInput.InputView()
      input.string = "so **hi**!"
      input.setSelectedRange(NSRange(location: 10, length: 0))
      input.deleteBackward(nil)
      #expect(input.string == "so hi")
      #expect(input.selectedRange() == NSRange(location: 5, length: 0))
      #expect(input.captureDraft() == "so **hi**\n")
    }

    @Test func otherDeletionsFormatToo() {
      let input = MacComposerTextInput.InputView()
      input.string = "_hi_ word"
      input.setSelectedRange(NSRange(location: 9, length: 0))
      input.deleteWordBackward(nil)
      #expect(input.string == "_hi_ ")
      input.setSelectedRange(NSRange(location: 4, length: 0))
      input.deleteForward(nil)
      #expect(input.string == "hi")
      input.string = "`hi` cut"
      input.setSelectedRange(NSRange(location: 4, length: 4))
      input.cut(nil)
      #expect(input.string == "hi")
    }

    @Test func aDeletionInsideCodeOrThatClosesNothingStaysLiteral() {
      let input = MacComposerTextInput.InputView()
      input.string = "snake_case_!"
      input.setSelectedRange(NSRange(location: 12, length: 0))
      input.deleteBackward(nil)
      #expect(input.string == "snake_case_")
      input.restoreDraft("`_x_!`")
      input.setSelectedRange(NSRange(location: 4, length: 0))
      input.deleteBackward(nil)
      #expect(input.string == "_x_\n")
    }

    /// Not a user input event on web either: the app put this text there.
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
      // Committing ends the composition; then it is an edit like any other.
      input.insertText("*", replacementRange: input.markedRange())
      #expect(!input.hasMarkedText())
      #expect(input.string == "hi")
    }

    /// The kept Apple exception: nothing is replaced under an active input method. The
    /// rule runs once the composition commits, whatever its length, as any other edit.
    @Test func aCompositionFormatsOnlyOnceCommitted() {
      let input = MacComposerTextInput.InputView()
      input.setMarkedText("_hi_", selectedRange: NSRange(location: 4, length: 0), replacementRange: input.selectedRange())
      #expect(input.string == "_hi_")
      input.insertText("_hi_", replacementRange: input.markedRange())
      #expect(!input.hasMarkedText())
      #expect(input.string == "hi")
    }

    /// An input method handles its own Backspace; should a deletion reach the view while
    /// text is marked, it must not format what was being composed.
    @Test func aDeletionDuringACompositionDoesNotFormat() {
      let input = MacComposerTextInput.InputView()
      input.setMarkedText("_hi_!", selectedRange: NSRange(location: 5, length: 0), replacementRange: input.selectedRange())
      input.deleteBackward(nil)
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
        let input = try await Self.loadedInput(in: host)
        #expect(window.makeFirstResponder(input))
        let typed = "so **bold** _italic_ ~~strike~~ `code` done"
        try await Self.runAsEvents(Self.keystrokes(typed, in: window))
        _ = try await waitForView(in: host, timeoutMessage: "Expected editor \(String(reflecting: "so bold italic strike code done")) and draft \(String(reflecting: typed + "\n")); got editor \(String(reflecting: input.string)) and draft \(String(reflecting: text))") {
          input.string == "so bold italic strike code done" && text == typed + "\n" ? input : nil
        }
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
        let input = try await Self.loadedInput(in: host)
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
        _ = try await waitForView(in: host, timeoutMessage: "Expected editor \(String(reflecting: "so hi x")) and draft \(String(reflecting: "so **hi** x\n")); got editor \(String(reflecting: input.string)) and draft \(String(reflecting: text))") {
          input.string == "so hi x" && text == "so **hi** x\n" ? input : nil
        }
        #expect(seen == ["so hi", "", "so hi"])
        #expect(input.string == "so hi x")
        #expect(input.attributedString().attribute(ComposerInlineText.bold, at: 6, effectiveRange: nil) == nil)
        #expect(text == "so **hi** x\n")
      }

      /// A busy run loop can mount the editor after the old 200 ms startup delay.
      @Test func waitsForDelayedComposerMount() async throws {
        let host = NSHostingView(rootView: ComposerTextInput?.none)
        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 480, height: 220), styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = host
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let mount = Task { @MainActor in
          try await Task.sleep(for: .milliseconds(350))
          host.rootView = ComposerTextInput(text: .constant(""), submit: { false })
        }
        defer { mount.cancel() }
        let input = try await Self.loadedInput(in: host)
        #expect(input.window === window)
      }

      private static func loadedInput(in host: NSView) async throws -> MacComposerTextInput.InputView {
        try await waitForView(in: host, timeoutMessage: "Composer editor did not appear in the hosting view") {
          textView(in: host) as? MacComposerTextInput.InputView
        }
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
