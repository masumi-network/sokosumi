import SwiftUI

/// Clamp the entire rich body, rather than giving each Markdown block 16 lines.
/// Use native line bounds so headings, lists and paragraph spacing cannot split a line.
struct ExpandableMessageBody<Content: View>: View {
  let source: String
  var collapsedLines = 16
  var measurementFont: Font = .body
  /// Web fades a collapsed body's bottom (`COLLAPSED_FADE_CLASS`), whose cut can land inside an image; a quote's
  /// line clamp does not.
  var fadesCut = true
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
      allowance.top < limit ? limit + allowance.uncounted(collapsedHeight: collapsedHeight) : limit
    }
  }

  private var overflows: Bool {
    collapsedHeight > 0 && contentHeight > clampLimit + 1
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
              // A cut through a block without lines of its own stays there: snapping up would hide all of it.
              let limit = clampLimit
              let height = allowances.contains { $0.top < limit && limit < $0.top + $0.height }
                ? limit : completeLineBoundary(lines, limit: limit)
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
        .mask {
          LinearGradient(stops: [.init(color: .black, location: 0.6),
                                 .init(color: .black.opacity(fadesCut && !expanded && overflows ? 0 : 1), location: 1)],
                         startPoint: .top, endPoint: .bottom)
        }
        .contentShape(Rectangle())
      if expanded || overflows {
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

/// Height inside a body that the sixteen-line clamp does not count as lines: a block that draws no line box of its own
/// (row 10d's Mermaid figure: its caption row, scrolling preview and padding; row 10c's large image). The body adds it
/// to its sixteen lines when the block starts above the cut.
struct MessageClampAllowance: Equatable {
  static let space = "MessageClampBody"
  /// Web's collapsed body (`max-h-96`, sixteen 24 px lines) and the margin round its large image (`my-2`), in px.
  private static let webCap: CGFloat = 384
  private static let webImageMargin: CGFloat = 16
  /// The block's top in the body.
  let top: CGFloat
  let height: CGFloat
  /// Nil for a large image. Its 320 pt cap is web's, but Apple's sixteen lines are shorter than web's, so it counts
  /// the share of them it fills of web's cap: a full-cap image fits under one caption line, as on web, not two.
  let uncounted: CGFloat?

  func uncounted(collapsedHeight: CGFloat) -> CGFloat {
    uncounted ?? max(0, height - (height + Self.webImageMargin) * collapsedHeight / Self.webCap)
  }

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
    reportingClampAllowance(uncounted)
  }

  /// Counts this large image toward the enclosing body's sixteen lines as web counts it against its cap.
  func messageClampLargeImage() -> some View {
    reportingClampAllowance(nil)
  }

  private func reportingClampAllowance(_ uncounted: CGFloat?) -> some View {
    background {
      GeometryReader { proxy in
        Color.clear.preference(
          key: MessageClampAllowance.Key.self,
          value: [MessageClampAllowance(top: proxy.frame(in: .named(MessageClampAllowance.space)).minY,
                                        height: proxy.size.height, uncounted: uncounted)]
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
