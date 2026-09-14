import SwiftUI

#if os(macOS)
  /// Floating capsule over the bottom of a room or thread transcript, shown
  /// while the reader is away from the newest message. Same control and
  /// label as web `TranscriptViewport`.
  struct JumpToLatestButton: View {
    let action: () -> Void

    var body: some View {
      Button(action: action) {
        Label("Jump to latest", systemImage: "arrow.down")
      }
      .buttonStyle(.borderedProminent)
      .buttonBorderShape(.capsule)
      .shadow(color: .black.opacity(0.2), radius: 4, y: 2)
      .padding(.bottom, 12)
    }
  }
#endif
