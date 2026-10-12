import CoreAPI
import Foundation

/// A consistent message/document snapshot prepared before lazy rows are displayed.
public struct PreparedTranscript: Sendable {
  public struct Input: Equatable, Sendable {
    public let scope: [String]
    public let messages: [Components.Schemas.ChatRoomMessage]
    public let mentions: MessageMentions?
    public let channels: [ComposerChannel]
    public let baseURL: URL

    public init(scope: [String], messages: [Components.Schemas.ChatRoomMessage], mentions: MessageMentions?, channels: [ComposerChannel], baseURL: URL) {
      self.scope = scope
      self.messages = messages
      self.mentions = mentions
      self.channels = channels
      self.baseURL = baseURL
    }
  }

  public let input: Input
  public let documents: [String: MessageMarkdown]
  private let sources: [String: String]

  init(input: Input, documents: [String: MessageMarkdown]) {
    self.input = input
    self.documents = documents
    sources = Dictionary(input.messages.map { ($0.id, $0.content) }, uniquingKeysWith: { _, latest in latest })
  }

  /// Markdown is prepared async; chips and edits overlay that snapshot.
  /// Rows the live transcript already dropped (a deleted message) stay
  /// dropped — falling back to the snapshot would keep them on screen
  /// until re-prepare finishes. A pending shell Core confirmed takes its
  /// server row in place, so the send never blinks out while the id swaps.
  /// Only the older prefix waits for preparation: rows from the oldest surviving snapshot row onward stay live,
  /// including arrivals while an older page waits for scrolling to end.
  public func overlaying(_ live: [Components.Schemas.ChatRoomMessage]) -> [Components.Schemas.ChatRoomMessage] {
    guard let first = firstRetainedIndex(in: live) else { return [] }
    return Array(live[first...])
  }

  /// Shared by projection and prepend detection, so deleting or confirming the oldest row cannot change which
  /// prefix waits for scrolling to end. The maps and scan are linear in the transcript size.
  private func firstRetainedIndex(in live: [Components.Schemas.ChatRoomMessage]) -> Int? {
    let byId = Dictionary(live.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
    let confirmedByTurn = Dictionary(live.enumerated().compactMap { index, message in
      isOutboundLocalMessage(message) ? nil : realtimeClientTurnId(message).map { ($0, index) }
    }, uniquingKeysWith: { _, latest in latest })
    for snapshot in input.messages {
      if let index = byId[snapshot.id] ?? (isOutboundLocalMessage(snapshot) ? realtimeClientTurnId(snapshot).flatMap { confirmedByTurn[$0] } : nil) {
        return index
      }
    }
    return nil
  }

  /// Whether this snapshot adds rows above `current`'s first surviving row in the same transcript: an older page. Inserting rows
  /// above the realized ones makes the lazy list measure every realized row again (M6), so the room holds such a
  /// snapshot until the reader's scroll rests.
  public func prependsRows(to current: Self?) -> Bool {
    guard let current, current.input.scope == input.scope else { return false }
    return current.lacksRowsAbove(in: input.messages)
  }

  /// Whether `live` holds rows above this snapshot's first surviving row: an older page preparing or waiting to land.
  public func lacksRowsAbove(in live: [Components.Schemas.ChatRoomMessage]) -> Bool {
    firstRetainedIndex(in: live).map { $0 > 0 } ?? false
  }

  /// The prepared document for a row, including a confirmed send still keyed by its pending shell.
  public func document(for message: Components.Schemas.ChatRoomMessage) -> MessageMarkdown? {
    if sources[message.id] == message.content, let document = documents[message.id] {
      return document
    }
    guard let turnId = realtimeClientTurnId(message),
          sources[outboundLocalMessageId(turnId)] == message.content
    else { return nil }
    return documents[outboundLocalMessageId(turnId)]
  }

  public static func prepare(_ input: Input, reusing previous: Self?) async throws -> Self {
    let task = Task.detached(priority: .userInitiated) {
      let reusable = previous.flatMap { previous in
        previous.input.scope == input.scope && previous.input.mentions == input.mentions
          && previous.input.channels == input.channels && previous.input.baseURL == input.baseURL ? previous : nil
      }
      let oldSources = reusable?.sources ?? [:]
      var documents: [String: MessageMarkdown] = [:]
      for message in input.messages {
        try Task.checkCancellation()
        if oldSources[message.id] == message.content, let document = reusable?.documents[message.id] {
          documents[message.id] = document
        } else {
          documents[message.id] = MessageMarkdown(
            message.content, baseURL: input.baseURL, mentions: input.mentions, channels: input.channels, diagrams: true
          )
        }
      }
      return Self(input: input, documents: documents)
    }
    return try await withTaskCancellationHandler {
      let prepared = try await task.value
      try Task.checkCancellation()
      return prepared
    } onCancel: {
      task.cancel()
    }
  }
}
