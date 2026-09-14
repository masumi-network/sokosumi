#if os(macOS)
  import SwiftUI

  /// Only boundaries that change transcript behavior belong in view state.
  struct TranscriptScrollEdges: Equatable {
    let nearTop: Bool
    let nearBottom: Bool
    let needsBottomAlignment: Bool
    /// Excluded from `==` so geometry observation stays coalesced.
    let visibleMinY: CGFloat

    init(_ geometry: ScrollGeometry) {
      let distance = geometry.contentSize.height + geometry.contentInsets.bottom - geometry.visibleRect.maxY
      nearTop = geometry.visibleRect.minY < 40
      nearBottom = distance < 200
      needsBottomAlignment = distance > 1
      visibleMinY = geometry.visibleRect.minY
    }

    static func == (lhs: Self, rhs: Self) -> Bool {
      lhs.nearTop == rhs.nearTop && lhs.nearBottom == rhs.nearBottom && lhs.needsBottomAlignment == rhs.needsBottomAlignment
    }

    /// Wheel events injected on NSScrollView often never enter SwiftUI's
    /// interacting phase. Leaving the live edge by moving the viewport is
    /// still reader motion. Content growth at a stable minY is not.
    func isReaderMotion(from old: Self, userIsScrolling: Bool) -> Bool {
      userIsScrolling || !nearBottom
        || (needsBottomAlignment && !old.needsBottomAlignment && abs(visibleMinY - old.visibleMinY) >= 1)
    }
  }
#endif
