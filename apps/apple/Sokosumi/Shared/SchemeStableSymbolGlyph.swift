import SwiftUI

extension View {
  /// Draws SF Symbols with their light-scheme glyphs, coloured `color` as resolved in the real scheme.
  ///
  /// Some symbols pick their glyph by colour scheme: in dark `face.smiling` is a filled disc with
  /// cut-out features. This keeps it the outline its neighbours draw. Other symbols draw the same pixels.
  func schemeStableSymbolGlyph(_ color: Color) -> some View {
    modifier(SchemeStableSymbolGlyph(color: color))
  }
}

private struct SchemeStableSymbolGlyph: ViewModifier {
  let color: Color
  @Environment(\.self) private var environment

  func body(content: Content) -> some View {
    content
      .foregroundStyle(color.resolve(in: environment))
      .environment(\.colorScheme, .light)
  }
}
