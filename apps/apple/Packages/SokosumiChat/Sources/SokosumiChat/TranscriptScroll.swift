import Foundation

/// How a Transcript's list follows the conversation, independent of scroll-view APIs: whether it follows the latest
/// message, when it re-aligns to the bottom, and when Jump to latest shows. Content growth never unpins a reader who
/// was following, and a jumped-to page never follows. `anchored` is the Transcript's live `historicalAnchor != nil`,
/// read in the same update as the change it answers: a stored copy would lag the page it describes.
public struct TranscriptScroll: Equatable, Sendable {
  public private(set) var followsLatest = true
  /// Content grew while the list followed: align to the bottom once the reader is not scrolling.
  public private(set) var pendingBottomAlignment = false

  public init() {}

  /// A new last message or grown content pulls the list to the bottom.
  public func followsNewMessages(anchored: Bool) -> Bool {
    followsLatest && !anchored
  }

  public func showsJumpToLatest(anchored: Bool) -> Bool {
    !followsLatest || anchored
  }

  /// The list moved or resized. A move the reader made, or one across the near-bottom line, sets whether the list
  /// follows; a resize while following asks for a bottom alignment.
  public mutating func edgesChanged(from old: TranscriptScrollEdges, to new: TranscriptScrollEdges, userIsScrolling: Bool,
                                    anchored: Bool) {
    if !anchored, old.offsetY != new.offsetY, userIsScrolling || old.nearBottom != new.nearBottom {
      if followsLatest != new.nearBottom {
        followsLatest = new.nearBottom
        if !new.nearBottom {
          pendingBottomAlignment = false
        }
      }
    } else if !old.hasSameSize(as: new), followsNewMessages(anchored: anchored), new.needsBottomAlignment {
      pendingBottomAlignment = true
    }
  }

  /// A placement the list made by itself, the Unread divider's, came to rest. Only the reader's moves and crossings of
  /// the near-bottom line set whether the list follows, and this placement may cross nothing: content that fits, or a
  /// scroll the bottom clamps. Resting near the bottom, the list follows again, so a short unread run is read on open.
  public mutating func placementSettled(at edges: TranscriptScrollEdges, anchored: Bool) {
    if !anchored, edges.nearBottom {
      followLatest()
    }
  }

  /// Whether a pending bottom alignment may run now.
  public func alignsToBottom(userIsScrolling: Bool, anchored: Bool) -> Bool {
    pendingBottomAlignment && !userIsScrolling && followsNewMessages(anchored: anchored)
  }

  /// Takes the pending bottom alignment if it may run now; true when the list should scroll to the bottom.
  public mutating func takeBottomAlignment(userIsScrolling: Bool, anchored: Bool) -> Bool {
    guard alignsToBottom(userIsScrolling: userIsScrolling, anchored: anchored) else { return false }
    pendingBottomAlignment = false
    return true
  }

  public mutating func beginAutomaticOlderPage(userIsScrolling: Bool, isNearTop: Bool, hasMore: Bool, isLoading: Bool) -> Bool {
    guard userIsScrolling, isNearTop, hasMore, !isLoading else { return false }
    readOlder()
    return true
  }

  /// A jump to a message: the list stops following and drops a pending bottom alignment.
  public mutating func jumped() {
    readOlder()
    pendingBottomAlignment = false
  }

  public mutating func readOlder() {
    followsLatest = false
  }

  public mutating func followLatest() {
    followsLatest = true
  }
}

/// A Transcript list's edges from plain numbers, so viewport movement reads apart from content growth.
public struct TranscriptScrollEdges: Equatable, Sendable {
  public let offsetY: CGFloat
  public let contentHeight: CGFloat
  public let viewportHeight: CGFloat
  /// Content inset above the visible rows (the title bar's), which scroll-view frames include.
  public let topInset: CGFloat
  public let nearTop: Bool
  public let nearBottom: Bool
  public let needsBottomAlignment: Bool

  public init(offsetY: CGFloat, contentHeight: CGFloat, containerHeight: CGFloat, topInset: CGFloat, bottomInset: CGFloat,
              visibleMinY: CGFloat, visibleMaxY: CGFloat) {
    self.offsetY = offsetY
    self.contentHeight = contentHeight
    viewportHeight = containerHeight - topInset - bottomInset
    self.topInset = topInset
    let distance = contentHeight + bottomInset - visibleMaxY
    nearTop = visibleMinY < 40
    nearBottom = distance < 200
    needsBottomAlignment = distance > 1
  }

  public func hasSameSize(as other: Self) -> Bool {
    contentHeight == other.contentHeight && viewportHeight == other.viewportHeight
  }
}
