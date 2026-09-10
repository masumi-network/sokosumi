#if os(macOS)
  import AppKit
  import Combine
  import SokosumiChat

  /// Per-editor command routing. Does not own the draft or the text view.
  @MainActor
  final class MacComposerCommands: ObservableObject {
    weak var input: MacComposerTextInput.InputView?
    @Published private(set) var activeStyles: Set<ComposerInlineText.Style> = []
    @Published private(set) var activeBlocks: Set<ComposerBlockFormat> = []
    @Published var linkEditor: LinkEditor?

    struct LinkEditor: Identifiable {
      let id = UUID()
      let range: NSRange
      var text: String
      var url: String
    }

    func beginLink() {
      guard let input, !input.hasMarkedText() else { return }
      var range = input.selectedRange()
      let content = input.attributedString()
      var destination = ""
      if content.length > 0 {
        var linkRange = NSRange()
        let index = min(range.location, content.length - 1)
        if let url = content.attribute(ComposerInlineText.link, at: index, longestEffectiveRange: &linkRange,
                                       in: NSRange(location: 0, length: content.length)) as? String {
          destination = url
          if range.length == 0 {
            range = linkRange
          }
        }
      }
      linkEditor = LinkEditor(range: range, text: (content.string as NSString).substring(with: range), url: destination)
    }

    func saveLink(_ editor: LinkEditor, text: String, url: String) {
      input?.insertLink(label: ComposerContent(text).text, destination: url, range: editor.range)
      linkEditor = nil
      input?.window?.makeFirstResponder(input)
      refresh()
    }

    func toggle(_ style: ComposerInlineText.Style) {
      guard let input else { return }
      input.window?.makeFirstResponder(input)
      input.toggleFormat(style)
      refresh()
    }

    func apply(_ format: ComposerBlockFormat) {
      guard let input else { return }
      input.window?.makeFirstResponder(input)
      input.applyBlockFormat(format)
      refresh()
    }

    func refresh() {
      // Selection callbacks can arrive during SwiftUI's representable update.
      Task { @MainActor [weak self] in
        guard let self, let input else { return }
        let range = input.selectedRange()
        let sample = range.length == 0
          ? NSAttributedString(string: " ", attributes: input.typingAttributes)
          : input.attributedString().attributedSubstring(from: range)
        let styles = Set(ComposerInlineText.Style.allCases.filter { ComposerInlineText.isActive($0, in: sample) })
        if activeStyles != styles {
          activeStyles = styles
        }
        let blocks = Set(ComposerBlockFormat.allCases.filter { $0.isActive(in: sample) })
        if activeBlocks != blocks {
          activeBlocks = blocks
        }
      }
    }
  }
#endif
