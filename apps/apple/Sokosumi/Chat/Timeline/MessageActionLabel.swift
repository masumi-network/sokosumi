import SwiftUI

/// The icon, and the title unless compact, of a message row's hover action (React, Reply, Quote).
struct MessageActionLabel: View {
  let title: String
  let symbol: String
  let hovered: Bool
  let compact: Bool
  let iconSize: CGFloat
  let height: CGFloat

  var body: some View {
    HStack(spacing: 5) {
      Image(systemName: symbol)
        .font(.callout)
        .schemeStableSymbolGlyph(hovered ? .primary : .secondary)
        .frame(width: iconSize, height: iconSize)
      if !compact {
        Text(title).font(.callout).lineLimit(1)
      }
    }
    .padding(.horizontal, 8)
    .frame(height: height)
    .foregroundStyle(hovered ? .primary : .secondary)
    .background(hovered ? Color.primary.opacity(0.1) : .clear, in: .rect(cornerRadius: 5))
    .contentShape(.rect)
  }
}
