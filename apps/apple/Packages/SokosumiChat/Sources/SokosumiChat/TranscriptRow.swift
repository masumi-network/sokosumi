import CoreAPI
import Foundation

/// One message's place in a Transcript list: the history gap and day pill before it, then a status row or a bubble
/// with what it needs from the Transcript. The room and the Thread lay these out; the rules live here.
public struct TranscriptRow: Equatable {
  public typealias Message = Components.Schemas.ChatRoomMessage

  public enum Content: Equatable {
    /// A membership or Group name change; the app words it.
    case status
    case bubble(Bubble)
  }

  public struct Bubble: Equatable {
    public let row: MessageRow
    /// The send this client still owns for the row, if any.
    public let outbound: OutboundShell?
    public let sentAt: Date?
    /// The mark a jump left on the row, while it lasts.
    public let jumpMark: JumpMark?
    /// A coworker stream's reply with no words yet while the stream runs: its Thought shows working.
    public let thinking: Bool
  }

  /// The history-gap row above this message, with its load status; nil when no gap.
  public let gap: PageBoundaryStatus?
  /// The day pill above this message; nil when it continues the previous message's day.
  public let dayLabel: String?
  public let content: Content
}

public extension TranscriptSession {
  /// Row `index` of `messages`, the list this Transcript shows. Built per row as the list realizes it, so a long
  /// history never derives rows it does not draw. A gap resets the avatar grouping but not the day pill: messages
  /// missing between two of the same day are of that day too. `newestId` marks the row that may hold Seen by.
  func row(
    at index: Int,
    of messages: [Components.Schemas.ChatRoomMessage],
    context: TranscriptContext,
    streamBusy: Bool,
    newestId: String? = nil,
    now: Date
  ) -> TranscriptRow {
    let message = messages[index]
    let previous = index > 0 ? messages[index - 1] : nil
    let gap = timeline.historyGapMessageIds.contains(message.id) ? timeline.boundaryLoads.status(of: message.id) : nil
    let dayLabel = daySeparatorLabel(for: message.createdAt, previous: previous?.createdAt, now: now)
    let outbound = outbox.shells.first { $0.id == message.id }
    guard MessageKind(message, outbound: outbound) != .statusRow else {
      return TranscriptRow(gap: gap, dayLabel: dayLabel, content: .status)
    }
    let bubble = TranscriptRow.Bubble(
      row: MessageRow(message, in: context, previous: gap == nil ? previous : nil, isNewest: message.id == newestId),
      outbound: outbound,
      sentAt: outbox.sentAt[message.id],
      jumpMark: jumpTarget.flatMap { $0.messageId == message.id ? $0.mark : nil },
      thinking: streamBusy && isCoworkerStreamOverlay(message) && ComposerContent(message.content).text.isEmpty
    )
    return TranscriptRow(gap: gap, dayLabel: dayLabel, content: .bubble(bubble))
  }
}
