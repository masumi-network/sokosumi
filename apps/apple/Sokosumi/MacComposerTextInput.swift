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
      let scroll = NSScrollView()
      scroll.drawsBackground = false
      scroll.hasVerticalScroller = true
      scroll.scrollerStyle = .overlay
      let input = InputView()
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
      guard let input = scroll.documentView as? InputView,
            let container = input.textContainer,
            let layout = input.layoutManager else { return nil }
      let width = max(proposal.width ?? 200, 1)
      input.setFrameSize(NSSize(width: width, height: input.frame.height))
      container.containerSize = NSSize(width: width, height: .greatestFiniteMagnitude)
      layout.ensureLayout(for: container)
      let lineHeight = layout.defaultLineHeight(for: input.font ?? .systemFont(ofSize: NSFont.systemFontSize))
      let contentHeight = max(layout.usedRect(for: container).height + input.textContainerInset.height * 2, lineHeight + 4)
      input.setFrameSize(NSSize(width: width, height: contentHeight))
      return CGSize(width: width, height: min(contentHeight, lineHeight * 6 + 4))
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
