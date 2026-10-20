import Foundation

/// One cursor-paged list, as web's `useInfiniteQuery` and the panels built on `loadFirstPage` read it: a first
/// page that replaces the rows, older pages that append, and the one status the paging row shows.
///
/// The list is a value with no transport. A model asks `begin(older:)` for a `Request`, fetches, and hands the
/// answer back through `answer`, `fail` and `settle`; the request's generation lets any later `begin`, `reset`
/// or `supersede` drop a late answer. Cancellation stays with the model, since a value cannot see its task.
///
/// - A first page supersedes an older page in flight and forgets a failed one, and keeps the rows on screen
///   until it answers (web's `keepPreviousData`).
/// - A failed older page stays on the paging row (`.failed`) with the rows and cursor kept.
/// - A failed first page leaves no row and no cursor.
/// - A cursor Core sends back unchanged ends paging, so a server that repeats itself cannot loop the row.
public struct CursorPages<Item: Sendable>: Sendable {
  /// The page being read: the generation that identifies it, whether it is an older page, and the cursor to
  /// read it from (nil for a first page).
  public struct Request: Equatable, Sendable {
    let generation: Int
    let older: Bool
    public let cursor: String?
  }

  public internal(set) var items: [Item] = []
  public internal(set) var nextCursor: String?
  /// A first page answered and none failed since: web's `isSuccess`.
  public internal(set) var hasAnswered = false
  public internal(set) var isLoadingFirstPage = false
  /// The last first page failed: web's `isError` with no data.
  public internal(set) var firstPageFailed = false
  /// The paging row after the last row, web's `ThreadListLoadMore` status.
  public internal(set) var olderPageStatus: PageBoundaryStatus = .idle
  var generation = 0

  public init() {}

  /// Web's `useLoadWhenVisible` arming: the paging row asks by itself only while idle, never during a first
  /// page, and after a failure not until the reader retries.
  public var loadsOlderAutomatically: Bool {
    nextCursor != nil && olderPageStatus == .idle && !isLoadingFirstPage
  }

  /// Starts a page, or nil when an older page cannot start now: no cursor, a first page out, or an older page
  /// already out. A first page supersedes an older page in flight and forgets a failed one.
  mutating func begin(older: Bool) -> Request? {
    if older, nextCursor == nil || isLoadingFirstPage || olderPageStatus == .loading {
      return nil
    }
    generation += 1
    if older {
      olderPageStatus = .loading
    } else {
      isLoadingFirstPage = true
      olderPageStatus = .idle
    }
    return Request(generation: generation, older: older, cursor: older ? nextCursor : nil)
  }

  /// Whether `request` is still the page this list waits for.
  func isCurrent(_ request: Request) -> Bool {
    generation == request.generation
  }

  /// The page is over, however it ended: its loading state goes. A superseded request changes nothing.
  mutating func settle(_ request: Request) {
    guard isCurrent(request) else { return }
    isLoadingFirstPage = false
    if olderPageStatus == .loading {
      olderPageStatus = .idle
    }
  }

  /// Takes a page's rows. An older page appends the rows whose `id` is not held yet: a row that moved since the
  /// last page comes back on this one, and the held copy stays. A first page replaces the rows.
  mutating func answer(_ request: Request, items page: [Item], nextCursor next: String?, id: KeyPath<Item, String>) {
    guard isCurrent(request) else { return }
    if request.older {
      let known = Set(items.map { $0[keyPath: id] })
      items += page.filter { !known.contains($0[keyPath: id]) }
    } else {
      items = page
    }
    nextCursor = next == request.cursor ? nil : next
    hasAnswered = true
    firstPageFailed = false
  }

  /// A failed older page stays on the paging row with the rows kept. A failed first page is web's query
  /// without data: no rows, no paging row, the error with Try again.
  mutating func fail(_ request: Request) {
    guard isCurrent(request) else { return }
    if request.older {
      olderPageStatus = .failed
    } else {
      items = []
      nextCursor = nil
      hasAnswered = false
      firstPageFailed = true
    }
  }

  /// Forgets everything, and drops any page still out.
  mutating func reset() {
    let next = generation + 1
    self = CursorPages()
    generation = next
  }

  /// Drops any page still out and its loading state, and keeps the rows, cursor and a failed older page.
  mutating func supersede() {
    generation += 1
    isLoadingFirstPage = false
    if olderPageStatus == .loading {
      olderPageStatus = .idle
    }
  }

  /// Takes held rows out, such as an unpinned message. Any page out may still carry them, so the caller
  /// supersedes it.
  mutating func removeAll(where shouldRemove: (Item) -> Bool) {
    items.removeAll(where: shouldRemove)
  }
}

extension CursorPages: Equatable where Item: Equatable {}
