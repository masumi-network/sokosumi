#if os(macOS)
  @testable import Sokosumi
  import SwiftUI
  import Testing

  struct TranscriptScrollEdgesTests {
    @Test func pixelChangesWithinTheSameBoundariesAreEqual() {
      #expect(edges(offset: 1000) == edges(offset: 1010))
      #expect(edges(offset: 39).nearTop)
      #expect(!edges(offset: 40).nearTop)
    }

    @Test func bottomThresholdsIncludeComposerInsets() {
      #expect(!edges(offset: 1340).nearBottom)
      #expect(edges(offset: 1341).nearBottom)
      #expect(edges(offset: 1538).needsBottomAlignment)
      #expect(!edges(offset: 1539).needsBottomAlignment)
    }

    @Test func leavingTheLiveEdgeIsReaderMotionWithoutAScrollPhase() {
      let aligned = edges(offset: 1539)
      let unaligned = edges(offset: 1538)
      let away = edges(offset: 1340)
      #expect(unaligned.isReaderMotion(from: aligned, userIsScrolling: false))
      #expect(!unaligned.isReaderMotion(from: unaligned, userIsScrolling: false))
      #expect(away.isReaderMotion(from: unaligned, userIsScrolling: false))
      #expect(unaligned.isReaderMotion(from: unaligned, userIsScrolling: true))
    }

    private func edges(offset: CGFloat) -> TranscriptScrollEdges {
      TranscriptScrollEdges(ScrollGeometry(contentOffset: CGPoint(x: 0, y: offset),
                                           contentSize: CGSize(width: 900, height: 2000),
                                           contentInsets: EdgeInsets(top: 0, leading: 0, bottom: 240, trailing: 0),
                                           containerSize: CGSize(width: 900, height: 700)))
    }
  }
#endif
