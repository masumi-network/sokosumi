import Combine
import CoreAPI
import Foundation

/// The two lists of the chat-level Threads view.
public enum CrossRoomThreadList: Sendable {
  case unread, earlier
}

/// What the Threads view's Unread group shows, in web's order of precedence (`UnreadThreadsList`).
public enum UnreadThreadsState: Equatable, Sendable {
  /// "All caught up": the live rooms count no unread Thread, or Core's own empty answer says so.
  case caughtUp
  /// The first page failed and no row is held: the error with Try again.
  case failed
  /// Nothing has answered yet: a spinner.
  case loading
  /// The rows, and the paging row while Core has more.
  case rows
}

/// The chat-level Threads view's data (row 24f1; web `UnreadThreadsView`, `UnreadThreadsList` and
/// `EarlierThreadsList`, SOK-1159): the reader's unread Threads across the workspace's rooms, newest unread
/// reply first, and their read Threads, newest reply first, each list paged on its own.
///
/// Each list follows web's `useInfiniteQuery` with `keepPreviousData`: reading the first page again keeps the
/// rows on screen until Core answers; a failed first page leaves none and says so; a failed next page stays on
/// the paging row with the rows kept and waits for the reader. Rows are shown only while their room is listed
/// and not muted (`unreadRows(rooms:)`), since the page may predate a mute or a leave. Loading never marks
/// anything read; opening a row does, through the thread's own Look.
@MainActor
public final class CrossRoomThreads: ObservableObject {
  /// One list's pages.
  public struct Pages<Thread: Hashable & Sendable>: Equatable, Sendable {
    public fileprivate(set) var threads: [Thread] = []
    public fileprivate(set) var nextCursor: String?
    /// A first page answered and none failed since: web's `isSuccess`.
    public fileprivate(set) var hasAnswered = false
    public fileprivate(set) var isLoadingFirstPage = false
    /// The last first page failed: web's `isError` with no data.
    public fileprivate(set) var firstPageFailed = false
    /// The paging row after the last row, web's `ThreadListLoadMore` status.
    public fileprivate(set) var olderPageStatus: PageBoundaryStatus = .idle
    fileprivate var generation = 0

    /// Web's `useLoadWhenVisible` arming: the paging row asks by itself only while idle, never during a
    /// first page, and after a failure not until the reader retries.
    public var loadsOlderAutomatically: Bool {
      nextCursor != nil && olderPageStatus == .idle && !isLoadingFirstPage
    }
  }

  @Published public private(set) var unread = Pages<Components.Schemas.ChatUnreadThread>()
  @Published public private(set) var earlier = Pages<Components.Schemas.ChatEarlierThread>()
  /// Each Thread's name from its parent, keyed by parent message id.
  @Published public private(set) var labels: [String: String] = [:]
  /// The workspace the lists answer. Another one starts both lists empty.
  private var scope: String?

  public init() {}

  public func reset() {
    unread = Pages(generation: unread.generation + 1)
    earlier = Pages(generation: earlier.generation + 1)
    labels = [:]
    scope = nil
  }

  /// Reads a list's first page, or its next page when `older`. The rooms name each parent's mentions.
  public func load(
    _ list: CrossRoomThreadList,
    older: Bool = false,
    rooms: [Components.Schemas.ChatRoom],
    scope: String?,
    client: Client,
    organizationSlug: String?
  ) async throws {
    if scope != self.scope {
      reset()
      self.scope = scope
    }
    switch list {
    case .unread:
      try await loadPage(\.unread, older: older, rooms: rooms, parts: .init(parent: \.parentMessageId, content: \.parentContent, room: \.roomId)) { cursor in
        try await ChatService().listUnreadThreads(client: client, cursor: cursor, organizationSlug: organizationSlug)
      }
    case .earlier:
      try await loadPage(\.earlier, older: older, rooms: rooms, parts: .init(parent: \.parentMessageId, content: \.parentContent, room: \.roomId)) { cursor in
        try await ChatService().listEarlierThreads(client: client, cursor: cursor, organizationSlug: organizationSlug)
      }
    }
  }

  /// What a list's thread is made of, for its row label.
  private struct Parts<Thread> {
    let parent: KeyPath<Thread, String>
    let content: KeyPath<Thread, String>
    let room: KeyPath<Thread, String>
  }

