import SokosumiChat
import SwiftUI

#if os(macOS)
  struct ComposerFormatToolbar: View {
    enum Item: Hashable {
      case inline(ComposerInlineText.Style)
      case link
      case block(ComposerBlockFormat)
    }

    /// Web's order: the text styles, Link, the lists and Quote, then both code buttons side by side.
    static let items: [Item] = [
      .inline(.bold), .inline(.italic), .inline(.underline), .inline(.strikethrough),
      .link, .block(.orderedList), .block(.unorderedList), .block(.quote), .inline(.code), .block(.codeBlock)
    ]

    @ObservedObject var commands: MacComposerCommands

    var body: some View {
      HStack(spacing: 4) {
        ForEach(Self.items, id: \.self, content: button)
        Spacer(minLength: 0)
      }
    }

    @ViewBuilder private func button(_ item: Item) -> some View {
      switch item {
      case let .inline(style):
        ComposerToolbarButton(title: Self.title(item), symbol: Self.symbol(style), selected: commands.activeStyles.contains(style)) {
          commands.toggle(style)
        }
      case .link:
        ComposerToolbarButton(title: Self.title(item), symbol: "link") { commands.beginLink() }
      case let .block(format):
        ComposerToolbarButton(title: Self.title(item), symbol: Self.symbol(format), selected: commands.activeBlocks.contains(format)) {
          commands.apply(format)
        }
      }
    }

    static func symbol(_ style: ComposerInlineText.Style) -> String {
      switch style {
      case .bold: "bold"
      case .italic: "italic"
      case .underline: "underline"
      case .strikethrough: "strikethrough"
      case .code: "chevron.left.chevron.right"
      }
    }

    static func symbol(_ format: ComposerBlockFormat) -> String {
      switch format {
      case .orderedList: "list.number"
      case .unorderedList: "list.bullet"
      case .quote: "text.quote"
      case .codeBlock: "curlybraces.square"
      }
    }

    static func title(_ item: Item) -> String {
      switch item {
      case .inline(.bold): "Bold (⌘B)"
      case .inline(.italic): "Italic (⌘I)"
      case .inline(.underline): "Underline (⌘U)"
      case .inline(.strikethrough): "Strikethrough"
      case .inline(.code): "Inline code"
      case .link: "Link (⌘K)"
      case .block(.orderedList): "Numbered list"
      case .block(.unorderedList): "Bullet list"
      case .block(.quote): "Quote"
      case .block(.codeBlock): "Code block"
      }
    }
  }
#endif
