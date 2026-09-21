import CoreAPI
import Foundation
import HTTPTypes
import OpenAPIRuntime
import SokosumiChat
import Testing

/// Row 23a: hits stay on screen until the next answer, as in web's room-search-panel.tsx.
@MainActor
struct RoomSearchRefiningTests {
  private let otherRoomId = "550e8400-e29b-41d4-a716-446655440999"

  @Test func firstSearchShowsTheLoadingRowUntilItsAnswer() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    let task = start(search, "hello", client: client)
    await transport.waitForRequest("hello")
    let waiting = search.presentation(for: "hello")
    #expect(waiting.placeholder == .loading)
    #expect(waiting.results.isEmpty && !waiting.isRefining)
    await transport.respond(to: "hello", rows: ["a", "b"])
    await task.value
    let answered = search.presentation(for: "hello")
    #expect(answered.placeholder == nil)
    #expect(answered.results.map(\.id) == ["a", "b"] && !answered.isRefining)
  }

  @Test func refiningKeepsThePreviousResultsUntilTheNextAnswer() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "he", rows: ["a", "b"])

    // The field runs ahead of the model: the keystroke is typed, the search not yet asked for.
    let typed = search.presentation(for: "hel")
    #expect(typed.placeholder == nil, "No loading or empty row may replace hits that are still showing.")
    #expect(typed.results.map(\.id) == ["a", "b"] && typed.isRefining)

    let task = start(search, "hel", client: client)
    await transport.waitForRequest("hel")
    #expect(search.isLoading)
    let inFlight = search.presentation(for: "hel")
    #expect(inFlight.placeholder == nil)
    #expect(inFlight.results.map(\.id) == ["a", "b"] && inFlight.isRefining)

    await transport.respond(to: "hel", rows: ["c"])
    await task.value
    let replaced = search.presentation(for: "hel")
    #expect(replaced.placeholder == nil)
    #expect(replaced.results.map(\.id) == ["c"] && !replaced.isRefining)
  }

  @Test func aKeystrokeThatCancelsTheRequestLeavesTheEarlierHitsAlone() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "he", rows: ["a"])
    let superseded = start(search, "hel", client: client)
    await transport.waitForRequest("hel")
    superseded.cancel()
    await transport.respond(to: "hel", rows: ["late"])
    await superseded.value
    #expect(search.results.map(\.id) == ["a"])
    #expect(!search.isLoading && search.errorMessage == nil)
    let next = search.presentation(for: "help")
    #expect(next.placeholder == nil)
    #expect(next.results.map(\.id) == ["a"] && next.isRefining)
  }

  @Test func anErrorClearsTheStaleResultsAndYieldsToTheNextSearch() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "he", rows: ["a", "b"])
    let failing = start(search, "hel", client: client)
    await transport.waitForRequest("hel")
    await transport.respond(to: "hel", status: 403, body: #"{"error":"Forbidden","message":"No access"}"#)
    await failing.value
    let failed = search.presentation(for: "hel")
    guard case .failed = failed.placeholder else {
      Issue.record("expected the error row, got \(String(describing: failed.placeholder))")
      return
    }
    #expect(failed.results.isEmpty && search.results.isEmpty)
    #expect(search.selectedId == nil)

    // Web: a stale error yields to the loading row once the next fetch is due.
    #expect(search.presentation(for: "help").placeholder == .loading)
    let retry = start(search, "help", client: client)
    await transport.waitForRequest("help")
    #expect(search.presentation(for: "help").placeholder == .loading)
    await transport.respond(to: "help", rows: ["c"])
    await retry.value
    #expect(search.errorMessage == nil)
    #expect(search.presentation(for: "help").results.map(\.id) == ["c"])
  }

  @Test func noResultsAppearsOnlyForAnAnswerWithNoHits() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "he", rows: ["a"])
    let task = start(search, "hex", client: client)
    await transport.waitForRequest("hex")
    #expect(search.presentation(for: "hex").placeholder == nil, "The empty row must not flash while refining.")
    await transport.respond(to: "hex", rows: [])
    await task.value
    let empty = search.presentation(for: "hex")
    #expect(empty.placeholder == .empty)
    #expect(empty.results.isEmpty && search.selectedId == nil)

    // With nothing to keep, the next keystroke reads as loading, never as "no results".
    #expect(search.presentation(for: "hexa").placeholder == .loading)
  }

  @Test func clearingTheQueryClearsAtOnce() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "he", rows: ["a"])
    let emptied = search.presentation(for: "  \n")
    #expect(emptied.placeholder == .idle, "The field is empty before the model hears about it.")
    #expect(emptied.results.isEmpty && !emptied.isRefining)

    await search.search(query: " ", roomId: testRoomId, client: client, organizationSlug: nil)
    #expect(search.results.isEmpty && search.selectedId == nil && !search.isLoading)
    #expect(await transport.requestedQueries == ["he"])
    // Typing again starts from nothing, not from the hits of the cleared query.
    #expect(search.presentation(for: "h").placeholder == .loading)
    #expect(search.presentation(for: "h").results.isEmpty)
  }

  @Test func clearingTheQueryDropsARequestStillInFlight() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    let task = start(search, "he", client: client)
    await transport.waitForRequest("he")
    await search.search(query: "", roomId: testRoomId, client: client, organizationSlug: nil)
    await transport.respond(to: "he", rows: ["late"])
    await task.value
    #expect(search.results.isEmpty && !search.isLoading)
    #expect(search.presentation(for: "").placeholder == .idle)
  }

  @Test func anotherRoomNeverShowsTheFirstRoomsResults() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "he", rows: ["a"])
    let task = Task { await search.search(query: "he", roomId: otherRoomId, client: client, organizationSlug: nil) }
    await transport.waitForRequest("he", count: 2)
    let switched = search.presentation(for: "he")
    #expect(switched.placeholder == .loading)
    #expect(switched.results.isEmpty && search.results.isEmpty && search.selectedId == nil)
    // Core answers for the asked room only; a row from elsewhere is dropped as before.
    await transport.respond(to: "he", rows: ["a"])
    await task.value
    #expect(search.results.isEmpty)
    #expect(search.presentation(for: "he").placeholder == .empty)
  }

  @Test func resetClearsResultsSelectionAndQuery() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "he", rows: ["a"])
    search.reset()
    #expect(search.results.isEmpty && search.selectedId == nil && search.query.isEmpty)
    // Reopening with the surviving query starts on the loading row, not on "no results".
    #expect(search.presentation(for: "he").placeholder == .loading)
  }

  @Test func anOlderResponseCannotOverwriteANewerOne() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "h", rows: ["kept"])
    // Neither task is cancelled: the transport ignores cancellation, so only the generation guards.
    let older = start(search, "old", client: client)
    await transport.waitForRequest("old")
    let newer = start(search, "new", client: client)
    await transport.waitForRequest("new")

    await transport.respond(to: "old", rows: ["stale"])
    await older.value
    #expect(search.results.map(\.id) == ["kept"], "A superseded answer neither replaces nor clears the hits.")
    #expect(search.isLoading, "The newer request is still out.")

    await transport.respond(to: "new", rows: ["fresh"])
    await newer.value
    #expect(search.results.map(\.id) == ["fresh"] && !search.isLoading)
    #expect(search.query == "new")
  }

  @Test func aSlowOlderResponseAfterTheNewerAnswerIsDropped() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    let older = start(search, "old", client: client)
    await transport.waitForRequest("old")
    let newer = start(search, "new", client: client)
    await transport.waitForRequest("new")
    await transport.respond(to: "new", rows: ["fresh"])
    await newer.value
    await transport.respond(to: "old", status: 500, body: #"{"error":"Internal","message":"Late failure"}"#)
    await older.value
    #expect(search.results.map(\.id) == ["fresh"])
    #expect(search.errorMessage == nil && !search.isLoading)
  }

  @Test func selectionStaysOnAStaleRowAndMovesToTheFirstHitOnReplace() async throws {
    let harness = try makeSearch()
    let search = harness.search, transport = harness.transport, client = harness.client
    try await answer(search, transport, client, query: "he", rows: ["a", "b", "c"])
    #expect(search.selectedId == "a", "Web resets the active index to 0 with each answer.")
    search.moveSelection(by: 1)
    search.moveSelection(by: 1)
    #expect(search.selectedId == "c")
    search.moveSelection(by: 1)
    #expect(search.selectedId == "a", "Down wraps from the last hit.")
    search.moveSelection(by: -1)
    #expect(search.selectedId == "c", "Up wraps from the first hit.")
    search.select("b")
    search.select("not-a-hit")
    #expect(search.selectedId == "b")

    let task = start(search, "hel", client: client)
    await transport.waitForRequest("hel")
    #expect(search.selectedId == "b", "Refining leaves the selection where it was.")
    #expect(search.selectedResult?.id == "b", "Return on a stale row still opens that message.")
    search.moveSelection(by: 1)
    #expect(search.selectedResult?.id == "c")

    await transport.respond(to: "hel", rows: ["c", "d"])
    await task.value
    #expect(search.selectedId == "c" && search.selectedResult?.id == "c")
    search.moveSelection(by: 1)
    #expect(search.selectedId == "d")
  }

  // MARK: - Helpers

  private struct Harness {
    let search: RoomSearch
    let transport: GatedSearchTransport
    let client: Client
  }

  private func makeSearch() throws -> Harness {
    let transport = GatedSearchTransport()
    let client = try Client.connecting(to: #require(URL(string: "https://core.example/v1")), transport: transport)
    return Harness(search: RoomSearch(debounce: .zero), transport: transport, client: client)
  }

  private func start(_ search: RoomSearch, _ query: String, client: Client) -> Task<Void, Never> {
    Task { await search.search(query: query, roomId: testRoomId, client: client, organizationSlug: nil) }
  }

  private func answer(_ search: RoomSearch, _ transport: GatedSearchTransport, _ client: Client,
                      query: String, rows: [String]) async throws {
    let task = start(search, query, client: client)
    await transport.waitForRequest(query)
    await transport.respond(to: query, rows: rows)
    await task.value
    try #require(search.results.map(\.id) == rows)
  }
}

