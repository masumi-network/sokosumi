#if os(macOS)
  import AppKit
  import SokosumiChat
  import SwiftUI

  /// Isolates native marked-text handling and character-picker presentation.
  struct MacComposerTextInput: NSViewRepresentable {
    @Binding var text: String
    let submit: () -> Bool
    var placeholder = "Message"
    var emojiPickerRequest = 0

    func makeCoordinator() -> Coordinator {
      Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
      let scroll = InputScrollView(frame: NSRect(x: 0, y: 0, width: 200, height: 24))
      scroll.drawsBackground = false
      scroll.scrollerStyle = .overlay
      scroll.hasVerticalScroller = true
      let input = InputView(frame: scroll.contentView.bounds)
      input.isRichText = false
      input.allowsUndo = true
      input.isAutomaticQuoteSubstitutionEnabled = false
      input.isAutomaticDashSubstitutionEnabled = false
      input.drawsBackground = false
      input.font = .preferredFont(forTextStyle: .body)
      input.textColor = .labelColor
      input.insertionPointColor = .labelColor
      input.isVerticallyResizable = true
      input.isHorizontallyResizable = false
      input.autoresizingMask = [.width]
      input.textContainer?.widthTracksTextView = true
      input.textContainerInset = NSSize(width: 2, height: 2)
      input.setAccessibilityLabel("Message")
      input.delegate = context.coordinator
      input.submit = submit
      input.placeholder = placeholder
      scroll.documentView = input
      return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
      context.coordinator.parent = self
      guard let input = scroll.documentView as? InputView else { return }
      input.submit = submit
      input.placeholder = placeholder
      if context.coordinator.emojiPickerRequest != emojiPickerRequest {
        context.coordinator.emojiPickerRequest = emojiPickerRequest
        Task { @MainActor [weak input] in
          guard let input, let window = input.window else { return }
          window.makeFirstResponder(input)
          NSApp.orderFrontCharacterPalette(nil)
        }
      }
      if input.string != text, !input.hasMarkedText() {
        if text.isEmpty {
          input.clearAfterSend()
        } else {
          input.string = text
        }
      }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView scroll: NSScrollView, context _: Context) -> CGSize? {
      (scroll as? InputScrollView)?.measuredSize(for: proposal)
    }

    final class InputScrollView: NSScrollView {
      func measuredSize(for proposal: ProposedViewSize) -> CGSize {
        let proposedWidth = proposal.width ?? 200
        let width = proposedWidth.isFinite ? max(proposedWidth, 1) : 200
        guard let input = documentView as? NSTextView else { return CGSize(width: width, height: 24) }
        let font = input.font ?? .preferredFont(forTextStyle: .body)
        // SwiftUI probes zero/infinite sizes. Measure separate storage so these
        // proposals never change the live editor's frame or hit-testing region.
        let storage = NSTextStorage(string: input.string, attributes: [.font: font])
        let layout = NSLayoutManager()
        let container = NSTextContainer(size: NSSize(width: width, height: .greatestFiniteMagnitude))
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        layout.ensureLayout(for: container)
        let lineHeight = layout.defaultLineHeight(for: font)
        let height = max(max(layout.usedRect(for: container).maxY, layout.extraLineFragmentRect.maxY) + 4, lineHeight + 4)
        return CGSize(width: width, height: min(height, lineHeight * 6 + 4))
      }

      override func layout() {
        super.layout()
        guard let input = documentView as? NSTextView,
              let container = input.textContainer,
              let layout = input.layoutManager else { return }
        let width = contentView.bounds.width
        guard width.isFinite, width > 0 else { return }
        input.setFrameSize(NSSize(width: width, height: max(input.frame.height, contentView.bounds.height, 1)))
        container.containerSize = NSSize(width: width, height: .greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        let height = max(max(layout.usedRect(for: container).maxY, layout.extraLineFragmentRect.maxY) + input.textContainerInset.height * 2,
                         contentView.bounds.height)
        input.setFrameSize(NSSize(width: width, height: height))
      }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
      var emojiPickerRequest = 0
      var parent: MacComposerTextInput

      init(_ parent: MacComposerTextInput) {
        self.parent = parent
      }

      func textDidChange(_ notification: Notification) {
        guard let input = notification.object as? NSTextView else { return }
        parent.text = input.string
      }
    }

    final class InputView: NSTextView {
      private var showingCompletions = false
      var submit: () -> Bool = { false }
      var placeholder = "Message" {
        didSet { needsDisplay = true }
      }

      override func insertText(_ insertString: Any, replacementRange: NSRange) {
        let isReplayingEdit = undoManager?.isUndoing == true || undoManager?.isRedoing == true
        super.insertText(insertString, replacementRange: replacementRange)
        guard !isReplayingEdit, !hasMarkedText(), selectedRange().length == 0 else { return }
        if let edit = ComposerEmoji.match(in: string, caret: selectedRange().location) {
          breakUndoCoalescing()
          super.insertText(edit.replacement, replacementRange: edit.range)
          breakUndoCoalescing()
        } else if window != nil, !showingCompletions, rangeForUserCompletion.location != NSNotFound {
          showingCompletions = true
          complete(nil)
        }
      }

      override var rangeForUserCompletion: NSRange {
        guard !hasMarkedText(), selectedRange().length == 0 else { return NSRange(location: NSNotFound, length: 0) }
        return ComposerEmoji.completionRange(in: string, caret: selectedRange().location) ?? NSRange(location: NSNotFound, length: 0)
      }

      override func completions(forPartialWordRange charRange: NSRange, indexOfSelectedItem index: UnsafeMutablePointer<Int>) -> [String]? {
        guard charRange.location != NSNotFound, NSMaxRange(charRange) <= string.utf16.count else { return nil }
        let query = (string as NSString).substring(with: charRange).dropFirst()
        let words = ComposerEmoji.completions(for: String(query))
        if words.isEmpty {
          showingCompletions = false
        }
        index.pointee = 0
        return words.map { ComposerEmoji.completionPreview(for: $0) }
      }

      override func insertCompletion(_ word: String, forPartialWordRange charRange: NSRange, movement: Int, isFinal: Bool) {
        guard isFinal else { return }
        showingCompletions = false
        guard movement != NSCancelTextMovement, word.hasSuffix(":"), NSMaxRange(charRange) <= string.utf16.count else { return }
        // The menu label includes a preview; only the shortcode participates in insertion.
        let shortcode = String(word.split(separator: " ").last ?? Substring(word))
        let suffix = (string as NSString).substring(from: NSMaxRange(charRange))
        guard let edit = ComposerEmoji.match(in: shortcode + suffix, caret: shortcode.utf16.count) else { return }
        // Native completion owns navigation/cancellation; persist only the accepted result.
        breakUndoCoalescing()
        super.insertText(edit.replacement, replacementRange: charRange)
        breakUndoCoalescing()
      }

      override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty else { return }
        let prompt = NSAttributedString(string: placeholder, attributes: [
          .font: font ?? .preferredFont(forTextStyle: .body),
          .foregroundColor: NSColor.placeholderTextColor
        ])
        prompt.draw(at: NSPoint(x: textContainerInset.width + (textContainer?.lineFragmentPadding ?? 5),
                                y: textContainerInset.height))
      }

      override func performKeyEquivalent(with event: NSEvent) -> Bool {
        // AppKit otherwise consumes Control-Return as a contextual-menu shortcut.
        if window?.firstResponder === self,
           event.keyCode == 36 || event.keyCode == 76,
           !event.modifierFlags.isDisjoint(with: [.command, .control]) {
          keyDown(with: event)
          return true
        }
        return super.performKeyEquivalent(with: event)
      }

      /// Clears the composer after an accepted send. Typing history must not
      /// survive: Cmd+Z after send must not resurrect just-sent text.
      func clearAfterSend() {
        string = ""
        undoManager?.removeAllActions()
      }

      override func keyDown(with event: NSEvent) {
        // Capture this before AppKit commits marked text. Checking inside
        // a submit/delegate callback is too late for the committing Return.
        let isReturn = event.keyCode == 36 || event.keyCode == 76
        if showingCompletions {
          super.keyDown(with: event)
          return
        }
        guard isReturn, !hasMarkedText() else {
          super.keyDown(with: event)
          return
        }
        if !event.modifierFlags.isDisjoint(with: [.shift, .command, .control]) {
          insertNewline(nil)
        } else {
          if submit() {
            clearAfterSend()
            didChangeText()
          }
        }
      }
    }
  }
#endif
