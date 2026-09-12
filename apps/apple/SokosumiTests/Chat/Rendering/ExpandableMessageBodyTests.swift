#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SwiftUI
  import Testing

  @MainActor
  struct ExpandableMessageBodyTests {
    @Test(arguments: ["received", "first line\nsecond line"])
    func shortQuoteKeepsNaturalHeightInTallContainer(source: String) async throws {
      let measurement = HeightMeasurement()
      let body = ExpandableMessageBody(source: source, collapsedLines: 4, measurementFont: .callout) {
        Text(source).font(.callout)
      }
      .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measurement.height = $0 }
      .frame(width: 600, height: 400, alignment: .top)
      let host = NSHostingView(rootView: body)
      host.frame = NSRect(x: 0, y: 0, width: 600, height: 400)
      for _ in 0 ..< 5 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      let text = NSHostingView(rootView: Text(source).font(.callout).fixedSize())
      #expect(measurement.height > 0)
      #expect(abs(measurement.height - text.fittingSize.height) <= 1)
    }

    private final class HeightMeasurement {
      var height: CGFloat = 0
    }
  }
#endif
