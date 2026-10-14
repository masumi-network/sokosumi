import Combine
import CoreAPI
import Foundation

/// The selected room's thread list. Merely loading the overview never marks it read.
///
/// Paging and failures follow web's `ThreadListPanel` (row 24e): the first page is `isLoading`, an older page
/// is the paging row's own `olderPageStatus`. A failed first page clears the list and says why in
/// `failureMessage`; a failed Mark all keeps the rows under that message; a failed older page stays on the
/// paging row, which stops loading by itself until the reader retries.
@MainActor
public final class RoomThreadOverview: ObservableObject {
  /// The room's Threads and the paging around them.
  @Published private(set) var pages = CursorPages<Components.Schemas.ChatRoomThread>()
  @Published public private(set) var previews: [String: String] = [:]
  /// Web's `useUnreadThreadReplyCounts`: unread replies per Thread in the room, keyed by parent message id,
  /// nil until the room's own first read lands. One read feeds the Threads trigger (its size) and every
  /// reply bar in the transcript (row 24h), so the two cannot disagree (SOK-1151).
  @Published public private(set) var unreadReplyCounts: [String: Int]?
  @Published public private(set) var isMarkingRead = false
  /// The list's own error, web's `error`: a failed first page or Mark all, never an older page.
  @Published public private(set) var failureMessage: String?
  private var generation = 0
  private var countGeneration = 0

  public init() {}

  public var items: [Components.Schemas.ChatRoomThread] {
    pages.items
  }

  public var nextCursor: String? {
    pages.nextCursor
  }

  /// The first page is loading: on open, after Back from a thread and after Mark all.
  public var isLoading: Bool {
    pages.isLoadingFirstPage
  }

  /// The paging row after the last thread, web's `ThreadListLoadMore` status.
  public var olderPageStatus: PageBoundaryStatus {
    pages.olderPageStatus
  }

  /// The Threads trigger's number: how many Threads are unread.
  public var unreadCount: Int {
    unreadReplyCounts?.count ?? 0
  }

  /// Web's `onAllThreadsLooked(stillUnreadParentIds)`: the loaded muted Threads still unread. Mark all skips
  /// a muted thread even when a mention in it is unread (SOK-1087), so its reply bar stays.
  public var mutedUnreadParentIds: Set<String> {
    Set(items.filter { $0.mutedAt != nil && RoomThreadOverviewGroups.isUnread($0) }.map(\.parentMessage.id))
  }

  /// The loaded threads under Unread and Earlier.
  public var groups: RoomThreadOverviewGroups {
    RoomThreadOverviewGroups(threads: items)
  }

  /// The paging row asks for the next page by itself once it is in view (web's `useLoadWhenVisible`), armed
  /// only while it is idle: never while a page or Mark all runs, and after a failure not until the reader
  /// retries.
  public var loadsOlderAutomatically: Bool {
    pages.loadsOlderAutomatically && !isMarkingRead
  }

  public func reset() {
    generation += 1
    countGeneration += 1
    pages.reset()
    previews = [:]
    unreadReplyCounts = nil
    isMarkingRead = false
    failureMessage = nil
  }

  /// Reads the room's unread Threads again. A failed read keeps the last answer: the counts are decoration.
  public func refreshCount(client: Client, roomId: String, organizationSlug: String?) async throws {
    countGeneration += 1
    let request = countGeneration
    let counts = try await ChatService().listUnreadThreadReplyCounts(client: client, roomId: roomId, organizationSlug: organizationSlug)
    guard request == countGeneration, !Task.isCancelled else { return }
    unreadReplyCounts = counts
  }

  /// Web's `clear`: drops the Threads the reader just Looked at or marked read, so the trigger and the bars
  /// settle at once instead of after the re-read, and discards a read already in flight.
  public func clearUnreadReplies(where isCleared: (String) -> Bool) {
    countGeneration += 1
    guard let counts = unreadReplyCounts else { return }
    let kept = counts.filter { !isCleared($0.key) }
    if kept.count != counts.count {
      unreadReplyCounts = kept
    }
  }

