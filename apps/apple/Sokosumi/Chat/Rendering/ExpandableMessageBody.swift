import SwiftUI

/// Clamp the entire rich body, rather than giving each Markdown block 16 lines.
/// Measure native text so the limit tracks the font and accessibility text size.
struct ExpandableMessageBody<Content: View>: View {
  let source: String
  var clampHeight = true
  @ViewBuilder let content: Content
  @State private var expanded = false
  @State private var contentHeight: CGFloat = 0
  @State private var collapsedHeight: CGFloat = 0

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
        .frame(maxHeight: clampHeight && !expanded && collapsedHeight > 0 ? collapsedHeight : nil, alignment: .top)
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
      Text(String(repeating: "A\n", count: 15) + "A")
        .font(.body)
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
