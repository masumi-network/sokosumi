import SokosumiChat
import SwiftUI

#if os(macOS)
  struct ComposerFormatToolbar: View {
    @ObservedObject var commands: MacComposerCommands

    var body: some View {
      HStack(spacing: 4) {
        ForEach(ComposerInlineText.Style.allCases, id: \.self) { style in
          ComposerToolbarButton(title: label(style), symbol: symbol(style), selected: commands.activeStyles.contains(style)) {
            commands.toggle(style)
          }
        }
        ComposerToolbarButton(title: "Link (⌘K)", symbol: "link") { commands.beginLink() }
        blockButton("Numbered list", symbol: "list.number", format: .orderedList)
        blockButton("Bullet list", symbol: "list.bullet", format: .unorderedList)
        blockButton("Quote", symbol: "text.quote", format: .quote)
        blockButton("Code block", symbol: "chevron.left.slash.chevron.right", format: .codeBlock)
        Spacer(minLength: 0)
      }
    }

    private func blockButton(_ title: String, symbol: String, format: ComposerBlockFormat) -> some View {
      ComposerToolbarButton(title: title, symbol: symbol, selected: commands.activeBlocks.contains(format)) {
        commands.apply(format)
      }
    }

    private func symbol(_ style: ComposerInlineText.Style) -> String {
      switch style {
      case .bold: "bold"
      case .italic: "italic"
      case .underline: "underline"
      case .strikethrough: "strikethrough"
      case .code: "chevron.left.forwardslash.chevron.right"
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
