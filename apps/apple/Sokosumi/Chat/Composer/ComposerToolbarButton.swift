import SwiftUI

/// Shared sizing and interaction feedback for composer toolbar actions.
struct ComposerToolbarButton: View {
  let title: String
  let symbol: String
  var selected = false
  let action: () -> Void
  @State private var hovered = false
  @ScaledMetric(relativeTo: .body) private var buttonSize = 28
  @Environment(\.self) private var environment

  var body: some View {
    Button(action: action) {
      // Some symbols pick their glyph by colour scheme: in dark `face.smiling` is a filled disc.
      // The light glyph keeps every toolbar icon an outline; the colour still resolves in the real scheme.
      Image(systemName: symbol)
        .font(.body)
        .imageScale(.medium)
        .foregroundStyle((selected || hovered ? Color.primary : .secondary).resolve(in: environment))
        .environment(\.colorScheme, .light)
        .frame(width: buttonSize, height: buttonSize)
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
