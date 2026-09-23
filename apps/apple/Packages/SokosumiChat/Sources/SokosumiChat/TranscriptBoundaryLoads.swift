import Foundation

/// A transcript boundary row's state: web's `TranscriptBoundaryStatus`.
public enum TranscriptBoundaryStatus: Equatable, Sendable {
  case idle, loading, failed
}

/// Load state of the history gap rows, keyed like web's `boundaryStatus` map:
/// by the first message of the range below the gap, which is the cursor the
/// missing page loads from. Also web's `useLoadWhenVisible`: a gap that
/// scrolls into view asks for its page once per arming. The arming is spent
/// by that request and comes back only when the row scrolls out and in
/// again, so a refused or failed request cannot loop, and a failed row waits
/// for Try again.
public struct TranscriptBoundaryLoads: Equatable, Sendable {
  private var statuses: [String: TranscriptBoundaryStatus] = [:]
  /// Visible gap rows in the order they scrolled into view.
  private var visible: [String] = []
  /// Visible rows whose one automatic request has not been spent.
  private var armed: Set<String> = []

  public init() {}

  public func status(of cursorMessageId: String) -> TranscriptBoundaryStatus {
    statuses[cursorMessageId] ?? .idle
  }

  public var loadingCursorMessageId: String? {
    statuses.first { $0.value == .loading }?.key
  }

  /// The row scrolled into or out of view.
  public mutating func setVisible(_ cursorMessageId: String, _ isVisible: Bool) {
    if isVisible {
      guard !visible.contains(cursorMessageId) else { return }
      visible.append(cursorMessageId)
      if status(of: cursorMessageId) == .idle {
        armed.insert(cursorMessageId)
      }
    } else {
      visible.removeAll { $0 == cursorMessageId }
      armed.remove(cursorMessageId)
    }
  }

  /// The gap to load on its own now, marked loading: the first visible armed
  /// row, while nothing loads. The timeline admits one page at a time.
  public mutating func nextAutomaticLoad() -> String? {
    guard loadingCursorMessageId == nil,
          let cursorMessageId = visible.first(where: { armed.contains($0) && status(of: $0) == .idle }) else { return nil }
    armed.remove(cursorMessageId)
    statuses[cursorMessageId] = .loading
    return cursorMessageId
  }

  /// A tap or Try again. False while that gap already loads.
  @discardableResult
  public mutating func begin(_ cursorMessageId: String) -> Bool {
    guard status(of: cursorMessageId) != .loading else { return false }
    armed.remove(cursorMessageId)
    statuses[cursorMessageId] = .loading
    return true
  }

  /// The page arrived (the gap moved or closed) or the request failed (the row keeps its retry).
  public mutating func settle(_ cursorMessageId: String, succeeded: Bool) {
    guard status(of: cursorMessageId) == .loading else { return }
    statuses[cursorMessageId] = succeeded ? nil : .failed
  }

  /// The timeline refused the request because another page was in flight:
  /// back to idle for a tap, the arming spent.
  public mutating func release(_ cursorMessageId: String) {
    guard status(of: cursorMessageId) == .loading else { return }
    statuses[cursorMessageId] = nil
  }

  /// Gaps that closed by another route (a jump joined the ranges) leave no state behind.
  public mutating func retain(_ gaps: Set<String>) {
    statuses = statuses.filter { gaps.contains($0.key) || $0.value == .loading }
    visible.removeAll { !gaps.contains($0) }
    armed = armed.intersection(gaps)
  }
}
