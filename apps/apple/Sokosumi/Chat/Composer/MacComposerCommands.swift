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

    @Published private(set) var mentionOptions: [ComposerMention] = []
    @Published var selectedSuggestionID: String?
    @Published private(set) var emojiOptions: [String] = []
    private var emojiTrigger: String?
    private var dismissedEmojiTrigger: String?
    private var mentionTrigger: ComposerReferenceTrigger?
    private var dismissedMentionTrigger: ComposerReferenceTrigger?

    func refreshSuggestions() {
      let trigger = input?.mentionTrigger
      if trigger != mentionTrigger {
        mentionTrigger = trigger
        dismissedMentionTrigger = nil
        selectedSuggestionID = nil
      }
      let matches = trigger.flatMap { trigger in
        input.map { ComposerMention.matching($0.mentions, query: trigger.query) }
      } ?? []
      let options = trigger != nil && trigger != dismissedMentionTrigger ? matches : []
      // Keep section order identical for mouse and keyboard navigation.
      let grouped = options.filter { $0.kind == .human || $0.kind == .all }
        + options.filter { $0.kind == .coworker || $0.kind == .sokoBot }
      if mentionOptions != grouped {
        mentionOptions = grouped
      }
      let emoji = input.flatMap { input in
        input.emojiCompletionRange.map { range in
          "\(range.location):" + (input.string as NSString).substring(with: range)
        }
      }
      if emoji != emojiTrigger {
        emojiTrigger = emoji
        dismissedEmojiTrigger = nil
        selectedSuggestionID = nil
      }
      let shortcodes: [String] = if emoji != nil, emoji != dismissedEmojiTrigger, let input, let range = input.emojiCompletionRange {
        ComposerEmoji.completions(for: String((input.string as NSString).substring(with: range).dropFirst()))
      } else {
        []
      }
      if emojiOptions != shortcodes {
        emojiOptions = shortcodes
      }
      if !suggestionIDs.contains(selectedSuggestionID ?? "") {
        selectedSuggestionID = suggestionIDs.first
      }
    }

    func dismissSuggestions() {
      dismissedMentionTrigger = mentionTrigger
      mentionOptions = []
      dismissedEmojiTrigger = emojiTrigger
      emojiOptions = []
    }

    func acceptMention(_ mention: ComposerMention) {
      input?.window?.makeFirstResponder(input)
      input?.acceptMention(mention)
      mentionOptions = []
      refresh()
    }

    private var suggestionIDs: [String] {
      mentionOptions.map(\.id) + emojiOptions
    }

    func acceptEmoji(_ shortcode: String) {
      input?.window?.makeFirstResponder(input)
      input?.acceptEmoji(shortcode)
      emojiOptions = []
      refresh()
    }

    func handleSuggestionKey(_ key: UInt16) -> Bool {
      refreshSuggestions()
      guard !suggestionIDs.isEmpty else { return false }
      switch key {
      case 53:
        dismissSuggestions()
      case 125, 126:
        let index = suggestionIDs.firstIndex { $0 == selectedSuggestionID } ?? 0
        selectedSuggestionID = suggestionIDs[(index + (key == 125 ? 1 : suggestionIDs.count - 1)) % suggestionIDs.count]
      case 36, 76, 48:
        if let mention = mentionOptions.first(where: { $0.id == selectedSuggestionID }) {
          acceptMention(mention)
        } else if let shortcode = selectedSuggestionID, emojiOptions.contains(shortcode) {
          acceptEmoji(shortcode)
        }
      default: return false
      }
      return true
    }

    struct LinkEditor: Identifiable {
      let id = UUID()
      let range: NSRange
      var text: String
      var url: String
    }

    func beginMention() {
      guard let input, !input.hasMarkedText(), !input.mentions.isEmpty else { return }
      input.window?.makeFirstResponder(input)
      let range = input.selectedRange()
      let prefix = (input.string as NSString).substring(to: range.location)
      let separator = prefix.last.map { $0.isWhitespace ? "" : " " } ?? ""
      input.insertText(separator + "@", replacementRange: range)
    }

    func beginLink() {
      guard let input, !input.hasMarkedText() else { return }
      var range = input.selectedRange()
      let content = input.attributedString()
      // The list prefix belongs to the paragraph, not the link label.
      if range.length > 0, range.location < content.length {
        var markerRange = NSRange()
        if content.attribute(ComposerBlockText.listMarker, at: range.location, effectiveRange: &markerRange) as? Bool == true {
          let end = min(NSMaxRange(range), NSMaxRange(markerRange))
          range.length = NSMaxRange(range) - end
          range.location = end
        }
      }
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
        refreshSuggestions()
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
