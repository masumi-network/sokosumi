#if os(macOS)
  import SwiftUI

  /// Observe boundary transitions and layout size, not every pixel of scrolling.
  struct TranscriptScrollEdges: Equatable {
    let contentHeight: CGFloat
    let viewportHeight: CGFloat
    let nearTop: Bool
    let nearBottom: Bool
    let needsBottomAlignment: Bool

    func hasSameSize(as other: Self) -> Bool {
      contentHeight == other.contentHeight && viewportHeight == other.viewportHeight
    }

    init(_ geometry: ScrollGeometry) {
      contentHeight = geometry.contentSize.height
      viewportHeight = geometry.containerSize.height - geometry.contentInsets.top - geometry.contentInsets.bottom
      let distance = geometry.contentSize.height + geometry.contentInsets.bottom - geometry.visibleRect.maxY
      nearTop = geometry.visibleRect.minY < 40
      nearBottom = distance < 200
      needsBottomAlignment = distance > 1
    }
  }
#endif