/// Holds every search request until the test answers it by query, so answers can arrive in any order.
private actor GatedSearchTransport: ClientTransport {
  private var held: [String: [CheckedContinuation<(Int, String), Never>]] = [:]
  private var seen: [String: Int] = [:]
  private struct Observer {
    let query: String
    let count: Int
    let continuation: CheckedContinuation<Void, Never>
  }

  private var observers: [Observer] = []
  private(set) var requestedQueries: [String] = []

  func waitForRequest(_ query: String, count: Int = 1) async {
    if seen[query, default: 0] >= count {
      return
    }
    await withCheckedContinuation { observers.append(Observer(query: query, count: count, continuation: $0)) }
  }

  func respond(to query: String, rows: [String]) {
    let sender = testUserSender(name: "Ada", email: "ada@example.com")
    let messages = rows.map { testMessageJSON(id: $0, content: "Hit \($0)", sender: sender) }
    respond(to: query, status: 200, body: testMessagesPageBody(messages: messages, nextCursor: nil))
  }

  func respond(to query: String, status: Int, body: String) {
    guard var waiting = held[query], !waiting.isEmpty else {
      Issue.record("no held request for \(query)")
      return
    }
    waiting.removeFirst().resume(returning: (status, body))
    held[query] = waiting
  }

  func send(_ request: HTTPRequest, body _: HTTPBody?, baseURL _: URL, operationID _: String) async throws -> (HTTPResponse, HTTPBody?) {
    let items = URLComponents(string: "https://core.example\(request.path ?? "")")?.queryItems
    let query = items?.first { $0.name == "q" }?.value ?? ""
    let (status, body) = await withCheckedContinuation { continuation in
      held[query, default: []].append(continuation)
      requestedQueries.append(query)
      seen[query, default: 0] += 1
      let ready = observers.filter { $0.query == query && seen[query, default: 0] >= $0.count }
      observers.removeAll { $0.query == query && seen[query, default: 0] >= $0.count }
      ready.forEach { $0.continuation.resume() }
    }
    return (HTTPResponse(status: .init(code: status)), HTTPBody(body))
  }
}
