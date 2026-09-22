import Combine
import CoreAPI
import Foundation

/// Portable history state. The app composes read marking, authentication,
/// outbound sends and realtime delivery with this timeline.
@MainActor
public final class RoomTimeline: ObservableObject {
  public enum Page: Equatable, Sendable { case initial, older, latest, around(String), boundary(String), returnToLatest }

  @Published public private(set) var roomId: String?
  @Published public private(set) var parentMessageId: String?
  @Published public var messages: [Components.Schemas.ChatRoomMessage] = []
  @Published public private(set) var pinOverrides: [String: Bool] = [:]
  @Published public private(set) var hasLoadedHistory = false
  @Published public private(set) var hasMore = false
  @Published public private(set) var isLoading = false
  @Published public private(set) var isLoadingOlder = false
  @Published public private(set) var isRefreshing = false
  @Published public var errorMessage: String?
  public private(set) var failedPage: Page?
  public private(set) var cursor: String?
  public private(set) var generation = 0

  @Published public private(set) var historicalAnchor: String?
  /// Per gap row (row 04a). Visibility and taps come from the caller; the
  /// page outcome settles it here, so the row is the only place a gap failure shows.
  @Published public var boundaryLoads = TranscriptBoundaryLoads()

  private var activePage: Page?
  private var historyRanges = RoomHistoryRanges()

  public var historyGapMessageIds: Set<String> {
    historyRanges.gaps(in: messages)
  }

  /// The row above the oldest loaded range (web's boundary with `isGap: false`).
  /// Its failure stays a transcript error too: that keeps the automatic older
  /// load off until the reader asks again.
  public var oldestBoundaryStatus: TranscriptBoundaryStatus {
    if isLoadingOlder {
      return .loading
    }
    return failedPage == .older ? .failed : .idle
  }

  public func followLatest() {
    historicalAnchor = nil
  }

  public init() {}

  public func reset(roomId: String? = nil, parentMessageId: String? = nil) {
    generation += 1
    activePage = nil
    historyRanges = RoomHistoryRanges()
    historicalAnchor = nil
    boundaryLoads = TranscriptBoundaryLoads()
    self.roomId = roomId
    self.parentMessageId = parentMessageId
    messages = []
    pinOverrides = [:]
    hasLoadedHistory = false
    cursor = nil
    hasMore = false
    isLoading = roomId != nil
    isLoadingOlder = false
    isRefreshing = false
    errorMessage = nil
    failedPage = nil
  }

  public func applyPin(roomId: String, messageId: String, isPinned: Bool) {
    guard self.roomId == roomId else { return }
    pinOverrides[messageId] = isPinned
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
    let requestedCursor: String? = if case let .boundary(id) = kind {
      id
    } else {
      kind == .older ? cursor : nil
    }
    guard kind != .older || requestedCursor != nil else { return false }
    beginPage(kind)
    defer {
      if generation == expectedGeneration {
        activePage = nil
        isLoading = false
        isLoadingOlder = false
        isRefreshing = false
      }
    }
    guard !Task.isCancelled else {
      abandonBoundary(kind)
      return false
    }
    do {
      let page = try await fetchPage(kind, client: client, roomId: roomId, cursor: requestedCursor, organizationSlug: organizationSlug)
      guard generation == expectedGeneration, !Task.isCancelled else {
        if generation == expectedGeneration {
          abandonBoundary(kind)
        }
        return false
      }
      try applyPage(page, kind: kind, roomId: roomId, requestedCursor: requestedCursor)
      settleBoundary(kind, succeeded: true)
      return true
    } catch {
      if generation == expectedGeneration, !Task.isCancelled {
        recordFailure(error, kind: kind)
      }
      throw error
    }
  }

  private func beginPage(_ kind: Page) {
    activePage = kind
    isLoading = kind == .initial
    isLoadingOlder = kind == .older
    isRefreshing = kind != .initial && kind != .older
    errorMessage = nil
    if case let .boundary(cursorMessageId) = kind {
      boundaryLoads.begin(cursorMessageId)
    }
  }

