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
    var commands: MacComposerCommands?
    var channels: [ComposerChannel] = []
    var mentions: [ComposerMention] = []

    func makeCoordinator() -> Coordinator {
      Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
      let scroll = InputScrollView(frame: NSRect(x: 0, y: 0, width: 200, height: 24))
      scroll.drawsBackground = false
      scroll.scrollerStyle = .overlay
      scroll.hasVerticalScroller = true
      let input = InputView(frame: scroll.contentView.bounds)
      input.isRichText = true
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
      commands?.input = input
      input.openLinkEditor = { [weak commands] in commands?.beginLink() }
      input.suggestionKeyHandler = { [weak commands] key in commands?.handleSuggestionKey(key) ?? false }
      input.formattingDidChange = { [weak commands] in commands?.refresh() }
      input.submit = submit
      input.placeholder = placeholder
      input.mentions = mentions
      input.channels = channels
      commands?.refresh()
      scroll.documentView = input
      return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
      context.coordinator.parent = self
      guard let input = scroll.documentView as? InputView else { return }
      input.submit = submit
      input.placeholder = placeholder
      input.mentions = mentions
      input.channels = channels
      if context.coordinator.emojiPickerRequest != emojiPickerRequest {
        context.coordinator.emojiPickerRequest = emojiPickerRequest
        Task { @MainActor [weak input] in
          guard let input, let window = input.window else { return }
          window.makeFirstResponder(input)
          NSApp.orderFrontCharacterPalette(nil)
        }
      }
      if input.serializedDraft != text, !input.hasMarkedText() {
        if text.isEmpty {
          input.clearAfterSend()
        } else {
          input.restoreDraft(text)
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
        let storage = NSTextStorage(attributedString: input.attributedString())
        let layout = NSLayoutManager()
        let container = NSTextContainer(size: NSSize(width: width, height: .greatestFiniteMagnitude))
        storage.addLayoutManager(layout)
        layout.addTextContainer(container)
        layout.ensureLayout(for: container)
        let lineHeight = layout.defaultLineHeight(for: font)
        let height = max(max(layout.usedRect(for: container).maxY, layout.extraLineFragmentRect.maxY) + 4, lineHeight + 4)
        return CGSize(width: width, height: min(max(height, lineHeight * 3 + 4), lineHeight * 8 + 4))
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
        guard let input = notification.object as? InputView else { return }
        parent.text = input.captureDraft()
        parent.commands?.refresh()
      }

      func textDidEndEditing(_: Notification) {
        Task { @MainActor [weak commands = parent.commands] in commands?.dismissSuggestions() }
      }

      func textViewDidChangeSelection(_ notification: Notification) {
        (notification.object as? InputView)?.clearReferenceTypingAttributes()
        parent.commands?.refresh()
      }
    }

    final class InputView: NSTextView {
      private var preservesRawDraft = false
      private(set) var serializedDraft = ""
      var submit: () -> Bool = { false }
      var openLinkEditor: (() -> Void)?
      var formattingDidChange: (() -> Void)?
      var channels: [ComposerChannel] = []
      var mentions: [ComposerMention] = []
      var suggestionKeyHandler: ((UInt16) -> Bool)?
      var placeholder = "Message" {
        didSet { needsDisplay = true }
      }

      func restoreDraft(_ source: String) {
        guard !hasMarkedText() else { return }
        if let document = try? ComposerDocument(markdown: source) {
          let references = ComposerReferenceText.presenting(ComposerBlockText.attributedText(document), catalog: mentions)
          textStorage?.setAttributedString(MacComposerAttributedText.styled(ComposerReferenceText.presentingChannels(references, channels: channels)))
          preservesRawDraft = false
          isRichText = true
        } else {
          // Keep unsupported draft content intact until the editor supports its structure.
          string = source
          preservesRawDraft = true
          isRichText = false
        }
        serializedDraft = source
        undoManager?.removeAllActions()
      }

      @discardableResult
      func captureDraft() -> String {
        serializedDraft = preservesRawDraft ? string : ComposerBlockText.document(attributedString()).markdown
        return serializedDraft
      }

      private var caretIsInCode: Bool {
        guard !string.isEmpty else { return false }
        let index = min(max(0, selectedRange().location - 1), string.utf16.count - 1)
        let attributes = attributedString().attributes(at: index, effectiveRange: nil)
        if attributes[ComposerInlineText.code] as? Bool == true {
          return true
        }
        let path = attributes[ComposerBlockText.path] as? [String] ?? []
        return path.last?.split(separator: ":", maxSplits: 2).dropFirst().first == "c"
      }

      func toggleFormat(_ style: ComposerInlineText.Style) {
        guard !hasMarkedText(), !preservesRawDraft else { return }
        defer { formattingDidChange?() }
        let selection = selectedRange()
        if selection.length == 0 {
          let sample = NSAttributedString(string: " ", attributes: typingAttributes)
          let styled = MacComposerAttributedText.styled(ComposerInlineText.toggling(style, in: sample))
          typingAttributes = styled.attributes(at: 0, effectiveRange: nil)
          return
        }
        let selected = attributedString().attributedSubstring(from: selection)
        let replacement = MacComposerAttributedText.styled(ComposerInlineText.toggling(style, in: selected))
        breakUndoCoalescing()
        replaceFormatting(replacement, range: selection)
        breakUndoCoalescing()
      }

      func applyBlockFormat(_ format: ComposerBlockFormat) {
        guard !hasMarkedText(), !preservesRawDraft else { return }
        let selection = selectedRange()
        let range = format == .codeBlock ? selection : (string as NSString).paragraphRange(for: selection)
        let selected = attributedString().attributedSubstring(from: range)
        let replacement = MacComposerAttributedText.styled(format.applying(to: selected))
        breakUndoCoalescing()
        replaceFormatting(replacement, range: range)
        let caret = range.location + replacement.length - (replacement.string.hasSuffix("\n") ? 1 : 0)
        setSelectedRange(NSRange(location: caret, length: 0))
        breakUndoCoalescing()
      }

      private func replaceFormatting(_ replacement: NSAttributedString, range: NSRange) {
        guard let textStorage, NSMaxRange(range) <= textStorage.length else { return }
        let previous = textStorage.attributedSubstring(from: range)
        undoManager?.registerUndo(withTarget: self) { input in
          input.replaceFormatting(previous, range: NSRange(location: range.location, length: replacement.length))
        }
        textStorage.replaceCharacters(in: range, with: replacement)
        setSelectedRange(NSRange(location: range.location, length: replacement.length))
        didChangeText()
      }

      func insertLink(label: String, destination: String, range: NSRange) {
        guard !hasMarkedText(), !preservesRawDraft,
              NSMaxRange(range) <= string.utf16.count,
              let url = ComposerLink.normalizedURL(destination) else { return }
        let selected = attributedString().attributedSubstring(from: range)
        let replacement: NSMutableAttributedString
        if !ComposerContent(selected.string).text.isEmpty, ComposerContent(label).text == ComposerContent(selected.string).text {
          replacement = NSMutableAttributedString(attributedString: selected)
        } else {
          var attributes = typingAttributes
          if attributedString().length > 0 {
            attributes = attributedString().attributes(at: min(range.location, attributedString().length - 1), effectiveRange: nil)
          }
          attributes.removeValue(forKey: ComposerBlockText.listMarker)
          attributes.removeValue(forKey: ComposerReferenceText.token)
          attributes.removeValue(forKey: ComposerReferenceText.name)
          attributes.removeValue(forKey: .attachment)
          replacement = NSMutableAttributedString(string: label.isEmpty ? "link" : label, attributes: attributes)
        }
        replacement.addAttribute(ComposerInlineText.link, value: url, range: NSRange(location: 0, length: replacement.length))
        breakUndoCoalescing()
        replaceFormatting(MacComposerAttributedText.styled(replacement), range: range)
        setSelectedRange(NSRange(location: range.location + replacement.length, length: 0))
        breakUndoCoalescing()
      }

      override func insertText(_ insertString: Any, replacementRange: NSRange) {
        let isReplayingEdit = undoManager?.isUndoing == true || undoManager?.isRedoing == true
        clearReferenceTypingAttributes()
        super.insertText(insertString, replacementRange: replacementRange)
        guard !isReplayingEdit, !hasMarkedText(), selectedRange().length == 0, !caretIsInCode else { return }
        if let edit = ComposerEmoji.match(in: string, caret: selectedRange().location) {
          breakUndoCoalescing()
          super.insertText(edit.replacement, replacementRange: edit.range)
          breakUndoCoalescing()
        }
      }

      func clearReferenceTypingAttributes() {
        typingAttributes.removeValue(forKey: ComposerReferenceText.token)
        typingAttributes.removeValue(forKey: ComposerReferenceText.name)
        typingAttributes.removeValue(forKey: .attachment)
      }

      override func writeSelection(to pasteboard: NSPasteboard, type: NSPasteboard.PasteboardType) -> Bool {
        guard type == .string else { return super.writeSelection(to: pasteboard, type: type) }
        let selection = attributedString().attributedSubstring(from: selectedRange())
        let text = NSMutableString(string: selection.string)
        selection.enumerateAttribute(ComposerReferenceText.token, in: NSRange(location: 0, length: selection.length), options: .reverse) { value, range, _ in
          if let token = value as? String {
            text.replaceCharacters(in: range, with: String(repeating: token, count: range.length))
          }
        }
        return pasteboard.setString(text as String, forType: type)
      }

      override func paste(_: Any?) {
        pasteText(from: .general)
      }

      func pasteText(from pasteboard: NSPasteboard) {
        let plain = pasteboard.string(forType: .string) ?? ""
        let text = plain.isEmpty ? ComposerPaste.plainText(html: pasteboard.string(forType: .html) ?? "") : plain
        guard !text.isEmpty else { return }
        insertText(text, replacementRange: selectedRange())
      }

      var emojiCompletionRange: NSRange? {
        guard !hasMarkedText(), selectedRange().length == 0, !caretIsInCode else { return nil }
        return ComposerEmoji.completionRange(in: string, caret: selectedRange().location)
      }

      func acceptEmoji(_ shortcode: String) {
        guard let range = emojiCompletionRange,
              ComposerEmoji.completions(for: String((string as NSString).substring(with: range).dropFirst())).contains(shortcode) else { return }
        let suffix = (string as NSString).substring(from: NSMaxRange(range))
        guard let edit = ComposerEmoji.match(in: shortcode + suffix, caret: shortcode.utf16.count) else { return }
        breakUndoCoalescing()
        super.insertText(edit.replacement, replacementRange: range)
        breakUndoCoalescing()
      }

      var referenceTrigger: ComposerReferenceTrigger? {
        guard !hasMarkedText(), selectedRange().length == 0, !caretIsInCode,
              let trigger = ComposerReferenceTrigger.match(in: string, caret: selectedRange().location) else { return nil }
        return trigger
      }

      func acceptMention(_ mention: ComposerMention) {
        guard let trigger = referenceTrigger, trigger.kind == .mention,
              let current = mentions.first(where: { $0.id == mention.id && $0.kind == mention.kind }) else { return }
        insertReference(token: current.token, label: "@" + current.name, range: trigger.range)
      }

      func acceptChannel(_ channel: ComposerChannel) {
        guard let trigger = referenceTrigger, trigger.kind == .channel,
              let current = ComposerChannel.matching(channels, query: trigger.query).first(where: { $0.id == channel.id }) else { return }
        insertReference(token: current.token(in: channels), label: "#" + current.name, range: trigger.range)
      }

      private func insertReference(token: String, label: String, range: NSRange) {
        let suffix = (string as NSString).substring(from: NSMaxRange(range))
        breakUndoCoalescing()
        let chip = NSMutableAttributedString(attributedString: ComposerReferenceText.chip(token: token, name: label, attributes: typingAttributes))
        if suffix.isEmpty || suffix.first?.isWhitespace == false {
          chip.append(NSAttributedString(string: " ", attributes: typingAttributes))
        }
        super.insertText(MacComposerAttributedText.styled(chip), replacementRange: range)
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
        if window?.firstResponder === self, event.modifierFlags.contains(.command),
           event.modifierFlags.isDisjoint(with: [.shift, .option, .control]),
           event.charactersIgnoringModifiers?.lowercased() == "k" {
          openLinkEditor?()
          return true
        }
        if window?.firstResponder === self,
           event.modifierFlags.contains(.command),
           event.modifierFlags.isDisjoint(with: [.shift, .option, .control]),
           let key = event.charactersIgnoringModifiers?.lowercased(),
           let style: ComposerInlineText.Style = ["b": .bold, "i": .italic, "u": .underline][key] {
          toggleFormat(style)
          return true
        }
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
        serializedDraft = ""
        preservesRawDraft = false
        isRichText = true
        typingAttributes = [.font: NSFont.preferredFont(forTextStyle: .body), .foregroundColor: NSColor.labelColor]
        undoManager?.removeAllActions()
      }

      override func keyDown(with event: NSEvent) {
        // Capture this before AppKit commits marked text. Checking inside
        // a submit/delegate callback is too late for the committing Return.
        let isReturn = event.keyCode == 36 || event.keyCode == 76
        if !hasMarkedText(), event.modifierFlags.isDisjoint(with: [.command, .control, .option, .shift]),
           suggestionKeyHandler?(event.keyCode) == true {
          return
        }
        guard isReturn, !hasMarkedText() else {
          super.keyDown(with: event)
          return
        }
        if !event.modifierFlags.isDisjoint(with: [.shift, .command, .control]) {
          if let edit = ComposerBlockText.exitingQuote(attributedString(), selection: selectedRange()), !preservesRawDraft {
            breakUndoCoalescing()
            replaceFormatting(MacComposerAttributedText.styled(edit.replacement), range: edit.range)
            setSelectedRange(NSRange(location: edit.caret, length: 0))
            typingAttributes = attributedString().attributes(at: edit.caret, effectiveRange: nil)
            formattingDidChange?()
            breakUndoCoalescing()
          } else {
            insertNewline(nil)
          }
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
