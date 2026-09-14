import SwiftUI

/// Clamp the entire rich body, rather than giving each Markdown block 16 lines.
/// Use native line bounds so headings, lists and paragraph spacing cannot split a line.
struct ExpandableMessageBody<Content: View>: View {
  let source: String
  var clampHeight = true
  var collapsedLines = 16
  var measurementFont: Font = .body
  @ViewBuilder let content: Content
  @State private var expanded = false
  @State private var contentHeight: CGFloat = 0
  @State private var collapsedHeight: CGFloat = 0
  @State private var completeLineHeight: CGFloat?

  private var overflows: Bool {
    clampHeight && collapsedHeight > 0 && contentHeight > collapsedHeight + 1
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      content
        .fixedSize(horizontal: false, vertical: true)
        .onGeometryChange(for: CGFloat.self) { geometry in
          geometry.size.height
        } action: { height in
          contentHeight = height
        }
        .backgroundPreferenceValue(Text.LayoutKey.self) { layouts in
          if overflows {
            GeometryReader { geometry in
              let lines = layouts.flatMap { anchored in
                let origin = geometry[anchored.origin]
                return anchored.layout.map { line in
                  line.typographicBounds.rect.offsetBy(dx: origin.x, dy: origin.y)
                }
              }
              let height = completeLineBoundary(lines, limit: collapsedHeight)
              Color.clear.onChange(of: height, initial: true) { _, height in
                completeLineHeight = height
              }
            }
          }
        }
        .frame(height: !expanded && overflows ? completeLineHeight ?? collapsedHeight : nil, alignment: .top)
        .clipped()
        .contentShape(Rectangle())
      if clampHeight, expanded || overflows {
        Button(expanded ? "Show less" : "Show more") {
          expanded.toggle()
        }
        .buttonStyle(.borderless)
        .font(.caption.weight(.medium))
        .accessibilityValue(expanded ? "Expanded" : "Collapsed")
      }
    }
    .background(alignment: .topLeading) {
      Text(String(repeating: "A\n", count: max(0, collapsedLines - 1)) + "A")
        .font(measurementFont)
        .fixedSize()
        .hidden()
        .accessibilityHidden(true)
        .allowsHitTesting(false)
        .onGeometryChange(for: CGFloat.self) { geometry in
          geometry.size.height
        } action: { height in
          collapsedHeight = height
        }
    }
    .onChange(of: source) { _, _ in
      expanded = false
    }
  }
}

/// Walk backwards because a taller line in a parallel column may straddle
/// the boundary selected by a shorter line. Leave no trailing paragraph gap.
private func completeLineBoundary(_ lines: [CGRect], limit: CGFloat) -> CGFloat {
  var boundary = limit
  for line in lines.filter({ $0.minY < limit }).sorted(by: { $0.minY > $1.minY }) {
    if line.minY < boundary, line.maxY > boundary {
      boundary = max(0, line.minY)
    }
  }
  return lines.lazy.map(\.maxY).filter { $0 <= boundary }.max() ?? boundary
}
