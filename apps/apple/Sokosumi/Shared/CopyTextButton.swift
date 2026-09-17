import SwiftUI

/// Copies its own caption through the platform pasteboard adapter.
struct CopyTextButton: View {
  let text: String
  @State private var result: String?

  var body: some View {
    Button {
      result = PlatformPasteboard.copy(text) ? "Copied" : "Could not copy"
    } label: {
      Text(text).lineLimit(1)
    }
    .buttonStyle(.borderless)
    .help(result ?? "Copy \(text)")
    .accessibilityLabel("Copy \(text)")
    .accessibilityValue(result ?? "")
    .onChange(of: text) { _, _ in result = nil }
  }
}
