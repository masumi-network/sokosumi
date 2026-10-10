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

  /// Markdown is prepared async; chips and edits overlay that snapshot.
  /// Rows the live transcript already dropped (a deleted message) stay
  /// dropped — falling back to the snapshot would keep them on screen
  /// until re-prepare finishes. A pending shell Core confirmed takes its
  /// server row in place, so the send never blinks out while the id swaps.
  public func overlaying(_ live: [Components.Schemas.ChatRoomMessage]) -> [Components.Schemas.ChatRoomMessage] {
    let byId = Dictionary(live.map { ($0.id, $0) }, uniquingKeysWith: { _, latest in latest })
    let confirmedByTurn = Dictionary(live.compactMap { message in
      isOutboundLocalMessage(message) ? nil : realtimeClientTurnId(message).map { ($0, message) }
    }, uniquingKeysWith: { _, latest in latest })
    return input.messages.compactMap { snapshot in
      byId[snapshot.id] ?? (isOutboundLocalMessage(snapshot) ? realtimeClientTurnId(snapshot).flatMap { confirmedByTurn[$0] } : nil)
    }
  }

  /// Whether this snapshot adds rows above `current`'s first row in the same transcript: an older page. Inserting rows
  /// above the realized ones makes the lazy list measure every realized row again (M6), so the room holds such a
  /// snapshot until the reader's scroll rests.
  public func prependsRows(to current: Self?) -> Bool {
    guard let current, current.input.scope == input.scope else { return false }
    return current.lacksRowsAbove(in: input.messages)
  }

  /// Whether `live` holds rows above this snapshot's first row: an older page still preparing or waiting to land.
  public func lacksRowsAbove(in live: [Components.Schemas.ChatRoomMessage]) -> Bool {
    guard let first = input.messages.first?.id else { return false }
    return live.firstIndex { $0.id == first }.map { $0 > 0 } ?? false
  }

  /// The prepared document for a row, including a confirmed send still keyed by its pending shell.
  public func document(for message: Components.Schemas.ChatRoomMessage) -> MessageMarkdown? {
    if let document = documents[message.id] {
      return document
    }
    guard let turnId = realtimeClientTurnId(message),
          input.messages.contains(where: { $0.id == outboundLocalMessageId(turnId) && $0.content == message.content })
    else { return nil }
    return documents[outboundLocalMessageId(turnId)]
  }

  public static func prepare(_ input: Input, reusing previous: Self?) async throws -> Self {
    let task = Task.detached(priority: .userInitiated) {
      let reusable = previous.flatMap { previous in
        previous.input.scope == input.scope && previous.input.mentions == input.mentions
          && previous.input.channels == input.channels && previous.input.baseURL == input.baseURL ? previous : nil
      }
      let oldSources = Dictionary((reusable?.input.messages ?? []).map { ($0.id, $0.content) }, uniquingKeysWith: { _, latest in latest })
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
