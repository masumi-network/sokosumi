#if os(macOS)
  import SwiftUI

  /// Distinguish viewport movement from content growth.
  struct TranscriptScrollEdges: Equatable {
    let offsetY: CGFloat
    let contentHeight: CGFloat
    let viewportHeight: CGFloat
    let nearTop: Bool
    let nearBottom: Bool
    let needsBottomAlignment: Bool

    func hasSameSize(as other: Self) -> Bool {
      contentHeight == other.contentHeight && viewportHeight == other.viewportHeight
    }

    init(_ geometry: ScrollGeometry) {
      offsetY = geometry.contentOffset.y
      contentHeight = geometry.contentSize.height
      viewportHeight = geometry.containerSize.height - geometry.contentInsets.top - geometry.contentInsets.bottom
      let distance = geometry.contentSize.height + geometry.contentInsets.bottom - geometry.visibleRect.maxY
      nearTop = geometry.visibleRect.minY < 40
      nearBottom = distance < 200
      needsBottomAlignment = distance > 1
    }
  }
#endif
