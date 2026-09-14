import SwiftUI

#if os(macOS)
  /// Floating capsule over the bottom of a room or thread transcript, shown
  /// while the reader is away from the newest message. Same control and
  /// label as web `TranscriptViewport`: surface fill, accent text and a
  /// light accent stroke, like a reaction the reader has left.
  struct JumpToLatestButton: View {
    let action: () -> Void

    var body: some View {
      Button(action: action) {
        Label("Jump to latest", systemImage: "arrow.down")
          .font(.callout.weight(.medium))
          .foregroundStyle(Color.accentColor)
          .padding(.horizontal, 12)
          .padding(.vertical, 6)
          .background(.background, in: .capsule)
          .overlay(Capsule().strokeBorder(Color.accentColor.opacity(0.3)))
          .contentShape(.capsule)
      }
      .buttonStyle(.plain)
      .shadow(color: .black.opacity(0.15), radius: 6, y: 2)
      .padding(.bottom, 12)
    }
  }
#endif
