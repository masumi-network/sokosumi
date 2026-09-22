#if os(macOS)
  import AppKit
  import CoreAPI
  @testable import Sokosumi
  import SwiftUI
  import Testing

  @MainActor struct MessageUnfurlViewTests {
    @Test(arguments: [false, true])
    func previewCardsFitNarrowLayouts(dark: Bool) async throws {
      let content = VStack(alignment: .leading, spacing: 12) {
        MessageUnfurlView(preview: .init(url: "https://example.com", title: "A useful article about building native applications", description: "A short preview with enough text to verify wrapping and spacing at a narrow window width.", siteName: "Example"), remove: {})
        MessageUnfurlView(preview: .init(url: "https://example.com/second", title: "Another link", description: "Read-only preview."))
      }
      .padding(20).frame(width: 340).background(.background)
      .environment(\.colorScheme, dark ? .dark : .light)
      let host = NSHostingView(rootView: content)
      host.frame = NSRect(x: 0, y: 0, width: 340, height: 300)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      #expect(host.fittingSize.height < 300)
    }
  }
#endif
