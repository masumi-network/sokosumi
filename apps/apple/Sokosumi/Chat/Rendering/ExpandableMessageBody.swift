import SwiftUI

/// Clamp the entire rich body, rather than giving each Markdown block 16 lines.
/// Use native line bounds so headings, lists and paragraph spacing cannot split a line.
struct ExpandableMessageBody<Content: View>: View {
  let source: String
  var clampHeight = true
  var collapsedLines = 16
  var measurementFont: Font = .body
  /// The toggle's titles: the body's "Show more" / "Show less", a quote's "More" / "Less" (web `Quote.showMore`).
  var titles: (expand: LocalizedStringKey, collapse: LocalizedStringKey) = ("Show more", "Show less")
  @ViewBuilder let content: Content
  @State private var expanded = false
  @State private var contentHeight: CGFloat = 0
  @State private var collapsedHeight: CGFloat = 0
  @State private var completeLineHeight: CGFloat?
  @State private var allowances: [MessageClampAllowance] = []

  /// Sixteen lines' height, plus the part of each block above it that web's line clamp does not count as lines.
  private var clampLimit: CGFloat {
    allowances.sorted { $0.top < $1.top }.reduce(collapsedHeight) { limit, allowance in
      allowance.top < limit ? limit + allowance.uncounted : limit
    }
  }

  private var overflows: Bool {
    clampHeight && collapsedHeight > 0 && contentHeight > clampLimit + 1
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
              let height = completeLineBoundary(lines, limit: clampLimit)
              Color.clear.onChange(of: height, initial: true) { _, height in
                completeLineHeight = height
              }
            }
          }
        }
        .coordinateSpace(.named(MessageClampAllowance.space))
        .onPreferenceChange(MessageClampAllowance.Key.self) { allowances = $0 }
        .frame(height: !expanded && overflows ? completeLineHeight ?? clampLimit : nil, alignment: .top)
        .clipped()
        .contentShape(Rectangle())
      if clampHeight, expanded || overflows {
        Button(expanded ? titles.collapse : titles.expand) {
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

/// Height inside a body that web's `line-clamp` does not count as lines: a block that draws no line box of its own
/// (row 10d's Mermaid figure: its flex caption, scrolling preview and padding). The body adds it to its sixteen lines
/// when the block starts above the cut.
struct MessageClampAllowance: Equatable {
  static let space = "MessageClampBody"
  /// The block's top in the body.
  let top: CGFloat
  let uncounted: CGFloat

  struct Key: PreferenceKey {
    static let defaultValue: [MessageClampAllowance] = []
    static func reduce(value: inout [MessageClampAllowance], nextValue: () -> [MessageClampAllowance]) {
      value += nextValue()
    }
  }
}

extension View {
  /// Reports `uncounted` points of this view as outside the enclosing body's line count.
  func messageClampAllowance(_ uncounted: CGFloat) -> some View {
    background {
      GeometryReader { proxy in
        Color.clear.preference(
          key: MessageClampAllowance.Key.self,
          value: [MessageClampAllowance(top: proxy.frame(in: .named(MessageClampAllowance.space)).minY, uncounted: uncounted)]
        )
      }
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
