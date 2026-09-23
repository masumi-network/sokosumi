import Combine
import CoreAPI
import Foundation

/// What the search panel draws for the query currently in the field.
public struct RoomSearchPresentation {
  public enum Placeholder: Equatable, Sendable {
    case idle
    case loading
    case empty
    case failed(String)
  }

  /// The single status row above the hits, or nil when the hits speak for themselves.
  public let placeholder: Placeholder?
  public let results: [Components.Schemas.ChatRoomMessage]
  /// The hits answer an earlier query while the one in the field is still debouncing or in flight.
  public let isRefining: Bool
}

/// Room-scoped search results, separate from loaded transcript history.
/// Cancellation and generation checks prevent a dismissed or superseded query
/// from publishing late results, including transports that ignore cancellation.
@MainActor
public final class RoomSearch: ObservableObject {
  @Published public private(set) var query = ""
  @Published public private(set) var results: [Components.Schemas.ChatRoomMessage] = []
  @Published public private(set) var selectedId: String?
  @Published public private(set) var isLoading = false
  @Published public private(set) var failure: (any Error)?
  public var errorMessage: String? {
    failure.map { friendlyMessage(for: $0) }
  }

  public var selectedResult: Components.Schemas.ChatRoomMessage? {
    results.first { $0.id == selectedId }
  }

  private let debounce: Duration
  private var generation = 0
  private var resultsRoomId: String?

  public init(debounce: Duration = .milliseconds(250)) {
    self.debounce = debounce
  }

  public func reset() {
    generation += 1
    query = ""
    results = []
    selectedId = nil
    failure = nil
    isLoading = false
    resultsRoomId = nil
  }

  public func fail(_ error: any Error, query: String) {
    reset()
    self.query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    failure = error
  }

  public func select(_ id: String) {
    guard results.contains(where: { $0.id == id }) else { return }
    selectedId = id
  }

  public func moveSelection(by direction: Int) {
    guard !results.isEmpty else { return }
    let index = results.firstIndex { $0.id == selectedId } ?? (direction > 0 ? -1 : 0)
    selectedId = results[(index + direction + results.count) % results.count].id
  }

  /// Mirrors web's panel: hits stay until the next answer, and a status row shows only when there are none.
  public func presentation(for liveQuery: String) -> RoomSearchPresentation {
    let liveQuery = liveQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    // Web empties the list in the same keystroke that empties the field.
    guard !liveQuery.isEmpty else { return RoomSearchPresentation(placeholder: .idle, results: [], isRefining: false) }
    let isBusy = isLoading || liveQuery != query
    guard results.isEmpty else { return RoomSearchPresentation(placeholder: nil, results: results, isRefining: isBusy) }
    let placeholder: RoomSearchPresentation.Placeholder = if isBusy {
      .loading
    } else if let errorMessage {
      .failed(errorMessage)
    } else {
      .empty
    }
    return RoomSearchPresentation(placeholder: placeholder, results: [], isRefining: false)
  }

  public func search(query: String, roomId: String, client: Client, organizationSlug: String?) async {
    guard !Task.isCancelled else { return }
    // Supersede whatever is out before anything can suspend; the hits stay until this query is answered.
    generation += 1
    let requestGeneration = generation
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    self.query = query
    failure = nil
    if query.isEmpty || roomId != resultsRoomId {
      results = []
      selectedId = nil
    }
    resultsRoomId = roomId
    guard !query.isEmpty else {
      isLoading = false
      return
    }
    isLoading = true
    defer {
      if generation == requestGeneration {
        isLoading = false
      }
    }
    do {
      try await Task.sleep(for: debounce)
      guard generation == requestGeneration, !Task.isCancelled else { return }
      let page = try await ChatService().listMessages(
        client: client, roomId: roomId, limit: 50, query: query, organizationSlug: organizationSlug
      )
      guard generation == requestGeneration, !Task.isCancelled else { return }
      results = page.messages.filter { $0.roomId == roomId }
      selectedId = results.first?.id
    } catch {
      guard generation == requestGeneration, !Task.isCancelled else { return }
      results = []
      selectedId = nil
      failure = error
    }
  }
}
