@testable import SokosumiChat
import Testing

/// Row 04a: web's `boundaryStatus` map and `useLoadWhenVisible`, per gap row.
struct TranscriptBoundaryLoadsTests {
  @Test func aGapThatScrollsIntoViewIsRequestedOnce() {
    var loads = TranscriptBoundaryLoads()
    #expect(loads.status(of: "z") == .idle)
    #expect(loads.nextAutomaticLoad() == nil, "Nothing is visible yet.")
    loads.setVisible("z", true)
    #expect(loads.nextAutomaticLoad() == "z")
    #expect(loads.status(of: "z") == .loading)
    #expect(loads.nextAutomaticLoad() == nil, "The one automatic request is spent.")
    loads.setVisible("z", true)
    #expect(loads.nextAutomaticLoad() == nil, "A repeated visibility report does not duplicate an in-flight request.")
  }

  @Test func successRemovesTheGapAndFailureKeepsItOnTheRow() {
    var loads = TranscriptBoundaryLoads()
    loads.setVisible("z", true)
    _ = loads.nextAutomaticLoad()
    loads.settle("z", succeeded: true)
    #expect(loads.status(of: "z") == .idle)
    #expect(loads.loadingCursorMessageId == nil)

    var failed = TranscriptBoundaryLoads()
    failed.setVisible("z", true)
    _ = failed.nextAutomaticLoad()
    failed.settle("z", succeeded: false)
    #expect(failed.status(of: "z") == .failed)
    #expect(failed.nextAutomaticLoad() == nil, "A failed row waits for Try again; it does not auto-load while it stays in view.")
    failed.setVisible("z", false)
    failed.setVisible("z", true)
    #expect(failed.nextAutomaticLoad() == nil, "Scrolling a failed row out and back in does not re-arm it.")
  }

  @Test func tryAgainLoadsAgainAndAnInFlightRequestIsNotDuplicated() {
    var loads = TranscriptBoundaryLoads()
    loads.setVisible("z", true)
    _ = loads.nextAutomaticLoad()
    loads.settle("z", succeeded: false)
    let retried = loads.begin("z")
    #expect(retried)
    #expect(loads.status(of: "z") == .loading)
    let duplicated = loads.begin("z")
    #expect(!duplicated, "A second tap while the same gap loads is ignored.")
    loads.settle("z", succeeded: true)
    #expect(loads.status(of: "z") == .idle)
    #expect(loads.nextAutomaticLoad() == nil, "Success spends the arming: a gap that stays on the same row after its page asks again only by tap or by scrolling out and in.")
    loads.setVisible("z", false)
    loads.setVisible("z", true)
    #expect(loads.nextAutomaticLoad() == "z")
  }

  @Test func twoVisibleGapsLoadIndependentlyInTheOrderTheyAppeared() {
    var loads = TranscriptBoundaryLoads()
    loads.setVisible("m", true)
    loads.setVisible("z", true)
    #expect(loads.nextAutomaticLoad() == "m")
    #expect(loads.nextAutomaticLoad() == nil, "One request at a time: the timeline admits a single page.")
    #expect(loads.status(of: "z") == .idle)
    loads.settle("m", succeeded: false)
    #expect(loads.nextAutomaticLoad() == "z", "The second gap is still armed once the first settles.")
    #expect(loads.status(of: "m") == .failed)
    loads.settle("z", succeeded: true)
    #expect(loads.status(of: "m") == .failed, "The first gap's failure is its own.")
  }

  @Test func aRefusedRequestGoesBackToIdleWithoutLooping() {
    var loads = TranscriptBoundaryLoads()
    loads.setVisible("z", true)
    #expect(loads.nextAutomaticLoad() == "z")
    loads.release("z")
    #expect(loads.status(of: "z") == .idle)
    #expect(loads.nextAutomaticLoad() == nil, "The row shows Load missing messages for a tap; no automatic retry storm.")
    let tapped = loads.begin("z")
    #expect(tapped)
  }

  @Test func gapsThatClosedByAnotherRouteLeaveNoStateBehind() {
    var loads = TranscriptBoundaryLoads()
    loads.setVisible("m", true)
    loads.setVisible("z", true)
    _ = loads.nextAutomaticLoad()
    loads.settle("m", succeeded: false)
    _ = loads.nextAutomaticLoad()
    loads.retain(["z"])
    #expect(loads.status(of: "m") == .idle, "A jump that joined the ranges around m forgets its failure.")
    #expect(loads.status(of: "z") == .loading, "An in-flight load is never pruned.")
    loads.settle("z", succeeded: true)
    #expect(loads.loadingCursorMessageId == nil)
    #expect(loads.nextAutomaticLoad() == nil, "z is still in view, but its arming was spent by the load.")
    loads.retain([])
    #expect(loads == TranscriptBoundaryLoads())
  }

  @Test func scrollingOutOfViewDisarmsTheRow() {
    var loads = TranscriptBoundaryLoads()
    loads.setVisible("z", true)
    loads.setVisible("z", false)
    #expect(loads.nextAutomaticLoad() == nil)
    loads.setVisible("z", true)
    #expect(loads.nextAutomaticLoad() == "z")
  }
}
