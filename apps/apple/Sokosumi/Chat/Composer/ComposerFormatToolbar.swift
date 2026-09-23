import SokosumiChat
import SwiftUI

#if os(macOS)
  struct ComposerFormatToolbar: View {
    @ObservedObject var commands: MacComposerCommands

    var body: some View {
      HStack(spacing: 4) {
        ForEach(ComposerInlineText.Style.allCases, id: \.self) { style in
          ComposerToolbarButton(title: label(style), symbol: Self.symbol(style), selected: commands.activeStyles.contains(style)) {
            commands.toggle(style)
          }
        }
        ComposerToolbarButton(title: "Link (⌘K)", symbol: "link") { commands.beginLink() }
        blockButton("Numbered list", format: .orderedList)
        blockButton("Bullet list", format: .unorderedList)
        blockButton("Quote", format: .quote)
        blockButton("Code block", format: .codeBlock)
        Spacer(minLength: 0)
      }
    }

    private func blockButton(_ title: String, format: ComposerBlockFormat) -> some View {
      ComposerToolbarButton(title: title, symbol: Self.symbol(format), selected: commands.activeBlocks.contains(format)) {
        commands.apply(format)
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

    private func label(_ style: ComposerInlineText.Style) -> String {
      switch style {
      case .bold: "Bold (⌘B)"
      case .italic: "Italic (⌘I)"
      case .underline: "Underline (⌘U)"
      case .strikethrough: "Strikethrough"
      case .code: "Inline code"
      }
    }
  }
#endif
