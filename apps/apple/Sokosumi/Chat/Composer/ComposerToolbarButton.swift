import SwiftUI

/// Shared sizing and interaction feedback for composer toolbar actions.
struct ComposerToolbarButton: View {
  let title: String
  let symbol: String
  var selected = false
  let action: () -> Void
  @State private var hovered = false
  @ScaledMetric(relativeTo: .body) private var buttonSize = 28

  var body: some View {
    Button(action: action) {
      Image(systemName: symbol)
        .font(.body)
        .imageScale(.medium)
        .frame(width: buttonSize, height: buttonSize)
        .foregroundStyle(selected || hovered ? .primary : .secondary)
        .background(background, in: .rect(cornerRadius: 5))
        .contentShape(.rect)
    }
    .buttonStyle(.plain)
    .onHover { hovered = $0 }
    .help(title)
    .accessibilityLabel(title)
    .accessibilityAddTraits(selected ? .isSelected : [])
  }

  private var background: Color {
    if selected {
      return .accentColor.opacity(hovered ? 0.28 : 0.18)
    }
    return hovered ? .primary.opacity(0.1) : .clear
  }
}
