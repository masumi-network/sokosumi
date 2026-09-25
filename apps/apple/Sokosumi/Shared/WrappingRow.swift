import SwiftUI

/// Left-aligned rows that wrap at the available width, like web `flex-wrap`.
struct WrappingRow: Layout {
  var spacing: CGFloat = 8
  var alignment: VerticalAlignment = .center
  var constrainsWidth = false

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache _: inout ()) -> CGSize {
    let rows = arrange(limit: proposal.width ?? .infinity, subviews: subviews)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.reduce(0) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * spacing
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal _: ProposedViewSize, subviews: Subviews, cache _: inout ()) {
    var top = bounds.minY
    // Wrap against the width actually granted, not the proposal, so an unspecified placement still wraps.
    for row in arrange(limit: bounds.width, subviews: subviews) {
      var leading = bounds.minX
      for index in row.indices {
        let proposed = proposal(for: bounds.width)
        let size = subviews[index].sizeThatFits(proposed)
        subviews[index].place(at: CGPoint(x: leading, y: top + (alignment == .top ? 0 : (row.height - size.height) / 2)), proposal: proposed)
        leading += size.width + spacing
      }
      top += row.height + spacing
    }
  }

  private func proposal(for width: CGFloat) -> ProposedViewSize {
    constrainsWidth && width.isFinite ? ProposedViewSize(width: width, height: nil) : .unspecified
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func arrange(limit: CGFloat, subviews: Subviews) -> [Row] {
    var rows: [Row] = []
    var current = Row()
    for (index, subview) in subviews.enumerated() {
      let size = subview.sizeThatFits(proposal(for: limit))
      let needed = current.indices.isEmpty ? size.width : current.width + spacing + size.width
      if !current.indices.isEmpty, needed > limit {
        rows.append(current)
        current = Row()
      }
      current.indices.append(index)
      current.width = current.indices.count == 1 ? size.width : current.width + spacing + size.width
      current.height = max(current.height, size.height)
    }
    if !current.indices.isEmpty {
      rows.append(current)
    }
    return rows
  }
}
