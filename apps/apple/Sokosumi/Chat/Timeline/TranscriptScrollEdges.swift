#if os(macOS)
  import SokosumiChat
  import SwiftUI

  extension TranscriptScrollEdges {
    init(_ geometry: ScrollGeometry) {
      self.init(offsetY: geometry.contentOffset.y, contentHeight: geometry.contentSize.height,
                containerHeight: geometry.containerSize.height, topInset: geometry.contentInsets.top,
                bottomInset: geometry.contentInsets.bottom, visibleMinY: geometry.visibleRect.minY,
                visibleMaxY: geometry.visibleRect.maxY)
    }
  }
#endif