  private func loadPage<Thread: Hashable & Sendable>(
    _ pages: ReferenceWritableKeyPath<CrossRoomThreads, Pages<Thread>>,
    older: Bool,
    rooms: [Components.Schemas.ChatRoom],
    parts: Parts<Thread>,
    fetch: (String?) async throws -> (items: [Thread], nextCursor: String?)
  ) async throws {
    guard let (request, cursor) = begin(pages, older: older) else { return }
    defer { settle(pages, request: request) }
    do {
      let page = try await fetch(cursor)
      guard self[keyPath: pages].generation == request, !Task.isCancelled else { return }
      let previews = await Self.previews(of: page.items, rooms: rooms, parts: parts)
      guard self[keyPath: pages].generation == request, !Task.isCancelled else { return }
      labels.merge(previews) { _, new in new }
      var answered = self[keyPath: pages]
      answered.threads = older ? answered.threads + page.items : page.items
      answered.nextCursor = page.nextCursor == cursor ? nil : page.nextCursor
      answered.hasAnswered = true
      answered.firstPageFailed = false
      self[keyPath: pages] = answered
    } catch {
      guard self[keyPath: pages].generation == request, !Task.isCancelled else { return }
      if older {
        self[keyPath: pages].olderPageStatus = .failed
      } else {
        // Web's query without data: no rows, no paging row, the error with Try again.
        var failed = self[keyPath: pages]
        failed.threads = []
        failed.nextCursor = nil
        failed.hasAnswered = false
        failed.firstPageFailed = true
        self[keyPath: pages] = failed
      }
      throw error
    }
  }

  /// Starts a page, or nil when an older page cannot start now. A first page supersedes an older page in
  /// flight and forgets a failed one.
  private func begin(_ pages: ReferenceWritableKeyPath<CrossRoomThreads, Pages<some Any>>, older: Bool) -> (Int, String?)? {
    let current = self[keyPath: pages]
    if older, current.nextCursor == nil || current.isLoadingFirstPage || current.olderPageStatus == .loading {
      return nil
    }
    guard !Task.isCancelled else { return nil }
    self[keyPath: pages].generation += 1
    if older {
      self[keyPath: pages].olderPageStatus = .loading
    } else {
      self[keyPath: pages].isLoadingFirstPage = true
      self[keyPath: pages].olderPageStatus = .idle
    }
    return (self[keyPath: pages].generation, older ? current.nextCursor : nil)
  }

  private func settle(_ pages: ReferenceWritableKeyPath<CrossRoomThreads, Pages<some Any>>, request: Int) {
    guard self[keyPath: pages].generation == request else { return }
    self[keyPath: pages].isLoadingFirstPage = false
    if self[keyPath: pages].olderPageStatus == .loading {
      self[keyPath: pages].olderPageStatus = .idle
    }
  }

  /// Each parent's preview with its own room's mention names, off the main actor.
  private static func previews<Thread>(of threads: [Thread], rooms: [Components.Schemas.ChatRoom], parts: Parts<Thread>) async -> [String: String] {
    let names = Dictionary(rooms.map { ($0.id, MessageMentions(room: $0).previewNames) }) { first, _ in first }
    let incoming = threads.map { (id: $0[keyPath: parts.parent], content: $0[keyPath: parts.content], names: names[$0[keyPath: parts.room]] ?? [:]) }
    return await Task.detached {
      Dictionary(incoming.map { ($0.id, ChatMessagePreview.text($0.content, names: $0.names)) }) { first, _ in first }
    }.value
  }

  /// Web's `useThreadRowNames`: the parent's preview with its room's mention names, or "Thread".
  public func label(for parentMessageId: String) -> String {
    guard let label = labels[parentMessageId], !label.isEmpty else { return "Thread" }
    return label
  }

  /// The unread Threads to list: only those whose room the sidebar lists and the reader has not muted, each
  /// once, in Core's order.
  public func unreadRows(rooms: [Components.Schemas.ChatRoom]) -> [Components.Schemas.ChatUnreadThread] {
    Self.listed(unread.threads, rooms: rooms, parent: \.parentMessageId, room: \.roomId)
  }

  /// The read Threads to list, by the same rule.
  public func earlierRows(rooms: [Components.Schemas.ChatRoom]) -> [Components.Schemas.ChatEarlierThread] {
    Self.listed(earlier.threads, rooms: rooms, parent: \.parentMessageId, room: \.roomId)
  }

  private static func listed<Thread>(
    _ threads: [Thread],
    rooms: [Components.Schemas.ChatRoom],
    parent: KeyPath<Thread, String>,
    room: KeyPath<Thread, String>
  ) -> [Thread] {
    let listedRooms = Set(rooms.filter { $0.mutedAt == nil }.map(\.id))
    var seen = Set<String>()
    return threads.filter { listedRooms.contains($0[keyPath: room]) && seen.insert($0[keyPath: parent]).inserted }
  }

