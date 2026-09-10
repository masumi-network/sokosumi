import Combine
import CoreAPI
import Foundation

/// Portable history state. The app composes read marking, authentication,
/// outbound sends and realtime delivery with this timeline.
@MainActor
public final class RoomTimeline: ObservableObject {
  public enum Page: Sendable { case initial, older, latest }

  @Published public private(set) var roomId: String?
  @Published public var messages: [Components.Schemas.ChatRoomMessage] = []
  @Published public private(set) var hasLoadedHistory = false
  @Published public private(set) var hasMore = false
  @Published public private(set) var isLoading = false
  @Published public private(set) var isLoadingOlder = false
  @Published public private(set) var isRefreshing = false
  @Published public var errorMessage: String?
  public private(set) var failedPage: Page?
  public private(set) var cursor: String?
  public private(set) var generation = 0

  private var activePage: Page?

  public init() {}

  public func reset(roomId: String? = nil) {
    generation += 1
    activePage = nil
    self.roomId = roomId
    messages = []
    hasLoadedHistory = false
    cursor = nil
    hasMore = false
    isLoading = roomId != nil
    isLoadingOlder = false
    isRefreshing = false
    errorMessage = nil
    failedPage = nil
  }

  /// Settle a queued initial load when authentication cannot supply a client.
  public func failInitialLoad(message: String, generation expectedGeneration: Int) {
    guard generation == expectedGeneration, activePage == nil else { return }
    isLoading = false
    errorMessage = message
    failedPage = .initial
  }

  /// Commit only to the room generation that requested this page. Merge
  /// by ID in chronological order, so overlapping pages cannot duplicate
  /// rows and a live message received during loading remains visible.
  @discardableResult
  public func loadPage(
    _ kind: Page,
    client: Client,
    organizationSlug: String?,
    generation expectedGeneration: Int
  ) async throws -> Bool {
    guard let roomId, generation == expectedGeneration, activePage == nil else { return false }
    let requestedCursor = kind == .older ? cursor : nil
    guard kind != .older || requestedCursor != nil else { return false }
    activePage = kind
    isLoading = kind == .initial
    isLoadingOlder = kind == .older
    isRefreshing = kind == .latest
    errorMessage = nil
    defer {
      if generation == expectedGeneration {
        activePage = nil
        isLoading = false
        isLoadingOlder = false
        isRefreshing = false
      }
    }
    guard !Task.isCancelled else { return false }
    let page: (messages: [Components.Schemas.ChatRoomMessage], nextCursor: String?)
    do {
      page = try await ChatService().listMessages(
        client: client,
        roomId: roomId,
        cursor: requestedCursor,
        organizationSlug: organizationSlug
      )
    } catch {
      if generation == expectedGeneration, !Task.isCancelled {
        failedPage = kind
        errorMessage = friendlyMessage(for: error)
      }
      throw error
    }
    guard generation == expectedGeneration, !Task.isCancelled else { return false }
    if kind == .initial {
      hasLoadedHistory = true
    }
    messages = mergeRealtimePage(messages: messages, page: page.messages)
    if kind != .latest {
      cursor = page.nextCursor == requestedCursor ? nil : page.nextCursor
      hasMore = cursor != nil
    }
    errorMessage = nil
    failedPage = nil
    return true
  }
}

/// Reader intent, independent of scroll-view APIs. Content growth must not
/// unpin a reader who was already following the latest message.
public struct TimelineScrollIntent: Equatable, Sendable {
  public private(set) var followsLatest = true

  public init() {}

  public mutating func userScrolled(distanceFromBottom: Double) {
    followsLatest = distanceFromBottom < 200
  }

  public mutating func beginAutomaticOlderPage(userIsScrolling: Bool, isNearTop: Bool, hasMore: Bool, isLoading: Bool) -> Bool {
    guard userIsScrolling, isNearTop, hasMore, !isLoading else { return false }
    readOlder()
    return true
  }

  public mutating func readOlder() {
    followsLatest = false
  }

  public mutating func followLatest() {
    followsLatest = true
  }
}
