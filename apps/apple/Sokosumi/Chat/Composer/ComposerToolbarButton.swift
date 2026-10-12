import SwiftUI

/// Shared sizing and interaction feedback for composer toolbar actions.
struct ComposerToolbarButton: View {
  let title: String
  let symbol: String
  var selected = false
  /// The tooltip, when it should say more than the title (why the button is disabled).
  var help: String?
  let action: () -> Void
  @State private var hovered = false
  @Environment(\.isEnabled) private var isEnabled
  @ScaledMetric(relativeTo: .body) private var buttonSize = 28

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.body)
        .imageScale(.medium)
        .schemeStableSymbolGlyph(glyphColor)
        .frame(width: buttonSize, height: buttonSize)
        .background(background, in: .rect(cornerRadius: 5))
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
    .help(help ?? title)
    .accessibilityLabel(title)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private var glyphColor: Color {
    guard isEnabled else { return .secondary.opacity(0.5) }
    return selected || hovered ? .primary : .secondary
  }

  private var background: Color {
    if selected {
      return .accentColor.opacity(hovered ? 0.28 : 0.18)
    }
    return hovered && isEnabled ? .primary.opacity(0.1) : .clear
  }
}