  /// Web's `enabled`: live rooms at zero already answer, so Core is not asked; an empty roster that is not a
  /// live answer yet is a gap, so the list waits for it.
  public static func shouldLoadUnread(rooms: [Components.Schemas.ChatRoom], roomsLive: Bool) -> Bool {
    let roomsSayCaughtUp = roomsLive && resolveUnreadThreadsAttention(rooms).threadCount == 0
    let waitingForRooms = !roomsLive && rooms.isEmpty
    return !roomsSayCaughtUp && !waitingForRooms
  }

  public func unreadState(rooms: [Components.Schemas.ChatRoom], roomsLive: Bool) -> UnreadThreadsState {
    let rows = unreadRows(rooms: rooms)
    // The rooms are the faster signal: the group drains the moment their count does.
    if roomsLive, resolveUnreadThreadsAttention(rooms).threadCount == 0 {
      return .caughtUp
    }
    // Core's own empty answer; a page whose rows were all dropped says nothing while another follows.
    if unread.hasAnswered, rows.isEmpty, unread.nextCursor == nil, unread.threads.isEmpty || !rooms.isEmpty {
      return .caughtUp
    }
    if unread.firstPageFailed, rows.isEmpty {
      return .failed
    }
    return unread.hasAnswered ? .rows : .loading
  }

  /// Web's `EarlierThreadsList` renders nothing, heading included, while its first read is out and while it
  /// holds no row, so no heading flashes over a spinner for a reader with no read Thread.
  public func showsEarlier(rooms: [Components.Schemas.ChatRoom]) -> Bool {
    if earlier.firstPageFailed {
      return true
    }
    return earlier.hasAnswered && !earlierRows(rooms: rooms).isEmpty
  }
}

/// The Threads entry's attention, web's `resolveUnreadThreadsAttention` (SOK-1159): every unread Thread across
/// the reader's rooms, counted from the rooms alone.
public struct UnreadThreadsAttention: Equatable, Sendable {
  /// Threads, not replies, so it agrees with each room's `unreadThreadCount`.
  public let threadCount: Int
  /// Unread replies naming the reader across those Threads.
  public let mentionCount: Int

  public init(threadCount: Int, mentionCount: Int) {
    self.threadCount = threadCount
    self.mentionCount = mentionCount
  }

  /// Web's spoken form (`UnreadNav.mentions`, `unreadThreads`, `unreadThreadsCapped`); empty at zero.
  public var accessibilityLabel: String {
    guard threadCount > 0 else { return "" }
    let threads = threadCount > roomCountCap
      ? "More than \(roomCountCap) unread threads"
      : threadCount == 1 ? "1 unread thread" : "\(threadCount) unread threads"
    guard mentionCount > 0 else { return threads }
    return "\(mentionCount == 1 ? "1 mention" : "\(mentionCount) mentions"), \(threads)"
  }
}

/// A muted room lists no Thread in the sidebar, so it adds none here. A room snapshot from before Core counted
/// past the listed cap falls back to its listed Threads.
public func resolveUnreadThreadsAttention(_ rooms: [Components.Schemas.ChatRoom]) -> UnreadThreadsAttention {
  var threadCount = 0
  var mentionCount = 0
  for room in rooms where room.mutedAt == nil {
    let listed = room.unreadThreads ?? []
    threadCount += room.unreadThreadCount ?? listed.count
    mentionCount += room.unreadThreadMentionCount ?? listed.reduce(0) { $0 + ($1.unreadMentionCount ?? 0) }
  }
  return .init(threadCount: threadCount, mentionCount: mentionCount)
}

/// Web's `unreadThreadsFingerprint`: what the rooms say about their unread Threads, as one string. It moves
/// exactly when a Thread is read, muted or gains a reply, so the Unread list reads Core again then and not on
/// every message.
public func unreadThreadsFingerprint(_ rooms: [Components.Schemas.ChatRoom]) -> String {
  rooms.filter { $0.mutedAt == nil }.map { room in
    ([room.id, String(room.threadUnreadCount ?? 0), String(room.unreadThreadCount ?? 0)]
      + (room.unreadThreads ?? []).map { "\($0.parentMessageId)/\($0.unreadReplyCount)" }).joined(separator: ":")
  }.joined(separator: ",")
}

/// Web's `earlierThreadsFingerprint`: the unread one plus each room's last activity, since a reply that changes
/// no count (the reader's own) still reorders the read Threads.
public func earlierThreadsFingerprint(_ rooms: [Components.Schemas.ChatRoom]) -> String {
  let activity = rooms.filter { $0.mutedAt == nil }
    .map { "\($0.id)@\(Int(($0.updatedAt.timeIntervalSince1970 * 1000).rounded()))" }
    .joined(separator: ",")
  return "\(unreadThreadsFingerprint(rooms))|\(activity)"
}
