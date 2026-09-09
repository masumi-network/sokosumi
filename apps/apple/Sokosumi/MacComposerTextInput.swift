#if os(macOS)
  import AppKit
  import SwiftUI

  /// Native marked-text handling is the only reason for this AppKit adapter.
  struct MacComposerTextInput: NSViewRepresentable {
    @Binding var text: String
    let submit: () -> Bool

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
      scroll.documentView = input
      return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
      context.coordinator.parent = self
      guard let input = scroll.documentView as? InputView else { return }
      input.submit = submit
      if input.string != text, !input.hasMarkedText() {
        input.string = text
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
      var submit: () -> Bool = { false }

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

      override func keyDown(with event: NSEvent) {
        // Capture this before AppKit commits marked text. Checking inside
        // a submit/delegate callback is too late for the committing Return.
        let isReturn = event.keyCode == 36 || event.keyCode == 76
        guard isReturn, !hasMarkedText() else {
          super.keyDown(with: event)
          return
        }
        if !event.modifierFlags.isDisjoint(with: [.shift, .command, .control]) {
          insertNewline(nil)
        } else {
          if submit() {
            string = ""
            didChangeText()
          }
        }
      }
    }
  }
#endif