  /// Web keeps a gap's failure on its row (`boundaryStatus`), not in a toast;
  /// here a transcript error would show a banner and an alert.
  private func recordFailure(_ error: Error, kind: Page) {
    if case .boundary = kind {
      settleBoundary(kind, succeeded: false)
    } else {
      failedPage = kind
      errorMessage = friendlyMessage(for: error)
    }
  }

  private func settleBoundary(_ kind: Page, succeeded: Bool) {
    if case let .boundary(cursorMessageId) = kind {
      boundaryLoads.settle(cursorMessageId, succeeded: succeeded)
    }
  }

  /// The request never ran (cancelled): the row goes back to a tap.
  private func abandonBoundary(_ kind: Page) {
    if case let .boundary(cursorMessageId) = kind {
      boundaryLoads.release(cursorMessageId)
    }
  }

  private func applyPage(
    _ page: (messages: [Components.Schemas.ChatRoomMessage], nextCursor: String?),
    kind: Page, roomId: String, requestedCursor: String?
  ) throws {
    let rows = page.messages.filter { $0.roomId == roomId && $0.parentMessageId == parentMessageId }
    if case let .around(messageId) = kind {
      guard rows.contains(where: { $0.id == messageId }) else {
        throw ChatServiceError.unprocessable(statusCode: 404, message: "This message is no longer available.")
      }
      historicalAnchor = messageId
    } else if kind == .returnToLatest {
      historicalAnchor = nil
    }
    let nextCursor = page.nextCursor == requestedCursor ? nil : page.nextCursor
    mergeHistory(rows, kind: kind, requestedCursor: requestedCursor, nextCursor: nextCursor)
    messages = mergeRealtimePage(messages: messages, page: rows)
    boundaryLoads.retain(historyGapMessageIds)
    hasLoadedHistory = true
    hasMore = cursor != nil
    errorMessage = nil
    failedPage = nil
  }

  private func mergeHistory(_ rows: [Components.Schemas.ChatRoomMessage], kind: Page,
                            requestedCursor: String?, nextCursor: String?) {
    var contiguousRows = rows
    if let requestedCursor, let cursorRow = messages.first(where: { $0.id == requestedCursor }),
       !rows.contains(where: { $0.id == requestedCursor }) {
      contiguousRows.append(cursorRow)
    }
    // Ordinary older loads are contiguous with the oldest range, even when
    // a server cursor is opaque rather than the boundary message ID.
    if kind == .older, let first = messages.first, !contiguousRows.contains(where: { $0.id == first.id }) {
      contiguousRows.append(first)
    }
    // A refresh overlapping the oldest loaded row must not replace the
    // cursor belonging to its original page with the refresh page's cursor.
    let mergedCursor = kind == .latest && rows.contains(where: { $0.id == messages.first?.id }) ? cursor : nextCursor
    historyRanges.merge(existing: messages, page: contiguousRows, nextCursor: mergedCursor,
                        reachesPresent: kind == .initial || kind == .latest || kind == .returnToLatest)
    cursor = historyRanges.oldestCursor
  }

  private func fetchPage(
    _ kind: Page, client: Client, roomId: String, cursor: String?, organizationSlug: String?
  ) async throws -> (messages: [Components.Schemas.ChatRoomMessage], nextCursor: String?) {
    let around: String? = if case let .around(messageId) = kind {
      messageId
    } else {
      nil
    }
    if let parentMessageId {
      return try await ChatService().listThreadMessages(
        client: client, roomId: roomId, parentMessageId: parentMessageId,
        cursor: cursor, around: around, organizationSlug: organizationSlug
      )
    }
    return try await ChatService().listMessages(
      client: client, roomId: roomId, cursor: cursor, around: around, limit: around != nil || cursor != nil ? 30 : nil, organizationSlug: organizationSlug
    )
  }
}

/// Reader intent, independent of scroll-view APIs. Content growth must not
/// unpin a reader who was already following the latest message.
public struct TimelineScrollIntent: Equatable, Sendable {
  public private(set) var followsLatest = true

  public init() {}

  public mutating func userScrolled(isNearBottom: Bool) {
    followsLatest = isNearBottom
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
