import Foundation
import SokosumiChat
import Testing

struct TranscriptScrollTests {
  /// A 2000 pt Transcript in a 700 pt viewport over a 240 pt composer: near the bottom past 1340, aligned at 1540.
  private func edges(_ offset: CGFloat, contentHeight: CGFloat = 2000, containerHeight: CGFloat = 700) -> TranscriptScrollEdges {
    TranscriptScrollEdges(offsetY: offset, contentHeight: contentHeight, containerHeight: containerHeight, topInset: 0,
                          bottomInset: 240, visibleMinY: offset, visibleMaxY: offset + containerHeight)
  }

  @Test func edgeThresholds() {
    #expect(edges(39).nearTop && !edges(40).nearTop)
    #expect(!edges(1340).nearBottom && edges(1341).nearBottom)
    #expect(edges(1538).needsBottomAlignment && !edges(1539).needsBottomAlignment)
    #expect(edges(1000).hasSameSize(as: edges(1010)) && !edges(1000).hasSameSize(as: edges(1000, contentHeight: 2100)))
  }

  @Test func resizingAndExhaustedHistoryDoNotUnpinLatest() {
    var scroll = TranscriptScroll()
    let resizeLoads = scroll.beginAutomaticOlderPage(userIsScrolling: false, isNearTop: true, hasMore: true, isLoading: false)
    #expect(!resizeLoads && scroll.followsLatest)
    let exhaustedLoads = scroll.beginAutomaticOlderPage(userIsScrolling: true, isNearTop: true, hasMore: false, isLoading: false)
    #expect(!exhaustedLoads && scroll.followsLatest)
    let scrollLoads = scroll.beginAutomaticOlderPage(userIsScrolling: true, isNearTop: true, hasMore: true, isLoading: false)
    #expect(scrollLoads && !scroll.followsLatest)
  }

  @Test func readerKeepsTheirPlaceUntilTheyReturn() {
    var scroll = TranscriptScroll()
    scroll.edgesChanged(from: edges(1540), to: edges(900), userIsScrolling: true, anchored: false)
    #expect(!scroll.followsLatest && scroll.showsJumpToLatest(anchored: false) && !scroll.followsNewMessages(anchored: false))
    // Content growth or a programmatic move inside the viewport does not pin them again.
    scroll.edgesChanged(from: edges(900), to: edges(910), userIsScrolling: false, anchored: false)
    #expect(!scroll.followsLatest)
    scroll.edgesChanged(from: edges(900), to: edges(1500), userIsScrolling: true, anchored: false)
    #expect(scroll.followsLatest && !scroll.showsJumpToLatest(anchored: false))
    scroll.readOlder()
    #expect(!scroll.followsLatest)
    scroll.followLatest()
    #expect(scroll.followsLatest)
  }

  /// Spec SOK-1481: an Unread divider placement that leaves the list at its end (content that fits, or a scroll the
  /// bottom clamps) moves nothing `edgesChanged` reads, so where the list next comes to rest says whether it follows.
  @Test func aPlacementSettlingAtTheEndFollowsTheLatest() {
    var scroll = TranscriptScroll()
    scroll.placedUnreadDivider()
    // Short content: the placement scroll cannot move the list at all.
    let short = edges(0, contentHeight: 300)
    scroll.edgesChanged(from: short, to: short, userIsScrolling: false, anchored: false)
    #expect(scroll.showsJumpToLatest(anchored: false))
    scroll.cameToRest(at: short, anchored: false)
    #expect(scroll.followsLatest && !scroll.showsJumpToLatest(anchored: false))

    scroll.placedUnreadDivider()
    scroll.cameToRest(at: edges(900), anchored: false)
    #expect(!scroll.followsLatest, "A long unread run leaves the list above the end.")
    scroll.placedUnreadDivider()
    scroll.cameToRest(at: edges(1500), anchored: true)
    #expect(!scroll.followsLatest, "A jump window is never the end.")
  }

  /// A touch while the placement settles does not drop it: the list's next rest settles it. Only that rest: later
  /// rests are the reader's own, which `edgesChanged` reads.
  @Test func aPlacementTheReaderInterruptsSettlesAtTheNextRest() {
    var scroll = TranscriptScroll()
    let short = edges(0, contentHeight: 300)
    scroll.placedUnreadDivider()
    scroll.edgesChanged(from: short, to: short, userIsScrolling: true, anchored: false)
    #expect(!scroll.followsLatest)
    scroll.cameToRest(at: short, anchored: false)
    #expect(scroll.followsLatest, "The interrupted placement settled at the next rest.")

    scroll.readOlder()
    scroll.cameToRest(at: short, anchored: false)
    #expect(!scroll.followsLatest, "A rest with no placement waiting changes nothing.")
  }

  @Test func growthWhileFollowingAlignsOnceTheReaderStops() {
    var scroll = TranscriptScroll()
    scroll.edgesChanged(from: edges(1540), to: edges(1540, contentHeight: 2200), userIsScrolling: false, anchored: false)
    #expect(scroll.pendingBottomAlignment)
    let whileScrolling = scroll.takeBottomAlignment(userIsScrolling: true, anchored: false)
    #expect(!whileScrolling && scroll.pendingBottomAlignment)
    let atRest = scroll.takeBottomAlignment(userIsScrolling: false, anchored: false)
    #expect(atRest)
    #expect(!scroll.pendingBottomAlignment && !scroll.alignsToBottom(userIsScrolling: false, anchored: false))
  }

  @Test func scrollingAwayDropsAPendingAlignment() {
    var scroll = TranscriptScroll()
    scroll.edgesChanged(from: edges(1540), to: edges(1540, contentHeight: 2200), userIsScrolling: false, anchored: false)
    scroll.edgesChanged(from: edges(1540, contentHeight: 2200), to: edges(600, contentHeight: 2200), userIsScrolling: true, anchored: false)
    #expect(!scroll.followsLatest && !scroll.pendingBottomAlignment)
  }

  @Test func aJumpDropsAPendingAlignment() {
    var scroll = TranscriptScroll()
    scroll.edgesChanged(from: edges(1540), to: edges(1540, contentHeight: 2200), userIsScrolling: false, anchored: false)
    scroll.jumped()
    #expect(!scroll.followsLatest && !scroll.pendingBottomAlignment)
  }

  @Test func aJumpedToPageNeverFollows() {
    var scroll = TranscriptScroll()
    #expect(scroll.followsLatest && !scroll.followsNewMessages(anchored: true) && scroll.showsJumpToLatest(anchored: true))
    // Neither the reader's scroll nor growth on the jumped-to page changes the intent or asks for an alignment.
    scroll.edgesChanged(from: edges(1540), to: edges(600), userIsScrolling: true, anchored: true)
    scroll.edgesChanged(from: edges(600), to: edges(600, contentHeight: 2200), userIsScrolling: false, anchored: true)
    #expect(scroll.followsLatest && !scroll.pendingBottomAlignment)
    // A pending alignment waits out the jumped-to page.
    scroll.edgesChanged(from: edges(1540), to: edges(1540, contentHeight: 2200), userIsScrolling: false, anchored: false)
    #expect(!scroll.alignsToBottom(userIsScrolling: false, anchored: true))
    #expect(scroll.alignsToBottom(userIsScrolling: false, anchored: false))
  }
}
