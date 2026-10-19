import Foundation
@testable import SokosumiChat
import Testing

private struct Row: Equatable, Sendable {
  let id: String
  var version = 1
}

private func rows(_ ids: String...) -> [Row] {
  ids.map { Row(id: $0) }
}

private struct PageRefused: Error {}

/// `begin`, failing the test when the page may not start.
private func start(_ pages: inout CursorPages<Row>, older: Bool) throws -> CursorPages<Row>.Request {
  guard let request = pages.begin(older: older) else { throw PageRefused() }
  return request
}

/// A list that answered its first page `a, b` with more behind it.
private func firstPageAnswered(next: String? = "c1") -> CursorPages<Row> {
  var pages = CursorPages<Row>()
  guard let request = pages.begin(older: false) else { return pages }
  pages.answer(request, items: rows("a", "b"), nextCursor: next, id: \.id)
  pages.settle(request)
  return pages
}

struct CursorPagesTests {
  @Test func aFirstPageReplacesTheRowsAndKeepsTheCursor() throws {
    var pages = CursorPages<Row>()
    let request = try start(&pages, older: false)
    #expect(request.cursor == nil)
    #expect(pages.isLoadingFirstPage)
    pages.answer(request, items: rows("a", "b"), nextCursor: "c1", id: \.id)
    pages.settle(request)
    #expect(pages.items == rows("a", "b"))
    #expect(pages.nextCursor == "c1")
    #expect(pages.hasAnswered)
    #expect(!pages.isLoadingFirstPage)

    let again = try start(&pages, older: false)
    #expect(pages.items == rows("a", "b"), "The rows stay on screen until Core answers.")
    pages.answer(again, items: rows("x"), nextCursor: nil, id: \.id)
    pages.settle(again)
    #expect(pages.items == rows("x"))
    #expect(pages.nextCursor == nil)
  }

  @Test func beginRefusesAnOlderPageWithNoCursor() {
    var pages = CursorPages<Row>()
    #expect(pages.begin(older: true) == nil)
    #expect(pages.olderPageStatus == .idle)
    #expect(pages.generation == 0, "A refusal changes nothing.")
  }

  @Test func beginRefusesAnOlderPageDuringAFirstPage() throws {
    var pages = firstPageAnswered()
    _ = try start(&pages, older: false)
    #expect(pages.begin(older: true) == nil)
    #expect(pages.olderPageStatus == .idle)
  }