  public func load(client: Client, roomId: String, organizationSlug: String?, older: Bool = false, mentions: MessageMentions? = nil) async throws {
    guard !isMarkingRead else { return }
    try await loadPage(client: client, roomId: roomId, organizationSlug: organizationSlug, older: older, mentions: mentions)
  }

  private func loadPage(client: Client, roomId: String, organizationSlug: String?, older: Bool = false, mentions: MessageMentions? = nil) async throws {
    guard !Task.isCancelled, let request = pages.begin(older: older) else { return }
    if !older {
      // Web's `loadFirstPage`: supersedes an older page in flight and forgets a failed one.
      failureMessage = nil
    }
    defer { pages.settle(request) }
    do {
      let page = try await ChatService().listThreads(client: client, roomId: roomId, cursor: request.cursor, organizationSlug: organizationSlug)
      guard pages.isCurrent(request), !Task.isCancelled else { return }
      var seen = Set<String>()
      let incoming = page.items.filter { $0.parentMessage.roomId == roomId && seen.insert($0.parentMessage.id).inserted }
      let labels = await Task.detached {
        let names = mentions?.previewNames ?? [:]
        return Dictionary(uniqueKeysWithValues: incoming.map { item in
          (item.parentMessage.id, ChatMessagePreview.text(item.parentMessage.content, names: names))
        })
      }.value
      guard pages.isCurrent(request), !Task.isCancelled else { return }
      if older {
        previews.merge(labels) { _, new in new }
      } else {
        previews = labels
      }
      pages.answer(request, items: incoming, nextCursor: page.nextCursor, id: \.parentMessage.id)
    } catch {
      guard pages.isCurrent(request), !Task.isCancelled else { return }
      pageFailed(request, error: error)
      throw error
    }
  }

  /// A failed older page stays on the paging row with the rows kept; a failed first page clears the list,
  /// its headings, Mark all and the paging row, and says why.
  private func pageFailed(_ request: CursorPages<Components.Schemas.ChatRoomThread>.Request, error: any Error) {
    pages.fail(request)
    guard !request.older else { return }
    previews = [:]
    failureMessage = Self.message(for: error, fallback: "Could not load threads. Try again.")
  }

  /// Once Core accepted, `looked` tells the room before the first page reloads, as web's
  /// `onAllThreadsLooked`: the room drops every Thread but `mutedUnreadParentIds` from the counts (row 24h),
  /// re-counts the Threads trigger and posts its read. Mark all skips a muted thread with an unread mention.
  public func markAllRead(client: Client, roomId: String, organizationSlug: String?, mentions: MessageMentions? = nil,
                          looked: () async -> Void) async throws {
    guard !isMarkingRead, !isLoading, olderPageStatus != .loading, !Task.isCancelled else { return }
    let request = generation
    isMarkingRead = true
    failureMessage = nil
    defer {
      if request == generation {
        isMarkingRead = false
      }
    }
    do {
      try await ChatService().markAllThreadsRead(client: client, roomId: roomId, organizationSlug: organizationSlug)
      guard request == generation, !Task.isCancelled else { return }
      countGeneration += 1
      await looked()
      guard request == generation, !Task.isCancelled else { return }
    } catch {
      guard request == generation, !Task.isCancelled else { return }
      failureMessage = Self.message(for: error, fallback: "Could not mark unread threads as read. Try again.")
      throw error
    }
    // A failed reload is a failed first page: it clears the list with its own message.
    try await loadPage(client: client, roomId: roomId, organizationSlug: organizationSlug, mentions: mentions)
  }

  /// Web shows Core's message when Core sent one (`actionErrorMessage`) and its own copy otherwise.
  private static func message(for error: any Error, fallback: String) -> String {
    if case let .unprocessable(_, message, _) = error as? ChatServiceError, !message.isEmpty {
      return message
    }
    return fallback
  }
}
