import Combine
import CoreAPI
import Foundation

@MainActor
public final class ChannelBrowser: ObservableObject {
  @Published public var query = ""
  @Published public private(set) var rooms: [Components.Schemas.DiscoverableChatRoom] = []
  @Published public private(set) var loading = false
  @Published public private(set) var joiningRoomId: String?
  @Published public private(set) var loadError: String?
  @Published public private(set) var joinError: String?
  private var generation = 0

  public init() {}

  public func search(using fetch: (String) async throws -> [Components.Schemas.DiscoverableChatRoom]) async {
    generation += 1
    let attempt = generation
    let searchQuery = query
    loading = true
    loadError = nil
    defer {
      if attempt == generation {
        loading = false
      }
    }
    do {
      let result = try await fetch(searchQuery)
      guard attempt == generation, searchQuery == query, !Task.isCancelled else { return }
      rooms = result
    } catch {
      guard attempt == generation, searchQuery == query, !Task.isCancelled, !(error is CancellationError) else { return }
      rooms = []
      loadError = friendlyMessage(for: error)
    }
  }

  public func join(roomId: String, using join: (String) async throws -> Bool) async -> Bool {
    guard joiningRoomId == nil else { return false }
    joiningRoomId = roomId
    joinError = nil
    defer { joiningRoomId = nil }
    do {
      return try await join(roomId)
    } catch {
      guard !Task.isCancelled, !(error is CancellationError) else { return false }
      joinError = friendlyMessage(for: error)
      return false
    }
  }
}
