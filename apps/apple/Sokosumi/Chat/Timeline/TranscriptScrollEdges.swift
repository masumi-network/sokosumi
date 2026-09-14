#if os(macOS)
  import SwiftUI

  /// Only boundaries that change transcript behavior belong in view state.
  struct TranscriptScrollEdges: Equatable {
    let nearTop: Bool
    let nearBottom: Bool
    let needsBottomAlignment: Bool

    init(_ geometry: ScrollGeometry) {
      let distance = geometry.contentSize.height + geometry.contentInsets.bottom - geometry.visibleRect.maxY
      nearTop = geometry.visibleRect.minY < 40
      nearBottom = distance < 200
      needsBottomAlignment = distance > 1
    }

    /// Wheel events injected on NSScrollView often never enter SwiftUI's
    /// interacting phase. Leaving the live edge is still reader motion.
    func isReaderMotion(from old: Self, userIsScrolling: Bool) -> Bool {
      userIsScrolling || !nearBottom || (needsBottomAlignment && !old.needsBottomAlignment)
    }
  }
#endif
