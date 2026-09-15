import Combine
import CoreAPI
import Foundation

/// Room-scoped search results, separate from loaded transcript history.
/// Cancellation and generation checks prevent a dismissed or superseded query
/// from publishing late results, including transports that ignore cancellation.
@MainActor
public final class RoomSearch: ObservableObject {
  @Published public private(set) var query = ""
  @Published public private(set) var results: [Components.Schemas.ChatRoomMessage] = []
  @Published public private(set) var isLoading = false
  @Published public private(set) var failure: (any Error)?
  public var errorMessage: String? {
    failure.map { friendlyMessage(for: $0) }
  }

  private var generation = 0

  public init() {}

  public func reset() {
    generation += 1
    query = ""
    results = []
    failure = nil
    isLoading = false
  }

  public func fail(_ error: any Error, query: String) {
    reset()
    self.query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    failure = error
  }

  public func search(query: String, roomId: String, client: Client, organizationSlug: String?) async {
    guard !Task.isCancelled else { return }
    reset()
    let query = query.trimmingCharacters(in: .whitespacesAndNewlines)
    self.query = query
    guard !query.isEmpty else { return }
    let requestGeneration = generation
    isLoading = true
    defer {
      if generation == requestGeneration {
        isLoading = false
      }
    }
    do {
      try await Task.sleep(for: .milliseconds(250))
      guard generation == requestGeneration, !Task.isCancelled else { return }
      let page = try await ChatService().listMessages(
        client: client, roomId: roomId, limit: 50, query: query, organizationSlug: organizationSlug
      )
      guard generation == requestGeneration, !Task.isCancelled else { return }
      results = page.messages.filter { $0.roomId == roomId }
    } catch {
      guard generation == requestGeneration, !Task.isCancelled else { return }
      failure = error
    }
  }
}
