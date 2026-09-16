import SwiftUI
#if os(macOS)
  import AppKit
#elseif os(iOS)
  import UIKit
#endif

/// Isolates the platform clipboard from chat presentation and portable models.
struct CopyTextButton: View {
  let text: String
  @State private var result: String?

  var body: some View {
    Button {
      #if os(macOS)
        NSPasteboard.general.clearContents()
        result = NSPasteboard.general.setString(text, forType: .string) ? "Copied" : "Could not copy"
      #elseif os(iOS)
        UIPasteboard.general.string = text
        result = "Copied"
      #endif
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
