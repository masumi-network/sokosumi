#if os(macOS)
  import AppKit
  @testable import Sokosumi
  import SokosumiChat
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

    /// Narrow wrap: a long markdown paragraph must clamp on a complete line, not mid-glyph.
    @Test func wrappingParagraphClampsOnCompleteLinesWhenNarrow() async throws {
      try await assertCompleteLines(source: Self.paragraphSource, width: 240)
    }

    /// Comfortable width: the same paragraph still clamps on a complete line after reflow.
    @Test func wrappingParagraphClampsOnCompleteLinesWhenComfortable() async throws {
      try await assertCompleteLines(source: Self.paragraphSource, width: 600)
    }

    /// Headings with descenders: block metrics must not leave a line straddling Show more.
    @Test func headingDescendersClampOnCompleteLines() async throws {
      try await assertCompleteLines(
        source: Array(repeating: "### Heading with descenders gy", count: 30).joined(separator: "\n\n"),
        width: 240
      )
    }

    /// Wrapped list items: list layout must clamp on a complete line, not a mid-item gap.
    @Test func wrappedListClampsOnCompleteLines() async throws {
      try await assertCompleteLines(
        source: "## Report\n\n" + String(repeating: "- A wrapped list item with enough words to continue onto another line in a narrow window.\n", count: 30),
        width: 600
      )
    }

    private static let paragraphSource = String(
      repeating: "A paragraph with **bold words**, _emphasis_, descenders gy and a [link](https://example.com).\n\n",
      count: 30
    )

    private func assertCompleteLines(source: String, width: CGFloat) async throws {
      let document = MessageMarkdown(source)
      let measurement = HeightMeasurement()
      let body = ExpandableMessageBody(source: source) {
        MarkdownBlocksView(blocks: document.blocks)
          .backgroundPreferenceValue(Text.LayoutKey.self) { layouts in
            GeometryReader { geometry in
              let lines = layouts.flatMap { anchored in
                let origin = geometry[anchored.origin]
                return anchored.layout.map { $0.typographicBounds.rect.offsetBy(dx: origin.x, dy: origin.y) }
              }
              Color.clear.onChange(of: lines, initial: true) { _, lines in
                measurement.lines = lines
              }
            }
          }
      }
      .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { measurement.height = $0 }
      .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
      let host = NSHostingView(rootView: body)
      let button = NSHostingView(rootView: Button("Show more") {}
        .buttonStyle(.borderless).font(.caption.weight(.medium)))
      host.frame = NSRect(x: 0, y: 0, width: width, height: 1000)
      for _ in 0 ..< 10 {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(20))
      }
      let boundary = measurement.height - button.fittingSize.height - 4
      #expect(!measurement.lines.isEmpty)
      #expect(boundary > 0)
      #expect(measurement.lines.contains { $0.maxY > boundary + 1 })
      #expect(!measurement.lines.contains { $0.minY < boundary - 0.5 && $0.maxY > boundary + 0.5 },
              "A text line crosses the collapsed boundary at width \(width)")
      #expect(measurement.lines.contains { abs($0.maxY - boundary) < 0.5 },
              "Show more should follow a complete line without an empty paragraph gap")
    }

    private final class HeightMeasurement {
      var height: CGFloat = 0
      var lines: [CGRect] = []
    }
  }
#endif
