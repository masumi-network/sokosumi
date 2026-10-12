#if os(macOS)
  @testable import Sokosumi
  import SwiftUI
  import Testing

  struct TranscriptScrollEdgesTests {
    @Test func viewportMovementIsDistinctFromSizeChanges() {
      #expect(edges(offset: 1000) != edges(offset: 1010))
      #expect(edges(offset: 1000).hasSameSize(as: edges(offset: 1010)))
      #expect(edges(offset: 39).nearTop)
      #expect(!edges(offset: 40).nearTop)
    }

    @Test func bottomThresholdsIncludeComposerInsets() {
      #expect(!edges(offset: 1340).nearBottom)
      #expect(edges(offset: 1341).nearBottom)
      #expect(edges(offset: 1538).needsBottomAlignment)
      #expect(!edges(offset: 1539).needsBottomAlignment)
    }

    @MainActor @Test func olderPagesRequireIdleEvenWithoutAUserGesture() {
      let activity = TranscriptScrollActivity()
      activity.update(for: .animating)
      #expect(!activity.isScrolling)
      #expect(!activity.isAtRest)
      activity.update(for: .idle)
      #expect(activity.isAtRest)
      for phase: ScrollPhase in [.tracking, .interacting, .decelerating] {
        activity.update(for: phase)
        #expect(activity.isScrolling)
        #expect(!activity.isAtRest)
      }
    }

    private func edges(offset: CGFloat) -> TranscriptScrollEdges {
      TranscriptScrollEdges(ScrollGeometry(contentOffset: CGPoint(x: 0, y: offset),
                                           contentSize: CGSize(width: 900, height: 2000),
                                           contentInsets: EdgeInsets(top: 0, leading: 0, bottom: 240, trailing: 0),
                                           containerSize: CGSize(width: 900, height: 700)))
    }
  }
#endif