  @Test func beginRefusesAnOlderPageWhileAnOlderPageLoads() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    #expect(older.cursor == "c1")
    #expect(pages.olderPageStatus == .loading)
    #expect(pages.begin(older: true) == nil)
    #expect(pages.isCurrent(older), "The refusal leaves the page in flight alone.")
  }

  @Test func aFirstPageSupersedesAnOlderPageInFlightAndTheLateAnswerIsDropped() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    let first = try start(&pages, older: false)
    #expect(pages.olderPageStatus == .idle)
    #expect(!pages.isCurrent(older))

    pages.answer(older, items: rows("late"), nextCursor: "c2", id: \.id)
    pages.settle(older)
    #expect(pages.items == rows("a", "b"))
    #expect(pages.nextCursor == "c1")
    #expect(pages.isLoadingFirstPage, "The stale request does not end the first page.")

    pages.answer(first, items: rows("n"), nextCursor: nil, id: \.id)
    pages.settle(first)
    #expect(pages.items == rows("n"))
    #expect(!pages.isLoadingFirstPage)
  }

  @Test func aRepeatedCursorEndsPaging() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    pages.answer(older, items: rows("c"), nextCursor: "c1", id: \.id)
    pages.settle(older)
    #expect(pages.items == rows("a", "b", "c"))
    #expect(pages.nextCursor == nil)
    #expect(pages.begin(older: true) == nil)
  }

  @Test func aNewCursorKeepsPaging() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    pages.answer(older, items: rows("c"), nextCursor: "c2", id: \.id)
    pages.settle(older)
    #expect(pages.nextCursor == "c2")
    #expect(pages.olderPageStatus == .idle)
  }

  @Test func anOlderPageSkipsHeldIdsAndKeepsTheHeldCopy() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    pages.answer(older, items: [Row(id: "b", version: 2), Row(id: "c")], nextCursor: nil, id: \.id)
    pages.settle(older)
    #expect(pages.items == [Row(id: "a"), Row(id: "b", version: 1), Row(id: "c")])
  }

  @Test func aFailedOlderPageKeepsTheRowsAndWaitsForTheReader() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    pages.fail(older)
    pages.settle(older)
    #expect(pages.olderPageStatus == .failed)
    #expect(pages.items == rows("a", "b"))
    #expect(pages.nextCursor == "c1")
    #expect(pages.hasAnswered)
    #expect(!pages.loadsOlderAutomatically, "A failed row waits for Try again.")

    let retry = try start(&pages, older: true)
    #expect(retry.cursor == "c1")
    pages.answer(retry, items: rows("c"), nextCursor: nil, id: \.id)
    pages.settle(retry)
    #expect(pages.items == rows("a", "b", "c"))
    #expect(pages.olderPageStatus == .idle)
  }

  @Test func aFailedFirstPageClearsTheRows() throws {
    var pages = firstPageAnswered()
    let first = try start(&pages, older: false)
    pages.fail(first)
    pages.settle(first)
    #expect(pages.items.isEmpty)
    #expect(pages.nextCursor == nil)
    #expect(!pages.hasAnswered)
    #expect(pages.firstPageFailed)
    #expect(!pages.isLoadingFirstPage)
    #expect(pages.olderPageStatus == .idle)
  }

  @Test func aFirstPageAfterAFailureClearsTheFailure() throws {
    var pages = firstPageAnswered()
    let failed = try start(&pages, older: false)
    pages.fail(failed)
    pages.settle(failed)
    let retry = try start(&pages, older: false)
    pages.answer(retry, items: rows("a"), nextCursor: nil, id: \.id)
    pages.settle(retry)
    #expect(!pages.firstPageFailed)
    #expect(pages.hasAnswered)
  }

  @Test func settleIgnoresAStaleRequest() throws {
    var pages = firstPageAnswered()
    let stale = try start(&pages, older: false)
    let current = try start(&pages, older: false)
    pages.settle(stale)
    #expect(pages.isLoadingFirstPage)
    pages.settle(current)
    #expect(!pages.isLoadingFirstPage)
  }

  @Test func aStaleFailureChangesNothing() throws {
    var pages = firstPageAnswered()
    let stale = try start(&pages, older: false)
    let current = try start(&pages, older: false)
    pages.fail(stale)
    #expect(pages.items == rows("a", "b"))
    #expect(!pages.firstPageFailed)
    pages.settle(current)
  }

  @Test func resetDropsALateAnswerAndForgetsEverything() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    pages.reset()
    pages.answer(older, items: rows("late"), nextCursor: "c2", id: \.id)
    pages.settle(older)
    #expect(pages.items.isEmpty)
    #expect(pages.nextCursor == nil)
    #expect(!pages.hasAnswered)
    #expect(pages.olderPageStatus == .idle)
    #expect(!pages.isLoadingFirstPage)
    #expect(pages.generation > older.generation)
  }

  @Test func resetStillRefusesAnOlderPageUntilAFirstPageAnswers() throws {
    var pages = firstPageAnswered()
    pages.reset()
    #expect(pages.begin(older: true) == nil)
    let first = try start(&pages, older: false)
    #expect(pages.isCurrent(first))
  }

  @Test func supersedeDropsALatePageAndKeepsTheRows() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    pages.supersede()
    #expect(pages.olderPageStatus == .idle)
    pages.answer(older, items: rows("late"), nextCursor: "c2", id: \.id)
    #expect(pages.items == rows("a", "b"))
    #expect(pages.nextCursor == "c1")

    let first = try start(&pages, older: false)
    pages.supersede()
    #expect(!pages.isLoadingFirstPage)
    pages.answer(first, items: rows("late"), nextCursor: nil, id: \.id)
    #expect(pages.items == rows("a", "b"))
  }

  @Test func supersedeKeepsAFailedOlderPage() throws {
    var pages = firstPageAnswered()
    let older = try start(&pages, older: true)
    pages.fail(older)
    pages.supersede()
    #expect(pages.olderPageStatus == .failed)
  }

  @Test func removeAllTakesHeldRowsOut() {
    var pages = firstPageAnswered()
    pages.removeAll { $0.id == "a" }
    #expect(pages.items == rows("b"))
    #expect(pages.nextCursor == "c1")
  }

  @Test func theOlderRowAsksByItselfOnlyWhileIdleWithACursor() throws {
    var pages = CursorPages<Row>()
    #expect(!pages.loadsOlderAutomatically, "No cursor.")

    pages = firstPageAnswered()
    #expect(pages.loadsOlderAutomatically)

    let first = try start(&pages, older: false)
    #expect(!pages.loadsOlderAutomatically, "Never during a first page.")
    pages.settle(first)

    let older = try start(&pages, older: true)
    #expect(!pages.loadsOlderAutomatically, "Not while an older page loads.")
    pages.fail(older)
    pages.settle(older)
    #expect(!pages.loadsOlderAutomatically, "Not after a failure until the reader retries.")
  }
}
