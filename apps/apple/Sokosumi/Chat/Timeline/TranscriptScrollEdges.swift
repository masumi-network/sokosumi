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
  }
#endif
